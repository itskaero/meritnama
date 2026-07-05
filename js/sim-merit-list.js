'use strict';

/**
 * Merit List Mode — replaces the Seat Allocation tab with a published
 * merit list view. Loads data from:
 *   - data/induction21_merit.json           (flat array of merit entries)
 *   - data/induction21_consent_round{N}.json (RAW PRP API Table5 array —
 *        each row has { applicantId, program, quota, preferenceNo, status,
 *        infoTitle: '<program> - <quota> - <speciality> - <institute> - <hospital>' }
 *        The frontend parses infoTitle in memory to derive:
 *          consentBySlot        { slotKey: 'Accepted'|'Rejected'|'Dropped'|'Awaited' }
 *          cumulativeRejected   Set<aid>
 *          cumulativeDroppedByProgram  Set<'aid::program'>
 *        No separate flat/_byslot files are required — one file per round.
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
  // Per-merit-row consent resolution, derived in-memory from
  // induction21_consent_round{N}.json (the raw PRP API array).
  // {slotKey: 'Accepted'|'Rejected'|'Dropped'|'Awaited'}
  let consentBySlot = {};
  let cumulativeRejected = new Set();        // Set<aid> rejected in ANY round up to current
  let cumulativeDroppedByProgram = new Set(); // Set<'aid::program'> consented-away-from-this-programme OR rejected, in/by ANY round up to current
  let noConsentIds = new Set();              // locally overridden as no-consent
  let globallyPlacedAids = new Set();        // aids that have been 'placed' as next-in-line for any slot — excludes them from all other replacement lists (like simulation pass logic)
  let chainState = {};                       // { [removedId]: { candidates: [...] } }
  let mlExcludeMode = false;                 // toggle: true click excludes, false click opens info modal
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
  let showSimMatch = false;      // toggled via Firestore notifications/sim_match_config.enabled

  function consentFile() {
    return 'data/induction21_consent_round' + currentRound + '.json';
  }

  // ── Raw consent parsing (replaces the old build_merit_consent_map.py) ──
  //
  // The file is now the raw PRP API Table5 array. We parse each row's
  // `infoTitle` (5 dash-separated parts: program / quota / speciality /
  // institute / hospital) and build the same per-slot resolution the
  // standalone Python script used to produce.
  //
  // Resolution priority for a merit row (aid, program, quota, spec, hosp):
  //   1. Exact slot match in raw  → use that row's status
  //   2. Same-program row exists  → fallback (prefer Accepted > Rejected > Awaited)
  //   3. Other-program rows exist → "Dropped" (consented to another programme)
  //   4. No rows for the applicant → "Awaited"

  function norm(s) {
    if (s == null) return '';
    return String(s).replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function canonicalLabel(raw) {
    if (raw === 'Accepted') return 'Accepted';
    if (raw === 'Rejected') return 'Rejected';
    return 'Awaited';
  }

  function parseInfoTitle(infoTitle, fallbackProgram) {
    const parts = String(infoTitle || '').split(' - ');
    while (parts.length < 5) parts.push('');
    const program = (parts[0] || '').trim() || fallbackProgram || '';
    const quota = (parts[1] || '').trim();
    const speciality = (parts[2] || '').trim();
    const hospital = (parts[4] || '').trim();
    return [program, quota, speciality, hospital];
  }

  // Build an index from one round's raw array.
  // Returns { exact, byAidProgramQuota, aidPrograms, rejectedAids, acceptedAids }
  //   exact: Map<normKey, 'Accepted'|'Rejected'|'Awaited'>
  //   byAidProgramQuota: Map<'aid\x00program\x00quota', Set<status>>
  //   aidPrograms: Map<aid, Set<program>>
  //   rejectedAids: Set<aid>  (any row for this aid with status 'Rejected')
  //   acceptedAids: Set<aid>  (any row for this aid with status 'Accepted')
  function parseConsentRaw(rawRows) {
    const exact = new Map();
    const byAidProgramQuota = new Map();
    const aidPrograms = new Map();
    const rejectedAids = new Set();
    const acceptedAids = new Set();
    if (!Array.isArray(rawRows)) return { exact, byAidProgramQuota, aidPrograms, rejectedAids, acceptedAids };

    for (const row of rawRows) {
      const aidRaw = row.applicantId ?? row.applicantID;
      if (aidRaw == null) continue;
      const aid = String(aidRaw);
      const [program, quota, speciality, hospital] = parseInfoTitle(row.infoTitle, row.program);
      if (!program) continue;
      const label = canonicalLabel(row.status);

      const key = [aid, norm(program), norm(quota), norm(speciality), norm(hospital)].join('\x00');
      exact.set(key, label);

      const ppqKey = aid + '\x00' + norm(program) + '\x00' + norm(quota);
      if (!byAidProgramQuota.has(ppqKey)) byAidProgramQuota.set(ppqKey, new Set());
      byAidProgramQuota.get(ppqKey).add(label);

      if (!aidPrograms.has(aid)) aidPrograms.set(aid, new Set());
      aidPrograms.get(aid).add(norm(program));

      if (label === 'Rejected') rejectedAids.add(aid);
      if (label === 'Accepted') acceptedAids.add(aid);
    }
    return { exact, byAidProgramQuota, aidPrograms, rejectedAids, acceptedAids };
  }

  // Resolve a single merit row's consent status against a parsed index.
  //
  // Rules:
  //   1. Exact slot match → use that status (Accepted/Rejected/Awaited).
  //   2. If candidate Accepted any DIFFERENT slot (same or other program) →
  //      Dropped. Candidates with multiple merit entries can only hold one
  //      seat; consenting to one drops them from all other slots.
  //   3. Same-track fallback: Rejected within (program, quota) → Rejected.
  //   4. Cross-program: candidate has consent rows only for OTHER programs
  //      → Dropped.
  //   5. No matching consent data → Awaited.
  function resolveMeritRow(entry, parsed) {
    const aid = String(entry.applicantId ?? entry.applicantID ?? '');
    if (!aid) return 'Awaited';
    const program = entry.typeName || entry.type || entry.program || '';
    const quota = entry.quotaName || entry.quota || '';
    const speciality = entry.specialityName || entry.speciality || entry.specialty || '';
    const hospital = entry.hospitalName || entry.hospital || '';

    const nProgram = norm(program);
    const nQuota = norm(quota);
    const nSpec = norm(speciality);
    const nHosp = norm(hospital);
    const exactKey = [aid, nProgram, nQuota, nSpec, nHosp].join('\x00');

    // 1. Exact slot match
    if (parsed.exact.has(exactKey)) return parsed.exact.get(exactKey);

    // 2. Candidate Accepted a DIFFERENT slot → Dropped from this one.
    //    Consenting to one seat (same or different program/track) drops
    //    them from all other merit entries they hold.
    if (parsed.acceptedAids.has(aid)) return 'Dropped';

    // 3. Same-track fallback: Rejected within (program, quota) → Rejected
    const ppqKey = aid + '\x00' + nProgram + '\x00' + nQuota;
    const sameTrackLabels = parsed.byAidProgramQuota.get(ppqKey);
    if (sameTrackLabels && sameTrackLabels.has('Rejected')) return 'Rejected';

    // 4. Cross-program: candidate has consent rows only for OTHER programs
    const progs = parsed.aidPrograms.get(aid);
    if (progs && progs.size && !progs.has(nProgram)) return 'Dropped';

    // 5. No matching consent data → Awaited
    return 'Awaited';
  }

  // Build { slotKey: status } for ALL merit rows from a parsed index.
  function buildConsentBySlot(parsed) {
    const bySlot = {};
    for (const entry of meritData) {
      const key = slotKey(entry);
      bySlot[key] = resolveMeritRow(entry, parsed);
    }
    return bySlot;
  }

  // Aggregate per-round parsing → cumulative sets across rounds 1..upToRound.
  // Returns { rejected, droppedByProgram, perRoundParsed }
  async function buildCumulativeConsentSets(upToRound) {
    const rejected = new Set();
    const droppedByProgram = new Set();
    const perRoundParsed = {};
    for (let r = 1; r <= upToRound; r++) {
      try {
        const res = await fetch('data/induction21_consent_round' + r + '.json', { cache: 'no-store' });
        if (!res.ok) continue;
        const rows = await res.json();
        const parsed = parseConsentRaw(rows);
        perRoundParsed[r] = parsed;
        // Rejected anywhere → cumulative rejected (applicant-level)
        for (const aid of parsed.rejectedAids) rejected.add(aid);
        // Per-merit-row Dropped / Rejected → cumulative Dropped-by-programme
        // (meritData is the current round's merit list, but merit rows are
        // stable across consent rounds — the same published slot exists in
        // every round until/unless someone is replaced, so iterating it
        // once per round captures each round's per-slot exclusion verdict.)
        for (const entry of meritData) {
          const status = resolveMeritRow(entry, parsed);
          if (status !== 'Dropped' && status !== 'Rejected') continue;
          const aid = String(entry.applicantId ?? entry.applicantID ?? '');
          const program = entry.typeName || entry.type || entry.program || '';
          if (!aid || !program) continue;
          droppedByProgram.add(aid + '::' + program);
        }
      } catch (_) { /* skip missing rounds */ }
    }
    return { rejected, droppedByProgram, perRoundParsed };
  }

  let $tabContent, $tabBtn;

  // —”€—”€ Helpers —”€—”€

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

  // —”€—”€ Init —”€—”€

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

    db.collection('notifications').doc('sim_match_config').onSnapshot(snap => {
      const enabled = snap.exists ? snap.data().enabled === true : false;
      if (enabled !== showSimMatch) {
        showSimMatch = enabled;
        if (merritListActive && meritData.length) {
          if (showSimMatch) {
            autoRunSimulations();
          }
          renderMeritGrid();
          updateMeta();
        }
      }
    }, err => {
      console.warn('[MeritList] sim_match_config Firestore error, defaulting to off');
      if (showSimMatch) {
        showSimMatch = false;
        if (merritListActive && meritData.length) {
          renderMeritGrid();
          updateMeta();
        }
      }
    });
  }

  async function reloadConsentData() {
    try {
      const res = await fetch(consentFile(), { cache: 'no-store' });
      let rawRows = [];
      if (res.ok) {
        rawRows = await res.json();
        if (!Array.isArray(rawRows)) rawRows = [];
        const consentDate = res.headers.get('Last-Modified');
        if (consentDate) consentFileUpdatedAt = consentDate;
      }
      // Parse the raw PRP API array → per-slot map for the current round.
      const parsed = parseConsentRaw(rawRows);
      consentBySlot = buildConsentBySlot(parsed);
      // Build cumulative sets across rounds 1..currentRound.
      const cumulative = await buildCumulativeConsentSets(currentRound);
      cumulativeRejected = cumulative.rejected;
      cumulativeDroppedByProgram = cumulative.droppedByProgram;
      noConsentIds = new Set();
      chainState = {};
      updateMeta();
      applyFilters();
      setStatus('Switched to round ' + currentRound + '.', 'var(--neon-gold)');
      applyMeritListTabSwap();
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

  // —”€—”€ Load —”€—”€

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

      // Parse the raw PRP API array → per-slot map for the current round.
      let consentRawRows = [];
      if (consentRes.ok) {
        consentRawRows = await consentRes.json();
        if (!Array.isArray(consentRawRows)) consentRawRows = [];
        const consentDate = consentRes.headers.get('Last-Modified');
        if (consentDate) consentFileUpdatedAt = consentDate;
      }
      const parsed = parseConsentRaw(consentRawRows);
      consentBySlot = buildConsentBySlot(parsed);
      // Build cumulative sets across rounds 1..currentRound.
      const cumulative = await buildCumulativeConsentSets(currentRound);
      cumulativeRejected = cumulative.rejected;
      cumulativeDroppedByProgram = cumulative.droppedByProgram;

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

      // Load disciplineFullData for specialityId —†” name mapping (portal-sourced)
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
      applyMeritListTabSwap();
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

  // —”€—”€ Render UI —”€—”€

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
        /* ── state pill ── */
        .ml-state-pill { display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:100px;font-size:0.65rem;font-weight:700;letter-spacing:0.01em;white-space:nowrap; }
        .ml-pill-accepted { background:rgba(62,207,142,0.12);color:var(--neon-green); }
        .ml-pill-excluded { background:rgba(220,60,60,0.10);color:var(--neon-red); }
        .ml-pill-dropped  { background:rgba(220,60,60,0.10);color:var(--neon-pink); }
        .ml-pill-awaiting { background:rgba(232,166,39,0.10);color:var(--neon-gold); }

        /* ── row state bar (left border) ── */
        .ml-state-bar { display:inline-block;width:3px;height:24px;border-radius:2px;flex-shrink:0; }
        .ml-row-accepted .ml-state-bar { background:var(--neon-green); }
        .ml-row-excluded .ml-state-bar { background:var(--neon-red); }
        .ml-row-dropped  .ml-state-bar { background:var(--neon-pink); }
        .ml-row-awaiting .ml-state-bar { background:var(--neon-gold); }

        /* ── row container ── */
        #mlGrid .sim-row { display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;padding:6px 10px;border-radius:6px;cursor:pointer;transition:background 0.12s, opacity 0.15s; }
        #mlGrid .sim-row:hover { background:rgba(77,184,217,0.08); }
        /* selective dimming — no row-level opacity, only de-emphasize state elements */
        #mlGrid .ml-row-excluded, #mlGrid .ml-row-dropped { opacity:1;background:rgba(220,60,60,0.03);pointer-events:none; }
        #mlGrid .ml-row-excluded:hover, #mlGrid .ml-row-dropped:hover { background:rgba(220,60,60,0.06) !important; }
        #mlGrid .ml-row-excluded .ml-state-pill, #mlGrid .ml-row-dropped .ml-state-pill { opacity:0.35; }
        #mlGrid .ml-row-excluded .ml-state-bar, #mlGrid .ml-row-dropped .ml-state-bar { opacity:0.45; }
        #mlGrid .ml-row-excluded .sim-row-name, #mlGrid .ml-row-dropped .sim-row-name,
        #mlGrid .ml-row-excluded .sim-row-marks, #mlGrid .ml-row-dropped .sim-row-marks,
        #mlGrid .ml-row-excluded .ml-row-id, #mlGrid .ml-row-dropped .ml-row-id,
        #mlGrid .ml-row-excluded .ml-row-pref, #mlGrid .ml-row-dropped .ml-row-pref,
        #mlGrid .ml-row-excluded .ml-chain-badge, #mlGrid .ml-row-dropped .ml-chain-badge { opacity:0.85; }
        #mlGrid .sim-row .sim-row-name { flex:1 1 80px;font-size:0.82rem;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
        #mlGrid .sim-row .sim-row-marks { font-weight:700;min-width:48px;text-align:right;font-family:var(--mono);font-size:0.82rem; }
        .ml-row-id { font-family:var(--mono);font-size:0.78rem;min-width:52px;color:var(--text-muted); }
        .ml-row-pref  { color:var(--text-muted);font-size:0.78rem;min-width:36px;font-family:var(--mono);text-align:center; }
        .ml-pref-ok   { color:var(--neon-green);margin-left:2px;font-weight:700;font-size:0.85rem; }
        .ml-sim-dot   { margin:0 2px; }

        /* ── chain badge ── */
        .ml-chain-badge { font-size:0.64rem;color:var(--neon-gold);background:rgba(232,166,39,0.08);padding:2px 6px;border-radius:100px;white-space:nowrap; }

        /* ── Chain row (sibling after .sim-row, full opacity) ── */
        .ml-chain-row { display:flex;align-items:stretch;gap:0;margin:-2px 0 0 0;padding:0 0 2px 0;cursor:pointer; }
        .ml-chain-row:hover .ml-next-candidate { background:rgba(62,207,142,0.08); }
        .ml-chain-connector { width:3px;flex-shrink:0;background:linear-gradient(to bottom,var(--neon-gold),var(--neon-green));border-radius:2px;margin:0 14px 0 10px; }
        .ml-chain-row .ml-next-candidate { flex:1;padding:6px 10px;border-radius:6px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;transition:background 0.12s; }
        .ml-chain-row .ml-next-candidate .sim-next-name { color:var(--neon-green);font-weight:600;font-size:0.8rem; }
        .ml-chain-row .ml-next-candidate .sim-next-marks { color:var(--neon-green);font-weight:700;font-size:0.8rem; }
        .ml-chain-row .ml-next-candidate .sim-row-pref { color:var(--neon-green);font-size:0.78rem; }
        .ml-chain-row .ml-next-candidate .sim-next-lbl { color:var(--text-muted);font-size:0.7rem; }

        /* ── card status bar ── */
        .ml-card-status { padding:4px 14px;font-size:0.68rem;font-weight:600;letter-spacing:0.01em;margin-bottom:2px; }
        .ml-card-status-full { color:var(--neon-green);background:rgba(62,207,142,0.06);border-bottom:1px solid rgba(62,207,142,0.08); }
        .ml-card-status-ok { color:var(--neon-gold);background:rgba(232,166,39,0.06);border-bottom:1px solid rgba(232,166,39,0.10); }
        .ml-card-status-warn { color:var(--neon-pink);background:rgba(220,60,60,0.06);border-bottom:1px solid rgba(220,60,60,0.10); }

        /* ── card states ── */
        #mlGrid .sim-card { transition:border-color 0.15s,box-shadow 0.15s; }
        #mlGrid .ml-card-attn { border-color:rgba(62,207,142,0.25);box-shadow:0 0 12px rgba(62,207,142,0.06); }
        #mlGrid .ml-card-ok   { border-color:rgba(255,255,255,0.06); }

        /* ── exclude mode glow ── */
        #mlGrid.ml-excluding .sim-row:not(.ml-row-accepted):hover { background:rgba(220,60,60,0.10) !important;box-shadow:inset 0 0 0 1px rgba(220,60,60,0.25); }
        #mlGrid .sim-row { position:relative; }
        #mlGrid .sim-row::after { content:'click for info';position:absolute;right:10px;bottom:2px;font-size:0.55rem;color:var(--text-muted);opacity:0;transition:opacity 0.12s;pointer-events:none; }
        #mlGrid .sim-row:hover::after { opacity:0.5; }
        #mlGrid .ml-row-excluded::after, #mlGrid .ml-row-dropped::after { display:none; }
        #mlGrid.ml-excluding .sim-row:not(.ml-row-accepted):not(.ml-row-excluded):not(.ml-row-dropped)::after { content:'click to exclude';color:var(--neon-red); }

        /* ── sim match ── */
        .ml-sim-match { display:inline-flex;padding:1px 5px;border-radius:4px;font-size:0.6rem;font-weight:700; }
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
              <option value="Excluded-Dropped">Dropped Out</option>
              <option value="Awaited">Awaited</option>
            </select>
          </div>
        </div>
      </div>

      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px;">
        <span id="mlCount" style="font-size:0.82rem;color:var(--text-muted);">${meritData.length.toLocaleString()} entries</span>
        <label style="display:inline-flex;align-items:center;gap:6px;font-size:0.78rem;color:var(--text-muted);cursor:pointer;padding:6px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.08);">
          <input type="checkbox" id="mlExcludeToggle" style="accent-color:var(--neon-red);" />
          <span>Exclude <span id="mlExcludeHint" style="color:var(--text-muted);font-size:0.72rem;">(click to exclude)</span></span>
        </label>
        <button id="mlRestoreBtn" style="font-size:0.82rem;padding:6px 14px;background:rgba(245,200,66,0.12);color:#f5c842;border:1px solid rgba(245,200,66,0.28);border-radius:8px;cursor:pointer;">&#8635; Restore Initial Consent</button>
        <span id="mlStatus" style="font-size:0.78rem;color:var(--text-muted);"></span>
      </div>

      <div id="mlGrid" class="sim-grid">
        <div style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--text-muted);">Loading&hellip;</div>
      </div>
      <p id="mlCaption" class="table-caption"></p>`;

    document.getElementById('mlProgram')?.addEventListener('change', applyFilters);
    document.getElementById('mlSpecialty')?.addEventListener('change', applyFilters);
    document.getElementById('mlHospital')?.addEventListener('change', applyFilters);
    document.getElementById('mlQuota')?.addEventListener('change', applyFilters);
    document.getElementById('mlSearch')?.addEventListener('input', applyFilters);
    document.getElementById('mlConsent')?.addEventListener('change', applyFilters);
    document.getElementById('mlRestoreBtn')?.addEventListener('click', restoreInitial);
    document.getElementById('mlExcludeToggle')?.addEventListener('change', function () {
      mlExcludeMode = this.checked;
      const hint = document.getElementById('mlExcludeHint');
      if (hint) hint.textContent = mlExcludeMode ? '&#9888; click unconsented to remove' : '(click for details)';
      const grid = document.getElementById('mlGrid');
      if (grid) grid.classList.toggle('ml-excluding', mlExcludeMode);
    });

    updateMeta();
    applyFilters();
    if (showSimMatch) {
      buildSimMatch();
      setTimeout(autoRunSimulations, 200);
    }
  }

  // —”€—”€ Meta —”€—”€

  function updateMeta() {
    const metaEl = document.getElementById('meritListMeta');
    if (!metaEl) return;

    let accepted = 0, excluded = 0, dropped = 0, awaited = 0;
    for (const entry of meritData) {
      const v = getRowConsentVal(entry);
      if (v === 'Accepted') accepted++;
      else if (v === 'Excluded-Dropped') dropped++;
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
        <div><span class="cur-meta-lbl" style="color:var(--neon-pink);">Dropped-out</span><span class="cur-meta-val">${dropped.toLocaleString()}</span></div>
        <div><span class="cur-meta-lbl" style="color:var(--neon-gold);">Awaited</span><span class="cur-meta-val">${awaited.toLocaleString()}</span></div>
        ${seatsData ? `<div><span class="cur-meta-lbl">Seats</span><span class="cur-meta-val">${seatsData.length} slots</span></div>` : ''}
        ${showSimMatch ? `<div><span class="cur-meta-lbl">Sim Accuracy</span><span class="cur-meta-val">${simAccLabel}</span></div>` : ''}
        <div><span class="cur-meta-lbl">Merit File</span><span class="cur-meta-val" style="font-family:var(--mono);font-size:0.72rem;color:var(--neon-cyan);">${meritLabel}</span></div>
        <div><span class="cur-meta-lbl">Consent File</span><span class="cur-meta-val" style="font-family:var(--mono);font-size:0.72rem;color:var(--neon-pink);">Round ${currentRound}${consentAt}</span></div>
      </div>
      <div class="cur-meta-note" style="margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.06);font-size:0.75rem;line-height:1.5;color:var(--text-muted);">
        <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:8px;">
          <span><span style="color:var(--neon-green);font-weight:700;">&#9679; Accepted</span> — consented to this slot</span>
          <span><span style="color:var(--neon-pink);font-weight:700;">&#9679; Dropped Out</span> — consented to another slot</span>
          <span><span style="color:var(--neon-red);font-weight:700;">&#9679; Excluded</span> — rejected / manually excluded</span>
          <span><span style="color:var(--neon-gold);font-weight:700;">&#9679; Awaited</span> — awaiting decision</span>
        </div>
        <div>Toggle <strong>Exclude</strong> mode then click any unconsented candidate to remove them and start a replacement chain. Click any candidate (mode off) for details. <strong>Pass</strong> to assign the first replacement (globally removed from all queues). <strong>Where Merit Falls</strong> shows the full ranked queue per slot.</div>
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
    renderMeritGrid();
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

  // —”€—”€ Candidate Pool Lookups (from induction21_candidates.json) —”€—”€

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

  // —”€—”€ Filters —”€—”€

  function getRowConsentVal(d) {
    const key = slotKey(d);
    // Per-slot resolution from consent data — takes priority over
    // noConsentIds so that Accepted rows stay Accepted and Dropped
    // rows show "Dropped Out" even when auto-excluded by batchAutoChain.
    const bySlot = consentBySlot[key];
    if (bySlot === 'Accepted') return 'Accepted';
    if (bySlot === 'Dropped') return 'Excluded-Dropped';
    // User manually excluded or auto-excluded via batchAutoChain
    if (noConsentIds.has(key)) return 'Excluded';
    if (bySlot === 'Rejected') return 'Excluded';
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
        const cv = getRowConsentVal(d);
        if (cv !== consentFilter) return false;
      }
      return true;
    });

    renderMeritGrid();
  }

  // —”€—”€ Grid (simulation-style) —”€—”€

  function renderMeritGrid() {
    const grid = document.getElementById('mlGrid');
    const caption = document.getElementById('mlCaption');
    const countEl = document.getElementById('mlCount');
    if (!grid) return;

    if (!filteredData.length) {
      grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--text-muted);">No entries match filters.</div>';
      if (caption) caption.textContent = '';
      if (countEl) countEl.textContent = '0 entries';
      return;
    }

    // Group filteredData by slot (program :: quota :: specialty :: hospital)
    const slotMap = {};
    for (const d of filteredData) {
      const program = fval(d, 'typeName', 'type', 'program') || '';
      const quota = fval(d, 'quotaName', 'quota') || '';
      const specialty = fval(d, 'specialityName', 'speciality', 'specialty') || '';
      const hospital = fval(d, 'hospitalName', 'hospital') || '';
      const groupKey = program + '::' + quota + '::' + specialty + '::' + hospital;
      if (!slotMap[groupKey]) slotMap[groupKey] = [];
      slotMap[groupKey].push(d);
    }

    const cards = [];
    for (const [groupKey, entries] of Object.entries(slotMap)) {
      const parts = groupKey.split('::');
      const program = parts[0];
      const quota = parts[1];
      const specialty = parts[2];
      const hospital = parts[3];

      const filled = entries.length;

      // Count consent states
      const acceptedCount = entries.filter(d => getRowConsentVal(d) === 'Accepted').length;

      // Build candidate rows for this slot card
      const candRows = entries.map(d => {
        const applicantId = fval(d, 'applicantId');
        const name = fval(d, 'nameFull', 'name') || '—';
        const marks = fval(d, 'marksTotal', 'marks');
        const marksStr = marks != null ? Number(marks).toFixed(2) : '—';
        const preferenceNo = prefNoFromCandidate(applicantId, program, quota, specialty, hospital);
        const prefDisplay = preferenceNo != null ? 'P' + preferenceNo : 'P?';
        const slotMatch = prefMatchFromCandidate(applicantId, program, quota, specialty, hospital);
        const consentVal = getRowConsentVal(d);
        const isExcluded = consentVal === 'Excluded' || consentVal === 'Excluded-Dropped';
        const key = slotKey(d);

        // State-specific styling
        let stateClass = 'ml-row-awaiting';
        let stateLabel = 'Awaited';
        if (consentVal === 'Accepted') { stateClass = 'ml-row-accepted'; stateLabel = 'Accepted'; }
        else if (consentVal === 'Excluded-Dropped') { stateClass = 'ml-row-dropped'; stateLabel = 'Dropped'; }
        else if (consentVal === 'Excluded') { stateClass = 'ml-row-excluded'; stateLabel = 'Excluded'; }

        const simBadge = showSimMatch
          ? (() => {
              const r = simMatchForSlot(program, quota, specialty, hospital, applicantId);
              return r === true ? '<span class="ml-sim-match yes">&#9679;</span>' : r === false ? '<span class="ml-sim-match no">&#9679;</span>' : '';
            })()
          : '';

        let chainHtml = '';
        const chain = chainState[key];
        if (chain && chain.candidates.length) {
          const nextIdx = chain._nextIdx || 0;
          const c = chain.candidates[nextIdx];
          const chainKey = slotKeyFor(c.applicantId, program, quota, specialty, hospital);
          chainHtml = `<div class="sim-next-line ml-next-candidate" data-next-key="${esc(chainKey)}" data-parent-key="${esc(key)}">
            <span class="sim-next-lbl">Next in line:</span>
            <span class="sim-next-name">${esc(c.nameFull || '—')}</span>
            <span class="sim-next-marks">${c.marksTotal != null ? Number(c.marksTotal).toFixed(2) : '—'}</span>
            <span class="sim-row-pref">P${c.preferenceNo != null ? c.preferenceNo : '?'}</span>
          </div>`;
        }

        const isChained = noConsentIds.has(key);
        const chainCount = chain ? chain.candidates.length : 0;

        let rowHtml = `<div class="sim-row ${stateClass}" data-key="${esc(key)}">
          <span class="ml-state-bar"></span>
          <span class="ml-row-id">${esc(String(applicantId || ''))}</span>
          <span class="sim-row-name"><strong>${esc(name)}</strong></span>
          <span class="sim-row-marks">${marksStr}</span>
          <span class="ml-row-pref">${prefDisplay}${slotMatch ? '<span class="ml-pref-ok">&#10003;</span>' : ''}</span>
          ${simBadge ? `<span class="ml-sim-dot">${simBadge}</span>` : ''}
          <span class="ml-state-pill ${stateClass.replace('ml-row-', 'ml-pill-')}">${stateLabel}</span>
          ${isChained ? `<span class="ml-chain-badge">&#9879; ${chainCount} in line</span>` : ''}
        </div>`;
        if (chainHtml) {
          rowHtml += `<div class="ml-chain-row" data-parent-key="${esc(key)}">
            <div class="ml-chain-connector"></div>
            ${chainHtml}
          </div>`;
        }
        return rowHtml;
      }).join('');

      const allGood = acceptedCount === filled;
      let statusBar = '';
      if (allGood) {
        statusBar = `<div class="ml-card-status ml-card-status-full">&#10003; ${acceptedCount}/${filled} filled</div>`;
      } else {
        let totalNeeded = 0;
        let availReplacements = 0;
        for (const d of entries) {
          const k = slotKey(d);
          if (noConsentIds.has(k)) {
            totalNeeded++;
            if (chainState[k]?.candidates?.length) {
              availReplacements += chainState[k].candidates.length;
            }
          }
        }
        const supplyOk = availReplacements >= totalNeeded;
        statusBar = `<div class="ml-card-status ml-card-status-${supplyOk ? 'ok' : 'warn'}">&#9650; ${totalNeeded} need replacement &middot; ${availReplacements} candidate${availReplacements !== 1 ? 's' : ''} ${supplyOk ? 'available' : 'queued'}</div>`;
      }
      cards.push(`<div class="sim-card ${allGood ? 'ml-card-ok' : 'ml-card-attn'}" style="position:relative;">
        <div class="sim-card-head">
          <div class="sim-card-title">
            <span class="sim-card-spec">${esc(specialty)}</span>
            <span class="sim-card-hosp">${esc(hospital)}</span>
            <span class="sim-card-meta">${esc(program)} &middot; ${esc(quota)}</span>
          </div>
          <div class="sim-card-badges">
            <span class="sim-badge ${allGood ? 'badge-full' : 'badge-open'}">${acceptedCount}/${filled}</span>
            ${!allGood ? '<span class="sim-badge badge-open">pending</span>' : ''}
          </div>
        </div>
        ${statusBar}
        <div class="sim-placed">
          ${candRows}
        </div>
      </div>`);
    }

    grid.innerHTML = cards.join('');

    if (caption) {
      caption.textContent = `Showing ${filteredData.length} of ${meritData.length.toLocaleString()} entries`;
    }
    if (countEl) {
      countEl.textContent = `${filteredData.length.toLocaleString()} of ${meritData.length.toLocaleString()} entries`;
    }
  }

  // —”€—”€ Event delegation —”€—”€
  // Click on a candidate row → exclude if exclude-mode ON, else show info modal.
  // Click on next-in-line → open the chain's modal for the parent slot.
  // Button clicks inside info modal — handled via overlay's own listeners.

  document.addEventListener('click', function (e) {
    const chainRow = e.target.closest('.ml-chain-row');
    if (chainRow) {
      const parentKey = chainRow.dataset.parentKey;
      if (parentKey) showNextInLineModal(parentKey);
      return;
    }
    const nextCandidate = e.target.closest('.ml-next-candidate');
    if (nextCandidate) {
      const parentKey = nextCandidate.dataset.parentKey;
      if (parentKey) showNextInLineModal(parentKey);
      return;
    }
    const row = e.target.closest('.sim-row[data-key]');
    if (!row) return;
    const key = row.dataset.key;
    if (!key) return;
    e.stopPropagation();
    // In exclude mode: skip Accepted rows (show info) and skip already-excluded/dropped rows (show info)
    const entry = meritData.find(d => slotKey(d) === key);
    const consentVal = entry ? getRowConsentVal(entry) : null;
    const alreadyChained = chainState[key] && chainState[key].candidates.length > 0;
    if (mlExcludeMode && consentVal !== 'Accepted' && !alreadyChained) {
      startChain(key);
    } else {
      showCandidateInfoModal(key);
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
      // Exclude candidates already placed as next-in-line for another slot (simulation-style pass logic)
      if (globallyPlacedAids.has(aid)) {
        skipped.push({ applicantId: c.applicantId, nameFull: c.nameFull || '', marksTotal: effectiveMarks, preferenceNo: pref.preferenceNo, reason: 'Already assigned as replacement to another slot' });
        continue;
      }

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

      // Skip dual-opt-outs: candidate was Dropped (consented to another
      // programme) or Rejected for THIS programme in/by any round. Keeps
      // Zohaib (FCPS-consented) out of an MD replacement pool, etc.
      const aidProg = aid + '::' + program;
      if (cumulativeDroppedByProgram.has(aidProg)) {
        // Distinct reason text so it shows clearly in the modal
        const why = (consentBySlot[slotKeyFor(aid, program, quota, specialty, hospital)] === 'Dropped')
          ? 'Consented to another programme'
          : 'Rejected for this programme';
        skipped.push({
          applicantId: c.applicantId, nameFull: c.nameFull || '',
          marksTotal: effectiveMarks, preferenceNo: pref.preferenceNo,
          reason: why
        });
        continue;
      }

      // Exclude candidates rejected in ANY profile status type (not just effective)
      const allStatuses = typeof getAllProfileStatusesForCandidate === 'function'
        ? getAllProfileStatusesForCandidate(c)
        : [];
      const anyRejected = allStatuses.some(s => Number(s.statusId) === 2);
      if (anyRejected) {
        skipped.push({
          applicantId: c.applicantId, nameFull: c.nameFull || '',
          marksTotal: effectiveMarks, preferenceNo: pref.preferenceNo,
          reason: 'Rejected in profile status'
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
    // Dedup next-in-line with sibling slots in the same group
    _dedupNextInLineForGroup(program, q, s, h);
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
    const nextIdx = chain._nextIdx || 0;
    const next = chain.candidates[nextIdx];
    // Mark the passed candidate as globally placed (simulation-style pass logic) —
    // they get "assigned" this slot and are removed from all other replacement queues.
    globallyPlacedAids.add(String(next.applicantId));
    // Also add their slot key for this specific slot
    const nextKey = slotKeyFor(next.applicantId, program, q, s, h);
    noConsentIds.add(nextKey);

    // Refresh the list excluding everyone already marked
    try {
      if (program && q && s && h) {
        const refreshed = listReplacementCandidates(program, q, s, h, [...noConsentIds]);
        chain.candidates = refreshed.candidates;
        chain.skipped = refreshed.skipped;
        chain._nextIdx = 0; // reset after refresh
        _dedupNextInLineForGroup(program, q, s, h);
      }
    } catch (e) {
      console.warn('[MeritList] Refresh failed:', e);
    }

    updateMeta();
    applyFilters();
    buildSimMatch();

    const remaining = chain.candidates.length;
    setStatus(remaining
      ? `Passed ID ${next.applicantId} (globally placed). ${remaining} candidate(s) still in line.`
      : `Passed ID ${next.applicantId} (globally placed). End of line.`, 'var(--neon-gold)');
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
        globallyPlacedAids.delete(String(c.applicantId));
      }
      delete chainState[slotKeyStr];
      // Re-dedup siblings: a previously claimed #1 may now be available
      _dedupNextInLineForGroup(program, q, s, h);
    }
    setStatus(`Restored consent for candidate #${parts[0]} in ${program}/${s}.`, 'var(--neon-green)');
    updateMeta();
    applyFilters();
    buildSimMatch();
  }

  // —”€—”€ Restore —”€—”€

  async function restoreInitial() {
    noConsentIds = new Set();
    globallyPlacedAids = new Set();
    chainState = {};
    mlExcludeMode = false;
    const toggle = document.getElementById('mlExcludeToggle');
    if (toggle) toggle.checked = false;
    const grid = document.getElementById('mlGrid');
    if (grid) grid.classList.remove('ml-excluding');
    const hint = document.getElementById('mlExcludeHint');
    if (hint) hint.textContent = '(click for details)';
    // Re-derive cumulative sets from the raw consent files. consentBySlot
    // itself is unchanged (it was derived read-only from the raw array and
    // no local overrides mutate it).
    const cumulative = await buildCumulativeConsentSets(currentRound);
    cumulativeRejected = cumulative.rejected;
    cumulativeDroppedByProgram = cumulative.droppedByProgram;
    setStatus('Consent states restored to initial (round ' + currentRound + ').', 'var(--neon-green)');
    updateMeta();
    applyFilters();
    buildSimMatch();
  }

  // —”€—”€ Auto-init chains for non-consented candidates —”€—”€

  function batchAutoChain() {
    const entries = [];
    for (const d of meritData) {
      const key = slotKey(d);
      if (noConsentIds.has(key)) continue;
      const aid = String(fval(d, 'applicantId'));
      // Auto-exclude if rejected/dropped per-slot, or rejected/dropped
      // cumulatively for this programme. Per-slot Dropped = consented to
      // another programme (dual-opt-out); like Rejected, that merit slot
      // is empty.
      const cv = consentBySlot[key];
      // Never auto-exclude a row where the candidate consented — the
      // (aid, program) level cumulative sets would otherwise catch accepted
      // slots sharing the same program as a dropped/rejected one.
      if (cv === 'Accepted') continue;
      const aidProg = aid + '::' + (fval(d, 'typeName', 'type', 'program') || '');
      // Also check profile status rejection (any type)
      const cand = candidatesMap[aid];
      const allStatuses = cand && typeof getAllProfileStatusesForCandidate === 'function'
        ? getAllProfileStatusesForCandidate(cand)
        : [];
      const profileRejected = allStatuses.some(s => Number(s.statusId) === 2);
      if (cv === 'Rejected' || cv === 'Dropped'
          || cumulativeRejected.has(aid)
          || cumulativeDroppedByProgram.has(aidProg)
          || profileRejected) {
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

    // Dedup next-in-line across sibling slots in the same group
    for (const [key, ch] of Object.entries(chainState)) {
      if (!ch._nextIdx) ch._nextIdx = 0;
    }
    _dedupAllGroups();

    updateMeta();
    applyFilters();
    buildSimMatch();
    setStatus(`Auto-resolved ${entries.length} non-consented candidate(s).`, 'var(--neon-gold)');
  }

  // —”€—”€ Shared dedup helpers —”€—”€

  function _dedupNextInLineForGroup(program, quota, specialty, hospital) {
    const gk = [program, quota, specialty, hospital].join('::');
    const chains = [];
    for (const [key, ch] of Object.entries(chainState)) {
      const p = key.split('::');
      if (p.slice(1, 5).join('::') === gk && ch.candidates && ch.candidates.length) {
        chains.push(ch);
      }
    }
    if (chains.length < 2) return;
    const claimedNext = new Set();
    for (const chain of chains) {
      let idx = chain._nextIdx || 0;
      while (idx < chain.candidates.length && claimedNext.has(String(chain.candidates[idx].applicantId))) {
        idx++;
      }
      if (idx < chain.candidates.length) {
        claimedNext.add(String(chain.candidates[idx].applicantId));
        chain._nextIdx = idx;
      }
    }
  }

  function _dedupAllGroups() {
    const groups = {};
    for (const [key, ch] of Object.entries(chainState)) {
      if (!ch.candidates || !ch.candidates.length) continue;
      const p = key.split('::');
      const gk = p.slice(1, 5).join('::');
      if (!groups[gk]) groups[gk] = [];
      groups[gk].push(ch);
    }
    for (const chains of Object.values(groups)) {
      if (chains.length < 2) continue;
      const claimedNext = new Set();
      for (const chain of chains) {
        let idx = chain._nextIdx || 0;
        while (idx < chain.candidates.length && claimedNext.has(String(chain.candidates[idx].applicantId))) {
          idx++;
        }
        if (idx < chain.candidates.length) {
          claimedNext.add(String(chain.candidates[idx].applicantId));
          chain._nextIdx = idx;
        }
      }
    }
  }

  // —”€—”€ Next in Line Modal —”€—”€

  function reasonBadge(reason) {
    if (!reason) return '<span style="color:var(--text-muted);font-size:0.72rem;">—</span>';
    if (reason.startsWith('Manually excluded')) return `<span style="display:inline-block;padding:1px 8px;border-radius:10px;background:rgba(255,107,107,0.12);color:var(--neon-pink);font-size:0.7rem;border:1px solid rgba(255,107,107,0.2);">${esc(reason)}</span>`;
    if (reason.startsWith('Already placed at preference')) return `<span style="display:inline-block;padding:1px 8px;border-radius:10px;background:rgba(232,166,39,0.1);color:var(--neon-gold);font-size:0.7rem;border:1px solid rgba(232,166,39,0.2);">${esc(reason)}</span>`;
    if (reason.startsWith('Rejected')) return `<span style="display:inline-block;padding:1px 8px;border-radius:10px;background:rgba(255,107,107,0.08);color:var(--neon-pink);font-size:0.7rem;border:1px solid rgba(255,107,107,0.15);">${esc(reason)}</span>`;
    if (reason.startsWith('Consented to another')) return `<span style="display:inline-block;padding:1px 8px;border-radius:10px;background:rgba(232,166,39,0.08);color:var(--neon-gold);font-size:0.7rem;border:1px solid rgba(232,166,39,0.18);">${esc(reason)}</span>`;
    if (reason.startsWith('Already assigned')) return `<span style="display:inline-block;padding:1px 8px;border-radius:10px;background:rgba(77,184,217,0.08);color:var(--neon-cyan);font-size:0.7rem;border:1px solid rgba(77,184,217,0.18);">${esc(reason)}</span>`;
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

  function showCandidateInfoModal(slotKeyStr) {
    if (!slotKeyStr) return;
    const entry = meritData.find(d => slotKey(d) === slotKeyStr);
    if (!entry) return;
    const applicantId = fval(entry, 'applicantId');
    const name = fval(entry, 'nameFull', 'name') || '—';
    const program = fval(entry, 'typeName', 'type', 'program') || '—';
    const quota = fval(entry, 'quotaName', 'quota') || '—';
    const specialty = fval(entry, 'specialityName', 'speciality', 'specialty') || '—';
    const hospital = fval(entry, 'hospitalName', 'hospital') || '—';
    const marks = fval(entry, 'marksTotal', 'marks');
    const marksStr = marks != null ? Number(marks).toFixed(2) : '—';
    const prefNo = prefNoFromCandidate(applicantId, program, quota, specialty, hospital);
    const consentVal = getRowConsentVal(entry);

    const isAccepted = consentVal === 'Accepted';
    const isExcluded = consentVal === 'Excluded';
    const isDropped = consentVal === 'Excluded-Dropped';
    const hasChain = !!chainState[slotKeyStr];

    const stateLabel = isAccepted ? 'Accepted' : isDropped ? 'Dropped Out' : isExcluded ? 'Excluded' : 'Awaited';
    const stateColor = isAccepted ? 'var(--neon-green)' : isDropped ? 'var(--neon-pink)' : isExcluded ? 'var(--neon-red)' : 'var(--neon-gold)';

    // Build action buttons
    let actionHtml = '';
    if (isAccepted) {
      actionHtml = '<span style="color:var(--neon-green);font-weight:600;font-size:0.9rem;">&#10003; Consented — no action needed</span>';
    } else if (hasChain) {
      const chain = chainState[slotKeyStr];
      const count = chain.candidates.length;
      const firstName = chain.candidates[0]?.nameFull || '—';
      actionHtml = `
        <button class="ml-info-pass" data-key="${esc(slotKeyStr)}" style="flex:1;padding:8px;background:rgba(62,207,142,0.15);color:var(--neon-green);border:1px solid rgba(62,207,142,0.3);border-radius:8px;cursor:pointer;font-size:0.82rem;">Pass ${esc(firstName)}</button>
        <button class="ml-info-view-chain" data-key="${esc(slotKeyStr)}" style="flex:1;padding:8px;background:rgba(232,166,39,0.12);color:var(--neon-gold);border:1px solid rgba(232,166,39,0.3);border-radius:8px;cursor:pointer;font-size:0.82rem;">Queue (${count})</button>
        <button class="ml-info-restore" data-key="${esc(slotKeyStr)}" style="flex:1;padding:8px;background:rgba(62,207,142,0.12);color:var(--neon-green);border:1px solid rgba(62,207,142,0.3);border-radius:8px;cursor:pointer;font-size:0.82rem;">Restore</button>`;
    } else {
      const bySlot = consentBySlot[slotKeyStr];
      if (bySlot === 'Rejected' || bySlot === 'Dropped') {
        actionHtml = `<button class="ml-info-override" data-key="${esc(slotKeyStr)}" style="flex:1;padding:8px;background:rgba(232,166,39,0.12);color:var(--neon-gold);border:1px solid rgba(232,166,39,0.3);border-radius:8px;cursor:pointer;font-size:0.82rem;">Override &amp; Show Next</button>`;
      } else {
        actionHtml = `<button class="ml-info-exclude" data-key="${esc(slotKeyStr)}" style="flex:1;padding:8px;background:rgba(220,60,60,0.12);color:var(--neon-red);border:1px solid rgba(220,60,60,0.3);border-radius:8px;cursor:pointer;font-size:0.82rem;">Exclude &amp; Show Next</button>`;
      }
    }

    const overlay = document.createElement('div');
    overlay.className = 'ml-info-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;z-index:13000;backdrop-filter:blur(8px);animation:mlFadeIn 0.18s ease;';
    overlay.innerHTML = `
      <div style="background:rgba(10,17,32,0.98);border:1px solid var(--border);border-top:3px solid ${stateColor};border-radius:16px;padding:1.8rem;width:min(520px,90vw);box-shadow:0 12px 56px rgba(0,0,0,0.85),0 0 60px rgba(77,184,217,0.05);animation:mlSlideUp 0.22s cubic-bezier(0.22,1,0.36,1) both;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1rem;">
          <div>
            <div style="color:var(--neon-cyan);font-size:1.1rem;font-weight:700;">${esc(name)}</div>
            <div style="font-size:0.85rem;color:var(--text-muted);margin-top:2px;">
              ID <span style="font-family:var(--mono);color:var(--text);">${esc(String(applicantId))}</span>
              &middot; Marks <strong>${marksStr}</strong>
              &middot; Pref #${prefNo != null ? prefNo : '?'}
            </div>
          </div>
          <button class="ml-info-close-btn" style="background:none;border:none;color:var(--text-muted);font-size:1.5rem;cursor:pointer;padding:0 4px;line-height:1;">&times;</button>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:1.2rem;">
          <div style="padding:10px 12px;background:rgba(255,255,255,0.03);border-radius:10px;">
            <div style="font-size:0.68rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em;">Program</div>
            <div style="font-size:0.88rem;font-weight:600;margin-top:2px;">${esc(program)}</div>
          </div>
          <div style="padding:10px 12px;background:rgba(255,255,255,0.03);border-radius:10px;">
            <div style="font-size:0.68rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em;">Quota</div>
            <div style="font-size:0.88rem;margin-top:2px;">${esc(quota)}</div>
          </div>
          <div style="padding:10px 12px;background:rgba(255,255,255,0.03);border-radius:10px;">
            <div style="font-size:0.68rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em;">Specialty</div>
            <div style="font-size:0.88rem;font-weight:600;margin-top:2px;">${esc(specialty)}</div>
          </div>
          <div style="padding:10px 12px;background:rgba(255,255,255,0.03);border-radius:10px;">
            <div style="font-size:0.68rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em;">Hospital</div>
            <div style="font-size:0.88rem;margin-top:2px;">${esc(hospital)}</div>
          </div>
        </div>

        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:rgba(255,255,255,0.02);border-radius:10px;margin-bottom:1.2rem;">
          <span style="font-size:0.82rem;color:var(--text-muted);">Consent status</span>
          <span style="display:inline-flex;align-items:center;gap:6px;padding:4px 14px;border-radius:100px;font-size:0.78rem;font-weight:700;background:${stateColor}15;color:${stateColor};">${stateLabel}</span>
        </div>

        <div style="display:flex;gap:10px;">
          ${actionHtml}
        </div>
      </div>`;

    document.body.appendChild(overlay);

    const close = () => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); };
    overlay.querySelectorAll('.ml-info-close-btn').forEach(btn => btn.addEventListener('click', close));
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    overlay.querySelector('.ml-info-exclude')?.addEventListener('click', () => { close(); startChain(slotKeyStr); });
    overlay.querySelector('.ml-info-override')?.addEventListener('click', () => { close(); startChain(slotKeyStr); });
    overlay.querySelector('.ml-info-restore')?.addEventListener('click', () => { close(); restoreConsent(slotKeyStr); });
    overlay.querySelector('.ml-info-view-chain')?.addEventListener('click', () => { close(); showNextInLineModal(slotKeyStr); });
    overlay.querySelector('.ml-info-pass')?.addEventListener('click', () => { close(); nextInLine(slotKeyStr); });
  }

  // —”€—”€ Where Merit Falls + Consent What-If — mode-aware content swap —”€—”€
  //
  // In merit-list mode (simulation_mode = 'merit-list'), the
  // "Where Merit Falls" (#tab-slotbrowser) and "Consent What-If"
  // (#tab-consent) tabs swap from their seat-allocation renderers to
  // merit-list-aware renderers that reuse this IIFE's already-loaded
  // meritData + consentBySlot + listReplacementCandidates logic.
  //
  // Reverting to 'seat-allocation' goes through `applyMode -> window.location.reload()`
  // so the original scripts (sim-slot-browser.js, sim-consent.js) rebind to
  // the pristine HTML. No structural edits to those scripts are made.

  function hideEl(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }

  function applyMeritListTabSwap() {
    if (!merritListActive) return;
    // Hide seat-allocation-only run controls defensively (their host tab is
    // already replaced by renderMeritListUI; this is a belt-and-braces
    // guard against stray late bindings).
    hideEl('runSimBtn');
    hideEl('runApplicantSimBtn');
    renderMlSlotBrowser();
    renderMlConsentWhatIf();
    showMeritListInfoModal();
  }

  const ML_INFO_MODAL_KEY = 'mn_ml_info_seen';
  function showMeritListInfoModal() {
    // Show once per browser session (resets on tab close) so admin toggles
    // don't re-spam users.
    try { if (sessionStorage.getItem(ML_INFO_MODAL_KEY)) return; } catch (_) { /* ignore */ }
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.72);display:flex;align-items:center;justify-content:center;z-index:13000;backdrop-filter:blur(6px);animation:mlFadeIn 0.2s ease;';
    overlay.innerHTML = `
      <div style="background:rgba(10,17,32,0.98);border:1px solid var(--border);border-top:2px solid var(--neon-cyan);border-radius:16px;padding:1.6rem;width:min(620px,92vw);max-height:88vh;overflow-y:auto;box-shadow:0 8px 48px rgba(0,0,0,0.85),0 0 60px rgba(77,184,217,0.08);animation:mlSlideUp 0.25s cubic-bezier(0.22,1,0.36,1) both;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:0.6rem;">
          <div>
            <div style="color:var(--neon-cyan);font-size:1.1rem;font-weight:700;">Merit List mode is on</div>
            <div style="font-size:0.8rem;color:var(--text-muted);">Three tabs have swapped to published-merit views for round ${currentRound}.</div>
          </div>
          <button class="ml-info-close" style="background:none;border:none;color:var(--text-muted);font-size:1.5rem;cursor:pointer;padding:0 4px;line-height:1;">&times;</button>
        </div>
        <div style="display:flex;flex-direction:column;gap:0.8rem;font-size:0.86rem;line-height:1.5;">
          <div style="padding:0.7rem 0.9rem;background:rgba(77,184,217,0.06);border:1px solid rgba(77,184,217,0.18);border-radius:10px;">
            <div style="color:var(--neon-cyan);font-weight:700;margin-bottom:2px;">📊 Merit List tab <span style="color:var(--text-muted);font-weight:400;">(was: Seat Allocation)</span></div>
            Simulation-style grid of published merit placements with per-candidate consent — green <strong>Accepted</strong>, red <strong>Excluded</strong>, red <strong>Dropped Out</strong> (consented to another programme), gold <strong>Awaited</strong>. Click <strong>Exclude</strong> to start a replacement chain; the first candidate becomes <em>Next in line</em> and is globally removed from other slots (simulation-pass logic). Click <strong>Restore</strong> to undo. The ⚡ <em>Run Simulation</em> button is hidden in this mode.
          </div>
          <div style="padding:0.7rem 0.9rem;background:rgba(232,166,39,0.05);border:1px solid rgba(232,166,39,0.18);border-radius:10px;">
            <div style="color:var(--neon-gold);font-weight:700;margin-bottom:2px;">🎯 Where Merit Falls tab</div>
            Pick a programme + quota + specialty + hospital to see the <strong>full ranked queue</strong> for that slot — every applicant who listed it, sorted by marks with their queue rank <code>#N</code>. Published (consented) holders appear first; everyone below is the replacement pool. <strong>Find yourself</strong> in the search box to see <em>Your rank — #N of M</em>. When the four filters aren't all set, you get an overview of published placements instead.
          </div>
          <div style="padding:0.7rem 0.9rem;background:rgba(62,207,142,0.05);border:1px solid rgba(62,207,142,0.18);border-radius:10px;">
            <div style="color:var(--neon-green);font-weight:700;margin-bottom:2px;">↔ Consent What-If tab</div>
            Enter an Applicant ID. <strong>If they have already consented</strong> this round, you get a blue alert — no simulation needed (their slot stays). <strong>Otherwise</strong>, the tab lists each published slot they hold with the next-in-line candidate(s) for that seat, reusing the same replacement engine as the Merit List tab.
          </div>
          <div style="font-size:0.76rem;color:var(--text-muted);border-top:1px solid rgba(255,255,255,0.06);padding-top:0.6rem;">
            Switching back to <strong>Seat Allocation</strong> mode (via the Admin portal) reloads the page and restores the original tabs. This info box appears once per browser session.
          </div>
        </div>
        <div style="display:flex;gap:0.7rem;margin-top:1.1rem;">
          <button class="ml-info-close btn btn-primary" style="flex:1;padding:0.65rem;border-radius:8px;">Got it</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => {
      try { sessionStorage.setItem(ML_INFO_MODAL_KEY, '1'); } catch (_) { /* ignore */ }
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    };
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  }

// —”€—”€ Where Merit Falls (Merit-list mode) —”€—”€
  //
  // Queue-centric view: pick a slot (program + quota + specialty + hospital)
  // and see ALL candidates who applied to it, sorted by marks, each with their
  // queue rank (#). Retains the original "find yourself —†’ your rank" use via
  // SIM.myId. Candidates who already hold that published slot render first
  // (Accepted); the rest of the queue is the "next in line" pool — i.e. the
  // replacement ordering used when the published holder does not consent.
  //
  // When filters are broad (not a specific slot), shows an overview of every
  // published merit placement with its consent state — same row format as the
  // Merit List tab, but here used as a slot-picker summary, not the main use.

  let mlSbFiltered = [];

  function renderMlSlotBrowser() {
    const sbEl = document.getElementById('tab-slotbrowser');
    if (!sbEl) return;

    const programs = [...new Set(meritData.map(d => fval(d, 'typeName', 'type', 'program')).filter(Boolean))].sort();
    const quotas = [...new Set(meritData.map(d => fval(d, 'quotaName', 'quota')).filter(Boolean))].sort();
    const specialties = [...new Set(meritData.map(d => fval(d, 'specialityName', 'speciality', 'specialty')).filter(Boolean))].sort();
    const hospitals = [...new Set(meritData.map(d => fval(d, 'hospitalName', 'hospital')).filter(Boolean))].sort();

    sbEl.innerHTML = `
      <style>
        #mlSbTable thead th { position:sticky; top:0; z-index:2; }
        #mlSbTable tbody tr:nth-child(even) { background:rgba(255,255,255,0.02); }
        #mlSbTable tr.ml-sb-row:hover { background:rgba(77,184,217,0.07); }
        #mlSbTable tr.ml-sb-me { background:rgba(77,184,217,0.14) !important; box-shadow:inset 3px 0 0 var(--neon-cyan); }
        #mlSbTable tr.ml-sb-search { background:rgba(245,200,66,0.16) !important; box-shadow:inset 3px 0 0 var(--neon-gold); }
        #mlSbTable tr.ml-sb-pub { background:rgba(62,207,142,0.06); }
        #mlSbRank { font-weight:700; color:var(--neon-cyan); font-family:var(--mono); }
        #mlSbTable .ml-sb-rank-me { color:var(--neon-cyan); font-weight:700; }
        #mlSbTable .ml-sb-pill { display:inline-flex; gap:3px; padding:2px 8px; border-radius:100px; font-size:0.68rem; font-weight:600; }
        #mlSbTable .ml-sb-pill.accepted { background:rgba(62,207,142,0.12); color:var(--neon-green); }
        #mlSbTable .ml-sb-pill.queue    { background:rgba(77,184,217,0.10); color:var(--neon-cyan); }
        #mlSbTable .ml-sb-pill.dropped  { background:rgba(255,107,107,0.10); color:var(--neon-pink); }
        #mlSbTable .ml-sb-pill.rejected { background:rgba(220,60,60,0.12); color:var(--neon-red); }
        #mlSbTable .ml-sb-pill.awaited  { background:rgba(232,166,39,0.12); color:var(--neon-gold); }
        #mlSbTable .ml-sb-me-tag { color:var(--neon-cyan); font-weight:700; font-size:0.7rem; margin-left:4px; }
        #mlSbTable .ml-sb-search-tag { color:var(--neon-gold); font-weight:700; font-size:0.7rem; margin-left:4px; }
      </style>
      <div class="section-header">
        <h2>Where Merit Falls — Round ${currentRound}</h2>
        <p>Select a programme, quota, specialty and hospital to see the full merit queue for that slot — every applicant who listed it, ordered by marks with their queue rank #. <strong>Find yourself</strong> using the search box to see your rank. Published (consented) holders appear first; the rest is the next-in-line replacement pool for that seat.</p>
      </div>
      <div id="mlSbMeta" class="current-meta-card"></div>
      <div class="card filter-card">
        <div class="input-grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));">
          <div class="form-group">
            <label>Program</label>
            <select id="mlSbProgram">
              <option value="">All Programs</option>
              ${programs.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>Quota</label>
            <select id="mlSbQuota">
              <option value="">All Quotas</option>
              ${quotas.map(q => `<option value="${esc(q)}">${esc(q)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>Specialty</label>
            <select id="mlSbSpecialty">
              <option value="">All Specialties</option>
              ${specialties.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>Hospital</label>
            <select id="mlSbHospital">
              <option value="">All Hospitals</option>
              ${hospitals.map(h => `<option value="${esc(h)}">${esc(h)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>Find candidate</label>
            <input type="text" id="mlSbSearch" class="mt-filter-input" placeholder="Name, PMDC, ID—€¦" />
          </div>
        </div>
        <p style="margin:8px 0 0;font-size:0.78rem;color:var(--text-muted);">Tip: select all four dropdowns (program + quota + specialty + hospital) to see the full ranked queue for that one slot, including your queue rank.</p>
      </div>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">
        <span id="mlSbCount" style="font-size:0.82rem;color:var(--text-muted);">—</span>
        <span id="mlSbStatus" style="font-size:0.78rem;color:var(--text-muted);"></span>
      </div>
      <div class="table-wrap">
        <table class="data-table" id="mlSbTable">
          <thead>
            <tr>
              <th>Queue #</th><th>ID</th><th>Name</th><th>Marks</th><th>Pref</th>
              <th>Program</th><th>Quota</th><th>Specialty</th><th>Hospital</th><th>State</th>
            </tr>
          </thead>
          <tbody id="mlSbBody">
            <tr><td colspan="10" style="text-align:center;padding:1rem;color:var(--text-muted);">Select a programme to begin.</td></tr>
          </tbody>
        </table>
      </div>`;

    document.getElementById('mlSbProgram')?.addEventListener('change', applyMlSbFilters);
    document.getElementById('mlSbQuota')?.addEventListener('change', applyMlSbFilters);
    document.getElementById('mlSbSpecialty')?.addEventListener('change', applyMlSbFilters);
    document.getElementById('mlSbHospital')?.addEventListener('change', applyMlSbFilters);
    document.getElementById('mlSbSearch')?.addEventListener('input', applyMlSbFilters);
    applyMlSbFilters();
  }

  function applyMlSbFilters() {
    const prog = document.getElementById('mlSbProgram')?.value || '';
    const quota = document.getElementById('mlSbQuota')?.value || '';
    const spec = document.getElementById('mlSbSpecialty')?.value || '';
    const hosp = document.getElementById('mlSbHospital')?.value || '';
    const search = (document.getElementById('mlSbSearch')?.value || '').toLowerCase().trim();

    // A "specific slot" requires all four dropdowns set.
    const isSlotPicked = !!(prog && quota && spec && hosp);

    if (!isSlotPicked) {
      // Overview mode: list published merit placements matching the loose
      // filters (a slot-picker summary), same shape as the merit list rows.
      mlSbFiltered = meritData.filter(d => {
        const dp = fval(d, 'typeName', 'type', 'program') || '';
        const dq = fval(d, 'quotaName', 'quota') || '';
        const ds = fval(d, 'specialityName', 'speciality', 'specialty') || '';
        const dh = fval(d, 'hospitalName', 'hospital') || '';
        if (prog && dp !== prog) return false;
        if (quota && dq !== quota) return false;
        if (spec && ds !== spec) return false;
        if (hosp && dh !== hosp) return false;
        if (search) {
          const name = (fval(d, 'nameFull', 'name') || '').toLowerCase();
          const id = String(fval(d, 'applicantId') || '');
          const pmdc = (fval(d, 'pmdcNo') || '').toLowerCase();
          if (!name.includes(search) && !id.includes(search) && !pmdc.includes(search)) return false;
        }
        return true;
      });
      renderMlSbOverview();
      return;
    }

    // Queue mode: build the full merit-ordered queue for the picked slot.
    mlSbFiltered = buildMlSbQueue(prog, quota, spec, hosp);
    renderMlSbQueue(prog, quota, spec, hosp, search);
  }

  // Build the merit-ordered queue for a slot: every candidate who listed
  // this (program, quota, specialty, hospital) preference AND is not yet
  // placed at a higher preference elsewhere. Effective marks + bonus via
  // prefBonus (same chain as the main merit list). The currently-published
  // holder(s) appear at the top.
  function buildMlSbQueue(program, quota, specialty, hospital) {
    // placedBestPref[aid] = lowest pref number the applicant is published at
    // (across all their merit rows). Used to skip anyone already placed at
    // a higher preference than this slot — they will never actually contest
    // this seat, so they don't belong in the queue.
    const placedBestPref = {};
    for (const m of meritData) {
      const aid = String(fval(m, 'applicantId'));
      const mp = fval(m, 'typeName', 'type', 'program');
      const mq = fval(m, 'quotaName', 'quota') || '';
      const ms = fval(m, 'specialityName', 'speciality', 'specialty') || '';
      const mh = fval(m, 'hospitalName', 'hospital') || '';
      const prefNo = prefNoFromCandidate(aid, mp, mq, ms, mh);
      if (prefNo == null) continue;
      if (placedBestPref[aid] == null || prefNo < placedBestPref[aid]) {
        placedBestPref[aid] = prefNo;
      }
    }

    // Set of aids published AT THIS exact slot.
    const publishedAtThisSlot = new Set();
    for (const m of meritData) {
      if ((fval(m, 'typeName', 'type', 'program') || '') !== program) continue;
      const mq = (fval(m, 'quotaName', 'quota') || '').toLowerCase();
      const ms = (fval(m, 'specialityName', 'speciality', 'specialty') || '').toLowerCase();
      const mh = (fval(m, 'hospitalName', 'hospital') || '').toLowerCase();
      if (mq === quota.toLowerCase()
        && ms === specialty.toLowerCase()
        && mh === hospital.toLowerCase()) {
        publishedAtThisSlot.add(String(fval(m, 'applicantId')));
      }
    }

    const out = [];
    for (const c of candidatesData) {
      const aid = String(c.applicantId);
      const pref = candidatePreferenceForSlot(c, program, quota, specialty, hospital);
      if (!pref) continue;

      // Skip candidates already placed at a higher-preference slot — they
      // won't contest this seat regardless of consent state.
      const bestPref = placedBestPref[aid];
      if (bestPref != null && pref.preferenceNo != null && bestPref < pref.preferenceNo) continue;

      // Skip anyone who already rejected (cumulatively) or consented to
      // another programme for THIS programme's slot — they're unavailable.
      if (cumulativeRejected.has(aid)) continue;
      if (cumulativeDroppedByProgram.has(aid + '::' + program)) continue;

      // Exclude candidates rejected in ANY profile status type
      const allStatuses = typeof getAllProfileStatusesForCandidate === 'function'
        ? getAllProfileStatusesForCandidate(c)
        : [];
      if (allStatuses.some(s => Number(s.statusId) === 2)) continue;

      const bonus = prefBonus(c, pref, program);
      const effectiveMarks = (c.marksTotal || 0) + bonus;

      // Resolve consent strictly against THIS slot — no flat consentMap
      // fallback. A "Consented" label here means the candidate consented
      // for THIS exact slot (i.e. is its published holder). Anyone else
      // is "In queue" (still awaited).
      const sk = slotKeyFor(c.applicantId, program, quota, specialty, hospital);
      const bySlot = consentBySlot[sk];
      const isPublished = publishedAtThisSlot.has(aid);

      let consentVal;
      if (bySlot === 'Rejected') consentVal = 'Rejected';
      else if (bySlot === 'Dropped') consentVal = 'Dropped';
      else if (bySlot === 'Accepted') consentVal = 'Accepted';
      else if (isPublished) consentVal = 'Awaited'; // published here but no byslot value in this round yet
      else consentVal = 'Awaited'; // applied here, awaiting

      out.push({
        applicantId: c.applicantId,
        nameFull: c.nameFull || '',
        marksTotal: effectiveMarks,
        preferenceNo: pref.preferenceNo,
        consentVal,
        isPublished,
      });
    }
    out.sort((a, b) => (b.marksTotal || 0) - (a.marksTotal || 0)
      || ((a.preferenceNo ?? 999) - (b.preferenceNo ?? 999)));
    return out;
  }

  function renderMlSbOverview() {
    const tbody = document.getElementById('mlSbBody');
    const countEl = document.getElementById('mlSbCount');
    const metaEl = document.getElementById('mlSbMeta');
    if (!tbody) return;
    let acc = 0, faded = 0;
    for (const d of mlSbFiltered) {
      const cv = getRowConsentVal(d);
      if (cv === 'Accepted') acc++; else faded++;
    }
    if (metaEl) {
      metaEl.innerHTML = `
        <div class="cur-meta-grid">
          <div><span class="cur-meta-lbl">Round</span><span class="cur-meta-val">${currentRound}</span></div>
          <div><span class="cur-meta-lbl">Placements shown</span><span class="cur-meta-val">${mlSbFiltered.length.toLocaleString()}</span></div>
          <div><span class="cur-meta-lbl" style="color:var(--neon-green);">Accepted</span><span class="cur-meta-val">${acc.toLocaleString()}</span></div>
          <div><span class="cur-meta-lbl" style="color:var(--neon-gold);">Not consented</span><span class="cur-meta-val">${faded.toLocaleString()}</span></div>
        </div>`;
    }
    if (!mlSbFiltered.length) {
      tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:1rem;color:var(--text-muted);">Pick a programme/quota/specialty/hospital to see the queue, or loosen filters to browse placements.</td></tr>';
      if (countEl) countEl.textContent = '0 placements';
      return;
    }
    const rows = [];
    for (const d of mlSbFiltered) {
      const cv = getRowConsentVal(d);
      const pillClass = cv === 'Accepted' ? 'accepted'
        : cv === 'Excluded-Dropped' ? 'dropped'
        : cv === 'Excluded' ? 'rejected'
        : 'awaited';
      const pillText = cv === 'Accepted' ? 'Accepted'
        : cv === 'Excluded-Dropped' ? 'Dropped Out'
        : cv === 'Excluded' ? 'Excluded'
        : 'Awaited';
      rows.push(`<tr class="ml-sb-row">
        <td style="color:var(--text-muted);font-size:0.78rem;">${fval(d, 'rowNo') ?? '—'}</td>
        <td style="font-family:var(--mono);font-size:0.82rem;">${esc(String(fval(d, 'applicantId') || ''))}</td>
        <td><strong>${esc(fval(d, 'nameFull', 'name') || '—')}</strong></td>
        <td style="font-weight:700;">${fval(d, 'marksTotal', 'marks') != null ? Number(fval(d, 'marksTotal', 'marks')).toFixed(2) : '—'}</td>
        <td style="color:var(--text-muted);">—</td>
        <td>${esc(fval(d, 'typeName', 'type', 'program') || '—')}</td>
        <td style="font-size:0.75rem;font-family:var(--mono);color:var(--text-muted);">${esc(fval(d, 'quotaName', 'quota') || '—')}</td>
        <td style="font-size:0.8rem;">${esc(fval(d, 'specialityName', 'speciality', 'specialty') || '—')}</td>
        <td style="font-size:0.8rem;">${esc(fval(d, 'hospitalName', 'hospital') || '—')}</td>
        <td><span class="ml-sb-pill ${pillClass}">${pillText}</span></td>
      </tr>`);
    }
    tbody.innerHTML = rows.join('');
    if (countEl) countEl.textContent = `${mlSbFiltered.length.toLocaleString()} placement(s) — select all four filters for the full queue`;
  }

  function renderMlSbQueue(program, quota, specialty, hospital, search) {
    const tbody = document.getElementById('mlSbBody');
    const countEl = document.getElementById('mlSbCount');
    const metaEl = document.getElementById('mlSbMeta');
    if (!tbody) return;

    const myId = (typeof SIM !== 'undefined' && SIM.myId) ? String(SIM.myId) : '';
    let myRank = 0;
    let pubCount = 0;
    let queueCount = 0;
    const list = mlSbFiltered.slice();

    // Highlight rows matching the search box.
    const matches = (c) => {
      if (!search) return false;
      const name = (c.nameFull || '').toLowerCase();
      const id = String(c.applicantId || '');
      return name.includes(search) || id.includes(search);
    };

    if (metaEl) {
      pubCount = list.filter(c => c.isPublished).length;
      queueCount = list.length - pubCount;
      metaEl.innerHTML = `
        <div class="cur-meta-grid">
          <div><span class="cur-meta-lbl">Round</span><span class="cur-meta-val">${currentRound}</span></div>
          <div><span class="cur-meta-lbl">Slot</span><span class="cur-meta-val" style="font-size:0.78rem;">${esc(specialty)} @ ${esc(hospital)}</span></div>
          <div><span class="cur-meta-lbl">Program/Quota</span><span class="cur-meta-val" style="font-size:0.78rem;">${esc(program)} · ${esc(quota)}</span></div>
          <div><span class="cur-meta-lbl">Queue size</span><span class="cur-meta-val">${list.length.toLocaleString()}</span></div>
          <div><span class="cur-meta-lbl" style="color:var(--neon-green);">Published</span><span class="cur-meta-val">${pubCount.toLocaleString()}</span></div>
          <div><span class="cur-meta-lbl" style="color:var(--neon-cyan);">In line</span><span class="cur-meta-val">${queueCount.toLocaleString()}</span></div>
          ${myId && myRank ? `<div><span class="cur-meta-lbl" style="color:var(--neon-cyan);">Your rank</span><span class="cur-meta-val">#${myRank}</span></div>` : ''}
        </div>`;
    }

    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:1rem;color:var(--text-muted);">No applicants listed this slot in the candidate pool.</td></tr>';
      if (countEl) countEl.textContent = '0 in queue';
      return;
    }

    const rows = [];
    let cutoffMarked = false;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const rank = i + 1;
      if (myId && String(c.applicantId) === myId) myRank = rank;
      const isMe = myId && String(c.applicantId) === myId;
      const isSearch = matches(c);

      // Insert a section break after the published holders.
      if (!cutoffMarked && i > 0 && c.isPublished !== list[i - 1].isPublished && list[i - 1].isPublished) {
        cutoffMarked = true;
        rows.push(`<tr><td colspan="10" style="background:rgba(245,200,66,0.08);color:var(--neon-gold);font-size:0.78rem;font-weight:600;padding:6px 12px;">—–¼ Next in line (replacement queue for this slot)</td></tr>`);
      }

      const pillClass = c.isPublished
        ? (c.consentVal === 'Accepted' ? 'accepted'
          : c.consentVal === 'Rejected' ? 'rejected'
          : c.consentVal === 'Dropped' ? 'dropped'
          : 'awaited')
        : c.consentVal === 'Dropped' ? 'dropped'
        : c.consentVal === 'Rejected' ? 'rejected'
        : 'queue';
      const pillText = c.isPublished
        ? (c.consentVal === 'Accepted' ? 'Consented'
          : c.consentVal === 'Rejected' ? 'Rejected'
          : c.consentVal === 'Dropped' ? 'Dropped (other prog)'
          : 'Published · awaiting')
        : c.consentVal === 'Dropped' ? 'Dropped (other prog)'
        : c.consentVal === 'Rejected' ? 'Rejected'
        : 'In queue';

      const rowClass = `ml-sb-row${c.isPublished ? ' ml-sb-pub' : ''}${isMe ? ' ml-sb-me' : ''}${isSearch ? ' ml-sb-search' : ''}`;
      const meTag = isMe ? '<span class="ml-sb-me-tag">YOU</span>' : '';
      const searchTag = (isSearch && !isMe) ? '<span class="ml-sb-search-tag">match</span>' : '';
      const rankCls = isMe ? 'ml-sb-rank-me' : '';

      rows.push(`<tr class="${rowClass}">
        <td id="mlSbRank"><span class="${rankCls}">#${rank}</span></td>
        <td style="font-family:var(--mono);font-size:0.82rem;">${esc(String(c.applicantId || ''))}</td>
        <td><strong>${esc(c.nameFull || '—')}</strong>${meTag}${searchTag}</td>
        <td style="font-weight:700;">${c.marksTotal != null ? Number(c.marksTotal).toFixed(2) : '—'}</td>
        <td style="color:var(--text-muted);font-size:0.78rem;">${c.preferenceNo != null ? 'P' + c.preferenceNo : '—'}</td>
        <td>${esc(program)}</td>
        <td style="font-size:0.75rem;font-family:var(--mono);color:var(--text-muted);">${esc(quota)}</td>
        <td style="font-size:0.8rem;">${esc(specialty)}</td>
        <td style="font-size:0.8rem;">${esc(hospital)}</td>
        <td><span class="ml-sb-pill ${pillClass}">${pillText}</span></td>
      </tr>`);
    }
    tbody.innerHTML = rows.join('');

    // If "me" was found, update the meta card with the now-known rank.
    if (myId && myRank && metaEl) {
      metaEl.innerHTML = `
        <div class="cur-meta-grid">
          <div><span class="cur-meta-lbl">Round</span><span class="cur-meta-val">${currentRound}</span></div>
          <div><span class="cur-meta-lbl">Slot</span><span class="cur-meta-val" style="font-size:0.78rem;">${esc(specialty)} @ ${esc(hospital)}</span></div>
          <div><span class="cur-meta-lbl">Program/Quota</span><span class="cur-meta-val" style="font-size:0.78rem;">${esc(program)} · ${esc(quota)}</span></div>
          <div><span class="cur-meta-lbl">Queue size</span><span class="cur-meta-val">${list.length.toLocaleString()}</span></div>
          <div><span class="cur-meta-lbl" style="color:var(--neon-green);">Published</span><span class="cur-meta-val">${pubCount.toLocaleString()}</span></div>
          <div><span class="cur-meta-lbl" style="color:var(--neon-cyan);">In line</span><span class="cur-meta-val">${queueCount.toLocaleString()}</span></div>
          <div><span class="cur-meta-lbl" style="color:var(--neon-cyan);">Your rank</span><span class="cur-meta-val" style="color:var(--neon-cyan);font-weight:700;">#${myRank} of ${list.length}</span></div>
        </div>`;
    }

    if (countEl) {
      countEl.textContent = myId && myRank
        ? `${list.length.toLocaleString()} in queue · You are #${myRank}`
        : `${list.length.toLocaleString()} in queue`;
    }
  }

  function shortReasonForConsent(cv, bySlot) {
    if (cv === 'Excluded-Dropped') return 'Original consented to another programme';
    if (cv === 'Excluded') return bySlot === 'Rejected' ? 'Original rejected in this round' : 'Original not consented (user override)';
    if (cv === 'Awaited') return 'Original has not yet responded';
    return '';
  }

  // —”€—”€ Consent What-If (Merit-list mode) —”€—”€
  //
  // Single applicantId lookup. If the applicant has already consented in the
  // current round —†’ alert + no run. Otherwise locate all merit placements for
  // that applicant and show their next-in-line replacement(s) per slot.

  function renderMlConsentWhatIf() {
    const ctEl = document.getElementById('tab-consent');
    if (!ctEl) return;
    ctEl.innerHTML = `
      <style>
        .ml-cw-card { background:var(--bg-card); border-radius:16px; padding:1.2rem; margin-bottom:1rem; }
        .ml-cw-alert { padding:10px 14px; border-radius:10px; font-weight:600; margin:0.5rem 0 0; }
        .ml-cw-alert.info { background:rgba(77,184,217,0.10); color:var(--neon-cyan); border:1px solid rgba(77,184,217,0.28); }
        .ml-cw-alert.warn { background:rgba(232,166,39,0.12); color:var(--neon-gold); border:1px solid rgba(232,166,39,0.28); }
        .ml-cw-slot { border-left:3px solid var(--neon-green); padding:10px 14px; margin:0.5rem 0; background:rgba(62,207,142,0.04); border-radius:6px; }
      </style>
      <div class="section-header">
        <h2>Consent What-If — Round ${currentRound}</h2>
        <p>Enter an Applicant ID. If they have already consented, you'll be alerted — no simulation needed. If not, we pull each merit slot they hold and show the next-in-line candidate using the merit-list replacement logic.</p>
      </div>
      <div class="ml-cw-card">
        <div class="input-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));">
          <div class="form-group">
            <label for="mlCwAid">Applicant ID</label>
            <input type="number" id="mlCwAid" class="mt-filter-input" placeholder="Applicant ID—€¦" />
          </div>
          <div class="form-group" style="display:flex;align-items:flex-end;gap:8px;">
            <button id="mlCwRunBtn" class="btn btn-primary">Run</button>
            <button id="mlCwClearBtn" class="btn btn-sm">Clear</button>
          </div>
        </div>
        <p class="consent-help" style="margin-top:8px;">Reuses the round's per-merit-row consent resolution (derived in memory from <code>induction21_consent_round${currentRound}.json</code>). Purely advisory — does not modify real PHF consent records.</p>
      </div>
      <div id="mlCwResults"></div>`;
    document.getElementById('mlCwRunBtn')?.addEventListener('click', mlCwRun);
    document.getElementById('mlCwClearBtn')?.addEventListener('click', () => {
      const aidInput = document.getElementById('mlCwAid');
      if (aidInput) aidInput.value = '';
      const res = document.getElementById('mlCwResults');
      if (res) res.innerHTML = '';
    });
    document.getElementById('mlCwAid')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') mlCwRun();
    });
  }

  function mlCwRun() {
    const aidInput = document.getElementById('mlCwAid');
    const res = document.getElementById('mlCwResults');
    if (!aidInput || !res) return;
    const aidRaw = (aidInput.value || '').trim();
    if (!aidRaw) {
      res.innerHTML = '<div class="ml-cw-alert info">Enter an Applicant ID to proceed.</div>';
      return;
    }
    const aid = String(aidRaw);

    // Aggregate current round's statuses for this applicant across all their
    // merit slots. If ANY slot is Accepted (consented) —†’ alert + stop.
    const slots = meritData.filter(d => String(fval(d, 'applicantId')) === aid);
    if (!slots.length) {
      res.innerHTML = `<div class="ml-cw-alert warn">Applicant ID ${esc(aid)} not found in the merit list for round ${currentRound}.</div>`;
      return;
    }
    const acceptedSlot = slots.find(d => getRowConsentVal(d) === 'Accepted');
    if (acceptedSlot) {
      const prog = fval(acceptedSlot, 'typeName', 'type', 'program') || '?';
      res.innerHTML = `<div class="ml-cw-alert info">Applicant ${esc(aid)} has already consented (round ${currentRound}, ${esc(prog)}). No next-in-line needed — keep them placed.</div>`;
      return;
    }

    // Not consented —†’ for each slot, show replacement(s).
    const rowsHtml = [];
    for (const d of slots) {
      const program = fval(d, 'typeName', 'type', 'program') || '';
      const quota = fval(d, 'quotaName', 'quota') || '';
      const specialty = fval(d, 'specialityName', 'speciality', 'specialty') || '';
      const hospital = fval(d, 'hospitalName', 'hospital') || '';
      const key = slotKey(d);
      const cv = getRowConsentVal(d);
      const bySlot = consentBySlot[key] || '';
      const reason = shortReasonForConsent(cv, bySlot) || 'Not consented';

      if (!program || !quota || !specialty || !hospital) continue;

      let chain;
      try {
        chain = listReplacementCandidates(program, quota, specialty, hospital, [key]);
      } catch (_) {
        chain = { candidates: [], skipped: [] };
      }

      const candRows = chain.candidates.length
        ? chain.candidates.slice(0, 5).map(c =>
            `<tr>
              <td style="font-family:var(--mono);font-size:0.82rem;">${esc(String(c.applicantId || ''))}</td>
              <td><strong>${esc(c.nameFull || '—')}</strong></td>
              <td style="font-weight:700;">${c.marksTotal != null ? Number(c.marksTotal).toFixed(2) : '—'}</td>
              <td>Pref #${c.preferenceNo != null ? c.preferenceNo : '?'}</td>
            </tr>`).join('')
        : '<tr><td colspan="4" style="color:var(--text-muted);">No eligible replacement for this slot.</td></tr>';

      rowsHtml.push(`
        <div class="ml-cw-slot">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
            <strong style="color:var(--neon-green);">${esc(specialty)} — ${esc(hospital)}</strong>
            <span style="font-size:0.74rem;color:var(--text-muted);">${esc(program)} · ${esc(quota)} · ${esc(reason)}</span>
          </div>
          <div style="font-size:0.74rem;color:var(--text-muted);margin-bottom:4px;">Original: ${esc(fval(d, 'nameFull', 'name') || '?')} (ID ${esc(aid)})</div>
          <div class="table-wrap" style="max-height:24vh;overflow-y:auto;">
            <table class="data-table" style="font-size:0.8rem;">
              <thead><tr><th>ID</th><th>Name</th><th>Marks</th><th>Pref</th></tr></thead>
              <tbody>${candRows}</tbody>
            </table>
          </div>
        </div>`);
    }
    res.innerHTML = `
      <div class="ml-cw-card">
        <h3 style="margin:0 0 0.5rem;">Next-in-line for Applicant ${esc(aid)}</h3>
        <p style="font-size:0.78rem;color:var(--text-muted);margin:0 0 0.5rem;">${slots.length} merit slot(s) held by this applicant. If they do not consent, the following candidates replace them.</p>
        ${rowsHtml.join('') || '<div class="ml-cw-alert info">No rendered slots.</div>'}
      </div>`;
  }

  // —”€—”€ Start —”€—”€
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