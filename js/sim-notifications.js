// ═══════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  SIM.myId      = localStorage.getItem(MY_ID_KEY) || null;
  SIM.customCand = ensureCandidateAdjusted(loadCustomCand());

  initLiveBanner();
  initFetchProgress();
  initSimulationNotificationFeed();
  initMarksConfig();
  initScheduleTab();
  initProfileStatus();
  showLoading(true);
  await loadData();
  initDonorEntitlements();
  showLoading(false);
  renderNotifications();

  setupTabs();
  setupHamburger();
  handleSimURLParams();
  setupFindMe();
  setupCandidateFilters();
  applyAndRenderCandidates();
  renderCandStats();
  setupSlotBrowser();
  setupSimulationTab();
  setupMarksSelectors();
  setupCandidateRevisionSelectors();
  setupConfigBadgeNavs();
  setupChat();
  updateMyBadge();

  // If navigated from profile "Run My Simulation" — scroll to the YOU row
  if (localStorage.getItem('mn_sim_open_candidates') === '1') {
    localStorage.removeItem('mn_sim_open_candidates');
    if (SIM.myId) {
      setTimeout(() => {
        const row = document.querySelector('tr.row-me');
        if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 350);
    }
  }

  document.getElementById('candidateModalOverlay')
    ?.addEventListener('click', closeModal);
  document.getElementById('candidateModalClose')
    ?.addEventListener('click', closeModal);
  document.getElementById('customModalClose')
    ?.addEventListener('click', closeCustomModal);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeSbModal();
      closeApplicantSimulationModal();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════
function renderNotifications() {
  MNNotif.renderFeedBar(document.getElementById('notifBar'), SIM.notifications, esc);
}

// ═══════════════════════════════════════════════════════════════════
// PROFILE STATUS (portal verification — Firestore / static JSON)
// ═══════════════════════════════════════════════════════════════════
const PROFILE_STATUS = {
  unsubscribe:     null,
  ready:             false,
  lastFingerprint:   null,
};

function normalizeProfileStatusEntries(raw, outMeta) {
  if (Array.isArray(raw)) return raw;

  if (raw?.statusTypes && typeof raw.statusTypes === 'object') {
    const entries = [];
    if (outMeta) outMeta._fromV2 = true;
    for (const [typeId, td] of Object.entries(raw.statusTypes)) {
      if (td?.label != null && outMeta) {
        outMeta[typeId] = { label: td.label, statusLabels: td.statusLabels || {} };
      }
    }
    const arr = Array.isArray(raw.entries) ? raw.entries : (Array.isArray(raw.Table) ? raw.Table : []);
    for (const e of arr) {
      if (e.applicantId == null) continue;
      entries.push({
        applicantId:   e.applicantId,
        statusId:      e.statusId ?? 0,
        statusTypeId:  e.statusTypeId ?? 131,
        remarks:       e.remarks ?? null,
      });
    }
    return entries;
  }

  if (raw?.entries && Array.isArray(raw.entries)) return raw.entries;
  if (raw?.Table && Array.isArray(raw.Table)) return raw.Table;
  return null;
}

function _profileStatusUpdatedKey(payload) {
  const v2u = payload?.meta?.updatedAt ?? payload?.meta?.updated;
  const u = v2u ?? payload?.updatedAt ?? payload?.updated;
  if (u?.seconds != null) return String(u.seconds);
  if (u?.toMillis) return String(u.toMillis());
  return String(u || '');
}

function _profileStatusFingerprint(byId, payload) {
  let accepted = 0, pending = 0, rejected = 0, other = 0;
  for (const st of Object.values(byId || {})) {
    const sid = Number(st.statusId);
    if (sid === 1) accepted++;
    else if (sid === 11) pending++;
    else if (sid === 2) rejected++;
    else other++;
  }
  return [
    Object.keys(byId || {}).length,
    accepted, pending, rejected, other,
    _profileStatusUpdatedKey(payload),
  ].join(':');
}

function _profileStatusCounts(byId) {
  let accepted = 0, pending = 0, rejected = 0;
  for (const st of Object.values(byId || {})) {
    const sid = Number(st.statusId);
    if (sid === 1) accepted++;
    else if (sid === 11) pending++;
    else if (sid === 2) rejected++;
  }
  return { accepted, pending, rejected };
}

function _notifyProfileStatusUpdated(prevMyStatus) {
  const total = Object.keys(SIM.profileStatus.byId).length;
  const typeLabel = SIM.profileStatus.typeLabel || 'Profile verification';
  const counts = _profileStatusCounts(SIM.profileStatus.byId);
  let msg = `${typeLabel} updated — ${total.toLocaleString()} applicants (${counts.accepted} accepted, ${counts.pending} pending, ${counts.rejected} rejected).`;
  let toastType = 'info';

  if (SIM.myId) {
    const myNew = SIM.profileStatus.byId[String(SIM.myId)];
    const prevSid = prevMyStatus?.statusId;
    const newSid = myNew?.statusId;
    if (myNew && prevSid != null && Number(prevSid) !== Number(newSid)) {
      msg = `Your verification status changed: ${profileStatusLabel(prevSid)} → ${profileStatusLabel(newSid)}`;
      toastType = 'success';
    } else if (myNew && prevMyStatus == null) {
      msg = `Your verification status is now: ${profileStatusLabel(newSid)}`;
      toastType = 'success';
    }
  }

  showToast(msg, toastType);
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      new Notification('MeritNama — Verification status update', {
        body: msg,
        tag: 'mn_profile_status_update',
      });
    } catch (_) {}
  }
}

function applyProfileStatusPayload(payload, sourceLabel, opts = {}) {
  const meta = {};
  const entries = normalizeProfileStatusEntries(payload, meta);
  if (!entries?.length) return false;

  const prevMyStatus = SIM.myId ? SIM.profileStatus.byId[String(SIM.myId)] : null;
  const prevFp = PROFILE_STATUS.lastFingerprint;
  const wasReady = PROFILE_STATUS.ready;
  const notifyLive = opts.notify !== false && sourceLabel === 'live';

  const types = {};
  const byId = {};
  const primaryTypeId = String(payload?.statusTypeId || 131);

  const statusLabelsPayload = {};
  if (payload?.statusLabels && typeof payload.statusLabels === 'object') {
    statusLabelsPayload[primaryTypeId] = payload.statusLabels;
  }

  for (const e of entries) {
    if (e.applicantId == null) continue;
    const tid = String(e.statusTypeId || primaryTypeId);
    if (!types[tid]) {
      const m = meta[tid] || {};
      types[tid] = {
        byId: {},
        labels: m.statusLabels || { ...(payload?.statusLabels || {}) },
        typeLabel: m.label || (tid === primaryTypeId ? (payload?.statusTypeLabel || 'Profile verification') : `Status Type ${tid}`),
      };
    }
    types[tid].byId[String(e.applicantId)] = {
      statusId:     e.statusId ?? 0,
      statusTypeId: Number(tid),
      remarks:      e.remarks ?? null,
    };
    if (tid === primaryTypeId) {
      byId[String(e.applicantId)] = types[tid].byId[String(e.applicantId)];
    }
  }

  SIM.profileStatus.types = types;
  SIM.profileStatus.byId = byId;

  if (types[primaryTypeId]) {
    SIM.profileStatus.labels = types[primaryTypeId].labels;
    SIM.profileStatus.typeLabel = types[primaryTypeId].typeLabel;
  } else {
    const first = Object.values(types)[0];
    if (first) {
      SIM.profileStatus.labels = first.labels;
      SIM.profileStatus.typeLabel = first.typeLabel;
    }
  }

  SIM.profileStatus.source = sourceLabel || 'unknown';

  const v2Updated = payload?.meta?.updatedAt || payload?.meta?.updated;
  SIM.profileStatus.updatedAt = v2Updated ?? payload?.updated ?? payload?.updatedAt ?? null;

  SIM.profileStatus.loaded = true;
  // Notify scope UI to update hint (listener set up in sim-consent.js)
  document.dispatchEvent(new CustomEvent('profileStatusLoaded', { detail: { byId } }));

  const fp = _profileStatusFingerprint(byId, payload);
  PROFILE_STATUS.lastFingerprint = fp;
  PROFILE_STATUS.ready = true;

  if (notifyLive && wasReady && prevFp && fp !== prevFp) {
    _notifyProfileStatusUpdated(prevMyStatus);
  }

  return true;
}

function getProfileStatusForCandidate(c, typeId) {
  if (!c || c.applicantId == null) return null;
  if (typeId != null) {
    return SIM.profileStatus.types[String(typeId)]?.byId[String(c.applicantId)] || null;
  }
  return SIM.profileStatus.byId[String(c.applicantId)] || null;
}

function getEffectiveProfileStatusForCandidate(c) {
  if (!c || c.applicantId == null) return null;
  const st132 = SIM.profileStatus.types['132']?.byId[String(c.applicantId)];
  if (st132) return st132;
  return getProfileStatusForCandidate(c);
}

function getAllProfileStatusesForCandidate(c) {
  if (!c || c.applicantId == null) return [];
  const result = [];
  for (const [tid, td] of Object.entries(SIM.profileStatus.types)) {
    const st = td.byId[String(c.applicantId)];
    if (st) result.push({ ...st, _typeLabel: td.typeLabel, _statusLabels: td.labels });
  }
  return result;
}

/**
 * Candidate Status Aggregator
 * Returns a unified summary of a candidate's profile status across all types (131, 132).
 */
function getCandidateStatusSummary(c) {
  const all = getAllProfileStatusesForCandidate(c);
  const st131 = all.find(s => Number(s.statusTypeId) === 131) || null;
  const st132 = all.find(s => Number(s.statusTypeId) === 132) || null;

  const sid131 = st131 ? Number(st131.statusId) : null;
  const sid132 = st132 ? Number(st132.statusId) : null;

  // Effective: 132 overrides 131 — matches getEffectiveProfileStatusForCandidate
  const effective = getEffectiveProfileStatusForCandidate({ applicantId: c.applicantId });
  const effSid = effective ? Number(effective.statusId) : null;
  const isAccepted = effSid === 1;
  const isRejected = effSid === 2;
  const isPending = effSid === 11;

  return { st131, st132, all, isAccepted, isRejected, isPending, sid131, sid132 };
}

function countCandidatesByAcceptance(candidates) {
  let accepted = 0, pending = 0, rejected = 0, noStatus = 0;
  for (const c of candidates) {
    const s = getCandidateStatusSummary(c);
    if (!s.st131 && !s.st132) { noStatus++; continue; }
    if (s.isAccepted) accepted++;
    else if (s.isPending) pending++;
    else if (s.isRejected) rejected++;
    else noStatus++;
  }
  return { accepted, pending, rejected, noStatus };
}

function getProfileStatusTypeMeta(typeId) {
  const td = SIM.profileStatus.types[String(typeId)];
  if (!td) return null;
  return { typeLabel: td.typeLabel, labels: td.labels };
}

function profileStatusTypeLabel(typeId) {
  const m = getProfileStatusTypeMeta(typeId);
  return m?.typeLabel || `Status Type ${typeId}`;
}

function profileStatusLabel(statusId) {
  const key = String(statusId);
  return SIM.profileStatus.labels[key]
    || SIM.profileStatus.labels[statusId]
    || `Status ${statusId}`;
}

function _normalizeRemarkRaw(raw) {
  return String(raw)
    .trim()
    .replace(/^,+\s*/, '')
    .replace(/\s*,+$/, '')
    .replace(/\.\s*,+\s*/g, ', ')
    .replace(/,+/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
}

function _remarkDedupeKey(category, message) {
  const fold = (s) => String(s || '')
    .toLowerCase()
    .replace(/\b(is|are|the|a|an)\b/g, ' ')
    .replace(/\./g, ' ')
    .replace(/[^a-z0-9]+/g, '');
  const cat = category ? fold(category).replace(/^mdcar$/, 'mdcat') : '';
  const msg = fold(message);
  return cat ? `${cat}|${msg}` : msg;
}

function _parseRemarkPart(part) {
  const cleaned = part.replace(/^,+\s*/, '').replace(/\.\s*$/, '').trim();
  if (!cleaned) return null;

  const colonIdx = cleaned.indexOf(':');
  if (colonIdx > 0) {
    return {
      category: cleaned.slice(0, colonIdx).trim(),
      message: cleaned.slice(colonIdx + 1).trim() || cleaned,
    };
  }
  return { category: null, message: cleaned };
}

function parseProfileStatusRemarks(raw) {
  if (raw == null) return [];
  const s = _normalizeRemarkRaw(raw);
  if (!s) return [];

  const parts = s.split(/,\s*/).map(p => p.trim()).filter(Boolean);
  const seen = new Set();
  const items = [];

  for (const part of parts) {
    const item = _parseRemarkPart(part);
    if (!item) continue;

    const key = _remarkDedupeKey(item.category, item.message);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    items.push(item);
  }
  return items;
}

function formatProfileStatusRemarks(raw) {
  return parseProfileStatusRemarks(raw)
    .map(({ category, message }) => (category ? `${category}: ${message}` : message))
    .join('; ');
}

function profileStatusRemarksHtml(raw) {
  const items = parseProfileStatusRemarks(raw);
  if (!items.length) return '';
  const lis = items.map(({ category, message }) => {
    const cat = category
      ? `<span class="cand-ps-remark-cat">${esc(category)}</span>`
      : '';
    return `<li class="cand-ps-remark-item">${cat}<span class="cand-ps-remark-msg">${esc(message)}</span></li>`;
  }).join('');
  return `<div class="cand-ps-remarks">
    <p class="cand-ps-remarks-lbl">Remarks</p>
    <ul class="cand-ps-remarks-list">${lis}</ul>
  </div>`;
}

function profileStatusTagHtml(st) {
  if (!st) return '';
  const sid = Number(st.statusId);
  const cls = sid === 11 ? 'ps-pending' : sid === 1 ? 'ps-accepted' : sid === 2 ? 'ps-rejected' : 'ps-other';
  const typeLabel = st._typeLabel || SIM.profileStatus.typeLabel;
  const label = st._statusLabels?.[String(sid)] || profileStatusLabel(sid);
  const remarks = formatProfileStatusRemarks(st.remarks);
  const tip = [
    typeLabel,
    st.statusTypeId ? `(type ${st.statusTypeId})` : '',
    remarks ? `Remarks: ${remarks}` : '',
  ].filter(Boolean).join(' · ');
  return `<span class="profile-status-tag ${cls}" title="${esc(tip)}">${esc(label)}</span>`;
}

function profileStatusDetailHtml(st) {
  if (!st) return '';
  const typeLabel = st._typeLabel || SIM.profileStatus.typeLabel;
  return `<p class="cand-detail-meta" style="margin-top:6px">${profileStatusTagHtml(st)} <span style="color:var(--text-muted)">${esc(typeLabel)}</span></p>${profileStatusRemarksHtml(st.remarks)}`;
}

function profileStatusesDetailHtml(statuses) {
  if (!statuses?.length) return '';
  return statuses.map(st => profileStatusDetailHtml(st)).join('<hr style="border-color:rgba(77,184,217,0.08);margin:6px 0">');
}

async function loadProfileStatusData() {
  if (SIM.profileStatus.loading) return;
  SIM.profileStatus.loading = true;

  try {
    const snap = await firebase.firestore().collection('notifications').doc('profile_status').get();
    if (snap.exists && applyProfileStatusPayload(snap.data(), 'live', { notify: false })) {
      SIM.profileStatus.loading = false;
      _onProfileStatusReady();
      return;
    }
  } catch (e) {
    console.warn('[ProfileStatus] Firestore load failed:', e);
  }

  try {
    const res = await fetch('data/ProfileStatus.json', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (data.version === 2) {
        if (applyProfileStatusPayload(data, 'static_snapshot', { notify: false })) {
          SIM.profileStatus.loading = false;
          _onProfileStatusReady();
          return;
        }
      } else if (applyProfileStatusPayload({
        entries: data,
        statusTypeId: 131,
        statusTypeLabel: 'Verification : Round 01',
        statusLabels: { '1': 'Accepted', '2': 'Rejected', '11': 'Pending' },
      }, 'static_snapshot', { notify: false })) {
        SIM.profileStatus.loading = false;
        _onProfileStatusReady();
        return;
      }
    }
  } catch (e) {
    console.warn('[ProfileStatus] Static load failed:', e);
  }

  SIM.profileStatus.loaded = true;
  SIM.profileStatus.loading = false;
}

function _onProfileStatusReady() {
  renderCandStats();
  applyAndRenderCandidates();
  if (typeof updateCandStatusHint === 'function') updateCandStatusHint();
  if (typeof syncSimulationStatusScopeUI === 'function') syncSimulationStatusScopeUI();
}

function initProfileStatus() {
  loadProfileStatusData();

  try {
    if (PROFILE_STATUS.unsubscribe) PROFILE_STATUS.unsubscribe();
    PROFILE_STATUS.unsubscribe = firebase.firestore()
      .collection('notifications').doc('profile_status')
      .onSnapshot(snap => {
        if (snap.exists && applyProfileStatusPayload(snap.data(), 'live')) {
          _onProfileStatusReady();
        }
      }, err => console.warn('[ProfileStatus] listener error:', err));
  } catch (_) {}
}
