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
  },
};

// ═══════════════════════════════════════════════════════
// DATA LOADING
// ═══════════════════════════════════════════════════════

async function fetchJSON(file, label) {
  setLoadingDetail(`Loading ${label}…`);
  const res = await fetch(DATA_BASE + file);
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

    App.data.flatLookup       = flatLookup;
    App.data.trends           = trends;
    App.data.specialtyRanking = specialtyRanking;
    App.data.scoringPolicy    = scoringPolicy;

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

function predictOptions(userMerit, program = '', quota = '', yearRef = 'latest') {
  if (isNaN(userMerit)) return [];

  const results = App.data.flatLookup
    .filter(r =>
      (!program || r.program === program) &&
      (!quota   || r.quota   === quota)
    )
    .map(row => {
      const cm = yearRef === 'latest'
        ? row.latest_merit
        : (row.yearly_merit?.[String(yearRef)] ?? row.latest_merit);

      if (cm == null) return null;
      const outcome = classifyOutcome(userMerit, cm);
      return {
        ...row,
        used_closing_merit: cm,
        outcome,
        delta: userMerit - cm,
      };
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
// INIT / DATA READY
// ═══════════════════════════════════════════════════════

function onDataReady() {
  populateAllFilters();
  setupTabNavigation();
  setupPredictorTab();
  setupSpecialtyTab();
  setupHospitalTab();
  setupTrendsTab();
  setupRankingsTab();
  setupStrategyTab();
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
  if (tab === 'specialty') renderSpecialtyGrid();
  if (tab === 'hospital')  renderHospitalGrid();
  if (tab === 'rankings')  renderRankingsTab();
  if (tab === 'trends')    renderTrendsTab();
  if (tab === 'tools')     renderShortlist();
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
  modal.classList.remove('hidden');

  function dismiss() {
    modal.classList.add('hidden');
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

  const results = predictOptions(merit, prog, quota, yearV === 'latest' ? 'latest' : Number(yearV));
  App.ui.predictorResults = results;

  // Compute percentile from all closing merits in scope
  const allMerits = results.map(r => r.used_closing_merit).filter(v => v != null);
  const pct = getPercentile(merit, allMerits);
  const band = getMeritBand(merit, allMerits);

  const likely     = results.filter(r => r.outcome === 'likely').length;
  const borderline = results.filter(r => r.outcome === 'borderline').length;

  // Show insights
  document.getElementById('insightsBanner').classList.remove('hidden');
  document.getElementById('insightPctVal').textContent      = `${pct}th`;
  document.getElementById('insightBandVal').textContent     = `${band.emoji} ${band.label}`;
  document.getElementById('insightLikelyVal').textContent   = likely;
  document.getElementById('insightBorderlineVal').textContent = borderline;

  // Policy notice
  const refYear = yearV === 'latest' ? getLatestYear() : Number(yearV);
  const policy  = App.data.scoringPolicy?.[refYear];
  if (policy) {
    document.getElementById('policyNotice').classList.remove('hidden');
    document.getElementById('policyText').textContent =
      `Year ${refYear} scoring: ${policy.description}. ${policy.notes}`;
  } else {
    document.getElementById('policyNotice').classList.add('hidden');
  }

  document.getElementById('predictorResults').classList.remove('hidden');
  renderPredictorTable();

  // Draw merit distribution chart
  Charts.drawDistributionChart(allMerits, merit);

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
        <td><strong>${num(r.used_closing_merit)}</strong></td>
        <td>${num(r.avg_closing_merit)}</td>
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
    document.getElementById('specialtyModal').classList.add('hidden');
  });
  document.getElementById('specModalOverlay').addEventListener('click', () => {
    document.getElementById('specialtyModal').classList.add('hidden');
  });
}

function renderSpecialtyGrid() {
  const program = document.getElementById('specProgram').value;
  const quota   = document.getElementById('specQuota').value;
  const search  = document.getElementById('specSearch').value.toLowerCase().trim();

  // Build specialty aggregate from ranking data
  const entries = [];
  for (const [prog, quotas] of Object.entries(App.data.specialtyRanking)) {
    if (program && prog !== program) continue;
    for (const [q, specs] of Object.entries(quotas)) {
      if (quota && q !== quota) continue;
      for (const [spec, data] of Object.entries(specs)) {
        if (search && !spec.toLowerCase().includes(search)) continue;
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

  grid.innerHTML = entries.map(e => `
    <div class="spec-card"
         data-program="${esc(e.program)}"
         data-quota="${esc(e.quota)}"
         data-specialty="${esc(e.specialty)}"
         tabindex="0"
         role="button"
         aria-label="View ${esc(e.specialty)} details">
      <h4>${esc(e.specialty)}</h4>
      <div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:8px">${esc(e.program)} · ${esc(e.quota)}</div>
      ${compBadge(e.competitiveness)}
      <div class="card-meta">
        <div class="card-stat">
          <span class="card-stat-label">Avg Merit</span>
          <span class="card-stat-value">${num(e.avg_closing_merit)}</span>
        </div>
        <div class="card-stat">
          <span class="card-stat-label">Latest Avg</span>
          <span class="card-stat-value">${num(e.latest_avg_closing)}</span>
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
  `).join('');

  grid.querySelectorAll('.spec-card').forEach(card => {
    const open = () => openSpecialtyModal(
      card.dataset.program, card.dataset.quota, card.dataset.specialty
    );
    card.addEventListener('click', open);
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') open(); });
  });
}

function openSpecialtyModal(program, quota, specialty) {
  const modal   = document.getElementById('specialtyModal');
  const title   = document.getElementById('specModalTitle');
  const stats   = document.getElementById('specModalStats');
  const tbody   = document.getElementById('specHospitalBody');

  title.textContent = `${specialty} — ${program} · ${quota}`;

  // Gather hospital rows for this specialty
  const hospitals = App.data.flatLookup.filter(r =>
    r.program === program && r.quota === quota && r.specialty === specialty
  );

  // Stats
  const avgMerit  = hospitals.reduce((s, r) => s + r.avg_closing_merit, 0) / hospitals.length;
  const latestAvg = hospitals.reduce((s, r) => s + r.latest_merit, 0) / hospitals.length;
  const totalSeats = hospitals.reduce((s, r) => {
    const ys = Object.values(r.yearly_seats || {});
    return s + (ys.length ? ys[ys.length - 1] : 0);
  }, 0);

  stats.innerHTML = `
    <div class="modal-stat"><div class="modal-stat-val">${hospitals.length}</div><div class="modal-stat-lbl">Hospitals</div></div>
    <div class="modal-stat"><div class="modal-stat-val">${num(avgMerit)}</div><div class="modal-stat-lbl">Avg Merit</div></div>
    <div class="modal-stat"><div class="modal-stat-val">${num(latestAvg)}</div><div class="modal-stat-lbl">Latest Avg</div></div>
    <div class="modal-stat"><div class="modal-stat-val">${totalSeats}</div><div class="modal-stat-lbl">Total Seats</div></div>
  `;

  // Table
  tbody.innerHTML = hospitals
    .sort((a, b) => b.avg_closing_merit - a.avg_closing_merit)
    .map(r => {
      const ys = r.yearly_seats || {};
      const latestSeatYr = Object.keys(ys).sort().pop();
      const latestSeats  = latestSeatYr ? ys[latestSeatYr] : '—';
      return `
        <tr>
          <td>${esc(r.hospital)}</td>
          <td><strong>${num(r.avg_closing_merit)}</strong></td>
          <td>${num(r.latest_merit)}</td>
          <td>${latestSeats}</td>
          <td>${trendBadge(r.trend)}</td>
          <td>${volBadge(r.volatility)}</td>
        </tr>
      `;
    }).join('');

  // Trend chart
  Charts.drawSpecTrendChart(hospitals, specialty);

  modal.classList.remove('hidden');
}

// ═══════════════════════════════════════════════════════
// HOSPITAL EXPLORER TAB
// ═══════════════════════════════════════════════════════

function setupHospitalTab() {
  document.getElementById('hospProgram').addEventListener('change', renderHospitalGrid);
  document.getElementById('hospSearch').addEventListener('input', renderHospitalGrid);

  document.getElementById('hospModalClose').addEventListener('click', () => {
    document.getElementById('hospitalModal').classList.add('hidden');
  });
  document.getElementById('hospModalOverlay').addEventListener('click', () => {
    document.getElementById('hospitalModal').classList.add('hidden');
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
    const avgMerit = data.rows.reduce((s, r) => s + r.avg_closing_merit, 0) / data.rows.length;
    const programs = [...new Set(data.rows.map(r => r.program))].join(', ');
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
            <span class="card-stat-label">Avg Merit</span>
            <span class="card-stat-value">${num(avgMerit)}</span>
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
  const rows = App.data.flatLookup.filter(r =>
    r.hospital === hospital && (!program || r.program === program)
  );

  document.getElementById('hospModalTitle').textContent = hospital;

  const tbody = document.getElementById('hospSpecBody');
  tbody.innerHTML = rows
    .sort((a, b) => b.avg_closing_merit - a.avg_closing_merit)
    .map(r => {
      const ys = r.yearly_seats || {};
      const latestSeatYr = Object.keys(ys).sort().pop();
      const latestSeats  = latestSeatYr ? ys[latestSeatYr] : '—';
      return `
        <tr>
          <td>${esc(r.specialty)}</td>
          <td>${esc(r.quota)}</td>
          <td><strong>${num(r.avg_closing_merit)}</strong></td>
          <td>${num(r.latest_merit)}</td>
          <td>${latestSeats}</td>
          <td>${trendBadge(r.trend)}</td>
        </tr>
      `;
    }).join('');

  // Chart
  Charts.drawHospSpecChart(rows, hospital);

  document.getElementById('hospitalModal').classList.remove('hidden');
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
    return;
  }

  note.textContent = rows.length === 1
    ? `Showing trend for ${rows[0].hospital}`
    : `Showing trends for ${rows.length} hospitals`;

  Charts.drawTrendLineChart(rows);
  Charts.drawVolatilityChart(rows.length > 0 ? rows : App.data.flatLookup.slice(0, 50));
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

  const results = predictOptions(merit, program, quota, 'latest');
  const allMerits = results.map(r => r.used_closing_merit).filter(Boolean);
  const band = getMeritBand(merit, allMerits);

  // Show band card
  const bandCard = document.getElementById('stratBandCard');
  document.getElementById('stratBandBadge').textContent = band.emoji;
  document.getElementById('stratBandBadge').className   = `band-badge ${band.cls}`;
  document.getElementById('stratBandTitle').textContent  = `${band.label} Merit`;
  document.getElementById('stratBandDesc').textContent   = band.desc;
  bandCard.classList.remove('hidden');

  // Categorize
  // Safe: user merit is clearly above closing (delta >= +1.5)
  // Moderate: delta between -2 and +1.5
  // Ambitious: delta between -5 and -2
  const safe      = results.filter(r => r.delta >= 1.5);
  const moderate  = results.filter(r => r.delta >= -2.0 && r.delta < 1.5);
  const ambitious = results.filter(r => r.delta >= -5.0 && r.delta < -2.0);

  safe.sort((a, b)      => b.delta - a.delta);
  moderate.sort((a, b)  => b.delta - a.delta);
  ambitious.sort((a, b) => b.delta - a.delta);

  function stratItems(arr) {
    if (arr.length === 0) return '<p style="color:var(--text-light);font-size:0.82rem;padding:8px">None in this category</p>';
    return arr.slice(0, 25).map(r => {
      const gapCls = r.delta >= 0 ? 'gap-positive' : r.delta >= -2 ? 'gap-small' : 'gap-negative';
      const gapStr = r.delta >= 0 ? `+${num(r.delta)}` : num(r.delta);
      return `
        <div class="strat-item">
          <div class="strat-item-specialty">${esc(r.specialty)}</div>
          <div class="strat-item-hospital">${esc(r.hospital)}</div>
          <div class="strat-item-meta">
            <span>Closing: ${num(r.used_closing_merit)}</span>
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

  // Strategy chart
  document.getElementById('stratChartCard').style.display = 'block';
  Charts.drawStrategyChart(merit, results.slice(0, 40));
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
  const TABS = ['predictor', 'specialty', 'hospital', 'trends', 'rankings', 'strategy', 'guide', 'tools'];
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
      document.querySelectorAll('.modal:not(.hidden)').forEach(m => m.classList.add('hidden'));
      document.getElementById('welcomeModal')?.classList.add('hidden');
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
