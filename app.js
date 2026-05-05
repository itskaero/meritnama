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
  { id: 'low',  label: 'Low',       emoji: '📋', min: -Infinity, max: 40, cls: 'band-low',  desc: 'Below average for most competitive options, but many specialties are still available.' },
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
    activeTab: 'merit',
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
  localStorage.setItem('mn_last_tab', tab);
  onTabActivated(tab);
  btn.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
}

function setupTabNavigation() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchToTab(btn.dataset.tab));
  });
  const urlTab  = new URLSearchParams(window.location.search).get('tab');
  const lastTab = localStorage.getItem('mn_last_tab');
  if (urlTab)       switchToTab(urlTab);
  else if (lastTab) switchToTab(lastTab);
}

function onTabActivated(tab) {
  if (tab === 'merit')   renderMeritTable();
  if (tab === 'current') renderCurrentMerit();
  if (tab === 'policy')  renderPolicyTab();
}

// ═══════════════════════════════════════════════════════
// MERIT TABLE
// ═══════════════════════════════════════════════════════

function setupMeritTable() {
  const mtProgram = document.getElementById('mtProgram');
  const mtQuota   = document.getElementById('mtQuota');

  mtProgram.addEventListener('change', () => {
    populateSelect(mtQuota, getQuotas(mtProgram.value));
    renderMeritTable();
  });
  mtQuota.addEventListener('change', renderMeritTable);
  document.getElementById('mtSpecSearch').addEventListener('input', renderMeritTable);
  document.getElementById('mtHospSearch').addEventListener('input', renderMeritTable);

  document.querySelectorAll('.mt-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      MT.displayMode = btn.dataset.view;
      document.querySelectorAll('.mt-toggle-btn').forEach(b => b.classList.toggle('active', b === btn));
      renderMeritTable();
    });
  });

  document.getElementById('mtSidebarClose').addEventListener('click', closeMeritSidebar);
}

function renderMeritTable() {
  const prog  = document.getElementById('mtProgram').value;
  const quota = document.getElementById('mtQuota').value;
  const spec  = document.getElementById('mtSpecSearch').value.toLowerCase().trim();
  const hosp  = document.getElementById('mtHospSearch').value.toLowerCase().trim();

  let rows = App.data.flatLookup.filter(r =>
    (!prog  || r.program  === prog)  &&
    (!quota || r.quota    === quota) &&
    (!spec  || r.specialty.toLowerCase().includes(spec)) &&
    (!hosp  || r.hospital.toLowerCase().includes(hosp))
  );

  if (MT.sortKey) {
    rows = [...rows].sort((a, b) => {
      let av = a[MT.sortKey], bv = b[MT.sortKey];
      if (typeof av === 'string') return av.localeCompare(bv) * MT.sortDir;
      return ((av ?? -Infinity) - (bv ?? -Infinity)) * MT.sortDir;
    });
  }

  MT.filteredRows = rows;
  document.getElementById('mtCount').textContent = `${rows.length.toLocaleString()} records`;

  // Determine years to show (last 5)
  const allYears = getYears();
  const years    = allYears.slice(-5);

  // Build header
  const thead = document.getElementById('mtHead');
  thead.innerHTML = `<tr>
    ${thSort('specialty',  'Specialty')}
    ${thSort('hospital',   'Hospital')}
    <th>Prog</th>
    <th>Quota</th>
    ${years.map(y => `<th class="mt-yr-col">${y}</th>`).join('')}
    ${thSort('trend',      'Trend')}
    ${thSort('confidence', 'Conf')}
  </tr>`;

  thead.querySelectorAll('th[data-sort]').forEach(th => {
    th.style.cursor = 'pointer';
    th.addEventListener('click', () => {
      const k = th.dataset.sort;
      if (MT.sortKey === k) MT.sortDir *= -1;
      else { MT.sortKey = k; MT.sortDir = 1; }
      renderMeritTable();
    });
  });

  // Build body (cap 400 for performance)
  const visible = rows.slice(0, 400);
  const isPct   = MT.displayMode === 'pct';
  const tbody   = document.getElementById('mtBody');

  tbody.innerHTML = visible.map((r, i) => {
    const yearCells = years.map(y => {
      const val = isPct ? r.yearly_pct_of_max?.[String(y)] : r.yearly_merit?.[String(y)];
      if (val == null) return '<td class="mt-yr-cell mt-no-data">—</td>';
      const pct  = r.yearly_pct_of_max?.[String(y)];
      const cls  = pct != null ? meritCellClass(pct) : '';
      const disp = isPct ? num(val, 1) + '%' : num(val, 1);
      return `<td class="mt-yr-cell ${cls}">${disp}</td>`;
    }).join('');

    const sel = MT.selectedIdx === i;
    return `<tr class="mt-row${sel ? ' mt-row-selected' : ''}" data-idx="${i}">
      <td class="mt-cell-spec">${esc(r.specialty)}</td>
      <td class="mt-cell-hosp">${esc(r.hospital)}</td>
      <td class="mt-cell-sm">${esc(r.program)}</td>
      <td class="mt-cell-sm">${esc(r.quota)}</td>
      ${yearCells}
      <td>${trendBadge(r.trend)}</td>
      <td>${confBadge(r.confidence)}</td>
    </tr>`;
  }).join('');

  if (rows.length > 400) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="${4 + years.length + 2}" class="mt-overflow-note">
      Showing 400 of ${rows.length} — use filters to narrow down
    </td>`;
    tbody.appendChild(tr);
  }

  // Row click → sidebar
  tbody.querySelectorAll('.mt-row').forEach(tr => {
    tr.addEventListener('click', () => {
      const idx = parseInt(tr.dataset.idx);
      if (MT.selectedIdx === idx) {
        closeMeritSidebar();
      } else {
        MT.selectedIdx = idx;
        tbody.querySelectorAll('.mt-row').forEach(r => r.classList.remove('mt-row-selected'));
        tr.classList.add('mt-row-selected');
        openMeritSidebar(MT.filteredRows[idx]);
      }
    });
  });
}

function thSort(key, label) {
  const active = MT.sortKey === key;
  const arrow  = active ? (MT.sortDir > 0 ? ' ↑' : ' ↓') : '';
  return `<th data-sort="${key}" class="mt-th-sort${active ? ' active' : ''}">${label}${arrow}</th>`;
}

function meritCellClass(pct) {
  if (pct >= 75) return 'mt-merit-high';
  if (pct >= 55) return 'mt-merit-mid';
  if (pct >= 35) return 'mt-merit-low';
  return 'mt-merit-vlow';
}

// ── Sidebar ──

function openMeritSidebar(row) {
  const sidebar = document.getElementById('mtSidebar');
  const layout  = document.getElementById('mtLayout');
  sidebar.classList.remove('hidden');
  layout.classList.add('sidebar-open');

  const years = Object.keys(row.yearly_merit || {}).sort();
  const latY  = years[years.length - 1];

  // Stats row
  const statsHtml = `
    <div class="sidebar-stats">
      <div class="sidebar-stat">
        <span class="sidebar-stat-val">${row.avg_pct_of_max != null ? num(row.avg_pct_of_max, 1) + '%' : num(row.avg_closing_merit)}</span>
        <span class="sidebar-stat-lbl">Avg (% max)</span>
      </div>
      <div class="sidebar-stat">
        <span class="sidebar-stat-val">${row.latest_pct_of_max != null ? num(row.latest_pct_of_max, 1) + '%' : num(row.latest_merit)}</span>
        <span class="sidebar-stat-lbl">Latest (${latY})</span>
      </div>
      <div class="sidebar-stat">
        <span class="sidebar-stat-val">${row.data_points ?? years.length}</span>
        <span class="sidebar-stat-lbl">Years data</span>
      </div>
      <div class="sidebar-stat">
        <span class="sidebar-stat-val">${volBadge(row.volatility)}</span>
        <span class="sidebar-stat-lbl">Volatility</span>
      </div>
    </div>`;

  // Year-by-year history table
  const yearRows = years.map(y => {
    const raw    = row.yearly_merit[y];
    const pct    = row.yearly_pct_of_max?.[y];
    const pctile = row.yearly_percentile?.[y];
    const seats  = row.yearly_seats?.[y];
    const max    = YEAR_TOTAL_MAX[Number(y)];
    const rowCls = pct != null ? meritCellClass(pct) : '';
    return `<tr>
      <td>${y}</td>
      <td class="${rowCls}"><strong>${raw != null ? num(raw, 2) : '—'}</strong>${max ? `<small class="yr-max"> / ${max}</small>` : ''}</td>
      <td class="${rowCls}">${pct != null ? num(pct, 1) + '%' : '—'}</td>
      <td>${pctile != null ? pctile + 'th' : '—'}</td>
      <td>${seats ?? '—'}</td>
    </tr>`;
  }).join('');

  // Policy note for this record's latest year
  // Check "YYYY-1" first (e.g. "2026-1" = Induction 20 which produced the actual data),
  // before falling back to "YYYY" which may point to a future induction.
  const sp = App.data.scoringPolicy;
  let polNote = '';
  if (sp?.policies) {
    const pol = sp.policies[`${latY}-1`] || sp.policies[latY] || sp.policies[String(latY)];
    if (pol) polNote = `<div class="sidebar-pol-note">Policy: ${esc(pol.label || latY)} &middot; ${pol.total_marks} marks max</div>`;
  }

  document.getElementById('mtSidebarContent').innerHTML = `
    <div class="sidebar-header">
      <h3>${esc(row.specialty)}</h3>
      <p class="sidebar-hosp">${esc(row.hospital)}</p>
      <p class="sidebar-meta">${esc(row.program)} &middot; ${esc(row.quota)} &middot; ${confBadge(row.confidence)} confidence</p>
    </div>
    ${statsHtml}
    <div class="sidebar-trend-label">Year-by-year closing merit (chart below)</div>
    ${polNote}
    <div class="sidebar-year-table">
      <table class="data-table">
        <thead>
          <tr><th>Year</th><th>Closing Merit</th><th>% of Max</th><th>Percentile</th><th>Seats</th></tr>
        </thead>
        <tbody>${yearRows}</tbody>
      </table>
    </div>
  `;

  // Draw chart
  Charts.drawSidebarTrendChart('mtSidebarChart', row);

  // Scroll sidebar into view on mobile
  sidebar.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeMeritSidebar() {
  document.getElementById('mtSidebar').classList.add('hidden');
  document.getElementById('mtLayout').classList.remove('sidebar-open');
  MT.selectedIdx = null;
  document.querySelectorAll('.mt-row-selected').forEach(r => r.classList.remove('mt-row-selected'));
}

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
  if (isNaN(merit)) { alert('Please enter a valid merit score.'); return; }

  const policyMax = getActivePolicyMax();
  if (!policyMax) { alert('Policy data not loaded.'); return; }

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
    const el = document.getElementById(`calc_${ck}`);
    if (!el) continue;
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
// CURRENT MERIT TAB
// ═══════════════════════════════════════════════════════

let _currentRecords = [];

function renderCurrentMerit() {
  const data = App.data.currentMerit;

  // Meta card
  const metaEl = document.getElementById('currentMeta');
  if (data?.meta) {
    metaEl.classList.remove('hidden');
    metaEl.innerHTML = `
      <div class="cur-meta-grid">
        <div><span class="cur-meta-lbl">Induction</span><span class="cur-meta-val">${esc(String(data.meta.induction || '—'))}</span></div>
        <div><span class="cur-meta-lbl">Status</span><span class="cur-meta-val cur-meta-status">${esc(data.meta.status || '—')}</span></div>
        <div><span class="cur-meta-lbl">Last Updated</span><span class="cur-meta-val">${esc(data.meta.last_updated || '—')}</span></div>
        <div><span class="cur-meta-lbl">Source</span><span class="cur-meta-val">${esc(data.meta.source || 'PHF Official')}</span></div>
      </div>
      ${data.meta.note ? `<p class="cur-meta-note">${esc(data.meta.note)}</p>` : ''}
    `;
  } else {
    metaEl.classList.add('hidden');
  }

  // Determine records
  let records = [];
  if (data?.records?.length) {
    records = data.records;
  } else {
    // Fall back: derive from flat_lookup latest year
    const latY = getLatestYear();
    records = App.data.flatLookup
      .filter(r => r.yearly_merit?.[String(latY)] != null)
      .map(r => ({
        program:        r.program,
        quota:          r.quota,
        specialty:      r.specialty,
        hospital:       r.hospital,
        round:          1,
        opening_merit:  null,
        closing_merit:  r.yearly_merit[String(latY)],
        seats:          r.yearly_seats?.[String(latY)] ?? null,
        _prev_closing:  r.yearly_merit?.[String(latY - 1)] ?? null,
        _latest_pct:    r.yearly_pct_of_max?.[String(latY)] ?? null,
        _prev_pct:      r.yearly_pct_of_max?.[String(latY - 1)] ?? null,
      }));
    if (metaEl) {
      metaEl.classList.remove('hidden');
      metaEl.innerHTML = `<div class="cur-meta-note">&#8505;&#65039; Showing data from latest available year (${latY}). No <code>current_merit.json</code> found with records. Add records there to show the current induction.</div>`;
    }
  }

  _currentRecords = records;

  // Populate filters
  const programs  = [...new Set(records.map(r => r.program))].filter(Boolean).sort();
  const quotas    = [...new Set(records.map(r => r.quota))].filter(Boolean).sort();
  const rounds    = [...new Set(records.map(r => String(r.round || 1)))].sort();

  populateSelect(document.getElementById('curProgram'), programs);
  populateSelect(document.getElementById('curQuota'),   quotas);
  populateSelect(document.getElementById('curRound'),   rounds, 'All Rounds');

  // Wire filters
  ['curProgram', 'curQuota', 'curRound', 'curSearch'].forEach(id => {
    document.getElementById(id)?.removeEventListener('change', applyCurrentFilters);
    document.getElementById(id)?.removeEventListener('input',  applyCurrentFilters);
    const el = document.getElementById(id);
    if (el) el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change', applyCurrentFilters);
  });

  applyCurrentFilters();
}

function applyCurrentFilters() {
  const prog   = document.getElementById('curProgram')?.value || '';
  const quota  = document.getElementById('curQuota')?.value   || '';
  const round  = document.getElementById('curRound')?.value   || '';
  const search = (document.getElementById('curSearch')?.value || '').toLowerCase().trim();

  const filtered = _currentRecords.filter(r =>
    (!prog   || r.program  === prog)  &&
    (!quota  || r.quota    === quota) &&
    (!round  || String(r.round || 1) === round) &&
    (!search || (r.specialty?.toLowerCase().includes(search) || r.hospital?.toLowerCase().includes(search)))
  );

  const tbody = document.getElementById('currentTableBody');
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="cur-loading-cell">No records match your filters.</td></tr>';
    document.getElementById('currentCaption').textContent = '';
    return;
  }

  tbody.innerHTML = filtered.map(r => {
    const closing = r.closing_merit != null ? num(r.closing_merit, 2) : '—';
    const opening = r.opening_merit != null ? num(r.opening_merit, 2) : '—';

    // vs last year delta
    let delta = '', deltaCls = '';
    if (r.closing_merit != null && r._prev_closing != null) {
      const d    = r.closing_merit - r._prev_closing;
      delta      = (d >= 0 ? '+' : '') + num(d, 2);
      deltaCls   = d > 0.5 ? 'delta-up' : d < -0.5 ? 'delta-down' : 'delta-flat';
    } else if (r._latest_pct != null && r._prev_pct != null) {
      const d    = r._latest_pct - r._prev_pct;
      delta      = (d >= 0 ? '+' : '') + num(d, 1) + '%';
      deltaCls   = d > 0.5 ? 'delta-up' : d < -0.5 ? 'delta-down' : 'delta-flat';
    }

    return `<tr>
      <td>${esc(r.specialty || '—')}</td>
      <td>${esc(r.hospital  || '—')}</td>
      <td>${esc(r.program   || '—')}</td>
      <td>${esc(r.quota     || '—')}</td>
      <td>${esc(String(r.round || 1))}</td>
      <td>${opening}</td>
      <td><strong>${closing}</strong></td>
      <td>${r.seats ?? '—'}</td>
      <td class="${deltaCls}">${delta || '—'}</td>
    </tr>`;
  }).join('');

  document.getElementById('currentCaption').textContent =
    `Showing ${filtered.length} of ${_currentRecords.length} records`;
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
// MISC UI
// ═══════════════════════════════════════════════════════

function updateHeaderMeta() {
  const el = document.getElementById('dataStatus');
  if (!el) return;
  const years = getYears();
  const n     = App.data.flatLookup.length;
  el.textContent = `${n.toLocaleString()} records · ${years[0]}–${years[years.length - 1]}`;
  el.className = 'badge badge-success';
}

function updateFooterStats() {
  const el = document.getElementById('footerStats');
  if (!el) return;
  const years  = getYears();
  const progs  = getPrograms();
  const specs  = getSpecialties();
  el.textContent = `${progs.join(', ')} · ${years.length} cycles · ${specs.length} specialties`;
}

function setupBackToTop() {
  const btn = document.getElementById('backToTop');
  if (!btn) return;
  window.addEventListener('scroll', () => btn.classList.toggle('visible', window.scrollY > 400), { passive: true });
  btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

function setupHamburger() {
  const btn = document.getElementById('hamburgerBtn');
  const nav = document.getElementById('mainNav');
  if (!btn || !nav) return;
  btn.addEventListener('click', () => {
    const open = nav.classList.toggle('nav-open');
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  nav.addEventListener('click', e => {
    if (e.target.classList.contains('tab-btn')) {
      nav.classList.remove('nav-open');
      btn.setAttribute('aria-expanded', 'false');
    }
  });
}

function setupKeyboardShortcuts() {
  const TABS = ['merit', 'predictor', 'calculator', 'current', 'policy', 'guide'];
  document.addEventListener('keydown', e => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= TABS.length) { e.preventDefault(); switchToTab(TABS[n - 1]); }
    if (e.key === 'Escape') closeMeritSidebar();
  });
}

// Simple tooltip system
const TOOLTIPS = {
  closing:  { title: 'Closing Merit (Cutoff)', body: 'The lowest score that got a seat in this specialty/hospital in the given year. If your score ≥ this, you would have qualified.' },
  opening:  { title: 'Opening Merit',          body: 'The highest score admitted — i.e., the first candidate selected.' },
  pctofmax: { title: '% of Max',               body: 'Closing merit expressed as a % of the maximum possible marks for that year. Allows fair cross-year comparison even when the formula changed.' },
};

function initTooltips() {
  const el = document.getElementById('tooltipEl');
  if (!el) return;
  document.body.addEventListener('mouseover', e => {
    const btn = e.target.closest('[data-tip]');
    if (!btn) return;
    const tip = TOOLTIPS[btn.dataset.tip];
    if (!tip) return;
    el.querySelector('.tooltip-title').textContent = tip.title;
    el.querySelector('.tooltip-body').textContent  = tip.body;
    const ex = el.querySelector('.tooltip-example');
    ex.textContent = tip.example || '';
    ex.style.display = tip.example ? '' : 'none';
    el.classList.remove('hidden');
    const r = btn.getBoundingClientRect();
    const tw = el.offsetWidth  || 270;
    const th = el.offsetHeight || 80;
    let left = r.left + r.width / 2 - tw / 2;
    let top  = r.top - th - 10;
    left = Math.max(8, Math.min(left, window.innerWidth  - tw - 8));
    top  = top < 8 ? r.bottom + 8 : top;
    el.style.left = left + 'px';
    el.style.top  = top  + 'px';
  });
  document.body.addEventListener('mouseout', e => {
    if (!e.target.closest('[data-tip]')) return;
    el.classList.add('hidden');
  });
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

function onDataReady() {
  computeMeritPercentOfMax();
  computeYearlyPercentiles();
  populateAllFilters();
  setupTabNavigation();
  setupMeritTable();
  setupPredictorTab();
  setupCalculatorTab();
  setupBackToTop();
  setupHamburger();
  setupKeyboardShortcuts();
  initTooltips();
  updateHeaderMeta();
  updateFooterStats();
  handleURLParams();
  renderMeritTable();
}

document.addEventListener('DOMContentLoaded', loadAllData);
