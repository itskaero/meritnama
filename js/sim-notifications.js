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

function normalizeProfileStatusEntries(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw?.entries && Array.isArray(raw.entries)) return raw.entries;
  if (raw?.Table && Array.isArray(raw.Table)) return raw.Table;
  return null;
}

function _profileStatusUpdatedKey(payload) {
  const u = payload?.updatedAt ?? payload?.updated;
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
  const entries = normalizeProfileStatusEntries(payload);
  if (!entries?.length) return false;

  const prevMyStatus = SIM.myId ? SIM.profileStatus.byId[String(SIM.myId)] : null;
  const prevFp = PROFILE_STATUS.lastFingerprint;
  const wasReady = PROFILE_STATUS.ready;
  const notifyLive = opts.notify !== false && sourceLabel === 'live';

  const byId = {};
  for (const e of entries) {
    if (e.applicantId == null) continue;
    byId[String(e.applicantId)] = {
      statusId:     e.statusId ?? 0,
      statusTypeId: e.statusTypeId ?? payload?.statusTypeId ?? null,
      remarks:      e.remarks ?? null,
    };
  }

  SIM.profileStatus.byId = byId;
  if (payload?.statusLabels && typeof payload.statusLabels === 'object') {
    SIM.profileStatus.labels = { ...payload.statusLabels };
  }
  if (payload?.statusTypeLabel) SIM.profileStatus.typeLabel = payload.statusTypeLabel;
  SIM.profileStatus.source = sourceLabel || 'unknown';
  SIM.profileStatus.updatedAt = payload?.updated || payload?.updatedAt || null;
  SIM.profileStatus.loaded = true;

  const fp = _profileStatusFingerprint(byId, payload);
  PROFILE_STATUS.lastFingerprint = fp;
  PROFILE_STATUS.ready = true;

  if (notifyLive && wasReady && prevFp && fp !== prevFp) {
    _notifyProfileStatusUpdated(prevMyStatus);
  }

  return true;
}

function getProfileStatusForCandidate(c) {
  if (!c || c.applicantId == null) return null;
  return SIM.profileStatus.byId[String(c.applicantId)] || null;
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
  const label = profileStatusLabel(sid);
  const remarks = formatProfileStatusRemarks(st.remarks);
  const tip = [
    SIM.profileStatus.typeLabel,
    st.statusTypeId ? `(type ${st.statusTypeId})` : '',
    remarks ? `Remarks: ${remarks}` : '',
  ].filter(Boolean).join(' · ');
  return `<span class="profile-status-tag ${cls}" title="${esc(tip)}">${esc(label)}</span>`;
}

function profileStatusDetailHtml(st) {
  if (!st) return '';
  return `<p class="cand-detail-meta" style="margin-top:6px">${profileStatusTagHtml(st)} <span style="color:var(--text-muted)">${esc(SIM.profileStatus.typeLabel)}</span></p>${profileStatusRemarksHtml(st.remarks)}`;
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
      if (applyProfileStatusPayload({
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
