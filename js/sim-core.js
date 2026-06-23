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

  candidateRevision: {
    activeId:     null,
    availableIds: [],
    showSelector: false,
  },

  globallyDisabledRevisionIds: [], // loaded from Firestore revisions_config
  trackedFields: ['houseJob', 'position', 'mdcat', 'degree'],
  certificatePolicy: null,
  specialtyGroups: null,
  _specialtyGroupIndex: null,

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
const CANDIDATE_REVISION_KEY = 'mn_candidate_revision_id';
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

function normalizeCandidateRevisionId(revision) {
  if (revision == null || revision === '' || revision === false) return null;
  if (typeof revision === 'string') {
    const id = revision.trim();
    if (!id || id === 'original') return null;
    return id;
  }
  return null;
}

function getActiveCandidateRevisionId() {
  return normalizeCandidateRevisionId(SIM.candidateRevision.activeId);
}

function resolveCandidateRevision(c, revision) {
  if (!revision) return null;
  if (typeof revision === 'object') return revision;
  const id = normalizeCandidateRevisionId(revision);
  if (!id) return null;
  const revisions = c?.revisions;
  const data = revisions && typeof revisions === 'object' ? revisions[id] : null;
  return data && typeof data === 'object' ? data : null;
}

function candidatePathParts(field) {
  return String(field || '').trim().split('.').filter(Boolean);
}

function hasCandidatePath(obj, field) {
  const parts = candidatePathParts(field);
  if (!obj || typeof obj !== 'object' || !parts.length) return false;
  let cur = obj;
  for (const part of parts) {
    if (!cur || typeof cur !== 'object' || !Object.prototype.hasOwnProperty.call(cur, part)) {
      return false;
    }
    cur = cur[part];
  }
  return true;
}

function readCandidatePath(obj, field) {
  const parts = candidatePathParts(field);
  if (!obj || typeof obj !== 'object' || !parts.length) return undefined;
  let cur = obj;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[part];
  }
  return cur;
}

/**
 * Read candidate data through an optional revision layer.
 * Revisions only need to store corrected fields; missing fields inherit from
 * the root candidate record. Passing null preserves legacy/root behavior.
 */
function getCandidateField(candidate, field, revision) {
  const selectedRevision = arguments.length >= 3 ? revision : getActiveCandidateRevisionId();
  const rev = resolveCandidateRevision(candidate, selectedRevision);
  if (rev && hasCandidatePath(rev, field)) return readCandidatePath(rev, field);
  return readCandidatePath(candidate, field);
}

function getCandidateRevisionSourceList() {
  if (typeof allCandidates === 'function') return allCandidates();
  return [
    ...(SIM.customCand ? [SIM.customCand] : []),
    ...(SIM.candidates || []),
  ];
}

function collectCandidateRevisionIds(candidates = getCandidateRevisionSourceList()) {
  const globalDisabled = new Set(SIM.globallyDisabledRevisionIds || []);
  const ids = new Set();
  for (const c of candidates || []) {
    const revisions = c?.revisions;
    if (!revisions || typeof revisions !== 'object') continue;
    Object.keys(revisions)
      .filter(id => {
        const rev = revisions[id];
        return id && rev && typeof rev === 'object' && rev.disabled !== true && !globalDisabled.has(id);
      })
      .forEach(id => ids.add(id));
  }
  return [...ids].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

async function loadGloballyDisabledRevisionIds() {
  try {
    const _db = firebase.firestore();
    const snap = await _db.collection('notifications').doc('revisions_config').get();
    if (snap.exists) {
      const data = snap.data();
      SIM.globallyDisabledRevisionIds = Array.isArray(data.disabledIds) ? data.disabledIds : [];
      if (Array.isArray(data.trackedFields) && data.trackedFields.length) {
        SIM.trackedFields = data.trackedFields;
      }
    }
  } catch (_) {}
}

function initLiveRevisionsConfig() {
  try {
    firebase.firestore().collection('notifications').doc('revisions_config')
      .onSnapshot(snap => {
        if (!snap.exists) return;
        const data = snap.data();
        const prevTracked = SIM.trackedFields;
        SIM.globallyDisabledRevisionIds = Array.isArray(data.disabledIds) ? data.disabledIds : [];
        if (Array.isArray(data.trackedFields) && data.trackedFields.length) {
          SIM.trackedFields = data.trackedFields;
        }
        const changed = JSON.stringify(prevTracked) !== JSON.stringify(SIM.trackedFields);
        if (changed) {
          refreshCandidateRevisionOptions();
          onCandidateRevisionChanged(true);
        }
      }, err => console.warn('[RevisionsConfig] listener error:', err));
  } catch (e) {
    console.warn('[RevisionsConfig] init failed:', e);
  }
}

function candidateHasRevisions(c) {
  const revisions = c?.revisions;
  if (!revisions || typeof revisions !== 'object') return false;
  return Object.keys(revisions).some(id => {
    const rev = revisions[id];
    return id && rev && typeof rev === 'object';
  });
}

function getCandidateEnabledRevisionCount(c) {
  const revisions = c?.revisions;
  if (!revisions || typeof revisions !== 'object') return 0;
  return Object.keys(revisions).filter(id => {
    const rev = revisions[id];
    return id && rev && typeof rev === 'object' && rev.disabled !== true;
  }).length;
}

function getCandidateDisabledRevisionCount(c) {
  const revisions = c?.revisions;
  if (!revisions || typeof revisions !== 'object') return 0;
  return Object.keys(revisions).filter(id => {
    const rev = revisions[id];
    return id && rev && typeof rev === 'object' && rev.disabled === true;
  }).length;
}

function getCandidateRevisionFields(c, revisionId) {
  const rev = resolveCandidateRevision(c, revisionId);
  if (!rev || typeof rev !== 'object') return [];
  return Object.entries(rev)
    .filter(([key]) => !key.startsWith('_'))
    .map(([field, value]) => ({ field, value }));
}

const MARKS_FIELD_LABELS_REVISIONS = {
  degree: 'Degree',
  houseJob: 'House Job',
  experience: 'Experience',
  research: 'Research',
  position: 'Position',
  hardAreas: 'Hard Areas',
  matric: 'Matric',
  fsc: 'FSC',
  attempts: 'Attempts',
  mdcat: 'MDCAT',
  marksTotal: 'Total marks',
};

function revisionFieldLabel(field) {
  return MARKS_FIELD_LABELS_REVISIONS[field] || String(field || '').replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
}

function candidateRevisionLabel(id) {
  const normalized = normalizeCandidateRevisionId(id);
  if (!normalized) return 'Original';
  return normalized
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function updateCandidateRevisionLabels() {
  const label = candidateRevisionLabel(getActiveCandidateRevisionId());
  document.querySelectorAll('[data-candidate-revision-label]').forEach(el => {
    el.textContent = label;
  });
}

function syncCandidateRevisionUI() {
  const selects = [
    document.getElementById('candCandidateRevision'),
    document.getElementById('simCandidateRevision'),
    document.getElementById('consentCandidateRevision'),
  ].filter(Boolean);

  const optionsHtml = [
    '<option value="">Original</option>',
    ...SIM.candidateRevision.availableIds.map(id =>
      `<option value="${esc(id)}">${esc(candidateRevisionLabel(id))}</option>`
    ),
  ].join('');

  for (const sel of selects) {
    const prev = sel.value;
    sel.innerHTML = optionsHtml;
    sel.value = getActiveCandidateRevisionId() || '';
    if (!sel.value && prev && SIM.candidateRevision.availableIds.includes(prev)) {
      sel.value = prev;
    }
    sel.closest('.candidate-revision-wrap')?.classList.toggle('hidden', !SIM.candidateRevision.showSelector);
  }

  document.querySelectorAll('.candidate-revision-wrap').forEach(wrap => {
    wrap.classList.toggle('hidden', !SIM.candidateRevision.showSelector);
  });
  updateCandidateRevisionLabels();
}

function refreshCandidateRevisionOptions() {
  const ids = collectCandidateRevisionIds();
  SIM.candidateRevision.availableIds = ids;
  SIM.candidateRevision.showSelector = ids.length > 0;

  const storedId = normalizeCandidateRevisionId(localStorage.getItem(CANDIDATE_REVISION_KEY));
  const activeId = normalizeCandidateRevisionId(SIM.candidateRevision.activeId) || storedId;
  SIM.candidateRevision.activeId = ids.includes(activeId) ? activeId : null;
  if (SIM.candidateRevision.activeId) {
    localStorage.setItem(CANDIDATE_REVISION_KEY, SIM.candidateRevision.activeId);
  } else {
    localStorage.removeItem(CANDIDATE_REVISION_KEY);
  }
  syncCandidateRevisionUI();
}

function setActiveCandidateRevision(id) {
  const normalized = normalizeCandidateRevisionId(id);
  if (normalized && !SIM.candidateRevision.availableIds.includes(normalized)) return;
  SIM.candidateRevision.activeId = normalized;
  if (normalized) localStorage.setItem(CANDIDATE_REVISION_KEY, normalized);
  else localStorage.removeItem(CANDIDATE_REVISION_KEY);
  syncCandidateRevisionUI();
  onCandidateRevisionChanged(true);
}
const MNNotif = window.MNNotifications;
const DEFAULT_MARKS_OPTIONS = MNNotif.DEFAULT_MARKS_OPTIONS;
const PAGE_SIZE      = 50;
const MAX_PASSES     = 1000;
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
  const placedScore  = workCand.placed
    ? history.find(h => h.status === 'placed')?.pref
    : null;
  const displayScore = placedScore && typeof scoreForPreference === 'function'
    ? scoreForPreference(workCand, placedScore)
    : workCand.marksTotal;
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

  const specPanelHtml = typeof renderSpecialtyMarksPanelHtml === 'function'
    ? renderSpecialtyMarksPanelHtml(origCand)
    : '';

  body.innerHTML = `
    <div class="cand-detail-hdr">
      <h3>${esc(origCand.nameFull)} ${isMe ? '<span class="me-tag">YOU</span>' : ''}</h3>
      <p class="cand-detail-meta">
        ID: ${origCand.applicantId}
        &nbsp;·&nbsp; ${esc(prog)} ${esc(workCand._trackLabel || '')} marks: <strong>${fmtM(displayScore)}</strong>
      </p>
    </div>
    ${specPanelHtml}
    ${typeof renderPostgraduateQualificationsHtml === 'function' ? renderPostgraduateQualificationsHtml(origCand) : ''}
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

const DEFAULT_TRACKED_FIELDS = ['houseJob', 'position', 'mdcat', 'degree'];

function resolveBaseMarks(c, option, program, revision) {
  const selectedRevision = arguments.length >= 4 ? revision : getActiveCandidateRevisionId();
  const opt = option || getMarksOption();
  let total = 0;
  if (opt.base === 'sum') {
    total = (opt.sumFields || []).reduce((s, f) => s + resolveCandidateField(c, f, program, selectedRevision), 0);
  } else {
    total = resolveCandidateField(c, 'marksTotal', program, selectedRevision);
  }
  for (const adj of (opt.adjustments || [])) {
    if (adj.op === 'add') {
      total += resolveCandidateField(c, adj.field, program, selectedRevision);
    } else if (adj.op === 'subtract') {
      total -= resolveCandidateField(c, adj.field, program, null);
    }
  }
  return total;
}

function applyRevisionDelta(c, revision, option) {
  if (!revision) return 0;
  const revData = resolveCandidateRevision(c, revision);
  if (!revData) return 0;
  const opt = option || getMarksOption();
  const subtractFields = new Set(
    (opt.adjustments || []).filter(a => a.op === 'subtract').map(a => a.field)
  );
  const tracked = SIM.trackedFields && SIM.trackedFields.length
    ? SIM.trackedFields : DEFAULT_TRACKED_FIELDS;
  let delta = 0;
  for (const field of tracked) {
    if (subtractFields.has(field)) continue;
    if (Object.prototype.hasOwnProperty.call(revData, field)) {
      const rootVal = resolveCandidateField(c, field, undefined, null);
      const revVal = resolveCandidateField(c, field, undefined, revision);
      if (typeof rootVal === 'number' && typeof revVal === 'number') {
        delta += rootVal - revVal;
      }
    }
  }
  return delta;
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

function setupCandidateRevisionSelectors() {
  const handler = e => setActiveCandidateRevision(e.target.value);
  document.getElementById('candCandidateRevision')?.addEventListener('change', handler);
  document.getElementById('simCandidateRevision')?.addEventListener('change', handler);
  document.getElementById('consentCandidateRevision')?.addEventListener('change', handler);
  refreshCandidateRevisionOptions();
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

function onCandidateRevisionChanged(clearSim) {
  updateCandidateRevisionLabels();
  updateMyBadge();
  applyAndRenderCandidates();
  if (clearSim) {
    SIM.sim.result = null;
    SIM.sim.baselineResult = null;
    document.getElementById('simResults').innerHTML = '';
  }
  if (SIM.sb.program) renderSlot();
}

/**
 * Base marks using formula with root values, then apply revision delta.
 * Revision delta subtracts (root - revised) for each tracked field that is
 * NOT already adjusted by the formula — so only fields that are NOT part
 * of the formula's adjustments get their revision change reflected.
 */
function baseMarksWithRevision(c, option, program, revision) {
  const base = resolveBaseMarks(c, option, program, null);
  const delta = applyRevisionDelta(c, revision, option);
  return base - delta;
}

function baseMarks(c, revision) {
  const selectedRevision = arguments.length >= 2 ? revision : getActiveCandidateRevisionId();
  return baseMarksWithRevision(c, undefined, undefined, selectedRevision);
}

function normalizeProgramName(program) {
  return String(program || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

function programAliases(program) {
  const p = String(program || '').trim();
  const normalized = normalizeProgramName(p);
  if (normalized === 'FCPSD' || normalized === 'FCPS DENTISTRY') {
    return ['FCPS Dentistry', 'FCPSD'];
  }
  return [p].filter(Boolean);
}

function programMatches(a, b) {
  const aa = new Set(programAliases(a).map(normalizeProgramName));
  return programAliases(b).some(alias => aa.has(normalizeProgramName(alias)));
}

function normalizedLookupText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\./g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\bgynaecology\b/g, 'gynecology')
    .replace(/\borthopaedics\b/g, 'orthopedic surgery')
    .replace(/\s+/g, ' ')
    .trim();
}

function legacyProgramBonus(c, program) {
  for (const alias of programAliases(program)) {
    const val = getCandidateField(c, `programMarks.${alias}`, null);
    if (val != null && val !== '') {
      const n = Number(val);
      return Number.isFinite(n) ? n : 0;
    }
  }
  return 0;
}

function getSpecialtyGroupIndex() {
  if (SIM._specialtyGroupIndex) return SIM._specialtyGroupIndex;
  const out = {};
  const programs = SIM.specialtyGroups?.programs || {};
  for (const [program, cfg] of Object.entries(programs)) {
    const labels = {};
    for (const [groupId, group] of Object.entries(cfg.groups || {})) {
      for (const value of [...(group.labels || []), ...(group.specialties || [])]) {
        const key = normalizedLookupText(value);
        if (key) labels[key] = groupId;
      }
    }
    out[normalizeProgramName(program)] = labels;
  }
  SIM._specialtyGroupIndex = out;
  return out;
}

function specialtyGroupFor(program, specialty) {
  const key = normalizedLookupText(specialty);
  if (!key) return null;
  const index = getSpecialtyGroupIndex();
  for (const alias of programAliases(program)) {
    const labels = index[normalizeProgramName(alias)];
    if (labels?.[key]) return labels[key];
  }
  return key;
}

function certificateMatchesPreference(cert, program, preference) {
  if (!cert || !programMatches(cert.program, program)) return false;
  const prefSpecialty = preference?.specialityName || preference?.specialty || preference?.discipline || '';
  if (!prefSpecialty) return false;
  const prefGroup = specialtyGroupFor(program, prefSpecialty);
  const certGroup = specialtyGroupFor(program, cert.specialty);
  if (prefGroup && certGroup && prefGroup === certGroup) return true;
  return normalizedLookupText(prefSpecialty) === normalizedLookupText(cert.specialty);
}

function isCertificatePass(cert) {
  return normalizedLookupText(cert?.status) === 'pass';
}

function isMarch2026Pass(cert) {
  if (!isCertificatePass(cert)) return false;
  if (normalizedLookupText(cert?.session) === 'march 2026') return true;
  const m = String(cert?.passingDate || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return !!(m && Number(m[2]) === 3 && Number(m[3]) === 2026);
}

function certificatePolicy() {
  return SIM.certificatePolicy || {};
}

function fcpsCertificateBonus(cert, policy) {
  const cfg = policy.fcps || {};
  if (cfg.requirePass !== false && !isCertificatePass(cert)) return null;
  const attempt = Number(cert?.attempt);
  if (!Number.isFinite(attempt)) return null;
  const raw = cfg.attemptMarks?.[String(attempt)];
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function msmdCertificateBonus(cert, policy) {
  const cfg = policy.msmd || {};
  if (cfg.requirePass !== false && !isCertificatePass(cert)) return null;
  if (cfg.specialRules?.March2026Pass != null && isMarch2026Pass(cert)) {
    const n = Number(cfg.specialRules.March2026Pass);
    if (Number.isFinite(n)) return n;
  }
  const pct = Number(cert?.percentage);
  if (!Number.isFinite(pct) || pct <= 0) return null;
  for (const rule of cfg.percentageMarks || []) {
    const min = Number(rule.min);
    const marks = Number(rule.marks);
    if (Number.isFinite(min) && Number.isFinite(marks) && pct >= min) return marks;
  }
  return null;
}

function certificateBonusForProgram(cert, program, policy) {
  const normalized = normalizeProgramName(program);
  if (normalized.startsWith('FCPS')) return fcpsCertificateBonus(cert, policy);
  if (['MS', 'MD', 'MDS'].includes(normalized)) return msmdCertificateBonus(cert, policy);
  return null;
}

function resolveProgramBonusDetails(candidate, preference, program) {
  const prog = program || preference?.typeName || preference?.program;
  const legacyBonus = legacyProgramBonus(candidate, prog);
  const fallback = certificatePolicy().fallback || {};
  if (!prog) return { bonus: legacyBonus || 0, source: legacyBonus ? 'legacy' : 'zero', legacyBonus };
  if (!preference?.specialityName && !preference?.specialty && !preference?.discipline) {
    return { bonus: legacyBonus || 0, source: legacyBonus ? 'legacy' : 'zero', legacyBonus };
  }

  const certs = Array.isArray(candidate?.certificates) ? candidate.certificates : [];
  if (!certs.length) {
    return { bonus: legacyBonus || 0, source: legacyBonus ? 'legacy' : 'zero', legacyBonus };
  }

  const policy = certificatePolicy();
  const matches = certs
    .filter(cert => certificateMatchesPreference(cert, prog, preference))
    .map(cert => ({ cert, bonus: certificateBonusForProgram(cert, prog, policy) }))
    .filter(row => row.bonus != null);

  if (matches.length) {
    matches.sort((a, b) => b.bonus - a.bonus);
    return {
      bonus: matches[0].bonus,
      source: 'certificate',
      certificate: matches[0].cert,
      specialtyGroup: specialtyGroupFor(prog, preference.specialityName || preference.specialty),
      legacyBonus,
    };
  }

  const useFallback = fallback.useProgramMarksWhenNoCertificateMatch !== false
    && fallback.useProgramMarksWhenCertificateIncomplete !== false;
  return {
    bonus: useFallback ? legacyBonus || 0 : 0,
    source: useFallback && legacyBonus ? 'legacy' : 'zero',
    legacyBonus,
  };
}

function resolveProgramBonus(candidate, preference, program) {
  return resolveProgramBonusDetails(candidate, preference, program).bonus || 0;
}

/**
 * Effective marks for a candidate in a specific program.
 * = baseMarksWithRevision(c) + programme bonus.
 * With a preference, the bonus is certificate/specialty-aware; without one it
 * intentionally uses legacy programMarks so global Candidate Pool columns stay
 * backward-compatible.
 * Returns null when applied_in[program] is false (candidate did not apply).
 */
function effectiveMark(c, program, revision, option, preference) {
  const selectedRevision = (arguments.length >= 3 && revision !== undefined)
    ? revision
    : getActiveCandidateRevisionId();
  const appliedIn = c.applied_in || {};
  const aliases = programAliases(program);
  const hasExplicitFlag = Object.prototype.hasOwnProperty.call(appliedIn, program);
  const hasProgramPrefs = (c.preference?.[program] || []).length > 0;
  const applied = aliases.some(alias => appliedIn[alias]);
  if (!applied && (hasExplicitFlag || !hasProgramPrefs)) return null;
  const programMarks = preference
    ? resolveProgramBonus(c, preference, program)
    : legacyProgramBonus(c, program);
  return baseMarksWithRevision(c, option, program, selectedRevision) + programMarks;
}

function effectiveMarks(c, revision = null, marksProfile = undefined, program = undefined) {
  const option = typeof marksProfile === 'string' ? getMarksOption(marksProfile) : marksProfile;
  return program == null
    ? baseMarksWithRevision(c, option, undefined, revision)
    : effectiveMark(c, program, revision, option);
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
  if (tab === 'config')      renderConfigTab();
}
