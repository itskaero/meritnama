'use strict';

// ═══════════════════════════════════════════════════════════════════
// sim-consent.js — Status scope selector + consent what-if tab
// Extracted from the monolithic simulation.js to fix these features
// without loading the entire (conflicting) 7k-line file.
// ═══════════════════════════════════════════════════════════════════

// ── Constants ──
const SIM_STATUS_SCOPE_KEY = 'mn_sim_status_scope_id';
const CONSENT_HISTORY_KEY = 'mn_consent_whatif_history';
const MAX_CONSENT_HISTORY = 8;

const DEFAULT_SIM_STATUS_SCOPES = [
  { id: 'all', label: 'All candidates', description: 'Do not filter by verification status.', includeAll: true, statusIds: [] },
  { id: 'accepted-pending', label: 'Accepted + Pending', description: 'Only candidates marked Accepted or Pending in profile verification.', includeAll: false, statusIds: [1, 11] },
  { id: 'accepted', label: 'Accepted only', description: 'Only candidates marked Accepted.', includeAll: false, statusIds: [1] },
  { id: 'pending', label: 'Pending only', description: 'Only candidates marked Pending.', includeAll: false, statusIds: [11] },
  { id: 'rejected', label: 'Rejected only', description: 'Only candidates marked Rejected.', includeAll: false, statusIds: [2] },
];

// ── Augment SIM with consent + status-scope state ──
(function augmentSIM() {
  SIM.sim.baselineResult = null;
  SIM.sim.statusScopeId = 'all';
  SIM.sim.statusScopes = [];
  SIM.sim.showStatusScopeSelector = true;
  SIM.sim.consentMode = 'view';
  SIM.sim.noConsentIds = new Set();
  SIM.sim.lastConsentReport = null;
  SIM.consent = {
    program: 'FCPS',
    candidateId: '',
    lastReport: null,
    history: [],
  };
})();

// ── Status Scope Helpers ──

function normalizeSimStatusScope(raw, idx) {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : 'scope-' + (idx + 1);
  const label = typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : id;
  const description = typeof raw.description === 'string' ? raw.description.trim() : '';
  const includeAll = raw.includeAll === true || id === 'all';
  const statusIds = includeAll ? [] : (Array.isArray(raw.statusIds) ? raw.statusIds : []).map(n => Number(n)).filter(n => Number.isFinite(n));
  if (!includeAll && !statusIds.length) return null;
  return { id, label, description, includeAll, statusIds };
}

function cloneDefaultSimStatusScopes() {
  return DEFAULT_SIM_STATUS_SCOPES.map(s => ({ ...s, statusIds: [...s.statusIds] }));
}

function applySimulationConfig(data) {
  const parsed = Array.isArray(data?.statusScopes)
    ? data.statusScopes.map((s, i) => normalizeSimStatusScope(s, i)).filter(Boolean)
    : [];
  SIM.sim.statusScopes = parsed.length ? parsed : cloneDefaultSimStatusScopes();
  SIM.sim.showStatusScopeSelector = readConfigBool(data?.showStatusScopeSelector, true);
  const defaultId = typeof data?.defaultStatusScopeId === 'string' && data.defaultStatusScopeId.trim() ? data.defaultStatusScopeId.trim() : 'all';
  const storedId = localStorage.getItem(SIM_STATUS_SCOPE_KEY);
  const ids = new Set(SIM.sim.statusScopes.map(s => s.id));
  const pick = id => ids.has(id) ? id : null;
  SIM.sim.statusScopeId = SIM.sim.showStatusScopeSelector
    ? (pick(storedId) || pick(defaultId) || SIM.sim.statusScopes[0]?.id || 'all')
    : (pick(defaultId) || SIM.sim.statusScopes[0]?.id || 'all');
  if (SIM.sim.showStatusScopeSelector && SIM.sim.statusScopeId) {
    localStorage.setItem(SIM_STATUS_SCOPE_KEY, SIM.sim.statusScopeId);
  }
  syncSimulationStatusScopeUI();
}

function initSimulationConfig() {
  applySimulationConfig(null);
  try {
    firebase.firestore().collection('notifications').doc('simulation_config')
      .onSnapshot(snap => {
        applySimulationConfig(snap.exists ? snap.data() : null);
        if (SIM.sim.result) {
          SIM.sim.result = null;
          SIM.sim.baselineResult = null;
          resetInteractiveConsentState();
          const el = document.getElementById('simResults');
          if (el) el.innerHTML = '';
          updateSimulationDownloadGate();
        }
      }, err => console.warn('[SimulationConfig] listener error:', err));
  } catch (e) {
    console.warn('[SimulationConfig] init failed:', e);
  }
}

function getActiveSimStatusScope() {
  return SIM.sim.statusScopes.find(s => s.id === SIM.sim.statusScopeId)
    || SIM.sim.statusScopes[0]
    || DEFAULT_SIM_STATUS_SCOPES[0];
}

function syncSimulationStatusScopeUI() {
  const selects = [
    { sel: document.getElementById('simStatusScope'), hint: document.getElementById('simStatusScopeHint') },
    { sel: document.getElementById('consentStatusScope'), hint: document.getElementById('consentStatusScopeHint') },
  ].filter(item => item.sel);
  const scope = getActiveSimStatusScope();
  for (const { sel, hint } of selects) {
    sel.innerHTML = SIM.sim.statusScopes.map(s =>
      '<option value="' + esc(s.id) + '">' + esc(s.label) + '</option>'
    ).join('');
    sel.value = SIM.sim.statusScopeId;
    sel.disabled = !SIM.sim.showStatusScopeSelector || SIM.sim.statusScopes.length <= 1;
    if (hint) hint.textContent = scope.description || (scope.includeAll ? 'All candidates included.' : 'Filtered by verification status.');
  }
  document.querySelectorAll('.sim-status-scope-wrap').forEach(wrap => {
    wrap.classList.toggle('hidden', !SIM.sim.showStatusScopeSelector);
  });
}

function setupSimulationStatusScopeSelector() {
  const handler = e => {
    const next = e.target.value;
    if (!SIM.sim.statusScopes.some(s => s.id === next)) return;
    SIM.sim.statusScopeId = next;
    localStorage.setItem(SIM_STATUS_SCOPE_KEY, next);
    SIM.sim.result = null;
    SIM.sim.baselineResult = null;
    resetInteractiveConsentState();
    const el = document.getElementById('simResults');
    if (el) el.innerHTML = '';
    const cr = document.getElementById('consentResults');
    if (cr) { cr.className = 'consent-placeholder'; cr.textContent = 'Candidate status scope changed. Run the consent comparison again.'; }
    updateSimulationDownloadGate();
  };
  document.getElementById('simStatusScope')?.addEventListener('change', handler);
  document.getElementById('consentStatusScope')?.addEventListener('change', handler);
  syncSimulationStatusScopeUI();
}

function candidateMatchesSimStatusScope(candidate, scope) {
  scope = scope || getActiveSimStatusScope();
  if (!scope || scope.includeAll) return true;
  const st = getProfileStatusForCandidate(candidate);
  if (!st) return false;
  return scope.statusIds.includes(Number(st.statusId));
}

function simulationCandidatePool(program) {
  const base = allCandidates().filter(c => effectiveMark(c, program) != null);
  const scope = getActiveSimStatusScope();
  if (!scope || scope.includeAll) {
    return { candidates: base, scope, sourceCandidateCount: base.length, includedCandidateCount: base.length, excludedByStatusCount: 0, missingStatusCount: 0, statusUnavailable: false };
  }
  const statusCount = Object.keys(SIM.profileStatus.byId || {}).length;
  const included = [];
  let missingStatusCount = 0;
  for (const cand of base) {
    const st = getProfileStatusForCandidate(cand);
    if (!st) { missingStatusCount++; continue; }
    if (scope.statusIds.includes(Number(st.statusId))) included.push(cand);
  }
  return { candidates: included, scope, sourceCandidateCount: base.length, includedCandidateCount: included.length, excludedByStatusCount: base.length - included.length, missingStatusCount, statusUnavailable: !statusCount };
}

// ── Consent Interactive ──

function runPlacementFromPool(program, pool, excludedApplicantIds) {
  excludedApplicantIds = excludedApplicantIds || new Set();
  const excluded = new Set([...excludedApplicantIds].map(String));
  const cands = pool.candidates.filter(c => !excluded.has(String(c.applicantId)));
  if (!cands.length) return null;
  const tree = buildSeatTree(program);
  const result = runPlacement(cands, tree, program, SIM.sim.parentBonus);
  result.statusScope = pool.scope;
  result.sourceCandidateCount = pool.sourceCandidateCount;
  result.includedCandidateCount = cands.length;
  result.excludedByStatusCount = pool.excludedByStatusCount;
  result.missingStatusCount = pool.missingStatusCount;
  result.excludedByConsentCount = pool.candidates.length - cands.length;
  return result;
}

function resetInteractiveConsentState() {
  SIM.sim.noConsentIds = new Set();
  SIM.sim.lastConsentReport = null;
  SIM.consent.lastReport = null;
}

function updateSimConsentModeHint() {
  const sel = document.getElementById('simConsentMode');
  const hint = document.getElementById('simConsentModeHint');
  if (sel) sel.value = SIM.sim.consentMode || 'view';
  if (!hint) return;
  if (SIM.sim.consentMode === 'no-consent') {
    hint.textContent = 'Click a candidate in results to remove them from the active consent pool and rerun.';
  } else if (SIM.sim.consentMode === 'consent') {
    hint.textContent = 'Click restore on removed candidates, or click a candidate to confirm they stay in the pool.';
  } else {
    hint.textContent = 'Click candidates to open their placement detail.';
  }
}

function applyInteractiveConsentChoice(candidateId, mode) {
  const id = String(candidateId || '').trim();
  if (!id) return;
  const program = SIM.sim.program;
  const pool = simulationCandidatePool(program);
  const candidate = allCandidates().find(c => String(c.applicantId) === id);
  if (!candidate) { showToast('Applicant ID ' + id + ' was not found.', 'warning'); return; }
  if (!pool.candidates.some(c => String(c.applicantId) === id)) {
    showToast(candidate.nameFull + ' is outside the active ' + program + ' status scope.', 'warning');
    return;
  }
  const baseline = runPlacementFromPool(program, pool);
  if (!baseline) { showToast('Run simulation first.', 'warning'); return; }
  if (mode === 'no-consent') SIM.sim.noConsentIds.add(id);
  else if (mode === 'consent') SIM.sim.noConsentIds.delete(id);
  const variant = SIM.sim.noConsentIds.size ? runPlacementFromPool(program, pool, SIM.sim.noConsentIds) : baseline;
  if (!variant) { showToast('No placement result could be generated after consent change.', 'error'); return; }
  const report = buildConsentReport({ mode, program, candidateId: id, candidate, baseline, variant, pool });
  SIM.sim.baselineResult = baseline;
  SIM.sim.result = variant;
  SIM.sim.lastConsentReport = report;
  SIM.consent.lastReport = report;
  addConsentHistory(report);
  renderSimResults();
  if (SIM.activeTab === 'consent') renderConsentReport(report);
  if (SIM.sb.program === program) renderSlot();
  const action = mode === 'no-consent' ? 'removed from active pool' : 'kept/restored in active pool';
  showToast(candidate.nameFull.split(' ').slice(0, 3).join(' ') + ' ' + action + '; simulation rerun.', 'success');
}

function restoreNoConsentCandidate(candidateId) {
  const id = String(candidateId || '').trim();
  if (!id) return;
  if (id === '__all') {
    if (!SIM.sim.noConsentIds.size) return;
    SIM.sim.noConsentIds = new Set();
    const pool = simulationCandidatePool(SIM.sim.program);
    const baseline = runPlacementFromPool(SIM.sim.program, pool);
    if (!baseline) return;
    SIM.sim.baselineResult = baseline;
    SIM.sim.result = baseline;
    SIM.sim.lastConsentReport = null;
    SIM.consent.lastReport = null;
    renderSimResults();
    if (SIM.sb.program === SIM.sim.program) renderSlot();
    showToast('All no-consent candidates restored; baseline simulation shown.', 'success');
    return;
  }
  applyInteractiveConsentChoice(id, 'consent');
}

// ── Consent What-If Tab ──

function setupConsentWhatIfTab() {
  SIM.consent.history = loadConsentHistory();
  const progSel = document.getElementById('consentProgram');
  const idInput = document.getElementById('consentCandidateId');
  if (progSel) progSel.value = SIM.consent.program;
  if (idInput && SIM.myId) idInput.value = SIM.myId;
  progSel?.addEventListener('change', function (e) { SIM.consent.program = e.target.value; });
  idInput?.addEventListener('input', function (e) { SIM.consent.candidateId = e.target.value.trim(); });
  idInput?.addEventListener('keydown', function (e) { if (e.key === 'Enter') runConsentWhatIf('no-consent'); });
  document.getElementById('runConsentNoBtn')?.addEventListener('click', function () { runConsentWhatIf('no-consent'); });
  document.getElementById('runConsentYesBtn')?.addEventListener('click', function () { runConsentWhatIf('consent'); });
  document.getElementById('consentUseMeBtn')?.addEventListener('click', function () {
    if (!SIM.myId) { showToast('Find yourself first, then use this shortcut.', 'warning'); return; }
    if (idInput) { idInput.value = SIM.myId; SIM.consent.candidateId = SIM.myId; }
  });
  document.getElementById('clearConsentHistoryBtn')?.addEventListener('click', function () {
    SIM.consent.history = [];
    localStorage.removeItem(CONSENT_HISTORY_KEY);
    renderConsentHistory();
  });
  renderConsentWhatIfTab();
}

function renderConsentWhatIfTab() {
  const progSel = document.getElementById('consentProgram');
  if (progSel) progSel.value = SIM.consent.program || 'FCPS';
  renderConsentHistory();
  if (SIM.consent.lastReport) renderConsentReport(SIM.consent.lastReport);
}

function loadConsentHistory() {
  try { const p = JSON.parse(localStorage.getItem(CONSENT_HISTORY_KEY) || '[]'); return Array.isArray(p) ? p.slice(0, MAX_CONSENT_HISTORY) : []; }
  catch (_) { return []; }
}

function saveConsentHistory() {
  localStorage.setItem(CONSENT_HISTORY_KEY, JSON.stringify(SIM.consent.history.slice(0, MAX_CONSENT_HISTORY)));
}

function addConsentHistory(report) {
  SIM.consent.history = [report, ...SIM.consent.history.filter(function (r) { return r.id !== report.id; })].slice(0, MAX_CONSENT_HISTORY);
  saveConsentHistory();
  renderConsentHistory();
}

function runConsentWhatIf(mode) {
  const program = document.getElementById('consentProgram')?.value || SIM.consent.program || 'FCPS';
  const candidateId = String(document.getElementById('consentCandidateId')?.value || SIM.consent.candidateId || '').trim();
  if (!candidateId) { showToast('Enter the Applicant ID to simulate consent or no consent.', 'warning'); return; }
  SIM.consent.program = program;
  SIM.consent.candidateId = candidateId;
  const sourceCandidate = allCandidates().find(function (c) { return String(c.applicantId) === candidateId; });
  if (!sourceCandidate) { showToast('Applicant ID ' + candidateId + ' was not found in the candidate pool.', 'warning'); return; }
  if (effectiveMark(sourceCandidate, program) == null) { showToast(sourceCandidate.nameFull + ' is not in the ' + program + ' pool.', 'warning'); return; }
  const pool = simulationCandidatePool(program);
  if (!pool.sourceCandidateCount) { showToast('No candidates for ' + program + '.', 'warning'); return; }
  if (!pool.candidates.length) {
    const scopeLabel = pool.scope?.label || 'selected status scope';
    showToast(pool.statusUnavailable ? 'Verification status data is not loaded yet. Try again shortly or use All candidates.' : 'No ' + program + ' candidates match "' + scopeLabel + '".', 'warning');
    return;
  }
  if (!pool.candidates.some(function (c) { return String(c.applicantId) === candidateId; })) {
    showToast(sourceCandidate.nameFull + ' is outside the active status scope.', 'warning');
    return;
  }
  const btn = document.getElementById(mode === 'no-consent' ? 'runConsentNoBtn' : 'runConsentYesBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Running...'; }
  setTimeout(function () {
    try {
      const baseline = runPlacementFromPool(program, pool);
      const variant = mode === 'no-consent' ? runPlacementFromPool(program, pool, new Set([candidateId])) : baseline;
      if (!baseline || !variant) throw new Error('No placement result could be generated.');
      const report = buildConsentReport({ mode, program, candidateId, candidate: sourceCandidate, baseline, variant, pool });
      SIM.sim.program = program;
      SIM.sim.baselineResult = baseline;
      SIM.sim.noConsentIds = mode === 'no-consent' ? new Set([candidateId]) : new Set();
      SIM.sim.result = variant;
      SIM.sim.lastConsentReport = report;
      SIM.consent.lastReport = report;
      var simProgSel = document.getElementById('simProgram');
      if (simProgSel) simProgSel.value = program;
      addConsentHistory(report);
      renderConsentReport(report);
      renderSimResults();
      if (SIM.sb.program === program) renderSlot();
    } catch (e) {
      console.error(e);
      showToast('Consent what-if error: ' + e.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = mode === 'no-consent' ? 'Run: candidate does not consent' : 'Show if candidate consents'; }
    }
  }, 30);
}

function buildConsentReport(_a) {
  var mode = _a.mode, program = _a.program, candidateId = _a.candidateId, candidate = _a.candidate, baseline = _a.baseline, variant = _a.variant, pool = _a.pool;
  var baselineMap = buildPlacementRecordMap(baseline);
  var variantMap = buildPlacementRecordMap(variant);
  var keys = new Set([...baselineMap.keys(), ...variantMap.keys()]);
  var changedCandidates = [];
  var _iterator = keys.values(), _step;
  while (!(_step = _iterator.next()).done) {
    var key = _step.value;
    var before = baselineMap.get(key) || null;
    var after = variantMap.get(key) || null;
    if (!placementChanged(before, after)) continue;
    changedCandidates.push(buildConsentChangeRow(before, after, candidateId));
  }
  changedCandidates.sort(function (a, b) {
    return (a.candidateId === candidateId ? -1 : b.candidateId === candidateId ? 1 : 0) || a.name.localeCompare(b.name);
  });
  var changedCandidateCount = changedCandidates.length;
  var baselinePlacements = [...baselineMap.values()].filter(function (r) { return String(r.applicantId) === candidateId; }).sort(function (a, b) { return trackSort(a.track) - trackSort(b.track); });
  var variantPlacements = [...variantMap.values()].filter(function (r) { return String(r.applicantId) === candidateId; }).sort(function (a, b) { return trackSort(a.track) - trackSort(b.track); });
  var releasedSlots = mode === 'no-consent' ? baselinePlacements.filter(function (r) { return r.placed; }).map(function (r) { return Object.assign({}, r, { incoming: addedOccupantsForSlot(baseline, variant, r.q, r.s, r.h) }); }) : [];
  return { id: Date.now() + '_' + candidateId + '_' + program.replace(/[^a-z0-9]+/gi, '-'), createdAt: Date.now(), mode: mode, program: program, candidateId: candidateId, candidateName: candidate.nameFull, candidateMarks: effectiveMark(candidate, program), marksBasis: getActiveMarksLabel(), parentBonus: SIM.sim.parentBonus, statusLabel: pool.scope?.label || 'All candidates', baselinePlacedCount: baseline.candidates.filter(function (c) { return c.placed; }).length, variantPlacedCount: variant.candidates.filter(function (c) { return c.placed; }).length, baselineTotal: baseline.candidates.length, variantTotal: variant.candidates.length, baselinePlacements: baselinePlacements, variantPlacements: variantPlacements, releasedSlots: releasedSlots, changedCandidateCount: changedCandidateCount, changedCandidates: changedCandidates.slice(0, 100) };
}

function buildPlacementRecordMap(result) {
  var map = new Map();
  for (var _i = 0, _c = result.candidates || []; _i < _c.length; _i++) {
    var c = _c[_i];
    var placedPref = c.placed ? c._prefs?.find(function (p) { return p.quotaName === c._q && p.specialityName === c._s && p.hospitalName === c._h; }) : null;
    var rec = { key: simRecordKey(c.applicantId, c._track), applicantId: String(c.applicantId), name: c.nameFull, marksTotal: c.marksTotal, track: c._track, trackLabel: c._trackLabel || quotaTrackLabel(c._track), placed: !!c.placed, q: c._q, s: c._s, h: c._h, prefNo: placedPref?.preferenceNo ?? null };
    map.set(rec.key, rec);
  }
  return map;
}

function placementChanged(before, after) {
  if (!before || !after) return true;
  return before.placed !== after.placed || before.q !== after.q || before.s !== after.s || before.h !== after.h || before.prefNo !== after.prefNo;
}

function buildConsentChangeRow(before, after, targetCandidateId) {
  var ref = after || before;
  var isTarget = String(ref.applicantId) === String(targetCandidateId);
  var type = 'move', label = 'Changed';
  if (isTarget && before && !after) { type = 'remove'; label = 'No consent'; }
  else if ((!before || !before.placed) && after?.placed) { type = 'gain'; label = 'Newly placed'; }
  else if (before?.placed && after?.placed) { type = 'move'; label = 'Moved'; }
  else if (before?.placed && (!after || !after.placed)) { type = 'remove'; label = 'No longer placed'; }
  return { candidateId: ref.applicantId, name: ref.name, trackLabel: ref.trackLabel, marksTotal: ref.marksTotal, type: type, label: label, before: placementText(before), after: placementText(after) };
}

function placementText(rec) {
  if (!rec) return 'Not in pool';
  if (!rec.placed) return rec.trackLabel + ': not placed';
  return rec.trackLabel + ': ' + rec.s + ' @ ' + shortHospital(rec.h) + ' (' + rec.q + (rec.prefNo ? ', Pref #' + rec.prefNo : '') + ')';
}

function shortHospital(name) {
  return String(name || '').split(',')[0].trim() || 'Unknown hospital';
}

function addedOccupantsForSlot(baseline, variant, q, s, h) {
  var before = slotOccupantKeys(baseline, q, s, h);
  var sl = variant.seatTree?.[q]?.[s]?.[h];
  if (!sl) return [];
  return (sl.candidates || []).filter(function (c) { return !before.has(simRecordKey(c.applicantId, c._track)); }).map(function (c) { return { applicantId: String(c.applicantId), name: c.nameFull, marksTotal: c.marksTotal, preferenceNo: c.preferenceNo, trackLabel: c._trackLabel || quotaTrackLabel(c._track) }; });
}

function slotOccupantKeys(result, q, s, h) {
  var sl = result.seatTree?.[q]?.[s]?.[h];
  return new Set((sl?.candidates || []).map(function (c) { return simRecordKey(c.applicantId, c._track); }));
}

// ── Consent Rendering ──

function renderConsentReport(report) {
  var container = document.getElementById('consentResults');
  if (!container) return;
  var noConsent = report.mode === 'no-consent';
  var visibleTargetChanges = report.changedCandidates.filter(function (c) { return c.candidateId === report.candidateId; }).length;
  var changedExcludingTarget = Math.max(0, (report.changedCandidateCount ?? report.changedCandidates.length) - visibleTargetChanges);
  var placementRows = report.baselinePlacements.length
    ? report.baselinePlacements.map(function (r) { return consentPlacementRowHtml(r, noConsent ? 'Baseline if consented' : 'Projected'); }).join('')
    : '<p class="consent-empty">This candidate is not placed in the baseline run.</p>';
  var releasedRows = report.releasedSlots.length
    ? report.releasedSlots.map(function (slot) { return consentReleasedSlotHtml(slot); }).join('')
    : '<p class="consent-empty">' + (noConsent ? 'No occupied seat was released because this candidate was not placed.' : 'Consent keeps the normal allocation unchanged.') + '</p>';
  var changeRows = report.changedCandidates.length
    ? report.changedCandidates.slice(0, 60).map(function (c) { return consentChangeRowHtml(c); }).join('')
    : '<p class="consent-empty">No placement changes detected.</p>';
  container.className = 'consent-report';
  container.innerHTML =
    '<div class="consent-summary-grid">' +
      '<div><span class="consent-sum-val">' + esc(report.program) + '</span><span class="consent-sum-lbl">Programme</span></div>' +
      '<div><span class="consent-sum-val">' + (noConsent ? report.releasedSlots.length : 0) + '</span><span class="consent-sum-lbl">Released slots</span></div>' +
      '<div><span class="consent-sum-val">' + changedExcludingTarget + '</span><span class="consent-sum-lbl">Others changed</span></div>' +
      '<div><span class="consent-sum-val">' + (report.variantPlacedCount - report.baselinePlacedCount >= 0 ? '+' : '') + (report.variantPlacedCount - report.baselinePlacedCount) + '</span><span class="consent-sum-lbl">Placed count delta</span></div>' +
    '</div>' +
    '<div class="consent-report-card">' +
      '<h3>' + esc(report.candidateName) + ' <span class="consent-impact-pill ' + (noConsent ? 'remove' : 'gain') + '">' + (noConsent ? 'No consent scenario' : 'Consent scenario') + '</span></h3>' +
      '<p style="margin:0 0 10px;color:var(--text-muted);font-size:0.8rem">ID ' + esc(report.candidateId) + ' &middot; ' + esc(report.program) + ' marks ' + fmtM(report.candidateMarks) + ' &middot; Merit basis: ' + esc(report.marksBasis) + ' &middot; Status: ' + esc(report.statusLabel) + (report.parentBonus ? ' &middot; Parent bonus on' : '') + '</p>' +
      '<div class="consent-placement-list">' + placementRows + '</div>' +
    '</div>' +
    '<div class="consent-report-card">' +
      '<h3>Released seat and who moves in</h3>' +
      '<div class="consent-slot-list">' + releasedRows + '</div>' +
    '</div>' +
    '<div class="consent-report-card">' +
      '<h3>Changed subsequent list</h3>' +
      '<div class="consent-change-list">' + changeRows + '</div>' +
      ((report.changedCandidateCount ?? report.changedCandidates.length) > 60 ? '<p class="consent-empty">Showing first 60 changed records.</p>' : '') +
    '</div>';
}

function consentPlacementRowHtml(rec, label) {
  return '<div class="consent-placement-row"><div><span class="consent-row-title">' + esc(placementText(rec)) + '</span><span class="consent-row-meta">' + esc(label) + ' &middot; Marks ' + fmtM(rec.marksTotal) + '</span></div><span class="consent-impact-pill">' + esc(rec.trackLabel) + '</span></div>';
}

function consentReleasedSlotHtml(slot) {
  var incoming = slot.incoming?.length ? slot.incoming.map(function (c) { return esc(c.name) + ' (' + fmtM(c.marksTotal) + ', P' + (c.preferenceNo || '?') + ')'; }).join('<br>') : 'No new occupant found in this slot.';
  return '<div class="consent-slot-row"><div><span class="consent-row-title">' + esc(slot.s) + ' @ ' + esc(shortHospital(slot.h)) + '</span><span class="consent-row-meta">' + esc(slot.q) + ' &middot; vacated by ' + esc(slot.name) + ' &middot; incoming:<br>' + incoming + '</span></div><span class="consent-impact-pill move">' + esc(slot.trackLabel) + '</span></div>';
}

function consentChangeRowHtml(change) {
  return '<div class="consent-change-row"><div><span class="consent-row-title">' + esc(change.name) + ' <span style="color:var(--text-muted);font-weight:500">ID ' + esc(change.candidateId) + '</span></span><span class="consent-row-meta">Before: ' + esc(change.before) + '</span><span class="consent-row-meta">After: ' + esc(change.after) + '</span></div><span class="consent-impact-pill ' + esc(change.type) + '">' + esc(change.label) + '</span></div>';
}

function renderConsentHistory() {
  var list = document.getElementById('consentHistoryList');
  if (!list) return;
  if (!SIM.consent.history.length) {
    list.innerHTML = '<div class="consent-history-empty">No scenarios yet. Run a consent/no-consent comparison and it will be kept here on this device.</div>';
    return;
  }
  list.innerHTML = SIM.consent.history.map(function (r) {
    var dt = new Date(r.createdAt).toLocaleString('en-PK', { dateStyle: 'short', timeStyle: 'short' });
    var targetChanges = r.changedCandidates?.filter(function (c) { return c.candidateId === r.candidateId; }).length || 0;
    var changed = Math.max(0, (r.changedCandidateCount ?? r.changedCandidates?.length ?? 0) - targetChanges);
    return '<button class="consent-history-item" data-id="' + esc(r.id) + '" type="button"><span class="consent-history-title">' + esc(r.candidateName) + '</span><span class="consent-history-meta">' + esc(r.program) + ' &middot; ' + (r.mode === 'no-consent' ? 'No consent' : 'Consent') + ' &middot; ' + esc(dt) + '</span><span class="consent-history-impact">' + (r.releasedSlots?.length || 0) + ' released &middot; ' + changed + ' other change' + (changed === 1 ? '' : 's') + '</span></button>';
  }).join('');
  list.querySelectorAll('.consent-history-item').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var report = SIM.consent.history.find(function (r) { return r.id === btn.dataset.id; });
      if (!report) return;
      SIM.consent.lastReport = report;
      var progSel = document.getElementById('consentProgram');
      var idInput = document.getElementById('consentCandidateId');
      if (progSel) progSel.value = report.program;
      if (idInput) idInput.value = report.candidateId;
      renderConsentReport(report);
    });
  });
}

// ── Banner ──

function renderSimConsentBanner() {
  var ids = [...(SIM.sim.noConsentIds || new Set())];
  var report = SIM.sim.lastConsentReport;
  if (!ids.length && !report) return '';
  var nameFor = function (id) { var c = allCandidates().find(function (c) { return String(c.applicantId) === String(id); }); return c ? c.nameFull.split(' ').slice(0, 3).join(' ') : 'ID ' + id; };
  var chips = ids.length ? '<div class="sim-consent-chip-row">' + ids.map(function (id) { return '<span class="sim-consent-chip">' + esc(nameFor(id)) + ' <button type="button" title="Restore candidate as consented" data-consent-restore="' + esc(id) + '">&times;</button></span>'; }).join('') + '</div>' : '';
  var impact = '';
  var movement = '';
  if (report) {
    var targetChanges = report.changedCandidates?.filter(function (c) { return c.candidateId === report.candidateId; }).length || 0;
    var othersChanged = Math.max(0, (report.changedCandidateCount ?? report.changedCandidates?.length ?? 0) - targetChanges);
    var delta = report.variantPlacedCount - report.baselinePlacedCount;
    impact = '<div class="sim-consent-impact-mini"><div><strong>' + (report.mode === 'no-consent' ? report.releasedSlots.length : 0) + '</strong>Seat' + (report.releasedSlots.length === 1 ? '' : 's') + ' vacated by clicked candidate</div><div><strong>' + othersChanged + '</strong>Other placement change' + (othersChanged === 1 ? '' : 's') + '</div><div><strong>' + (delta >= 0 ? '+' : '') + delta + '</strong>Placed-count delta</div></div>';
    if (report.releasedSlots?.length) {
      movement = '<div class="sim-consent-chip-row">' + report.releasedSlots.map(function (slot) {
        var incoming = slot.incoming?.length ? slot.incoming.map(function (c) { return esc(c.name) + ' (' + fmtM(c.marksTotal) + ')'; }).join(', ') : 'no move-in candidate';
        return '<span class="sim-consent-chip" style="color:var(--neon-gold);border-color:rgba(232,166,39,0.28);background:rgba(232,166,39,0.08);">Vacated: ' + esc(slot.s) + ' @ ' + esc(shortHospital(slot.h)) + ' &rarr; ' + incoming + '</span>';
      }).join('') + '</div>';
    }
  }
  return '<div class="sim-consent-banner"><div class="sim-consent-banner-head"><div><div class="sim-consent-banner-title">Interactive consent simulation active</div><div class="sim-consent-banner-text">The allocation grid below has been rerun with no-consent candidates removed from the active pool. Replacement candidates now appear in their new slots.</div></div>' + (ids.length ? '<button class="btn btn-sm" type="button" data-consent-restore="__all">Restore all</button>' : '') + '</div>' + chips + impact + movement + '</div>';
}

// ── Update sim download gate ──

function updateSimulationDownloadGate() {
  var btn = document.getElementById('simDownloadPdfBtn');
  var note = document.getElementById('simDownloadNote');
  if (!btn || !note) return;
  var isDonor = !!SIM.donor.current;
  var hasResult = !!SIM.sim.result;
  btn.disabled = !(isDonor && hasResult);
  note.textContent = isDonor ? (hasResult ? 'Watermarked to your login' : 'Run simulation first') : 'Supporter-only export';
}

// ── Track sort helper ──

function trackSort(track) {
  var order = { Open: 0, 'Punjab (Open)': 1, Punjab: 2, 'Sindh (Open)': 3, Sindh: 4, 'KPK (Open)': 5, KPK: 6, 'Balochistan (Open)': 7, Balochistan: 8, 'AJK (Open)': 9, AJK: 10, 'GB (Open)': 11, GB: 12 };
  return order[track] != null ? order[track] : 99;
}

function readConfigBool(val, def) {
  return val === true || val === false ? val : def;
}

// ── Init ──

document.addEventListener('DOMContentLoaded', function () {
  initSimulationConfig();
  setupSimulationStatusScopeSelector();
  setupConsentWhatIfTab();
});
