
// ═══════════════════════════════════════════════════════
// MY PREDICTION TAB (consolidated predictor + strategy)
// ═══════════════════════════════════════════════════════

const RECENT_KEY = 'mn_recent_scores';
const MAX_RECENT = 5;

function getRecentScores() { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; } }
function saveRecentScore(s) {
  let arr = getRecentScores().filter(v => v !== s);
  arr.unshift(s);
  localStorage.setItem(RECENT_KEY, JSON.stringify(arr.slice(0, MAX_RECENT)));
}
function renderPredRecentScores() {
  const scores = getRecentScores();
  const bar    = document.getElementById('predRecentBar');
  const list   = document.getElementById('predRecentList');
  if (!bar || !list) return;
  if (!scores.length) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  list.innerHTML = scores.map(s => `<button class="recent-chip" data-score="${s}">${s}</button>`).join('');
}

function setupPredictorTab() {
  if (!document.getElementById('predBtn')) return;
  document.getElementById('predBtn').addEventListener('click', runPredictor);
  document.getElementById('predMerit').addEventListener('keydown', e => { if (e.key === 'Enter') runPredictor(); });

  function syncPredHints() {
    const prog  = document.getElementById('predProgram');
    const quota = document.getElementById('predQuota');
    document.getElementById('predProgramHint')?.classList.toggle('visible', !prog.value);
    document.getElementById('predQuotaHint')?.classList.toggle('visible',  !quota.value);
  }

  document.getElementById('predProgram').addEventListener('change', () => {
    populateSelect(document.getElementById('predQuota'), getQuotas(document.getElementById('predProgram').value));
    syncPredHints();
  });
  document.getElementById('predQuota').addEventListener('change', syncPredHints);
  syncPredHints();

  document.getElementById('predRecentList')?.addEventListener('click', e => {
    const chip = e.target.closest('.recent-chip');
    if (!chip) return;
    const v = parseFloat(chip.dataset.score);
    if (!isNaN(v)) { document.getElementById('predMerit').value = v; runPredictor(); }
  });
  document.getElementById('predClearRecent')?.addEventListener('click', () => {
    localStorage.removeItem(RECENT_KEY);
    renderPredRecentScores();
  });

  document.querySelectorAll('#tab-predictor .pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('#tab-predictor .pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      renderPredBuckets(App.ui.predResults, pill.dataset.filter);
    });
  });
  document.getElementById('predSearch')?.addEventListener('input', () => {
    const f = document.querySelector('#tab-predictor .pill.active')?.dataset.filter || 'all';
    renderPredBuckets(App.ui.predResults, f);
  });
  document.getElementById('predExportPdfBtn')?.addEventListener('click', exportPredictionPdf);

  // Live % of max preview as user types
  function updateMeritPctPreview() {
    const el    = document.getElementById('predMerit');
    const label = document.getElementById('predMeritPct');
    if (!el || !label) return;
    const merit = parseFloat(el.value);
    const max   = getActivePolicyMax();
    if (!isNaN(merit) && merit > 0 && max) {
      const pct = (merit / max) * 100;
      label.textContent = `= ${pct.toFixed(1)}% of ${max} marks`;
      label.classList.remove('hidden');
    } else {
      label.classList.add('hidden');
    }
  }
  document.getElementById('predMerit').addEventListener('input', updateMeritPctPreview);
  updateMeritPctPreview();

  renderPredRecentScores();
  // Auto-fill from saved calculator merit
  const saved = getSavedCalcMerit();
  if (saved) {
    const el = document.getElementById('predMerit');
    if (el && !el.value) { el.value = saved.total.toFixed(2); updateMeritPctPreview(); }
  }
}

function runPredictor() {
  const merit  = parseFloat(document.getElementById('predMerit').value);
  const prog   = document.getElementById('predProgram').value;
  const quota  = document.getElementById('predQuota').value;
  if (isNaN(merit)) { (window.MN ? MN.toast.warning : alert)('Please enter a valid merit score.'); return; }

  const policyMax = getActivePolicyMax();
  if (!policyMax) { (window.MN ? MN.toast.warning : alert)('Policy data not loaded.'); return; }

  const userPct = (merit / policyMax) * 100;

  // Classify each record into safe / target / reach
  const results = App.data.flatLookup
    .filter(r => (!prog || r.program === prog) && (!quota || r.quota === quota) && r.avg_pct_of_max != null)
    .map(r => {
      const delta = userPct - r.avg_pct_of_max;
      let bucket;
      if (delta >= 3.0)   bucket = 'safe';
      else if (delta >= -5.0)  bucket = 'target';
      else if (delta >= -15.0) bucket = 'reach';
      else return null;

      // Trend projection (qualitative)
      let projection = null;
      if (r.latest_pct_of_max != null) {
        const base   = r.latest_pct_of_max;
        const shift  = r.trend === 'rising' ? 2 : r.trend === 'falling' ? -2 : 0;
        const spread = r.volatility === 'high' ? 6 : r.volatility === 'medium' ? 3 : 1.5;
        projection = {
          low:   parseFloat(Math.max(0,   base + shift - spread).toFixed(1)),
          high:  parseFloat(Math.min(100, base + shift + spread).toFixed(1)),
          trend: r.trend,
          vol:   r.volatility,
        };
      }
      return { ...r, userPct, delta, bucket, projection };
    })
    .filter(Boolean);

  App.ui.predResults = results;

  // Percentile
  const allPcts    = App.data.flatLookup.map(r => r.avg_pct_of_max).filter(v => v != null);
  const percentile = getPercentile(userPct, allPcts);
  const band       = getMeritBand(userPct, allPcts);

  App.ui.predContext = { merit, prog, quota, userPct, percentile, band };

  const safeN   = results.filter(r => r.bucket === 'safe').length;
  const targetN = results.filter(r => r.bucket === 'target').length;
  const reachN  = results.filter(r => r.bucket === 'reach').length;

  // Show hero
  const hero = document.getElementById('predHero');
  hero.classList.remove('hidden');
  document.getElementById('predPctNum').textContent   = percentile;
  document.getElementById('predBandVal').textContent  = `${band.emoji} ${band.label}`;
  document.getElementById('predSafeCount').textContent   = safeN;
  document.getElementById('predTargetCount').textContent = targetN;
  document.getElementById('predReachCount').textContent  = reachN;

  const highConf = results.filter(r => r.confidence === 'high').length;
  const confPct  = results.length > 0 ? Math.round(highConf / results.length * 100) : 0;
  document.getElementById('predConfNote').textContent =
    `${confPct}% of predictions have high confidence (4+ years of data)`;

  // Distribution chart
  Charts.drawPredDistributionChart('predDistChart', allPcts, userPct);

  // Policy notice
  const activePol = getActivePolicyForCalc();
  const noticeEl  = document.getElementById('predPolicyNotice');
  if (activePol && noticeEl) {
    noticeEl.textContent = `Score normalised using: ${activePol.policy.label || activePol.key} (${policyMax} marks max) → ${userPct.toFixed(1)}% of max`;
    noticeEl.classList.remove('hidden');
  }

  document.getElementById('predResults').classList.remove('hidden');

  // Show quota warning when no quota is selected (same hospital can appear in multiple buckets)
  const quotaWarn = document.getElementById('predQuotaWarn');
  if (quotaWarn) quotaWarn.classList.toggle('hidden', !!quota);

  renderPredBuckets(results, 'all');

  saveRecentScore(merit);
  renderPredRecentScores();
}

function renderPredBuckets(results, filter = 'all') {
  const search = document.getElementById('predSearch')?.value.toLowerCase().trim() || '';
  let filtered = filter === 'all' ? results : results.filter(r => r.bucket === filter);
  if (search) filtered = filtered.filter(r =>
    r.specialty.toLowerCase().includes(search) || r.hospital.toLowerCase().includes(search));

  const safeRows   = filtered.filter(r => r.bucket === 'safe')  .sort((a, b) => b.delta - a.delta);
  const targetRows = filtered.filter(r => r.bucket === 'target').sort((a, b) => b.delta - a.delta);
  const reachRows  = filtered.filter(r => r.bucket === 'reach') .sort((a, b) => b.delta - a.delta);

  const bucketsEl = document.getElementById('predBuckets');

  if (filter === 'all') {
    bucketsEl.className = 'pred-buckets pred-buckets-3col';
    bucketsEl.innerHTML = `
      <div class="pred-bucket pred-bucket-safe">
        <div class="pred-bucket-header safe-header">
          <h3>&#128737; Safe</h3>
          <span class="pred-bucket-count">${safeRows.length}</span>
          <p>Your score comfortably exceeds historical cutoffs</p>
        </div>
        <div class="pred-bucket-items">${predItemsHtml(safeRows)}</div>
      </div>
      <div class="pred-bucket pred-bucket-target">
        <div class="pred-bucket-header target-header">
          <h3>&#127919; Target</h3>
          <span class="pred-bucket-count">${targetRows.length}</span>
          <p>Within range &mdash; worth applying</p>
        </div>
        <div class="pred-bucket-items">${predItemsHtml(targetRows)}</div>
      </div>
      <div class="pred-bucket pred-bucket-reach">
        <div class="pred-bucket-header reach-header">
          <h3>&#128640; Reach</h3>
          <span class="pred-bucket-count">${reachRows.length}</span>
          <p>Below avg but possible if trend is falling</p>
        </div>
        <div class="pred-bucket-items">${predItemsHtml(reachRows)}</div>
      </div>
    `;
  } else {
    bucketsEl.className = 'pred-buckets pred-buckets-flat';
    const all = [...safeRows, ...targetRows, ...reachRows];
    bucketsEl.innerHTML = `<div class="pred-flat-list">${predItemsHtml(all, true)}</div>`;
  }
}

function predItemsHtml(rows, showBucket = false) {
  if (!rows.length) return '<p class="pred-empty">None in this category for your filters.</p>';
  return rows.slice(0, 40).map(r => {
    const deltaStr = (r.delta >= 0 ? '+' : '') + num(r.delta, 1) + '%';
    const deltaCls = r.delta >= 3 ? 'delta-safe' : r.delta >= -5 ? 'delta-target' : 'delta-reach';

    let projHtml = '';
    if (r.projection) {
      const p = r.projection;
      const icon = p.trend === 'rising' ? '&#8593;' : p.trend === 'falling' ? '&#8595;' : '&#8594;';
      const cls  = `trend-${p.trend}`;
      projHtml = `<span class="pred-item-proj ${cls}" title="Projected range for next induction">${icon} ${p.low}–${p.high}%</span>`;
    }

    const bucketTag = showBucket
      ? `<span class="pred-bucket-tag pred-bucket-tag-${r.bucket}">${r.bucket}</span>`
      : '';

    return `<div class="pred-item pred-item-${r.bucket}">
      ${bucketTag}
      <div class="pred-item-main">
        <div class="pred-item-spec">${esc(r.specialty)}</div>
        <div class="pred-item-hosp">${esc(r.hospital)}</div>
        <div class="pred-item-meta">${esc(r.program)}${r.quota ? ' &middot; ' + esc(r.quota) : ''}</div>
      </div>
      <div class="pred-item-stats">
        <span class="pred-item-avg">Avg: ${r.avg_pct_of_max != null ? num(r.avg_pct_of_max, 1) + '%' : num(r.avg_closing_merit)}</span>
        <span class="pred-item-delta ${deltaCls}">${deltaStr}</span>
        ${projHtml}
        ${confBadge(r.confidence)}
      </div>
    </div>`;
  }).join('');
}

// ── Lightweight jsPDF table drawer (self-contained — the donor-gated,
// watermarked table drawer in js/sim-placement.js is specific to the
// simulation portal's bulk candidate-PII exports and isn't loaded here) ──
function drawSimpleTable(doc, columns, rows, yStart, left, maxY) {
  let y = yStart;
  const rowH = 14;
  function drawHeader() {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    let x = left;
    columns.forEach(c => { doc.text(String(c.label), x, y); x += c.w; });
    y += 12;
    doc.setDrawColor(200, 200, 200);
    doc.line(left, y - 8, left + columns.reduce((s, c) => s + c.w, 0), y - 8);
    doc.setFont('helvetica', 'normal');
  }
  drawHeader();
  rows.forEach(r => {
    if (y > maxY) { doc.addPage(); y = 48; drawHeader(); }
    let x = left;
    columns.forEach(c => {
      let val = String(c.value(r));
      if (val.length > 34) val = val.slice(0, 32) + '…';
      doc.text(val, x, y);
      x += c.w;
    });
    y += rowH;
  });
  return y;
}

function exportPredictionPdf() {
  const jsPDF = window.jspdf?.jsPDF;
  if (!jsPDF) { (window.MN ? MN.toast.danger : alert)('PDF library did not load. Check your connection and retry.'); return; }
  const ctx = App.ui.predContext;
  const results = App.ui.predResults;
  if (!ctx || !results || !results.length) {
    (window.MN ? MN.toast.warning : alert)('Run a prediction first.');
    return;
  }

  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const left = 42;
  const maxY = 770;
  let y = 48;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('MeritNama — My Prediction Report', left, y);
  y += 22;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(110, 120, 140);
  doc.text(`Generated: ${new Date().toLocaleString('en-PK')}`, left, y);
  doc.setTextColor(20, 35, 55);
  y += 20;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text(`Merit Score: ${ctx.merit}  (${ctx.userPct.toFixed(1)}% of policy max)`, left, y);
  y += 16;
  doc.setFont('helvetica', 'normal');
  doc.text(`Percentile: ${ctx.percentile}  ·  Band: ${ctx.band.label}`, left, y);
  y += 14;
  doc.text(`Program: ${ctx.prog || 'All Programs'}  ·  Quota: ${ctx.quota || 'All Quotas'}`, left, y);
  y += 20;

  const safeN = results.filter(r => r.bucket === 'safe').length;
  const targetN = results.filter(r => r.bucket === 'target').length;
  const reachN = results.filter(r => r.bucket === 'reach').length;
  doc.setFont('helvetica', 'bold');
  doc.text(`Safe: ${safeN}   Target: ${targetN}   Reach: ${reachN}`, left, y);
  y += 22;
  doc.setFont('helvetica', 'normal');

  const order = { safe: 0, target: 1, reach: 2 };
  const sorted = results.slice().sort((a, b) => order[a.bucket] - order[b.bucket] || b.delta - a.delta);

  y = drawSimpleTable(doc, [
    { label: 'Bucket', w: 46, value: r => r.bucket },
    { label: 'Specialty', w: 150, value: r => r.specialty },
    { label: 'Hospital', w: 150, value: r => r.hospital },
    { label: 'Quota', w: 70, value: r => r.quota || '—' },
    { label: 'Avg %', w: 46, value: r => r.avg_pct_of_max != null ? num(r.avg_pct_of_max, 1) : '—' },
    { label: 'Delta', w: 46, value: r => (r.delta >= 0 ? '+' : '') + num(r.delta, 1) },
  ], sorted.slice(0, 200), y, left, maxY);

  if (sorted.length > 200) {
    y += 8;
    doc.setFontSize(8);
    doc.text(`Note: showing first 200 of ${sorted.length} matching combinations.`, left, y);
  }

  doc.save('meritnama-prediction-report.pdf');
}

// ═══════════════════════════════════════════════════════
// MERIT CALCULATOR TAB (preserved from original)
// ═══════════════════════════════════════════════════════

const CALC_SAVED_KEY = 'prp_calc_merit_v2';

function getSavedCalcMerit() {
  try { return JSON.parse(localStorage.getItem(CALC_SAVED_KEY) || 'null'); }
  catch { return null; }
}
function saveCalcMerit(data) { localStorage.setItem(CALC_SAVED_KEY, JSON.stringify(data)); }
function clearCalcMerit()    { localStorage.removeItem(CALC_SAVED_KEY); }

function setupCalculatorTab() {
  document.getElementById('calcRunBtn')?.addEventListener('click', runCalculator);
  document.getElementById('calcResetBtn')?.addEventListener('click', () => {
    document.getElementById('calcForm')?.reset();
    document.getElementById('calcResult')?.classList.add('hidden');
    _lastCalcResult = null;
  });
  document.getElementById('calcSaveBtn')?.addEventListener('click', () => {
    if (!_lastCalcResult) return;
    saveCalcMerit(_lastCalcResult);
    showCalcSavedBanner();
    const predInput = document.getElementById('predMerit');
    if (predInput) predInput.value = _lastCalcResult.total.toFixed(2);
    switchToTab('predictor');
    runPredictor();
  });
  document.getElementById('calcUseSaved')?.addEventListener('click', () => {
    const saved = getSavedCalcMerit();
    if (!saved) return;
    const el = document.getElementById('predMerit');
    if (el) el.value = saved.total.toFixed(2);
    switchToTab('predictor');
    runPredictor();
  });
  document.getElementById('calcClearSaved')?.addEventListener('click', () => {
    clearCalcMerit();
    document.getElementById('calcSavedBanner')?.classList.add('hidden');
  });
  buildCalculatorForm();
  showCalcSavedBanner();
}

function buildCalculatorForm() {
  const info = getActivePolicyForCalc();
  if (!info) return;
  const { key, policy, isExpected } = info;
  const badge   = document.getElementById('calcPolicyBadge');
  const label   = document.getElementById('calcPolicyLabel');
  const noteEl  = document.getElementById('calcPolicyNote');
  const warning = document.getElementById('calcPolicyWarning');
  if (badge)   badge.textContent = `Induction ${policy.induction || key}`;
  if (label)   label.textContent = policy.label || key;
  if (noteEl)  noteEl.textContent = policy.notes || '';
  if (warning) warning.classList.toggle('hidden', !isExpected);
  const outEl = document.getElementById('calcResultOut');
  if (outEl) outEl.textContent = `/ ${policy.total_marks || 100}`;
  const form = document.getElementById('calcForm');
  if (!form) return;
  const included = (policy.components || []).filter(c => c.included !== false);
  form.innerHTML = included.map(comp => buildComponentInputHtml(comp)).join('');
  setupCalcSpecialInputs();
}

function setupCalcSpecialInputs() {
  document.querySelectorAll('.calc-fj-type-sel').forEach(sel => {
    sel.addEventListener('change', function () {
      const k = this.dataset.compKey;
      document.getElementById(`calc_${k}_fcps_div`)?.classList.toggle('hidden', this.value !== 'fcps');
      document.getElementById(`calc_${k}_jcat_div`)?.classList.toggle('hidden', this.value !== 'jcat');
    });
  });
  document.querySelectorAll('.calc-jcat-pct-input').forEach(inp => {
    inp.addEventListener('input', function () {
      const k = this.dataset.compKey;
      const hintEl = document.getElementById(`calc_${k}_jcat_hint`);
      if (!hintEl) return;
      const pct = parseFloat(this.value);
      if (isNaN(pct) || this.value === '') { hintEl.textContent = 'Enter percentage → marks assigned automatically'; return; }
      const thresholds = JSON.parse(this.dataset.thresholds || '[]').slice().sort((a, b) => b.min - a.min);
      const tier = thresholds.find(t => pct >= t.min);
      hintEl.textContent = tier
        ? `${pct}% → ${tier.value} mark${tier.value !== 1 ? 's' : ''} (${tier.label})`
        : 'Enter percentage → marks assigned automatically';
    });
  });
}

function buildComponentInputHtml(comp) {
  const { key, label, max_marks, type, description, per_year, per_item, score_max } = comp;
  let inputHtml = '';
  if (type === 'boolean') {
    inputHtml = `<div class="calc-checkbox-wrap">
      <input type="checkbox" id="calc_${key}" name="${key}" class="calc-checkbox" />
      <label for="calc_${key}" class="calc-checkbox-label">Yes — ${max_marks} marks</label>
    </div>`;
  } else if (type === 'percentage') {
    inputHtml = `<input type="number" id="calc_${key}" name="${key}" class="calc-input" placeholder="e.g. 72.5" min="0" max="100" step="0.01" />
    <span class="calc-input-hint">Enter MBBS aggregate % · Max: ${max_marks} marks</span>`;
  } else if (type === 'years') {
    const maxYrs = Math.floor(max_marks / (per_year || 1));
    inputHtml = `<input type="number" id="calc_${key}" name="${key}" class="calc-input" placeholder="Years" min="0" max="${maxYrs}" step="0.5" />
    <span class="calc-input-hint">${per_year} mark(s)/year · Max ${maxYrs} yr(s) = ${max_marks} marks</span>`;
  } else if (type === 'count') {
    const maxCnt = Math.floor(max_marks / (per_item || 1));
    inputHtml = `<input type="number" id="calc_${key}" name="${key}" class="calc-input" placeholder="Count" min="0" max="${maxCnt}" step="1" />
    <span class="calc-input-hint">${per_item} mark(s) each · Max ${maxCnt} = ${max_marks} marks</span>`;
  } else if (type === 'score') {
    const maxSc = score_max || 1100;
    inputHtml = `<input type="number" id="calc_${key}" name="${key}" class="calc-input" placeholder="e.g. 850" min="0" max="${maxSc}" step="1" />
    <span class="calc-input-hint">Out of ${maxSc} · Scaled to ${max_marks} marks</span>`;
  } else if (type === 'tiered_select') {
    const opts = (comp.tiers || []).map(t => `<option value="${t.value}">${esc(t.label)}</option>`).join('');
    inputHtml = `<select id="calc_${key}" name="${key}" class="calc-input">
      <option value="">— Select —</option>${opts}
    </select>
    <span class="calc-input-hint">Max: ${max_marks} marks</span>`;
  } else if (type === 'fcps_jcat_combo') {
    const fcpsTiers = (comp.fcps_tiers || []).map(t =>
      `<option value="${t.marks}">${esc(t.label)} — ${t.marks} mark${t.marks !== 1 ? 's' : ''}</option>`).join('');
    const jcatThresholds = JSON.stringify(comp.jcat_thresholds || []).replace(/'/g, '&#39;');
    inputHtml = `<div class="calc-fj-wrap">
      <select id="calc_${key}_type" data-comp-key="${esc(key)}" class="calc-input calc-fj-type-sel">
        <option value="">— Select qualification —</option>
        <option value="fcps">FCPS Part-I</option>
        <option value="jcat">JCAT (passed before March 2026)</option>
        <option value="none">Neither / Not applicable (0 marks)</option>
      </select>
      <div id="calc_${key}_fcps_div" class="calc-fj-sub hidden">
        <select id="calc_${key}_attempt" class="calc-input calc-fj-sub-input">
          <option value="">— Select attempt number —</option>${fcpsTiers}
        </select>
        <span class="calc-input-hint">Marks awarded by attempt: 1st=5, 2nd=4, 3rd=3, 4th+=0</span>
      </div>
      <div id="calc_${key}_jcat_div" class="calc-fj-sub hidden">
        <input type="number" id="calc_${key}_jcat_pct" class="calc-input calc-fj-sub-input calc-jcat-pct-input"
          data-comp-key="${esc(key)}" data-thresholds='${jcatThresholds}'
          placeholder="JCAT % (e.g. 72.5)" min="0" max="100" step="0.1" />
        <span class="calc-input-hint" id="calc_${key}_jcat_hint">Enter percentage → marks assigned automatically · Max: ${max_marks} marks</span>
      </div>
    </div>`;
  } else if (type === 'months') {
    const per3mo  = comp.per_3_months || 1.25;
    const maxMons = Math.round(max_marks / per3mo * 3);
    inputHtml = `<input type="number" id="calc_${key}" name="${key}" class="calc-input" placeholder="Months" min="0" max="${maxMons}" step="1" />
    <span class="calc-input-hint">${per3mo} mark(s) per 3 months · Max ${maxMons} months = ${max_marks} marks</span>`;
  }
  return `<div class="calc-form-group">
    <div class="calc-form-label-row">
      <label for="calc_${key}" class="calc-form-label">${esc(label)}</label>
      <span class="calc-form-max">${max_marks} pts</span>
    </div>
    ${description ? `<p class="calc-form-desc">${esc(description)}</p>` : ''}
    ${inputHtml}
  </div>`;
}

let _lastCalcResult = null;

function runCalculator() {
  const info = getActivePolicyForCalc();
  if (!info) return;
  const { key, policy } = info;
  const included = (policy.components || []).filter(c => c.included !== false);
  let total = 0;
  const breakdown = [];
  for (const comp of included) {
    const { key: ck, label, max_marks, type, per_year, per_item, score_max } = comp;
    const el = type === 'fcps_jcat_combo' ? null : document.getElementById(`calc_${ck}`);
    if (!el && type !== 'fcps_jcat_combo') continue;
    let contribution = 0, valueStr = '—';
    if (type === 'boolean') {
      contribution = el.checked ? max_marks : 0;
      valueStr = el.checked ? 'Yes' : 'No';
    } else if (type === 'percentage') {
      const pct = parseFloat(el.value);
      if (!isNaN(pct) && el.value !== '') { contribution = Math.min((pct / 100) * max_marks, max_marks); valueStr = `${pct}%`; }
    } else if (type === 'years') {
      const yrs = parseFloat(el.value);
      if (!isNaN(yrs) && el.value !== '') { contribution = Math.min(yrs * (per_year || 1), max_marks); valueStr = `${yrs} yr(s)`; }
    } else if (type === 'count') {
      const cnt = parseFloat(el.value);
      if (!isNaN(cnt) && el.value !== '') { contribution = Math.min(cnt * (per_item || 1), max_marks); valueStr = String(cnt); }
    } else if (type === 'score') {
      const sc  = parseFloat(el.value), msc = score_max || 1100;
      if (!isNaN(sc) && el.value !== '') { contribution = Math.min((sc / msc) * max_marks, max_marks); valueStr = String(sc); }
    } else if (type === 'tiered_select') {
      const val = parseFloat(el.value);
      if (!isNaN(val) && el.value !== '') { contribution = Math.min(val, max_marks); valueStr = el.options[el.selectedIndex]?.text || String(val); }
    } else if (type === 'fcps_jcat_combo') {
      const typeEl = document.getElementById(`calc_${ck}_type`);
      const qual = typeEl?.value;
      if (qual === 'fcps') {
        const attEl = document.getElementById(`calc_${ck}_attempt`);
        const val = parseFloat(attEl?.value);
        if (!isNaN(val) && attEl?.value !== '') {
          contribution = Math.min(val, max_marks);
          valueStr = `FCPS ${attEl.options[attEl.selectedIndex]?.text || String(val)}`;
        }
      } else if (qual === 'jcat') {
        const pctEl = document.getElementById(`calc_${ck}_jcat_pct`);
        const pct = parseFloat(pctEl?.value);
        if (!isNaN(pct) && pctEl?.value !== '') {
          const thresholds = (comp.jcat_thresholds || []).slice().sort((a, b) => b.min - a.min);
          const tier = thresholds.find(t => pct >= t.min);
          contribution = tier ? Math.min(tier.value, max_marks) : 0;
          valueStr = `JCAT ${pct}% → ${contribution} mark${contribution !== 1 ? 's' : ''} (${tier?.label || '—'})`;
        }
      } else if (qual === 'none') {
        valueStr = 'None / Not applicable'; contribution = 0;
      }
    } else if (type === 'months') {
      const months = parseFloat(el.value), per3mo = comp.per_3_months || 1.25;
      if (!isNaN(months) && el.value !== '') { contribution = Math.min(Math.floor(months / 3) * per3mo, max_marks); valueStr = `${months} month(s)`; }
    }
    total += contribution;
    breakdown.push({ label, contribution: Math.round(contribution * 100) / 100, max: max_marks, value: valueStr });
  }
  total = Math.round(total * 100) / 100;
  _lastCalcResult = { total, breakdown, policyKey: key, policyLabel: policy.label, totalMarks: policy.total_marks || 100, calculatedAt: Date.now() };

  const resultBox   = document.getElementById('calcResult');
  const valueEl     = document.getElementById('calcResultValue');
  const breakdownEl = document.getElementById('calcBreakdown');
  const bandEl      = document.getElementById('calcResultBand');
  if (valueEl) valueEl.textContent = total.toFixed(2);
  if (resultBox) resultBox.classList.remove('hidden');
  if (bandEl) {
    const allPcts = App.data.flatLookup.map(r => r.avg_pct_of_max).filter(v => v != null);
    const policyMax = getActivePolicyMax();
    const userPct   = policyMax ? (total / policyMax) * 100 : total;
    const band = getMeritBand(userPct, allPcts);
    bandEl.textContent = `${band.emoji} ${band.label}`;
    bandEl.className   = `calc-result-badge ${band.cls}`;
  }
  if (breakdownEl) {
    breakdownEl.innerHTML = breakdown.map(b => {
      const fill = b.max > 0 ? (b.contribution / b.max * 100).toFixed(1) : 0;
      return `<div class="calc-breakdown-row">
        <span class="calc-breakdown-label">${esc(b.label)}</span>
        <span class="calc-breakdown-value">${esc(b.value)}</span>
        <div class="calc-breakdown-bar-wrap"><div class="calc-breakdown-bar" style="width:${fill}%"></div></div>
        <span class="calc-breakdown-pts">${b.contribution.toFixed(2)} / ${b.max}</span>
      </div>`;
    }).join('');
  }
  resultBox?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function showCalcSavedBanner() {
  const saved  = getSavedCalcMerit();
  const banner = document.getElementById('calcSavedBanner');
  if (!banner) return;
  if (!saved) { banner.classList.add('hidden'); return; }
  banner.classList.remove('hidden');
  const scoreEl = document.getElementById('calcSavedScore');
  const polEl   = document.getElementById('calcSavedPolicy');
  if (scoreEl) scoreEl.textContent = Number(saved.total).toFixed(2);
  if (polEl)   polEl.textContent   = saved.policyLabel ? `(${saved.policyLabel})` : '';
}

// ═══════════════════════════════════════════════════════
// REVERSE SCORE CALCULATOR ("What Do I Need?")
// ═══════════════════════════════════════════════════════

function setupReverseCalcTab() {
  const revProg = document.getElementById('revProgram');
  const revQuota = document.getElementById('revQuota');
  const revSpec = document.getElementById('revSpecialty');
  const revHosp = document.getElementById('revHospital');
  if (!revProg || !revQuota || !revSpec || !revHosp) return;

  populateSelect(revProg, getPrograms(), 'Select Program');
  populateSelect(revQuota, getQuotas(), 'Select Quota');

  revProg.addEventListener('change', () => {
    populateSelect(revQuota, getQuotas(revProg.value), 'Select Quota');
    populateSelect(revSpec, getSpecialties(revProg.value, revQuota.value), 'Select Specialty');
    revHosp.innerHTML = '<option value="">All Hospitals</option>';
  });
  revQuota.addEventListener('change', () => {
    populateSelect(revSpec, getSpecialties(revProg.value, revQuota.value), 'Select Specialty');
    revHosp.innerHTML = '<option value="">All Hospitals</option>';
  });
  revSpec.addEventListener('change', () => {
    const hospitals = [...new Set(App.data.flatLookup.filter(r =>
      (!revProg.value || r.program === revProg.value) &&
      (!revQuota.value || r.quota === revQuota.value) &&
      r.specialty === revSpec.value
    ).map(r => r.hospital))].sort();
    populateSelect(revHosp, hospitals, 'All Hospitals');
  });

  document.getElementById('revBtn').addEventListener('click', runReverseCalc);
}

function runReverseCalc() {
  const prog = document.getElementById('revProgram').value;
  const quota = document.getElementById('revQuota').value;
  const spec = document.getElementById('revSpecialty').value;
  const hosp = document.getElementById('revHospital').value;

  if (!spec) {
    (window.MN ? MN.toast.warning : alert)('Please select at least a specialty.');
    return;
  }

  const rows = App.data.flatLookup.filter(r =>
    (!prog || r.program === prog) &&
    (!quota || r.quota === quota) &&
    r.specialty === spec &&
    (!hosp || r.hospital === hosp)
  );

  if (!rows.length) {
    document.getElementById('revResults').classList.remove('hidden');
    document.getElementById('revResultsContent').innerHTML =
      '<div class="card" style="text-align:center;padding:2rem;color:var(--text-muted)">No data found for this combination.</div>';
    return;
  }

  const activeMax = getActivePolicyMax();

  const cards = rows.map(row => {
    const years = Object.keys(row.yearly_merit || {}).sort();
    const latestMerit = row.yearly_merit[years[years.length - 1]];
    const avgPct   = row.avg_pct_of_max;
    const latestPct = row.latest_pct_of_max;

    // Use yearly_pct_of_max for all projection maths — these are already normalised across
    // years that had different total-mark scales (e.g. 95 → 60 → 35 → 30), so computing
    // stddev or max from them is meaningful. Using raw yearly_merit / activeMax is wrong
    // because past years had different maxima.
    const pcts = Object.values(row.yearly_pct_of_max || {}).filter(v => v != null && v > 0);
    const maxObservedPct = pcts.length ? Math.max(...pcts) : Math.max(avgPct || 0, latestPct || 0);
    const meanPct = pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : (avgPct || 0);
    const stddevPct = pcts.length > 1
      ? Math.sqrt(pcts.reduce((s, v) => s + (v - meanPct) ** 2, 0) / pcts.length)
      : 5; // fallback if only one data point

    // Projected range based on trend
    const base = latestPct || meanPct;
    let projectedMin = base, projectedMax = base;
    if (row.trend === 'rising') {
      projectedMin = base;
      projectedMax = base + stddevPct * 0.5;
    } else if (row.trend === 'falling') {
      projectedMin = base - stddevPct * 0.5;
      projectedMax = base;
    } else {
      projectedMin = meanPct - stddevPct * 0.3;
      projectedMax = meanPct + stddevPct * 0.3;
    }
    // Cap: never below 0, never above the highest cutoff ever recorded for this slot
    projectedMin = Math.max(0, projectedMin);
    projectedMax = Math.min(projectedMax, maxObservedPct);

    // "You need (safe)" = projected upper bound converted to current-policy raw marks
    const neededRaw = activeMax ? (projectedMax / 100 * activeMax) : latestMerit;
    const seatsLatest = row.yearly_seats ? row.yearly_seats[years[years.length - 1]] : '—';

    return `<div class="card" style="margin-bottom:1rem;padding:1.25rem;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:0.5rem;">
        <div>
          <strong style="color:var(--neon-cyan);font-size:1rem;">${esc(row.specialty)}</strong>
          <div style="font-size:0.82rem;color:var(--text-muted);">${esc(row.hospital)} &middot; ${esc(row.program)} &middot; ${esc(row.quota)}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;">Seats (latest)</div>
          <div style="font-size:1.1rem;font-weight:700;color:var(--neon-purple);">${seatsLatest}</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:1rem;margin-top:1rem;">
        <div class="rev-metric">
          <div class="rev-metric-label">Average Cutoff</div>
          <div class="rev-metric-value">${num(avgPct, 1)}%</div>
          <div class="rev-metric-sub">${activeMax ? num(avgPct / 100 * activeMax, 2) + ' / ' + activeMax : ''}</div>
        </div>
        <div class="rev-metric">
          <div class="rev-metric-label">Latest Cutoff</div>
          <div class="rev-metric-value">${num(latestPct, 1)}%</div>
          <div class="rev-metric-sub">${num(latestMerit, 2)} raw (${years[years.length - 1]})</div>
        </div>
        <div class="rev-metric">
          <div class="rev-metric-label">Projected Range</div>
          <div class="rev-metric-value">${num(projectedMin, 1)}–${num(projectedMax, 1)}%</div>
          <div class="rev-metric-sub">${activeMax ? num(projectedMin / 100 * activeMax, 2) + '–' + num(projectedMax / 100 * activeMax, 2) + ' / ' + activeMax : ''}</div>
        </div>
        <div class="rev-metric">
          <div class="rev-metric-label">You Need (safe)</div>
          <div class="rev-metric-value" style="color:var(--neon-green);">${activeMax ? num(neededRaw, 2) : num(latestMerit, 2)}</div>
          <div class="rev-metric-sub">out of ${activeMax || '?'} marks</div>
        </div>
      </div>
      <div style="margin-top:0.75rem;font-size:0.78rem;display:flex;gap:1rem;flex-wrap:wrap;">
        <span>Trend: ${trendBadge(row.trend)}</span>
        <span>Volatility: ${volBadge(row.volatility)}</span>
        <span>Confidence: ${confBadge(row.confidence)}</span>
        <span>Data points: ${row.data_points || years.length}</span>
      </div>
    </div>`;
  }).join('');

  document.getElementById('revResults').classList.remove('hidden');
  document.getElementById('revResultsContent').innerHTML = `
    <div style="margin-bottom:1rem;font-size:0.85rem;color:var(--text-muted);">
      Found <strong>${rows.length}</strong> combination${rows.length > 1 ? 's' : ''} matching your criteria.
      Scores shown as % of max marks (${activeMax || '?'}).
    </div>
    ${cards}`;
}
