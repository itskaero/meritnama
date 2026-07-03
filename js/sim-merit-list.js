'use strict';

/**
 * Merit List Mode — replaces the Seat Allocation tab with a published
 * merit list view. Loads data from:
 *   - data/induction21_merit.json           (flat array of merit entries)
 *   - data/induction21_consent_round{N}.json (consent statuses per round, keyed by applicantId)
 *   - data/induction21_seats.json           (seat inventory for meta)
 *
 * Controlled by:
 *   - notifications/simulation_mode  — 'merit-list' vs 'seat-allocation'
 *   - notifications/consent_round    — round number (1, 2, …) loaded via Firestore listener
 *
 * "Next in Line" uses the simulation engine (allCandidates + effectiveMark)
 * with consent-based filtering: candidates with Rejected/Not Avail are excluded.
 * Armed Force is handled inherently via quotaName matching (quotaName="Armed Force").
 */

(function () {

  let db;
  let merritListActive = false;
  let meritData = [];            // flat array from induction21_merit.json
  let filteredData = [];         // current filtered/sorted subset
  let consentMap = {};           // {applicantId: 'Accepted'|'Rejected'|'Pending'|...} — current round only (display)
  let cumulativeRejected = new Set();  // applicantIds rejected in ANY round up to current (logic)
  let initialConsentMap = {};    // snapshot for restore
  let noConsentIds = new Set();  // locally overridden as no-consent
  let chainState = {};          // { [removedId]: { candidates: [...] } }
  let seatsData = null;
  let currentRound = 1;
  let consentFileUpdatedAt = null;
  let meritFileUpdatedAt = null;
  let simResults = {};           // { program: { seatTree, candidates } } from auto-run
  let simAccuracy = null;        // { match, total, pct } after auto-run
  let candidatesData = [];       // from induction21_candidates.json
  let candidatesMap = {};        // applicantId → candidate object
  let specialtyNameToId = {};    // lowercase name → specialty id (from disciplineFullData.json)
  let certificatesData = {};     // applicantId → cert[] from induction21_certificates.json

  function consentFile() {
    return 'data/induction21_consent_round' + currentRound + '.json';
  }

  async function buildCumulativeRejected(upToRound) {
    const rejected = new Set();
    for (let r = 1; r <= upToRound; r++) {
      try {
        const res = await fetch('data/induction21_consent_round' + r + '.json', { cache: 'no-store' });
        if (!res.ok) continue;
        const data = await res.json();
        for (const [aid, status] of Object.entries(data)) {
          if (status === 'Rejected') rejected.add(aid);
        }
      } catch (_) { /* skip missing rounds */ }
    }
    return rejected;
  }

  let $tabContent, $tabBtn;

  // ── Helpers ──

  function fval(obj, ...keys) {
    for (const k of keys) {
      const v = obj[k];
      if (v != null) return v;
    }
    return null;
  }

  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function setStatus(msg, color) {
    const el = document.getElementById('mlStatus');
    if (el) { el.textContent = msg; if (color) el.style.color = color; }
  }

  // ── Init ──

  function init() {
    if (typeof firebase === 'undefined') { setTimeout(init, 500); return; }
    try { db = firebase.firestore(); } catch (_) { setTimeout(init, 500); return; }

    db.collection('notifications').doc('simulation_mode').onSnapshot(snap => {
      const mode = snap.exists ? snap.data().mode : 'seat-allocation';
      applyMode(mode);
    }, err => {
      console.warn('[MeritList] Firestore error, defaulting to seat-allocation:', err);
      applyMode('seat-allocation');
    });

    db.collection('notifications').doc('watermark_config').onSnapshot(snap => {
      const enabled = snap.exists ? snap.data().enabled !== false : true;
      applyWatermark(enabled);
    }, err => {
      applyWatermark(true);
    });

    db.collection('notifications').doc('consent_round').onSnapshot(snap => {
      const data = snap.exists ? snap.data() : {};
      const round = parseInt(data.round, 10) || 1;
      if (data.fileUpdatedAt) consentFileUpdatedAt = data.fileUpdatedAt;
      if (round > 0 && round !== currentRound) {
        currentRound = round;
        if (merritListActive && meritData.length) {
          reloadConsentData();
        }
      }
      if (merritListActive) updateMeta();
    }, err => {
      console.warn('[MeritList] consent_round Firestore error, using round', currentRound);
    });
  }

  async function reloadConsentData() {
    try {
      const res = await fetch(consentFile(), { cache: 'no-store' });
      if (res.ok) {
        consentMap = await res.json();
        initialConsentMap = JSON.parse(JSON.stringify(consentMap));
        const consentDate = res.headers.get('Last-Modified');
        if (consentDate) consentFileUpdatedAt = consentDate;
      } else {
        consentMap = {};
        initialConsentMap = {};
      }
      cumulativeRejected = await buildCumulativeRejected(currentRound);
      noConsentIds = new Set();
      chainState = {};
      updateMeta();
      applyFilters();
      setStatus('Switched to round ' + currentRound + '.', 'var(--neon-gold)');
    } catch (err) {
      console.warn('[MeritList] reloadConsentData failed:', err);
    }
  }

  function applyWatermark(enabled) {
    const guard = document.querySelector('.watermark-overlay, #watermarkOverlay');
    if (guard) guard.style.display = enabled ? '' : 'none';
    if (typeof setWatermarkEnabled === 'function') setWatermarkEnabled(enabled);
  }

  function applyMode(mode) {
    const isMerit = mode === 'merit-list';
    if (isMerit === merritListActive) return;

    merritListActive = isMerit;

    $tabBtn = $tabBtn || document.querySelector('[data-tab="simulation"]');
    $tabContent = $tabContent || document.getElementById('tab-simulation');

    if (isMerit) {
      if ($tabBtn) $tabBtn.textContent = '\u{1F4CA} Merit List';
      loadMeritData();
    } else {
      if ($tabBtn) $tabBtn.textContent = '\u26A1 Seat Allocation';
      window.location.reload();
    }
  }

  // ── Load ──

  async function loadMeritData() {
    if (!$tabContent) return;

    const roundMatch = consentFile().match(/consent_round(\d+)/i);
    currentRound = roundMatch ? parseInt(roundMatch[1], 10) : 1;

    $tabContent.innerHTML = `
      <div class="section-header">
        <h2>Merit List — Round ${currentRound}</h2>
        <p>Published merit placements for Induction 21. Data from <code>induction21_merit.json</code>.</p>
      </div>
      <div style="text-align:center;padding:3rem;color:var(--text-muted);">Loading merit data&hellip;</div>`;

    try {
      const [meritRes, consentRes, seatsRes, candRes, discRes, certRes] = await Promise.all([
        fetch('data/induction21_merit.json', { cache: 'no-store' }),
        fetch(consentFile(), { cache: 'no-store' }),
        fetch('data/induction21_seats.json', { cache: 'no-store' }),
        fetch('data/induction21_candidates.json', { cache: 'no-store' }),
        fetch('data/disciplineFullData.json', { cache: 'no-store' }),
        fetch('data/induction21_certificates.json', { cache: 'no-store' }),
      ]);

      if (!meritRes.ok) throw new Error('Failed to load merit list: HTTP ' + meritRes.status);

      const raw = await meritRes.json();
      // Accept either a flat array or { Table5: [...] } shape (legacy round_*.json)
      meritData = Array.isArray(raw) ? raw : (raw.Table5 || []);

      // Capture file timestamps from HTTP headers as fallback
      const meritDate = meritRes.headers.get('Last-Modified');
      if (meritDate) meritFileUpdatedAt = meritDate;

      if (consentRes.ok) {
        consentMap = await consentRes.json();
        const consentDate = consentRes.headers.get('Last-Modified');
        if (consentDate) consentFileUpdatedAt = consentDate;
      } else {
        consentMap = {};
      }
      initialConsentMap = JSON.parse(JSON.stringify(consentMap));
      cumulativeRejected = await buildCumulativeRejected(currentRound);

      if (seatsRes.ok) {
        seatsData = await seatsRes.json();
      }

      // Load candidate pool for replacement search
      if (candRes.ok) {
        const rawCands = await candRes.json();
        candidatesData = Array.isArray(rawCands) ? rawCands : (Object.values(rawCands) || []);
        candidatesMap = {};
        for (const c of candidatesData) {
          candidatesMap[String(c.applicantId)] = c;
        }
      }

      // Load disciplineFullData for specialityId ↔ name mapping (portal-sourced)
      if (discRes.ok) {
        const discList = await discRes.json();
        specialtyNameToId = {};
        if (Array.isArray(discList)) {
          for (const d of discList) {
            for (const sp of (d.specialities || [])) {
              const name = (sp.specialityName || '').toLowerCase().trim();
              if (name) specialtyNameToId[name] = sp.specialityId;
            }
          }
        }
      }

      // Load certificates for per-preference marks resolution (certificateMarks chain)
      if (certRes.ok) {
        const rawCerts = await certRes.json();
        certificatesData = rawCerts && typeof rawCerts === 'object' && !Array.isArray(rawCerts)
          ? rawCerts
          : {};
      }

      noConsentIds = new Set();
      chainState = {};
      batchAutoChain();
      renderMeritListUI();
    } catch (err) {
      console.error('[MeritList] Load error:', err);
      if ($tabContent) {
        $tabContent.innerHTML = `
          <div class="section-header">
            <h2>Merit List — Round ${currentRound}</h2>
          </div>
          <div class="card" style="text-align:center;padding:2rem;color:var(--neon-pink);">
            Failed to load merit list: ${esc(err.message)}
          </div>`;
      }
    }
  }

  // ── Render UI ──

  function renderMeritListUI() {
    if (!$tabContent) return;

    const programs = [...new Set(meritData.map(d =>
      fval(d, 'typeName', 'type', 'program')
    ).filter(Boolean))].sort();

    const specialties = [...new Set(meritData.map(d =>
      fval(d, 'specialityName', 'speciality', 'specialty')
    ).filter(Boolean))].sort();

    const hospitals = [...new Set(meritData.map(d =>
      fval(d, 'hospitalName', 'hospital')
    ).filter(Boolean))].sort();

    const quotas = [...new Set(meritData.map(d =>
      fval(d, 'quotaName', 'quota')
    ).filter(Boolean))].sort();

    $tabContent.innerHTML = `
      <style>
        #mlTable thead th { position:sticky; top:0; z-index:2; }
        #mlTable tbody tr:nth-child(even) { background:rgba(255,255,255,0.02); }
        #mlTable tbody tr:nth-child(even):hover { background:rgba(77,184,217,0.07); }
        #mlTable td:first-child, #mlTable th:first-child { padding-left:18px; }
        #mlTable td:last-child, #mlTable th:last-child { padding-right:18px; }
        .ml-consent-badge { display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:100px;font-size:0.72rem;font-weight:600;letter-spacing:0.02em;white-space:nowrap; }
        .ml-consent-badge.accepted { background:rgba(62,207,142,0.12);color:var(--neon-green); }
        .ml-consent-badge.excluded { background:rgba(220,60,60,0.12);color:var(--neon-red); }
        .ml-consent-badge.awaited { background:rgba(232,166,39,0.12);color:var(--neon-gold); }
        .ml-consent-badge .dot { width:6px;height:6px;border-radius:50%;display:inline-block; }
        .ml-consent-badge.accepted .dot { background:var(--neon-green); }
        .ml-consent-badge.excluded .dot { background:var(--neon-red); }
        .ml-consent-badge.awaited .dot { background:var(--neon-gold); }
        #mlTable tr.excluded-row { opacity:0.55;text-decoration:line-through; }
        .ml-sim-match { display:inline-flex;align-items:center;gap:3px;padding:2px 6px;border-radius:4px;font-size:0.65rem;font-weight:700; }
        .ml-sim-match.yes { background:rgba(62,207,142,0.1);color:var(--neon-green); }
        .ml-sim-match.no { background:rgba(220,60,60,0.1);color:var(--neon-red); }
      </style>
      <div class="section-header">
        <h2>Merit List — Round ${currentRound}</h2>
        <p>Published merit placements for Induction 21 — ${meritData.length.toLocaleString()} entries.</p>
      </div>

      <div id="meritListMeta" class="current-meta-card"></div>

      <div class="card filter-card">
        <div class="input-grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));">
          <div class="form-group">
            <label>Program</label>
            <select id="mlProgram">
              <option value="">All Programs</option>
              ${programs.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>Specialty</label>
            <select id="mlSpecialty">
              <option value="">All Specialties</option>
              ${specialties.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>Hospital</label>
            <select id="mlHospital">
              <option value="">All Hospitals</option>
              ${hospitals.map(h => `<option value="${esc(h)}">${esc(h)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>Quota</label>
            <select id="mlQuota">
              <option value="">All Quotas</option>
              ${quotas.map(q => `<option value="${esc(q)}">${esc(q)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>Search</label>
            <input type="text" id="mlSearch" placeholder="Name, PMDC, ID&hellip;" class="mt-filter-input" />
          </div>
          <div class="form-group">
            <label>Consent</label>
            <select id="mlConsent">
              <option value="">All</option>
              <option value="Accepted">Accepted</option>
              <option value="Excluded">Excluded</option>
              <option value="Awaited">Awaited</option>
            </select>
          </div>
        </div>
      </div>

      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px;">
        <span id="mlCount" style="font-size:0.82rem;color:var(--text-muted);">${meritData.length.toLocaleString()} entries</span>
        <button id="mlRestoreBtn" style="font-size:0.82rem;padding:6px 14px;background:rgba(245,200,66,0.12);color:#f5c842;border:1px solid rgba(245,200,66,0.28);border-radius:8px;cursor:pointer;">&#8635; Restore Initial Consent</button>
        <span id="mlStatus" style="font-size:0.78rem;color:var(--text-muted);"></span>
      </div>

      <div class="table-wrap">
        <table class="data-table" id="mlTable">
          <thead>
            <tr>
              <th>#</th>
              <th>ID</th>
              <th>Name</th>
              <th>PMDC</th>
              <th>Marks</th>
              <th>Program</th>
              <th>Quota</th>
              <th>Specialty</th>
              <th>Hospital</th>
              <th>Pref</th>
              <th>Sim</th>
              <th>Consent</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="mlBody">
            <tr><td colspan="13" style="text-align:center;padding:2rem;color:var(--text-muted);">Loading&hellip;</td></tr>
          </tbody>
        </table>
      </div>
      <p id="mlCaption" class="table-caption"></p>`;

    document.getElementById('mlProgram')?.addEventListener('change', applyFilters);
    document.getElementById('mlSpecialty')?.addEventListener('change', applyFilters);
    document.getElementById('mlHospital')?.addEventListener('change', applyFilters);
    document.getElementById('mlQuota')?.addEventListener('change', applyFilters);
    document.getElementById('mlSearch')?.addEventListener('input', applyFilters);
    document.getElementById('mlConsent')?.addEventListener('change', applyFilters);
    document.getElementById('mlRestoreBtn')?.addEventListener('click', restoreInitial);

    updateMeta();
    applyFilters();
    buildSimMatch();
    setTimeout(autoRunSimulations, 200);
  }

  // ── Meta ──

  function updateMeta() {
    const metaEl = document.getElementById('meritListMeta');
    if (!metaEl) return;

    let accepted = 0, excluded = 0, awaited = 0;
    for (const entry of meritData) {
      const v = getRowConsentVal(entry);
      if (v === 'Accepted') accepted++;
      else if (v === 'Excluded') excluded++;
      else awaited++;
    }

    const fmt = d => d ? new Date(d).toLocaleString() : '—';
    const meritLabel = meritFileUpdatedAt ? fmt(meritFileUpdatedAt) : '—';
    const consentAt = consentFileUpdatedAt ? ' (updated ' + fmt(consentFileUpdatedAt) + ')' : '';
    const simAccLabel = simAccuracy
      ? `<span style="color:${simAccuracy.pct >= 80 ? 'var(--neon-green)' : simAccuracy.pct >= 50 ? 'var(--neon-gold)' : 'var(--neon-red)'};">${simAccuracy.match}/${simAccuracy.total} (${simAccuracy.pct}%)</span>`
      : '<span style="color:var(--text-muted);">Pending...</span>';

    metaEl.innerHTML = `
      <div class="cur-meta-grid">
        <div><span class="cur-meta-lbl">Round</span><span class="cur-meta-val">${currentRound}</span></div>
        <div><span class="cur-meta-lbl">Total</span><span class="cur-meta-val">${meritData.length.toLocaleString()}</span></div>
        <div><span class="cur-meta-lbl" style="color:var(--neon-green);">Accepted</span><span class="cur-meta-val">${accepted.toLocaleString()}</span></div>
        <div><span class="cur-meta-lbl" style="color:var(--neon-red);">Excluded</span><span class="cur-meta-val">${excluded.toLocaleString()}</span></div>
        <div><span class="cur-meta-lbl" style="color:var(--neon-gold);">Awaited</span><span class="cur-meta-val">${awaited.toLocaleString()}</span></div>
        ${seatsData ? `<div><span class="cur-meta-lbl">Seats</span><span class="cur-meta-val">${seatsData.length} slots</span></div>` : ''}
        <div><span class="cur-meta-lbl">Sim Accuracy</span><span class="cur-meta-val">${simAccLabel}</span></div>
        <div><span class="cur-meta-lbl">Merit File</span><span class="cur-meta-val" style="font-family:var(--mono);font-size:0.72rem;color:var(--neon-cyan);">${meritLabel}</span></div>
        <div><span class="cur-meta-lbl">Consent File</span><span class="cur-meta-val" style="font-family:var(--mono);font-size:0.72rem;color:var(--neon-pink);">Round ${currentRound}${consentAt}</span></div>
      </div>`;
  }

  function autoRunSimulations() {
    if (typeof runSimulationForProgram !== 'function') return;
    const programs = [...new Set(meritData.map(d => fval(d, 'typeName', 'type', 'program')).filter(Boolean))];
    for (const prog of programs) {
      if (simResults[prog]) continue;
      try {
        const result = runSimulationForProgram(prog);
        if (result) simResults[prog] = result;
      } catch (e) {
        console.warn('[MeritList] Auto-sim failed for', prog, e);
      }
    }
    // Compute simulation accuracy vs merit list
    let match = 0, total = 0;
    for (const d of meritData) {
      const program = fval(d, 'typeName', 'type', 'program');
      const quota = fval(d, 'quotaName', 'quota');
      const specialty = fval(d, 'specialityName', 'speciality', 'specialty');
      const hospital = fval(d, 'hospitalName', 'hospital');
      const applicantId = fval(d, 'applicantId');
      const r = simMatchForSlot(program, quota, specialty, hospital, applicantId);
      if (r === true) match++;
      if (r !== null) total++;
    }
    simAccuracy = total > 0 ? { match, total, pct: (match / total * 100).toFixed(1) } : null;
    updateMeta();
    renderTable();
  }

  function buildSimMatch() {
    // no-op: per-row sim indicator shown in table
  }

  function simMatchForSlot(program, quota, specialty, hospital, applicantId) {
    // Check locally stored sim results first
    const result = simResults[program] || (typeof SIM !== 'undefined' && SIM.sim && SIM.sim.program === program ? SIM.sim.result : null);
    if (!result) return null;
    const q = (quota || '').toLowerCase();
    const s = (specialty || '').toLowerCase();
    const h = (hospital || '').toLowerCase();
    for (const [sq, specs] of Object.entries(result.seatTree)) {
      if (sq.toLowerCase() !== q) continue;
      for (const [ss, hospitals] of Object.entries(specs)) {
        if (ss.toLowerCase() !== s) continue;
        for (const [sh, slot] of Object.entries(hospitals)) {
          if (sh.toLowerCase() !== h) continue;
          const placed = slot.candidates || [];
          return placed.some(c => String(c.applicantId) === String(applicantId));
        }
      }
    }
    return null;
  }

  // ── Candidate Pool Lookups (from induction21_candidates.json) ──

  function candidateForApplicant(applicantId) {
    return candidatesMap[String(applicantId)] || null;
  }

  function candidatePreferenceForSlot(candidate, program, quota, specialty, hospital) {
    if (!candidate || !Array.isArray(candidate.preferences)) return null;
    const qLower = (quota || '').toLowerCase();
    const hLower = (hospital || '').toLowerCase();
    const specId = specialtyNameToId[(specialty || '').toLowerCase().trim()];
    for (const p of candidate.preferences) {
      if (p.typeName !== program) continue;
      if ((p.quotaName || '').toLowerCase() !== qLower) continue;
      if ((p.hospitalName || '').toLowerCase() !== hLower) continue;
      if (specId != null) {
        if (p.specialityId === specId) return p;
      } else if ((p.specialityName || '').toLowerCase() === (specialty || '').toLowerCase()) {
        return p;
      }
    }
    return null;
  }

  function certForPreference(pref, certs) {
    if (!pref || !Array.isArray(certs)) return null;
    const pType = pref.typeId != null ? pref.typeId : null;
    const pDisciplines = Array.isArray(pref.disciplineIds) ? pref.disciplineIds : [];
    for (const c of certs) {
      if (pType != null && c.typeId === pType && pDisciplines.includes(c.disciplineId)) return c;
      if (pType == null && c.typeName === pref.typeName && pDisciplines.includes(c.disciplineId)) return c;
    }
    return null;
  }

  function prefBonus(candidate, pref, program) {
    if (!candidate || !pref) return 0;
    const aid = String(candidate.applicantId);
    const certs = certificatesData[aid] || [];
    const cert = certForPreference(pref, certs);
    if (cert) {
      const portalMarks = parseFloat(cert.certificateMarks);
      if (Number.isFinite(portalMarks) && portalMarks > 0) return portalMarks;
      const compMarks = parseFloat(cert.computerizedMarks);
      if (Number.isFinite(compMarks) && compMarks > 0) return compMarks;
    }
    const pm = parseFloat(pref.programMarks) || parseFloat(pref.marks);
    if (Number.isFinite(pm) && pm > 0) return pm;
    return parseFloat(candidate.programMarks?.[program]) || 0;
  }

  function prefNoFromCandidate(applicantId, program, quota, specialty, hospital) {
    const c = candidateForApplicant(applicantId);
    const pref = candidatePreferenceForSlot(c, program, quota, specialty, hospital);
    return pref ? pref.preferenceNo : null;
  }

  function prefMatchFromCandidate(applicantId, program, quota, specialty, hospital) {
    const c = candidateForApplicant(applicantId);
    return !!candidatePreferenceForSlot(c, program, quota, specialty, hospital);
  }

  function slotKey(entry) {
    const id = fval(entry, 'applicantId');
    const p = fval(entry, 'typeName', 'type', 'program') || '';
    const q = fval(entry, 'quotaName', 'quota') || '';
    const s = fval(entry, 'specialityName', 'speciality', 'specialty') || '';
    const h = fval(entry, 'hospitalName', 'hospital') || '';
    return `${id}::${p}::${q}::${s}::${h}`;
  }

  function slotKeyFor(applicantId, program, quota, specialty, hospital) {
    return `${applicantId}::${program || ''}::${quota || ''}::${specialty || ''}::${hospital || ''}`;
  }

  // ── Filters ──

  function getRowConsentVal(d) {
    if (noConsentIds.has(slotKey(d))) return 'Excluded';
    const applicantId = fval(d, 'applicantId');
    const raw = consentMap[applicantId] || '';
    if (raw === 'Accepted') return 'Accepted';
    if (raw === 'Rejected') return 'Excluded';
    return 'Awaited';
  }

  function applyFilters() {
    const prog = (document.getElementById('mlProgram')?.value || '').toLowerCase();
    const spec = (document.getElementById('mlSpecialty')?.value || '').toLowerCase();
    const hosp = (document.getElementById('mlHospital')?.value || '').toLowerCase();
    const quota = (document.getElementById('mlQuota')?.value || '').toLowerCase();
    const search = (document.getElementById('mlSearch')?.value || '').toLowerCase().trim();
    const consentFilter = document.getElementById('mlConsent')?.value || '';

    filteredData = meritData.filter(d => {
      if (prog) {
        const dp = (fval(d, 'typeName', 'type', 'program') || '').toLowerCase();
        if (dp !== prog) return false;
      }
      if (spec) {
        const ds = (fval(d, 'specialityName', 'speciality', 'specialty') || '').toLowerCase();
        if (ds !== spec) return false;
      }
      if (hosp) {
        const dh = (fval(d, 'hospitalName', 'hospital') || '').toLowerCase();
        if (dh !== hosp) return false;
      }
      if (quota) {
        const dq = (fval(d, 'quotaName', 'quota') || '').toLowerCase();
        if (dq !== quota) return false;
      }
      if (search) {
        const name = (fval(d, 'nameFull', 'name') || '').toLowerCase();
        const id = String(fval(d, 'applicantId') || '');
        const pmdc = (fval(d, 'pmdcNo') || '').toLowerCase();
        if (!name.includes(search) && !id.includes(search) && !pmdc.includes(search)) return false;
      }
      if (consentFilter) {
        if (getRowConsentVal(d) !== consentFilter) return false;
      }
      return true;
    });

    renderTable();
  }

  // ── Table ──

  function renderTable() {
    const tbody = document.getElementById('mlBody');
    const caption = document.getElementById('mlCaption');
    const countEl = document.getElementById('mlCount');
    if (!tbody) return;

    if (!filteredData.length) {
      tbody.innerHTML = '<tr><td colspan="13" style="text-align:center;padding:2rem;color:var(--text-muted);">No entries match filters.</td></tr>';
      if (caption) caption.textContent = '';
      if (countEl) countEl.textContent = '0 entries';
      return;
    }

    const rows = [];
    for (const d of filteredData) {
      const applicantId = fval(d, 'applicantId');
      const rank = fval(d, 'rowNo');
      const name = fval(d, 'nameFull', 'name') || '—';
      const pmdc = fval(d, 'pmdcNo') || '—';
      const marks = fval(d, 'marksTotal', 'marks');
      const marksStr = marks != null ? Number(marks).toFixed(2) : '—';
      const program = fval(d, 'typeName', 'type', 'program') || '—';
      const quota = fval(d, 'quotaName', 'quota') || '—';
      const specialty = fval(d, 'specialityName', 'speciality', 'specialty') || '—';
      const hospital = fval(d, 'hospitalName', 'hospital') || '—';
      const preferenceNo = prefNoFromCandidate(applicantId, program, quota, specialty, hospital);
      const prefDisplay = preferenceNo != null ? preferenceNo : '—';
      const slotMatch = prefMatchFromCandidate(applicantId, program, quota, specialty, hospital);
      const prefIcon = slotMatch
        ? '<span style="color:var(--neon-green);font-weight:700;font-size:0.85rem;" title="Candidate listed this slot in preferences">&#10003;</span>'
        : '<span style="color:var(--neon-red);font-size:0.8rem;" title="Candidate did not list this slot or no data">&ndash;</span>';

      const simResult = simMatchForSlot(program, quota, specialty, hospital, applicantId);
      const simBadge = simResult === true
        ? '<span class="ml-sim-match yes">&#9679; Sim</span>'
        : simResult === false
        ? '<span class="ml-sim-match no">&#9679; Sim</span>'
        : '<span style="color:var(--text-muted);font-size:0.65rem;">—</span>';

      const consentVal = getRowConsentVal(d);
      const consentBadge = getConsentBadge(consentVal);
      const isExcluded = consentVal === 'Excluded';

      rows.push(`<tr${isExcluded ? ' class="excluded-row"' : ''}>
        <td>${rank != null ? rank : '—'}</td>
        <td style="font-family:var(--mono);font-size:0.82rem;">${esc(String(applicantId || ''))}</td>
        <td><strong>${esc(name)}</strong></td>
        <td style="font-family:var(--mono);font-size:0.82rem;">${esc(pmdc)}</td>
        <td style="font-weight:700;">${marksStr}</td>
        <td>${esc(program)}</td>
        <td style="font-size:0.75rem;font-family:var(--mono);color:var(--text-muted);">${esc(quota)}</td>
        <td style="font-size:0.8rem;">${esc(specialty)}</td>
        <td style="font-size:0.8rem;">${esc(hospital)}</td>
        <td style="text-align:center;font-family:var(--mono);font-size:0.82rem;color:var(--text-muted);">${prefDisplay} ${prefIcon}</td>
        <td style="text-align:center;font-size:0.75rem;">${simBadge}</td>
        <td>${consentBadge}</td>
        <td>${actionButtons(d)}</td>
      </tr>`);

      // Render single "Next in line" sub-row under the removed candidate
      const chain = chainState[slotKey(d)];
      if (chain && chain.candidates.length) {
        const c = chain.candidates[0];
        rows.push(`<tr style="background:rgba(62,207,142,0.04);border-left:2px solid var(--neon-green);">
          <td style="color:var(--neon-green);font-size:0.75rem;text-align:center;">&#8594;</td>
          <td style="font-family:var(--mono);font-size:0.82rem;color:var(--neon-green);">${esc(String(c.applicantId || ''))}</td>
          <td><strong style="color:var(--neon-green);">${esc(c.nameFull || '—')}</strong></td>
          <td style="font-size:0.75rem;color:var(--text-muted)">—</td>
          <td style="font-weight:700;color:var(--neon-green);">${c.marksTotal != null ? Number(c.marksTotal).toFixed(2) : '—'}</td>
          <td style="color:var(--neon-green);font-size:0.78rem;">${esc(program)}</td>
          <td style="font-size:0.75rem;font-family:var(--mono);color:var(--text-muted);">${esc(c._trackLabel || quota)}</td>
          <td style="color:var(--neon-green);font-size:0.78rem;">${esc(specialty)}</td>
          <td style="color:var(--neon-green);font-size:0.78rem;">${esc(hospital)}</td>
          <td style="color:var(--neon-green);font-size:0.78rem;text-align:center;">${c.preferenceNo != null ? c.preferenceNo : '?'}</td>
          <td></td>
          <td><span style="background:rgba(62,207,142,0.1);color:var(--neon-green);padding:2px 8px;border-radius:100px;font-size:0.7rem;">Next in line</span></td>
          <td></td>
        </tr>`);
      }
    }
    tbody.innerHTML = rows.join('');

    if (caption) {
      caption.textContent = `Showing ${filteredData.length} of ${meritData.length.toLocaleString()} entries`;
    }
    if (countEl) {
      countEl.textContent = `${filteredData.length.toLocaleString()} of ${meritData.length.toLocaleString()} entries`;
    }
  }

  function getConsentBadge(val) {
    if (val === 'Accepted') return '<span class="ml-consent-badge accepted"><span class="dot"></span>Accepted</span>';
    if (val === 'Excluded') return '<span class="ml-consent-badge excluded"><span class="dot"></span>Excluded</span>';
    return '<span class="ml-consent-badge awaited"><span class="dot"></span>Awaited</span>';
  }

  function actionButtons(d) {
    const id = String(fval(d, 'applicantId'));
    const key = slotKey(d);
    const chain = chainState[key];
    if (chain && chain.candidates.length) {
      return `<button class="ml-next-inline-btn" data-key="${esc(key)}" style="padding:4px 10px;background:rgba(232,166,39,0.12);color:var(--neon-gold);border:1px solid rgba(232,166,39,0.3);border-radius:6px;cursor:pointer;font-size:0.7rem;">Next in line (${chain.candidates.length})</button>`;
    }
    if (noConsentIds.has(key)) {
      return `<button class="ml-restore-consent-btn" data-key="${esc(key)}" style="padding:4px 10px;background:rgba(62,207,142,0.12);color:var(--neon-green);border:1px solid rgba(62,207,142,0.3);border-radius:6px;cursor:pointer;font-size:0.75rem;">Restore</button>`;
    }
    const raw = consentMap[id] || '';
    if (raw === 'Rejected') {
      return `<button class="ml-override-btn" data-key="${esc(key)}" style="padding:4px 10px;background:rgba(232,166,39,0.12);color:var(--neon-gold);border:1px solid rgba(232,166,39,0.3);border-radius:6px;cursor:pointer;font-size:0.72rem;">Override Excluded</button>`;
    }
    return `<button class="ml-no-consent-btn" data-key="${esc(key)}" style="padding:4px 10px;background:rgba(220,60,60,0.12);color:var(--neon-red);border:1px solid rgba(220,60,60,0.3);border-radius:6px;cursor:pointer;font-size:0.75rem;">Exclude</button>`;
  }

  // ── Event delegation for action buttons ──

  document.addEventListener('click', function (e) {
    const noConsentBtn = e.target.closest('.ml-no-consent-btn, .ml-override-btn');
    if (noConsentBtn) {
      startChain(noConsentBtn.dataset.key);
      return;
    }
    const nextBtn = e.target.closest('.ml-next-inline-btn');
    if (nextBtn) {
      showNextInLineModal(nextBtn.dataset.key);
      return;
    }
    const restoreBtn = e.target.closest('.ml-restore-consent-btn');
    if (restoreBtn) {
      restoreConsent(restoreBtn.dataset.key);
      return;
    }
  });

  function listReplacementCandidates(program, quota, specialty, hospital, excludeSlotKeys) {
    const qLower = (quota || '').toLowerCase();
    const sLower = (specialty || '').toLowerCase();
    const hLower = (hospital || '').toLowerCase();

    // Build a map of each candidate's best placement from merit list
    const placedBestPref = {};
    for (const m of meritData) {
      const aid = String(fval(m, 'applicantId'));
      const mp = fval(m, 'typeName', 'type', 'program');
      const mq = fval(m, 'quotaName', 'quota') || '';
      const ms = fval(m, 'specialityName', 'speciality', 'specialty') || '';
      const mh = fval(m, 'hospitalName', 'hospital') || '';
      // Use preference number from candidates file, not merit data
      const prefNo = prefNoFromCandidate(aid, mp, mq, ms, mh);
      if (prefNo == null) continue;
      if (placedBestPref[aid] == null || prefNo < placedBestPref[aid]) {
        placedBestPref[aid] = prefNo;
      }
    }

    // Track who's already placed in this specific slot
    const placedInSlot = new Set();
    for (const m of meritData) {
      const mp = fval(m, 'typeName', 'type', 'program');
      if (mp !== program) continue;
      const mq = (fval(m, 'quotaName', 'quota') || '').toLowerCase();
      const ms = (fval(m, 'specialityName', 'speciality', 'specialty') || '').toLowerCase();
      const mh = (fval(m, 'hospitalName', 'hospital') || '').toLowerCase();
      if (mq === qLower && ms === sLower && mh === hLower) {
        placedInSlot.add(String(fval(m, 'applicantId')));
      }
    }

    // Build excluded-in-slot set from slot keys
    const excludedInSlot = new Set();
    for (const sk of excludeSlotKeys) {
      const parts = sk.split('::');
      if (parts.length >= 5 && parts[1] === program && parts[2] === (quota || '') && parts[3] === (specialty || '') && parts[4] === (hospital || '')) {
        excludedInSlot.add(parts[0]);
      }
    }

    const candidates = [];
    const skipped = [];
    for (const c of candidatesData) {
      const aid = String(c.applicantId);

      const pref = candidatePreferenceForSlot(c, program, quota, specialty, hospital);
      if (!pref) continue;

      const bonus = prefBonus(c, pref, program);
      const effectiveMarks = (c.marksTotal || 0) + bonus;

      if (excludedInSlot.has(aid)) { skipped.push({ applicantId: c.applicantId, nameFull: c.nameFull || '', marksTotal: effectiveMarks, preferenceNo: pref.preferenceNo, reason: 'Manually excluded from this slot' }); continue; }
      if (placedInSlot.has(aid)) continue;

      // Skip if candidate is already placed at a better preference than their own for this slot
      const bestPref = placedBestPref[aid];
      if (bestPref != null && pref.preferenceNo != null && bestPref < pref.preferenceNo) {
        skipped.push({
          applicantId: c.applicantId, nameFull: c.nameFull || '',
          marksTotal: effectiveMarks, preferenceNo: pref.preferenceNo,
          reason: 'Already placed at preference ' + bestPref + ' (better than ' + pref.preferenceNo + ' for this slot)'
        });
        continue;
      }

      // Skip excluded by consent (cumulative across all rounds)
      if (cumulativeRejected.has(aid)) {
        skipped.push({
          applicantId: c.applicantId, nameFull: c.nameFull || '',
          marksTotal: effectiveMarks, preferenceNo: pref.preferenceNo,
          reason: 'Rejected in consent round'
        });
        continue;
      }

      candidates.push({
        applicantId: c.applicantId,
        nameFull: c.nameFull || '',
        marksTotal: effectiveMarks,
        preferenceNo: pref.preferenceNo,
        _trackLabel: quota || '',
      });
    }

    candidates.sort((a, b) => {
      if (b.marksTotal !== a.marksTotal) return b.marksTotal - a.marksTotal;
      return (a.preferenceNo || 999) - (b.preferenceNo || 999);
    });

    return { candidates, skipped };
  }

  function startChain(slotKeyStr) {
    if (!slotKeyStr) { console.warn('[MeritList] startChain: empty key'); return; }
    const parts = slotKeyStr.split('::');
    const id = parts[0];
    const program = parts[1];
    const q = parts[2] || '';
    const s = parts[3] || '';
    const h = parts[4] || '';

    const entry = meritData.find(d => slotKey(d) === slotKeyStr);
    if (!entry) { console.warn('[MeritList] startChain: entry not found for slot', slotKeyStr); noConsentIds.add(slotKeyStr); updateMeta(); applyFilters(); buildSimMatch(); return; }

    noConsentIds.add(slotKeyStr);
    let result = { candidates: [], skipped: [] };
    try {
      if (program && q && s && h) {
        result = listReplacementCandidates(program, q, s, h, [...noConsentIds]);
      }
    } catch (e) {
      console.warn('[MeritList] Replacement list failed:', e);
    }

    chainState[slotKeyStr] = result;
    updateMeta();
    applyFilters();
    buildSimMatch();
    setStatus(candidates.length
      ? `Removed #${id} from ${program}/${s}. ${candidates.length} candidate(s) in line.`
      : `Removed #${id} from ${program}/${s}. No candidates in line.`, 'var(--neon-red)');
  }

  function nextInLine(slotKeyStr) {
    if (!slotKeyStr) return;
    const chain = chainState[slotKeyStr];
    if (!chain || !chain.candidates.length) return;
    const parts = slotKeyStr.split('::');
    const program = parts[1];
    const q = parts[2] || '';
    const s = parts[3] || '';
    const h = parts[4] || '';
    const next = chain.candidates[0];
    // Add the passed candidate's slot key for this slot
    const nextKey = slotKeyFor(next.applicantId, program, q, s, h);
    noConsentIds.add(nextKey);

    // Refresh the list excluding everyone already marked
    try {
      if (program && q && s && h) {
        const refreshed = listReplacementCandidates(program, q, s, h, [...noConsentIds]);
        chain.candidates = refreshed.candidates;
        chain.skipped = refreshed.skipped;
      }
    } catch (e) {
      console.warn('[MeritList] Refresh failed:', e);
    }

    updateMeta();
    applyFilters();
    buildSimMatch();

    const remaining = chain.candidates.length;
    setStatus(remaining
      ? `Passed ID ${next.applicantId}. ${remaining} candidate(s) still in line.`
      : `Passed ID ${next.applicantId}. End of line.`, 'var(--neon-gold)');
  }

  function restoreConsent(slotKeyStr) {
    if (!slotKeyStr) return;
    const parts = slotKeyStr.split('::');
    const program = parts[1];
    const q = parts[2] || '';
    const s = parts[3] || '';
    const h = parts[4] || '';

    // Remove the slot key and any chain candidates' slot keys for this slot
    noConsentIds.delete(slotKeyStr);
    const chain = chainState[slotKeyStr];
    if (chain) {
      for (const c of chain.candidates) {
        noConsentIds.delete(slotKeyFor(c.applicantId, program, q, s, h));
      }
      delete chainState[slotKeyStr];
    }
    setStatus(`Restored consent for candidate #${parts[0]} in ${program}/${s}.`, 'var(--neon-green)');
    updateMeta();
    applyFilters();
    buildSimMatch();
  }

  // ── Restore ──

  async function restoreInitial() {
    noConsentIds = new Set();
    chainState = {};
    consentMap = JSON.parse(JSON.stringify(initialConsentMap));
    cumulativeRejected = await buildCumulativeRejected(currentRound);
    setStatus('Consent states restored to initial (round ' + currentRound + ').', 'var(--neon-green)');
    updateMeta();
    applyFilters();
    buildSimMatch();
  }

  // ── Auto-init chains for non-consented candidates ──

  function batchAutoChain() {
    const entries = [];
    for (const d of meritData) {
      const key = slotKey(d);
      if (noConsentIds.has(key)) continue;
      const aid = String(fval(d, 'applicantId'));
      // Auto-exclude if rejected in current round display, or rejected cumulatively
      const cv = consentMap[aid];
      if (cv === 'Rejected' || cumulativeRejected.has(aid)) {
        entries.push(d);
      }
    }
    if (!entries.length) return;

    for (const entry of entries) {
      const id = String(fval(entry, 'applicantId'));
      const program = fval(entry, 'typeName', 'type', 'program');
      if (!program) { noConsentIds.add(slotKey(entry)); continue; }
      const q = fval(entry, 'quotaName', 'quota') || '';
      const s = fval(entry, 'specialityName', 'speciality', 'specialty') || '';
      const h = fval(entry, 'hospitalName', 'hospital') || '';
      const key = slotKey(entry);
      noConsentIds.add(key);
      let replacements = [];
      try {
        if (program && q && s && h) {
          const res = listReplacementCandidates(program, q, s, h, [...noConsentIds]);
          replacements = res.candidates;
          chainState[key] = { candidates: replacements, skipped: res.skipped };
        } else {
          chainState[key] = { candidates: replacements, skipped: [] };
        }
      } catch (e) { chainState[key] = { candidates: [], skipped: [] }; }
    }
    updateMeta();
    applyFilters();
    buildSimMatch();
    setStatus(`Auto-resolved ${entries.length} non-consented candidate(s).`, 'var(--neon-gold)');
  }

  // ── Next in Line Modal ──

  function reasonBadge(reason) {
    if (!reason) return '<span style="color:var(--text-muted);font-size:0.72rem;">—</span>';
    if (reason.startsWith('Manually excluded')) return `<span style="display:inline-block;padding:1px 8px;border-radius:10px;background:rgba(255,107,107,0.12);color:var(--neon-pink);font-size:0.7rem;border:1px solid rgba(255,107,107,0.2);">${esc(reason)}</span>`;
    if (reason.startsWith('Already placed at preference')) return `<span style="display:inline-block;padding:1px 8px;border-radius:10px;background:rgba(232,166,39,0.1);color:var(--neon-gold);font-size:0.7rem;border:1px solid rgba(232,166,39,0.2);">${esc(reason)}</span>`;
    if (reason.startsWith('Rejected')) return `<span style="display:inline-block;padding:1px 8px;border-radius:10px;background:rgba(255,107,107,0.08);color:var(--neon-pink);font-size:0.7rem;border:1px solid rgba(255,107,107,0.15);">${esc(reason)}</span>`;
    return `<span style="color:var(--text-muted);font-size:0.7rem;">${esc(reason)}</span>`;
  }

  function showNextInLineModal(slotKeyStr) {
    if (!slotKeyStr) return;
    const chain = chainState[slotKeyStr];
    if (!chain) return;
    const hasCandidates = chain.candidates && chain.candidates.length;
    const hasSkipped = chain.skipped && chain.skipped.length;
    if (!hasCandidates && !hasSkipped) return;

    const parts = slotKeyStr.split('::');
    const id = parts[0];
    const entry = meritData.find(d => slotKey(d) === slotKeyStr);
    const slotInfo = entry
      ? `${esc(fval(entry, 'specialityName', 'speciality', 'specialty') || '?')} at ${esc(fval(entry, 'hospitalName', 'hospital') || '?')}`
      : '?';

    const candRows = (chain.candidates || []).map((c, i) => `
      <tr>
        <td style="font-family:var(--mono);font-size:0.82rem;">${c.applicantId != null ? esc(String(c.applicantId)) : '—'}</td>
        <td><strong>${esc(c.nameFull || '—')}</strong></td>
        <td style="font-weight:700;">${c.marksTotal != null ? Number(c.marksTotal).toFixed(2) : '—'}</td>
        <td>Pref #${c.preferenceNo != null ? c.preferenceNo : '?'}</td>
        <td style="font-size:0.72rem;font-family:var(--mono);color:var(--text-muted);">${esc(c._trackLabel || '')}</td>
        <td>${i === 0
          ? `<button class="ml-modal-pass-btn" data-key="${esc(slotKeyStr)}" style="padding:4px 12px;background:rgba(62,207,142,0.15);color:var(--neon-green);border:1px solid rgba(62,207,142,0.3);border-radius:6px;cursor:pointer;font-size:0.72rem;">Pass</button>`
          : '<span style="color:var(--text-muted);font-size:0.72rem;">—</span>'}</td>
      </tr>`).join('');

    const skippedRows = (chain.skipped || []).map(c => `
      <tr>
        <td style="font-family:var(--mono);font-size:0.82rem;">${c.applicantId != null ? esc(String(c.applicantId)) : '—'}</td>
        <td><strong>${esc(c.nameFull || '—')}</strong></td>
        <td style="font-weight:700;">${c.marksTotal != null ? Number(c.marksTotal).toFixed(2) : '—'}</td>
        <td>${c.preferenceNo != null ? 'Pref #' + c.preferenceNo : '—'}</td>
        <td colspan="2">${reasonBadge(c.reason)}</td>
      </tr>`).join('');

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:12000;backdrop-filter:blur(6px);animation:mlFadeIn 0.2s ease;';
    overlay.innerHTML = `
      <div style="background:rgba(10,17,32,0.98);border:1px solid var(--border);border-top:2px solid var(--neon-cyan);border-radius:16px;padding:1.5rem;width:min(680px,92vw);max-height:86vh;overflow-y:auto;margin:1rem;box-shadow:0 8px 48px rgba(0,0,0,0.8),0 0 50px rgba(77,184,217,0.05);animation:mlSlideUp 0.25s cubic-bezier(0.22,1,0.36,1) both;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:0.5rem;">
          <div>
            <div style="color:var(--neon-cyan);font-size:1.05rem;font-weight:700;">Next in Line</div>
            <div style="font-size:0.78rem;color:var(--text-muted);">For removed candidate #${esc(id)} — ${slotInfo}</div>
          </div>
          <button class="ml-modal-close-btn" style="background:none;border:none;color:var(--text-muted);font-size:1.4rem;cursor:pointer;padding:0 4px;">&times;</button>
        </div>
        ${hasCandidates ? `
        <p style="font-size:0.76rem;color:var(--text-muted);margin:0 0 0.5rem;">${chain.candidates.length} replacement(s) sorted by marks. Click <strong>Pass</strong> to advance the first candidate.</p>
        <div class="table-wrap" style="max-height:30vh;overflow-y:auto;margin-bottom:1rem;">
          <table class="data-table" style="font-size:0.8rem;">
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Marks</th>
                <th>Preference</th>
                <th>Track</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>${candRows}</tbody>
          </table>
        </div>` : `<p style="font-size:0.76rem;color:var(--text-muted);margin:0 0 1rem;">No valid replacement candidates available.</p>`}
        ${hasSkipped ? `
        <div style="border-top:1px solid rgba(255,255,255,0.06);padding-top:0.75rem;">
          <div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:0.4rem;font-weight:600;">${chain.skipped.length} candidate(s) considered but excluded:</div>
          <div class="table-wrap" style="max-height:24vh;overflow-y:auto;">
            <table class="data-table" style="font-size:0.75rem;">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name</th>
                  <th>Marks</th>
                  <th>Pref</th>
                  <th colspan="2">Reason</th>
                </tr>
              </thead>
              <tbody>${skippedRows}</tbody>
            </table>
          </div>
        </div>` : ''}
        <div style="display:flex;gap:0.75rem;margin-top:1rem;">
          <button class="ml-modal-close-btn" style="flex:1;padding:0.6rem;border:1px solid var(--border);border-radius:8px;background:transparent;color:var(--text-muted);cursor:pointer;font-size:0.84rem;">Close</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    const closeModal = () => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); };
    overlay.querySelectorAll('.ml-modal-close-btn').forEach(btn => btn.addEventListener('click', closeModal));
    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

    const passBtn = overlay.querySelector('.ml-modal-pass-btn');
    if (passBtn) {
      passBtn.addEventListener('click', () => {
        closeModal();
        nextInLine(passBtn.dataset.key);
      });
    }
  }

  // ── Start ──
  // Inject modal animations
  if (!document.getElementById('mlSimAnimStyle')) {
    const st = document.createElement('style');
    st.id = 'mlSimAnimStyle';
    st.textContent = `
      @keyframes mlFadeIn { from { opacity:0; } to { opacity:1; } }
      @keyframes mlSlideUp { from { opacity:0; transform:translateY(24px) scale(0.96); } to { opacity:1; transform:translateY(0) scale(1); } }
    `;
    document.head.appendChild(st);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
