'use strict';

// ═══════════════════════════════════════════════════════
// CONSTANTS & UTILITIES
// ═══════════════════════════════════════════════════════

const DATA_BASE = 'data/';
const RECENT_KEY = 'mn_recent_scores';
const MAX_RECENT = 5;

const LOADING_TIPS = [
  'Closing merits can shift significantly year to year: check the trend column!',
  'Use My Prediction to see your personalised safe, target and reach list.',
  '% of Max values are normalised to support fair cross-year comparison even when the formula changed.',
  'Keep Current Merit updated from the official PHF list for the latest data.',
  'Click any row in the Merit Table to see a full year-by-year breakdown.',
];

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
  { arabic: 'أَلَمْ نَشْرَحْ لَكَ صَدْرَكَ', translation: 'Did We not expand for you your chest — and relieve you of your burden?', ref: 'Surah Al-Inshirah 94:1' },
];

const MERIT_BANDS = [
  { id: 'top',  label: 'Top Tier',  min: 80,  max: Infinity, cls: 'badge-success',  desc: 'Exceptional score — almost every specialty is within reach.' },
  { id: 'high', label: 'High',      min: 60,  max: 80,       cls: 'badge-info', desc: 'Strong score. Many competitive specialties are accessible.' },
  { id: 'mid',  label: 'Mid Range', min: 40,  max: 60,       cls: 'badge-warning',  desc: 'Average range. Plenty of good options — focus on moderate-demand specialties.' },
  { id: 'low',  label: 'Low',       min: -Infinity, max: 40, cls: 'badge-danger',  desc: 'Below average for most competitive options, but many specialties are still available.' },
];

const YEAR_TOTAL_MAX = {};
const App = {
  data: {
    flatLookup: null,
    scoringPolicy: null,
    currentMerit: null,
  },
  ui: {
    predResults: [],
    yearMeritCache: null,
  }
};

const MT = {
  displayMode: 'pct',
  selectedIdx: null,
  filteredRows: [],
  sortKey: null,
  sortDir: 1,
};

// ═══════════════════════════════════════════════════════
// FORMAT & ESCAPE HELPERS
// ═══════════════════════════════════════════════════════

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function num(v, d = 2) { 
  return (v == null || isNaN(v)) ? '—' : Number(v).toFixed(d); 
}

function populateSelect(sel, options, defaultLabel = 'All') {
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = `<option value="">${defaultLabel}</option>` +
    options.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
  if (options.includes(cur)) sel.value = cur;
}

function trendBadge(t) {
  if (t === 'rising') return `<span class="trend-rising"><i class="ph ph-trend-up"></i> Rising</span>`;
  if (t === 'falling') return `<span class="trend-falling"><i class="ph ph-trend-down"></i> Falling</span>`;
  return `<span class="trend-stable"><i class="ph ph-arrows-left-right"></i> Stable</span>`;
}

function volBadge(v) {
  const label = v ? (v.charAt(0).toUpperCase() + v.slice(1)) : '—';
  return `<span class="badge badge-${v === 'high' ? 'danger' : v === 'medium' ? 'warning' : 'success'}">${label}</span>`;
}

function confBadge(c) {
  const label = c ? (c.charAt(0).toUpperCase() + c.slice(1)) : '—';
  return `<span class="badge badge-${c === 'high' ? 'success' : c === 'medium' ? 'info' : 'warning'}">${label}</span>`;
}

function meritCellClass(pct) {
  if (pct >= 75) return 'text-success bg-success-soft';
  if (pct >= 55) return 'text-info bg-info-soft';
  if (pct >= 35) return 'text-warning bg-warning-soft';
  return 'text-danger bg-danger-soft';
}

function formatYearShort(y) {
  return `Induction ${y}`;
}

function formatInductionLabel(y) {
  return `Induction ${y}`;
}

function getInductionYearMap() {
  const map = {};
  if (App.data.scoringPolicy?.year_to_induction) {
    for (const [yr, ind] of Object.entries(App.data.scoringPolicy.year_to_induction)) {
      map[Number(ind)] = Number(yr);
    }
  }
  return map;
}

// ═══════════════════════════════════════════════════════
// DATA ACCESSORS
// ═══════════════════════════════════════════════════════

function getPrograms() {
  return [...new Set(App.data.flatLookup.map(r => r.program))].sort();
}

function getQuotas(prog = '') {
  return [...new Set(App.data.flatLookup.filter(r => !prog || r.program === prog).map(r => r.quota))].sort();
}

function getSpecialties(prog = '', q = '') {
  return [...new Set(App.data.flatLookup.filter(r => (!prog || r.program === prog) && (!q || r.quota === q)).map(r => r.specialty))].sort();
}

function getYears() {
  const all = new Set();
  for (const r of App.data.flatLookup) {
    Object.keys(r.yearly_merit || {}).forEach(y => all.add(Number(y)));
  }
  return [...all].sort((a, b) => a - b);
}

function getLatestYear() {
  const y = getYears();
  return y[y.length - 1];
}

// ═══════════════════════════════════════════════════════
// DATA LOADERS & COMPUTATIONS
// ═══════════════════════════════════════════════════════

async function fetchJSON(file, label) {
  const loaderDetail = document.getElementById('loadingDetail');
  if (loaderDetail) loaderDetail.textContent = `Loading ${label}…`;
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
    setTimeout(() => {
      el.textContent = LOADING_TIPS[idx++ % LOADING_TIPS.length];
      el.classList.add('visible');
    }, 400);
  }
  show();
  _tipTimer = setInterval(show, 3200);
}

function stopLoadingTips() {
  if (_tipTimer) {
    clearInterval(_tipTimer);
    _tipTimer = null;
  }
}

function hideLoading() {
  const overlay = document.getElementById('loadingOverlay');
  if (overlay) {
    overlay.classList.add('hidden');
  }
}

function showDailyVerse() {
  const container = document.getElementById('mainContent');
  if (!container) return;

  // Insert verse banner dynamically at the top of mainContent if in-app
  let verseEl = document.getElementById('dailyVerse');
  if (!verseEl) {
    verseEl = document.createElement('div');
    verseEl.id = 'dailyVerse';
    verseEl.className = 'daily-verse';
    container.prepend(verseEl);
  }

  const v = VERSES[Math.floor(Math.random() * VERSES.length)];
  verseEl.innerHTML = `
    <span class="dv-arabic">${v.arabic}</span>
    <span class="dv-translation">“${v.translation}”</span>
    <span class="dv-ref">${v.ref}</span>
  `;
}

function computeMeritPercentOfMax() {
  const sp = App.data.scoringPolicy;
  if (sp?.year_total_max) {
    for (const [yr, max] of Object.entries(sp.year_total_max)) {
      YEAR_TOTAL_MAX[Number(yr)] = max;
    }
  } else if (sp?.policies) {
    for (const [yr, pol] of Object.entries(sp.policies)) {
      if (pol.total_marks) YEAR_TOTAL_MAX[Number(yr)] = pol.total_marks;
    }
  }

  const inductionMax = {};
  if (sp?._induction_max) {
    for (const [ind, max] of Object.entries(sp._induction_max)) {
      inductionMax[Number(ind)] = max;
    }
  }

  for (const row of App.data.flatLookup) {
    const pom = {};
    for (const [year, merit] of Object.entries(row.yearly_merit || {})) {
      const indNum = row.yearly_induction?.[year];
      const max = (indNum && inductionMax[indNum]) ? inductionMax[indNum] : YEAR_TOTAL_MAX[Number(year)];
      if (max) pom[year] = (merit / max) * 100;
    }
    row.yearly_pct_of_max = Object.keys(pom).length ? pom : (row.yearly_pct_of_max || {});
    const vals = Object.values(row.yearly_pct_of_max);
    row.latest_pct_of_max = row.yearly_pct_of_max[String(row.latest_year)] ?? (vals[vals.length - 1] ?? null);
    row.avg_pct_of_max = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
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
      if (all.length) {
        yp[year] = Math.round(all.filter(v => v < merit).length / all.length * 100);
      }
    }
    row.yearly_percentile = yp;
  }
}

function getActivePolicyForCalc() {
  const sp = App.data.scoringPolicy;
  if (!sp) return null;
  if (sp.policies) {
    const key = sp.expected_policy || sp.active_policy;
    if (key && sp.policies[key]) return { key, policy: sp.policies[key], isExpected: key === sp.expected_policy };
    const keys = Object.keys(sp.policies).sort();
    const last = keys[keys.length - 1];
    return { key: last, policy: sp.policies[last], isExpected: false };
  }
  const years = Object.keys(sp).filter(k => !isNaN(k)).sort();
  const last = years[years.length - 1];
  return { key: last, policy: sp[last], isExpected: false };
}

function getActivePolicyMax() {
  const active = getActivePolicyForCalc();
  if (active?.policy?.total_marks) return active.policy.total_marks;
  const keys = Object.keys(YEAR_TOTAL_MAX).map(Number).sort();
  return keys.length ? YEAR_TOTAL_MAX[keys[keys.length - 1]] : null;
}

function getPercentile(val, allVals) {
  if (!allVals || !allVals.length) return 0;
  return Math.round(allVals.filter(v => v < val).length / allVals.length * 100);
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

function getRecentScores() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; }
}

function saveRecentScore(s) {
  let arr = getRecentScores().filter(v => v !== s);
  arr.unshift(s);
  localStorage.setItem(RECENT_KEY, JSON.stringify(arr.slice(0, MAX_RECENT)));
}

function getSavedCalcMerit() {
  try {
    const raw = localStorage.getItem('mn_saved_calc');
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function saveCalcMerit(res) {
  localStorage.setItem('mn_saved_calc', JSON.stringify(res));
}

function clearCalcMerit() {
  localStorage.removeItem('mn_saved_calc');
}

// ═══════════════════════════════════════════════════════
// ROUTE REGISTRATION & INITIALIZATION
// ═══════════════════════════════════════════════════════

async function init() {
  // Bind sidebar toggle for mobile
  const sidebarToggle = document.getElementById('sidebarToggle');
  const sidebar = document.getElementById('sidebar');
  if (sidebarToggle && sidebar) {
    sidebarToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      sidebar.classList.toggle('open');
    });
    document.addEventListener('click', (e) => {
      if (!sidebar.contains(e.target) && !sidebarToggle.contains(e.target)) {
        sidebar.classList.remove('open');
      }
    });
  }

  // Bind dark/light mode toggle
  const themeToggle = document.getElementById('themeToggle');
  const themeIcon = document.getElementById('themeToggleIcon');
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      const nextTheme = isDark ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', nextTheme);
      localStorage.setItem('mn_theme', nextTheme);
      if (themeIcon) {
        themeIcon.className = nextTheme === 'dark' ? 'ph ph-sun' : 'ph ph-moon';
      }
      // Re-render chart if detail sidebar is open
      if (MT.selectedIdx !== null && MT.filteredRows[MT.selectedIdx]) {
        Charts.drawSidebarTrendChart('mtSidebarChart', MT.filteredRows[MT.selectedIdx]);
      }
    });
  }

  // Load theme preference
  const savedTheme = localStorage.getItem('mn_theme') || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  document.documentElement.setAttribute('data-theme', savedTheme);
  if (themeIcon) {
    themeIcon.className = savedTheme === 'dark' ? 'ph ph-sun' : 'ph ph-moon';
  }

  // Register views with Router
  Router.register('#/', {
    title: 'Punjab Residency Induction Analytics | MeritNama',
    render: () => {
      // Landing page is static HTML in index.html, visibility toggled in router.js handleRouting()
    }
  });
  Router.register('#/analytics/merit-table', {
    title: 'Merit Table | MeritNama',
    render: (c) => renderMeritTable(c)
  });
  Router.register('#/analytics/prediction', {
    title: 'My Prediction | MeritNama',
    render: (c) => renderPrediction(c)
  });
  Router.register('#/analytics/what-do-i-need', {
    title: 'What Do I Need | MeritNama',
    render: (c) => renderWhatDoINeed(c)
  });
  Router.register('#/analytics/calculator', {
    title: 'Merit Calculator | MeritNama',
    render: (c) => renderCalculator(c)
  });
  Router.register('#/analytics/compare', {
    title: 'Compare Specialties | MeritNama',
    render: (c) => renderCompare(c)
  });
  Router.register('#/analytics/merit-lists', {
    title: 'Previous Merit Lists | MeritNama',
    render: (c) => renderMeritLists(c)
  });
  Router.register('#/analytics/jobs', {
    title: 'Job Openings | MeritNama',
    render: (c) => renderJobs(c)
  });
  Router.register('#/analytics/policy', {
    title: 'Scoring Policy History | MeritNama',
    render: (c) => renderPolicy(c)
  });
  Router.register('#/analytics/guide', {
    title: 'How to Use | MeritNama',
    render: (c) => renderGuide(c)
  });
  Router.register('#/analytics/accreditation', {
    title: 'Accreditation Directory | MeritNama',
    render: (c) => renderAccreditation(c)
  });

  Router.register('#/simulation', {
    title: 'Induction Portal Simulator | MeritNama',
    render: (c) => renderSimulation(c)
  });
  Router.register('#/profile', {
    title: 'My Profile | MeritNama',
    render: (c) => renderProfile(c)
  });
  Router.register('#/hospitals', {
    title: 'Hospitals Directory | MeritNama',
    render: (c) => renderHospitals(c)
  });
  Router.register('#/hospital', {
    title: 'Hospital Profile | MeritNama',
    render: (c) => renderHospitalDetail(c)
  });

  Router.register('#/reviews', {
    title: 'Discussion Forums | MeritNama',
    render: (c) => renderDiscussion(c)
  });
  Router.register('#/admin', {
    title: 'Admin Console | MeritNama',
    render: (c) => renderAdmin(c)
  });
  Router.register('#/donate', {
    title: 'Support voluntary contribution | MeritNama',
    render: (c) => renderDonate(c)
  });
  Router.register('#/changes', {
    title: 'Gazette Updates Change Logs | MeritNama',
    render: (c) => renderChangesLog(c)
  });
  Router.register('#/share', {
    title: 'Diagnostic Share Card | MeritNama',
    render: (c) => renderAnimationSandbox(c)
  });
  Router.register('#/request-access', {
    title: 'Request credentials verification | MeritNama',
    render: (c) => renderRequestAccess(c)
  });

  // Load JSON resources
  try {
    startLoadingTips();
    setLoadingProgress(10);
    const flatLookup = await fetchJSON('flat_lookup.json', 'merit data');
    setLoadingProgress(55);
    const scoringPolicy = await fetchJSON('scoring_policy.json', 'scoring policy');
    setLoadingProgress(90);
    let currentMerit = null;
    try { currentMerit = await fetchJSON('current_merit.json', 'current merit'); } catch (_) {}
    setLoadingProgress(100);

    App.data.flatLookup = flatLookup;
    App.data.scoringPolicy = scoringPolicy;
    App.data.currentMerit = currentMerit;

    computeMeritPercentOfMax();
    computeYearlyPercentiles();

    setTimeout(() => {
      stopLoadingTips();
      hideLoading();
      Router.init(); // Boot the SPA router after data resolves
    }, 400);

  } catch (err) {
    stopLoadingTips();
    console.error('Initialisation Failure:', err);
    setLoadingProgress(0);
    const detail = document.getElementById('loadingDetail');
    if (detail) detail.innerHTML = `<span style="color:var(--color-reach);">⚠️ Data Loading Error. Verify data files exist in data/</span>`;
  }
}

// ═══════════════════════════════════════════════════════
// VIEW 1: MERIT TABLE
// ═══════════════════════════════════════════════════════

function renderMeritTable(container) {
  if (!container) return;

  container.innerHTML = `
    <div class="section-header">
      <h2>Merit Table</h2>
      <p>Browse historical closing merits by specialty, hospital, program, and quota.</p>
    </div>

    <div class="mt-toolbar">
      <div class="mt-filters">
        <select id="mtProgram" class="select mt-filter-sel"><option value="">All Programs</option></select>
        <select id="mtQuota" class="select mt-filter-sel"><option value="">All Quotas</option></select>
        <select id="mtInduction" class="select mt-filter-sel"></select>
        <input type="text" id="mtSpecSearch" placeholder="Search specialty…" class="input mt-filter-input">
        <input type="text" id="mtHospSearch" placeholder="Search hospital…" class="input mt-filter-input">
      </div>
      <div class="mt-display-toggle">
        <button class="mt-toggle-btn active" data-view="pct">% of Max</button>
        <button class="mt-toggle-btn" data-view="raw">Raw</button>
      </div>
      <span class="mt-count" id="mtCount">…</span>
    </div>

    <div class="mt-layout" id="mtLayout">
      <div class="mt-main">
        <div class="table-wrap">
          <table class="data-table" id="mtTable">
            <thead id="mtHead"></thead>
            <tbody id="mtBody">
              <tr><td colspan="10" style="text-align:center;padding:40px;color:var(--text-muted)">Loading…</td></tr>
            </tbody>
          </table>
        </div>
      </div>
      
      <aside class="mt-sidebar hidden" id="mtSidebar">
        <div class="mt-sidebar-inner">
          <button class="mt-sidebar-close" id="mtSidebarClose" title="Close"><i class="ph ph-x"></i></button>
          <div id="mtSidebarContent"></div>
          <div class="mt-sidebar-chart-wrap" style="height: 200px; margin-top: var(--spacing-md);">
            <canvas id="mtSidebarChart"></canvas>
          </div>
        </div>
      </aside>
    </div>
  `;

  // Bind elements
  const mtProgram = document.getElementById('mtProgram');
  const mtQuota = document.getElementById('mtQuota');
  const mtInduction = document.getElementById('mtInduction');
  const specSearch = document.getElementById('mtSpecSearch');
  const hospSearch = document.getElementById('mtHospSearch');
  const closeBtn = document.getElementById('mtSidebarClose');

  // Populate selectors
  populateSelect(mtProgram, getPrograms());
  populateSelect(mtQuota, getQuotas());

  // Populate induction filter
  const allYears = getYears();
  const first = formatYearShort(allYears[0]), last = formatYearShort(allYears[allYears.length - 1]);
  if (mtInduction) {
    mtInduction.innerHTML = `
      <option value="all">All Cycles (${first}–${last})</option>
      <option value="last1">${formatYearShort(allYears[allYears.length - 1])} (Last 1)</option>
      <option value="last3">${formatYearShort(allYears[allYears.length - 3])}–${last} (Last 3)</option>
      <option value="last5" selected>${formatYearShort(allYears[allYears.length - 5])}–${last} (Last 5)</option>
      <option value="last10">${formatYearShort(allYears[Math.max(0, allYears.length - 10)])}–${last} (Last 10)</option>
    `;
  }

  // Wire events
  mtProgram.addEventListener('change', () => {
    populateSelect(mtQuota, getQuotas(mtProgram.value));
    updateMeritTableData();
  });
  mtQuota.addEventListener('change', updateMeritTableData);
  if (mtInduction) mtInduction.addEventListener('change', updateMeritTableData);
  specSearch.addEventListener('input', updateMeritTableData);
  hospSearch.addEventListener('input', updateMeritTableData);

  document.querySelectorAll('.mt-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      MT.displayMode = btn.dataset.view;
      document.querySelectorAll('.mt-toggle-btn').forEach(b => b.classList.toggle('active', b === btn));
      updateMeritTableData();
    });
  });

  if (closeBtn) {
    closeBtn.addEventListener('click', closeMeritSidebar);
  }

  showDailyVerse();
  updateMeritTableData();
}

function updateMeritTableData() {
  const mtProgram = document.getElementById('mtProgram');
  const mtQuota = document.getElementById('mtQuota');
  const mtInduction = document.getElementById('mtInduction');
  const specSearch = document.getElementById('mtSpecSearch');
  const hospSearch = document.getElementById('mtHospSearch');

  if (!mtProgram || !mtQuota || !specSearch || !hospSearch) return;

  const prog = mtProgram.value;
  const quota = mtQuota.value;
  const spec = specSearch.value.toLowerCase().trim();
  const hosp = hospSearch.value.toLowerCase().trim();
  const indFilter = mtInduction ? mtInduction.value : 'last5';

  let rows = App.data.flatLookup.filter(r =>
    (!prog || r.program === prog) &&
    (!quota || r.quota === quota) &&
    (!spec || r.specialty.toLowerCase().includes(spec)) &&
    (!hosp || r.hospital.toLowerCase().includes(hosp))
  );

  if (MT.sortKey) {
    rows = [...rows].sort((a, b) => {
      let av = a[MT.sortKey], bv = b[MT.sortKey];
      if (typeof av === 'string') return av.localeCompare(bv) * MT.sortDir;
      return ((av ?? -Infinity) - (bv ?? -Infinity)) * MT.sortDir;
    });
  }

  MT.filteredRows = rows;
  const countEl = document.getElementById('mtCount');
  if (countEl) countEl.textContent = `${rows.length.toLocaleString()} records`;

  const allYears = getYears();
  let years = allYears;
  if (indFilter === 'last1') years = allYears.slice(-1);
  else if (indFilter === 'last3') years = allYears.slice(-3);
  else if (indFilter === 'last5') years = allYears.slice(-5);
  else if (indFilter === 'last10') years = allYears.slice(-10);

  const thead = document.getElementById('mtHead');
  if (thead) {
    thead.innerHTML = `<tr>
      ${thSort('specialty', 'Specialty')}
      ${thSort('hospital', 'Hospital')}
      <th>Prog</th>
      <th>Quota</th>
      ${years.map(y => `<th class="mt-yr-col" title="${formatInductionLabel(y)}">${formatYearShort(y)}</th>`).join('')}
      ${thSort('trend', 'Trend')}
      ${thSort('confidence', 'Conf')}
    </tr>`;

    thead.querySelectorAll('th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const k = th.dataset.sort;
        if (MT.sortKey === k) MT.sortDir *= -1;
        else { MT.sortKey = k; MT.sortDir = 1; }
        updateMeritTableData();
      });
    });
  }

  const visible = rows.slice(0, 400);
  const isPct = MT.displayMode === 'pct';
  const tbody = document.getElementById('mtBody');
  if (!tbody) return;

  tbody.innerHTML = visible.map((r, i) => {
    const yearCells = years.map(y => {
      const val = isPct ? r.yearly_pct_of_max?.[String(y)] : r.yearly_merit?.[String(y)];
      if (val == null) return '<td class="mt-yr-cell mt-no-data">—</td>';
      const pct = r.yearly_pct_of_max?.[String(y)];
      const cls = pct != null ? meritCellClass(pct) : '';
      const disp = isPct ? num(val, 1) + '%' : num(val, 1);
      return `<td class="mt-yr-cell ${cls}">${disp}</td>`;
    }).join('');

    const sel = MT.selectedIdx === i;
    return `<tr class="mt-row${sel ? ' selected' : ''}" data-idx="${i}">
      <td style="font-weight:600;">${esc(r.specialty)}</td>
      <td style="font-size:13px; color:var(--text-secondary); max-width:280px; overflow:hidden; text-overflow:ellipsis;">${esc(r.hospital)}</td>
      <td>${esc(r.program)}</td>
      <td>${esc(r.quota)}</td>
      ${yearCells}
      <td>${trendBadge(r.trend)}</td>
      <td>${confBadge(r.confidence)}</td>
    </tr>`;
  }).join('');

  if (rows.length > 400) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="${6 + years.length}" style="text-align:center; color:var(--text-tertiary); font-size:12px; padding: var(--spacing-md);">
      Showing 400 of ${rows.length} — refine filters to narrow results
    </td>`;
    tbody.appendChild(tr);
  }

  // Row selection bindings
  tbody.querySelectorAll('.mt-row').forEach(tr => {
    tr.addEventListener('click', () => {
      const idx = parseInt(tr.dataset.idx);
      if (MT.selectedIdx === idx) {
        closeMeritSidebar();
      } else {
        MT.selectedIdx = idx;
        tbody.querySelectorAll('.mt-row').forEach(r => r.classList.remove('selected'));
        tr.classList.add('selected');
        openMeritSidebar(MT.filteredRows[idx]);
      }
    });
  });
}

function thSort(key, label) {
  const active = MT.sortKey === key;
  const arrow = active ? (MT.sortDir > 0 ? ' ↑' : ' ↓') : '';
  return `<th data-sort="${key}" class="sortable ${active ? 'active' : ''}">${label}${arrow}</th>`;
}

function openMeritSidebar(row) {
  const sidebar = document.getElementById('mtSidebar');
  const layout = document.getElementById('mtLayout');
  if (!sidebar || !layout) return;

  sidebar.classList.remove('hidden');
  layout.classList.add('sidebar-open');

  const years = Object.keys(row.yearly_merit || {}).map(Number).sort((a, b) => a - b);
  const latY = years[years.length - 1];

  const statsHtml = `
    <div style="display:grid; grid-template-columns: 1fr 1fr; gap: var(--spacing-sm); margin-bottom: var(--spacing-md);">
      <div class="card" style="padding: var(--spacing-sm); text-align:center;">
        <div style="font-family:var(--font-mono); font-size: 16px; font-weight:700; color:var(--brand-primary);">${row.avg_pct_of_max != null ? num(row.avg_pct_of_max, 1) + '%' : num(row.avg_closing_merit)}</div>
        <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase;">Avg Cutoff</div>
      </div>
      <div class="card" style="padding: var(--spacing-sm); text-align:center;">
        <div style="font-family:var(--font-mono); font-size: 16px; font-weight:700; color:var(--brand-primary);">${row.latest_pct_of_max != null ? num(row.latest_pct_of_max, 1) + '%' : num(row.latest_merit)}</div>
        <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase;">Latest (${latY})</div>
      </div>
      <div class="card" style="padding: var(--spacing-sm); text-align:center;">
        <div style="font-family:var(--font-mono); font-size: 14px; font-weight:700;">${row.data_points ?? years.length}</div>
        <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase;">Data Points</div>
      </div>
      <div class="card" style="padding: var(--spacing-sm); text-align:center; display:flex; align-items:center; justify-content:center; flex-direction:column;">
        <div>${volBadge(row.volatility)}</div>
        <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; margin-top:2px;">Volatility</div>
      </div>
    </div>
  `;

  const yearRows = years.map(y => {
    const raw = row.yearly_merit[y];
    const pct = row.yearly_pct_of_max?.[y];
    const pctile = row.yearly_percentile?.[y];
    const seats = row.yearly_seats?.[y];
    const max = YEAR_TOTAL_MAX[Number(y)];
    const cellCls = pct != null ? meritCellClass(pct) : '';
    return `<tr>
      <td>${y}</td>
      <td><span class="num">${raw != null ? num(raw, 2) : '—'}</span>${max ? `<small style="font-size:10px; color:var(--text-tertiary);">/${max}</small>` : ''}</td>
      <td><span class="badge ${cellCls}">${pct != null ? num(pct, 1) + '%' : '—'}</span></td>
      <td><span class="num">${pctile != null ? pctile + 'th' : '—'}</span></td>
      <td><span class="num">${seats ?? '—'}</span></td>
    </tr>`;
  }).join('');

  document.getElementById('mtSidebarContent').innerHTML = `
    <div style="margin-bottom: var(--spacing-md);">
      <h3 style="font-size:18px;">${esc(row.specialty)}</h3>
      <p style="font-size:13px; color:var(--text-secondary); margin-bottom: 2px;">${esc(row.hospital)}</p>
      <span class="badge badge-info">${esc(row.program)}</span>
      <span class="badge badge-warning">${esc(row.quota)}</span>
    </div>
    ${statsHtml}
    <div class="table-wrap">
      <table class="data-table" style="font-size:12px;">
        <thead>
          <tr><th>Year</th><th>Merit</th><th>% Max</th><th>Pctile</th><th>Seats</th></tr>
        </thead>
        <tbody>${yearRows}</tbody>
      </table>
    </div>
  `;

  Charts.drawSidebarTrendChart('mtSidebarChart', row);
  sidebar.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeMeritSidebar() {
  const sidebar = document.getElementById('mtSidebar');
  const layout = document.getElementById('mtLayout');
  if (sidebar) sidebar.classList.add('hidden');
  if (layout) layout.classList.remove('sidebar-open');
  MT.selectedIdx = null;
  document.querySelectorAll('#mtBody tr.selected').forEach(r => r.classList.remove('selected'));
}

// ═══════════════════════════════════════════════════════
// VIEW 2: MY PREDICTION
// ═══════════════════════════════════════════════════════

function renderPrediction(container) {
  if (!container) return;

  container.innerHTML = `
    <div class="section-header">
      <h2>My Prediction</h2>
      <p>Enter your score to see your percentile ranking and Safe, Target, and Reach options with confidence projections.</p>
    </div>

    <div class="card" style="margin-bottom: var(--spacing-xl);">
      <div class="input-grid">
        <div class="form-group">
          <label for="predMerit">Your Merit Score</label>
          <input type="number" id="predMerit" class="input" placeholder="e.g. 28.50" step="0.01" min="0" max="200">
          <span class="form-helper hidden" id="predMeritPct"></span>
        </div>
        <div class="form-group">
          <label for="predProgram">Program</label>
          <select id="predProgram" class="select"><option value="">All Programs</option></select>
        </div>
        <div class="form-group">
          <label for="predQuota">Quota</label>
          <select id="predQuota" class="select"><option value="">All Quotas</option></select>
        </div>
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center; margin-top: var(--spacing-md); flex-wrap: wrap; gap: var(--spacing-sm);">
        <button class="btn btn-primary" id="predBtn">
          Analyze My Score
          <span class="btn-icon-wrapper"><i class="ph ph-arrow-right"></i></span>
        </button>
        <div id="predRecentBar" class="hidden" style="display: flex; align-items: center; gap: var(--spacing-sm);">
          <span style="font-size: 12px; color: var(--text-tertiary);">Recent:</span>
          <div id="predRecentList" style="display: flex; gap: var(--spacing-xs);"></div>
          <button class="btn btn-ghost" id="predClearRecent" style="padding: 2px 8px; font-size: 12px;">Clear</button>
        </div>
      </div>
    </div>

    <div id="predHero" class="pred-hero hidden">
      <div class="pred-hero-left">
        <div class="pred-pct-wrap">
          <div class="pred-pct-number" id="predPctNum">0</div>
          <div class="pred-pct-label">Percentile</div>
        </div>
        <div class="pred-hero-band" id="predBandVal">Mid Range</div>
        <div class="pred-conf-note" id="predConfNote"></div>
      </div>
      <div class="pred-hero-right">
        <div class="pred-hero-stats">
          <div class="pred-hero-stat">
            <div class="pred-hero-val pred-hero-safe-val" id="predSafeCount">0</div>
            <div class="pred-hero-lbl">Safe</div>
          </div>
          <div class="pred-hero-stat">
            <div class="pred-hero-val pred-hero-target-val" id="predTargetCount">0</div>
            <div class="pred-hero-lbl">Target</div>
          </div>
          <div class="pred-hero-stat">
            <div class="pred-hero-val pred-hero-reach-val" id="predReachCount">0</div>
            <div class="pred-hero-lbl">Reach</div>
          </div>
        </div>
        <div class="pred-dist-wrap">
          <canvas id="predDistChart"></canvas>
        </div>
      </div>
    </div>

    <div id="predResults" class="hidden">
      <div class="pred-legend">
        <div class="pred-legend-title">How to read prediction cards</div>
        <div class="pred-legend-items">
          <span class="pred-legend-item"><span class="pred-legend-swatch swatch-safe"></span> Safe: your score exceeds historical avg closing cutoff by 3+ % of max</span>
          <span class="pred-legend-item"><span class="pred-legend-swatch swatch-target"></span> Target: your score is within [-5%, +3%] of the historical avg</span>
          <span class="pred-legend-item"><span class="pred-legend-swatch swatch-reach"></span> Reach: average is slightly higher, but volatility/trends could shift it in reach</span>
        </div>
      </div>

      <div class="mt-toolbar">
        <div class="tab-pills" style="display:flex; gap: var(--spacing-xs); background: var(--surface-secondary); padding: 2px; border-radius: var(--radius-pill);">
          <button class="mt-toggle-btn active" data-filter="all">All</button>
          <button class="mt-toggle-btn" data-filter="safe">Safe</button>
          <button class="mt-toggle-btn" data-filter="target">Target</button>
          <button class="mt-toggle-btn" data-filter="reach">Reach</button>
        </div>
        <input type="text" id="predSearch" placeholder="Filter specialties/hospitals…" class="input" style="max-width: 250px;">
      </div>

      <div id="predBuckets" class="pred-buckets"></div>
    </div>
  `;

  // Bind elements
  const btn = document.getElementById('predBtn');
  const meritInput = document.getElementById('predMerit');
  const progSelect = document.getElementById('predProgram');
  const quotaSelect = document.getElementById('predQuota');
  const recentList = document.getElementById('predRecentList');
  const clearRecentBtn = document.getElementById('predClearRecent');
  const searchInput = document.getElementById('predSearch');

  populateSelect(progSelect, getPrograms());
  populateSelect(quotaSelect, getQuotas());

  progSelect.addEventListener('change', () => {
    populateSelect(quotaSelect, getQuotas(progSelect.value));
  });

  btn.addEventListener('click', runPredictor);
  meritInput.addEventListener('keydown', e => { if (e.key === 'Enter') runPredictor(); });

  // Update % of max preview
  function updateMeritPctPreview() {
    const label = document.getElementById('predMeritPct');
    if (!label) return;
    const merit = parseFloat(meritInput.value);
    const max = getActivePolicyMax();
    if (!isNaN(merit) && merit > 0 && max) {
      const pct = (merit / max) * 100;
      label.textContent = `= ${pct.toFixed(1)}% of ${max} marks`;
      label.classList.remove('hidden');
    } else {
      label.classList.add('hidden');
    }
  }
  meritInput.addEventListener('input', updateMeritPctPreview);
  updateMeritPctPreview();

  // Setup pills
  document.querySelectorAll('#tab-predictor .tab-pills .mt-toggle-btn, #predResults .mt-toggle-btn').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('#predResults .mt-toggle-btn').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      renderPredBuckets(App.ui.predResults, pill.dataset.filter);
    });
  });

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      const f = document.querySelector('#predResults .mt-toggle-btn.active')?.dataset.filter || 'all';
      renderPredBuckets(App.ui.predResults, f);
    });
  }

  // Populate recent list
  function renderPredRecentScores() {
    const scores = getRecentScores();
    const bar = document.getElementById('predRecentBar');
    if (!bar || !recentList) return;
    if (!scores.length) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    recentList.innerHTML = scores.map(s => `<button class="btn btn-secondary" style="padding: 2px 8px; font-size:12px;" data-score="${s}">${s}</button>`).join('');
  }

  renderPredRecentScores();

  if (recentList) {
    recentList.addEventListener('click', e => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const v = parseFloat(btn.dataset.score);
      if (!isNaN(v)) { meritInput.value = v; updateMeritPctPreview(); runPredictor(); }
    });
  }

  if (clearRecentBtn) {
    clearRecentBtn.addEventListener('click', () => {
      localStorage.removeItem(RECENT_KEY);
      renderPredRecentScores();
    });
  }

  // Autofill
  const saved = getSavedCalcMerit();
  if (saved && !meritInput.value) {
    meritInput.value = saved.total.toFixed(2);
    updateMeritPctPreview();
  }

  showDailyVerse();
}

function runPredictor() {
  const meritInput = document.getElementById('predMerit');
  const progSelect = document.getElementById('predProgram');
  const quotaSelect = document.getElementById('predQuota');
  if (!meritInput) return;

  const merit = parseFloat(meritInput.value);
  const prog = progSelect.value;
  const quota = quotaSelect.value;

  if (isNaN(merit) || merit <= 0) {
    alert('Please enter a valid merit score.');
    return;
  }

  saveRecentScore(merit.toFixed(2));
  const policyMax = getActivePolicyMax();
  if (!policyMax) { alert('Policy definitions are not loaded.'); return; }

  const userPct = (merit / policyMax) * 100;

  const results = App.data.flatLookup
    .filter(r => (!prog || r.program === prog) && (!quota || r.quota === quota) && r.avg_pct_of_max != null)
    .map(r => {
      const delta = userPct - r.avg_pct_of_max;
      let bucket;
      if (delta >= 3.0) bucket = 'safe';
      else if (delta >= -5.0) bucket = 'target';
      else if (delta >= -15.0) bucket = 'reach';
      else return null;

      let projection = null;
      if (r.latest_pct_of_max != null) {
        const base = r.latest_pct_of_max;
        const shift = r.trend === 'rising' ? 2 : r.trend === 'falling' ? -2 : 0;
        const spread = r.volatility === 'high' ? 6 : r.volatility === 'medium' ? 3 : 1.5;
        projection = {
          low: parseFloat(Math.max(0, base + shift - spread).toFixed(1)),
          high: parseFloat(Math.min(100, base + shift + spread).toFixed(1)),
          trend: r.trend,
          vol: r.volatility
        };
      }

      return { ...r, userPct, delta, bucket, projection };
    })
    .filter(Boolean);

  App.ui.predResults = results;

  const allPcts = App.data.flatLookup.map(r => r.avg_pct_of_max).filter(v => v != null);
  const percentile = getPercentile(userPct, allPcts);
  const band = getMeritBand(userPct, allPcts);

  const safeN = results.filter(r => r.bucket === 'safe').length;
  const targetN = results.filter(r => r.bucket === 'target').length;
  const reachN = results.filter(r => r.bucket === 'reach').length;

  const hero = document.getElementById('predHero');
  const resultsContainer = document.getElementById('predResults');
  if (hero) hero.classList.remove('hidden');
  if (resultsContainer) resultsContainer.classList.remove('hidden');

  const pctNum = document.getElementById('predPctNum');
  const bandVal = document.getElementById('predBandVal');
  const safeCount = document.getElementById('predSafeCount');
  const targetCount = document.getElementById('predTargetCount');
  const reachCount = document.getElementById('predReachCount');

  if (pctNum) pctNum.textContent = percentile;
  if (bandVal) {
    bandVal.textContent = band.label;
    bandVal.className = `pred-hero-band badge ${band.cls}`;
  }
  if (safeCount) safeCount.textContent = safeN;
  if (targetCount) targetCount.textContent = targetN;
  if (reachCount) reachCount.textContent = reachN;

  Charts.drawPredDistributionChart('predDistChart', allPcts, userPct);
  renderPredBuckets(results, 'all');
}

function renderPredBuckets(results, filter = 'all') {
  const bucketsEl = document.getElementById('predBuckets');
  const searchInput = document.getElementById('predSearch');
  if (!bucketsEl) return;

  const query = searchInput ? searchInput.value.toLowerCase().trim() : '';
  const filtered = results.filter(r => {
    if (filter !== 'all' && r.bucket !== filter) return false;
    if (query && !r.specialty.toLowerCase().includes(query) && !r.hospital.toLowerCase().includes(query)) return false;
    return true;
  });

  if (!filtered.length) {
    bucketsEl.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-tertiary);">No matching placements found. Try adjusting filters.</div>`;
    return;
  }

  // Double-Bezel layout for bucket items
  bucketsEl.innerHTML = filtered.map(r => {
    const bucketLabel = r.bucket.toUpperCase();
    const badgeCls = r.bucket === 'safe' ? 'badge-success' : r.bucket === 'target' ? 'badge-warning' : 'badge-danger';
    const deltaStr = r.delta >= 0 ? `+${r.delta.toFixed(1)}%` : `${r.delta.toFixed(1)}%`;
    const projRange = r.projection ? `${r.projection.low}%–${r.projection.high}%` : '—';
    
    return `
      <div class="double-bezel">
        <div class="double-bezel-inner pred-option-card">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:var(--spacing-sm);">
            <div class="spec">${esc(r.specialty)}</div>
            <span class="badge ${badgeCls}">${bucketLabel}</span>
          </div>
          <div class="hosp">${esc(r.hospital)}</div>
          <div class="meta-row">
            <span>Program: <strong>${esc(r.program)}</strong></span>
            <span>Quota: <strong>${esc(r.quota)}</strong></span>
          </div>
          <div class="meta-row" style="border-top: 1px dashed var(--border-default); padding-top: var(--spacing-sm); margin-top: var(--spacing-xs);">
            <span>Avg Cutoff: <strong>${num(r.avg_pct_of_max, 1)}%</strong></span>
            <span class="avg-merit ${r.delta >= 0 ? 'above' : 'below'}">${deltaStr} vs Avg</span>
          </div>
          <div class="meta-row">
            <span>Proj Range: <strong>${projRange}</strong></span>
            <span class="trend-tag">${trendBadge(r.trend)}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// ═══════════════════════════════════════════════════════
// VIEW 3: WHAT DO I NEED
// ═══════════════════════════════════════════════════════

function renderWhatDoINeed(container) {
  if (!container) return;

  container.innerHTML = `
    <div class="section-header">
      <h2>What Score Do I Need?</h2>
      <p>Select a target specialty and hospital to find the minimum merit score required historically.</p>
    </div>

    <div class="card">
      <div class="input-grid">
        <div class="form-group">
          <label for="revProgram">Program</label>
          <select id="revProgram" class="select"><option value="">Select Program</option></select>
        </div>
        <div class="form-group">
          <label for="revQuota">Quota</label>
          <select id="revQuota" class="select"><option value="">Select Quota</option></select>
        </div>
        <div class="form-group">
          <label for="revSpecialty">Specialty</label>
          <select id="revSpecialty" class="select"><option value="">Select Specialty</option></select>
        </div>
        <div class="form-group">
          <label for="revHospital">Hospital (optional)</label>
          <select id="revHospital" class="select"><option value="">All Hospitals</option></select>
        </div>
      </div>
      <button class="btn btn-primary" id="revBtn" style="margin-top: var(--spacing-md);">
        Show Requirements
        <span class="btn-icon-wrapper"><i class="ph ph-magnifying-glass"></i></span>
      </button>
    </div>

    <div id="revResults" class="hidden" style="margin-top: var(--spacing-xl);">
      <div id="revResultsContent"></div>
    </div>
  `;

  const revProg = document.getElementById('revProgram');
  const revQuota = document.getElementById('revQuota');
  const revSpec = document.getElementById('revSpecialty');
  const revHosp = document.getElementById('revHospital');
  const revBtn = document.getElementById('revBtn');

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

  revBtn.addEventListener('click', runReverseCalc);
  showDailyVerse();
}

function runReverseCalc() {
  const revProg = document.getElementById('revProgram');
  const revQuota = document.getElementById('revQuota');
  const revSpec = document.getElementById('revSpecialty');
  const revHosp = document.getElementById('revHospital');

  if (!revSpec || !revSpec.value) {
    alert('Please select at least a specialty.');
    return;
  }

  const prog = revProg.value;
  const quota = revQuota.value;
  const spec = revSpec.value;
  const hosp = revHosp.value;

  const rows = App.data.flatLookup.filter(r =>
    (!prog || r.program === prog) &&
    (!quota || r.quota === quota) &&
    r.specialty === spec &&
    (!hosp || r.hospital === hosp)
  );

  const resultsDiv = document.getElementById('revResults');
  const contentDiv = document.getElementById('revResultsContent');
  if (!resultsDiv || !contentDiv) return;

  if (!rows.length) {
    resultsDiv.classList.remove('hidden');
    contentDiv.innerHTML = `<div class="card" style="text-align:center;padding:40px;color:var(--text-tertiary);">No records found for the selection.</div>`;
    return;
  }

  const activeMax = getActivePolicyMax();

  const cardsHtml = rows.map(row => {
    const years = Object.keys(row.yearly_merit || {}).sort();
    const latestMerit = row.yearly_merit[years[years.length - 1]];
    const avgPct = row.avg_pct_of_max;
    const latestPct = row.latest_pct_of_max;

    const pcts = Object.values(row.yearly_pct_of_max || {}).filter(v => v != null && v > 0);
    const maxObservedPct = pcts.length ? Math.max(...pcts) : Math.max(avgPct || 0, latestPct || 0);
    const meanPct = pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : (avgPct || 0);
    const stddevPct = pcts.length > 1
      ? Math.sqrt(pcts.reduce((s, v) => s + (v - meanPct) ** 2, 0) / pcts.length)
      : 5;

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

    projectedMin = Math.max(0, projectedMin);
    projectedMax = Math.min(projectedMax, maxObservedPct);

    const neededRaw = activeMax ? (projectedMax / 100 * activeMax) : latestMerit;
    const seatsLatest = row.yearly_seats ? row.yearly_seats[years[years.length - 1]] : '—';

    return `
      <div class="card" style="margin-bottom:var(--spacing-md); padding: var(--spacing-lg);">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:var(--spacing-sm);">
          <div>
            <h3 style="color:var(--brand-primary); font-size: 16px;">${esc(row.specialty)}</h3>
            <div style="font-size:12px; color:var(--text-secondary);">${esc(row.hospital)} &middot; ${esc(row.program)} &middot; ${esc(row.quota)}</div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase;">Seats (latest)</div>
            <div style="font-size:16px; font-weight:700; color:var(--brand-primary);">${seatsLatest}</div>
          </div>
        </div>
        <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap: var(--spacing-md); margin-top: var(--spacing-md);">
          <div>
            <div style="font-size:11px; color:var(--text-tertiary); text-transform:uppercase;">Average Cutoff</div>
            <div style="font-family:var(--font-mono); font-size:16px; font-weight:600;">${num(avgPct, 1)}%</div>
            <div style="font-size:11px; color:var(--text-muted);">${activeMax ? num(avgPct / 100 * activeMax, 2) + ' / ' + activeMax : ''}</div>
          </div>
          <div>
            <div style="font-size:11px; color:var(--text-tertiary); text-transform:uppercase;">Latest Cutoff</div>
            <div style="font-family:var(--font-mono); font-size:16px; font-weight:600;">${num(latestPct, 1)}%</div>
            <div style="font-size:11px; color:var(--text-muted);">${num(latestMerit, 2)} raw (${years[years.length - 1]})</div>
          </div>
          <div>
            <div style="font-size:11px; color:var(--text-tertiary); text-transform:uppercase;">Projected Range</div>
            <div style="font-family:var(--font-mono); font-size:16px; font-weight:600;">${num(projectedMin, 1)}–${num(projectedMax, 1)}%</div>
            <div style="font-size:11px; color:var(--text-muted);">${activeMax ? num(projectedMin / 100 * activeMax, 2) + '–' + num(projectedMax / 100 * activeMax, 2) + ' / ' + activeMax : ''}</div>
          </div>
          <div>
            <div style="font-size:11px; color:var(--text-tertiary); text-transform:uppercase;">You Need (safe)</div>
            <div style="font-family:var(--font-mono); font-size:18px; font-weight:700; color:var(--color-safe);">${activeMax ? num(neededRaw, 2) : num(latestMerit, 2)}</div>
            <div style="font-size:11px; color:var(--text-muted);">out of ${activeMax || '?'} marks</div>
          </div>
        </div>
        <div style="margin-top:var(--spacing-md); border-top: 1px dashed var(--border-default); padding-top:var(--spacing-sm); display:flex; gap: var(--spacing-md); flex-wrap:wrap; font-size:11px; color:var(--text-secondary);">
          <span>Trend: <strong>${trendBadge(row.trend)}</strong></span>
          <span>Volatility: <strong>${volBadge(row.volatility)}</strong></span>
          <span>Confidence: <strong>${confBadge(row.confidence)}</strong></span>
          <span>Data points: <strong>${row.data_points || years.length}</strong></span>
        </div>
      </div>
    `;
  }).join('');

  resultsDiv.classList.remove('hidden');
  contentDiv.innerHTML = `
    <div style="margin-bottom:var(--spacing-md); font-size:13px; color:var(--text-secondary);">
      Found <strong>${rows.length}</strong> matching options. Cutoff details are normalized to % of max marks (${activeMax || '?'}).
    </div>
    ${cardsHtml}
  `;
}

// ═══════════════════════════════════════════════════════
// VIEW 4: MERIT CALCULATOR
// ═══════════════════════════════════════════════════════

let _lastCalcResult = null;

function renderCalculator(container) {
  if (!container) return;

  container.innerHTML = `
    <div class="section-header">
      <h2>Merit Calculator</h2>
      <p>Estimate your score from individual components based on active PHF policy criteria.</p>
    </div>

    <div id="calcSavedBanner" class="calc-saved-banner hidden" style="background-color: var(--brand-light); border: 1px solid var(--brand-primary); padding: var(--spacing-md); border-radius: var(--radius-card); margin-bottom: var(--spacing-lg); display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--spacing-sm);">
      <div>
        <span style="font-weight:600; color:var(--brand-primary);"><i class="ph ph-check-circle" style="vertical-align: middle; margin-right: 4px;"></i>Saved Merit: </span>
        <span id="calcSavedScore" style="font-family:var(--font-mono); font-weight:700; font-size:16px;"></span>
        <span id="calcSavedPolicy" style="font-size:12px; color:var(--text-secondary); margin-left: var(--spacing-xs);"></span>
      </div>
      <div style="display:flex; gap: var(--spacing-sm);">
        <button class="btn btn-primary" id="calcUseSaved" style="padding: 6px 12px; font-size:12px;">Use in Predictor</button>
        <button class="btn btn-secondary" id="calcClearSaved" style="padding: 6px 12px; font-size:12px;">Clear</button>
      </div>
    </div>

    <div class="card" id="calcPolicyInfo" style="margin-bottom: var(--spacing-lg);">
      <div class="calc-policy-header">
        <span class="badge badge-info" id="calcPolicyBadge">Loading…</span>
        <strong id="calcPolicyLabel"></strong>
        <span class="calc-policy-note" id="calcPolicyNote"></span>
      </div>
      <p class="calc-policy-warning hidden" id="calcPolicyWarning">
        <i class="ph ph-warning" style="vertical-align: middle; margin-right: 4px;"></i>This is the <em>expected</em> policy and has not yet been officially confirmed by PHF.
      </p>
    </div>

    <div class="card">
      <form id="calcForm" class="calc-form">
        <p>Loading policy fields…</p>
      </form>
      <div class="calc-actions">
        <button class="btn btn-primary" id="calcRunBtn">Calculate Score</button>
        <button class="btn btn-secondary" id="calcResetBtn">Reset Fields</button>
      </div>
    </div>

    <div id="calcResult" class="calc-result-box hidden">
      <div class="calc-result-score">
        <div>
          <span class="calc-result-label">Estimated Merit Score</span>
          <div class="calc-result-value-row">
            <span class="calc-result-value" id="calcResultValue">—</span>
            <span class="calc-result-out" id="calcResultOut">/ 100</span>
          </div>
        </div>
        <div class="badge" id="calcResultBand">Mid Range</div>
      </div>
      <div class="calc-result-breakdown" id="calcBreakdown"></div>
      <div class="calc-result-actions" style="margin-top: var(--spacing-md);">
        <button class="btn btn-primary" id="calcSaveBtn">Save &amp; Analyze</button>
      </div>
    </div>
  `;

  // Bind elements
  const runBtn = document.getElementById('calcRunBtn');
  const resetBtn = document.getElementById('calcResetBtn');
  const saveBtn = document.getElementById('calcSaveBtn');
  
  const useSavedBtn = document.getElementById('calcUseSaved');
  const clearSavedBtn = document.getElementById('calcClearSaved');

  buildCalculatorForm();
  showCalcSavedBanner();

  if (runBtn) runBtn.addEventListener('click', calculateScore);
  if (resetBtn) {
    resetBtn.addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById('calcForm')?.reset();
      document.getElementById('calcResult')?.classList.add('hidden');
    });
  }

  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      if (_lastCalcResult) {
        saveCalcMerit(_lastCalcResult);
        showCalcSavedBanner();
        window.location.hash = '#/analytics/prediction';
      }
    });
  }

  if (useSavedBtn) {
    useSavedBtn.addEventListener('click', () => {
      window.location.hash = '#/analytics/prediction';
    });
  }

  if (clearSavedBtn) {
    clearSavedBtn.addEventListener('click', () => {
      clearCalcMerit();
      showCalcSavedBanner();
    });
  }

  showDailyVerse();
}

function buildCalculatorForm() {
  const info = getActivePolicyForCalc();
  if (!info) return;
  const { key, policy, isExpected } = info;
  
  const badge = document.getElementById('calcPolicyBadge');
  const label = document.getElementById('calcPolicyLabel');
  const noteEl = document.getElementById('calcPolicyNote');
  const warning = document.getElementById('calcPolicyWarning');
  const outEl = document.getElementById('calcResultOut');
  
  if (badge) badge.textContent = `Induction ${policy.induction || key}`;
  if (label) label.textContent = policy.label || key;
  if (noteEl) noteEl.textContent = policy.notes || '';
  if (warning) warning.classList.toggle('hidden', !isExpected);
  if (outEl) outEl.textContent = `/ ${policy.total_marks || 100}`;

  const form = document.getElementById('calcForm');
  if (!form) return;
  
  const included = (policy.components || []).filter(c => c.included !== false);
  form.innerHTML = included.map(comp => buildComponentInputHtml(comp)).join('');
  
  setupCalcSpecialInputs();
}

function buildComponentInputHtml(comp) {
  const { key, label, max_marks, type, description, per_year, per_item, score_max } = comp;
  let inputHtml = '';
  
  if (type === 'boolean') {
    inputHtml = `
      <div style="display:flex; align-items:center; gap:var(--spacing-sm); margin-top:2px;">
        <input type="checkbox" id="calc_${key}" name="${key}" style="width:auto;">
        <label for="calc_${key}" style="font-weight:400; margin-bottom:0;">Yes — ${max_marks} marks</label>
      </div>
    `;
  } else if (type === 'percentage') {
    inputHtml = `
      <input type="number" id="calc_${key}" name="${key}" class="input" placeholder="e.g. 72.50" min="0" max="100" step="0.01">
      <span class="form-helper">Enter MBBS aggregate percentage · Max: ${max_marks} marks</span>
    `;
  } else if (type === 'years') {
    const maxYrs = Math.floor(max_marks / (per_year || 1));
    inputHtml = `
      <input type="number" id="calc_${key}" name="${key}" class="input" placeholder="Years" min="0" max="${maxYrs}" step="0.5">
      <span class="form-helper">${per_year} marks/year · Max ${maxYrs} years = ${max_marks} marks</span>
    `;
  } else if (type === 'count') {
    const maxCnt = Math.floor(max_marks / (per_item || 1));
    inputHtml = `
      <input type="number" id="calc_${key}" name="${key}" class="input" placeholder="Count" min="0" max="${maxCnt}" step="1">
      <span class="form-helper">${per_item} marks each · Max ${maxCnt} items = ${max_marks} marks</span>
    `;
  } else if (type === 'score') {
    const maxSc = score_max || 1100;
    inputHtml = `
      <input type="number" id="calc_${key}" name="${key}" class="input" placeholder="e.g. 850" min="0" max="${maxSc}" step="1">
      <span class="form-helper">Out of ${maxSc} · Scaled to ${max_marks} marks</span>
    `;
  } else if (type === 'tiered_select') {
    const opts = (comp.tiers || []).map(t => `<option value="${t.value}">${esc(t.label)}</option>`).join('');
    inputHtml = `
      <select id="calc_${key}" name="${key}" class="select">
        <option value="">— Select —</option>${opts}
      </select>
      <span class="form-helper">Max: ${max_marks} marks</span>
    `;
  } else if (type === 'fcps_jcat_combo') {
    const fcpsTiers = (comp.fcps_tiers || []).map(t =>
      `<option value="${t.marks}">${esc(t.label)} — ${t.marks} mark${t.marks !== 1 ? 's' : ''}</option>`).join('');
    const jcatThresholds = JSON.stringify(comp.jcat_thresholds || []).replace(/'/g, '&#39;');
    
    inputHtml = `
      <div style="display:flex; flex-direction:column; gap: var(--spacing-sm);">
        <select id="calc_${key}_type" data-comp-key="${esc(key)}" class="select calc-fj-type-sel">
          <option value="">— Select qualification —</option>
          <option value="fcps">FCPS Part-I</option>
          <option value="jcat">JCAT</option>
          <option value="none">Neither / Not applicable (0 marks)</option>
        </select>
        <div id="calc_${key}_fcps_div" class="hidden" style="margin-left: var(--spacing-md);">
          <select id="calc_${key}_attempt" class="select">
            <option value="">— Select attempt number —</option>${fcpsTiers}
          </select>
          <span class="form-helper">Marks awarded by attempt: 1st=5, 2nd=4, 3rd=3, 4th+=0</span>
        </div>
        <div id="calc_${key}_jcat_div" class="hidden" style="margin-left: var(--spacing-md);">
          <input type="number" id="calc_${key}_jcat_pct" class="input calc-jcat-pct-input"
            data-comp-key="${esc(key)}" data-thresholds='${jcatThresholds}'
            placeholder="JCAT % (e.g. 72.5)" min="0" max="100" step="0.1" />
          <span class="form-helper" id="calc_${key}_jcat_hint">Enter JCAT percentage</span>
        </div>
      </div>
    `;
  } else if (type === 'months') {
    const per3mo = comp.per_3_months || 1.25;
    const maxMons = Math.round(max_marks / per3mo * 3);
    inputHtml = `
      <input type="number" id="calc_${key}" name="${key}" class="input" placeholder="Months" min="0" max="${maxMons}" step="1">
      <span class="form-helper">${per3mo} marks per 3 months · Max ${maxMons} months = ${max_marks} marks</span>
    `;
  }

  return `
    <div class="form-group" style="border-bottom: 1px solid var(--border-default); padding-bottom: var(--spacing-md);">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 4px;">
        <label for="calc_${key}" style="font-weight:600; margin-bottom:0;">${esc(label)}</label>
        <span class="badge badge-info">${max_marks} pts max</span>
      </div>
      ${description ? `<p style="font-size:12px; color:var(--text-tertiary); margin-bottom:var(--spacing-sm);">${esc(description)}</p>` : ''}
      ${inputHtml}
    </div>
  `;
}

function setupCalcSpecialInputs() {
  document.querySelectorAll('.calc-fj-type-sel').forEach(sel => {
    sel.addEventListener('change', function () {
      const k = this.dataset.compKey;
      const fcpsEl = document.getElementById(`calc_${k}_fcps_div`);
      const jcatEl = document.getElementById(`calc_${k}_jcat_div`);
      if (fcpsEl) fcpsEl.classList.toggle('hidden', this.value !== 'fcps');
      if (jcatEl) jcatEl.classList.toggle('hidden', this.value !== 'jcat');
    });
  });

  document.querySelectorAll('.calc-jcat-pct-input').forEach(inp => {
    inp.addEventListener('input', function () {
      const k = this.dataset.compKey;
      const hintEl = document.getElementById(`calc_${k}_jcat_hint`);
      if (!hintEl) return;
      const pct = parseFloat(this.value);
      if (isNaN(pct) || this.value === '') { 
        hintEl.textContent = 'Enter JCAT percentage'; 
        return; 
      }
      const thresholds = JSON.parse(this.dataset.thresholds || '[]').slice().sort((a, b) => b.min - a.min);
      const tier = thresholds.find(t => pct >= t.min);
      hintEl.textContent = tier
        ? `${pct}% → ${tier.value} marks (${tier.label})`
        : 'Enter percentage → marks assigned automatically';
    });
  });
}

function calculateScore(e) {
  if (e) e.preventDefault();
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
      if (!isNaN(pct) && el.value !== '') { 
        contribution = Math.min((pct / 100) * max_marks, max_marks); 
        valueStr = `${pct.toFixed(2)}%`; 
      }
    } else if (type === 'years') {
      const yrs = parseFloat(el.value);
      if (!isNaN(yrs) && el.value !== '') { 
        contribution = Math.min(yrs * (per_year || 1), max_marks); 
        valueStr = `${yrs} yrs`; 
      }
    } else if (type === 'count') {
      const cnt = parseFloat(el.value);
      if (!isNaN(cnt) && el.value !== '') { 
        contribution = Math.min(cnt * (per_item || 1), max_marks); 
        valueStr = String(cnt); 
      }
    } else if (type === 'score') {
      const sc = parseFloat(el.value), msc = score_max || 1100;
      if (!isNaN(sc) && el.value !== '') { 
        contribution = Math.min((sc / msc) * max_marks, max_marks); 
        valueStr = String(sc); 
      }
    } else if (type === 'tiered_select') {
      const val = parseFloat(el.value);
      if (!isNaN(val) && el.value !== '') { 
        contribution = Math.min(val, max_marks); 
        valueStr = el.options[el.selectedIndex]?.text || String(val); 
      }
    } else if (type === 'fcps_jcat_combo') {
      const qual = document.getElementById(`calc_${ck}_type`)?.value;
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
          valueStr = `JCAT ${pct}% (${tier?.label || '—'})`;
        }
      } else if (qual === 'none') {
        valueStr = 'None'; 
        contribution = 0;
      }
    } else if (type === 'months') {
      const months = parseFloat(el.value), per3mo = comp.per_3_months || 1.25;
      if (!isNaN(months) && el.value !== '') { 
        contribution = Math.min(Math.floor(months / 3) * per3mo, max_marks); 
        valueStr = `${months} mo`; 
      }
    }
    
    total += contribution;
    breakdown.push({ label, contribution, max: max_marks, value: valueStr });
  }

  total = Math.round(total * 100) / 100;
  _lastCalcResult = { 
    total, 
    breakdown, 
    policyKey: key, 
    policyLabel: policy.label, 
    totalMarks: policy.total_marks || 100, 
    calculatedAt: Date.now() 
  };

  const resultBox = document.getElementById('calcResult');
  const valueEl = document.getElementById('calcResultValue');
  const breakdownEl = document.getElementById('calcBreakdown');
  const bandEl = document.getElementById('calcResultBand');

  if (valueEl) valueEl.textContent = total.toFixed(2);
  if (resultBox) resultBox.classList.remove('hidden');

  if (bandEl) {
    const allPcts = App.data.flatLookup.map(r => r.avg_pct_of_max).filter(v => v != null);
    const policyMax = getActivePolicyMax();
    const userPct = policyMax ? (total / policyMax) * 100 : total;
    const band = getMeritBand(userPct, allPcts);
    bandEl.textContent = `${band.emoji} ${band.label}`;
    bandEl.className = `badge ${band.cls}`;
  }

  if (breakdownEl) {
    breakdownEl.innerHTML = breakdown.map(b => {
      const fill = b.max > 0 ? (b.contribution / b.max * 100).toFixed(1) : 0;
      return `
        <div style="display:flex; justify-content:space-between; align-items:center; font-size:13px; padding: 4px 0; border-bottom: 1px solid var(--border-subtle);">
          <span style="color:var(--text-secondary);">${esc(b.label)}</span>
          <div style="display:flex; align-items:center; gap:var(--spacing-md);">
            <span style="font-size:11px; color:var(--text-tertiary);">${esc(b.value)}</span>
            <span style="font-family:var(--font-mono); font-weight:600;">${b.contribution.toFixed(2)} / ${b.max}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  resultBox?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function showCalcSavedBanner() {
  const saved = getSavedCalcMerit();
  const banner = document.getElementById('calcSavedBanner');
  const scoreEl = document.getElementById('calcSavedScore');
  const polEl = document.getElementById('calcSavedPolicy');

  if (!banner) return;
  if (!saved) { banner.classList.add('hidden'); return; }
  
  banner.classList.remove('hidden');
  if (scoreEl) scoreEl.textContent = Number(saved.total).toFixed(2);
  if (polEl) polEl.textContent = saved.policyLabel ? `(${saved.policyLabel})` : '';
}

// ═══════════════════════════════════════════════════════
// VIEW 5: COMPARE SPECIALTIES
// ═══════════════════════════════════════════════════════

function renderCompare(container) {
  if (!container) return;

  container.innerHTML = `
    <div class="section-header">
      <h2>Compare Specialties</h2>
      <p>Select up to 3 combinations to compare closing merits, volatility, and seat trends side-by-side.</p>
    </div>

    <div class="card">
      <div id="compareSlots" class="compare-slots">
        <div class="compare-slot">
          <label class="compare-slot-label">Slot 1</label>
          <select class="select compare-sel" id="cmpSpec1"><option value="">Select specialty – hospital</option></select>
        </div>
        <div class="compare-slot">
          <label class="compare-slot-label">Slot 2</label>
          <select class="select compare-sel" id="cmpSpec2"><option value="">Select specialty – hospital</option></select>
        </div>
        <div class="compare-slot">
          <label class="compare-slot-label">Slot 3</label>
          <select class="select compare-sel" id="cmpSpec3"><option value="">Select specialty – hospital</option></select>
        </div>
      </div>
      <div style="margin-top: var(--spacing-md); display:flex; align-items:center; gap: var(--spacing-sm);">
        <label for="cmpProgram" style="font-size:13px; font-weight:600;">Program:</label>
        <select id="cmpProgram" class="select" style="max-width: 150px;"><option value="FCPS">FCPS</option></select>
        <button class="btn btn-primary" id="cmpBtn" style="margin-left: auto;">Compare Slots</button>
      </div>
    </div>

    <div id="cmpResults" class="hidden"></div>
  `;

  const programSelect = document.getElementById('cmpProgram');
  const spec1 = document.getElementById('cmpSpec1');
  const spec2 = document.getElementById('cmpSpec2');
  const spec3 = document.getElementById('cmpSpec3');
  const compareBtn = document.getElementById('cmpBtn');

  // Populate comparison selectors
  populateSelect(programSelect, getPrograms());
  
  function populateCompareOptions() {
    const prog = programSelect.value;
    const options = App.data.flatLookup
      .filter(r => !prog || r.program === prog)
      .map(r => `${r.specialty} | ${r.hospital} | ${r.quota}`)
      .sort();

    [spec1, spec2, spec3].forEach(sel => {
      if (!sel) return;
      sel.innerHTML = '<option value="">Select specialty – hospital</option>' +
        options.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
    });
  }

  programSelect.addEventListener('change', populateCompareOptions);
  populateCompareOptions();

  compareBtn.addEventListener('click', runCompareSpecialties);
  showDailyVerse();
}

function runCompareSpecialties() {
  const spec1 = document.getElementById('cmpSpec1').value;
  const spec2 = document.getElementById('cmpSpec2').value;
  const spec3 = document.getElementById('cmpSpec3').value;
  const resultsDiv = document.getElementById('cmpResults');

  if (!spec1 && !spec2 && !spec3) {
    alert('Please select at least one combination to compare.');
    return;
  }

  const selectedKeys = [spec1, spec2, spec3].filter(Boolean);
  const rows = selectedKeys.map(key => {
    const [spec, hosp, quota] = key.split(' | ');
    return App.data.flatLookup.find(r => r.specialty === spec && r.hospital === hosp && r.quota === quota);
  }).filter(Boolean);

  if (!rows.length) return;

  const activeMax = getActivePolicyMax();

  // Side-by-side cards (2-column layout as requested)
  resultsDiv.innerHTML = `
    <div class="cmp-results-grid" style="display:grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: var(--spacing-lg); margin-top: var(--spacing-xl);">
      ${rows.map(r => {
        const years = Object.keys(r.yearly_merit || {}).sort();
        const latestY = years[years.length - 1];
        const latestM = r.yearly_merit[latestY];
        const seatsLatest = r.yearly_seats ? r.yearly_seats[latestY] : '—';
        return `
          <div class="cmp-col card">
            <div class="cmp-col-header">
              <div class="cmp-col-spec">${esc(r.specialty)}</div>
              <div class="cmp-col-hosp">${esc(r.hospital)}</div>
              <div style="font-size:11px; color:var(--text-tertiary); margin-top:4px;">${esc(r.program)} &middot; ${esc(r.quota)}</div>
            </div>
            
            <div class="cmp-metric-row">
              <span class="cmp-metric-label">Average Cutoff (% of Max)</span>
              <span class="cmp-metric-value">${num(r.avg_pct_of_max, 1)}%</span>
            </div>
            <div class="cmp-metric-row">
              <span class="cmp-metric-label">Latest Cutoff (${latestY})</span>
              <span class="cmp-metric-value">${num(r.latest_pct_of_max, 1)}% (${num(latestM, 2)} raw)</span>
            </div>
            <div class="cmp-metric-row">
              <span class="cmp-metric-label">Seats (Latest)</span>
              <span class="cmp-metric-value" style="color:var(--brand-primary);">${seatsLatest}</span>
            </div>
            <div class="cmp-metric-row">
              <span class="cmp-metric-label">Trend Direction</span>
              <span class="cmp-metric-value">${trendBadge(r.trend)}</span>
            </div>
            <div class="cmp-metric-row">
              <span class="cmp-metric-label">Volatility</span>
              <span class="cmp-metric-value">${volBadge(r.volatility)}</span>
            </div>
            <div class="cmp-metric-row" style="border-bottom:none;">
              <span class="cmp-metric-label">Data Points (Years)</span>
              <span class="cmp-metric-value">${r.data_points || years.length} yrs</span>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
  resultsDiv.classList.remove('hidden');
  resultsDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ═══════════════════════════════════════════════════════
// VIEW 6: PREVIOUS MERIT LISTS
// ═══════════════════════════════════════════════════════

let _currentState = { induction: null, round: null, candidates: [], meta: null };
let _curFiltersWired = false;

function renderMeritLists(container) {
  if (!container) return;

  container.innerHTML = `
    <div class="section-header">
      <h2>Previous Merit Lists</h2>
      <p>Browse official round-by-round candidate allocation results from historical cycles.</p>
    </div>

    <div class="card" style="margin-bottom: var(--spacing-xl);">
      <div class="input-grid" style="grid-template-columns: 1fr 1fr auto; align-items: end;">
        <div class="form-group" style="margin-bottom:0;">
          <label for="curInduction">Induction Cycle</label>
          <select id="curInduction" class="select"><option value="">Select induction</option></select>
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label for="curRound">Round</label>
          <select id="curRound" class="select"><option value="">Select round</option></select>
        </div>
        <button class="btn btn-primary" id="curLoadBtn">Load Records</button>
      </div>
    </div>

    <div id="currentMeta" class="card hidden" style="margin-bottom: var(--spacing-lg); padding: var(--spacing-md); background-color: var(--surface-secondary);"></div>

    <div class="card" id="curFilters" style="display:none; margin-bottom: var(--spacing-lg);">
      <div class="input-grid">
        <div class="form-group">
          <label for="curProgram">Program</label>
          <select id="curProgram" class="select"><option value="">All Programs</option></select>
        </div>
        <div class="form-group">
          <label for="curQuota">Quota</label>
          <select id="curQuota" class="select"><option value="">All Quotas</option></select>
        </div>
        <div class="form-group">
          <label for="curSearch">Search Criteria</label>
          <input type="text" id="curSearch" class="input" placeholder="Search PMDC, name, hospital…">
        </div>
      </div>
    </div>

    <div class="table-wrap">
      <table class="data-table" id="currentTable">
        <thead>
          <tr>
            <th>#</th>
            <th>Name</th>
            <th>PMDC</th>
            <th>Specialty</th>
            <th>Hospital</th>
            <th>Program</th>
            <th>Quota</th>
            <th>Marks</th>
            <th>Pref</th>
            <th>Consent</th>
          </tr>
        </thead>
        <tbody id="currentTableBody">
          <tr><td colspan="10" style="text-align:center;padding:40px;color:var(--text-muted);">Select cycle and round to load records.</td></tr>
        </tbody>
      </table>
    </div>
    <p id="currentCaption" class="table-caption"></p>
  `;

  const indSel = document.getElementById('curInduction');
  const roundSel = document.getElementById('curRound');
  const loadBtn = document.getElementById('curLoadBtn');

  if (indSel) {
    const years = getYears();
    indSel.innerHTML = '<option value="">Select induction</option>' +
      years.map(y => `<option value="${y}">${formatInductionLabel(y)}</option>`).join('');
      
    indSel.addEventListener('change', () => {
      if (roundSel) {
        roundSel.innerHTML = '<option value="">Select round</option>' +
          [1,2,3,4,5,6,7,8,9,10].map(r => `<option value="${r}">Round ${r}</option>`).join('');
      }
    });
  }

  if (loadBtn) {
    loadBtn.addEventListener('click', async () => {
      const ind = indSel.value;
      const rnd = roundSel.value;
      if (!ind || !rnd) return;
      await loadAndRenderCurrentMerit(ind, parseInt(rnd, 10));
    });
  }

  // Wire filters
  ['curProgram', 'curQuota', 'curSearch'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change', applyCurrentFilters);
    }
  });

  if (_currentState.candidates.length) {
    applyCurrentFilters();
  }
  showDailyVerse();
}

async function loadAndRenderCurrentMerit(indId, rnd) {
  const tbody = document.getElementById('currentTableBody');
  const metaEl = document.getElementById('currentMeta');
  const filters = document.getElementById('curFilters');
  const caption = document.getElementById('currentCaption');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:40px;color:var(--text-muted);">Loading merit data…</td></tr>';

  try {
    const url = `inductions/${indId}/merit/round_${rnd}.json`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    
    const table = raw.Table?.[0] || {};
    const table5 = raw.Table5 || [];

    _currentState = { induction: indId, round: rnd, candidates: table5, meta: table };

    // Meta stats
    const accepted = table5.filter(c => c.consent === 'Accepted').length;
    const rejected = table5.filter(c => c.consent === 'Rejected').length;
    const notAvail = table5.filter(c => c.consent === 'Not Avail').length;

    metaEl.classList.remove('hidden');
    metaEl.innerHTML = `
      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: var(--spacing-sm); text-align:center;">
        <div><div style="font-size:11px; color:var(--text-muted); text-transform:uppercase;">Induction</div><div style="font-size:15px; font-weight:700;">${formatInductionLabel(indId)}</div></div>
        <div><div style="font-size:11px; color:var(--text-muted); text-transform:uppercase;">Round</div><div style="font-size:15px; font-weight:700;">Round ${rnd}</div></div>
        <div><div style="font-size:11px; color:var(--text-muted); text-transform:uppercase;">Total Candidates</div><div style="font-size:15px; font-weight:700;">${table5.length.toLocaleString()}</div></div>
        <div><div style="font-size:11px; color:var(--color-safe); text-transform:uppercase;">✓ Accepted</div><div style="font-size:15px; font-weight:700; color:var(--color-safe);">${accepted.toLocaleString()}</div></div>
        <div><div style="font-size:11px; color:var(--color-reach); text-transform:uppercase;">✗ Rejected</div><div style="font-size:15px; font-weight:700; color:var(--color-reach);">${rejected.toLocaleString()}</div></div>
        <div><div style="font-size:11px; color:var(--color-target); text-transform:uppercase;">⚠ Not Avail</div><div style="font-size:15px; font-weight:700; color:var(--color-target);">${notAvail.toLocaleString()}</div></div>
      </div>
      <div style="border-top:1px dashed var(--border-default); padding-top:var(--spacing-sm); margin-top:var(--spacing-sm); font-size:12px; color:var(--text-tertiary); display:flex; justify-content:space-between; flex-wrap:wrap;">
        <span>${esc(raw.Table?.[0]?.displayName || '')}</span>
        <span>${esc(raw.Table?.[0]?.status || '')}</span>
      </div>
    `;

    const programs = [...new Set(table5.map(c => c.type).filter(Boolean))].sort();
    const quotas = [...new Set(table5.map(c => c.quota).filter(Boolean))].sort();
    populateSelect(document.getElementById('curProgram'), programs);
    populateSelect(document.getElementById('curQuota'), quotas);
    filters.style.display = '';

    applyCurrentFilters();
  } catch (err) {
    console.error('[Merit Lists] Fetch Error:', err);
    _currentState = { induction: null, round: null, candidates: [], meta: null };
    metaEl.classList.add('hidden');
    filters.style.display = 'none';
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:40px;color:var(--color-reach);">Failed to load merit list: ${esc(err.message)}</td></tr>`;
    if (caption) caption.textContent = '';
  }
}

function applyCurrentFilters() {
  const tbody = document.getElementById('currentTableBody');
  const caption = document.getElementById('currentCaption');
  if (!tbody) return;

  const prog = document.getElementById('curProgram')?.value || '';
  const quota = document.getElementById('curQuota')?.value || '';
  const q = (document.getElementById('curSearch')?.value || '').toLowerCase().trim();

  const filtered = _currentState.candidates.filter(c => {
    if (prog && c.type !== prog) return false;
    if (quota && c.quota !== quota) return false;
    if (q && !c.nameFull?.toLowerCase().includes(q) && !c.pmdcNo?.toLowerCase().includes(q) &&
             !c.specialityName?.toLowerCase().includes(q) && !c.hospitalName?.toLowerCase().includes(q)) return false;
    return true;
  });

  if (caption) {
    caption.textContent = `Showing ${filtered.length.toLocaleString()} of ${_currentState.candidates.length.toLocaleString()} entries`;
  }

  const visible = filtered.slice(0, 300);
  if (!visible.length) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:40px;color:var(--text-tertiary);">No candidates match your filter query.</td></tr>';
    return;
  }

  tbody.innerHTML = visible.map((c, i) => {
    const consent = c.consent === 'Accepted'
      ? `<span class="badge badge-success">Accepted</span>`
      : c.consent === 'Rejected'
        ? `<span class="badge badge-danger">Rejected</span>`
        : c.consent === 'Not Avail'
          ? `<span class="badge badge-warning">Not Avail</span>`
          : esc(c.consent);

    return `
      <tr>
        <td><span class="num">${c.meritNo ?? (i + 1)}</span></td>
        <td style="font-weight:600;">${esc(c.nameFull)}</td>
        <td><span class="num">${esc(c.pmdcNo)}</span></td>
        <td>${esc(c.specialityName)}</td>
        <td style="font-size:13px; color:var(--text-secondary); max-width:250px; overflow:hidden; text-overflow:ellipsis;" title="${esc(c.hospitalName)}">${esc(c.hospitalName)}</td>
        <td>${esc(c.type)}</td>
        <td>${esc(c.quota)}</td>
        <td><span class="num">${num(c.marks, 2)}</span></td>
        <td><span class="num">${c.preferenceNo ?? '—'}</span></td>
        <td>${consent}</td>
      </tr>
    `;
  }).join('');

  if (filtered.length > 300) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="10" style="text-align:center; color:var(--text-tertiary); font-size:12px; padding:var(--spacing-md);">
      Truncated to first 300 records. Refine search criteria to locate specific candidates.
    </td>`;
    tbody.appendChild(tr);
  }
}

// ═══════════════════════════════════════════════════════
// VIEW 7: MEDICAL JOBS
// ═══════════════════════════════════════════════════════

var JOBS = {
  COLLECTION: 'jobs',
  SNAPSHOT_URL: 'data/jobs.json',
  list: [],
  meta: null,
  filters: { vacancy: '', organization: '', city: '', status: 'all', search: '', onlyWithVacancies: false }
};

function renderJobs(container) {
  if (!container) return;

  container.innerHTML = `
    <div class="section-header">
      <h2>Medical Jobs</h2>
      <p>Search active employment postings for medical practitioners and residency graduates in Punjab.</p>
    </div>

    <div id="jobsStatsRow" class="card" style="margin-bottom: var(--spacing-lg); display: none;"></div>

    <div class="jobs-toolbar">
      <div class="mt-filters">
        <select id="jobsVacancySel" class="select" aria-label="Vacancy"><option value="">All roles</option></select>
        <select id="jobsOrgSel" class="select" aria-label="Organization"><option value="">All organizations</option></select>
        <select id="jobsCitySel" class="select" aria-label="City"><option value="">All cities</option></select>
        <select id="jobsStatusSel" class="select" aria-label="Status">
          <option value="all">All statuses</option>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
          <option value="unknown">Deadline N/A</option>
        </select>
        <input type="text" id="jobsSearch" class="input" placeholder="Search title, organization, location…" aria-label="Search jobs">
      </div>
      <div class="jobs-toolbar-aux">
        <label class="jobs-toggle"><input type="checkbox" id="jobsOnlyVacChk"> <span>Only with listed vacancies</span></label>
        <span class="badge badge-info" id="jobsCount">…</span>
      </div>
    </div>

    <div class="jobs-grid" id="jobsGrid">
      <div class="jobs-empty" style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-muted);">Loading jobs data…</div>
    </div>

    <!-- Modal Dialog for Job Details -->
    <div id="jobDetailModal" class="overlay hidden">
      <div class="auth-card" style="max-width: 600px; text-align: left; max-height: 85dvh; overflow-y: auto;">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-default); padding-bottom: var(--spacing-md); margin-bottom: var(--spacing-md);">
          <h3 style="font-size: 18px;">Job Listing Details</h3>
          <button id="jobDetailClose" class="btn btn-ghost" style="padding: 4px; font-size: 20px;"><i class="ph ph-x"></i></button>
        </div>
        <div id="jobDetailBody"></div>
      </div>
    </div>
  `;

  // Bind filters
  const vacSel = document.getElementById('jobsVacancySel');
  const orgSel = document.getElementById('jobsOrgSel');
  const citySel = document.getElementById('jobsCitySel');
  const statusSel = document.getElementById('jobsStatusSel');
  const searchInp = document.getElementById('jobsSearch');
  const onlyVacChk = document.getElementById('jobsOnlyVacChk');
  const detailClose = document.getElementById('jobDetailClose');

  if (vacSel) {
    vacSel.addEventListener('change', () => { JOBS.filters.vacancy = vacSel.value; applyJobsFilters(); });
    orgSel.addEventListener('change', () => { JOBS.filters.organization = orgSel.value; applyJobsFilters(); });
    citySel.addEventListener('change', () => { JOBS.filters.city = citySel.value; applyJobsFilters(); });
    statusSel.addEventListener('change', () => { JOBS.filters.status = statusSel.value; applyJobsFilters(); });
    searchInp.addEventListener('input', () => { JOBS.filters.search = searchInp.value; applyJobsFilters(); });
    onlyVacChk.addEventListener('change', () => { JOBS.filters.onlyWithVacancies = onlyVacChk.checked; applyJobsFilters(); });
  }

  if (detailClose) {
    detailClose.addEventListener('click', () => {
      document.getElementById('jobDetailModal')?.classList.add('hidden');
    });
  }

  loadJobsFromSnapshot();
  showDailyVerse();
}

async function loadJobsFromSnapshot() {
  try {
    const res = await fetch(JOBS.SNAPSHOT_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    JOBS.list = data.records || [];
    JOBS.meta = data.meta || { count: JOBS.list.length, lastSyncAt: new Date().toISOString() };

    populateJobsFilters();
    renderJobsStats();
    applyJobsFilters();
  } catch (err) {
    console.error('[Jobs] Load failure:', err);
    const grid = document.getElementById('jobsGrid');
    if (grid) grid.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:40px; color:var(--color-reach);">Failed to load jobs feed. Verify data/jobs.json.</div>`;
  }
}

function populateJobsFilters() {
  const vacs = new Set();
  const orgs = new Set();
  const cities = new Set();

  JOBS.list.forEach(j => {
    (j.vacancies || []).forEach(v => vacs.add(v));
    if (j.organization) orgs.add(j.organization);
    
    // Extract city
    if (j.location) {
      const city = j.location.split(',')[0].trim();
      if (city) cities.add(city);
    }
  });

  populateSelect(document.getElementById('jobsVacancySel'), [...vacs].sort());
  populateSelect(document.getElementById('jobsOrgSel'), [...orgs].sort());
  populateSelect(document.getElementById('jobsCitySel'), [...cities].sort());
}

function renderJobsStats() {
  const statsEl = document.getElementById('jobsStatsRow');
  if (!statsEl || !JOBS.meta) return;

  const syncTime = JOBS.meta.lastSyncAt ? new Date(JOBS.meta.lastSyncAt).toLocaleString() : '—';
  statsEl.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; font-size:12px; color:var(--text-secondary); padding: var(--spacing-sm) var(--spacing-md);">
      <span>Live Jobs Feed · Last Synced: <strong>${syncTime}</strong></span>
      <span>Total Records: <strong>${JOBS.meta.count || JOBS.list.length}</strong></span>
    </div>
  `;
  statsEl.style.display = 'block';
}

function applyJobsFilters() {
  const grid = document.getElementById('jobsGrid');
  const countEl = document.getElementById('jobsCount');
  if (!grid) return;

  const f = JOBS.filters;
  let filtered = JOBS.list.filter(j => {
    if (f.vacancy && !(j.vacancies || []).includes(f.vacancy)) return false;
    if (f.organization && j.organization !== f.organization) return false;
    
    const city = j.location ? j.location.split(',')[0].trim() : '';
    if (f.city && city !== f.city) return false;
    
    if (f.onlyWithVacancies && !(j.vacancies && j.vacancies.length)) return false;
    
    // Status check
    const isOpen = j.expectedLastDateISO ? new Date(j.expectedLastDateISO) >= new Date() : null;
    if (f.status === 'open' && isOpen === false) return false;
    if (f.status === 'closed' && isOpen !== false) return false;
    if (f.status === 'unknown' && isOpen !== null) return false;

    if (f.search) {
      const q = f.search.toLowerCase();
      const match = (j.title || '').toLowerCase().includes(q) ||
                    (j.organization || '').toLowerCase().includes(q) ||
                    (j.location || '').toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });

  if (countEl) countEl.textContent = `${filtered.length} Jobs`;

  if (!filtered.length) {
    grid.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:40px; color:var(--text-tertiary);">No jobs found matching your search.</div>`;
    return;
  }

  grid.innerHTML = filtered.map((j, i) => {
    const city = j.location ? j.location.split(',')[0].trim() : 'Punjab';
    const isUrgent = j.expectedLastDateISO && (new Date(j.expectedLastDateISO) - new Date() < 3 * 24 * 60 * 60 * 1000);
    const deadlineClass = isUrgent ? 'urgent' : '';
    const dateLabel = j.expectedLastDateISO ? `Apply by: ${new Date(j.expectedLastDateISO).toLocaleDateString()}` : 'Deadline N/A';
    
    return `
      <div class="card job-card" data-idx="${i}">
        <div class="job-card-header">
          <div>
            <div class="job-title">${esc(j.title)}</div>
            <div class="job-org">${esc(j.organization)}</div>
          </div>
          <span class="badge ${j.isOpen ? 'badge-success' : 'badge-danger'}">${j.isOpen ? 'OPEN' : 'CLOSED'}</span>
        </div>
        <div style="font-size:12px; color:var(--text-tertiary); display:flex; gap: var(--spacing-sm); flex-wrap:wrap;">
          <span><i class="ph ph-map-pin" style="vertical-align: middle; margin-right: 4px;"></i>${esc(city)}</span>
          <span><i class="ph ph-newspaper" style="vertical-align: middle; margin-right: 4px;"></i>${esc(j.newspaper || 'Online')}</span>
        </div>
        <div class="job-footer">
          <span class="job-deadline ${deadlineClass}">${dateLabel}</span>
          <button class="btn btn-secondary" style="padding: 4px 10px; font-size:12px;" onclick="viewJobDetail(${i})">View Details</button>
        </div>
      </div>
    `;
  }).join('');
}

window.viewJobDetail = function(idx) {
  const job = JOBS.list[idx];
  if (!job) return;

  const modal = document.getElementById('jobDetailModal');
  const body = document.getElementById('jobDetailBody');
  if (!modal || !body) return;

  body.innerHTML = `
    <div style="display:flex; flex-direction:column; gap: var(--spacing-md);">
      <div>
        <h2 style="font-size: 20px; color:var(--brand-primary);">${esc(job.title)}</h2>
        <p style="font-size: 14px; font-weight:600; color:var(--text-primary);">${esc(job.organization)}</p>
        <p style="font-size: 12px; color:var(--text-tertiary);"><i class="ph ph-map-pin" style="vertical-align: middle; margin-right: 4px;"></i>${esc(job.location)}</p>
      </div>

      <div style="border-top:1px solid var(--border-default); border-bottom:1px solid var(--border-default); padding: var(--spacing-md) 0; display:grid; grid-template-columns:1fr 1fr; gap:var(--spacing-sm); font-size:13px;">
        <div>Newspaper: <strong>${esc(job.newspaper || '—')}</strong></div>
        <div>Date Posted: <strong>${job.datePosted || '—'}</strong></div>
        <div>Last Date: <strong style="${job.expectedLastDateISO ? 'color:var(--brand-primary);' : ''}">${job.expectedLastDateISO || 'N/A'}</strong></div>
        <div>Sector: <strong>${esc(job.category || '—')}</strong></div>
      </div>

      <div>
        <h4 style="font-size: 13px; text-transform:uppercase; color:var(--text-muted); margin-bottom: 4px;">Listed Vacancies</h4>
        <div style="display:flex; flex-wrap:wrap; gap: var(--spacing-xs);">
          ${(job.vacancies || []).map(v => `<span class="badge badge-info">${esc(v)}</span>`).join('') || '<span style="color:var(--text-tertiary); font-size:13px;">No explicit roles listed</span>'}
        </div>
      </div>

      ${job.image ? `
        <div style="margin-top:var(--spacing-md); text-align:center;">
          <a href="${job.image}" target="_blank" class="btn btn-secondary" style="width:100%;">
            <i class="ph ph-image" style="vertical-align: middle; margin-right: 6px;"></i>View Advertisement Image
          </a>
        </div>
      ` : ''}
    </div>
  `;

  modal.classList.remove('hidden');
};

// ═══════════════════════════════════════════════════════
// VIEW 8: SCORING POLICY HISTORY
// ═══════════════════════════════════════════════════════

function renderPolicy(container) {
  if (!container) return;

  container.innerHTML = `
    <div class="section-header">
      <h2>Scoring Policy History</h2>
      <p>How the PRP formula has evolved over cycles. convert actual raw merits to normalized scores for fair comparisons.</p>
    </div>

    <div class="card" style="margin-bottom: var(--spacing-xl);">
      <h3><i class="ph ph-percent" style="vertical-align: middle; margin-right: 6px;"></i>Normalization Formula</h3>
      <p>To enable historical comparison across cycles that had different total marks (e.g. 95 vs 100 max), MeritNama normalizes raw scores: </p>
      <div class="guide-formula">% of Max = (Closing Merit / Year's Maximum Marks) * 100</div>
    </div>

    <div class="card">
      <h3>Component Comparison Across Inductions</h3>
      <div class="table-wrap" style="margin-top: var(--spacing-md);">
        <table class="data-table" id="policyComparisonTable">
          <tbody><tr><td style="color:var(--text-muted); padding: 20px; text-align: center;">Loading policy configurations…</td></tr></tbody>
        </table>
      </div>
    </div>

    <div id="policyTimeline" class="policy-timeline" style="margin-top: var(--spacing-xl); display: flex; flex-direction: column; gap: var(--spacing-lg);"></div>
  `;

  renderPolicyComparisonTable();
  renderPolicyTimeline();
  showDailyVerse();
}

function renderPolicyComparisonTable() {
  const table = document.getElementById('policyComparisonTable');
  const sp = App.data.scoringPolicy;
  if (!table || !sp?.policies) return;

  const years = Object.keys(sp.policies).sort((a, b) => Number(a) - Number(b));
  
  // Unique components list
  const componentsSet = new Set();
  years.forEach(y => {
    (sp.policies[y].components || []).forEach(c => componentsSet.add(c.label));
  });
  const componentsList = [...componentsSet].sort();

  const header = `<tr><th>Component</th>${years.map(y => `<th>${formatInductionLabel(y)}</th>`).join('')}</tr>`;

  const rows = componentsList.map(compName => {
    const yrCells = years.map(y => {
      const pol = sp.policies[y];
      const comp = (pol.components || []).find(c => c.label === compName);
      if (!comp || comp.included === false) return '<td style="color:var(--text-tertiary);">—</td>';
      return `<td class="num" style="font-weight:600;">${comp.max_marks} pts</td>`;
    }).join('');
    return `<tr><td><strong>${esc(compName)}</strong></td>${yrCells}</tr>`;
  }).join('');

  // Total marks row
  const totalsRow = `<tr style="border-top: 2px solid var(--border-default); background-color: var(--surface-secondary);">
    <td><strong>TOTAL MAXIMUM MARKS</strong></td>
    ${years.map(y => `<td class="num" style="font-weight:700; color:var(--brand-primary);">${sp.policies[y].total_marks || 100} pts</td>`).join('')}
  </tr>`;

  table.innerHTML = `
    <thead>${header}</thead>
    <tbody>${rows}${totalsRow}</tbody>
  `;
}

function renderPolicyTimeline() {
  const timeline = document.getElementById('policyTimeline');
  const sp = App.data.scoringPolicy;
  if (!timeline || !sp?.policies) return;

  const years = Object.keys(sp.policies).sort((a, b) => Number(b) - Number(a)); // Descending order

  timeline.innerHTML = years.map(y => {
    const pol = sp.policies[y];
    const componentsHtml = (pol.components || [])
      .filter(c => c.included !== false)
      .map(c => `
        <div style="display:flex; justify-content:space-between; font-size:12px; padding:2px 0;">
          <span style="color:var(--text-secondary);">${esc(c.label)}</span>
          <span style="font-family:var(--font-mono); font-weight:600;">${c.max_marks} pts</span>
        </div>
      `).join('');

    return `
      <div class="card" style="padding: var(--spacing-lg);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: var(--spacing-sm); border-bottom:1px solid var(--border-default); padding-bottom:var(--spacing-xs);">
          <h3 style="font-size:16px;">${esc(pol.label || y)}</h3>
          <span class="badge badge-info" style="font-size:12px;">${pol.total_marks || 100} Marks Max</span>
        </div>
        ${pol.notes ? `<p style="font-size:12.5px; color:var(--text-tertiary); font-style:italic; margin-bottom:var(--spacing-md);">${esc(pol.notes)}</p>` : ''}
        <div style="display:grid; grid-template-columns:1fr; gap:2px;">
          ${componentsHtml}
        </div>
      </div>
    `;
  }).join('');
}

// ═══════════════════════════════════════════════════════
// VIEW 9: HOW TO USE (GUIDE)
// ═══════════════════════════════════════════════════════

function renderGuide(container) {
  if (!container) return;

  container.innerHTML = `
    <div class="section-header">
      <h2>How to Use MeritNama</h2>
      <p>A complete reference guidelines for trainees to analyze and calculate residency admission merits.</p>
    </div>

    <div class="guide-quickstart">
      <div class="guide-step">
        <div class="guide-step-num">1</div>
        <div class="guide-step-body">
          <h3>Calculate Score</h3>
          <p>Navigate to <strong>Calculator</strong>, enter MBBS aggregates, attempt deductions, experience, and certifications. Save to sync with predictor.</p>
        </div>
      </div>
      <div class="guide-step">
        <div class="guide-step-num">2</div>
        <div class="guide-step-body">
          <h3>Analyze Standings</h3>
          <p>Go to <strong>My Prediction</strong> to view your percentile ranking and Safe/Target/Reach outcomes grouped against 5+ cycles.</p>
        </div>
      </div>
      <div class="guide-step">
        <div class="guide-step-num">3</div>
        <div class="guide-step-body">
          <h3>Browse Matrix</h3>
          <p>Filter programs and quotas in the <strong>Merit Table</strong>. Drill into hospital cutoffs by clicking rows to reveal trend charts.</p>
        </div>
      </div>
    </div>

    <h2 class="guide-section-title"><i class="ph ph-book-open" style="vertical-align: middle; margin-right: 6px;"></i>Glossary of Terms</h2>
    <div class="guide-glossary">
      <div class="guide-term">
        <div class="guide-term-header">
          <span class="guide-term-name">% of Max</span>
          <span class="guide-term-tag">Normalization</span>
        </div>
        <div class="guide-term-body">
          <p>Since PHF formula changes marks scales across inductions (e.g. 95 vs 100), raw merits cannot be compared directly.</p>
          <div class="guide-formula">% of Max = (Closing Merit / Year's Maximum Marks) * 100</div>
          <p>MeritNama uses % of Max as the standard metric to ensure comparisons and trends remain mathematically valid.</p>
        </div>
      </div>

      <div class="guide-term">
        <div class="guide-term-header">
          <span class="guide-term-name">Closing Merit (Cutoff)</span>
          <span class="guide-term-tag">Admission Data</span>
        </div>
        <div class="guide-term-body">
          <p>The score of the last candidate admitted to a specific hospital program. Securing a merit score equal to or exceeding this cutoff is generally required.</p>
        </div>
      </div>

      <div class="guide-term">
        <div class="guide-term-header">
          <span class="guide-term-name">Percentile Rank</span>
          <span class="guide-term-tag">Statistical Position</span>
        </div>
        <div class="guide-term-body">
          <p>Indicates the percentage of program-hospital combinations that close at merits below your score. 80th percentile indicates your score is higher than 80% of historical cutoffs.</p>
        </div>
      </div>
    </div>

    <h2 class="guide-section-title"><i class="ph ph-question" style="vertical-align: middle; margin-right: 6px;"></i>Frequently Asked Questions</h2>
    <div class="guide-faq">
      <details class="guide-faq-item" open>
        <summary>Are these predictions accurate?</summary>
        <p>Predictions are modeled entirely on historical induction cutoffs. Real outcomes fluctuate based on candidate options, slot count additions, and changes in applicants' aggregate mix.</p>
      </details>
      <details class="guide-faq-item">
        <summary>How can I trust the calculations?</summary>
        <p>Calculator fields translate official PHF gazette rules. Always verify raw inputs and computations with PHF/PGMI induction notifications before submitting official applications.</p>
      </details>
    </div>

    <div class="guide-warning" style="margin-top: var(--spacing-xl);">
      <strong>Disclaimer:</strong> MeritNama is an independent community project. It is not affiliated with PGMI, CPSP, PHF, or health departments. Verify information independently.
    </div>
  `;
  showDailyVerse();
}

// ═══════════════════════════════════════════════════════
// VIEW 10: CPSP ACCREDITATION DIRECTORY
// ═══════════════════════════════════════════════════════

let ALL_ACC_ROWS = [];

async function renderAccreditation(container) {
  if (!container) return;

  container.innerHTML = `
    <div class="section-header">
      <h2>CPSP Accredited Programs</h2>
      <p>Search FCPS specialty accreditation states across various hospitals in Punjab, updated from RTMC sources.</p>
    </div>

    <!-- Stats -->
    <div class="pred-hero" id="statsBar" style="margin-bottom: var(--spacing-xl);">
      <div class="pred-hero-stats" style="width:100%; justify-content:space-around;">
        <div class="pred-hero-stat"><div class="pred-hero-val" id="statTotal">—</div><div class="pred-hero-lbl">Accredited Programs</div></div>
        <div class="pred-hero-stat"><div class="pred-hero-val" id="statHospitals">—</div><div class="pred-hero-lbl">Hospitals</div></div>
        <div class="pred-hero-stat"><div class="pred-hero-val" id="statCities">—</div><div class="pred-hero-lbl">Cities</div></div>
        <div class="pred-hero-stat"><div class="pred-hero-val" id="statSpecs">—</div><div class="pred-hero-lbl">Specialties</div></div>
      </div>
    </div>

    <!-- Filters -->
    <div class="card" id="filterBar" style="margin-bottom: var(--spacing-lg);">
      <div class="input-grid">
        <div class="form-group">
          <label for="fHospital">Hospital / Institute</label>
          <input type="text" id="fHospital" class="input" placeholder="Search hospital name…" autocomplete="off">
        </div>
        <div class="form-group">
          <label for="fCity">City</label>
          <select id="fCity" class="select"><option value="">All Cities</option></select>
        </div>
        <div class="form-group">
          <label for="fSpec">Speciality</label>
          <select id="fSpec" class="select"><option value="">All Specialities</option></select>
        </div>
      </div>
      <button class="btn btn-secondary" id="resetBtn" style="margin-top: var(--spacing-md);">Reset Filters</button>
    </div>

    <div id="loadMsg" style="text-align:center; padding:40px; color:var(--text-muted);">Loading accreditation data…</div>

    <div class="table-caption" id="resultInfo" style="display:none; margin-bottom: var(--spacing-sm);"></div>

    <div class="table-wrap" id="tableWrap" style="display:none;">
      <table class="data-table" id="accTable">
        <thead>
          <tr>
            <th>Hospital / Institute</th>
            <th>City</th>
            <th>Speciality</th>
            <th>Unit</th>
            <th>Accreditation Type</th>
            <th>Since</th>
          </tr>
        </thead>
        <tbody id="tableBody"></tbody>
      </table>
    </div>

    <div class="guide-warning" style="margin-top: var(--spacing-xl);">
      <strong>Source Note:</strong> Sourced from CPSP Accredited Institutes directory. Verify details directly on the CPSP portal before shortlisting options.
    </div>
  `;

  // Bind elements
  const hospInput = document.getElementById('fHospital');
  const citySel = document.getElementById('fCity');
  const specSel = document.getElementById('fSpec');
  const resetBtn = document.getElementById('resetBtn');

  if (hospInput) {
    hospInput.addEventListener('input', applyAccFilters);
    citySel.addEventListener('change', applyAccFilters);
    specSel.addEventListener('change', applyAccFilters);
    resetBtn.addEventListener('click', () => {
      hospInput.value = '';
      citySel.value = '';
      specSel.value = '';
      applyAccFilters();
    });
  }

  await loadAccreditationData();
  showDailyVerse();
}

async function loadAccreditationData() {
  const loadEl = document.getElementById('loadMsg');
  const statsBar = document.getElementById('statsBar');
  const filterBar = document.getElementById('filterBar');
  const tableWrap = document.getElementById('tableWrap');
  const resultInfo = document.getElementById('resultInfo');

  if (ALL_ACC_ROWS.length > 0) {
    if (loadEl) loadEl.style.display = 'none';
    if (statsBar) statsBar.style.display = 'flex';
    if (filterBar) filterBar.style.display = 'block';
    if (tableWrap) tableWrap.style.display = 'block';
    if (resultInfo) resultInfo.style.display = 'block';
    populateAccFilters();
    updateAccStats();
    applyAccFilters();
    return;
  }

  try {
    const data = await fetchJSON('cpsp_accreditation.json', 'accreditation matrix');
    
    // Flatten structure
    ALL_ACC_ROWS = [];
    data.forEach(h => {
      (h.programs || []).forEach(p => {
        ALL_ACC_ROWS.push({
          hospital: h.hospital,
          city: h.city,
          speciality: p.speciality,
          unit: p.unit,
          accType: p.type,
          since: p.since
        });
      });
    });

    if (loadEl) loadEl.style.display = 'none';
    if (statsBar) statsBar.style.display = 'flex';
    if (filterBar) filterBar.style.display = 'block';
    if (tableWrap) tableWrap.style.display = 'block';
    if (resultInfo) resultInfo.style.display = 'block';

    populateAccFilters();
    updateAccStats();
    applyAccFilters();

  } catch (err) {
    console.error('[Accreditation] Load Error:', err);
    if (loadEl) loadEl.innerHTML = `<span style="color:var(--color-reach);">Failed to load accreditation matrix. Ensure data/cpsp_accreditation.json exists.</span>`;
  }
}

function populateAccFilters() {
  const cities = [...new Set(ALL_ACC_ROWS.map(r => r.city).filter(Boolean))].sort();
  const specialties = [...new Set(ALL_ACC_ROWS.map(r => r.speciality).filter(Boolean))].sort();

  populateSelect(document.getElementById('fCity'), cities, 'All Cities');
  populateSelect(document.getElementById('fSpec'), specialties, 'All Specialities');
}

function updateAccStats() {
  const statTotal = document.getElementById('statTotal');
  const statHospitals = document.getElementById('statHospitals');
  const statCities = document.getElementById('statCities');
  const statSpecs = document.getElementById('statSpecs');

  if (statTotal) statTotal.textContent = ALL_ACC_ROWS.length.toLocaleString();
  if (statHospitals) statHospitals.textContent = new Set(ALL_ACC_ROWS.map(r => r.hospital)).size.toLocaleString();
  if (statCities) statCities.textContent = new Set(ALL_ACC_ROWS.map(r => r.city).filter(Boolean)).size.toLocaleString();
  if (statSpecs) statSpecs.textContent = new Set(ALL_ACC_ROWS.map(r => r.speciality)).size.toLocaleString();
}

function applyAccFilters() {
  const hospInput = document.getElementById('fHospital');
  const citySel = document.getElementById('fCity');
  const specSel = document.getElementById('fSpec');
  
  if (!hospInput) return;

  const hosp = hospInput.value.toLowerCase().trim();
  const city = citySel.value;
  const spec = specSel.value;

  const filtered = ALL_ACC_ROWS.filter(r => {
    if (hosp && !r.hospital.toLowerCase().includes(hosp)) return false;
    if (city && r.city !== city) return false;
    if (spec && r.speciality !== spec) return false;
    return true;
  });

  renderAccTable(filtered);
}

function renderAccTable(rows) {
  const tbody = document.getElementById('tableBody');
  const info = document.getElementById('resultInfo');
  
  if (info) {
    info.textContent = `Showing ${rows.length.toLocaleString()} of ${ALL_ACC_ROWS.length.toLocaleString()} accredited programs`;
  }
  if (!tbody) return;

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text-tertiary)">No matching programs found.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.slice(0, 300).map(r => {
    const accTypeBadge = r.accType
      ? `<span class="badge ${r.accType.toUpperCase().includes('F.A') ? 'badge-success' : 'badge-info'}">${esc(r.accType)}</span>`
      : '—';

    return `
      <tr>
        <td style="font-weight:600;">${esc(r.hospital)}</td>
        <td style="font-size:13px; color:var(--text-secondary);">${esc(r.city)}</td>
        <td>${esc(r.speciality)}</td>
        <td style="font-size:13px; color:var(--text-tertiary);">${esc(r.unit)}</td>
        <td>${accTypeBadge}</td>
        <td><span class="num">${esc(r.since)}</span></td>
      </tr>
    `;
  }).join('');

  if (rows.length > 300) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="6" style="text-align:center; color:var(--text-tertiary); font-size:12px; padding:var(--spacing-md);">
      Truncated to first 300 records. Refine search filters to narrow down results.
    </td>`;
    tbody.appendChild(tr);
  }
}

// Bootstrapper on document ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
