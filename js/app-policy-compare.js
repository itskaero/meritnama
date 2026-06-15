
// ═══════════════════════════════════════════════════════
// CURRENT MERIT TAB
// ═══════════════════════════════════════════════════════

// ── State ──
let _currentState = { induction: null, round: null, candidates: [], meta: null };
let _curFiltersWired = false;

// ── Induction & Round Selectors ──

function populateInductionSelector() {
  const sel = document.getElementById('curInduction');
  if (!sel) return;
  const years = getYears();
  sel.innerHTML = '<option value="">Select induction</option>' +
    years.map(y => `<option value="${y}">${formatInductionLabel(y)}</option>`).join('');
}

function populateRoundSelector(inductionId) {
  const sel = document.getElementById('curRound');
  if (!sel) return;
  // Offer rounds 1-10; the fetch will fail gracefully if a round doesn't exist
  sel.innerHTML = '<option value="">Select round</option>' +
    [1,2,3,4,5,6,7,8,9,10].map(r => `<option value="${r}">Round ${r}</option>`).join('');
}

async function loadMeritRound(indId, round) {
  const url = `/inductions/${indId}/merit/round_${round}.json`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Main entry (called on tab activation) ──

function renderCurrentMerit() {
  // If a previous selection exists, re-render without re-fetching
  if (_currentState.candidates.length) {
    applyCurrentFilters();
    return;
  }
  // Otherwise show prompt
  const tbody = document.getElementById('currentTableBody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="10" class="cur-loading-cell">Select an induction cycle and round, then click Load.</td></tr>';
}

function wireCurrentFilters() {
  if (_curFiltersWired) return;
  ['curProgram', 'curQuota', 'curSearch'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change', applyCurrentFilters);
  });
  _curFiltersWired = true;
}

function setupCurrentMerit() {
  const indSel = document.getElementById('curInduction');
  const roundSel = document.getElementById('curRound');
  const loadBtn = document.getElementById('curLoadBtn');
  if (!indSel || !roundSel || !loadBtn) return;

  populateInductionSelector();

  indSel.addEventListener('change', () => {
    populateRoundSelector(indSel.value);
  });

  loadBtn.addEventListener('click', async () => {
    const ind = indSel.value;
    const rnd = roundSel.value;
    if (!ind || !rnd) return;
    await loadAndRenderCurrentMerit(ind, parseInt(rnd, 10));
  });

  wireCurrentFilters();
}

async function loadAndRenderCurrentMerit(indId, rnd) {
  const tbody   = document.getElementById('currentTableBody');
  const metaEl  = document.getElementById('currentMeta');
  const filters = document.getElementById('curFilters');
  const caption = document.getElementById('currentCaption');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="10" class="cur-loading-cell">Loading merit data&hellip;</td></tr>';

  try {
    const raw = await loadMeritRound(indId, rnd);
    const table  = raw.Table?.[0] || {};
    const table5 = raw.Table5 || [];

    _currentState = { induction: indId, round: rnd, candidates: table5, meta: table };

    // ── Meta card ──
    const accepted = table5.filter(c => c.consent === 'Accepted').length;
    const rejected = table5.filter(c => c.consent === 'Rejected').length;
    const notAvail = table5.filter(c => c.consent === 'Not Avail').length;

    metaEl.classList.remove('hidden');
    metaEl.innerHTML = `
      <div class="cur-meta-grid">
        <div><span class="cur-meta-lbl">Induction</span><span class="cur-meta-val">${formatInductionLabel(indId)}</span></div>
        <div><span class="cur-meta-lbl">Round</span><span class="cur-meta-val">Round ${rnd}</span></div>
        <div><span class="cur-meta-lbl">Total</span><span class="cur-meta-val">${table5.length.toLocaleString()} candidates</span></div>
        <div><span class="cur-meta-lbl" style="color:var(--neon-green)">&#10003; Accepted</span><span class="cur-meta-val">${accepted.toLocaleString()}</span></div>
        <div><span class="cur-meta-lbl" style="color:var(--neon-red)">&#10007; Rejected</span><span class="cur-meta-val">${rejected.toLocaleString()}</span></div>
        <div><span class="cur-meta-lbl" style="color:var(--neon-gold)">&#9888; Not Avail</span><span class="cur-meta-val">${notAvail.toLocaleString()}</span></div>
      </div>
      <div class="cur-meta-bottom" style="margin-top:0.5rem;font-size:0.78rem;color:var(--text-muted);display:flex;justify-content:space-between;flex-wrap:wrap;">
        <span>${esc(raw.Table?.[0]?.displayName || '')}</span>
        <span>${esc(raw.Table?.[0]?.status || '')}</span>
      </div>
    `;

    // ── Populate filters ──
    const programs = [...new Set(table5.map(c => c.type).filter(Boolean))].sort();
    const quotas   = [...new Set(table5.map(c => c.quota).filter(Boolean))].sort();
    populateSelect(document.getElementById('curProgram'), programs);
    populateSelect(document.getElementById('curQuota'),   quotas);
    filters.style.display = '';

    // ── Render table ──
    applyCurrentFilters();
  } catch (err) {
    console.error('[Merit Browser] Load error:', err);
    _currentState = { induction: null, round: null, candidates: [], meta: null };
    metaEl.classList.add('hidden');
    filters.style.display = 'none';
    tbody.innerHTML = `<tr><td colspan="10" class="cur-loading-cell">Failed to load: ${esc(err.message)}</td></tr>`;
    if (caption) caption.textContent = '';
  }
}

function consentBadge(val) {
  if (!val) return '—';
  const map = {
    'Accepted': '<span style="background:rgba(62,207,142,0.12);color:var(--neon-green);padding:2px 8px;border-radius:100px;font-size:0.78rem;">Accepted</span>',
    'Rejected': '<span style="background:rgba(220,60,60,0.12);color:var(--neon-red);padding:2px 8px;border-radius:100px;font-size:0.78rem;">Rejected</span>',
    'Not Avail': '<span style="background:rgba(232,166,39,0.12);color:var(--neon-gold);padding:2px 8px;border-radius:100px;font-size:0.78rem;">Not Avail</span>',
  };
  return map[val] || esc(val);
}

function applyCurrentFilters() {
  const tbody   = document.getElementById('currentTableBody');
  const caption = document.getElementById('currentCaption');
  if (!tbody) return;

  const prog   = document.getElementById('curProgram')?.value || '';
  const quota  = document.getElementById('curQuota')?.value   || '';
  const search = (document.getElementById('curSearch')?.value || '').toLowerCase().trim();

  const data = _currentState.candidates;
  const filtered = data.filter(c =>
    (!prog  || (c.type || '') === prog) &&
    (!quota || (c.quota || '') === quota) &&
    (!search || (c.name || '').toLowerCase().includes(search) ||
                (c.pmdcNo || '').toLowerCase().includes(search) ||
                (c.speciality || '').toLowerCase().includes(search) ||
                (c.hospital || '').toLowerCase().includes(search))
  );

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="cur-loading-cell">No candidates match your filters.</td></tr>';
    if (caption) caption.textContent = '';
    return;
  }

  tbody.innerHTML = filtered.map(c => {
    const marks = c.marks != null ? num(c.marks, 2) : '—';
    return `<tr>
      <td>${c.rowNo ?? '—'}</td>
      <td><strong>${esc(c.name || '—')}</strong></td>
      <td style="font-family:monospace;font-size:0.82rem;">${esc(c.pmdcNo || '—')}</td>
      <td>${esc(c.speciality || '—')}</td>
      <td>${esc(c.hospital || '—')}</td>
      <td>${esc(c.type || '—')}</td>
      <td>${esc(c.quota || '—')}</td>
      <td style="font-weight:700;">${marks}</td>
      <td>${c.preferenceNo ?? '—'}</td>
      <td>${consentBadge(c.consent)}</td>
    </tr>`;
  }).join('');

  if (caption) caption.textContent =
    `Showing ${filtered.length} of ${data.length.toLocaleString()} candidates`;
}

// ═══════════════════════════════════════════════════════
// POLICY TAB (preserved from original)
// ═══════════════════════════════════════════════════════

function renderPolicyTab() {
  const sp = App.data.scoringPolicy;
  if (!sp || !sp.policies) return;
  const policies   = sp.policies;
  const policyKeys = Object.keys(policies).sort();

  const allCompKeys = [], allCompLabels = {};
  for (const key of policyKeys) {
    for (const comp of policies[key].components || []) {
      if (!allCompLabels[comp.key]) { allCompKeys.push(comp.key); allCompLabels[comp.key] = comp.label; }
    }
  }

  // Comparison table
  const table = document.getElementById('policyComparisonTable');
  if (table) {
    const headerCells = policyKeys.map(k => `<th style="white-space:nowrap">${esc(policies[k].label || k)}</th>`).join('');
    const dataRows = allCompKeys.map(ck => {
      const cells = policyKeys.map(pk => {
        const comp = (policies[pk].components || []).find(c => c.key === ck);
        if (!comp) return '<td><span class="policy-cell-na">—</span></td>';
        const inc = comp.included !== false;
        return `<td><span class="${inc ? 'policy-cell-in' : 'policy-cell-out'}">${inc ? comp.max_marks + ' pts' : 'Removed'}</span></td>`;
      }).join('');
      return `<tr><td><strong>${esc(allCompLabels[ck] || ck)}</strong></td>${cells}</tr>`;
    }).join('');
    const totalRow = `<tr class="policy-total-row"><td><strong>Total Marks</strong></td>
      ${policyKeys.map(pk => `<td><strong>${policies[pk].total_marks || '—'}</strong></td>`).join('')}
    </tr>`;
    table.innerHTML = `<thead><tr><th>Component</th>${headerCells}</tr></thead><tbody>${dataRows}${totalRow}</tbody>`;
  }

  // Timeline
  const timeline = document.getElementById('policyTimeline');
  if (!timeline) return;
  timeline.innerHTML = [...policyKeys].reverse().map(key => {
    const pol        = policies[key];
    const isExpected = key.includes('expected') || key === sp.expected_policy;
    const included   = (pol.components || []).filter(c => c.included !== false);
    const excluded   = (pol.components || []).filter(c => c.included === false);
    return `<div class="policy-card${isExpected ? ' policy-card-expected' : ''}">
      <div class="policy-card-header">
        <div class="policy-card-title">
          <span class="policy-card-year">${esc(pol.label || key)}</span>
          ${isExpected ? '<span class="policy-expected-badge">&#9888;&#65039; Expected — Not Confirmed</span>' : ''}
        </div>
        <div class="policy-card-total">${pol.total_marks || '?'} total marks</div>
      </div>
      ${pol.notes ? `<p class="policy-card-notes">${esc(pol.notes)}</p>` : ''}
      <div class="policy-components-grid">
        ${included.map(c => `<div class="policy-comp-pill policy-comp-in">
          <span class="policy-comp-name">${esc(c.label)}</span>
          <span class="policy-comp-marks">${c.max_marks} pts</span>
        </div>`).join('')}
        ${excluded.map(c => `<div class="policy-comp-pill policy-comp-out">
          <span class="policy-comp-name">${esc(c.label)}</span>
          <span class="policy-comp-marks">Not included</span>
        </div>`).join('')}
      </div>
      ${pol.tidbits?.length ? `<div class="policy-tidbits"><h4>&#128161; Key Notes</h4><ul>${pol.tidbits.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}
    </div>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════
// COMPETITION RATIO / DEMAND INDEX
// ═══════════════════════════════════════════════════════

let _compData = null;

function setupCompetitionTab() {
  const compProg = document.getElementById('compProgram');
  const compQuota = document.getElementById('compQuota');
  if (!compProg || !compQuota) return;   // element not present on this page
  populateSelect(compProg, getPrograms());
  populateSelect(compQuota, getQuotas());

  compProg.addEventListener('change', renderCompetitionTab);
  compQuota.addEventListener('change', renderCompetitionTab);
  document.getElementById('compSearch')?.addEventListener('input', renderCompetitionTab);
  document.getElementById('compSort')?.addEventListener('change', renderCompetitionTab);
}

async function loadCompetitionData() {
  if (_compData) return _compData;
  try {
    const [candRes, seatsRes] = await Promise.all([
      fetch('data/induction21_candidates.json'),
      fetch('data/induction21_seats.json')
    ]);
    if (!candRes.ok || !seatsRes.ok) return null;
    const candRaw = await candRes.json();
    const candidates = Array.isArray(candRaw) ? candRaw : (candRaw.candidates || Object.values(candRaw));
    const seats = await seatsRes.json();

    // Build seat lookup: prog|quota|specialty → total seats
    const seatMap = {};
    for (const s of seats) {
      const key = `${s.typeName}|${s.quotaName}|${s.specialityName}`;
      seatMap[key] = (seatMap[key] || 0) + s.seats;
    }

    // Count applicants per specialty (from preferences)
    const applicantMap = {};
    for (const c of candidates) {
      if (!c.preference) continue;
      for (const [prog, prefs] of Object.entries(c.preference)) {
        const seen = new Set();
        for (const p of prefs) {
          const key = `${prog}|${p.quotaName}|${p.specialityName}`;
          if (!seen.has(key)) {
            seen.add(key);
            applicantMap[key] = (applicantMap[key] || 0) + 1;
          }
        }
      }
    }

    // Merge
    const result = [];
    const allKeys = new Set([...Object.keys(seatMap), ...Object.keys(applicantMap)]);
    for (const key of allKeys) {
      const [prog, quota, specialty] = key.split('|');
      const totalSeats = seatMap[key] || 0;
      const applicants = applicantMap[key] || 0;
      const ratio = totalSeats > 0 ? (applicants / totalSeats) : (applicants > 0 ? Infinity : 0);
      result.push({ prog, quota, specialty, totalSeats, applicants, ratio });
    }
    _compData = result;
    return result;
  } catch (e) {
    console.error('[Competition] Load error:', e);
    return null;
  }
}

async function renderCompetitionTab() {
  const container = document.getElementById('compResults');
  const data = await loadCompetitionData();
  if (!data) {
    container.innerHTML = '<div class="card" style="text-align:center;padding:2rem;color:var(--text-muted)">Competition data unavailable. Requires induction21_candidates.json and induction21_seats.json.</div>';
    return;
  }

  const prog = document.getElementById('compProgram').value;
  const quota = document.getElementById('compQuota').value;
  const search = (document.getElementById('compSearch').value || '').toLowerCase();
  const sort = document.getElementById('compSort').value;

  let filtered = data.filter(r =>
    (!prog || r.prog === prog) &&
    (!quota || r.quota === quota) &&
    (!search || r.specialty.toLowerCase().includes(search))
  );

  // Sort
  if (sort === 'ratio-desc') filtered.sort((a, b) => b.ratio - a.ratio);
  else if (sort === 'ratio-asc') filtered.sort((a, b) => a.ratio - b.ratio);
  else if (sort === 'specialty') filtered.sort((a, b) => a.specialty.localeCompare(b.specialty));
  else if (sort === 'applicants-desc') filtered.sort((a, b) => b.applicants - a.applicants);

  if (!filtered.length) {
    container.innerHTML = '<div class="card" style="text-align:center;padding:2rem;color:var(--text-muted)">No results found.</div>';
    return;
  }

  // Summary stats
  const totalApplicants = filtered.reduce((s, r) => s + r.applicants, 0);
  const totalSeats = filtered.reduce((s, r) => s + r.totalSeats, 0);
  const avgRatio = totalSeats > 0 ? (totalApplicants / totalSeats).toFixed(1) : '—';
  const finiteRatios = filtered.filter(r => r.ratio !== Infinity && isFinite(r.ratio)).map(r => r.ratio);
  const maxRatio = finiteRatios.length > 0 ? Math.max(...finiteRatios) : 1;

  const rows = filtered.slice(0, 100).map(r => {
    const ratioStr = r.ratio === Infinity ? '∞' : r.ratio.toFixed(1);
    const displayRatio = r.ratio === Infinity ? maxRatio : r.ratio;
    const barWidth = maxRatio > 0 ? Math.min(100, (displayRatio / maxRatio) * 100) : 0;
    const heatColor = r.ratio > 10 ? 'var(--neon-red, #dc3c3c)' : r.ratio > 5 ? 'var(--neon-gold, #e8a627)' : 'var(--neon-green, #3ecf8e)';
    return `<tr>
      <td>${esc(r.specialty)}</td>
      <td>${esc(r.prog)}</td>
      <td>${esc(r.quota)}</td>
      <td style="text-align:right">${r.totalSeats}</td>
      <td style="text-align:right">${r.applicants}</td>
      <td style="text-align:right;font-weight:700;color:${heatColor};">${ratioStr}:1</td>
      <td style="width:120px;"><div style="background:${heatColor};height:8px;border-radius:4px;width:${barWidth}%;opacity:0.7;"></div></td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="card" style="margin-bottom:1rem;padding:1rem;">
      <div style="display:flex;gap:2rem;flex-wrap:wrap;font-size:0.85rem;">
        <div><strong style="color:var(--neon-cyan);">${filtered.length}</strong> specialties shown</div>
        <div>Total seats: <strong>${totalSeats.toLocaleString()}</strong></div>
        <div>Total applications: <strong>${totalApplicants.toLocaleString()}</strong></div>
        <div>Average ratio: <strong>${avgRatio}:1</strong></div>
      </div>
    </div>
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr>
          <th>Specialty</th><th>Program</th><th>Quota</th>
          <th style="text-align:right">Seats</th>
          <th style="text-align:right">Applicants</th>
          <th style="text-align:right">Ratio</th>
          <th>Demand</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${filtered.length > 100 ? '<p style="font-size:0.78rem;color:var(--text-muted);margin-top:0.5rem;">Showing top 100 results.</p>' : ''}`;
}

// ═══════════════════════════════════════════════════════
// SEAT MATRIX DASHBOARD
// ═══════════════════════════════════════════════════════

let _seatData = null;

function setupSeatMatrixTab() {
  const smProg = document.getElementById('smProgram');
  const smQuota = document.getElementById('smQuota');
  if (!smProg || !smQuota) return;   // element not present on this page
  populateSelect(smProg, getPrograms());
  populateSelect(smQuota, getQuotas());

  smProg.addEventListener('change', renderSeatMatrixTab);
  smQuota.addEventListener('change', renderSeatMatrixTab);
  document.getElementById('smSearch')?.addEventListener('input', renderSeatMatrixTab);
}

async function loadSeatData() {
  if (_seatData) return _seatData;
  try {
    const res = await fetch('data/induction21_seats.json');
    if (!res.ok) return null;
    _seatData = await res.json();
    return _seatData;
  } catch (e) { return null; }
}

async function renderSeatMatrixTab() {
  const container = document.getElementById('smResults');
  const summary = document.getElementById('smSummary');
  const seats = await loadSeatData();
  if (!seats) {
    container.innerHTML = '<div class="card" style="text-align:center;padding:2rem;color:var(--text-muted)">Seat data unavailable.</div>';
    return;
  }

  const prog = document.getElementById('smProgram').value;
  const quota = document.getElementById('smQuota').value;
  const search = (document.getElementById('smSearch').value || '').toLowerCase();

  let filtered = seats.filter(s =>
    (!prog || s.typeName === prog) &&
    (!quota || s.quotaName === quota) &&
    (!search || s.specialityName.toLowerCase().includes(search) || s.hospitalName.toLowerCase().includes(search))
  );

  // Group by specialty
  const bySpec = {};
  for (const s of filtered) {
    if (!bySpec[s.specialityName]) bySpec[s.specialityName] = { totalSeats: 0, hospitals: [] };
    bySpec[s.specialityName].totalSeats += s.seats;
    bySpec[s.specialityName].hospitals.push(s);
  }

  const totalSeats = filtered.reduce((sum, s) => sum + s.seats, 0);
  const totalHospitals = new Set(filtered.map(s => s.hospitalName)).size;
  const specCount = Object.keys(bySpec).length;

  // Summary
  summary.classList.remove('hidden');
  summary.innerHTML = `
    <div class="pred-hero-right" style="width:100%;">
      <div class="pred-hero-stats" style="justify-content:flex-start;gap:2rem;">
        <div><span class="pred-hero-val" style="color:var(--neon-cyan)">${totalSeats}</span><span class="pred-hero-lbl">Total Seats</span></div>
        <div><span class="pred-hero-val" style="color:var(--neon-purple)">${specCount}</span><span class="pred-hero-lbl">Specialties</span></div>
        <div><span class="pred-hero-val" style="color:var(--neon-green)">${totalHospitals}</span><span class="pred-hero-lbl">Hospitals</span></div>
        <div><span class="pred-hero-val">${filtered.length}</span><span class="pred-hero-lbl">Slots</span></div>
      </div>
    </div>`;

  // Render specialty cards
  const specNames = Object.keys(bySpec).sort();
  const cards = specNames.map(spec => {
    const data = bySpec[spec];
    const hospRows = data.hospitals.sort((a, b) => b.seats - a.seats).map(h => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid var(--border);">
        <span style="font-size:0.8rem;">${esc(h.hospitalName)}</span>
        <span style="font-size:0.8rem;font-weight:700;color:var(--neon-cyan);min-width:30px;text-align:right;">${h.seats}</span>
      </div>`).join('');

    return `<div class="card" style="margin-bottom:0.75rem;padding:1rem;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
        <strong style="color:var(--text);font-size:0.92rem;">${esc(spec)}</strong>
        <span style="background:rgba(77,184,217,0.1);color:var(--neon-cyan);padding:2px 10px;border-radius:100px;font-weight:700;font-size:0.82rem;">${data.totalSeats} seats</span>
      </div>
      <div style="max-height:200px;overflow-y:auto;">${hospRows}</div>
    </div>`;
  }).join('');

  container.innerHTML = cards || '<div style="text-align:center;color:var(--text-muted);padding:2rem;">No seats found.</div>';
}

// ═══════════════════════════════════════════════════════
// SPECIALTY COMPARISON TOOL
// ═══════════════════════════════════════════════════════

function setupCompareTab() {
  const cmpProg = document.getElementById('cmpProgram');
  if (!cmpProg) return;
  populateSelect(cmpProg, getPrograms(), 'FCPS');
  cmpProg.value = 'FCPS';

  function populateCompareSelects() {
    const prog = cmpProg.value || 'FCPS';
    const options = App.data.flatLookup
      .filter(r => r.program === prog)
      .map(r => `${r.specialty} — ${r.hospital} (${r.quota})`)
      .sort();

    for (let i = 1; i <= 3; i++) {
      const sel = document.getElementById(`cmpSpec${i}`);
      const cur = sel.value;
      sel.innerHTML = '<option value="">Select specialty – hospital</option>' +
        options.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
      if (options.includes(cur)) sel.value = cur;
    }
  }

  populateCompareSelects();
  cmpProg.addEventListener('change', populateCompareSelects);
  document.getElementById('cmpBtn').addEventListener('click', runComparison);
}

function runComparison() {
  const prog = document.getElementById('cmpProgram').value || 'FCPS';
  const selections = [];
  for (let i = 1; i <= 3; i++) {
    const val = document.getElementById(`cmpSpec${i}`).value;
    if (val) selections.push(val);
  }

  if (selections.length < 2) {
    alert('Select at least 2 combinations to compare.');
    return;
  }

  // Parse selections and find matching rows
  const rows = selections.map(sel => {
    // Format: "Specialty — Hospital (Quota)"
    const match = sel.match(/^(.+?)\s*—\s*(.+?)\s*\((.+?)\)$/);
    if (!match) return null;
    const [, spec, hosp, quota] = match;
    return App.data.flatLookup.find(r =>
      r.program === prog &&
      r.specialty === spec.trim() &&
      r.hospital === hosp.trim() &&
      r.quota === quota.trim()
    );
  }).filter(Boolean);

  if (rows.length < 2) {
    document.getElementById('cmpResults').classList.remove('hidden');
    document.getElementById('cmpResults').innerHTML = '<div class="card" style="padding:1.5rem;text-align:center;color:var(--text-muted)">Could not find matching data for selections.</div>';
    return;
  }

  const years = getYears();
  const activeMax = getActivePolicyMax();

  // Build comparison table
  const metrics = [
    { label: 'Avg Closing (% of Max)', fn: r => num(r.avg_pct_of_max, 1) + '%' },
    { label: 'Latest Closing (% of Max)', fn: r => num(r.latest_pct_of_max, 1) + '%' },
    { label: 'Latest Closing (Raw)', fn: r => num(r.latest_merit, 2) },
    { label: 'Trend', fn: r => trendBadge(r.trend) },
    { label: 'Volatility', fn: r => volBadge(r.volatility) },
    { label: 'Confidence', fn: r => confBadge(r.confidence) },
    { label: 'Data Points', fn: r => r.data_points || '—' },
    { label: 'Std Deviation', fn: r => num(r.stddev, 2) },
  ];

  // Add yearly rows
  for (const yr of years.slice(-5)) {
    metrics.push({
      label: `${formatYearShort(yr)} Cutoff`,
      fn: r => r.yearly_merit?.[yr] != null ? num(r.yearly_merit[yr], 2) : '—'
    });
    metrics.push({
      label: `${formatYearShort(yr)} Seats`,
      fn: r => r.yearly_seats?.[yr] ?? '—'
    });
  }

  const headerCells = rows.map(r => `<th style="min-width:160px;"><div style="font-weight:700;color:var(--neon-cyan);font-size:0.85rem;">${esc(r.specialty)}</div><div style="font-size:0.72rem;color:var(--text-muted);">${esc(r.hospital)}</div><div style="font-size:0.68rem;color:var(--text-light);">${esc(r.quota)}</div></th>`).join('');

  const metricRows = metrics.map(m => {
    const cells = rows.map(r => `<td>${m.fn(r)}</td>`).join('');
    return `<tr><td style="font-weight:600;font-size:0.8rem;white-space:nowrap;">${m.label}</td>${cells}</tr>`;
  }).join('');

  document.getElementById('cmpResults').classList.remove('hidden');
  document.getElementById('cmpResults').innerHTML = `
    <div class="card" style="margin-top:1.5rem;overflow-x:auto;">
      <table class="data-table">
        <thead><tr><th>Metric</th>${headerCells}</tr></thead>
        <tbody>${metricRows}</tbody>
      </table>
    </div>`;
}

// Handle URL params
function handleURLParams() {
  const p     = new URLSearchParams(window.location.search);
  const tab   = p.get('tab');
  const merit = parseFloat(p.get('merit'));
  if (tab) switchToTab(tab);
  if (!isNaN(merit)) {
    const el = document.getElementById('predMerit');
    if (el) el.value = merit;
    if (!tab) switchToTab('predictor');
    runPredictor();
  }
}

// ═══════════════════════════════════════════════════════
// INITIALISE
// ═══════════════════════════════════════════════════════

function populateAllFilters() {
  const programs = getPrograms();
  const quotas   = getQuotas();

  // Merit table
  populateSelect(document.getElementById('mtProgram'), programs);
  populateSelect(document.getElementById('mtQuota'),   quotas);

  // Predictor
  populateSelect(document.getElementById('predProgram'), programs);
  populateSelect(document.getElementById('predQuota'),   quotas);
}

// ═══════════════════════════════════════════════════════
// HOSPITALS TAB
// ═══════════════════════════════════════════════════════

let _hospTabData = null;
let _hospTabSearchWired = false;

async function renderHospitalsTab() {
  const grid = document.getElementById('hospTabGrid');
  if (!grid) return;

  // Lazy-load (reuse _seatData if already fetched by seat matrix tab)
  if (!_hospTabData) {
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:3rem 1rem;color:var(--text-muted);">Loading hospitals&hellip;</div>';
    const seats = await loadSeatData();
    if (!seats) {
      grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:3rem 1rem;color:var(--text-muted);">Hospital data unavailable.</div>';
      return;
    }
    const map = {};
    for (const entry of seats) {
      const id = entry.hospitalId || entry.hospital_id || entry.hospitalName;
      if (!map[id]) {
        map[id] = { id, name: entry.hospitalName, specialties: new Set(), types: new Set(), totalSeats: 0 };
      }
      map[id].specialties.add(entry.specialityName || entry.specialty);
      map[id].types.add(entry.typeName || entry.type);
      map[id].totalSeats += (entry.seats || 0);
    }
    _hospTabData = Object.values(map).sort((a, b) => a.name.localeCompare(b.name));
  }

  // Wire search once
  if (!_hospTabSearchWired) {
    const inp = document.getElementById('hospTabSearch');
    if (inp) {
      inp.addEventListener('input', function () {
        const q = this.value.trim().toLowerCase();
        renderHospTabGrid(q ? _hospTabData.filter(h => h.name.toLowerCase().includes(q)) : _hospTabData);
      });
    }
    _hospTabSearchWired = true;
  }

  renderHospTabGrid(_hospTabData);
}

function renderHospTabGrid(hospitals) {
  const grid = document.getElementById('hospTabGrid');
  if (!grid) return;
  if (!hospitals.length) {
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:3rem 1rem;color:var(--text-muted);">No hospitals found.</div>';
    return;
  }
  grid.innerHTML = hospitals.map(h => {
    const specs = Array.from(h.specialties).sort().join(', ');
    const types = Array.from(h.types).sort().join(', ');
    return `<a href="hospital.html?id=${encodeURIComponent(h.id)}" style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:1.2rem 1.4rem;text-decoration:none;color:var(--text);display:flex;flex-direction:column;gap:0.6rem;transition:border-color 0.2s,transform 0.15s,box-shadow 0.2s;" onmouseover="this.style.borderColor='var(--border-hover)';this.style.transform='translateY(-2px)';" onmouseout="this.style.borderColor='var(--border)';this.style.transform='';">
      <div style="font-size:1rem;font-weight:700;color:var(--neon-cyan);line-height:1.3;">${esc(h.name)}</div>
      <div style="display:flex;flex-wrap:wrap;gap:0.5rem;font-size:0.78rem;">
        <span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:100px;border:1px solid rgba(62,207,142,0.3);background:rgba(62,207,142,0.07);color:var(--neon-green);">&#129681; ${h.totalSeats} seats</span>
        <span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:100px;border:1px solid rgba(124,101,196,0.3);background:rgba(124,101,196,0.07);color:var(--neon-purple);">&#129657; ${h.specialties.size} specialties</span>
        <span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:100px;border:1px solid rgba(232,166,39,0.3);background:rgba(232,166,39,0.07);color:var(--neon-gold);">&#128220; ${esc(types)}</span>
      </div>
      <div style="font-size:0.77rem;color:var(--text-muted);line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${esc(specs)}</div>
    </a>`;
  }).join('');
}
