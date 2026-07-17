'use strict';

// ═══════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════

const DATA_BASE = 'data/';

const LOADING_TIPS = [
  '📊 Closing merits can shift significantly year to year — check the trend column!',
  '🎯 Use My Prediction to see your personalised safe, target and reach list.',
  '📐 % of Max values are normalised — fair cross-year comparison even when the formula changed.',
  '📋 Keep Current Merit updated from the official PHF list for the latest data.',
  '🔍 Click any row in the Merit Table to see a full year-by-year breakdown.',
];

// Rotating motivational Quranic verses — one shown randomly per page load
const VERSES = [
  { arabic: 'فَإِنَّ مَعَ الْعُسْرِ يُسْرًا', translation: 'So verily, with hardship comes ease.', ref: 'Surah Al-Inshirah 94:5' },
  { arabic: 'إِنَّ مَعَ الْعُسْرِ يُسْرًا', translation: 'Indeed, with hardship will be ease.', ref: 'Surah Al-Inshirah 94:6' },
  { arabic: 'وَلَا تَيْأَسُوا مِن رَّوْحِ اللَّهِ', translation: 'Do not despair of the mercy of Allah.', ref: 'Surah Yusuf 12:87' },
  { arabic: 'وَمَن يَتَوَكَّلْ عَلَى اللَّهِ فَهُوَ حَسْبُهُ', translation: 'Whoever relies upon Allah — He is sufficient for him.', ref: 'Surah At-Talaq 65:3' },
  { arabic: 'إِنَّ اللَّهَ لَا يُضِيعُ أَجْرَ الْمُحْسِنِينَ', translation: 'Allah does not allow the reward of the doers of good to be lost.', ref: 'Surah At-Tawbah 9:120' },
  { arabic: 'وَعَسَىٰ أَن تَكْرَهُوا شَيْئًا وَهُوَ خَيْرٌ لَّكُمْ', translation: 'Perhaps you dislike a thing and it is good for you.', ref: 'Surah Al-Baqarah 2:216' },
  { arabic: 'وَقُل رَّبِّ زِدْنِي عِلْمًا', translation: 'And say: My Lord, increase me in knowledge.', ref: 'Surah Ta-Ha 20:114' },
  { arabic: 'حَسْبُنَا اللَّهُ وَنِعْمَ الْوَكِيلُ', translation: 'Allah is sufficient for us, and He is the best disposer of affairs.', ref: "Surah Ali 'Imran 3:173" },
  { arabic: 'وَلَسَوْفَ يُعْطِيكَ رَبُّكَ فَتَرْضَىٰ', translation: 'Your Lord is going to give you, and you will be satisfied.', ref: 'Surah Ad-Duha 93:5' },
  { arabic: 'أَلَمْ نَشْرَحْ لَكَ صَدْرَكَ', translation: 'Did We not expand for you your chest \u2014 and relieve you of your burden?', ref: 'Surah Al-Inshirah 94:1' },
];

function showDailyVerse() {
  const el = document.getElementById('dailyVerse');
  if (!el) return;
  const v = VERSES[Math.floor(Math.random() * VERSES.length)];
  el.innerHTML =
    `<span class="dv-arabic">${v.arabic}</span>` +
    `<span class="dv-translation">${v.translation}</span>` +
    `<span class="dv-ref">${v.ref}</span>`;
  el.classList.remove('hidden');
}

// Year → total max marks (populated after scoring_policy.json loads)
const YEAR_TOTAL_MAX = {};

const MERIT_BANDS = [
  { id: 'top',  label: 'Top Tier',  emoji: '🏆', min: 80,  max: Infinity, cls: 'band-top',  desc: 'Exceptional score — almost every specialty is within reach.' },
  { id: 'high', label: 'High',      emoji: '⭐', min: 60,  max: 80,       cls: 'band-high', desc: 'Strong score. Many competitive specialties are accessible.' },
  { id: 'mid',  label: 'Mid Range', emoji: '📊', min: 40,  max: 60,       cls: 'band-mid',  desc: 'Average range. Plenty of good options — focus on moderate-demand specialties.' },
  { id: 'low',  label: 'Low',       emoji: '📋', min: -Infinity, max: 40, cls: 'band-low',  desc: 'Below average for most competitive options,but many specialties are still available.' },
];

// ═══════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════

const App = {
  data: {
    flatLookup:    null,
    scoringPolicy: null,
    currentMerit:  null,
  },
  ui: {
    activeTab: 'start',
    predResults: [],
    yearMeritCache: null,
  },
};

// ── Merit Table sub-state ──
const MT = {
  displayMode: 'pct',   // 'pct' | 'raw'
  selectedIdx: null,
  filteredRows: [],
  sortKey: null,
  sortDir: 1,
};

// ═══════════════════════════════════════════════════════
// DATA LOADING
// ═══════════════════════════════════════════════════════

async function fetchJSON(file, label) {
  setLoadingDetail(`Loading ${label}…`);
  const res = await fetch(DATA_BASE + file, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed: ${file} (${res.status})`);
  return res.json();
}

function setLoadingProgress(pct) {
  const bar = document.getElementById('loadingBar');
  if (bar) bar.style.width = pct + '%';
}

let _tipTimer = null;
function startLoadingTips() {
  let idx = 0;
  const el = document.getElementById('loadingTip');
  if (!el) return;
  function show() {
    el.classList.remove('visible');
    setTimeout(() => { el.textContent = LOADING_TIPS[idx++ % LOADING_TIPS.length]; el.classList.add('visible'); }, 400);
  }
  show();
  _tipTimer = setInterval(show, 3200);
}
function stopLoadingTips() { if (_tipTimer) { clearInterval(_tipTimer); _tipTimer = null; } }

async function loadAllData() {
  try {
    startLoadingTips();
    setLoadingProgress(10);

    const flatLookup = await fetchJSON('flat_lookup.json', 'merit data');
    setLoadingProgress(50);

    const scoringPolicy = await fetchJSON('scoring_policy.json', 'scoring policy');
    setLoadingProgress(85);

    let currentMerit = null;
    try { currentMerit = await fetchJSON('current_merit.json', 'current merit'); } catch (_) {}
    setLoadingProgress(100);

    App.data.flatLookup    = flatLookup;
    App.data.scoringPolicy = scoringPolicy;
    App.data.currentMerit  = currentMerit;

    setLoadingDetail(`Ready — ${flatLookup.length.toLocaleString()} records loaded`);
    stopLoadingTips();
    await new Promise(r => setTimeout(r, 450));
    hideLoading();
    showDailyVerse();
    onDataReady();
  } catch (err) {
    stopLoadingTips();
    console.error('[MeritNama] Load error:', err);
    setLoadingDetail('⚠ Error loading data. Ensure JSON files exist in /data/');
  }
}

// ═══════════════════════════════════════════════════════
// DATA ACCESSORS
// ═══════════════════════════════════════════════════════

function getPrograms()               { return [...new Set(App.data.flatLookup.map(r => r.program))].sort(); }
function getQuotas(prog = '')        { return [...new Set(App.data.flatLookup.filter(r => !prog || r.program === prog).map(r => r.quota))].sort(); }
function getSpecialties(prog = '', q = '') {
  return [...new Set(App.data.flatLookup.filter(r => (!prog || r.program === prog) && (!q || r.quota === q)).map(r => r.specialty))].sort();
}
function getYears() {
  const all = new Set();
  for (const r of App.data.flatLookup) Object.keys(r.yearly_merit || {}).forEach(y => all.add(Number(y)));
  return [...all].sort((a, b) => a - b);
}
function getLatestYear() { const y = getYears(); return y[y.length - 1]; }

function getInductionYearMap() {
  const map = {};
  const sp = App.data.scoringPolicy;
  if (!sp?.policies) return map;
  for (const [policyKey, pol] of Object.entries(sp.policies)) {
    const baseYear = parseInt(policyKey.split('-')[0]);
    const ind = pol.induction;
    let ids = [];
    if (typeof ind === 'number') ids = [ind];
    else if (typeof ind === 'string') {
      const parts = ind.split('-');
      const start = parseInt(parts[0]), end = parseInt(parts[parts.length - 1]);
      for (let i = start; i <= end; i++) ids.push(i);
    }
    for (const id of ids) map[id] = baseYear;
  }
  return map;
}

function formatInductionLabel(id) {
  const map = getInductionYearMap();
  const year = map[Number(id)];
  return year ? `${year} (Ind ${id})` : `Induction ${id}`;
}

function formatYearShort(id) {
  const map = getInductionYearMap();
  return map[Number(id)] || String(id);
}

// ═══════════════════════════════════════════════════════
// COMPUTATION — percentile + % of max
// ═══════════════════════════════════════════════════════

function computeMeritPercentOfMax() {
  const sp = App.data.scoringPolicy;
  // Primary: year_total_max
  if (sp?.year_total_max) {
    for (const [yr, max] of Object.entries(sp.year_total_max)) YEAR_TOTAL_MAX[Number(yr)] = max;
  } else if (sp?.policies) {
    for (const [yr, pol] of Object.entries(sp.policies)) {
      if (pol.total_marks) YEAR_TOTAL_MAX[Number(yr)] = pol.total_marks;
    }
  }

  // Per-induction max — safe guard for years with two inductions (e.g. 2026: Ind 20=35, Ind 21=30)
  const inductionMax = {};
  if (sp?._induction_max) {
    for (const [ind, max] of Object.entries(sp._induction_max)) inductionMax[Number(ind)] = max;
  }

  for (const row of App.data.flatLookup) {
    const pom = {};
    for (const [year, merit] of Object.entries(row.yearly_merit || {})) {
      // Prefer per-induction max if the row carries an induction number for this year
      const indNum = row.yearly_induction?.[year];
      const max = (indNum && inductionMax[indNum]) ? inductionMax[indNum] : YEAR_TOTAL_MAX[Number(year)];
      if (max) pom[year] = (merit / max) * 100;
    }
    row.yearly_pct_of_max  = Object.keys(pom).length ? pom : (row.yearly_pct_of_max || {});
    const vals = Object.values(row.yearly_pct_of_max);
    row.latest_pct_of_max  = row.yearly_pct_of_max[String(row.latest_year)] ?? (vals[vals.length - 1] ?? null);
    row.avg_pct_of_max     = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }
}

function computeYearlyPercentiles() {
  const cache = {};
  for (const row of App.data.flatLookup) {
    for (const [year, merit] of Object.entries(row.yearly_merit || {})) {
      const key = `${year}_${row.program}`;
      if (!cache[key]) cache[key] = [];
      cache[key].push(merit);
    }
  }
  App.ui.yearMeritCache = cache;
  for (const row of App.data.flatLookup) {
    if (row.yearly_percentile && Object.keys(row.yearly_percentile).length > 0) continue;
    const yp = {};
    for (const [year, merit] of Object.entries(row.yearly_merit || {})) {
      const all = cache[`${year}_${row.program}`] || [];
      if (all.length) yp[year] = Math.round(all.filter(v => v < merit).length / all.length * 100);
    }
    row.yearly_percentile = yp;
  }
}

// ═══════════════════════════════════════════════════════
// PREDICTION ENGINE
// ═══════════════════════════════════════════════════════

function getActivePolicyForCalc() {
  const sp = App.data.scoringPolicy;
  if (!sp) return null;
  if (sp.policies) {
    const key = sp.expected_policy || sp.active_policy;
    if (key && sp.policies[key]) return { key, policy: sp.policies[key], isExpected: key === sp.expected_policy };
    const keys = Object.keys(sp.policies).sort();
    const last  = keys[keys.length - 1];
    return { key: last, policy: sp.policies[last], isExpected: false };
  }
  const years = Object.keys(sp).filter(k => !isNaN(k)).sort();
  const last  = years[years.length - 1];
  return { key: last, policy: sp[last], isExpected: false };
}

function getActivePolicyMax() {
  const active = getActivePolicyForCalc();
  if (active?.policy?.total_marks) return active.policy.total_marks;
  const keys = Object.keys(YEAR_TOTAL_MAX).map(Number).sort();
  return keys.length ? YEAR_TOTAL_MAX[keys[keys.length - 1]] : null;
}

function getMeritBand(pct, allPcts) {
  if (!allPcts || !allPcts.length) return MERIT_BANDS[2];
  const below = allPcts.filter(v => v < pct).length;
  const p = (below / allPcts.length) * 100;
  if (p >= 80) return MERIT_BANDS[0];
  if (p >= 60) return MERIT_BANDS[1];
  if (p >= 40) return MERIT_BANDS[2];
  return MERIT_BANDS[3];
}

function getPercentile(val, allVals) {
  if (!allVals || !allVals.length) return 0;
  return Math.round(allVals.filter(v => v < val).length / allVals.length * 100);
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
function populateSelect(sel, options, defaultLabel = 'All') {
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = `<option value="">${defaultLabel}</option>` +
    options.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
  if (options.includes(cur)) sel.value = cur;
}
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function num(v, d = 2) { return (v == null || isNaN(v)) ? '—' : Number(v).toFixed(d); }
function trendBadge(t) {
  if (t === 'rising')  return `<span class="trend-rising">&#8593; Rising</span>`;
  if (t === 'falling') return `<span class="trend-falling">&#8595; Falling</span>`;
  return `<span class="trend-stable">&#8594; Stable</span>`;
}
function volBadge(v) {
  const label = v ? (v.charAt(0).toUpperCase() + v.slice(1)) : '—';
  return `<span class="vol-${v}">${label}</span>`;
}
function confBadge(c) {
  const label = c ? (c.charAt(0).toUpperCase() + c.slice(1)) : '—';
  return `<span class="conf-${c}">${label}</span>`;
}

// ═══════════════════════════════════════════════════════
// INDUCTION SUMMARY — rendered on the Start tab
// ═══════════════════════════════════════════════════════

function renderInductionSummary() {
  const grid = document.getElementById('inductionSummaryGrid');
  if (!grid) return;

  const sp = App.data.scoringPolicy;
  const flat = App.data.flatLookup;
  if (!sp?.policies || !flat) {
    grid.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted)">Data not available</div>';
    return;
  }

  if (typeof Charts !== 'undefined') Charts.drawAggregateMeritTrendChart('startTrendChart', flat);

  // Build policy_by_induction from scoring_policy.json
  const inductionMax = sp._induction_max || {};
  const inductionMap = {};

  for (const [policyKey, pol] of Object.entries(sp.policies)) {
    const baseYear = parseInt(policyKey.split('-')[0]);
    let ids = [];
    const ind = pol.induction;
    if (typeof ind === 'number') ids = [ind];
    else if (typeof ind === 'string') {
      const parts = ind.split('-');
      const start = parseInt(parts[0]), end = parseInt(parts[parts.length - 1]);
      for (let i = start; i <= end; i++) ids.push(i);
    }
    for (const id of ids) {
      const total = inductionMax[id] || pol.total_marks || 0;
      const included = (pol.components || []).filter(c => c.included !== false);
      const removed = (pol.components || []).filter(c => c.included === false);
      inductionMap[id] = {
        id, year: baseYear,
        label: pol.label || `Induction ${id}`,
        total_marks: total,
        included_cnt: included.length,
        removed_cnt: removed.length,
        hasRemoved: removed.some(c => c.max_marks > 0),
        top_included: included.slice(0, 4).map(c => ({ key: c.key, label: c.label, max: c.max_marks })),
        top_removed: removed.filter(c => c.max_marks > 0).slice(0, 3).map(c => ({ key: c.key, label: c.label, max: c.max_marks })),
        tidbits: pol.tidbits || [],
      };
    }
  }

  const sortedIds = Object.keys(inductionMap).map(Number).sort((a, b) => a - b);
  const activePolKey = sp.active_policy || '';
  const activeInduction = (sp.policies?.[activePolKey]?.induction) || '';

  let html = '';
  for (const id of sortedIds) {
    const info = inductionMap[id];
    const isActive = String(activeInduction).includes(String(id))
      || (typeof activeInduction === 'number' && activeInduction === id);

    // Count flat_lookup records for this induction
    const recCount = flat.filter(r => {
      const ym = r.yearly_merit || {};
      return Object.keys(ym).some(y => Number(y) === id);
    }).length;

    html += `
    <div class="induction-summary-card">
      <div class="is-header">
        <span class="is-id">${info.year} (Ind ${id})</span>
        <span class="is-badge ${isActive ? 'active-pol' : 'old-pol'}">${isActive ? 'Active' : info.year}</span>
      </div>
      <div class="is-total">${info.total_marks}</div>
      <div class="is-total-label">Total Max Marks ${isActive ? '&middot; Current Formula' : ''}</div>
      <div class="is-components">
        <div class="is-component included">${info.included_cnt} components included</div>
        ${info.hasRemoved ? `<div class="is-component removed">${info.removed_cnt} components removed</div>` : ''}
        <div class="is-component" style="margin-top:6px">${recCount} tracked entries</div>
      </div>
    </div>`;
  }

  grid.innerHTML = html;
}
