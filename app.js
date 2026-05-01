/**
 * PRP Merit Intelligence – Main Application Logic
 * All data is loaded from static JSON files in ../data/
 */

'use strict';

// ═══════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════

const DATA_BASE = 'data/';

// ─── Loading tips ───
const LOADING_TIPS = [
  '💡 Over 1,500 specialty-hospital combinations tracked since 2020.',
  '📊 Closing merits can shift significantly year to year — check trends!',
  '🏥 Use the Strategy Tool for a personalised safe / moderate / reach shortlist.',
  '🎯 "Borderline" means you were within 3 marks — worth applying!',
  '📈 Specialties with falling cutoffs are getting easier to enter.',
  '🔍 Filter by quota (Punjab / Federal / Army) to see relevant cutoffs.',
];

// Year → total max marks, populated from scoring_policy.json after data load
const YEAR_TOTAL_MAX = {};

const MERIT_BANDS = [
  { id: 'top',  label: 'Top Tier',  emoji: '🏆', min: 80,  max: Infinity, cls: 'band-top',  desc: 'Exceptional score! Almost every specialty is within reach.' },
  { id: 'high', label: 'High',      emoji: '⭐', min: 60,  max: 80,       cls: 'band-high', desc: 'Strong score. Many competitive specialties are accessible.' },
  { id: 'mid',  label: 'Mid Range', emoji: '📊', min: 40,  max: 60,       cls: 'band-mid',  desc: 'Average range. Plenty of good options — focus on moderate-demand specialties.' },
  { id: 'low',  label: 'Low',       emoji: '📋', min: -Infinity, max: 40, cls: 'band-low',  desc: 'Below average for most competitive options, but many specialties are still available.' },
];

// Prediction thresholds (merit delta relative to closing merit)
const LIKELY_MARGIN     =  1.0;  // user merit >= closing - 1.0
const BORDERLINE_MARGIN = -2.0;  // user merit >= closing - 2.0 (but < closing - 1.0... wait, reversed)
// Actually: closing merit is the MINIMUM mark to get in.
// If user merit > closing merit → likely
// If user merit is within BORDERLINE_MARGIN below closing → borderline
// Otherwise → unlikely

// ═══════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════

const App = {
  data: {
    flatLookup:       null,
    trends:           null,
    specialtyRanking: null,
    scoringPolicy:    null,
    policyImpact:     null,
  },
  ui: {
    activeTab: 'predictor',
    predictorFilter: 'all',
    predictorResults: [],
    specTrendChart: null,
    hospSpecChart:  null,
    lastMerit:      null,
    lastProgram:    '',
    lastQuota:      '',
    trendMode:           'percentile',   // 'raw' | 'percentile'
    explorerDisplayMode: 'centile',      // 'raw' | 'centile'
    yearMeritCache:      null,
  },
};

// ═══════════════════════════════════════════════════════
// DATA LOADING
// ═══════════════════════════════════════════════════════

async function fetchJSON(file, label) {
  setLoadingDetail(`Loading ${label}…`);
  const res = await fetch(DATA_BASE + file, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to load ${file}: ${res.status}`);
  return res.json();
}

function setLoadingProgress(pct) {
  const bar = document.getElementById('loadingBar');
  if (bar) bar.style.width = pct + '%';
}

let _tipTimer = null;
function startLoadingTips() {
  let idx = 0;
  const tipEl = document.getElementById('loadingTip');
  if (!tipEl) return;
  function show() {
    tipEl.classList.remove('visible');
    setTimeout(() => {
      tipEl.textContent = LOADING_TIPS[idx % LOADING_TIPS.length];
      tipEl.classList.add('visible');
      idx++;
    }, 400);
  }
  show();
  _tipTimer = setInterval(show, 3000);
}
function stopLoadingTips() {
  if (_tipTimer) { clearInterval(_tipTimer); _tipTimer = null; }
}

async function loadAllData() {
  try {
    startLoadingTips();
    setLoadingProgress(8);

    setLoadingDetail('Loading merit data…');
    const flatLookup = await fetchJSON('flat_lookup.json', 'merit data');
    setLoadingProgress(35);

    setLoadingDetail('Loading trend data…');
    const trends = await fetchJSON('trends.json', 'trend data');
    setLoadingProgress(60);

    setLoadingDetail('Loading specialty rankings…');
    const specialtyRanking = await fetchJSON('specialty_ranking.json', 'specialty rankings');
    setLoadingProgress(82);

    setLoadingDetail('Loading scoring policy…');
    const scoringPolicy = await fetchJSON('scoring_policy.json', 'scoring policy');
    setLoadingProgress(96);

    // policy_impact.json is optional (only exists after pipeline run)
    let policyImpact = null;
    try { policyImpact = await fetchJSON('policy_impact.json', 'policy impact'); } catch (_) {}
    setLoadingProgress(100);

    App.data.flatLookup       = flatLookup;
    App.data.trends           = trends;
    App.data.specialtyRanking = specialtyRanking;
    App.data.scoringPolicy    = scoringPolicy;
    App.data.policyImpact     = policyImpact;

    setLoadingDetail(`Ready — ${flatLookup.length.toLocaleString()} records loaded`);
    setLoadingProgress(100);
    stopLoadingTips();

    await new Promise(r => setTimeout(r, 520));
    hideLoading();
    onDataReady();
  } catch (err) {
    stopLoadingTips();
    console.error('[PRP] Data load error:', err);
    setLoadingDetail('⚠ Error loading data. Ensure JSON files exist in ../data/');
    setLoadingProgress(0);
  }
}

// ═══════════════════════════════════════════════════════
// DATA ACCESSORS
// ═══════════════════════════════════════════════════════

function getPrograms() {
  const s = new Set(App.data.flatLookup.map(r => r.program));
  return [...s].sort();
}

function getQuotas(program = '') {
  const s = new Set(
    App.data.flatLookup
      .filter(r => !program || r.program === program)
      .map(r => r.quota)
  );
  return [...s].sort();
}

function getSpecialties(program = '', quota = '') {
  const s = new Set(
    App.data.flatLookup
      .filter(r => (!program || r.program === program) && (!quota || r.quota === quota))
      .map(r => r.specialty)
  );
  return [...s].sort();
}

function getHospitals(program = '', quota = '', specialty = '') {
  const s = new Set(
    App.data.flatLookup
      .filter(r =>
        (!program   || r.program   === program)   &&
        (!quota     || r.quota     === quota)     &&
        (!specialty || r.specialty === specialty)
      )
      .map(r => r.hospital)
  );
  return [...s].sort();
}

function getYears() {
  const all = new Set();
  for (const row of App.data.flatLookup) {
    Object.keys(row.yearly_merit || {}).forEach(y => all.add(Number(y)));
  }
  return [...all].sort((a, b) => a - b);
}

function getLatestYear() {
  const years = getYears();
  return years[years.length - 1];
}

function getClosingMeritForYear(row, year) {
  if (!year || year === 'latest') {
    const yr = getLatestYear();
    return row.yearly_merit?.[yr] ?? row.latest_merit;
  }
  return row.yearly_merit?.[year] ?? null;
}

// ═══════════════════════════════════════════════════════
// PREDICTION ENGINE
// ═══════════════════════════════════════════════════════

/**
 * Classify user merit vs a closing merit value.
 * @returns {string} 'likely' | 'borderline' | 'unlikely'
 */
function classifyOutcome(userMerit, closingMerit) {
  const delta = userMerit - closingMerit;
  if (delta >= -LIKELY_MARGIN)     return 'likely';
  if (delta >= -(LIKELY_MARGIN + Math.abs(BORDERLINE_MARGIN) + 1.5)) return 'borderline';
  return 'unlikely';
}

function predictOptions(userMerit, program = '', quota = '', yearRef = 'latest', mode = 'centile') {
  if (isNaN(userMerit)) return [];

  const usesCentile = mode === 'centile';
  const policyMax   = usesCentile ? getActivePolicyMax() : null;
  const userPct     = (usesCentile && policyMax) ? (userMerit / policyMax) * 100 : null;

  const results = App.data.flatLookup
    .filter(r =>
      (!program || r.program === program) &&
      (!quota   || r.quota   === quota)
    )
    .map(row => {
      if (usesCentile && userPct != null) {
        // Compare user's % of max against this row's avg % of max across all years
        const cmpPct = row.avg_pct_of_max;
        if (cmpPct == null) return null;
        const delta = userPct - cmpPct;
        // Thresholds in percentage-point units (~equivalent to old raw margins scaled)
        const outcome = delta >= -2.5 ? 'likely' : delta >= -8.0 ? 'borderline' : 'unlikely';
        return {
          ...row,
          used_closing_merit: row.avg_closing_merit,
          used_pct_of_max: cmpPct,
          user_pct_of_max: userPct,
          outcome,
          delta,           // in % units
          mode: 'centile',
        };
      } else {
        // Raw mode: compare against specific year or latest raw merit
        const cm = yearRef === 'latest'
          ? row.latest_merit
          : (row.yearly_merit?.[String(yearRef)] ?? row.latest_merit);
        if (cm == null) return null;
        const outcome = classifyOutcome(userMerit, cm);
        return {
          ...row,
          used_closing_merit: cm,
          user_pct_of_max: null,
          used_pct_of_max: null,
          outcome,
          delta: userMerit - cm,
          mode: 'raw',
        };
      }
    })
    .filter(Boolean);

  return results;
}

function getMeritBand(merit, allMerits) {
  if (!allMerits || allMerits.length === 0) return MERIT_BANDS[2];
  const below = allMerits.filter(v => v < merit).length;
  const pct   = (below / allMerits.length) * 100;
  if (pct >= 80) return MERIT_BANDS[0];
  if (pct >= 60) return MERIT_BANDS[1];
  if (pct >= 40) return MERIT_BANDS[2];
  return MERIT_BANDS[3];
}

function getPercentile(merit, allMerits) {
  if (!allMerits || allMerits.length === 0) return 0;
  const below = allMerits.filter(v => v < merit).length;
  return Math.round((below / allMerits.length) * 100);
}

// ═══════════════════════════════════════════════════════
// UI HELPERS
// ═══════════════════════════════════════════════════════

function setLoadingDetail(msg) {
  const el = document.getElementById('loadingDetail');
  if (el) el.textContent = msg;
}

function hideLoading() {
  const el = document.getElementById('loadingOverlay');
  if (el) el.classList.add('hidden');
}

function populateSelect(selectEl, options, defaultLabel = 'All') {
  const current = selectEl.value;
  selectEl.innerHTML = `<option value="">${defaultLabel}</option>` +
    options.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
  if (options.includes(current)) selectEl.value = current;
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function num(v, dec = 2) {
  return (v == null || isNaN(v)) ? '—' : Number(v).toFixed(dec);
}

function trendBadge(trend) {
  if (trend === 'rising')  return `<span class="trend-rising">↑ Rising</span>`;
  if (trend === 'falling') return `<span class="trend-falling">↓ Falling</span>`;
  return `<span class="trend-stable">→ Stable</span>`;
}
function volBadge(v) {
  return `<span class="vol-${v}">${v.charAt(0).toUpperCase() + v.slice(1)}</span>`;
}
function confBadge(c) {
  return `<span class="conf-${c}">${c.charAt(0).toUpperCase() + c.slice(1)}</span>`;
}
function outcomeBadge(outcome) {
  const map = {
    likely:     '<span class="badge badge-likely">✅ Very Likely</span>',
    borderline: '<span class="badge badge-borderline">⚡ Close Call</span>',
    unlikely:   '<span class="badge badge-unlikely">❌ Difficult</span>',
  };
  return map[outcome] || '';
}
function compBadge(c) {
  const map = {
    very_high: 'Very High 🔴',
    high:      'High 🟠',
    medium:    'Medium 🟡',
    low:       'Low 🟢',
  };
  return `<span class="comp-${c}">${map[c] || c}</span>`;
}

// ═══════════════════════════════════════════════════════
// YEARLY PERCENTILE PRE-COMPUTATION
// ═══════════════════════════════════════════════════════

/**
 * For each flatLookup record, populate yearly_percentile if not already
 * present from the pipeline. Percentile is within (year, program) cohort
 * so it's meaningful across years even when scoring formulas changed.
 */
function computeYearlyPercentiles() {
  // Build cache: { "year_program": [merit, ...] }
  const cache = {};
  for (const row of App.data.flatLookup) {
    for (const [year, merit] of Object.entries(row.yearly_merit || {})) {
      const key = `${year}_${row.program}`;
      if (!cache[key]) cache[key] = [];
      cache[key].push(merit);
    }
  }
  App.ui.yearMeritCache = cache;

  // Populate yearly_percentile on each row (skip if already set by pipeline)
  for (const row of App.data.flatLookup) {
    if (row.yearly_percentile && Object.keys(row.yearly_percentile).length > 0) continue;
    const yp = {};
    for (const [year, merit] of Object.entries(row.yearly_merit || {})) {
      const key = `${year}_${row.program}`;
      const all = cache[key] || [];
      if (all.length > 0) {
        const below = all.filter(v => v < merit).length;
        yp[year] = Math.round((below / all.length) * 100);
      }
    }
    row.yearly_percentile = yp;
  }
}

function computeMeritPercentOfMax() {
  const sp = App.data.scoringPolicy;
  // Populate YEAR_TOTAL_MAX from year_total_max or policies block
  if (sp?.year_total_max) {
    for (const [yr, max] of Object.entries(sp.year_total_max)) {
      YEAR_TOTAL_MAX[Number(yr)] = max;
    }
  } else if (sp?.policies) {
    for (const [yr, pol] of Object.entries(sp.policies)) {
      if (pol.total_marks) YEAR_TOTAL_MAX[Number(yr)] = pol.total_marks;
    }
  }

  for (const row of App.data.flatLookup) {
    const pom = {};
    for (const [year, merit] of Object.entries(row.yearly_merit || {})) {
      const totalMax = YEAR_TOTAL_MAX[Number(year)];
      if (totalMax) pom[year] = (merit / totalMax) * 100;
    }
    row.yearly_pct_of_max = pom;
    const pomVals = Object.values(pom);
    row.latest_pct_of_max  = pom[String(row.latest_year)] ?? pom[row.latest_year] ?? null;
    row.avg_pct_of_max     = pomVals.length ? pomVals.reduce((a, b) => a + b, 0) / pomVals.length : null;
  }
}

// ═══════════════════════════════════════════════════════
// MERIT CALCULATOR TAB
// ═══════════════════════════════════════════════════════

const CALC_SAVED_KEY = 'prp_calc_merit_v2';

function getSavedCalcMerit() {
  try { return JSON.parse(localStorage.getItem(CALC_SAVED_KEY) || 'null'); }
  catch { return null; }
}

function saveCalcMerit(data) {
  localStorage.setItem(CALC_SAVED_KEY, JSON.stringify(data));
}

function clearCalcMerit() {
  localStorage.removeItem(CALC_SAVED_KEY);
}

/** Returns { key, policy } for the active/expected calculator policy */
function getActivePolicyForCalc() {
  const sp = App.data.scoringPolicy;
  if (!sp) return null;
  if (sp.policies) {
    // Use expected_policy if defined, else active_policy
    const key = sp.expected_policy || sp.active_policy;
    const policy = sp.policies[key];
    if (policy) return { key, policy, isExpected: key === sp.expected_policy };
    // Fallback: last key
    const keys = Object.keys(sp.policies).sort();
    const lastKey = keys[keys.length - 1];
    return { key: lastKey, policy: sp.policies[lastKey], isExpected: false };
  }
  // Legacy flat format
  const years = Object.keys(sp).sort();
  const last  = years[years.length - 1];
  return { key: last, policy: sp[last], isExpected: false };
}

/** Returns the total marks for the currently active/calculator policy (used for centile conversion) */
function getActivePolicyMax() {
  const active = getActivePolicyForCalc();
  if (active?.policy?.total_marks) return active.policy.total_marks;
  // Fallback: latest known year max
  const keys = Object.keys(YEAR_TOTAL_MAX).map(Number).sort();
  return keys.length ? YEAR_TOTAL_MAX[keys[keys.length - 1]] : null;
}

let _lastCalcResult = null;

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
    updateAutoFillFromSaved();
    // Pre-fill predictor input (don't run yet)
    const predInput = document.getElementById('userMerit');
    if (predInput) predInput.value = _lastCalcResult.total.toFixed(2);
    switchToTab('predictor');
  });
  document.getElementById('calcStratBtn')?.addEventListener('click', () => {
    if (!_lastCalcResult) return;
    saveCalcMerit(_lastCalcResult);
    updateAutoFillFromSaved();
    const stratInput = document.getElementById('stratMerit');
    if (stratInput) stratInput.value = _lastCalcResult.total.toFixed(2);
    switchToTab('strategy');
    runStrategy();
  });
  document.getElementById('calcUseSaved')?.addEventListener('click', () => {
    const saved = getSavedCalcMerit();
    if (!saved) return;
    const predInput = document.getElementById('userMerit');
    if (predInput) predInput.value = saved.total.toFixed(2);
    switchToTab('predictor');
    runPredictor();
  });
  document.getElementById('calcUseStrategy')?.addEventListener('click', () => {
    const saved = getSavedCalcMerit();
    if (!saved) return;
    const stratInput = document.getElementById('stratMerit');
    if (stratInput) stratInput.value = saved.total.toFixed(2);
    switchToTab('strategy');
    runStrategy();
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

  // Update policy info bar
  const badge   = document.getElementById('calcPolicyBadge');
  const label   = document.getElementById('calcPolicyLabel');
  const noteEl  = document.getElementById('calcPolicyNote');
  const warning = document.getElementById('calcPolicyWarning');

  if (badge)   badge.textContent = `Induction ${policy.induction || key}`;
  if (label)   label.textContent = policy.label || key;
  if (noteEl)  noteEl.textContent = policy.notes || '';
  if (warning) warning.classList.toggle('hidden', !isExpected);

  // Update total marks
  const outEl = document.getElementById('calcResultOut');
  if (outEl) outEl.textContent = `/ ${policy.total_marks || 100}`;

  // Build form
  const form = document.getElementById('calcForm');
  if (!form) return;
  const included = (policy.components || []).filter(c => c.included !== false);
  form.innerHTML = included.map(comp => buildComponentInputHtml(comp)).join('');
}

function buildComponentInputHtml(comp) {
  const { key, label, max_marks, type, description, per_year, per_item, score_max } = comp;
  let inputHtml = '';

  if (type === 'boolean') {
    inputHtml = `
      <div class="calc-checkbox-wrap">
        <input type="checkbox" id="calc_${key}" name="${key}" class="calc-checkbox" />
        <label for="calc_${key}" class="calc-checkbox-label">Yes — ${max_marks} marks</label>
      </div>`;
  } else if (type === 'percentage') {
    inputHtml = `
      <input type="number" id="calc_${key}" name="${key}" class="calc-input"
             placeholder="e.g. 72.5" min="0" max="100" step="0.01" />
      <span class="calc-input-hint">Enter your MBBS aggregate % · Max contribution: ${max_marks} marks</span>`;
  } else if (type === 'years') {
    const maxYrs = Math.floor(max_marks / (per_year || 1));
    inputHtml = `
      <input type="number" id="calc_${key}" name="${key}" class="calc-input"
             placeholder="Years" min="0" max="${maxYrs}" step="0.5" />
      <span class="calc-input-hint">${per_year} mark(s)/year · Max ${maxYrs} year(s) = ${max_marks} marks</span>`;
  } else if (type === 'count') {
    const maxCnt = Math.floor(max_marks / (per_item || 1));
    inputHtml = `
      <input type="number" id="calc_${key}" name="${key}" class="calc-input"
             placeholder="Count" min="0" max="${maxCnt}" step="1" />
      <span class="calc-input-hint">${per_item} mark(s) each · Max ${maxCnt} item(s) = ${max_marks} marks</span>`;
  } else if (type === 'score') {
    const maxSc = score_max || 1100;
    inputHtml = `
      <input type="number" id="calc_${key}" name="${key}" class="calc-input"
             placeholder="e.g. 850" min="0" max="${maxSc}" step="1" />
      <span class="calc-input-hint">Out of ${maxSc} · Scaled to ${max_marks} marks</span>`;
  } else if (type === 'tiered_select') {
    const opts = (comp.tiers || []).map(t =>
      `<option value="${t.value}">${esc(t.label)}</option>`
    ).join('');
    inputHtml = `
      <select id="calc_${key}" name="${key}" class="calc-input">
        <option value="">— Select —</option>
        ${opts}
      </select>
      <span class="calc-input-hint">Select the option that applies to you · Max: ${max_marks} marks</span>`;
  } else if (type === 'months') {
    const per3mo  = comp.per_3_months || 1.25;
    const maxMons = Math.round(max_marks / per3mo * 3);
    inputHtml = `
      <input type="number" id="calc_${key}" name="${key}" class="calc-input"
             placeholder="Months" min="0" max="${maxMons}" step="1" />
      <span class="calc-input-hint">${per3mo} mark(s) per 3 months · Max ${maxMons} months = ${max_marks} marks</span>`;
  }

  return `
    <div class="calc-form-group">
      <div class="calc-form-label-row">
        <label for="calc_${key}" class="calc-form-label">${esc(label)}</label>
        <span class="calc-form-max">${max_marks} pts</span>
      </div>
      ${description ? `<p class="calc-form-desc">${esc(description)}</p>` : ''}
      ${inputHtml}
    </div>`;
}

function runCalculator() {
  const info = getActivePolicyForCalc();
  if (!info) return;
  const { key, policy } = info;

  const included = (policy.components || []).filter(c => c.included !== false);
  let total = 0;
  const breakdown = [];

  for (const comp of included) {
    const { key: ck, label, max_marks, type, per_year, per_item, score_max } = comp;
    const el = document.getElementById(`calc_${ck}`);
    if (!el) continue;

    let contribution = 0;
    let valueStr = '—';

    if (type === 'boolean') {
      contribution = el.checked ? max_marks : 0;
      valueStr     = el.checked ? 'Yes' : 'No';
    } else if (type === 'percentage') {
      const pct = parseFloat(el.value);
      if (!isNaN(pct) && el.value !== '') {
        contribution = Math.min((pct / 100) * max_marks, max_marks);
        valueStr     = `${pct}%`;
      }
    } else if (type === 'years') {
      const yrs = parseFloat(el.value);
      if (!isNaN(yrs) && el.value !== '') {
        contribution = Math.min(yrs * (per_year || 1), max_marks);
        valueStr     = `${yrs} yr(s)`;
      }
    } else if (type === 'count') {
      const cnt = parseFloat(el.value);
      if (!isNaN(cnt) && el.value !== '') {
        contribution = Math.min(cnt * (per_item || 1), max_marks);
        valueStr     = String(cnt);
      }
    } else if (type === 'score') {
      const sc  = parseFloat(el.value);
      const msc = score_max || 1100;
      if (!isNaN(sc) && el.value !== '') {
        contribution = Math.min((sc / msc) * max_marks, max_marks);
        valueStr     = String(sc);
      }
    } else if (type === 'tiered_select') {
      const val = parseFloat(el.value);
      if (!isNaN(val) && el.value !== '') {
        contribution = Math.min(val, max_marks);
        valueStr     = el.options[el.selectedIndex]?.text || String(val);
      }
    } else if (type === 'months') {
      const months = parseFloat(el.value);
      const per3mo = comp.per_3_months || 1.25;
      if (!isNaN(months) && el.value !== '') {
        contribution = Math.min(Math.floor(months / 3) * per3mo, max_marks);
        valueStr     = `${months} month(s)`;
      }
    }

    total += contribution;
    breakdown.push({
      label,
      contribution: Math.round(contribution * 100) / 100,
      max: max_marks,
      value: valueStr,
    });
  }

  total = Math.round(total * 100) / 100;
  _lastCalcResult = {
    total,
    breakdown,
    policyKey:   key,
    policyLabel: policy.label,
    totalMarks:  policy.total_marks || 100,
    calculatedAt: Date.now(),
  };

  // Show result
  const resultBox   = document.getElementById('calcResult');
  const valueEl     = document.getElementById('calcResultValue');
  const breakdownEl = document.getElementById('calcBreakdown');
  const bandEl      = document.getElementById('calcResultBand');

  if (valueEl) valueEl.textContent = total.toFixed(2);
  if (resultBox) resultBox.classList.remove('hidden');

  // Show merit band
  if (bandEl) {
    const allMerits = App.data.flatLookup.map(r => r.latest_merit).filter(v => v != null);
    const band = getMeritBand(total, allMerits);
    bandEl.textContent = `${band.emoji} ${band.label}`;
    bandEl.className = `calc-result-badge ${band.cls}`;
  }

  if (breakdownEl) {
    breakdownEl.innerHTML = breakdown.map(b => {
      const fillPct = b.max > 0 ? (b.contribution / b.max * 100).toFixed(1) : 0;
      return `
        <div class="calc-breakdown-row">
          <span class="calc-breakdown-label">${esc(b.label)}</span>
          <span class="calc-breakdown-value">${esc(b.value)}</span>
          <div class="calc-breakdown-bar-wrap">
            <div class="calc-breakdown-bar" style="width:${fillPct}%"></div>
          </div>
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

function updateAutoFillFromSaved() {
  const saved = getSavedCalcMerit();
  if (!saved) return;
  const merit = saved.total;
  // Only auto-fill if currently empty
  const predInput  = document.getElementById('userMerit');
  const stratInput = document.getElementById('stratMerit');
  if (predInput  && !predInput.value)  predInput.value  = merit.toFixed(2);
  if (stratInput && !stratInput.value) stratInput.value = merit.toFixed(2);
}

// ═══════════════════════════════════════════════════════
// POLICY HISTORY TAB
// ═══════════════════════════════════════════════════════

function setupPolicyTab() {
  // Nothing to setup at init — rendered when tab is activated
}

function renderPolicyTab() {
  const sp = App.data.scoringPolicy;
  if (!sp || !sp.policies) return;

  const policies    = sp.policies;
  const policyKeys  = Object.keys(policies).sort();

  // ── Collect all component keys/labels across all years ──
  const allCompKeys   = [];
  const allCompLabels = {};
  for (const key of policyKeys) {
    for (const comp of policies[key].components || []) {
      if (!allCompLabels[comp.key]) {
        allCompKeys.push(comp.key);
        allCompLabels[comp.key] = comp.label;
      }
    }
  }

  // ── Comparison table ──
  const table = document.getElementById('policyComparisonTable');
  if (table) {
    const headerCells = policyKeys.map(k =>
      `<th style="white-space:nowrap">${esc(policies[k].label || k)}</th>`
    ).join('');

    const dataRows = allCompKeys.map(ck => {
      const cells = policyKeys.map(pk => {
        const comp = (policies[pk].components || []).find(c => c.key === ck);
        if (!comp) return '<td><span class="policy-cell-na">—</span></td>';
        const inc = comp.included !== false;
        return `<td><span class="${inc ? 'policy-cell-in' : 'policy-cell-out'}">${inc ? comp.max_marks + ' pts' : 'Removed'}</span></td>`;
      }).join('');
      return `<tr><td><strong>${esc(allCompLabels[ck] || ck)}</strong></td>${cells}</tr>`;
    }).join('');

    const totalRow = `<tr class="policy-total-row">
      <td><strong>Total Marks</strong></td>
      ${policyKeys.map(pk => `<td><strong>${policies[pk].total_marks || '—'}</strong></td>`).join('')}
    </tr>`;

    table.innerHTML = `
      <thead><tr><th>Component</th>${headerCells}</tr></thead>
      <tbody>${dataRows}${totalRow}</tbody>`;
  }

  // ── Timeline cards (latest first) ──
  const timeline = document.getElementById('policyTimeline');
  if (!timeline) return;

  timeline.innerHTML = [...policyKeys].reverse().map(key => {
    const pol       = policies[key];
    const isExpected = key.includes('expected') || key === sp.expected_policy;
    const included   = (pol.components || []).filter(c => c.included !== false);
    const excluded   = (pol.components || []).filter(c => c.included === false);

    // Merge in distribution stats if available
    let statsHtml = '';
    const impact = App.data.policyImpact;
    const yearNum = isNaN(Number(key)) ? null : Number(key);
    if (impact && yearNum && impact[String(yearNum)]) {
      const programs = impact[String(yearNum)].programs || {};
      const statRows = Object.entries(programs).map(([prog, s]) =>
        `<tr>
          <td>${esc(prog)}</td>
          <td>${s.count}</td>
          <td>${s.mean?.toFixed(2) ?? '—'}</td>
          <td>${s.stddev?.toFixed(2) ?? '—'}</td>
          <td>${s.p25?.toFixed(2) ?? '—'} / ${s.p50?.toFixed(2) ?? '—'} / ${s.p75?.toFixed(2) ?? '—'}</td>
        </tr>`
      ).join('');
      if (statRows) {
        statsHtml = `
          <div class="policy-stats-section">
            <h4>📊 Distribution Stats (from actual data)</h4>
            <div class="table-wrap">
              <table class="data-table">
                <thead><tr><th>Program</th><th>Records</th><th>Mean</th><th>σ</th><th>P25 / P50 / P75</th></tr></thead>
                <tbody>${statRows}</tbody>
              </table>
            </div>
          </div>`;
      }
    }

    return `
      <div class="policy-card${isExpected ? ' policy-card-expected' : ''}">
        <div class="policy-card-header">
          <div class="policy-card-title">
            <span class="policy-card-year">${esc(pol.label || key)}</span>
            ${isExpected ? '<span class="policy-expected-badge">⚠️ Expected — Not Confirmed</span>' : ''}
          </div>
          <div class="policy-card-total">${pol.total_marks || '?'} total marks</div>
        </div>
        ${pol.notes ? `<p class="policy-card-notes">${esc(pol.notes)}</p>` : ''}
        <div class="policy-components-grid">
          ${included.map(c => `
            <div class="policy-comp-pill policy-comp-in">
              <span class="policy-comp-name">${esc(c.label)}</span>
              <span class="policy-comp-marks">${c.max_marks} pts</span>
            </div>`).join('')}
          ${excluded.map(c => `
            <div class="policy-comp-pill policy-comp-out">
              <span class="policy-comp-name">${esc(c.label)}</span>
              <span class="policy-comp-marks">Not included</span>
            </div>`).join('')}
        </div>
        ${pol.tidbits?.length ? `
          <div class="policy-tidbits">
            <h4>💡 Key Notes for This Cycle</h4>
            <ul>${pol.tidbits.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
          </div>` : ''}
        ${statsHtml}
      </div>`;
  }).join('');
}

function onDataReady() {
  computeYearlyPercentiles();   // enrich flatLookup with yearly_percentile
  computeMeritPercentOfMax();   // enrich flatLookup with yearly_pct_of_max
  populateAllFilters();
  setupTabNavigation();
  setupPredictorTab();
  setupSpecialtyTab();
  setupHospitalTab();
  setupTrendsTab();
  setupRankingsTab();
  setupStrategyTab();
  setupCalculatorTab();
  setupPolicyTab();
  setupToolsTab();
  initTooltips();
  showWelcomeModal();
  updateHeaderMeta();
  updateFooterStats();
  setupBackToTop();
  setupKeyboardShortcuts();
  setupHamburger();
  setupRecentScores();
  setupMeritContextBar();
  handleURLParams();
  showKbdHint();
  // Auto-fill from saved calculator merit
  updateAutoFillFromSaved();
}

function updateHeaderMeta() {
  const el = document.getElementById('dataStatus');
  if (!el) return;
  const years = getYears();
  const n = App.data.flatLookup.length;
  el.textContent = `${n.toLocaleString()} records · ${years[0]}–${years[years.length - 1]}`;
  el.className = 'badge badge-success';
}

function updateFooterStats() {
  const el = document.getElementById('footerStats');
  if (!el) return;
  const years = getYears();
  const programs = getPrograms();
  const specialties = getSpecialties();
  el.textContent = `${programs.join(', ')} · ${years.length} cycles · ${specialties.length} specialties · ${App.data.flatLookup.length.toLocaleString()} hospital records`;
}

function populateAllFilters() {
  const programs = getPrograms();
  const quotas   = getQuotas();
  const years    = getYears();

  // Predictor
  populateSelect(document.getElementById('programFilter'), programs);
  populateSelect(document.getElementById('quotaFilter'),   quotas);
  const yearRefSel = document.getElementById('yearRef');
  yearRefSel.innerHTML = `<option value="latest">Latest Available</option>` +
    [...years].reverse().map(y => `<option value="${y}">${y}</option>`).join('');

  // Specialty Explorer
  populateSelect(document.getElementById('specProgram'), programs);
  populateSelect(document.getElementById('specQuota'),   quotas);

  // Hospital Explorer
  populateSelect(document.getElementById('hospProgram'), programs);

  // Trends
  populateSelect(document.getElementById('trendProgram'),   programs);
  populateSelect(document.getElementById('trendQuota'),     quotas);
  populateSelect(document.getElementById('trendSpecialty'), getSpecialties(), 'Select Specialty');
  populateSelect(document.getElementById('trendHospital'),  [], 'All Hospitals');

  // Rankings
  populateSelect(document.getElementById('rankProgram'), programs);
  populateSelect(document.getElementById('rankQuota'),   quotas);

  // Strategy
  populateSelect(document.getElementById('stratProgram'), programs);
  populateSelect(document.getElementById('stratQuota'),   quotas);

  // Tools — Simulator
  populateSelect(document.getElementById('simProgram'), programs);
  populateSelect(document.getElementById('simQuota'),   quotas);

  // Tools — Gap Analyzer
  populateSelect(document.getElementById('gapProgram'), programs);
  populateSelect(document.getElementById('gapQuota'),   quotas);
  populateSelect(document.getElementById('gapSpecialty'), getSpecialties(), 'Select Specialty');
  populateSelect(document.getElementById('gapHospital'), [], 'Select Hospital');
}

// ═══════════════════════════════════════════════════════
// TAB NAVIGATION
// ═══════════════════════════════════════════════════════

function switchToTab(tab) {
  const btn = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
  if (!btn) return;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(`tab-${tab}`)?.classList.add('active');
  App.ui.activeTab = tab;
  localStorage.setItem('prp_last_tab', tab);
  onTabActivated(tab);
  // Scroll tab button into view on mobile
  btn.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
}

function setupTabNavigation() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchToTab(btn.dataset.tab));
  });

  // Restore last tab (but not if URL has a tab param)
  const urlTab = new URLSearchParams(window.location.search).get('tab');
  if (!urlTab) {
    const lastTab = localStorage.getItem('prp_last_tab');
    if (lastTab) switchToTab(lastTab);
  }
}

function onTabActivated(tab) {
  if (tab === 'specialty')   renderSpecialtyGrid();
  if (tab === 'hospital')    renderHospitalGrid();
  if (tab === 'rankings')    renderRankingsTab();
  if (tab === 'trends')      renderTrendsTab();
  if (tab === 'tools')       renderShortlist();
  if (tab === 'policy')      renderPolicyTab();
}

// ═══════════════════════════════════════════════════════
// MODAL HELPERS
// ═══════════════════════════════════════════════════════

function openModal(modalEl) {
  if (!modalEl) return;
  modalEl.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeModal(modalEl) {
  if (!modalEl) return;
  modalEl.classList.add('hidden');
  document.body.style.overflow = '';
}

// ═══════════════════════════════════════════════════════
// TOOLTIP SYSTEM
// ═══════════════════════════════════════════════════════

const TOOLTIPS = {
  merit:      { title: 'Merit Score',              body: 'Your total calculated score based on MBBS marks, house job, experience, and other factors as per the current policy. Higher is better.',  example: 'e.g. Enter 28.5 if your calculated merit is 28.5' },
  closing:    { title: 'Closing Merit (Cutoff)',    body: 'The lowest score that actually got a seat in this specialty/hospital in the selected year. If your score is at or above this number, you would have qualified.',  example: 'e.g. Closing merit of 27.2 means everyone above 27.2 got selected' },
  percentile: { title: 'Percentile Rank',           body: 'What % of all hospital closing merits are below your score. Higher = more options open to you.',  example: 'e.g. 70th percentile means your score beats 70% of all cutoffs' },
  volatility: { title: 'Volatility (Unpredictability)', body: 'How much the cutoff changes year to year. HIGH = cutoff jumps a lot. LOW = very consistent and predictable.',  example: 'e.g. High volatility: was 35 one year, 26 the next' },
  confidence: { title: 'Prediction Confidence',    body: 'How reliable this prediction is. Based on how many years of data exist. More data = higher confidence.',  example: 'e.g. Low confidence = only 1-2 years of data available' },
};

let _tooltipEl = null;

function initTooltips() {
  _tooltipEl = document.createElement('div');
  _tooltipEl.className = 'tooltip-popup hidden';
  _tooltipEl.innerHTML = '<div class="tooltip-title"></div><div class="tooltip-body"></div><div class="tooltip-example"></div>';
  document.body.appendChild(_tooltipEl);

  document.body.addEventListener('mouseover', e => {
    const btn = e.target.closest('.info-btn');
    if (!btn) return;
    const key = btn.dataset.tip;
    const tip = TOOLTIPS[key];
    if (!tip) return;
    _tooltipEl.querySelector('.tooltip-title').textContent = tip.title;
    _tooltipEl.querySelector('.tooltip-body').textContent  = tip.body;
    const ex = _tooltipEl.querySelector('.tooltip-example');
    ex.textContent = tip.example || '';
    ex.style.display = tip.example ? '' : 'none';
    _tooltipEl.classList.remove('hidden');
    positionTooltip(btn);
  });

  document.body.addEventListener('mouseout', e => {
    if (!e.target.closest('.info-btn')) return;
    _tooltipEl.classList.add('hidden');
  });

  document.body.addEventListener('mousemove', e => {
    if (_tooltipEl.classList.contains('hidden')) return;
    const btn = e.target.closest('.info-btn');
    if (btn) positionTooltip(btn);
  });
}

function positionTooltip(anchor) {
  const rect = anchor.getBoundingClientRect();
  const tw = _tooltipEl.offsetWidth  || 270;
  const th = _tooltipEl.offsetHeight || 80;
  let left = rect.left + rect.width / 2 - tw / 2;
  let top  = rect.top - th - 10;
  // keep inside viewport
  left = Math.max(8, Math.min(left, window.innerWidth  - tw - 8));
  top  = top < 8 ? rect.bottom + 8 : top;
  _tooltipEl.style.left = left + 'px';
  _tooltipEl.style.top  = top  + 'px';
}

// ═══════════════════════════════════════════════════════
// WELCOME MODAL
// ═══════════════════════════════════════════════════════

function showWelcomeModal() {
  if (localStorage.getItem('prp_welcomed')) return;
  const modal = document.getElementById('welcomeModal');
  if (!modal) return;
  openModal(modal);

  function dismiss() {
    closeModal(modal);
    localStorage.setItem('prp_welcomed', '1');
  }

  document.getElementById('welcomeStart')?.addEventListener('click', dismiss);
  document.getElementById('welcomeSkip')?.addEventListener('click', dismiss);
  document.getElementById('welcomeOverlay')?.addEventListener('click', dismiss);
}

// ═══════════════════════════════════════════════════════
// GUIDE TAB HELPERS
// ═══════════════════════════════════════════════════════

// Exposed globally so inline onclick in HTML works
window.toggleFaq = function(qEl) {
  const card = qEl.closest('.faq-card');
  if (!card) return;
  const wasOpen = qEl.classList.contains('open');
  // Optionally close siblings
  const grid = card.closest('.guide-faq-grid');
  if (grid) {
    grid.querySelectorAll('.faq-q.open').forEach(q => {
      q.classList.remove('open');
      q.nextElementSibling?.classList.remove('open');
    });
  }
  if (!wasOpen) {
    qEl.classList.add('open');
    qEl.nextElementSibling?.classList.add('open');
  }
};

// ═══════════════════════════════════════════════════════
// PREDICTOR TAB
// ═══════════════════════════════════════════════════════

function setupPredictorTab() {
  document.getElementById('predictBtn').addEventListener('click', runPredictor);
  document.getElementById('userMerit').addEventListener('keydown', e => {
    if (e.key === 'Enter') runPredictor();
  });

  // Pill filters
  document.querySelectorAll('#tab-predictor .pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('#tab-predictor .pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      App.ui.predictorFilter = pill.dataset.filter;
      renderPredictorTable();
    });
  });

  // Search filter
  document.getElementById('resultSearch').addEventListener('input', renderPredictorTable);

  // Cascade quota when program changes
  document.getElementById('programFilter').addEventListener('change', () => {
    const prog = document.getElementById('programFilter').value;
    populateSelect(document.getElementById('quotaFilter'), getQuotas(prog));
  });
}

function runPredictor() {
  const merit  = parseFloat(document.getElementById('userMerit').value);
  const prog   = document.getElementById('programFilter').value;
  const quota  = document.getElementById('quotaFilter').value;
  const yearV  = document.getElementById('yearRef').value;

  if (isNaN(merit)) {
    alert('Please enter a valid merit score.');
    return;
  }

  // Always use centile mode: convert user score to % of active policy max, compare against avg_pct_of_max.
  // This makes the predictor cross-year comparable regardless of which induction scoring formula is active.
  const results = predictOptions(merit, prog, quota, yearV === 'latest' ? 'latest' : Number(yearV), 'centile');
  App.ui.predictorResults = results;

  // Percentile insight: compare userPct against all historical avg_pct_of_max values
  const userPct   = results[0]?.user_pct_of_max ?? null;
  const allPcts   = results.map(r => r.used_pct_of_max).filter(v => v != null);
  const pct       = userPct != null ? getPercentile(userPct, allPcts) : 0;
  const band      = userPct != null ? getMeritBand(userPct, allPcts) : getMeritBand(merit, []);

  const likely     = results.filter(r => r.outcome === 'likely').length;
  const borderline = results.filter(r => r.outcome === 'borderline').length;

  // Show insights
  document.getElementById('insightsBanner').classList.remove('hidden');
  document.getElementById('insightPctVal').textContent      = `${pct}th`;
  document.getElementById('insightBandVal').textContent     = `${band.emoji} ${band.label}`;
  document.getElementById('insightLikelyVal').textContent   = likely;
  document.getElementById('insightBorderlineVal').textContent = borderline;

  // Policy notice — show active policy used for centile conversion
  const policyMax = getActivePolicyMax();
  const activePol = getActivePolicyForCalc();
  const policyNoticeEl = document.getElementById('policyNotice');
  const policyTextEl   = document.getElementById('policyText');
  if (activePol?.policy && policyNoticeEl && policyTextEl) {
    policyNoticeEl.classList.remove('hidden');
    const userPctStr = userPct != null ? ` (${num(userPct, 1)}% of ${policyMax}-mark max)` : '';
    policyTextEl.textContent =
      `Score interpreted as: ${activePol.policy.label || activePol.key}${userPctStr}. Comparing against historical % of max for cross-year accuracy.`;
  } else if (policyNoticeEl) {
    policyNoticeEl.classList.add('hidden');
  }

  document.getElementById('predictorResults').classList.remove('hidden');
  renderPredictorTable();

  // Draw merit distribution chart using pct values for cross-year context
  Charts.drawDistributionChart(allPcts, userPct ?? merit);

  // Save to recent scores
  saveRecentScore(merit);
  renderRecentScores();

  // Update merit context bar (visible from other tabs)
  App.ui.lastProgram = prog;
  App.ui.lastQuota   = quota;
  updateMeritContextBar(merit, band, likely, borderline);
}

function renderPredictorTable() {
  const filter    = App.ui.predictorFilter;
  const searchQ   = document.getElementById('resultSearch').value.toLowerCase().trim();
  let rows        = App.ui.predictorResults;

  if (filter !== 'all') rows = rows.filter(r => r.outcome === filter);
  if (searchQ) {
    rows = rows.filter(r =>
      r.specialty.toLowerCase().includes(searchQ) ||
      r.hospital.toLowerCase().includes(searchQ)
    );
  }

  // Sort: likely first, then borderline, then unlikely; within each by delta desc
  const order = { likely: 0, borderline: 1, unlikely: 2 };
  rows.sort((a, b) => (order[a.outcome] - order[b.outcome]) || (b.delta - a.delta));

  const savedIds = new Set(getShortlist().map(i => i.id));
  const tbody = document.getElementById('predictorTableBody');
  tbody.innerHTML = rows.map(r => {
    const id = shortlistId(r);
    const saved = savedIds.has(id);
    return `
      <tr class="row-${r.outcome}">
        <td>${esc(r.specialty)}</td>
        <td>${esc(r.hospital)}</td>
        <td>${esc(r.quota)}</td>
        <td><strong>${r.used_pct_of_max != null ? num(r.used_pct_of_max, 1) + '%' : num(r.used_closing_merit)}</strong></td>
        <td>${r.avg_pct_of_max != null ? num(r.avg_pct_of_max, 1) + '%' : num(r.avg_closing_merit)}</td>
        <td>${trendBadge(r.trend)}</td>
        <td>${volBadge(r.volatility)}</td>
        <td>${confBadge(r.confidence)}</td>
        <td>${outcomeBadge(r.outcome)}</td>
        <td><button class="shortlist-star${saved ? ' saved' : ''}" data-id="${esc(id)}" title="${saved ? 'Remove from shortlist' : 'Save to shortlist'}">${saved ? '★' : '☆'}</button></td>
      </tr>
    `;
  }).join('');

  // Star button delegation
  tbody.querySelectorAll('.shortlist-star').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const row = rows.find(r => shortlistId(r) === id);
      if (row) toggleShortlistItem(row);
      renderPredictorTable();
    });
  });

  document.getElementById('predictorCount').textContent =
    `Showing ${rows.length} of ${App.ui.predictorResults.length} options`;
}

// ═══════════════════════════════════════════════════════
// SPECIALTY EXPLORER TAB
// ═══════════════════════════════════════════════════════

function setupSpecialtyTab() {
  document.getElementById('specProgram').addEventListener('change', renderSpecialtyGrid);
  document.getElementById('specQuota').addEventListener('change', renderSpecialtyGrid);
  document.getElementById('specSearch').addEventListener('input', renderSpecialtyGrid);

  document.getElementById('specModalClose').addEventListener('click', () => {
    closeModal(document.getElementById('specialtyModal'));
  });
  document.getElementById('specModalOverlay').addEventListener('click', () => {
    closeModal(document.getElementById('specialtyModal'));
  });

  // Centile / raw toggle
  document.querySelectorAll('.explorer-view-btn[data-tab="spec"]').forEach(btn => {
    btn.addEventListener('click', () => {
      App.ui.explorerDisplayMode = btn.dataset.view;
      document.querySelectorAll('.explorer-view-btn[data-tab="spec"]')
              .forEach(b => b.classList.toggle('active', b === btn));
      renderSpecialtyGrid();
    });
  });
}

function renderSpecialtyGrid() {
  const program = document.getElementById('specProgram').value;
  const quota   = document.getElementById('specQuota').value;
  const search  = document.getElementById('specSearch').value.toLowerCase().trim();

  // Build specialty aggregate from ranking data + enrich with pct_of_max from flatLookup
  const entries = [];
  for (const [prog, quotas] of Object.entries(App.data.specialtyRanking)) {
    if (program && prog !== program) continue;
    for (const [q, specs] of Object.entries(quotas)) {
      if (quota && q !== quota) continue;
      for (const [spec, data] of Object.entries(specs)) {
        if (search && !spec.toLowerCase().includes(search)) continue;
        // Compute pct_of_max from flatLookup rows
        const rows = App.data.flatLookup.filter(r =>
          r.program === prog && r.quota === q && r.specialty === spec
        );
        const pomVals  = rows.map(r => r.avg_pct_of_max).filter(v => v != null);
        const latPom   = rows.map(r => r.latest_pct_of_max).filter(v => v != null);
        data.avg_pct_of_max    = pomVals.length  ? pomVals.reduce((a, b) => a + b, 0) / pomVals.length  : null;
        data.latest_pct_of_max = latPom.length   ? latPom.reduce((a, b) => a + b, 0) / latPom.length   : null;
        entries.push(data);
      }
    }
  }

  entries.sort((a, b) => b.avg_closing_merit - a.avg_closing_merit);

  const grid = document.getElementById('specialtyGrid');
  if (entries.length === 0) {
    grid.innerHTML = '<p style="color:var(--text-light);padding:20px">No specialties found.</p>';
    return;
  }

  grid.innerHTML = entries.map(e => {
    const isCentile   = App.ui.explorerDisplayMode === 'centile';
    const avgDisplay  = isCentile
      ? (e.avg_pct_of_max    != null ? num(e.avg_pct_of_max,    1) + '%' : '—')
      : num(e.avg_closing_merit);
    const latDisplay  = isCentile
      ? (e.latest_pct_of_max != null ? num(e.latest_pct_of_max, 1) + '%' : '—')
      : num(e.latest_avg_closing);
    const avgLabel    = isCentile ? 'Avg % of Max' : 'Avg Merit';
    const latLabel    = isCentile ? 'Latest % of Max' : 'Latest Avg';
    return `
    <div class="spec-card"
         data-program="${esc(e.program)}"
         data-quota="${esc(e.quota)}"
         data-specialty="${esc(e.specialty)}"
         tabindex="0"
         role="button"
         aria-label="View ${esc(e.specialty)} details">
      <h4>${esc(e.specialty)}</h4>
      <div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:8px">${esc(e.program)} \u00b7 ${esc(e.quota)}</div>
      ${compBadge(e.competitiveness)}
      <div class="card-meta">
        <div class="card-stat">
          <span class="card-stat-label">${avgLabel}</span>
          <span class="card-stat-value">${avgDisplay}</span>
        </div>
        <div class="card-stat">
          <span class="card-stat-label">${latLabel}</span>
          <span class="card-stat-value">${latDisplay}</span>
        </div>
        <div class="card-stat">
          <span class="card-stat-label">Hospitals</span>
          <span class="card-stat-value">${e.hospital_count}</span>
        </div>
        <div class="card-stat">
          <span class="card-stat-label">Volatility</span>
          <span class="card-stat-value">${num(e.avg_volatility, 2)}</span>
        </div>
      </div>
    </div>
  `}).join('');

  grid.querySelectorAll('.spec-card').forEach(card => {
    const open = () => openSpecialtyModal(
      card.dataset.program, card.dataset.quota, card.dataset.specialty
    );
    card.addEventListener('click', open);
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') open(); });
  });
}

function openSpecialtyModal(program, quota, specialty) {
  const modal  = document.getElementById('specialtyModal');
  const title  = document.getElementById('specModalTitle');
  const stats  = document.getElementById('specModalStats');

  title.textContent = `${specialty} — ${program} · ${quota}`;

  // Full hospital rows for this specialty
  const allHospRows = App.data.flatLookup.filter(r =>
    r.program === program && r.quota === quota && r.specialty === specialty
  );

  // Collect all years across these rows
  const allYears = [...new Set(
    allHospRows.flatMap(r => Object.keys(r.yearly_merit || {}).map(Number))
  )].sort((a, b) => a - b);

  // Populate hospital filter
  const hospSel = document.getElementById('specModalHospFilter');
  hospSel.innerHTML = '<option value="">All Hospitals</option>' +
    allHospRows.map(r => `<option value="${esc(r.hospital)}">${esc(r.hospital)}</option>`).join('');

  // Populate year filter
  const yearSel = document.getElementById('specModalYearFilter');
  yearSel.innerHTML = '<option value="">All Years</option>' +
    allYears.map(y => `<option value="${y}">${y}</option>`).join('');

  // Display mode (pct / raw)
  let displayMode = 'pct';

  function getDisplayVal(row, year = null) {
    if (year) {
      const raw = row.yearly_merit?.[String(year)] ?? null;
      if (raw == null) return null;
      if (displayMode === 'pct') {
        const max = YEAR_TOTAL_MAX[year];
        return max ? (raw / max) * 100 : raw;
      }
      return raw;
    }
    return displayMode === 'pct'
      ? (row.avg_pct_of_max ?? row.avg_closing_merit)
      : row.avg_closing_merit;
  }

  function getLatestVal(row) {
    if (displayMode === 'pct') return row.latest_pct_of_max ?? row.latest_merit;
    return row.latest_merit;
  }

  function valLabel() { return displayMode === 'pct' ? '% of Max' : 'Merit'; }

  function render() {
    const hospFilter = hospSel.value;
    const yearFilter = yearSel.value ? Number(yearSel.value) : null;

    let rows = hospFilter
      ? allHospRows.filter(r => r.hospital === hospFilter)
      : allHospRows;

    // Stats (always from full set)
    const avgVal  = allHospRows.reduce((s, r) => s + (getDisplayVal(r) ?? 0), 0) / allHospRows.length;
    const latVal  = allHospRows.reduce((s, r) => s + (getLatestVal(r) ?? 0), 0) / allHospRows.length;
    const totalSeats = allHospRows.reduce((s, r) => {
      const ys = Object.values(r.yearly_seats || {});
      return s + (ys.length ? ys[ys.length - 1] : 0);
    }, 0);
    stats.innerHTML = `
      <div class="modal-stat"><div class="modal-stat-val">${allHospRows.length}</div><div class="modal-stat-lbl">Hospitals</div></div>
      <div class="modal-stat"><div class="modal-stat-val">${num(avgVal, 1)}${displayMode==='pct'?'%':''}</div><div class="modal-stat-lbl">Avg ${valLabel()}</div></div>
      <div class="modal-stat"><div class="modal-stat-val">${num(latVal, 1)}${displayMode==='pct'?'%':''}</div><div class="modal-stat-lbl">Latest Avg ${valLabel()}</div></div>
      <div class="modal-stat"><div class="modal-stat-val">${totalSeats}</div><div class="modal-stat-lbl">Total Seats</div></div>
    `;

    // Column headers
    const suffix = displayMode === 'pct' ? '% of Max' : 'Merit';
    document.getElementById('specColAvg').textContent    = `Avg ${suffix}`;
    document.getElementById('specColLatest').textContent = `Latest ${suffix}`;

    // Main trend chart
    Charts.drawSpecTrendChart(rows, specialty, displayMode, yearFilter);

    // Table
    const tbody = document.getElementById('specHospitalBody');
    const sortedRows = [...rows].sort((a, b) => (getDisplayVal(b) ?? 0) - (getDisplayVal(a) ?? 0));
    tbody.innerHTML = sortedRows.map(r => {
      const avgDisplay = yearFilter
        ? (getDisplayVal(r, yearFilter) != null ? num(getDisplayVal(r, yearFilter), 1) + (displayMode==='pct'?'%':'') : '—')
        : (getDisplayVal(r) != null ? num(getDisplayVal(r), 1) + (displayMode==='pct'?'%':'') : '—');
      const latDisplay = num(getLatestVal(r), 1) + (displayMode==='pct'?'%':'');
      const ys = r.yearly_seats || {};
      const latSeat = Object.keys(ys).sort().pop();
      const seats = latSeat ? ys[latSeat] : '—';
      return `
        <tr class="clickable-row" data-hospital="${esc(r.hospital)}" title="Click to see yearly trend">
          <td>${esc(r.hospital)}</td>
          <td><strong>${avgDisplay}</strong></td>
          <td>${latDisplay}</td>
          <td>${seats}</td>
          <td>${trendBadge(r.trend)}</td>
          <td>${volBadge(r.volatility)}</td>
        </tr>`;
    }).join('');

    // Row click → drill down
    tbody.querySelectorAll('.clickable-row').forEach(row => {
      row.addEventListener('click', () => {
        const hosp = row.dataset.hospital;
        const hospRow = allHospRows.find(r => r.hospital === hosp);
        if (!hospRow) return;
        const drillArea  = document.getElementById('specDrillArea');
        const drillTitle = document.getElementById('specDrillTitle');
        const prevActive = tbody.querySelector('.clickable-row.active');
        if (prevActive === row && !drillArea.classList.contains('hidden')) {
          drillArea.classList.add('hidden');
          row.classList.remove('active');
          return;
        }
        tbody.querySelectorAll('.clickable-row').forEach(r => r.classList.remove('active'));
        row.classList.add('active');
        drillTitle.textContent = `${hosp} — yearly trend`;
        drillArea.classList.remove('hidden');
        Charts.drawDrillYearlyChart('specDrillChart', hospRow, displayMode);
      });
    });
  }

  // Wire filters
  hospSel.onchange = render;
  yearSel.onchange = render;

  // Wire display toggle
  modal.querySelectorAll('.modal-toggle-btn[data-modal-view="spec"]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === displayMode);
    btn.onclick = () => {
      displayMode = btn.dataset.view;
      modal.querySelectorAll('.modal-toggle-btn[data-modal-view="spec"]').forEach(b =>
        b.classList.toggle('active', b === btn));
      render();
    };
  });

  // Reset drill area on open
  document.getElementById('specDrillArea').classList.add('hidden');

  render();
  openModal(modal);
}

// ═══════════════════════════════════════════════════════
// HOSPITAL EXPLORER TAB
// ═══════════════════════════════════════════════════════

function setupHospitalTab() {
  document.getElementById('hospProgram').addEventListener('change', renderHospitalGrid);
  document.getElementById('hospSearch').addEventListener('input', renderHospitalGrid);

  document.getElementById('hospModalClose').addEventListener('click', () => {
    closeModal(document.getElementById('hospitalModal'));
  });
  document.getElementById('hospModalOverlay').addEventListener('click', () => {
    closeModal(document.getElementById('hospitalModal'));
  });

  // Centile / raw toggle
  document.querySelectorAll('.explorer-view-btn[data-tab="hosp"]').forEach(btn => {
    btn.addEventListener('click', () => {
      App.ui.explorerDisplayMode = btn.dataset.view;
      document.querySelectorAll('.explorer-view-btn[data-tab="hosp"]')
              .forEach(b => b.classList.toggle('active', b === btn));
      renderHospitalGrid();
    });
  });
}

function renderHospitalGrid() {
  const program = document.getElementById('hospProgram').value;
  const search  = document.getElementById('hospSearch').value.toLowerCase().trim();

  // Aggregate by hospital
  const hospMap = new Map();
  for (const row of App.data.flatLookup) {
    if (program && row.program !== program) continue;
    if (search && !row.hospital.toLowerCase().includes(search)) continue;
    if (!hospMap.has(row.hospital)) {
      hospMap.set(row.hospital, { specialties: new Set(), rows: [], program: row.program });
    }
    const h = hospMap.get(row.hospital);
    h.specialties.add(row.specialty);
    h.rows.push(row);
  }

  const grid = document.getElementById('hospitalGrid');
  if (hospMap.size === 0) {
    grid.innerHTML = '<p style="color:var(--text-light);padding:20px">No hospitals found.</p>';
    return;
  }

  const sorted = [...hospMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  grid.innerHTML = sorted.map(([hosp, data]) => {
    const avgMerit    = data.rows.reduce((s, r) => s + r.avg_closing_merit, 0) / data.rows.length;
    const programs    = [...new Set(data.rows.map(r => r.program))].join(', ');
    const isCentile   = App.ui.explorerDisplayMode === 'centile';
    const avgPom      = data.rows.reduce((s, r) => s + (r.avg_pct_of_max ?? 0), 0) / data.rows.length;
    const avgDisplay  = isCentile ? num(avgPom, 1) + '%' : num(avgMerit);
    const avgLabel    = isCentile ? 'Avg % of Max' : 'Avg Merit';
    return `
      <div class="hosp-card"
           data-hospital="${esc(hosp)}"
           data-program="${esc(program || '')}"
           tabindex="0"
           role="button"
           aria-label="View ${esc(hosp)} details">
        <h4>${esc(hosp)}</h4>
        <div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:8px">${esc(programs)}</div>
        <div class="card-meta">
          <div class="card-stat">
            <span class="card-stat-label">Specialties</span>
            <span class="card-stat-value">${data.specialties.size}</span>
          </div>
          <div class="card-stat">
            <span class="card-stat-label">${avgLabel}</span>
            <span class="card-stat-value">${avgDisplay}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');

  grid.querySelectorAll('.hosp-card').forEach(card => {
    const open = () => openHospitalModal(card.dataset.hospital, card.dataset.program);
    card.addEventListener('click', open);
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') open(); });
  });
}

function openHospitalModal(hospital, program) {
  const allRows = App.data.flatLookup.filter(r =>
    r.hospital === hospital && (!program || r.program === program)
  );

  document.getElementById('hospModalTitle').textContent = hospital;

  // Collect all years and specialties
  const allYears = [...new Set(
    allRows.flatMap(r => Object.keys(r.yearly_merit || {}).map(Number))
  )].sort((a, b) => a - b);

  const specSel = document.getElementById('hospModalSpecFilter');
  specSel.innerHTML = '<option value="">All Specialties</option>' +
    [...new Set(allRows.map(r => r.specialty))].sort()
      .map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');

  const yearSel = document.getElementById('hospModalYearFilter');
  yearSel.innerHTML = '<option value="">All Years</option>' +
    allYears.map(y => `<option value="${y}">${y}</option>`).join('');

  let displayMode = 'pct';

  function getDisplayVal(row, year = null) {
    if (year) {
      const raw = row.yearly_merit?.[String(year)] ?? null;
      if (raw == null) return null;
      if (displayMode === 'pct') {
        const max = YEAR_TOTAL_MAX[year];
        return max ? (raw / max) * 100 : raw;
      }
      return raw;
    }
    return displayMode === 'pct'
      ? (row.avg_pct_of_max ?? row.avg_closing_merit)
      : row.avg_closing_merit;
  }

  function getLatestVal(row) {
    return displayMode === 'pct' ? (row.latest_pct_of_max ?? row.latest_merit) : row.latest_merit;
  }

  function render() {
    const specFilter = specSel.value;
    const yearFilter = yearSel.value ? Number(yearSel.value) : null;

    let rows = specFilter ? allRows.filter(r => r.specialty === specFilter) : allRows;

    // Column headers
    const suffix = displayMode === 'pct' ? '% of Max' : 'Merit';
    document.getElementById('hospColAvg').textContent    = `Avg ${suffix}`;
    document.getElementById('hospColLatest').textContent = `Latest ${suffix}`;

    // Main chart
    Charts.drawHospSpecChart(rows, hospital, displayMode, yearFilter);

    // Table
    const tbody = document.getElementById('hospSpecBody');
    const sortedRows = [...rows].sort((a, b) => (getDisplayVal(b) ?? 0) - (getDisplayVal(a) ?? 0));
    tbody.innerHTML = sortedRows.map(r => {
      const avgDisplay = yearFilter
        ? (getDisplayVal(r, yearFilter) != null ? num(getDisplayVal(r, yearFilter), 1) + (displayMode==='pct'?'%':'') : '—')
        : (getDisplayVal(r) != null ? num(getDisplayVal(r), 1) + (displayMode==='pct'?'%':'') : '—');
      const latDisplay = num(getLatestVal(r), 1) + (displayMode==='pct'?'%':'');
      const ys = r.yearly_seats || {};
      const latSeat = Object.keys(ys).sort().pop();
      const seats = latSeat ? ys[latSeat] : '—';
      return `
        <tr class="clickable-row" data-specialty="${esc(r.specialty)}" data-quota="${esc(r.quota)}" title="Click to see yearly trend">
          <td>${esc(r.specialty)}</td>
          <td>${esc(r.quota)}</td>
          <td><strong>${avgDisplay}</strong></td>
          <td>${latDisplay}</td>
          <td>${seats}</td>
          <td>${trendBadge(r.trend)}</td>
        </tr>`;
    }).join('');

    // Row click → drill down
    tbody.querySelectorAll('.clickable-row').forEach(row => {
      row.addEventListener('click', () => {
        const spec  = row.dataset.specialty;
        const quota = row.dataset.quota;
        const specRow = allRows.find(r => r.specialty === spec && r.quota === quota);
        if (!specRow) return;
        const drillArea  = document.getElementById('hospDrillArea');
        const drillTitle = document.getElementById('hospDrillTitle');
        const prevActive = tbody.querySelector('.clickable-row.active');
        if (prevActive === row && !drillArea.classList.contains('hidden')) {
          drillArea.classList.add('hidden');
          row.classList.remove('active');
          return;
        }
        tbody.querySelectorAll('.clickable-row').forEach(r => r.classList.remove('active'));
        row.classList.add('active');
        drillTitle.textContent = `${spec} (${quota}) — yearly trend`;
        drillArea.classList.remove('hidden');
        Charts.drawDrillYearlyChart('hospDrillChart', specRow, displayMode);
      });
    });
  }

  specSel.onchange = render;
  yearSel.onchange = render;

  const modal = document.getElementById('hospitalModal');
  modal.querySelectorAll('.modal-toggle-btn[data-modal-view="hosp"]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === displayMode);
    btn.onclick = () => {
      displayMode = btn.dataset.view;
      modal.querySelectorAll('.modal-toggle-btn[data-modal-view="hosp"]').forEach(b =>
        b.classList.toggle('active', b === btn));
      render();
    };
  });

  document.getElementById('hospDrillArea').classList.add('hidden');

  render();
  openModal(modal);
}

// ═══════════════════════════════════════════════════════
// TRENDS TAB
// ═══════════════════════════════════════════════════════

function setupTrendsTab() {
  const trendProg  = document.getElementById('trendProgram');
  const trendQuota = document.getElementById('trendQuota');
  const trendSpec  = document.getElementById('trendSpecialty');
  const trendHosp  = document.getElementById('trendHospital');

  trendProg.addEventListener('change', () => {
    populateSelect(trendQuota, getQuotas(trendProg.value));
    populateSelect(trendSpec, getSpecialties(trendProg.value, trendQuota.value), 'Select Specialty');
    populateSelect(trendHosp, [], 'All Hospitals');
  });
  trendQuota.addEventListener('change', () => {
    populateSelect(trendSpec, getSpecialties(trendProg.value, trendQuota.value), 'Select Specialty');
    populateSelect(trendHosp, [], 'All Hospitals');
  });
  trendSpec.addEventListener('change', () => {
    const hospitals = getHospitals(trendProg.value, trendQuota.value, trendSpec.value);
    populateSelect(trendHosp, hospitals, 'All Hospitals');
    renderTrendsTab();
  });
  trendHosp.addEventListener('change', renderTrendsTab);

  // Percentile / raw toggle
  document.getElementById('trendModeRaw')?.addEventListener('click', () => {
    App.ui.trendMode = 'raw';
    document.getElementById('trendModeRaw').classList.add('active');
    document.getElementById('trendModePercentile').classList.remove('active');
    const hint = document.getElementById('trendModeHint');
    if (hint) hint.textContent = 'Raw merit values — not directly comparable across years (different scoring formulas).';
    renderTrendsTab();
  });
  document.getElementById('trendModePercentile')?.addEventListener('click', () => {
    App.ui.trendMode = 'percentile';
    document.getElementById('trendModePercentile').classList.add('active');
    document.getElementById('trendModeRaw').classList.remove('active');
    const hint = document.getElementById('trendModeHint');
    if (hint) hint.textContent = 'Percentile rank within each year\'s cohort — cross-year comparable even when scoring formula changed.';
    renderTrendsTab();
  });

  // Set initial toggle state
  const rawBtn = document.getElementById('trendModeRaw');
  const pctBtn = document.getElementById('trendModePercentile');
  if (rawBtn && pctBtn) {
    rawBtn.classList.toggle('active', App.ui.trendMode === 'raw');
    pctBtn.classList.toggle('active', App.ui.trendMode === 'percentile');
  }
}

function renderTrendsTab() {
  const program   = document.getElementById('trendProgram').value;
  const quota     = document.getElementById('trendQuota').value;
  const specialty = document.getElementById('trendSpecialty').value;
  const hospital  = document.getElementById('trendHospital').value;

  const rows = App.data.flatLookup.filter(r =>
    (!program   || r.program   === program)   &&
    (!quota     || r.quota     === quota)     &&
    (!specialty || r.specialty === specialty) &&
    (!hospital  || r.hospital  === hospital)
  );

  const note = document.getElementById('trendChartNote');

  if (!specialty && rows.length === 0) {
    note.textContent = 'Select a specialty to view closing merit trends.';
    Charts.clearChart('trendLineChart');
    updatePolicyAnnotation([]);
    return;
  }

  note.textContent = rows.length === 1
    ? `Showing trend for ${rows[0].hospital}`
    : `Showing trends for ${rows.length} hospitals`;

  Charts.drawTrendLineChart(rows, App.ui.trendMode);
  Charts.drawVolatilityChart(rows.length > 0 ? rows : App.data.flatLookup.slice(0, 50));
  updatePolicyAnnotation(rows);
}

function updatePolicyAnnotation(rows) {
  const annEl = document.getElementById('trendPolicyAnnotation');
  if (!annEl) return;
  const sp = App.data.scoringPolicy;
  if (!sp || !sp.policies) { annEl.classList.add('hidden'); return; }

  // Collect all years that appear in these rows
  const years = new Set();
  for (const row of rows) {
    Object.keys(row.yearly_merit || {}).forEach(y => years.add(Number(y)));
  }
  if (!years.size) { annEl.classList.add('hidden'); return; }

  const sortedYears = [...years].sort((a, b) => a - b);
  let lastLabel = null;
  const chips = sortedYears.map(yr => {
    const pol = sp.policies[yr] || sp.policies[String(yr)];
    if (!pol) return '';
    const label = pol.label || String(yr);
    if (label === lastLabel) return '';
    lastLabel = label;
    const included = (pol.components || []).filter(c => c.included !== false).map(c => c.label).join(', ');
    return `<span class="trend-anno-chip" title="${esc(included)}">${esc(yr)}: ${esc(pol.notes || label)}</span>`;
  }).filter(Boolean).join('');

  if (!chips) { annEl.classList.add('hidden'); return; }
  annEl.innerHTML = `<span class="trend-anno-label">\ud83d\udccc Policy per year:</span> ${chips}`;
  annEl.classList.remove('hidden');
}

// ═══════════════════════════════════════════════════════
// RANKINGS TAB
// ═══════════════════════════════════════════════════════

function setupRankingsTab() {
  document.getElementById('rankProgram').addEventListener('change', renderRankingsTab);
  document.getElementById('rankQuota').addEventListener('change', renderRankingsTab);
}

function renderRankingsTab() {
  const program = document.getElementById('rankProgram').value;
  const quota   = document.getElementById('rankQuota').value;

  const entries = [];
  for (const [prog, quotas] of Object.entries(App.data.specialtyRanking)) {
    if (program && prog !== program) continue;
    for (const [q, specs] of Object.entries(quotas)) {
      if (quota && q !== quota) continue;
      for (const [, data] of Object.entries(specs)) {
        entries.push(data);
      }
    }
  }

  entries.sort((a, b) => b.avg_closing_merit - a.avg_closing_merit);

  const tbody = document.getElementById('rankingTableBody');
  tbody.innerHTML = entries.map((e, i) => `
    <tr>
      <td><strong>${i + 1}</strong></td>
      <td>${esc(e.specialty)}</td>
      <td>${esc(e.program)}</td>
      <td>${esc(e.quota)}</td>
      <td><strong>${num(e.avg_closing_merit)}</strong></td>
      <td>${num(e.latest_avg_closing)}</td>
      <td>${num(e.avg_volatility, 2)}</td>
      <td>${compBadge(e.competitiveness)}</td>
      <td>${e.hospital_count}</td>
    </tr>
  `).join('');

  Charts.drawRankingBarChart(entries.slice(0, 30));
}

// ═══════════════════════════════════════════════════════
// STRATEGY TAB
// ═══════════════════════════════════════════════════════

function setupStrategyTab() {
  document.getElementById('stratBtn').addEventListener('click', runStrategy);
  document.getElementById('stratMerit').addEventListener('keydown', e => {
    if (e.key === 'Enter') runStrategy();
  });
  document.getElementById('stratProgram').addEventListener('change', () => {
    populateSelect(
      document.getElementById('stratQuota'),
      getQuotas(document.getElementById('stratProgram').value)
    );
  });
}

function runStrategy() {
  const merit   = parseFloat(document.getElementById('stratMerit').value);
  const program = document.getElementById('stratProgram').value;
  const quota   = document.getElementById('stratQuota').value;

  if (isNaN(merit)) { alert('Please enter a valid merit score.'); return; }

  // Use centile mode: convert user score to % of active policy max, compare against avg_pct_of_max.
  // This ensures cross-induction comparability regardless of which scoring formula changed.
  const results  = predictOptions(merit, program, quota, 'latest', 'centile');
  const userPct  = results[0]?.user_pct_of_max ?? null;
  const allPcts  = results.map(r => r.used_pct_of_max).filter(v => v != null);
  const band     = userPct != null ? getMeritBand(userPct, allPcts) : getMeritBand(merit, []);

  // Show band card
  const bandCard = document.getElementById('stratBandCard');
  document.getElementById('stratBandBadge').textContent = band.emoji;
  document.getElementById('stratBandBadge').className   = `band-badge ${band.cls}`;
  document.getElementById('stratBandTitle').textContent  = `${band.label} Merit`;
  document.getElementById('stratBandDesc').textContent   = band.desc;
  bandCard.classList.remove('hidden');

  // Categorize by delta in % units:
  // Safe:      delta >= +3%   (clearly above historical threshold)
  // Moderate:  delta  -2% to +3%
  // Ambitious: delta  -8% to -2%
  const safe      = results.filter(r => r.delta >= 3.0);
  const moderate  = results.filter(r => r.delta >= -2.0 && r.delta < 3.0);
  const ambitious = results.filter(r => r.delta >= -8.0 && r.delta < -2.0);

  safe.sort((a, b)      => b.delta - a.delta);
  moderate.sort((a, b)  => b.delta - a.delta);
  ambitious.sort((a, b) => b.delta - a.delta);

  function stratItems(arr) {
    if (arr.length === 0) return '<p style="color:var(--text-light);font-size:0.82rem;padding:8px">None in this category</p>';
    return arr.slice(0, 25).map(r => {
      const gapCls = r.delta >= 0 ? 'gap-positive' : r.delta >= -2 ? 'gap-small' : 'gap-negative';
      const gapStr = (r.delta >= 0 ? '+' : '') + num(r.delta, 1) + '%';
      const dispVal = r.used_pct_of_max != null ? num(r.used_pct_of_max, 1) + '% of max' : num(r.used_closing_merit);
      return `
        <div class="strat-item">
          <div class="strat-item-specialty">${esc(r.specialty)}</div>
          <div class="strat-item-hospital">${esc(r.hospital)}</div>
          <div class="strat-item-meta">
            <span>Avg closing: ${dispVal}</span>
            <span class="strat-item-gap ${gapCls}">Δ ${gapStr}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  document.getElementById('stratSafe').innerHTML      = stratItems(safe);
  document.getElementById('stratModerate').innerHTML  = stratItems(moderate);
  document.getElementById('stratAmbitious').innerHTML = stratItems(ambitious);
  document.getElementById('strategyColumns').classList.remove('hidden');

  // Strategy chart — pass pct values for correct scale
  document.getElementById('stratChartCard').style.display = 'block';
  Charts.drawStrategyChart(userPct ?? merit, results.slice(0, 40));
}

// ═══════════════════════════════════════════════════════
// BACK TO TOP
// ═══════════════════════════════════════════════════════

function setupBackToTop() {
  const btn = document.getElementById('backToTop');
  if (!btn) return;
  window.addEventListener('scroll', () => {
    btn.classList.toggle('visible', window.scrollY > 400);
  }, { passive: true });
  btn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

// ═══════════════════════════════════════════════════════
// KEYBOARD SHORTCUTS
// ═══════════════════════════════════════════════════════

function setupKeyboardShortcuts() {
  const TABS = ['predictor', 'specialty', 'hospital', 'trends', 'rankings', 'strategy', 'calculator', 'guide', 'policy', 'tools'];
  document.addEventListener('keydown', e => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= TABS.length) {
      e.preventDefault();
      switchToTab(TABS[n - 1]);
      return;
    }
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal:not(.hidden)').forEach(m => closeModal(m));
    }
  });
}

// ═══════════════════════════════════════════════════════
// HAMBURGER (mobile nav)
// ═══════════════════════════════════════════════════════

function setupHamburger() {
  const btn = document.getElementById('hamburgerBtn');
  const nav = document.getElementById('mainNav');
  if (!btn || !nav) return;
  btn.addEventListener('click', () => {
    const open = nav.classList.toggle('nav-open');
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  // Clicking a tab closes the mobile nav
  nav.addEventListener('click', e => {
    if (e.target.classList.contains('tab-btn')) {
      nav.classList.remove('nav-open');
      btn.setAttribute('aria-expanded', 'false');
    }
  });
}

// ═══════════════════════════════════════════════════════
// RECENT SCORES (localStorage)
// ═══════════════════════════════════════════════════════

const RECENT_KEY = 'prp_recent_scores';
const MAX_RECENT = 5;

function getRecentScores() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); }
  catch { return []; }
}

function saveRecentScore(score) {
  let arr = getRecentScores().filter(v => v !== score);
  arr.unshift(score);
  arr = arr.slice(0, MAX_RECENT);
  localStorage.setItem(RECENT_KEY, JSON.stringify(arr));
}

function renderRecentScores() {
  const scores = getRecentScores();
  const bar   = document.getElementById('recentScoresBar');
  const list  = document.getElementById('recentScoresList');
  if (!bar || !list) return;
  if (scores.length === 0) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  list.innerHTML = scores.map(s =>
    `<button class="recent-chip" data-score="${s}">${s}</button>`
  ).join('');
}

function setupRecentScores() {
  renderRecentScores();

  document.getElementById('recentScoresList')?.addEventListener('click', e => {
    const chip = e.target.closest('.recent-chip');
    if (!chip) return;
    const score = parseFloat(chip.dataset.score);
    if (!isNaN(score)) {
      const input = document.getElementById('userMerit');
      if (input) input.value = score;
      runPredictor();
    }
  });

  document.getElementById('clearRecent')?.addEventListener('click', () => {
    localStorage.removeItem(RECENT_KEY);
    renderRecentScores();
  });
}

// ═══════════════════════════════════════════════════════
// MERIT CONTEXT BAR (sticky score summary across tabs)
// ═══════════════════════════════════════════════════════

function updateMeritContextBar(merit, band, likely, borderline) {
  App.ui.lastMerit = merit;
  const bar = document.getElementById('meritContextBar');
  if (!bar) return;
  const score = document.getElementById('ctxScore');
  const bandEl = document.getElementById('ctxBand');
  const likelyEl = document.getElementById('ctxLikely');
  const blEl = document.getElementById('ctxBorderline');
  if (score)   score.textContent = merit.toFixed(2);
  if (bandEl)  bandEl.textContent = band.emoji + ' ' + band.label;
  if (likelyEl)   likelyEl.textContent = `✅ ${likely} likely`;
  if (blEl)    blEl.textContent = `⚡ ${borderline} borderline`;
  bar.classList.remove('hidden');
}

function setupMeritContextBar() {
  document.getElementById('ctxRerun')?.addEventListener('click', () => {
    switchToTab('predictor');
    setTimeout(() => {
      document.getElementById('userMerit')?.focus();
    }, 150);
  });
}

// ═══════════════════════════════════════════════════════
// URL PARAMS (pre-fill from query string)
// ═══════════════════════════════════════════════════════

function handleURLParams() {
  const p = new URLSearchParams(window.location.search);
  const merit   = parseFloat(p.get('merit'));
  const program = p.get('program') || '';
  const quota   = p.get('quota')   || '';
  const tab     = p.get('tab');

  if (tab) switchToTab(tab);

  if (!isNaN(merit)) {
    const input = document.getElementById('userMerit');
    if (input) input.value = merit;
    const progSel = document.getElementById('programFilter');
    const quotaSel = document.getElementById('quotaFilter');
    if (program && progSel) {
      progSel.value = program;
      populateSelect(quotaSel, getQuotas(program));
    }
    if (quota && quotaSel) quotaSel.value = quota;
    switchToTab('predictor');
    runPredictor();
  }
}

// ═══════════════════════════════════════════════════════
// KEYBOARD HINT (shown briefly after first load)
// ═══════════════════════════════════════════════════════

function showKbdHint() {
  if (localStorage.getItem('prp_kbd_hint_shown')) return;
  const hint = document.getElementById('kbdHint');
  if (!hint) return;
  hint.classList.remove('hidden');
  localStorage.setItem('prp_kbd_hint_shown', '1');

  const dismiss = () => hint.classList.add('hidden');
  document.getElementById('kbdHintClose')?.addEventListener('click', dismiss);
  setTimeout(dismiss, 8000);
}

// ═══════════════════════════════════════════════════════
// TOOLS TAB
// ═══════════════════════════════════════════════════════

function setupToolsTab() {
  setupSimulator();
  setupGapAnalyzer();
  setupShortlistUI();
}

// ── What-If Simulator ──────────────────────────────────

function setupSimulator() {
  const baseInput = document.getElementById('simBase');
  const slider    = document.getElementById('simSlider');
  const adjLabel  = document.getElementById('simAdjLabel');

  function run() {
    const base = parseFloat(baseInput.value);
    const adj  = parseFloat(slider.value);
    const adjStr = (adj >= 0 ? '+' : '') + adj.toFixed(1);
    adjLabel.textContent = adjStr;
    if (isNaN(base)) {
      document.getElementById('simComparison').classList.add('hidden');
      document.getElementById('simHint').textContent = 'Enter your merit score above and move the slider.';
      return;
    }
    const prog  = document.getElementById('simProgram').value;
    const quota = document.getElementById('simQuota').value;
    const resA  = predictOptions(base, prog, quota, 'latest');
    const resB  = predictOptions(base + adj, prog, quota, 'latest');
    document.getElementById('simScoreA').textContent = base.toFixed(2);
    document.getElementById('simScoreB').textContent = (base + adj).toFixed(2);
    renderSimBars('simBarsA', resA);
    renderSimBars('simBarsB', resB);
    document.getElementById('simComparison').classList.remove('hidden');
    document.getElementById('simHint').textContent = '';
  }

  baseInput.addEventListener('input', run);
  slider.addEventListener('input', run);
  document.getElementById('simProgram').addEventListener('change', run);
  document.getElementById('simQuota').addEventListener('change', run);

  // Pre-fill from last predictor run
  if (App.ui.lastMerit != null) {
    baseInput.value = App.ui.lastMerit;
    run();
  }
}

function renderSimBars(containerId, results) {
  const total      = results.length || 1;
  const likely     = results.filter(r => r.outcome === 'likely').length;
  const borderline = results.filter(r => r.outcome === 'borderline').length;
  const unlikely   = results.filter(r => r.outcome === 'unlikely').length;

  function row(cls, label, count) {
    const pct = Math.round((count / total) * 100);
    return `
      <div class="sim-stat-row">
        <span class="sim-stat-label">${label}</span>
        <div class="sim-stat-track">
          <div class="sim-stat-fill ${cls}" style="width:${pct}%"></div>
        </div>
        <span class="sim-stat-count ${cls}">${count}</span>
      </div>`;
  }

  document.getElementById(containerId).innerHTML =
    row('likely',     '✅ Likely',     likely)     +
    row('borderline', '⚡ Borderline', borderline) +
    row('unlikely',   '❌ Unlikely',   unlikely);
}

// ── Gap Analyzer ──────────────────────────────────────

function setupGapAnalyzer() {
  const progSel  = document.getElementById('gapProgram');
  const quotaSel = document.getElementById('gapQuota');
  const specSel  = document.getElementById('gapSpecialty');
  const hospSel  = document.getElementById('gapHospital');

  function refreshSpecs() {
    const prog  = progSel.value;
    const quota = quotaSel.value;
    populateSelect(specSel, getSpecialties(prog, quota), 'Select Specialty');
    populateSelect(hospSel, [], 'Select Hospital');
    document.getElementById('gapResult').classList.add('hidden');
  }
  function refreshHosps() {
    const prog  = progSel.value;
    const quota = quotaSel.value;
    const spec  = specSel.value;
    populateSelect(hospSel, getHospitals(prog, quota, spec), 'Select Hospital');
    document.getElementById('gapResult').classList.add('hidden');
  }

  progSel.addEventListener('change', refreshSpecs);
  quotaSel.addEventListener('change', refreshSpecs);
  specSel.addEventListener('change', refreshHosps);

  document.getElementById('gapBtn').addEventListener('click', runGapAnalysis);
}

function projectNextYear(row) {
  const ym    = row.yearly_merit || {};
  const years = Object.keys(ym).map(Number).sort();
  if (years.length < 2) return null;
  const changes = [];
  for (let i = 1; i < years.length; i++) {
    changes.push(ym[years[i]] - ym[years[i - 1]]);
  }
  const avg = changes.reduce((a, b) => a + b, 0) / changes.length;
  return row.latest_merit + avg;
}

function runGapAnalysis() {
  const prog     = document.getElementById('gapProgram').value;
  const quota    = document.getElementById('gapQuota').value;
  const spec     = document.getElementById('gapSpecialty').value;
  const hosp     = document.getElementById('gapHospital').value;
  const merit    = parseFloat(document.getElementById('gapMerit').value);
  const resultEl = document.getElementById('gapResult');

  if (!spec || !hosp) {
    resultEl.innerHTML = '<p style="color:#e05470;padding:12px 0">Please select a specialty and hospital.</p>';
    resultEl.classList.remove('hidden');
    return;
  }
  if (isNaN(merit)) {
    resultEl.innerHTML = '<p style="color:#e05470;padding:12px 0">Please enter your merit score.</p>';
    resultEl.classList.remove('hidden');
    return;
  }

  const row = App.data.flatLookup.find(r =>
    r.specialty === spec && r.hospital === hosp &&
    (!prog  || r.program === prog)  &&
    (!quota || r.quota   === quota)
  );
  if (!row) {
    resultEl.innerHTML = '<p style="color:#e05470;padding:12px 0">No data found for this combination.</p>';
    resultEl.classList.remove('hidden');
    return;
  }

  const closing   = row.latest_merit;
  const gap       = merit - closing;
  const projected = projectNextYear(row);
  const gapCls    = gap >= 0 ? 'positive' : 'negative';
  const gapSign   = gap >= 0 ? '+' : '';

  // Historical year items
  const ym    = row.yearly_merit || {};
  const years = Object.keys(ym).map(Number).sort();
  const latestYr = years[years.length - 1];
  const histItems = years.map(y =>
    `<div class="gap-history-item${y === latestYr ? ' gh-latest' : ''}">
       <span class="gh-year">${y}</span>
       <span class="gh-val">${Number(ym[y]).toFixed(2)}</span>
     </div>`
  ).join('');

  // Verdict text
  let verdict = '';
  if (gap >= 1) {
    verdict = `<strong>Good news!</strong> Your score is <strong>${gapSign}${gap.toFixed(2)}</strong> marks above the latest cutoff — you would have qualified. Keep an eye on rising trends.`;
  } else if (gap >= -1) {
    verdict = `<strong>Very close.</strong> You are only <strong>${Math.abs(gap).toFixed(2)}</strong> mark(s) away. This is a borderline situation — volatility matters a lot here. A <em>${row.trend}</em> trend ${row.trend === 'falling' ? 'may work in your favour' : 'could make it harder'}.`;
  } else {
    verdict = `Your score is <strong>${Math.abs(gap).toFixed(2)}</strong> marks below the latest cutoff. You would need to improve by this amount to have qualified last cycle. The trend is <em>${row.trend}</em>${row.trend === 'falling' ? ' — the gap may narrow over time' : ''}.`;
  }

  const projHtml = projected != null
    ? `<div class="gap-card"><span class="gap-label">Est. Next Year</span><span class="gap-value projected">~${projected.toFixed(2)}</span><span class="gap-sub">based on trend</span></div>`
    : '';

  resultEl.innerHTML = `
    <div class="gap-cards">
      <div class="gap-card">
        <span class="gap-label">Your Score</span>
        <span class="gap-value">${merit.toFixed(2)}</span>
      </div>
      <div class="gap-card">
        <span class="gap-label">Closing Merit (${latestYr})</span>
        <span class="gap-value">${num(closing)}</span>
      </div>
      <div class="gap-card gap-card-main">
        <span class="gap-label">Gap</span>
        <span class="gap-value ${gapCls}">${gapSign}${gap.toFixed(2)}</span>
        <span class="gap-sub">${gap >= 0 ? 'marks above cutoff' : 'marks below cutoff'}</span>
      </div>
      <div class="gap-card">
        <span class="gap-label">Trend</span>
        <span class="gap-value" style="font-size:1rem">${row.trend === 'rising' ? '↑ Rising' : row.trend === 'falling' ? '↓ Falling' : '→ Stable'}</span>
      </div>
      ${projHtml}
    </div>
    <div class="gap-verdict ${gapCls}">${verdict}</div>
    <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:6px">Historical closing merits:</div>
    <div class="gap-history-grid">${histItems}</div>
  `;
  resultEl.classList.remove('hidden');
}

// ── Shortlist ──────────────────────────────────────────

const SHORTLIST_KEY = 'prp_shortlist';

function shortlistId(row) {
  return `${row.program}||${row.quota}||${row.specialty}||${row.hospital}`;
}

function getShortlist() {
  try { return JSON.parse(localStorage.getItem(SHORTLIST_KEY) || '[]'); }
  catch { return []; }
}

function saveShortlistData(arr) {
  localStorage.setItem(SHORTLIST_KEY, JSON.stringify(arr));
}

function toggleShortlistItem(row) {
  const id  = shortlistId(row);
  let list  = getShortlist();
  const idx = list.findIndex(i => i.id === id);
  if (idx >= 0) {
    list.splice(idx, 1);
  } else {
    list.push({
      id,
      specialty:          row.specialty,
      hospital:           row.hospital,
      program:            row.program,
      quota:              row.quota,
      used_closing_merit: row.used_closing_merit,
      outcome:            row.outcome,
    });
  }
  saveShortlistData(list);
}

function renderShortlist() {
  const list     = getShortlist();
  const emptyEl  = document.getElementById('shortlistEmpty');
  const contentEl = document.getElementById('shortlistContent');
  if (!emptyEl || !contentEl) return;

  if (list.length === 0) {
    emptyEl.classList.remove('hidden');
    contentEl.classList.add('hidden');
    return;
  }
  emptyEl.classList.add('hidden');
  contentEl.classList.remove('hidden');

  const tbody = document.getElementById('shortlistBody');
  if (!tbody) return;
  tbody.innerHTML = list.map(item => `
    <tr class="row-${item.outcome}">
      <td>${esc(item.specialty)}</td>
      <td>${esc(item.hospital)}</td>
      <td>${esc(item.program)}</td>
      <td>${esc(item.quota)}</td>
      <td><strong>${num(item.used_closing_merit)}</strong></td>
      <td>${outcomeBadge(item.outcome)}</td>
      <td><button class="shortlist-remove" data-id="${esc(item.id)}" title="Remove">✕</button></td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.shortlist-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      let list = getShortlist().filter(i => i.id !== btn.dataset.id);
      saveShortlistData(list);
      renderShortlist();
    });
  });
}

function setupShortlistUI() {
  renderShortlist();

  document.getElementById('goToPredictor')?.addEventListener('click', () => {
    switchToTab('predictor');
  });

  document.getElementById('clearShortlist')?.addEventListener('click', () => {
    if (confirm('Clear your entire shortlist?')) {
      localStorage.removeItem(SHORTLIST_KEY);
      renderShortlist();
    }
  });

  document.getElementById('printShortlist')?.addEventListener('click', () => {
    window.print();
  });
}

// ═══════════════════════════════════════════════════════
// BOOTSTRAP
// ═══════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  loadAllData();
});
