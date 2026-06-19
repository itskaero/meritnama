'use strict';
// simulation.js — Induction 21 live simulation for MeritNama
// Translates merit.py run_placement() faithfully into JavaScript.

// ═══════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════
const SIM = {
  candidates:   [],
  seats:        null,   // {PROG: {quota: {spec: {hosp: n}}}}  or null
  flatSeats:    [],     // raw flat array [{typeName, quotaName, specialityName, hospitalName, seats}]
  seatsLoaded:  false,
  myId:         null,   // applicantId string | null
  customCand:   null,   // manually-added candidate | null
  activeTab:    'guide',

  cand: {
    filter:   '',
    program:  '',
    sortKey:  'marksTotal',
    sortDir:  -1,
    page:     0,
    filtered: [],
  },

  sb: { program: '', quota: '', spec: '', hosp: '', candidateId: null, clickedCandId: null },
  notifications: [],

  sim: {
    program:     'FCPS',
    result:      null,
    running:     false,
    parentBonus: false,
    filter:      '',
    applicantReport: null,
  },

  marks: {
    options:        [],
    activeOptionId: 'adjusted',
    showSelector:   true,
    noticeTitle:    'About merit marks',
    candidateNotice:'',
    showNotice:     true,
  },

  schedule: {
    steps:     [],
    filter:    'all',
    search:    '',
    source:    '',
    updatedAt: null,
    loaded:    false,
    loading:   false,
    error:     null,
  },

  profileStatus: {
    byId:        {},
    types:       {},
    labels:      { '1': 'Accepted', '2': 'Rejected', '11': 'Pending' },
    typeLabel:   'Verification : Round 01',
    source:      '',
    updatedAt:   null,
    loaded:      false,
    loading:     false,
    filter:      '',
  },

  donor: {
    byEmail: new Map(),
    current: null,
    loaded: false,
  },
};

const MY_ID_KEY           = 'mn_sim_my_id';
const CUSTOM_KEY          = 'mn_sim_custom_cand';
const MARKS_OPTION_KEY    = 'mn_marks_option_id';
const MARKS_COMPONENT_FIELDS = [
  'mdcat', 'experience', 'matric', 'fsc', 'degree', 'houseJob',
  'research', 'position', 'hardAreas', 'attempts',
];
const PROGRAM_DICT_ROOTS = ['programAttempt', 'programAttempts', 'programPercentage', 'programMarks', 'adjusted'];
const PROGRAM_DICT_SPECS = [
  { field: 'programAttempt',    subkeys: ['FCPS', 'FCPSD'] },
  { field: 'programPercentage', subkeys: ['MD', 'MS'] },
  { field: 'programMarks',      subkeys: ['FCPS', 'FCPSD', 'MS', 'MD', 'MDS'] },
  { field: 'adjusted',          subkeys: ['FCPS', 'FCPSD', 'MS', 'MD', 'MDS'] },
];
const PROGRAM_DICT_FIELDS = [
  'programAttempt', 'programAttempts', 'programPercentage', 'programMarks', 'adjusted',
];
const MARKS_FORMULA_FIELDS = [...MARKS_COMPONENT_FIELDS, 'marksTotal', ...PROGRAM_DICT_FIELDS];

function marksFormulaFieldSuggestions() {
  const out = [...MARKS_COMPONENT_FIELDS, 'marksTotal'];
  for (const spec of PROGRAM_DICT_SPECS) {
    out.push(spec.field);
    for (const sk of spec.subkeys) out.push(`${spec.field}.${sk}`);
  }
  out.push('programAttempts');
  return [...new Set(out)];
}

function isValidMarksFormulaField(field) {
  const f = String(field || '').trim();
  if (!f) return false;
  if (MARKS_FORMULA_FIELDS.includes(f) || MARKS_COMPONENT_FIELDS.includes(f) || f === 'marksTotal') return true;
  return PROGRAM_DICT_ROOTS.some(root => f.startsWith(`${root}.`));
}

function normalizeProgramDictRoot(name) {
  return name === 'programAttempts' ? 'programAttempt' : name;
}

function getProgramDictSource(c, dictName) {
  const root = normalizeProgramDictRoot(dictName);
  if (root === 'programAttempt') return getProgramAttemptDict(c) || {};
  if (root === 'programPercentage') return c?.programPercentage || {};
  if (root === 'programMarks') return c?.programMarks || {};
  if (root === 'adjusted') return c?.adjusted || {};
  return {};
}

function parseProgramDictNumeric(dictName, raw) {
  if (raw == null || raw === '') return 0;
  const root = normalizeProgramDictRoot(dictName);
  if (root === 'programAttempt') return parseProgramAttemptNumeric(raw);
  const n = parseFloat(raw);
  return isNaN(n) ? 0 : n;
}
const MNNotif = window.MNNotifications;
const DEFAULT_MARKS_OPTIONS = MNNotif.DEFAULT_MARKS_OPTIONS;
const PAGE_SIZE      = 50;
const MAX_PASSES     = 200;
const QUOTA_TRACKS = {
  ARMED: 'armed',
  CIVILIAN: 'civilian',
};
const CIVILIAN_QUOTA_KEYS = new Set([
  'kpk sindh balochistan',
  'punjab',
  'disable',
  'foreign',
  'foriegn',
  'ajk gb ict',
  'ajk g b ict',
  'dental',
  'placement',
]);

// ═══════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════

// ── Simulation candidate detail ──────────────────────────────────

/**
 * For a working candidate from runPlacement, compute per-preference history
 * based on the final seatTree state after convergence.
 *
 * Each entry: { pref, status, cutoff?, capacity? }
 * status: 'placed' | 'beaten' | 'not_attempted' | 'no_slot'
 */
function computeCandidateHistory(workCand, seatTree) {
  const placedPref = workCand.placed
    ? workCand._prefs.find(p =>
        p.quotaName       === workCand._q &&
        p.specialityName  === workCand._s &&
        p.hospitalName    === workCand._h)
    : null;
  const placedPrefNo = placedPref?.preferenceNo ?? Infinity;

  const history = [];
  for (const pref of workCand._prefs) {
    const sl = seatTree?.[pref.quotaName]?.[pref.specialityName]?.[pref.hospitalName];

    if (!sl) {
      history.push({ pref, status: 'no_slot' });
      continue;
    }

    const isPlacedHere =
      workCand.placed &&
      pref.quotaName      === workCand._q &&
      pref.specialityName === workCand._s &&
      pref.hospitalName   === workCand._h;

    if (isPlacedHere) {
      history.push({ pref, status: 'placed' });
      break; // remaining prefs are 'not_attempted'
    }

    if (pref.preferenceNo > placedPrefNo) {
      // Already placed at a better (earlier) preference
      history.push({ pref, status: 'not_attempted' });
      continue;
    }

    // Slot full or partial — determine cutoff
    const cutoff = sl.candidates.length > 0
      ? Math.min(...sl.candidates.map(c => c.marksTotal))
      : null;

    history.push({
      pref,
      status:   'beaten',
      cutoff:   cutoff,
      capacity: sl.jobs,
      filled:   sl.candidates.length,
    });
  }

  return history;
}

function openSimCandidateDetail(applicantId, track = null) {
  if (!SIM.sim.result) return;
  const { seatTree, candidates } = SIM.sim.result;
  const prog = SIM.sim.program;

  const workCand = candidates.find(c =>
    String(c.applicantId) === String(applicantId) &&
    (!track || c._track === track)
  ) || candidates.find(c => String(c.applicantId) === String(applicantId));
  const origCand = ensureCandidateAdjusted(
    allCandidates().find(c => String(c.applicantId) === String(applicantId))
  );
  if (!workCand || !origCand) return;

  const history      = computeCandidateHistory(workCand, seatTree);
  const isMe         = String(applicantId) === SIM.myId;
  const modal        = document.getElementById('candidateModal');
  const body         = document.getElementById('candidateModalBody');
  if (!modal || !body) return;

  // Placement banner
  let banner;
  if (workCand.placed) {
    const prefNo = workCand._prefs.find(p =>
      p.quotaName      === workCand._q &&
      p.specialityName === workCand._s &&
      p.hospitalName   === workCand._h
    )?.preferenceNo ?? '?';
    banner = `<div class="sim-my placed" style="margin-bottom:16px">
      ✅ <strong>Placed:</strong> ${esc(workCand._s)}
      <span style="opacity:0.75"> @ ${esc(workCand._h)}</span>
      &nbsp;·&nbsp; <span style="font-size:0.86em;opacity:0.8">${esc(workCand._q)} &nbsp;·&nbsp; Preference #${prefNo}</span>
    </div>`;
  } else {
    banner = `<div class="sim-my unplaced" style="margin-bottom:16px">
      ⚠️ <strong>Not placed.</strong>
      All ${workCand._prefs.length} preferences were filled by higher-scoring candidates.
    </div>`;
  }

  // History rows
  const notAttempted = workCand._prefs.length - history.length;
  const histRows = history.map(h => {
    const { pref, status } = h;
    let icon, detail, cls;

    if (status === 'placed') {
      icon = '✅'; cls = 'sim-hist-placed';
      detail = '<strong>Placed here</strong>';
    } else if (status === 'beaten') {
      icon = '✗'; cls = 'sim-hist-beaten';
      const cutoffStr = h.cutoff != null ? fmtM(h.cutoff) : '—';
      detail = `Cutoff: <strong style="color:#e05470">${cutoffStr}</strong>`;
      if (h.capacity != null) detail += `<br><span style="opacity:0.65">${h.filled}/${h.capacity} seats</span>`;
    } else if (status === 'not_attempted') {
      icon = '⏭'; cls = 'sim-hist-skip';
      detail = 'Already placed at better pref';
    } else {
      icon = '—'; cls = 'sim-hist-nodata';
      detail = 'No seat data';
    }

    return `<div class="sim-hist-row ${cls}">
      <span class="sim-hist-icon">${icon}</span>
      <span class="sim-hist-no">#${pref.preferenceNo}</span>
      <div class="sim-hist-slot">
        <span class="sim-hist-spec">${esc(pref.specialityName)}</span>
        <span class="sim-hist-hosp">${esc(pref.hospitalName)}</span>
        <span class="sim-hist-quota">${esc(pref.quotaName)}</span>
      </div>
      <span class="sim-hist-detail">${detail}</span>
    </div>`;
  }).join('');

  const notAttemptedRow = notAttempted > 0
    ? `<div class="sim-hist-row sim-hist-skip" style="opacity:0.35">
        <span class="sim-hist-icon">⏭</span>
        <span style="font-size:0.77rem;color:var(--text-muted);grid-column:2/-1">
          ${notAttempted} lower preference${notAttempted > 1 ? 's' : ''} not attempted (placed at an earlier preference)
        </span>
      </div>`
    : '';

  body.innerHTML = `
    <div class="cand-detail-hdr">
      <h3>${esc(origCand.nameFull)} ${isMe ? '<span class="me-tag">YOU</span>' : ''}</h3>
      <p class="cand-detail-meta">
        ID: ${origCand.applicantId}
        &nbsp;·&nbsp; ${esc(prog)} ${esc(workCand._trackLabel || '')} marks: <strong>${fmtM(workCand.marksTotal)}</strong>
      </p>
    </div>
    ${renderProgramScoreCardsHtml(origCand)}
    ${renderAdjustedMarksHtml(origCand)}
    ${renderProgramPortalMetaHtml(origCand)}
    ${_renderMarksExplanationHtml(origCand)}
    ${banner}
    <p class="sim-hist-section-lbl">Preference-by-preference breakdown (${esc(prog)})</p>
    <div class="sim-hist-list">
      ${histRows || '<p style="color:var(--text-muted);font-size:0.82rem">No preferences recorded.</p>'}
      ${notAttemptedRow}
    </div>
  `;

  modal.classList.remove('hidden');
}

/**
 * Resolve base merit marks for a candidate using the active marks formula.
 * Formulas are admin-configurable (Firestore) with local fallback defaults.
 */
function normalizeMarksOption(raw, idx = 0) {
  return MNNotif.normalizeMarksOption(raw, idx, isValidMarksFormulaField);
}

function applyMarksConfig(data) {
  const options = Array.isArray(data?.options) && data.options.length
    ? data.options.map((o, i) => normalizeMarksOption(o, i)).filter(Boolean)
    : DEFAULT_MARKS_OPTIONS.slice();

  SIM.marks.options = options.length ? options : DEFAULT_MARKS_OPTIONS.slice();
  SIM.marks.showSelector = MNNotif.readMarksConfigBool(data?.showSelector, true);
  SIM.marks.noticeTitle = typeof data?.noticeTitle === 'string' && data.noticeTitle.trim()
    ? data.noticeTitle.trim()
    : 'About merit marks';
  SIM.marks.candidateNotice = typeof data?.candidateNotice === 'string' ? data.candidateNotice : '';
  SIM.marks.showNotice = MNNotif.readMarksConfigBool(data?.showNotice, true);

  const defaultId = typeof data?.defaultOptionId === 'string' ? data.defaultOptionId : 'portal';
  const storedId = localStorage.getItem(MARKS_OPTION_KEY);
  const ids = new Set(SIM.marks.options.map(o => o.id));
  const pick = id => ids.has(id) ? id : null;

  if (!SIM.marks.showSelector) {
    SIM.marks.activeOptionId =
      pick(defaultId) ||
      SIM.marks.options[0]?.id ||
      'portal';
  } else {
    SIM.marks.activeOptionId =
      pick(storedId) ||
      pick(defaultId) ||
      SIM.marks.options[0]?.id ||
      'portal';

    if (!pick(storedId) && SIM.marks.activeOptionId) {
      localStorage.setItem(MARKS_OPTION_KEY, SIM.marks.activeOptionId);
    }
  }

  syncMarksSelectorUI();
  syncMarksNoticeUI();
  updateMarksBasisLabels();
}

async function loadMarksConfig() {
  const data = await MNNotif.loadMarksConfigDoc();
  applyMarksConfig(data || MNNotif.DEFAULT_MARKS_CONFIG);
}

function initMarksConfig() {
  loadMarksConfig();
  MNNotif.initMarksConfigListener(data => {
    applyMarksConfig(data || MNNotif.DEFAULT_MARKS_CONFIG);
    onMarksOptionChanged(false);
  });
}

function getMarksOption(id) {
  const key = id ?? SIM.marks.activeOptionId;
  return SIM.marks.options.find(o => o.id === key)
    || DEFAULT_MARKS_OPTIONS.find(o => o.id === key)
    || DEFAULT_MARKS_OPTIONS[0];
}

function resolveBaseMarks(c, option, program) {
  const opt = option || getMarksOption();
  let total = 0;
  if (opt.base === 'sum') {
    total = (opt.sumFields || []).reduce((s, f) => s + resolveCandidateField(c, f, program), 0);
  } else {
    total = resolveCandidateField(c, 'marksTotal', program);
  }
  for (const adj of (opt.adjustments || [])) {
    const val = resolveCandidateField(c, adj.field, program);
    if (adj.op === 'add') total += val;
    else if (adj.op === 'subtract') total -= val;
  }
  return total;
}

function getActiveMarksLabel() {
  return getMarksOption()?.label || 'Base';
}

function updateMarksBasisLabels() {
  const label = getActiveMarksLabel();
  document.querySelectorAll('[data-marks-basis-label]').forEach(el => {
    el.textContent = label;
  });
}

function syncMarksSelectorUI() {
  const selects = [
    document.getElementById('candMarksBasis'),
    document.getElementById('simMarksBasis'),
    document.getElementById('consentMarksBasis'),
  ].filter(Boolean);

  for (const sel of selects) {
    const prev = sel.value;
    sel.innerHTML = SIM.marks.options.map(o =>
      `<option value="${esc(o.id)}">${esc(o.label)}</option>`
    ).join('');
    sel.value = SIM.marks.activeOptionId;
    if (!sel.value && SIM.marks.options.length) {
      sel.value = SIM.marks.options[0].id;
    } else if (prev && [...sel.options].some(o => o.value === prev)) {
      sel.value = prev;
    }
    sel.disabled = !SIM.marks.showSelector || SIM.marks.options.length <= 1;
    sel.closest('.marks-basis-wrap')?.classList.toggle('hidden', !SIM.marks.showSelector);
  }

  document.querySelectorAll('.marks-basis-wrap').forEach(wrap => {
    wrap.classList.toggle('hidden', !SIM.marks.showSelector);
  });

  syncMarksNoticeUI();
}

function syncMarksNoticeUI() {
  MNNotif.syncMarksNoticeUI({
    activeOptionId: SIM.marks.activeOptionId || '',
    showNotice: SIM.marks.showNotice,
    noticeTitle: SIM.marks.noticeTitle,
    candidateNotice: SIM.marks.candidateNotice,
    showSelector: SIM.marks.showSelector,
    formulaLabel: getActiveMarksLabel(),
    optionNotice: MNNotif.getNoticeForOption(getMarksOption()),
  });
}

function setupMarksSelectors() {
  const handler = e => setActiveMarksOption(e.target.value);
  document.getElementById('candMarksBasis')?.addEventListener('change', handler);
  document.getElementById('simMarksBasis')?.addEventListener('change', handler);
  document.getElementById('consentMarksBasis')?.addEventListener('change', handler);
  syncMarksSelectorUI();
  syncMarksNoticeUI();
  updateMarksBasisLabels();
}

function setActiveMarksOption(id) {
  if (!id || !SIM.marks.options.some(o => o.id === id)) return;
  SIM.marks.activeOptionId = id;
  localStorage.setItem(MARKS_OPTION_KEY, id);
  syncMarksSelectorUI();
  onMarksOptionChanged(true);
}

function onMarksOptionChanged(clearSim) {
  updateMarksBasisLabels();
  syncMarksNoticeUI();
  updateMyBadge();
  applyAndRenderCandidates();
  if (clearSim) {
    SIM.sim.result = null;
    document.getElementById('simResults').innerHTML = '';
  }
  if (SIM.sb.program) renderSlot();
}

/**
 * Base marks for a candidate — resolved via admin/user-selected formula.
 */
function baseMarks(c) {
  return resolveBaseMarks(c);
}

/**
 * Effective marks for a candidate in a specific program.
 * = baseMarks(c) + programMarks[program]  (programMarks is a per-program bonus)
 * Returns null when applied_in[program] is false (candidate did not apply).
 * A candidate may have applied_in=true but programMarks=0 (0 bonus) — they
 * are still valid and ranked on baseMarks alone. Some imported programme
 * names are present only in preference data; those preferences imply applying.
 */
function effectiveMark(c, program) {
  const appliedIn = c.applied_in || {};
  const hasExplicitFlag = Object.prototype.hasOwnProperty.call(appliedIn, program);
  const hasProgramPrefs = (c.preference?.[program] || []).length > 0;
  if (!appliedIn[program] && (hasExplicitFlag || !hasProgramPrefs)) return null;
  return resolveBaseMarks(c, undefined, program) + (c.programMarks?.[program] ?? 0);
}

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtM(v) {
  if (v == null || v === '') return '—';
  const n = parseFloat(v);
  return isNaN(n) ? '—' : n.toFixed(2);
}

function renderPagination(containerId, total, page, pageSize, onPage) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const pages = Math.ceil(total / pageSize);
  if (pages <= 1) { el.innerHTML = ''; return; }
  let html = page > 0 ? `<button class="page-btn" data-p="${page - 1}">‹ Prev</button>` : '';
  html += `<span class="page-info">Page ${page + 1} of ${pages}</span>`;
  if (page < pages - 1) html += `<button class="page-btn" data-p="${page + 1}">Next ›</button>`;
  el.innerHTML = html;
  el.querySelectorAll('.page-btn').forEach(b =>
    b.addEventListener('click', () => onPage(+b.dataset.p))
  );
}

let _toastTimer = null;
function showToast(msg, type = 'info') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = `toast toast-${type} toast-visible`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('toast-visible'), 3500);
}

// ═══════════════════════════════════════════════════════════════════
// URL PARAM HANDLER  — ?tab=seatmatrix etc.
// ═══════════════════════════════════════════════════════════════════
function handleSimURLParams() {
  const tab = new URLSearchParams(window.location.search).get('tab');
  if (!tab) return;
  const btn = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
  if (!btn) return;
  document.querySelectorAll('.tab-btn[data-tab]').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(`tab-${tab}`)?.classList.add('active');
  SIM.activeTab = tab;
  // Trigger lazy renderers so URL-directed tabs aren't stuck on placeholders
  if (tab === 'seatmatrix')  renderSeatMatrixTab();
  if (tab === 'competition') renderCompetitionTab();
  if (tab === 'schedule')    renderScheduleTab();
  if (tab === 'hospitals')   renderHospitalsTab();
  if (tab === 'profiles')    renderProfilesTab();
}
