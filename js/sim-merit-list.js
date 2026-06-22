'use strict';

/**
 * Merit List Mode — replaces the Seat Allocation tab with a published
 * merit list view. Loads data from:
 *   - data/induction21_merit.json           (flat array of merit entries, each with rank, placement, marks)
 *   - data/induction21_consent_round1.json  (consent statuses keyed by applicantId)
 *   - data/induction21_seats.json           (seat inventory for meta)
 *
 * Controlled by the admin toggle at notifications/simulation_mode.
 * Round number is inferred from the consent filename (e.g., round_N).
 */

(function () {

  let db;
  let merritListActive = false;
  let meritData = [];            // flat array from induction21_merit.json
  let filteredData = [];         // current filtered/sorted subset
  let consentMap = {};           // {applicantId: 'Accepted'|'Rejected'|'Pending'|...}
  let initialConsentMap = {};    // snapshot for restore
  let noConsentIds = new Set();  // locally overridden as no-consent
  let chainState = {};          // { [removedId]: { candidates: [...] } }
  let seatsData = null;
  let currentRound = 1;

  // Change this filename to load a different consent round
  const CONSENT_FILE = 'data/induction21_consent_round1.json';

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

  function labelFor(val) {
    if (val === 'Accepted' || val === '1') return 'Accepted';
    if (val === 'Rejected' || val === '2') return 'Rejected';
    if (val === 'Not Avail') return 'Not Avail';
    return 'Pending';
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

    const roundMatch = CONSENT_FILE.match(/consent_round(\d+)/i);
    currentRound = roundMatch ? parseInt(roundMatch[1], 10) : 1;

    $tabContent.innerHTML = `
      <div class="section-header">
        <h2>Merit List — Round ${currentRound}</h2>
        <p>Published merit placements for Induction 21. Data from <code>induction21_merit.json</code>.</p>
      </div>
      <div style="text-align:center;padding:3rem;color:var(--text-muted);">Loading merit data&hellip;</div>`;

    try {
      const [meritRes, consentRes, seatsRes] = await Promise.all([
        fetch('data/induction21_merit.json', { cache: 'no-store' }),
        fetch(CONSENT_FILE, { cache: 'no-store' }),
        fetch('data/induction21_seats.json', { cache: 'no-store' }),
      ]);

      if (!meritRes.ok) throw new Error('Failed to load merit list: HTTP ' + meritRes.status);

      const raw = await meritRes.json();
      // Accept either a flat array or { Table5: [...] } shape (legacy round_*.json)
      meritData = Array.isArray(raw) ? raw : (raw.Table5 || []);

      if (consentRes.ok) {
        consentMap = await consentRes.json();
      } else {
        consentMap = {};
      }
      initialConsentMap = JSON.parse(JSON.stringify(consentMap));

      if (seatsRes.ok) {
        seatsData = await seatsRes.json();
      }

      noConsentIds = new Set();
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
              <th>Specialty</th>
              <th>Hospital</th>
              <th>Consent</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="mlBody">
            <tr><td colspan="10" style="text-align:center;padding:2rem;color:var(--text-muted);">Loading&hellip;</td></tr>
          </tbody>
        </table>
      </div>
      <p id="mlCaption" class="table-caption"></p>`;

    document.getElementById('mlProgram')?.addEventListener('change', applyFilters);
    document.getElementById('mlSpecialty')?.addEventListener('change', applyFilters);
    document.getElementById('mlHospital')?.addEventListener('change', applyFilters);
    document.getElementById('mlQuota')?.addEventListener('change', applyFilters);
    document.getElementById('mlSearch')?.addEventListener('input', applyFilters);
    document.getElementById('mlRestoreBtn')?.addEventListener('click', restoreInitial);

    updateMeta();
    applyFilters();
  }

  // ── Meta ──

  function updateMeta() {
    const metaEl = document.getElementById('meritListMeta');
    if (!metaEl) return;

    let consented = 0, notConsented = 0, pending = 0;
    for (const entry of meritData) {
      const applicantId = fval(entry, 'applicantId');
      if (noConsentIds.has(applicantId)) { notConsented++; continue; }
      const c = consentMap[applicantId] || entry.consent || '';
      if (c === 'Accepted' || c === '1') consented++;
      else if (c === 'Rejected' || c === '2' || c === 'Not Avail') notConsented++;
      else pending++;
    }

    metaEl.innerHTML = `
      <div class="cur-meta-grid">
        <div><span class="cur-meta-lbl">Round</span><span class="cur-meta-val">${currentRound}</span></div>
        <div><span class="cur-meta-lbl">Total</span><span class="cur-meta-val">${meritData.length.toLocaleString()}</span></div>
        <div><span class="cur-meta-lbl" style="color:var(--neon-green);">Consented</span><span class="cur-meta-val">${consented.toLocaleString()}</span></div>
        <div><span class="cur-meta-lbl" style="color:var(--neon-red);">Not Consented</span><span class="cur-meta-val">${notConsented.toLocaleString()}</span></div>
        <div><span class="cur-meta-lbl" style="color:var(--neon-gold);">Pending</span><span class="cur-meta-val">${pending.toLocaleString()}</span></div>
        <div><span class="cur-meta-lbl" style="color:var(--neon-pink);">Marked No-Consent</span><span class="cur-meta-val">${noConsentIds.size}</span></div>
        ${seatsData ? `<div><span class="cur-meta-lbl">Seats</span><span class="cur-meta-val">${seatsData.length} slots</span></div>` : ''}
      </div>`;
  }

  // ── Filters ──

  function applyFilters() {
    const prog = (document.getElementById('mlProgram')?.value || '').toLowerCase();
    const spec = (document.getElementById('mlSpecialty')?.value || '').toLowerCase();
    const hosp = (document.getElementById('mlHospital')?.value || '').toLowerCase();
    const quota = (document.getElementById('mlQuota')?.value || '').toLowerCase();
    const search = (document.getElementById('mlSearch')?.value || '').toLowerCase().trim();

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
      tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:2rem;color:var(--text-muted);">No entries match filters.</td></tr>';
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
      const specialty = fval(d, 'specialityName', 'speciality', 'specialty') || '—';
      const hospital = fval(d, 'hospitalName', 'hospital') || '—';

      const isNoConsent = noConsentIds.has(applicantId);
      const consentVal = isNoConsent ? 'No Consent'
        : (consentMap[applicantId] || fval(d, 'consent') || 'Pending');
      const consentBadge = getConsentBadge(consentVal, isNoConsent);

      const rowStyle = isNoConsent ? ' style="opacity:0.5;text-decoration:line-through;"' : '';

      rows.push(`<tr${rowStyle}>
        <td>${rank != null ? rank : '—'}</td>
        <td style="font-family:var(--mono);font-size:0.82rem;">${esc(String(applicantId || ''))}</td>
        <td><strong>${esc(name)}</strong></td>
        <td style="font-family:var(--mono);font-size:0.82rem;">${esc(pmdc)}</td>
        <td style="font-weight:700;">${marksStr}</td>
        <td>${esc(program)}</td>
        <td style="font-size:0.8rem;">${esc(specialty)}</td>
        <td style="font-size:0.8rem;">${esc(hospital)}</td>
        <td>${consentBadge}</td>
        <td>${actionButtons(applicantId)}</td>
      </tr>`);

      // Render single "Next in line" sub-row under the removed candidate
      const chain = chainState[String(applicantId)];
      if (chain && chain.candidates.length) {
        const c = chain.candidates[0];
        rows.push(`<tr style="background:rgba(62,207,142,0.04);border-left:2px solid var(--neon-green);">
          <td style="color:var(--neon-green);font-size:0.75rem;text-align:center;">&#8594;</td>
          <td style="font-family:var(--mono);font-size:0.82rem;color:var(--neon-green);">${esc(String(c.applicantId || ''))}</td>
          <td><strong style="color:var(--neon-green);">${esc(c.nameFull || '—')}</strong></td>
          <td style="font-size:0.75rem;color:var(--text-muted)">—</td>
          <td style="font-weight:700;color:var(--neon-green);">${c.marksTotal != null ? Number(c.marksTotal).toFixed(2) : '—'}</td>
          <td style="color:var(--neon-green);font-size:0.78rem;">—</td>
          <td style="color:var(--neon-green);font-size:0.78rem;">—</td>
          <td style="color:var(--neon-green);font-size:0.78rem;">Pref #${c.preferenceNo || '?'}</td>
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

  function getConsentBadge(val, isNoConsent) {
    if (isNoConsent) {
      return '<span style="background:rgba(220,60,60,0.15);color:var(--neon-red);padding:2px 8px;border-radius:100px;font-size:0.75rem;">No Consent</span>';
    }
    if (val === 'Accepted' || val === '1') {
      return '<span style="background:rgba(62,207,142,0.12);color:var(--neon-green);padding:2px 8px;border-radius:100px;font-size:0.75rem;">Accepted</span>';
    }
    if (val === 'Rejected' || val === '2') {
      return '<span style="background:rgba(220,60,60,0.12);color:var(--neon-red);padding:2px 8px;border-radius:100px;font-size:0.75rem;">Rejected</span>';
    }
    if (val === 'Not Avail') {
      return '<span style="background:rgba(232,166,39,0.12);color:var(--neon-gold);padding:2px 8px;border-radius:100px;font-size:0.75rem;">Not Avail</span>';
    }
    return '<span style="background:rgba(245,200,66,0.08);color:#f5c842;padding:2px 8px;border-radius:100px;font-size:0.75rem;">Pending</span>';
  }

  function actionButtons(applicantId) {
    const id = String(applicantId);
    const chain = chainState[id];
    if (chain && chain.candidates.length) {
      return `<button class="ml-next-inline-btn" data-id="${applicantId}" style="padding:4px 10px;background:rgba(232,166,39,0.12);color:var(--neon-gold);border:1px solid rgba(232,166,39,0.3);border-radius:6px;cursor:pointer;font-size:0.7rem;">Next in line (${chain.candidates.length})</button>`;
    }
    if (noConsentIds.has(applicantId)) {
      return `<button class="ml-restore-consent-btn" data-id="${applicantId}" style="padding:4px 10px;background:rgba(62,207,142,0.12);color:var(--neon-green);border:1px solid rgba(62,207,142,0.3);border-radius:6px;cursor:pointer;font-size:0.75rem;">Restore Consent</button>`;
    }
    return `<button class="ml-no-consent-btn" data-id="${applicantId}" style="padding:4px 10px;background:rgba(220,60,60,0.12);color:var(--neon-red);border:1px solid rgba(220,60,60,0.3);border-radius:6px;cursor:pointer;font-size:0.75rem;">Mark No Consent</button>`;
  }

  // ── Event delegation for action buttons ──

  document.addEventListener('click', function (e) {
    const noConsentBtn = e.target.closest('.ml-no-consent-btn');
    if (noConsentBtn) {
      const id = parseInt(noConsentBtn.dataset.id, 10);
      startChain(id);
      return;
    }
    const nextBtn = e.target.closest('.ml-next-inline-btn');
    if (nextBtn) {
      const id = parseInt(nextBtn.dataset.id, 10);
      nextInLine(id);
      return;
    }
    const restoreBtn = e.target.closest('.ml-restore-consent-btn');
    if (restoreBtn) {
      const id = parseInt(restoreBtn.dataset.id, 10);
      restoreConsent(id);
      return;
    }
  });

  function listReplacementCandidates(program, quota, specialty, hospital, excludeIds) {
    const exclude = new Set([...excludeIds].map(String));
    const placedIn = {};
    for (const m of meritData) {
      if (fval(m, 'typeName', 'type', 'program') !== program) continue;
      const aid = String(fval(m, 'applicantId'));
      placedIn[aid] = {
        preferenceNo: fval(m, 'preferenceNo'),
        specialityName: fval(m, 'specialityName', 'speciality', 'specialty'),
        hospitalName: fval(m, 'hospitalName', 'hospital'),
      };
    }

    const pool = typeof allCandidates === 'function'
      ? allCandidates().filter(c => effectiveMark(c, program) != null)
      : [];

    const candidates = [];
    for (const c of pool) {
      const aid = String(c.applicantId);
      if (exclude.has(aid)) continue;

      const prefs = c.preference?.[program] || [];
      const match = prefs.find(p =>
        p.quotaName === quota && p.specialityName === specialty && p.hospitalName === hospital
      );
      if (!match) continue;

      const placed = placedIn[aid];

      // Respect round consent: if a placed candidate lacks a consent entry
      // in the current round's file, they were dropped from the active pool.
      // Also skip explicitly rejected / not-avail candidates.
      const consentVal = consentMap[aid];
      if (placed && !consentVal) continue;
      if (consentVal === 'Rejected' || consentVal === 'Not Avail') continue;

      if (placed) {
        if (placed.preferenceNo != null && placed.preferenceNo < match.preferenceNo) continue;
        if (placed.specialityName === specialty && placed.hospitalName === hospital) continue;
      }

      candidates.push({
        applicantId: c.applicantId,
        nameFull: c.nameFull || '',
        marksTotal: effectiveMark(c, program, undefined, undefined, match),
        preferenceNo: match.preferenceNo,
        _trackLabel: typeof quotaTrackLabel === 'function' ? quotaTrackLabel(quotaTrack(match.quotaName)) : '',
      });
    }

    candidates.sort((a, b) => b.marksTotal - a.marksTotal);
    return candidates;
  }

  function startChain(applicantId) {
    const id = String(applicantId || '').trim();
    if (!id) { console.warn('[MeritList] startChain: empty id'); return; }

    const entry = meritData.find(d => String(fval(d, 'applicantId')) === id);
    if (!entry) { console.warn('[MeritList] startChain: entry not found for', id); noConsentIds.add(applicantId); updateMeta(); applyFilters(); return; }

    const program = fval(entry, 'typeName', 'type', 'program');
    const q = fval(entry, 'quotaName', 'quota') || '';
    const s = fval(entry, 'specialityName', 'speciality', 'specialty') || '';
    const h = fval(entry, 'hospitalName', 'hospital') || '';

    noConsentIds.add(applicantId);
    let candidates = [];
    try {
      if (program && q && s && h) {
        candidates = listReplacementCandidates(program, q, s, h, [...noConsentIds]);
      }
    } catch (e) {
      console.warn('[MeritList] Replacement list failed:', e);
    }

    chainState[id] = { candidates };
    updateMeta();
    applyFilters();
    setStatus(candidates.length
      ? `Removed #${id}. ${candidates.length} candidate(s) in line.`
      : `Removed #${id}. No candidates in line.`, 'var(--neon-red)');
  }

  function nextInLine(removedId) {
    const id = String(removedId || '').trim();
    const chain = chainState[id];
    if (!chain || !chain.candidates.length) return;

    const next = chain.candidates[0];
    noConsentIds.add(next.applicantId);

    // Refresh the list excluding everyone already marked
    const entry = meritData.find(d => String(fval(d, 'applicantId')) === id);
    if (entry) {
      const program = fval(entry, 'typeName', 'type', 'program');
      const q = fval(entry, 'quotaName', 'quota') || '';
      const s = fval(entry, 'specialityName', 'speciality', 'specialty') || '';
      const h = fval(entry, 'hospitalName', 'hospital') || '';
      try {
        chain.candidates = listReplacementCandidates(program, q, s, h, [...noConsentIds]);
      } catch (e) {
        console.warn('[MeritList] Refresh failed:', e);
      }
    }

    updateMeta();
    applyFilters();

    const remaining = chain.candidates.length;
    setStatus(remaining
      ? `Passed ID ${next.applicantId}. ${remaining} candidate(s) still in line.`
      : `Passed ID ${next.applicantId}. End of line.`, 'var(--neon-gold)');
  }

  function restoreConsent(applicantId) {
    const id = String(applicantId);
    // Remove the candidate and anyone in its chain from noConsentIds
    noConsentIds.delete(applicantId);
    const chain = chainState[id];
    if (chain) {
      for (const c of chain.candidates) {
        noConsentIds.delete(c.applicantId);
      }
      delete chainState[id];
    }
    setStatus(`Restored consent for candidate #${applicantId}.`, 'var(--neon-green)');
    updateMeta();
    applyFilters();
  }

  // ── Restore ──

  function restoreInitial() {
    noConsentIds = new Set();
    chainState = {};
    consentMap = JSON.parse(JSON.stringify(initialConsentMap));
    setStatus('Consent states restored to initial.', 'var(--neon-green)');
    updateMeta();
    applyFilters();
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
