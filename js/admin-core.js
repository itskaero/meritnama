'use strict';

const MNNotif = window.MNNotifications;

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// Dashboard core (must load before any other admin logic)
const ADMIN_SESSION_KEY = 'meritnama_admin_session';
const ADMIN_TAB_KEY = 'mn_admin_tab';
const SESSION_DURATION = 2 * 60 * 60 * 1000; // 2 hours

const DEFAULT_SIM_STATUS_SCOPES_ADMIN = [
  { id: 'all', label: 'All candidates', description: 'Do not filter by verification status.', includeAll: true, statusIds: [] },
  { id: 'accepted-pending', label: 'Accepted + Pending', description: 'Only candidates marked Accepted or Pending.', includeAll: false, statusIds: [1, 11] },
  { id: 'accepted', label: 'Accepted only', description: 'Only candidates marked Accepted.', includeAll: false, statusIds: [1] },
  { id: 'pending', label: 'Pending only', description: 'Only candidates marked Pending.', includeAll: false, statusIds: [11] },
  { id: 'rejected', label: 'Rejected only', description: 'Only candidates marked Rejected.', includeAll: false, statusIds: [2] },
];

const TAB_META = {
  overview:      { title: 'Overview',           sub: 'Platform metrics and live activity' },
  logs:          { title: 'Access Logs',        sub: 'Login attempts and portal access history' },
  screenshots:   { title: 'Screenshot Logs',    sub: 'Blocked screenshot and print attempts by signed-in users' },
  warnings:      { title: 'User Warnings',      sub: 'Send and review admin inbox messages for users' },
  grievances:    { title: 'Inbox Requests',     sub: 'Review candidate messages and approve data-responder drafts' },
  users:         { title: 'Authorized Users',   sub: 'Manage portal access and credentials' },
  'access-requests': { title: 'Access Requests', sub: 'Candidate self-service requests — approve to grant access' },
  profiles:      { title: 'User Profiles',      sub: 'Applicant and trainee profile data' },
  mentorship:    { title: 'Mentorship',         sub: 'Mentors and mentorship requests' },
  contributions: { title: 'Contributions',      sub: 'Financial contribution records' },
  broadcast:     { title: 'Broadcast', sub: 'Live banners, simulation feed, schedule, notifications' },
  config:        { title: 'Config', sub: 'Merit formulas, seat allocation, revisions, access config' },
  'download-logs': { title: 'Download Logs', sub: 'PDF and report download audit trail' },
  'user-activity': { title: 'User Activity', sub: 'Aggregated activity per user across all log sources' },
  candidates:      { title: 'Candidates',           sub: 'Induction 21 candidate browser — search, filter, view preferences and revisions' },
};

let allLogs = [];
let allScreenshotLogs = [];
let allDownloadLogs = [];
let allWarnings = [];
let allGrievances = [];
let grievanceDataRecords = [];
let responderSourcesAdmin = [];
const responderDatasetCacheAdmin = {};
let authUserMeta = { byEmail: {}, inviteesByInviter: {} };
let overviewMetricsCache = {};
let sessionTimerInterval = null;
let _toastTimer = null;

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function showPhotoModal(id) {
  var dataEl = document.getElementById(id + '_data');
  var imgEl = document.getElementById('photoLightboxImg');
  var lightbox = document.getElementById('photoLightbox');
  if (!dataEl || !imgEl || !lightbox) return;
  imgEl.src = dataEl.textContent;
  lightbox.classList.add('open');
}
function closePhotoModal(event) {
  if (event && event.target !== document.getElementById('photoLightbox') && event.target.tagName !== 'IMG') return;
  var lightbox = document.getElementById('photoLightbox');
  if (lightbox) lightbox.classList.remove('open');
}

function showAdminToast(msg, type = 'info') {
  const el = document.getElementById('adminToast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'admin-toast show' + (type === 'success' ? ' success' : type === 'error' ? ' error' : '');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

function getAdminSession() {
  try {
    const raw = localStorage.getItem(ADMIN_SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (s && typeof s.email === 'string' && typeof s.ts === 'number' && (Date.now() - s.ts) < SESSION_DURATION) return s;
  } catch (e) { /* ignore */ }
  return null;
}

function setAdminSession(email) {
  localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify({ email, ts: Date.now() }));
}

function clearAdminSession() {
  localStorage.removeItem(ADMIN_SESSION_KEY);
}

function startSessionTimer() {
  if (sessionTimerInterval) clearInterval(sessionTimerInterval);
  const el = document.getElementById('sessionTimer');
  if (!el) return;
  const tick = () => {
    const s = getAdminSession();
    if (!s) { el.textContent = 'Session expired'; return; }
    const left = SESSION_DURATION - (Date.now() - s.ts);
    if (left <= 0) { showLogin(); showAdminToast('Session expired — please sign in again.', 'error'); return; }
    const m = Math.floor(left / 60000);
    const sec = Math.floor((left % 60000) / 1000);
    el.textContent = `Session: ${m}:${String(sec).padStart(2, '0')}`;
  };
  tick();
  sessionTimerInterval = setInterval(tick, 1000);
}

const PORTAL_URL = 'https://itskaero.github.io/meritnama/';
const LOGO_URL   = 'https://itskaero.github.io/meritnama/logo.png';
const FIREBASE_MAIL_COLLECTION = 'mail';
const WELCOME_EMAIL_TEMPLATE = 'welcome_access';
const PAYMENT_DUE_EMAIL_TEMPLATE = 'payment_due';

async function sendWelcomeEmail(name, email, pin, accessLevel) {
  return db.collection(FIREBASE_MAIL_COLLECTION).add({
    to: [email],
    template: {
      name: WELCOME_EMAIL_TEMPLATE,
      data: {
        name: name || email,
        email,
        pin,
        accessLevel,
        portalUrl: PORTAL_URL,
        logoUrl: LOGO_URL,
      },
    },
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    source: 'admin_portal_access',
  });
}

async function sendPaymentDueEmail(name, email, applicantId) {
  return db.collection(FIREBASE_MAIL_COLLECTION).add({
    to: [email],
    template: {
      name: PAYMENT_DUE_EMAIL_TEMPLATE,
      data: {
        name: name || email,
        email,
        applicantId: applicantId || '',
        portalUrl: PORTAL_URL,
        logoUrl: LOGO_URL,
      },
    },
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    source: 'admin_payment_due',
  });
}

function generateAccessPin() {
  if (window.crypto && crypto.getRandomValues) {
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    return String(100000 + (arr[0] % 900000));
  }
  return String(Math.floor(100000 + Math.random() * 900000));
}

function getAdminSessionEmail() {
  try {
    const raw = localStorage.getItem(ADMIN_SESSION_KEY);
    if (!raw) return '';
    const s = JSON.parse(raw);
    return (s && typeof s.email === 'string') ? s.email : '';
  } catch (_) { return ''; }
}

async function grantPortalAccess(opts) {
  const email = (opts.email || '').toLowerCase().trim();
  const name = (opts.name || email).trim();
  const pin = String(opts.pin || '').trim();
  const level = opts.level || 'Standard User';
  const inviteLimit = asInviteLimit(opts.inviteLimit, 2);
  const sendEmail = opts.sendEmail !== false;
  const applicantId = opts.applicantId ? String(opts.applicantId) : '';

  if (!email) throw new Error('Email is required.');
  if (!pin || pin.length < 4) throw new Error('PIN must be at least 4 characters.');

  const pinHash = await hashPin(pin);
  const userData = {
    pin: pinHash,
    isAdmin: level === 'Admin',
    name: name || email,
    inviteLimit,
    addedAt: firebase.firestore.FieldValue.serverTimestamp(),
  };
  if (opts.invitedBy) userData.invitedBy = opts.invitedBy;
  if (opts.inviteSource) userData.inviteSource = opts.inviteSource;

  await db.collection('authorized_users').doc(email).set(userData, { merge: true });

  const profileData = { inviteLimit, email };
  if (name) profileData.name = name;
  if (applicantId) profileData.applicantId = applicantId;
  await db.collection('user_profiles').doc(email).set(profileData, { merge: true });

  let emailSent = false;
  let emailError = null;
  if (sendEmail) {
    try {
      await sendWelcomeEmail(name || email, email, pin, level);
      emailSent = true;
    } catch (err) {
      emailError = err?.text || err?.message || String(err);
    }
  }

  return { pin, emailSent, emailError };
}

// --- Admin Auth ---
async function hashPin(pin) {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function verifyAdmin(email, pin) {
  const doc = await db.collection('authorized_users').doc(email.toLowerCase().trim()).get();
  if (!doc.exists) return false;
  const data = doc.data();
  if (!data.isAdmin) return false;

  const pinHash = await hashPin(pin);
  if (data.pin && data.pin.length === 64) {
    return pinHash === data.pin;
  }
  return data.pin === pin;
}

async function loadAuthUserMeta() {
  const [snapshot, profileSnap] = await Promise.all([
    db.collection('authorized_users').get(),
    db.collection('user_profiles').get(),
  ]);
  const profiles = {};
  profileSnap.docs.forEach(doc => { profiles[doc.id] = doc.data(); });

  const byEmail = {};
  const inviteesByInviter = {};

  snapshot.docs.forEach(doc => {
    const data = doc.data();
    const email = doc.id;
    const invitedBy = (data.invitedBy || '').toLowerCase().trim();
    byEmail[email] = {
      email,
      name: data.name || email,
      isAdmin: !!data.isAdmin,
      inviteLimit: asInviteLimit(profiles[email]?.inviteLimit, asInviteLimit(data.inviteLimit, 2)),
      invitedBy: invitedBy || null,
      invitedAt: data.invitedAt?.toDate?.() || null,
      inviteSource: data.inviteSource || null,
      addedAt: data.addedAt?.toDate?.() || null,
    };
    if (invitedBy) {
      if (!inviteesByInviter[invitedBy]) inviteesByInviter[invitedBy] = [];
      inviteesByInviter[invitedBy].push({
        email,
        name: data.name || email,
        invitedAt: data.invitedAt?.toDate?.() || null,
      });
    }
  });

  Object.values(inviteesByInviter).forEach(list => {
    list.sort((a, b) => (b.invitedAt || 0) - (a.invitedAt || 0));
  });

  authUserMeta = { byEmail, inviteesByInviter };
  return authUserMeta;
}

function getInviteStats(email) {
  const user = authUserMeta.byEmail[email];
  const invitees = authUserMeta.inviteesByInviter[email] || [];
  const limit = user?.inviteLimit ?? 2;
  const used = invitees.length;
  return { limit, used, left: Math.max(limit - used, 0), invitees };
}

function formatInvitedByLabel(email) {
  const key = (email || '').toLowerCase().trim();
  const user = authUserMeta.byEmail[key];
  if (!user?.invitedBy) return null;
  const inviter = authUserMeta.byEmail[user.invitedBy];
  return inviter ? `${inviter.name} (${user.invitedBy})` : user.invitedBy;
}

function renderInvitedByCell(email) {
  const label = formatInvitedByLabel(email);
  if (!label) return '<span class="invited-by-cell" style="opacity:0.55">Admin portal</span>';
  const user = authUserMeta.byEmail[(email || '').toLowerCase().trim()];
  const title = user?.invitedAt
    ? `Invited ${user.invitedAt.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`
    : label;
  return `<span class="invited-by-cell" title="${escapeHtml(title)}">${escapeHtml(label)}</span>`;
}

function renderInviteQuotaCell(stats) {
  const cls = stats.left <= 0
    ? 'invite-quota-empty'
    : (stats.left <= 1 ? 'invite-quota-low' : '');
  return `<span class="invite-quota-badge ${cls}">${stats.left} left</span>
    <span class="invite-meta-sub">${stats.used}/${stats.limit} used</span>`;
}

function renderInviteesCell(email) {
  const invitees = authUserMeta.inviteesByInviter[email] || [];
  if (!invitees.length) return '<span style="opacity:0.45">—</span>';
  const title = invitees.map(i => {
    const when = i.invitedAt
      ? i.invitedAt.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })
      : '—';
    return `${i.name} (${i.email}) · ${when}`;
  }).join('\n');
  const label = invitees.map(i => i.name || i.email).join(', ');
  return `<span class="invitees-cell" title="${escapeHtml(title)}">${escapeHtml(label)}</span>`;
}

// --- Load Logs ---
async function loadLogs() {
  try {
    await loadAuthUserMeta();
  } catch (_) {}

  const snapshot = await db.collection('access_logs')
    .orderBy('timestamp', 'desc')
    .limit(500)
    .get();

  allLogs = snapshot.docs.map(doc => {
    const d = doc.data();
    return {
      email: d.email || '—',
      success: d.success,
      ip: d.ip || '—',
      userAgent: d.userAgent || '—',
      page: d.page || '—',
      timestamp: d.timestamp ? d.timestamp.toDate() : null
    };
  });

  updateStats();
  renderLogs();
  renderAccessTrendChart();
  renderPagePopularity();
  renderRecentActivity();
}

function renderAccessTrendChart() {
  const el = document.getElementById('accessTrendChart');
  if (!el) return;
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    days.push(d);
  }
  const buckets = days.map(d => ({
    label: d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' }),
    ok: 0, fail: 0,
    start: d.getTime(),
    end: d.getTime() + 86400000,
  }));
  for (const log of allLogs) {
    if (!log.timestamp) continue;
    const t = log.timestamp.getTime();
    const b = buckets.find(x => t >= x.start && t < x.end);
    if (!b) continue;
    if (log.success) b.ok++; else b.fail++;
  }
  const maxVal = Math.max(1, ...buckets.map(b => b.ok + b.fail));
  el.innerHTML = buckets.map(b => {
    const okH = Math.round((b.ok / maxVal) * 68);
    const failH = Math.round((b.fail / maxVal) * 68);
    return `<div class="trend-col" title="${b.label}: ${b.ok} ok, ${b.fail} failed">
      <div class="trend-bars">
        ${b.ok ? `<div class="trend-bar ok" style="height:${okH}px"></div>` : ''}
        ${b.fail ? `<div class="trend-bar fail" style="height:${failH}px"></div>` : ''}
        ${!b.ok && !b.fail ? '<div class="trend-bar ok" style="height:2px;opacity:0.2"></div>' : ''}
      </div>
      <span class="trend-lbl">${escapeHtml(b.label)}</span>
    </div>`;
  }).join('');

  const sevenDayOk = buckets.reduce((s, b) => s + b.ok, 0);
  const sevenDayTotal = buckets.reduce((s, b) => s + b.ok + b.fail, 0);
  const rate = sevenDayTotal ? Math.round((sevenDayOk / sevenDayTotal) * 100) : 0;
  const ovLogins = document.getElementById('ovLogins7d');
  const ovRate = document.getElementById('ovSuccessRate');
  if (ovLogins) ovLogins.textContent = sevenDayOk.toLocaleString();
  if (ovRate) ovRate.textContent = `${rate}% success rate (7d)`;
}

function renderPagePopularity() {
  const el = document.getElementById('pagePopularity');
  if (!el) return;
  const counts = {};
  for (const log of allLogs) {
    if (!log.success || !log.page || log.page === '—') continue;
    const p = log.page.length > 40 ? log.page.slice(0, 38) + '…' : log.page;
    counts[p] = (counts[p] || 0) + 1;
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (!sorted.length) {
    el.innerHTML = '<p class="empty-state" style="padding:0.5rem 0;font-size:0.78rem;">No page data yet.</p>';
    return;
  }
  const max = sorted[0][1];
  el.innerHTML = sorted.map(([page, n]) => `
    <div class="page-bar-row">
      <span class="page-bar-label" title="${escapeHtml(page)}">${escapeHtml(page)}</span>
      <div class="page-bar-track"><div class="page-bar-fill" style="width:${Math.round(n / max * 100)}%"></div></div>
      <span class="page-bar-count">${n}</span>
    </div>`).join('');
}

function renderRecentActivity() {
  const el = document.getElementById('recentActivityList');
  if (!el) return;
  const recent = allLogs.slice(0, 8);
  if (!recent.length) {
    el.innerHTML = '<li class="empty-state" style="padding:0.5rem 0;">No recent activity.</li>';
    return;
  }
  el.innerHTML = recent.map(l => {
    const time = l.timestamp
      ? l.timestamp.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
      : '—';
    return `<li class="activity-item">
      <span class="activity-dot ${l.success ? 'ok' : 'fail'}"></span>
      <div>
        <div>${escapeHtml(l.email)} ${l.success ? '<span class="badge-success" style="font-size:0.65rem;padding:0.1rem 0.35rem;">OK</span>' : '<span class="badge-fail" style="font-size:0.65rem;padding:0.1rem 0.35rem;">Fail</span>'}</div>
        <div class="activity-meta">${escapeHtml(time)} · ${escapeHtml(l.page || '—')}</div>
      </div>
    </li>`;
  }).join('');
}

async function loadOverviewMetrics() {
  try {
    const [usersSnap, profilesSnap, mentorsSnap, mreqSnap, contribSnap, chatSnap] = await Promise.all([
      db.collection('authorized_users').get(),
      db.collection('user_profiles').get(),
      db.collection('mentors').get(),
      db.collection('mentorship_requests').orderBy('createdAt', 'desc').limit(100).get().catch(() => ({ size: 0, docs: [] })),
      db.collection('contributions').get(),
      db.collection('sim21_chat').limit(500).get().catch(() => ({ size: 0 })),
    ]);

    const userCount = usersSnap.size;
    const profileCount = profilesSnap.size;
    const mentorActive = mentorsSnap.docs.filter(d => d.data().available).length;
    const pendingReqs = mreqSnap.docs
      ? mreqSnap.docs.filter(d => (d.data().status || 'pending') === 'pending').length
      : 0;
    let totalPKR = 0;
    contribSnap.forEach(d => { totalPKR += Number(d.data().amountPKR) || 0; });

    overviewMetricsCache = { userCount, profileCount, mentorActive, pendingReqs, totalPKR, chatCount: chatSnap.size || 0 };

    setText('ovUsers', userCount);
    setText('ovProfiles', profileCount);
    setText('ovMentors', mentorActive);
    setText('ovContribPKR', totalPKR ? (totalPKR >= 1000 ? `${Math.round(totalPKR / 1000)}k` : totalPKR) : '0');
    setText('ovChatMsgs', chatSnap.size >= 500 ? '500+' : String(chatSnap.size || 0));
    setText('navBadgeUsers', userCount);
    setText('navBadgeProfiles', profileCount);
    setText('navBadgeMentors', mentorActive || pendingReqs ? `${mentorActive}${pendingReqs ? '+' + pendingReqs : ''}` : '0');

    const now = Date.now();
    const failed24h = allLogs.filter(l => !l.success && l.timestamp && (now - l.timestamp.getTime()) < 86400000).length;
    setText('ovFailed24h', failed24h);
  } catch (e) {
    console.warn('Overview metrics error:', e);
  }
}

function updateStats() {
  document.getElementById('statTotal').textContent = allLogs.length;
  document.getElementById('statSuccess').textContent = allLogs.filter(l => l.success).length;
  document.getElementById('statFailed').textContent = allLogs.filter(l => !l.success).length;
  const unique = new Set(allLogs.filter(l => l.success).map(l => l.email));
  document.getElementById('statUnique').textContent = unique.size;
}

function renderLogs() {
  const emailFilter = document.getElementById('filterEmail').value.toLowerCase().trim();
  const statusFilter = document.getElementById('filterStatus').value;

  let filtered = allLogs;
  if (emailFilter) {
    filtered = filtered.filter(l => l.email.includes(emailFilter));
  }
  if (statusFilter === 'success') {
    filtered = filtered.filter(l => l.success);
  } else if (statusFilter === 'failed') {
    filtered = filtered.filter(l => !l.success);
  }

  const tbody = document.getElementById('logsBody');
  const countEl = document.getElementById('logsCount');
  if (countEl) countEl.textContent = `${filtered.length} of ${allLogs.length}`;
  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No logs found.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(l => {
    const time = l.timestamp
      ? l.timestamp.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })
      : '—';
    const badge = l.success
      ? '<span class="badge-success">✓ Success</span>'
      : '<span class="badge-fail">✗ Failed</span>';
    const ua = l.userAgent.length > 60 ? l.userAgent.substring(0, 60) + '…' : l.userAgent;
    const actionEmail = l.email !== '—' ? escapeHtml(l.email) : '';
    const actionBtn = actionEmail
      ? `<button class="action-btn" onclick="openAddUserModal('${actionEmail}')">Grant Access</button>
         <button class="action-btn" data-history-email="${actionEmail}" style="margin-left:0.3rem;">History</button>`
      : '—';
    const invitedBy = l.email !== '—' ? renderInvitedByCell(l.email) : '—';

    return `<tr>
      <td>${time}</td>
      <td>${escapeHtml(l.email)}</td>
      <td>${invitedBy}</td>
      <td>${badge}</td>
      <td class="ip-cell">${escapeHtml(l.ip)}</td>
      <td>${escapeHtml(l.page)}</td>
      <td title="${escapeHtml(l.userAgent)}">${escapeHtml(ua)}</td>
      <td>${actionBtn}</td>
    </tr>`;
  }).join('');
}

async function loadScreenshotLogs() {
  const tbody = document.getElementById('screenshotLogsBody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="10" class="empty-state">Loading screenshot logs&hellip;</td></tr>';

  try {
    const snapshot = await db.collection('screenshot_logs')
      .orderBy('createdAt', 'desc')
      .limit(500)
      .get();

    allScreenshotLogs = snapshot.docs.map(doc => {
      const d = doc.data();
      const timestamp = d.createdAt?.toDate?.()
        || d.timestamp?.toDate?.()
        || (d.clientAt ? new Date(d.clientAt) : null);
      return {
        id: doc.id,
        email: d.email || 'unknown',
        traceId: d.traceId || makeAdminTraceId(d.email || ''),
        eventType: d.eventType || 'screenshot_attempt',
        page: d.path || d.page || '—',
        activeTab: d.activeTab || d.context?.activeTab || '',
        activeTabLabel: d.activeTabLabel || d.context?.activeTabLabel || '',
        modalId: d.modalId || d.context?.modalId || '',
        modalTitle: d.modalTitle || d.context?.modalTitle || '',
        applicantId: d.applicantId || d.context?.applicantId || '',
        visibilityState: d.visibilityState || '—',
        userAgent: d.userAgent || '—',
        timestamp: timestamp && !Number.isNaN(timestamp.getTime()) ? timestamp : null,
      };
    });
    renderScreenshotLogs();
  } catch (err) {
    allScreenshotLogs = [];
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="10" class="empty-state">Failed to load screenshot logs: ${escapeHtml(err.message)}</td></tr>`;
    }
    const countEl = document.getElementById('screenshotLogsCount');
    if (countEl) countEl.textContent = '0';
  }
}

function screenshotEventLabel(type) {
  const labels = {
    printscreen_key: 'PrintScreen key',
    screenshot_shortcut: 'Screenshot shortcut',
    print_blocked: 'Print blocked',
  };
  return labels[type] || type || 'Screenshot attempt';
}

function makeAdminTraceId(email) {
  email = String(email || '').toLowerCase().trim();
  if (!email || email === 'unknown') return '';
  let hash = 2166136261;
  for (let i = 0; i < email.length; i++) {
    hash ^= email.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).toUpperCase().padStart(7, '0').slice(0, 7);
}

function renderScreenshotLogs() {
  const query = document.getElementById('filterScreenshotEmail')?.value?.toLowerCase().trim() || '';
  const type = document.getElementById('filterScreenshotType')?.value || 'all';
  const tbody = document.getElementById('screenshotLogsBody');
  const countEl = document.getElementById('screenshotLogsCount');
  if (!tbody) return;

  let filtered = allScreenshotLogs;
  if (query) {
    filtered = filtered.filter(l =>
      String(l.email || '').toLowerCase().includes(query) ||
      String(l.traceId || '').toLowerCase().includes(query) ||
      (l.traceId ? `mn-${String(l.traceId).toLowerCase()}` : '').includes(query) ||
      String(l.activeTab || '').toLowerCase().includes(query) ||
      String(l.modalTitle || '').toLowerCase().includes(query) ||
      String(l.applicantId || '').toLowerCase().includes(query) ||
      String(l.page || '').toLowerCase().includes(query)
    );
  }
  if (type !== 'all') filtered = filtered.filter(l => l.eventType === type);

  if (countEl) countEl.textContent = `${filtered.length} of ${allScreenshotLogs.length}`;
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty-state">No screenshot logs found.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(l => {
    const time = l.timestamp
      ? l.timestamp.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })
      : '—';
    const ua = l.userAgent.length > 70 ? l.userAgent.substring(0, 70) + '…' : l.userAgent;
    const traceLabel = l.traceId ? `MN-${l.traceId}` : '—';
    const tabModal = [
      l.activeTab ? `Tab: ${l.activeTabLabel || l.activeTab}` : '',
      l.modalId || l.modalTitle ? `Modal: ${l.modalTitle || l.modalId}` : '',
    ].filter(Boolean).join(' · ') || '—';
    const warnBtn = l.email && l.email !== 'unknown'
      ? `<button class="action-btn" data-warning-email="${escapeHtml(l.email)}" data-warning-context="${escapeHtml(screenshotEventLabel(l.eventType))}">Warn</button>`
      : '—';
    return `<tr>
      <td>${escapeHtml(time)}</td>
      <td>${escapeHtml(l.email)}</td>
      <td><span class="ip-cell">${escapeHtml(traceLabel)}</span></td>
      <td><span class="badge-fail">${escapeHtml(screenshotEventLabel(l.eventType))}</span></td>
      <td>${escapeHtml(l.page)}</td>
      <td title="${escapeHtml(tabModal)}">${escapeHtml(tabModal.length > 70 ? tabModal.slice(0, 68) + '…' : tabModal)}</td>
      <td>${escapeHtml(l.applicantId || '—')}</td>
      <td>${escapeHtml(l.visibilityState)}</td>
      <td title="${escapeHtml(l.userAgent)}">${escapeHtml(ua)}</td>
      <td>${warnBtn}</td>
    </tr>`;
  }).join('');
}

function setWarningStatus(message, color = 'var(--text-muted)') {
  const el = document.getElementById('warningStatus');
  if (!el) return;
  el.textContent = message || '';
  el.style.color = color;
}

function clearWarningComposer() {
  const recipient = document.getElementById('warnRecipient');
  const severity = document.getElementById('warnSeverity');
  const title = document.getElementById('warnTitle');
  const message = document.getElementById('warnMessage');
  if (recipient) recipient.value = '';
  if (severity) severity.value = 'warning';
  if (title) title.value = '';
  if (message) message.value = '';
  setWarningStatus('');
}

function openWarningComposer(email, context) {
  switchTab('warnings');
  const recipient = document.getElementById('warnRecipient');
  const severity = document.getElementById('warnSeverity');
  const title = document.getElementById('warnTitle');
  const message = document.getElementById('warnMessage');
  if (recipient) recipient.value = (email || '').toLowerCase().trim();
  if (severity) severity.value = 'warning';
  if (title && !title.value) title.value = 'Screenshot policy reminder';
  if (message && !message.value) {
    message.value = `Your account was linked to a protected-content screenshot/print attempt${context ? ' (' + context + ')' : ''}. Please do not capture or share private MeritNama content.`;
  }
  setWarningStatus('Review and send this warning.', 'var(--neon-gold)');
  setTimeout(() => recipient?.focus(), 50);
}

async function sendUserWarning() {
  const recipient = document.getElementById('warnRecipient')?.value?.trim().toLowerCase() || '';
  const severity = document.getElementById('warnSeverity')?.value || 'warning';
  const title = document.getElementById('warnTitle')?.value?.trim() || 'Admin message';
  const message = document.getElementById('warnMessage')?.value?.trim() || '';
  const btn = document.getElementById('sendWarningBtn');
  if (!recipient || !recipient.includes('@')) {
    setWarningStatus('Enter a valid recipient email.', 'var(--neon-pink)');
    return;
  }
  if (!message) {
    setWarningStatus('Enter a warning message.', 'var(--neon-pink)');
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  setWarningStatus('Sending warning…');
  try {
    await db.collection('user_warnings').add({
      recipientEmail: recipient,
      severity,
      title,
      message,
      status: 'active',
      createdBy: getAdminSessionEmail() || 'admin',
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    setWarningStatus('Warning sent to user inbox.', 'var(--neon-green)');
    showAdminToast('Warning sent.', 'success');
    await loadWarnings();
  } catch (err) {
    setWarningStatus('Send failed: ' + err.message, 'var(--neon-pink)');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Send Warning'; }
  }
}

async function loadWarnings() {
  const tbody = document.getElementById('warningsBody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="9" class="empty-state">Loading warnings&hellip;</td></tr>';
  try {
    const snap = await db.collection('user_warnings')
      .orderBy('createdAt', 'desc')
      .limit(200)
      .get();
    allWarnings = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    renderWarningsAdmin();
  } catch (err) {
    allWarnings = [];
    if (tbody) tbody.innerHTML = `<tr><td colspan="9" class="empty-state">Failed to load warnings: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function formatAdminWarningDate(value) {
  const d = value?.toDate ? value.toDate() : (value ? new Date(value) : null);
  if (!d || Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function renderWarningsAdmin() {
  const tbody = document.getElementById('warningsBody');
  const countEl = document.getElementById('warningsCount');
  if (!tbody) return;
  const q = document.getElementById('filterWarnings')?.value?.toLowerCase().trim() || '';
  let filtered = allWarnings;
  if (q) {
    filtered = filtered.filter(w =>
      String(w.recipientEmail || '').toLowerCase().includes(q) ||
      String(w.title || '').toLowerCase().includes(q) ||
      String(w.message || '').toLowerCase().includes(q) ||
      String((w.replies || []).map(r => r.message || '').join(' ')).toLowerCase().includes(q) ||
      String(w.createdBy || '').toLowerCase().includes(q)
    );
  }
  if (countEl) countEl.textContent = `${filtered.length} of ${allWarnings.length}`;
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state">No warnings found.</td></tr>';
    return;
  }
  tbody.innerHTML = filtered.map(w => {
    const message = String(w.message || '');
    const msgShort = message.length > 90 ? message.slice(0, 88) + '…' : message;
    const replies = Array.isArray(w.replies) ? w.replies : [];
    const replyText = replies.length
      ? replies.slice(-2).map(r => `${r.email || w.recipientEmail || 'user'}: ${r.message || ''}`).join('\n')
      : '';
    const replyShort = replyText.length > 100 ? replyText.slice(0, 98) + '…' : replyText;
    const read = w.readAt ? formatAdminWarningDate(w.readAt) : '<span class="badge-fail">Unread</span>';
    const archived = w.status === 'archived';
    const action = archived
      ? '<span style="color:var(--text-muted);">Archived</span>'
      : `<button class="action-btn" data-warning-archive="${escapeHtml(w.id)}">Archive</button>`;
    return `<tr>
      <td>${escapeHtml(formatAdminWarningDate(w.createdAt))}</td>
      <td>${escapeHtml(w.recipientEmail || '—')}</td>
      <td>${escapeHtml(w.severity || 'warning')}</td>
      <td>${escapeHtml(w.title || '—')}</td>
      <td title="${escapeHtml(message)}">${escapeHtml(msgShort || '—')}</td>
      <td title="${escapeHtml(replyText)}">${replyText ? escapeHtml(replyShort) : '<span style="color:var(--muted);">—</span>'}</td>
      <td>${read}</td>
      <td>${escapeHtml(w.createdBy || '—')}</td>
      <td>${action}</td>
    </tr>`;
  }).join('');
}

async function archiveWarning(id) {
  if (!id) return;
  try {
    await db.collection('user_warnings').doc(id).set({
      status: 'archived',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      archivedBy: getAdminSessionEmail() || 'admin',
    }, { merge: true });
    await loadWarnings();
    showAdminToast('Warning archived.', 'success');
  } catch (err) {
    showAdminToast('Archive failed: ' + err.message, 'error');
  }
}

async function loadGrievanceDataAdmin() {
  if (responderSourcesAdmin.length) return grievanceDataRecords;
  const res = await fetch('data/responder_sources.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Could not load responder source config (${res.status})`);
  const payload = await res.json();
  responderSourcesAdmin = Array.isArray(payload) ? payload : (payload.sources || []);
  grievanceDataRecords = [];
  for (const source of responderSourcesAdmin) {
    try {
      const records = await loadResponderRecordsAdmin(source);
      grievanceDataRecords.push(...records);
    } catch (e) {
      console.warn('Responder dataset load failed:', source.id, e);
    }
  }
  return grievanceDataRecords;
}

function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function responderSourceAdmin(id) {
  return responderSourcesAdmin.find(s => s.id === id) || null;
}

function adminValueAtPath(obj, path) {
  if (!path) return obj;
  return String(path).split('.').reduce((acc, key) => acc == null ? acc : acc[key], obj);
}

async function loadResponderRecordsAdmin(source) {
  if (!source?.id || !source.dataset) return [];
  if (responderDatasetCacheAdmin[source.id]) return responderDatasetCacheAdmin[source.id];
  const res = await fetch(source.dataset, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Could not load ${source.dataset} (${res.status})`);
  const payload = await res.json();
  const records = adminValueAtPath(payload, source.recordsPath || '') || payload.records || payload;
  responderDatasetCacheAdmin[source.id] = Array.isArray(records) ? records : [];
  return responderDatasetCacheAdmin[source.id];
}

function sourceStatusText(source, status) {
  const s = String(status || '').trim();
  const empty = Array.isArray(source?.emptyStatusValues) ? source.emptyStatusValues.map(String) : ['', '-'];
  if (empty.includes(s)) return source?.response?.emptyStatusText || 'No final decision recorded';
  return s;
}

async function findGrievanceDataMatch(ticket) {
  const source = responderSourceAdmin(ticket.sourceId || ticket.requestType) || responderSourcesAdmin[0] || null;
  if (!source) return { source: null, record: null, confidence: 'low', reason: 'No responder source configured' };
  const records = await loadResponderRecordsAdmin(source);
  const matchField = ticket.matchField || source.match?.field || 'applicantId';
  const lookupValue = String(ticket.lookupValue || ticket.applicantId || '').trim();
  if (!lookupValue) return { source, record: null, confidence: 'low', reason: 'No lookup value provided' };
  const exact = records.find(r => String(r?.[matchField] ?? '').trim() === lookupValue);
  if (exact) return { source, record: exact, confidence: 'high', reason: `Exact ${source.match?.label || matchField} match` };
  return { source, record: null, confidence: 'low', reason: `${source.match?.label || matchField} not found in selected JSON database` };
}

function templateReplace(template, values) {
  return String(template || '').replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => values[key] == null ? '' : String(values[key]));
}

function compactRecordSnapshot(source, record) {
  if (!record) return null;
  const fields = Array.isArray(source?.displayFields) ? source.displayFields : [];
  if (!fields.length) return { ...record };
  const out = {};
  fields.forEach(f => { out[f.field] = record[f.field] ?? ''; });
  return out;
}

function buildGrievanceResponderDraftSync(ticket) {
  const source = responderSourceAdmin(ticket.sourceId || ticket.requestType) || responderSourcesAdmin[0] || null;
  const record = ticket.matchedRecord || null;
  if (!source || !record) {
    return {
      response: [
        'The selected data responder could not find a matching row for this request.',
        'Do not approve this response until the request type and lookup value have been corrected.'
      ].join('\n\n'),
      confidence: 'low',
      reason: source ? 'No matching row in selected JSON database' : 'No responder source configured',
      matchedRecord: null,
      source,
    };
  }
  return buildResponderDraftFromRecord(ticket, source, record, 'high', `Exact ${source.match?.label || source.match?.field || 'lookup'} match`);
}

async function buildGrievanceResponderDraft(ticket) {
  const match = findGrievanceDataMatch(ticket);
  return match.then(m => {
    if (!m.record) {
      return {
        response: [
          `We could not find ${m.source?.match?.label || 'the lookup value'} "${ticket.lookupValue || ticket.applicantId || ''}" in "${m.source?.label || 'the selected database'}".`,
          'Please re-check the request type and lookup value. Admin should not approve a data-based response until a matching row exists.'
        ].join('\n\n'),
        confidence: m.confidence,
        reason: m.reason,
        matchedRecord: null,
        source: m.source,
      };
    }
    return buildResponderDraftFromRecord(ticket, m.source, m.record, m.confidence, m.reason);
  });
}

function buildResponderDraftFromRecord(ticket, source, record, confidence, reason) {
  const matchField = ticket.matchField || source.match?.field || 'applicantId';
  const matchLabel = ticket.matchLabel || source.match?.label || matchField;
  const matchValue = record?.[matchField] ?? ticket.lookupValue ?? ticket.applicantId ?? '';
  const titleField = source.titleField || 'subject';
  const statusField = source.statusField || 'status';
  const statusValue = sourceStatusText(source, record?.[statusField]);
  const values = {
    matchLabel,
    matchValue,
    statusLabel: source.displayFields?.find(f => f.field === statusField)?.label || statusField,
    statusValue,
    subject: record?.[titleField] || '',
    attendance: record?.attendance || '',
    sourceLabel: source.label || source.id,
    ...record,
  };
  const responseCfg = source.response || {};
  var draftLines = [
    { tmpl: responseCfg.intro || 'We matched your request to {matchLabel} {matchValue}.', check: true },
    { tmpl: responseCfg.statusLine || 'The available data shows {statusLabel}: {statusValue}.', check: true },
    { tmpl: responseCfg.extraLine || '', check: true },
    { tmpl: responseCfg.footer || 'This response was reviewed and approved by admin before delivery.', check: true },
  ];
  const lines = draftLines.filter(function(entry) {
    if (!entry.tmpl) return false;
    if (entry.check) {
      var refs = entry.tmpl.match(/\{(\w+)\}/g);
      if (refs) {
        var hasContent = refs.some(function(m) {
          var key = m.slice(1, -1);
          return values[key] != null && String(values[key]).trim().length > 0;
        });
        if (!hasContent) return false;
      }
    }
    return true;
  }).map(function(entry) { return templateReplace(entry.tmpl, values); });
  return {
    response: lines.join('\n\n'),
    confidence,
    reason,
    matchedRecord: compactRecordSnapshot(source, record),
    source,
  };
}

function formatGrievanceAdminDate(value) {
  const d = value?.toDate ? value.toDate() : (value ? new Date(value) : null);
  if (!d || Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function grievanceAdminStatusBadge(status) {
  if (status === 'approved') return '<span class="badge-success">Approved</span>';
  if (status === 'needs_edit') return '<span class="badge-fail">Needs edit</span>';
  if (status === 'archived') return '<span style="color:var(--muted);">Archived</span>';
  return '<span class="badge-fail">Pending</span>';
}

function renderResponderRecordSummary(source, record) {
  const fields = Array.isArray(source?.displayFields) && source.displayFields.length
    ? source.displayFields.slice(0, 6)
    : Object.keys(record || {}).slice(0, 6).map(field => ({ field, label: field }));
  return fields.map(f => {
    const value = record?.[f.field];
    if (value == null || value === '') return '';
    const label = f.label || f.field;
    const display = f.field === source?.statusField ? sourceStatusText(source, value) : value;
    return `<div><span style="color:var(--text-muted);">${escapeHtml(label)}:</span> <strong>${escapeHtml(String(display))}</strong></div>`;
  }).filter(Boolean).join('');
}

async function refreshGrievanceBadge() {
  try {
    const snap = await db.collection('inbox_requests').limit(200).get();
    const pending = snap.docs.filter(d => {
      const status = d.data().status || 'pending';
      return status === 'pending' || status === 'needs_edit';
    }).length;
    setText('navBadgeGrievances', pending || '0');
  } catch (_) {
    setText('navBadgeGrievances', '—');
  }
}

async function loadGrievances() {
  const tbody = document.getElementById('grievancesBody');
  const countEl = document.getElementById('grievancesCount');
  if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Loading inbox requests…</td></tr>';
  if (countEl) countEl.textContent = 'Loading…';
  try {
    await loadGrievanceDataAdmin();
    const snap = await db.collection('inbox_requests')
      .orderBy('createdAt', 'desc')
      .limit(250)
      .get();
    allGrievances = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    renderGrievancesAdmin();
    refreshGrievanceBadge();
  } catch (err) {
    allGrievances = [];
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="empty-state">Failed to load inbox requests: ${escapeHtml(err.message)}</td></tr>`;
    if (countEl) countEl.textContent = '';
  }
}

function renderGrievancesAdmin() {
  const tbody = document.getElementById('grievancesBody');
  const countEl = document.getElementById('grievancesCount');
  if (!tbody) return;
  const statusFilter = document.getElementById('filterGrievanceStatus')?.value || 'pending';
  const q = document.getElementById('filterGrievances')?.value?.toLowerCase().trim() || '';
  let list = allGrievances;
  if (statusFilter !== 'all') {
    list = list.filter(g => {
      const st = g.status || 'pending';
      if (statusFilter === 'pending') return st === 'pending' || st === 'needs_edit';
      return st === statusFilter;
    });
  }
  if (q) {
    list = list.filter(g =>
      String(g.candidateEmail || '').toLowerCase().includes(q) ||
      String(g.candidateName || '').toLowerCase().includes(q) ||
      String(g.sourceLabel || g.requestType || '').toLowerCase().includes(q) ||
      String(g.applicantId || '').toLowerCase().includes(q) ||
      String(g.lookupValue || '').toLowerCase().includes(q) ||
      String(g.subject || '').toLowerCase().includes(q) ||
      String(g.message || '').toLowerCase().includes(q) ||
      String(g.adminResponse || '').toLowerCase().includes(q)
    );
  }

  const pending = allGrievances.filter(g => {
    const st = g.status || 'pending';
    return st === 'pending' || st === 'needs_edit';
  }).length;
  const approved = allGrievances.filter(g => g.status === 'approved').length;
  setText('grStatPending', pending);
  setText('grStatApproved', approved);
  setText('grStatDataRows', grievanceDataRecords.length || '0');
  if (countEl) countEl.textContent = `${list.length} shown · ${allGrievances.length} total`;
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No inbox requests match.</td></tr>';
    return;
  }

  tbody.innerHTML = list.map(g => {
    const generated = buildGrievanceResponderDraftSync(g);
    const responseText = g.adminResponse || g.adminDraft || generated.response;
    const matched = generated.matchedRecord;
    const src = generated.source || responderSourceAdmin(g.sourceId || g.requestType) || {};
    const matchHtml = matched
      ? `<strong>${escapeHtml(src.label || g.sourceLabel || g.requestType || 'Data source')}</strong><div class="invite-meta-sub">${escapeHtml(generated.reason)}</div>
         <div style="font-size:0.74rem;margin-top:0.35rem;">${renderResponderRecordSummary(src, matched)}</div>`
      : `<strong>${escapeHtml(src.label || g.sourceLabel || g.requestType || 'Data source')}</strong><div class="invite-meta-sub">${escapeHtml(generated.reason)}</div><span style="color:var(--muted);">No matching row</span>`;
    const lookup = g.lookupValue || g.applicantId || '';
    const asker = `${escapeHtml(g.candidateName || '—')}<div class="invite-meta-sub">${escapeHtml(g.candidateEmail || '—')}</div>${lookup ? `<code style="font-size:0.75rem;">${escapeHtml(g.matchLabel || 'Lookup')}: ${escapeHtml(String(lookup))}</code>` : ''}`;
    const question = `<strong>${escapeHtml(g.subject || 'Inbox request')}</strong><div class="invite-meta-sub">${escapeHtml(g.sourceLabel || src.label || g.requestType || 'Data responder')}</div><div class="request-message-cell" title="${escapeHtml(g.message || '')}">${escapeHtml(String(g.message || '').slice(0, 220))}${String(g.message || '').length > 220 ? '…' : ''}</div>`;
    const disabled = g.status === 'approved' ? 'disabled' : '';
    const action = g.status === 'approved'
      ? `<textarea data-grievance-response="${escapeHtml(g.id)}" rows="7" disabled style="width:100%;min-width:320px;resize:vertical;padding:8px;background:rgba(255,255,255,0.035);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:0.78rem;">${escapeHtml(responseText)}</textarea>
         <div class="invite-meta-sub">Approved by ${escapeHtml(g.approvedBy || 'admin')} · ${escapeHtml(formatGrievanceAdminDate(g.approvedAt))}</div>`
      : `<textarea data-grievance-response="${escapeHtml(g.id)}" rows="7" style="width:100%;min-width:320px;resize:vertical;padding:8px;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:0.78rem;">${escapeHtml(responseText)}</textarea>
         <div style="display:flex;gap:0.45rem;flex-wrap:wrap;margin-top:0.45rem;">
           <button class="action-btn" data-grievance-redraft="${escapeHtml(g.id)}" ${disabled}>Use data draft</button>
           <button class="action-btn" data-grievance-approve="${escapeHtml(g.id)}" ${disabled}>Approve response</button>
         </div>`;
    return `<tr>
      <td>${escapeHtml(formatGrievanceAdminDate(g.createdAt))}</td>
      <td>${asker}</td>
      <td>${question}</td>
      <td>${matchHtml}</td>
      <td>${grievanceAdminStatusBadge(g.status || 'pending')}</td>
      <td>${action}</td>
    </tr>`;
  }).join('');
}

function grievanceResponseTextarea(id) {
  return Array.from(document.querySelectorAll('[data-grievance-response]'))
    .find(el => el.getAttribute('data-grievance-response') === id);
}

function setGrievanceTextarea(id, text) {
  const textarea = grievanceResponseTextarea(id);
  if (textarea) textarea.value = text || '';
}

async function approveGrievanceResponse(id) {
  const item = allGrievances.find(g => g.id === id);
  if (!item) return;
  const textarea = grievanceResponseTextarea(id);
  const response = textarea?.value?.trim() || '';
  if (!response) {
    showAdminToast('Response cannot be empty.', 'error');
    return;
  }
  const generated = await buildGrievanceResponderDraft(item);
  try {
    await db.collection('inbox_requests').doc(id).set({
      status: 'approved',
      adminResponse: response.slice(0, 2000),
      responderDraft: generated.response,
      responder: {
        confidence: generated.confidence,
        reason: generated.reason,
        matchedRecord: generated.matchedRecord,
        source: generated.source?.dataset || item.sourceDataset || '',
      },
      approvedBy: getAdminSessionEmail() || 'admin',
      approvedAt: firebase.firestore.FieldValue.serverTimestamp(),
      candidateReadAt: null,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    showAdminToast('Response approved and sent to inbox.', 'success');
    await loadGrievances();
  } catch (err) {
    showAdminToast('Approval failed: ' + err.message, 'error');
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function asInviteLimit(value, fallback = 2) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

// --- Grant Access Modal ---
function openAddUserModal(prefillEmail) {
  document.getElementById('modalEmail').value = prefillEmail || '';
  document.getElementById('modalName').value  = '';
  document.getElementById('modalPin').value   = '';
  document.getElementById('modalLevel').value = 'Standard User';
  document.getElementById('modalInviteLimit').value = '2';
  document.getElementById('modalSendEmail').checked = true;
  const statusEl = document.getElementById('modalStatus');
  statusEl.textContent = '';
  statusEl.className = 'modal-status';
  document.getElementById('modalSubtitle').textContent = prefillEmail
    ? 'Granting access to: ' + prefillEmail
    : 'Add a new authorized user';
  document.getElementById('addUserModal').classList.add('open');
}

function closeAddUserModal() {
  document.getElementById('addUserModal').classList.remove('open');
}

async function submitAddUser() {
  const name     = document.getElementById('modalName').value.trim();
  const email    = document.getElementById('modalEmail').value.trim().toLowerCase();
  const pin      = document.getElementById('modalPin').value.trim();
  const level    = document.getElementById('modalLevel').value;
  const inviteLimitRaw = document.getElementById('modalInviteLimit').value.trim();
  const inviteLimit = asInviteLimit(inviteLimitRaw, 2);
  const doEmail  = document.getElementById('modalSendEmail').checked;
  const statusEl = document.getElementById('modalStatus');
  const btn      = document.getElementById('modalSubmitBtn');

  if (!email) {
    statusEl.textContent = 'Email address is required.';
    statusEl.className = 'modal-status error';
    return;
  }
  if (!pin || pin.length < 4) {
    statusEl.textContent = 'PIN must be at least 4 characters.';
    statusEl.className = 'modal-status error';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Saving\u2026';
  statusEl.textContent = '';
  statusEl.className = 'modal-status';

  try {
    const result = await grantPortalAccess({
      name, email, pin, level, inviteLimit, sendEmail: doEmail,
    });

    if (doEmail && result.emailSent) {
      statusEl.textContent = '\u2713 User added and welcome email sent!';
      statusEl.className = 'modal-status success';
      setTimeout(closeAddUserModal, 3000);
    } else if (doEmail && result.emailError) {
      console.warn('Email send error:', result.emailError);
      statusEl.innerHTML =
        `\u2713 User added. <strong>Email failed</strong> \u2014 ${escapeHtml(result.emailError)}<br>` +
        `<small style="opacity:0.85">Share credentials manually &mdash; PIN: <code style="background:rgba(77,184,217,0.1);padding:0.1rem 0.35rem;border-radius:4px;font-family:var(--mono)">${escapeHtml(result.pin)}</code></small>`;
      statusEl.className = 'modal-status error';
    } else {
      statusEl.textContent = '\u2713 User added successfully.';
      statusEl.className = 'modal-status success';
      setTimeout(closeAddUserModal, 3000);
    }
  } catch (err) {
    console.error('Add user error:', err);
    statusEl.textContent = 'Error: ' + err.message;
    statusEl.className = 'modal-status error';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Grant Access';
  }
}

// --- Presence / Live Users ---
let presenceUnsubscribe = null;
const PRESENCE_STALE_MS = 10 * 60 * 1000; // hide after 10 min without heartbeat

function timeAgoShort(date) {
  if (!date) return '—';
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 5)   return 'just now';
  if (s < 60)  return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  return Math.floor(s / 3600) + 'h ago';
}

function subscribePresence() {
  if (presenceUnsubscribe) presenceUnsubscribe();

  presenceUnsubscribe = db.collection('presence')
    .onSnapshot(snap => {
      const now = Date.now();
      const rows = [];

      snap.forEach(doc => {
        const d = doc.data();
        const lastSeen = d.lastSeen ? d.lastSeen.toDate() : null;
        if (!lastSeen) return;

        const ageMs = now - lastSeen.getTime();
        if (ageMs > PRESENCE_STALE_MS) return; // skip stale

        const isGreen = ageMs < 2 * 60 * 1000; // green = seen within 2 min
        rows.push({
          email: d.email || doc.id,
          page: d.pageTitle || d.page || '—',
          activeTab: d.activeTab || '',
          modalTitle: d.modalTitle || '',
          applicantId: d.applicantId || '',
          lastSeen,
          isGreen
        });
      });

      // Sort: most recent first
      rows.sort((a, b) => b.lastSeen - a.lastSeen);

      const tbody = document.getElementById('presenceBody');
      if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No active users right now.</td></tr>';
      } else {
        tbody.innerHTML = rows.map(r => {
          const dot    = r.isGreen
            ? '<span class="live-dot green"></span>'
            : '<span class="live-dot yellow"></span>';
          const status = r.isGreen ? 'Active' : 'Recent';
          const contextTitle = [
            r.activeTab ? `Tab: ${r.activeTab}` : '',
            r.modalTitle ? `Modal: ${r.modalTitle}` : '',
            r.applicantId ? `Applicant ID: ${r.applicantId}` : '',
          ].filter(Boolean).join(' · ');
          return `<tr data-presence-email="${escapeHtml(r.email)}" title="${escapeHtml(contextTitle || 'Click to view user history')}" style="cursor:pointer;">
            <td>${dot} ${status}</td>
            <td class="presence-email">${escapeHtml(r.email)}</td>
            <td>${escapeHtml(r.page)}</td>
            <td>${timeAgoShort(r.lastSeen)}</td>
          </tr>`;
        }).join('');
      }

      document.getElementById('statOnline').textContent = rows.filter(r => r.isGreen).length;

      const online = rows.filter(r => r.isGreen).length;
      setText('ovOnline', online);
      setText('headerOnlinePill', `● ${online} online`);
      const pill = document.getElementById('headerOnlinePill');
      if (pill) pill.classList.toggle('live', online > 0);
    }, err => {
      console.warn('Presence snapshot error:', err);
    });
}

function closeUserHistoryModal() {
  document.getElementById('userHistoryModal')?.classList.remove('open');
}

// ── DOWNLOAD LOGS ─────────────────────────────────────────────────────────────
async function loadDownloadLogs() {
  const tbody = document.getElementById('downloadLogsBody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Loading download logs…</td></tr>';
  try {
    const snapshot = await db.collection('download_logs')
      .orderBy('createdAt', 'desc')
      .limit(500)
      .get();
    allDownloadLogs = snapshot.docs.map(doc => {
      const d = doc.data();
      const ts = d.createdAt?.toDate?.() || d.timestamp?.toDate?.() || null;
      return {
        id: doc.id,
        email: d.email || 'unknown',
        reportType: d.reportType || '—',
        filters: d.filters || null,
        userAgent: d.userAgent || '—',
        timestamp: ts && !Number.isNaN(ts.getTime()) ? ts : null,
      };
    });
    renderDownloadLogs();
  } catch (err) {
    allDownloadLogs = [];
    if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Failed to load: ${escapeHtml(err.message)}</td></tr>`;
    const countEl = document.getElementById('downloadLogsCount');
    if (countEl) countEl.textContent = '0';
  }
}

function renderDownloadLogs() {
  const emailQ = document.getElementById('filterDownloadEmail')?.value?.toLowerCase().trim() || '';
  const typeQ = document.getElementById('filterDownloadType')?.value?.toLowerCase().trim() || '';
  const tbody = document.getElementById('downloadLogsBody');
  const countEl = document.getElementById('downloadLogsCount');
  if (!tbody) return;

  let filtered = allDownloadLogs;
  if (emailQ) filtered = filtered.filter(l => String(l.email || '').toLowerCase().includes(emailQ));
  if (typeQ) filtered = filtered.filter(l => String(l.reportType || '').toLowerCase().includes(typeQ));

  if (countEl) countEl.textContent = `${filtered.length} of ${allDownloadLogs.length}`;
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No download logs found.</td></tr>';
    return;
  }
  tbody.innerHTML = filtered.map(l => {
    const time = l.timestamp
      ? l.timestamp.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })
      : '—';
    const ua = l.userAgent.length > 70 ? l.userAgent.substring(0, 70) + '…' : l.userAgent;
    let filtersHtml = '—';
    if (l.filters && l.filters !== '—') {
      try {
        var fObj = typeof l.filters === 'string' ? JSON.parse(l.filters) : l.filters;
        var fParts = [];
        for (var fk in fObj) {
          if (Object.prototype.hasOwnProperty.call(fObj, fk) && fObj[fk] !== null && fObj[fk] !== undefined) {
            var fv = String(fObj[fk]);
            if (fv.length > 40) fv = fv.substring(0, 38) + '…';
            fParts.push('<span style="background:rgba(77,184,217,0.08);border-radius:4px;padding:0.1rem 0.4rem;margin:0.15rem;display:inline-block;font-size:0.68rem;"><strong>' + escapeHtml(fk) + '</strong>: ' + escapeHtml(fv) + '</span>');
          }
        }
        if (fParts.length) filtersHtml = fParts.join('');
      } catch (_) { filtersHtml = escapeHtml(l.filters); }
    }
    return `<tr>
      <td>${escapeHtml(time)}</td>
      <td>${escapeHtml(l.email)}</td>
      <td>${escapeHtml(l.reportType)}</td>
      <td style="max-width:320px;line-height:1.6;">${filtersHtml}</td>
      <td title="${escapeHtml(l.userAgent)}">${escapeHtml(ua)}</td>
    </tr>`;
  }).join('');
}

// ── USER ACTIVITY (aggregated) ─────────────────────────────────────────────────
async function loadUserActivity(email) {
  email = (email || '').toLowerCase().trim();
  const tbody = document.getElementById('uaBody');
  const status = document.getElementById('uaStatus');
  if (!tbody) return;
  if (!email) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Enter an email and click Search to view activity.</td></tr>';
    if (status) status.textContent = '';
    return;
  }
  tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Loading activity…</td></tr>';
  if (status) status.textContent = 'Fetching logs for ' + email + '…';

  try {
    const [accessSnap, activitySnap, screenshotSnap, downloadSnap] = await Promise.all([
      db.collection('access_logs').where('email', '==', email).limit(100).get().catch(() => ({ docs: [] })),
      db.collection('user_activity_logs').where('email', '==', email).limit(100).get().catch(() => ({ docs: [] })),
      db.collection('screenshot_logs').where('email', '==', email).limit(100).get().catch(() => ({ docs: [] })),
      db.collection('download_logs').where('email', '==', email).limit(100).get().catch(() => ({ docs: [] })),
    ]);

    const rows = [];

    accessSnap.docs.forEach(doc => {
      const d = doc.data();
      rows.push({
        ts: d.timestamp?.toDate?.() || null,
        type: 'Access',
        details: d.success ? 'Successful login' : 'Failed login',
        location: d.page || '—',
        meta: d.ip ? 'IP: ' + d.ip : '—',
      });
    });

    activitySnap.docs.forEach(doc => {
      const d = doc.data();
      rows.push({
        ts: d.createdAt?.toDate?.() || d.updatedAt?.toDate?.() || null,
        type: 'Activity',
        details: d.reason || 'Page view',
        location: d.pageLabel || d.title || d.path || d.page || '—',
        meta: d.activeTabLabel ? 'Tab: ' + d.activeTabLabel : (d.applicantId ? 'App ID: ' + d.applicantId : '—'),
      });
    });

    screenshotSnap.docs.forEach(doc => {
      const d = doc.data();
      rows.push({
        ts: d.createdAt?.toDate?.() || d.timestamp?.toDate?.() || (d.clientAt ? new Date(d.clientAt) : null),
        type: 'Screenshot',
        details: (d.eventType || 'screenshot_attempt').replace(/_/g, ' '),
        location: d.path || d.page || '—',
        meta: d.traceId ? 'Trace: MN-' + d.traceId : (d.applicantId ? 'App ID: ' + d.applicantId : '—'),
      });
    });

    downloadSnap.docs.forEach(doc => {
      const d = doc.data();
      rows.push({
        ts: d.createdAt?.toDate?.() || d.timestamp?.toDate?.() || null,
        type: 'Download',
        details: d.reportType || 'Report download',
        location: '—',
        meta: d.filters ? Object.keys(d.filters).slice(0, 3).join(', ') : '—',
      });
    });

    rows.sort((a, b) => (b.ts || 0) - (a.ts || 0));

    if (status) status.textContent = `${rows.length} events found for ${email}`;

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No activity found for this user.</td></tr>';
      return;
    }

    const typeStyles = {
      Access: 'background:rgba(62,207,142,0.1);color:var(--success);border:1px solid rgba(62,207,142,0.2);',
      Activity: 'background:rgba(107,132,168,0.1);color:var(--text-muted);border:1px solid rgba(107,132,168,0.2);',
      Screenshot: 'background:rgba(224,84,112,0.1);color:var(--danger);border:1px solid rgba(224,84,112,0.2);',
      Download: 'background:rgba(77,184,217,0.1);color:var(--accent);border:1px solid rgba(77,184,217,0.2);',
    };
    tbody.innerHTML = rows.map(r => {
      const time = r.ts
        ? r.ts.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })
        : '—';
      const tStyle = typeStyles[r.type] || typeStyles.Activity;
      return `<tr>
        <td>${escapeHtml(time)}</td>
        <td><span style="display:inline-flex;align-items:center;padding:0.15rem 0.55rem;border-radius:6px;font-size:0.7rem;font-weight:600;text-transform:capitalize;${tStyle}">${escapeHtml(r.type)}</span></td>
        <td>${escapeHtml(r.details)}</td>
        <td style="max-width:220px;overflow:hidden;" title="${escapeHtml(r.location)}">${escapeHtml(r.location)}</td>
        <td style="font-size:0.75rem;">${escapeHtml(r.meta)}</td>
      </tr>`;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Failed to load: ${escapeHtml(err.message)}</td></tr>`;
    if (status) status.textContent = 'Error loading activity.';
  }
}

async function openUserHistory(email) {
  email = (email || '').toLowerCase().trim();
  if (!email) return;
  const modal = document.getElementById('userHistoryModal');
  const title = document.getElementById('userHistoryTitle');
  const sub = document.getElementById('userHistorySubtitle');
  const tbody = document.getElementById('userHistoryBody');
  if (title) title.textContent = 'User Activity History';
  if (sub) sub.textContent = email;
  if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Loading history&hellip;</td></tr>';
  modal?.classList.add('open');

  try {
    const snap = await db.collection('user_activity_logs')
      .where('email', '==', email)
      .limit(120)
      .get();
    const rows = snap.docs.map(doc => {
      const d = doc.data();
      return {
        id: doc.id,
        ...d,
        createdAt: d.createdAt?.toDate?.() || d.updatedAt?.toDate?.() || null,
      };
    }).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    if (!rows.length) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No activity history for this user yet.</td></tr>';
      return;
    }

    if (tbody) {
      tbody.innerHTML = rows.map(r => {
        const time = r.createdAt
          ? r.createdAt.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })
          : '—';
        const location = r.pageLabel || r.title || r.path || r.page || '—';
        return `<tr>
          <td>${escapeHtml(time)}</td>
          <td title="${escapeHtml(r.path || '')}">${escapeHtml(location)}</td>
          <td>${escapeHtml(r.activeTabLabel || r.activeTab || '—')}</td>
          <td>${escapeHtml(r.modalTitle || r.modalId || '—')}</td>
          <td>${escapeHtml(r.applicantId || '—')}</td>
          <td>${escapeHtml(r.reason || '—')}</td>
        </tr>`;
      }).join('');
    }
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="empty-state">Failed to load history: ${escapeHtml(err.message)}</td></tr>`;
  }
}

// --- Users Tab ---
let allUsers = [];

async function loadUsers() {
  const tbody = document.getElementById('usersBody');
  tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Loading\u2026</td></tr>';
  try {
    await loadAuthUserMeta();
    allUsers = Object.values(authUserMeta.byEmail).map(user => {
      const stats = getInviteStats(user.email);
      return { ...user, ...stats };
    });
    renderUsers();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-state">Error: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderUsers() {
  const tbody = document.getElementById('usersBody');
  const q = (document.getElementById('filterUsers')?.value || '').toLowerCase().trim();
  let list = allUsers;
  if (q) {
    list = list.filter(u =>
      (u.name || '').toLowerCase().includes(q) ||
      (u.email || '').toLowerCase().includes(q)
    );
  }
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No authorized users found.</td></tr>';
    return;
  }
  const sorted = [...list].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  tbody.innerHTML = sorted.map(u => {
    const badge = u.isAdmin
      ? '<span class="user-badge admin-badge">Admin</span>'
      : '<span class="user-badge">Standard</span>';
    const added = u.addedAt
      ? u.addedAt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
      : '\u2014';
    return `<tr>
      <td>${escapeHtml(u.name)}</td>
      <td class="presence-email">${escapeHtml(u.email)}</td>
      <td>${badge}</td>
      <td>${renderInviteQuotaCell(u)}</td>
      <td>${renderInvitedByCell(u.email)}</td>
      <td>${renderInviteesCell(u.email)}</td>
      <td>${added}</td>
      <td>
        <button class="action-btn" onclick="promptInviteLimit('${escapeHtml(u.email)}')">Set Limit</button>
        <button class="remove-btn" onclick="confirmRemoveUser('${escapeHtml(u.email)}')">Remove</button>
      </td>
    </tr>`;
  }).join('');
}

async function promptInviteLimit(email) {
  const user = allUsers.find(u => u.email === email);
  const current = user ? user.inviteLimit : 2;
  const value = prompt(`Manual invite limit for ${email}:`, String(current));
  if (value === null) return;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    alert('Invite limit must be a whole number.');
    return;
  }
  const inviteLimit = asInviteLimit(trimmed, current);
  try {
    await Promise.all([
      db.collection('authorized_users').doc(email).set({ inviteLimit }, { merge: true }),
      db.collection('user_profiles').doc(email).set({ inviteLimit }, { merge: true }),
    ]);
    if (user) {
      user.inviteLimit = inviteLimit;
      user.left = Math.max(inviteLimit - (user.used || 0), 0);
    }
    renderUsers();
  } catch (err) {
    alert('Failed to update invite limit: ' + err.message);
  }
}

async function confirmRemoveUser(email) {
  if (!confirm(`Remove access for ${email}?\n\nThis will immediately prevent them from logging in.`)) return;
  try {
    await db.collection('authorized_users').doc(email).delete();
    await loadUsers();
    updateStats();
  } catch (err) {
    alert('Failed to remove user: ' + err.message);
  }
}

// ── ACCESS REQUESTS ───────────────────────────────────────────────────────────
let allAccessRequests = [];

const ACCESS_CFG_DEFAULTS = {
  requestAccessEnabled: true,
  requestClosedMessage: 'Access requests are currently closed by admin. Please sign in if you already have credentials or check back later.',
  showOnRequestPage: true,
  paymentOptional: true,
  blockInvites: false,
  accessPriceMinPKR: 250,
  accessPriceMaxPKR: 670,
  accessPriceMinUSD: 0.9,
  accessPriceMaxUSD: 2.4,
  accountNumber: '0891-2007-4774',
  raastId: '',
  bankName: 'Mashreq Pakistan',
  showAccountTitle: false,
  paymentNote: 'Optional support contribution. If you pay, paste the actual transaction/reference number from your banking app below. Use Message to admin for access questions or complaints.',
};

function formatRequestDate(ts) {
  if (!ts?.toDate) return '—';
  return ts.toDate().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function requestStatusBadge(status) {
  const map = {
    pending: 'badge-muted',
    approved: 'badge-success',
    rejected: 'badge-danger',
  };
  return `<span class="badge ${map[status] || 'badge-muted'}">${escapeHtml(status || '—')}</span>`;
}

function formatPaymentAmountPKR(amount) {
  if (amount === null || amount === undefined || amount === '') return '';
  const num = Number(amount);
  if (!Number.isFinite(num) || num <= 0) return '';
  return `PKR ${num.toLocaleString('en-PK', { maximumFractionDigits: 2 })}`;
}

async function loadAccessRequests() {
  const tbody = document.getElementById('requestsBody');
  const countEl = document.getElementById('requestsCount');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="9" class="empty-state">Loading requests…</td></tr>';

  try {
    const snap = await db.collection('access_requests').get();
    allAccessRequests = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }))
      .sort((a, b) => {
        const ta = a.requestedAt?.toDate?.()?.getTime() || 0;
        const tb = b.requestedAt?.toDate?.()?.getTime() || 0;
        return tb - ta;
      });
    if (!authUserMeta.byEmail || !Object.keys(authUserMeta.byEmail).length) {
      try { await loadAuthUserMeta(); } catch (_) {}
    }
    renderAccessRequests();
    updateAccessRequestBadge();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty-state">Failed to load: ${escapeHtml(err.message)}</td></tr>`;
    if (countEl) countEl.textContent = 'Error';
  }
}

function renderAccessRequests() {
  const tbody = document.getElementById('requestsBody');
  const countEl = document.getElementById('requestsCount');
  const statusFilter = document.getElementById('filterRequestStatus')?.value || 'pending';
  const q = (document.getElementById('filterRequests')?.value || '').trim().toLowerCase();

  let rows = allAccessRequests.slice();
  if (statusFilter !== 'all') rows = rows.filter(r => r.status === statusFilter);
  if (q) {
    rows = rows.filter(r =>
      (r.email || '').includes(q) ||
      (r.nameFull || '').toLowerCase().includes(q) ||
      String(r.applicantId || '').includes(q) ||
      String(r.paymentAmountPKR || '').includes(q) ||
      (r.paymentReference || '').toLowerCase().includes(q) ||
      (r.message || '').toLowerCase().includes(q)
    );
  }

  if (countEl) countEl.textContent = `${rows.length} shown · ${allAccessRequests.filter(r => r.status === 'pending').length} pending`;

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty-state">No matching requests.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(r => {
    const paymentAmount = formatPaymentAmountPKR(r.paymentAmountPKR);
    const paymentMeta = [
      paymentAmount ? `Amount: ${escapeHtml(paymentAmount)}` : '',
      r.paymentReference ? `Ref: ${escapeHtml(r.paymentReference)}` : '',
    ].filter(Boolean);
    const pay = (r.paymentDeclared || paymentMeta.length)
      ? `${r.paymentDeclared ? 'Yes' : '<span style="opacity:0.75">Not declared</span>'}${r.paymentVerified ? '<div><span class="badge badge-success" style="margin-top:4px;">Verified</span></div>' : ''}${paymentMeta.length ? `<div class="invite-meta-sub">${paymentMeta.join('<br>')}</div>` : ''}`
      : '<span style="opacity:0.55">—</span>';

    // Payment proof display
    let proofHtml = '<span style="opacity:0.55">—</span>';
    if (r.paymentProof) {
      var proofParts = [];
      if (r.paymentProof.photoBase64) {
        var photoId = 'pp_' + escapeHtml(r.email).replace(/[^a-zA-Z0-9]/g, '_');
        var dataId = photoId + '_data';
        proofParts.push('<a href="javascript:void(0)" onclick="showPhotoModal(\'' + photoId + '\')" id="' + photoId + '" style="color:var(--accent);text-decoration:underline;">View Photo</a>');
        proofParts.push('<div id="' + dataId + '" style="display:none;">' + escapeHtml(r.paymentProof.photoBase64) + '</div>');
      }
      if (r.paymentProof.textMessage) {
        var shortMsg = r.paymentProof.textMessage.length > 80 ? r.paymentProof.textMessage.slice(0, 78) + '…' : r.paymentProof.textMessage;
        proofParts.push('<span title="' + escapeHtml(r.paymentProof.textMessage) + '">' + escapeHtml(shortMsg) + '</span>');
      }
      if (r.paymentProof.submittedAt) {
        var d = r.paymentProof.submittedAt.toDate ? r.paymentProof.submittedAt.toDate() : null;
        if (d) proofParts.push('<span class="invite-meta-sub">' + d.toLocaleDateString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) + '</span>');
      }
      proofHtml = proofParts.join('<br>') || '<span style="opacity:0.55">—</span>';
    } else if (r.paymentProofSubmitted) {
      proofHtml = '<span style="color:var(--success);">Submitted</span>';
    }

    const adminMessage = r.message
      ? `<div class="request-message-cell">${escapeHtml(r.message)}</div>`
      : '<span style="opacity:0.55">—</span>';
    const emailCol = r.emailSent
      ? '<span class="badge badge-success">Sent</span>'
      : (r.status === 'approved' && r.approvedPin
        ? `<span class="badge badge-danger" title="${escapeHtml(r.emailError || 'Not sent')}">Failed</span>`
        : '—');
    let actions = '';
    const alreadyHasAccess = authUserMeta.byEmail && !!authUserMeta.byEmail[r.email];
    if (r.status === 'pending') {
      if (alreadyHasAccess) {
        actions = `<span style="color:var(--success);font-size:0.75rem;">Has access</span>`;
      } else {
        actions = `
        <button class="action-btn" data-action="approve-req" data-email="${escapeHtml(r.email)}">Approve</button>
        <button class="action-btn" data-action="reject-req" data-email="${escapeHtml(r.email)}">Reject</button>
        <button class="action-btn" data-action="send-payment-due" data-email="${escapeHtml(r.email)}" title="Send payment due email">Payment Due</button>`;
      }
    } else if (r.status === 'approved') {
      actions = `<button class="action-btn" data-action="copy-req-pin" data-email="${escapeHtml(r.email)}">Copy PIN</button>`;
      if (!r.emailSent && r.approvedPin) {
        actions += ` <button class="action-btn" data-action="resend-req" data-email="${escapeHtml(r.email)}">Send email</button>`;
      }
      if (!r.paymentVerified) {
        actions += ` <button class="action-btn" data-action="send-payment-due" data-email="${escapeHtml(r.email)}" title="Send payment due email">Payment Due</button>`;
      }
      if ((r.paymentDeclared || r.paymentReference || r.paymentAmountPKR || r.paymentProof) && !r.paymentVerified) {
        actions += ` <button class="action-btn" data-action="verify-payment" data-email="${escapeHtml(r.email)}">Verify payment</button>`;
      }
    }
    return `<tr>
      <td>${escapeHtml(r.nameFull || '—')}</td>
      <td>${escapeHtml(r.email)}</td>
      <td><code>${escapeHtml(String(r.applicantId || '—'))}</code></td>
      <td>${pay}</td>
      <td>${adminMessage}</td>
      <td style="font-size:0.78rem;max-width:160px;overflow:hidden;">${proofHtml}</td>
      <td>${requestStatusBadge(r.status)}</td>
      <td>${formatRequestDate(r.requestedAt)}</td>
      <td>${emailCol}</td>
      <td class="action-cell">${actions || '—'}</td>
    </tr>`;
  }).join('');
}

function updateAccessRequestBadge() {
  const pending = allAccessRequests.filter(r => r.status === 'pending').length;
  const el = document.getElementById('navBadgeRequests');
  if (el) el.textContent = pending ? String(pending) : '—';
}

async function approveAccessRequest(email) {
  const req = allAccessRequests.find(r => r.email === email);
  if (!req || req.status !== 'pending') return;

  // Check if payment is required (paymentOptional === false)
  var configSnap;
  var paymentRequired = false;
  try {
    configSnap = await db.collection('notifications').doc('access_config').get();
    if (configSnap.exists) {
      var cfg = configSnap.data();
      if (cfg.paymentOptional === false) paymentRequired = true;
    }
  } catch (_) {}

  if (paymentRequired) {
    if (!confirm(`Approve ${email}?\n\nPayment is REQUIRED. A welcome email with PIN will be sent. Use the "Payment Due" button separately to send a payment reminder.`)) return;
  } else {
    if (!confirm(`Approve access for ${email}?\n\nA PIN will be generated and a welcome email attempted.`)) return;
  }

  const pin = generateAccessPin();
  try {
    const result = await grantPortalAccess({
      name: req.nameFull || email,
      email,
      pin,
      level: 'Standard User',
      inviteLimit: 2,
      sendEmail: true,
      applicantId: req.applicantId,
      inviteSource: 'access_request',
    });

    var updateData = {
      status: 'approved',
      reviewedAt: firebase.firestore.FieldValue.serverTimestamp(),
      reviewedBy: getAdminSessionEmail() || null,
      approvedPin: pin,
      emailSent: !!result.emailSent,
      emailError: result.emailError || null,
    };

    if (paymentRequired) {
      updateData.paymentVerified = false;
    }

    await db.collection('access_requests').doc(email).update(updateData);

    if (result.emailSent) {
      showAdminToast(`Approved ${email} — welcome email sent.`, 'success');
    } else {
      showAdminToast(`Approved ${email} — email failed. PIN: ${pin}`, 'error');
    }
    await loadAccessRequests();
    await loadUsers();
  } catch (err) {
    alert('Approve failed: ' + err.message);
  }
}

async function rejectAccessRequest(email) {
  if (!confirm(`Reject request from ${email}?`)) return;
  try {
    await db.collection('access_requests').doc(email).update({
      status: 'rejected',
      reviewedAt: firebase.firestore.FieldValue.serverTimestamp(),
      reviewedBy: getAdminSessionEmail() || null,
    });
    showAdminToast(`Rejected ${email}`, 'info');
    await loadAccessRequests();
  } catch (err) {
    alert('Reject failed: ' + err.message);
  }
}

async function resendAccessRequestEmail(email) {
  const req = allAccessRequests.find(r => r.email === email);
  if (!req?.approvedPin) {
    alert('No stored PIN for this request.');
    return;
  }
  try {
    await sendWelcomeEmail(req.nameFull || email, email, req.approvedPin, 'Standard User');
    await db.collection('access_requests').doc(email).update({
      emailSent: true,
      emailError: null,
    });
    showAdminToast(`Email sent to ${email}`, 'success');
    await loadAccessRequests();
  } catch (err) {
    const msg = err?.text || err?.message || String(err);
    await db.collection('access_requests').doc(email).update({
      emailSent: false,
      emailError: msg,
    }).catch(() => {});
    showAdminToast(`Email failed: ${msg}`, 'error');
    await loadAccessRequests();
  }
}

async function sendPaymentDueToRequest(email) {
  const req = allAccessRequests.find(r => r.email === email);
  if (!req) return;
  var name = req.nameFull || email;
  var applicantId = req.applicantId || '';
  try {
    await sendPaymentDueEmail(name, email, applicantId);
    await db.collection('access_requests').doc(email).update({
      paymentDueSent: true,
      paymentDueSentAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    showAdminToast('Payment due email sent to ' + email, 'success');
    await loadAccessRequests();
  } catch (err) {
    showAdminToast('Failed: ' + (err?.message || String(err)), 'error');
  }
}

async function verifyAccessRequestPayment(email) {
  const req = allAccessRequests.find(r => r.email === email);
  if (!req) return;
  if (req.paymentVerified) {
    showAdminToast('Payment already verified.', 'info');
    return;
  }
  const amountPKR = Number(req.paymentAmountPKR) || 0;
  if (!amountPKR && !confirm(`${email} did not provide a payment amount. Create a zero-amount contribution record anyway?`)) return;
  if (amountPKR && !confirm(`Verify payment for ${email} and add PKR ${amountPKR.toLocaleString('en-PK')} to contributions?`)) return;

  try {
    const rate = 278;
    const contribution = {
      name: req.nameFull || email,
      email,
      amountPKR: Math.round(amountPKR),
      amountUSD: amountPKR ? parseFloat((amountPKR / rate).toFixed(2)) : 0,
      conversionRate: rate,
      date: firebase.firestore.FieldValue.serverTimestamp(),
      source: 'access_request_payment',
      accessRequestId: email,
      paymentReference: req.paymentReference || '',
      verifiedBy: getAdminSessionEmail() || null,
      verifiedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };
    const ref = await db.collection('contributions').add(contribution);
    await db.collection('access_requests').doc(email).update({
      paymentVerified: true,
      paymentVerifiedAt: firebase.firestore.FieldValue.serverTimestamp(),
      paymentVerifiedBy: getAdminSessionEmail() || null,
      contributionId: ref.id,
    });

    // Send welcome email if it hasn't been sent yet (payment-required flow)
    if (req.approvedPin && !req.emailSent) {
      try {
        await sendWelcomeEmail(req.nameFull || email, email, req.approvedPin, 'Standard User');
        await db.collection('access_requests').doc(email).update({
          emailSent: true,
          emailError: null,
        });
      } catch (emailErr) {
        showAdminToast('Welcome email failed after verification. PIN: ' + req.approvedPin, 'error');
      }
    }

    showAdminToast('Payment verified and contribution added.', 'success');
    await loadAccessRequests();
    if (document.getElementById('tab-contributions')?.style.display !== 'none') await loadContributions();
  } catch (err) {
    alert('Payment verification failed: ' + err.message);
  }
}

function copyAccessRequestPin(email) {
  const req = allAccessRequests.find(r => r.email === email);
  if (!req?.approvedPin) {
    showAdminToast('No PIN stored for this request.', 'error');
    return;
  }
  const text = `MeritNama Portal Access\nEmail: ${email}\nPIN: ${req.approvedPin}\nURL: ${PORTAL_URL}`;
  navigator.clipboard.writeText(text).then(() => {
    showAdminToast('Credentials copied to clipboard.', 'success');
  }).catch(() => {
    prompt('Copy credentials:', text);
  });
}

function initAccessConfigAdmin() {
  const loadBtn = document.getElementById('accessCfgLoadBtn');
  const defBtn = document.getElementById('accessCfgDefaultsBtn');
  const saveBtn = document.getElementById('accessCfgSaveBtn');
  if (loadBtn) loadBtn.onclick = loadAccessConfigEditor;
  if (defBtn) defBtn.onclick = () => fillAccessConfigForm(ACCESS_CFG_DEFAULTS);
  if (saveBtn) saveBtn.onclick = saveAccessConfigEditor;
  loadAccessConfigEditor();
}

function fillAccessConfigForm(cfg) {
  const normalized = window.MNAccessRequest
    ? MNAccessRequest.normalizePaymentConfig({ ...ACCESS_CFG_DEFAULTS, ...cfg })
    : { ...ACCESS_CFG_DEFAULTS, ...cfg };
  document.getElementById('accessCfgEnabled').checked = normalized.requestAccessEnabled !== false;
  document.getElementById('accessCfgShow').checked = normalized.showOnRequestPage !== false;
  document.getElementById('accessCfgOptional').checked = normalized.paymentOptional !== false;
  document.getElementById('accessCfgBlockInvites').checked = normalized.blockInvites === true;
  document.getElementById('accessCfgPriceMinPKR').value = normalized.accessPriceMinPKR ?? 250;
  document.getElementById('accessCfgPriceMaxPKR').value = normalized.accessPriceMaxPKR ?? 670;
  document.getElementById('accessCfgPriceMinUSD').value = normalized.accessPriceMinUSD ?? 0.9;
  document.getElementById('accessCfgPriceMaxUSD').value = normalized.accessPriceMaxUSD ?? 2.4;
  document.getElementById('accessCfgAccount').value = normalized.accountNumber || '';
  document.getElementById('accessCfgBank').value = normalized.bankName || '';
  document.getElementById('accessCfgClosedMessage').value = normalized.requestClosedMessage || '';
  document.getElementById('accessCfgNote').value = normalized.paymentNote || '';
}

async function loadAccessConfigEditor() {
  const statusEl = document.getElementById('accessCfgStatus');
  try {
    const snap = await db.collection('notifications').doc('access_config').get();
    fillAccessConfigForm(snap.exists ? { ...ACCESS_CFG_DEFAULTS, ...snap.data() } : ACCESS_CFG_DEFAULTS);
    if (statusEl) { statusEl.textContent = 'Config loaded.'; statusEl.style.color = 'var(--success)'; }
  } catch (err) {
    fillAccessConfigForm(ACCESS_CFG_DEFAULTS);
    if (statusEl) { statusEl.textContent = 'Using defaults — ' + err.message; statusEl.style.color = 'var(--neon-pink)'; }
  }
}

async function saveAccessConfigEditor() {
  const statusEl = document.getElementById('accessCfgStatus');
  let minPkr = Number(document.getElementById('accessCfgPriceMinPKR').value) || 0;
  let maxPkr = Number(document.getElementById('accessCfgPriceMaxPKR').value) || 0;
  let minUsd = Number(document.getElementById('accessCfgPriceMinUSD').value) || 0;
  let maxUsd = Number(document.getElementById('accessCfgPriceMaxUSD').value) || 0;
  if (minPkr > maxPkr && maxPkr > 0) { const t = minPkr; minPkr = maxPkr; maxPkr = t; }
  if (minUsd > maxUsd && maxUsd > 0) { const t = minUsd; minUsd = maxUsd; maxUsd = t; }
  const data = {
    requestAccessEnabled: document.getElementById('accessCfgEnabled').checked,
    requestClosedMessage: document.getElementById('accessCfgClosedMessage').value.trim(),
    showOnRequestPage: document.getElementById('accessCfgShow').checked,
    paymentOptional: document.getElementById('accessCfgOptional').checked,
    blockInvites: document.getElementById('accessCfgBlockInvites').checked,
    showAccountTitle: false,
    accessPriceMinPKR: minPkr,
    accessPriceMaxPKR: maxPkr,
    accessPriceMinUSD: minUsd,
    accessPriceMaxUSD: maxUsd,
    accountNumber: document.getElementById('accessCfgAccount').value.trim(),
    raastId: '',
    bankName: document.getElementById('accessCfgBank').value.trim(),
    paymentNote: document.getElementById('accessCfgNote').value.trim(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  };
  try {
    await db.collection('notifications').doc('access_config').set(data, { merge: true });
    if (statusEl) { statusEl.textContent = 'Saved to notifications/access_config'; statusEl.style.color = 'var(--success)'; }
    showAdminToast('Access request config saved.', 'success');
  } catch (err) {
    if (statusEl) { statusEl.textContent = 'Save failed: ' + err.message; statusEl.style.color = 'var(--neon-pink)'; }
  }
}

// ── REVISIONS CONFIG EDITOR ──────────────────────────────────────────────
let revisionsConfigDraft = { disabledIds: [], trackedFields: [] };

function setRevisionsConfigStatus(message, color) {
  const el = document.getElementById('revCfgStatus');
  if (!el) return;
  el.textContent = message;
  el.style.color = color || 'var(--text-muted)';
}

function collectCandidateRevisionIdsFromData() {
  const ids = new Set();
  try {
    const candidates = typeof allCandidates === 'function' ? allCandidates() : window.SIM?.candidates || [];
    for (const c of candidates || []) {
      const revisions = c?.revisions;
      if (!revisions || typeof revisions !== 'object') continue;
      Object.keys(revisions).forEach(id => { if (id) ids.add(id); });
    }
  } catch (_) {}
  return ids;
}

function renderRevisionsConfigList() {
  const listEl = document.getElementById('revCfgList');
  if (!listEl) return;
  const disabled = new Set(revisionsConfigDraft.disabledIds || []);
  const fromData = collectCandidateRevisionIdsFromData();
  const sorted = [...new Set([...fromData, ...disabled])].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  );
  if (!sorted.length) {
    listEl.innerHTML = '<p style="color:var(--text-muted);font-size:0.82rem;">No revision IDs yet. Add one above or load saved config.</p>';
    return;
  }
  const _e = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  listEl.innerHTML = sorted.map(id => {
    const eid = _e(id);
    const isDisabled = disabled.has(id);
    return `<label style="display:flex;gap:0.65rem;align-items:center;padding:0.6rem 0.75rem;border:1px solid var(--border);border-radius:8px;cursor:pointer;">
      <input type="checkbox" class="rev-cfg-toggle" value="${eid}" ${isDisabled ? '' : 'checked'} style="accent-color:var(--accent);" />
      <span style="font-size:0.84rem;color:var(--text);">${eid}</span>
      <span style="font-size:0.72rem;color:var(--text-muted);margin-left:auto;">${isDisabled ? 'disabled' : 'enabled'}</span>
    </label>`;
  }).join('');
  listEl.querySelectorAll('.rev-cfg-toggle').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = cb.value;
      const disabled = new Set(revisionsConfigDraft.disabledIds || []);
      if (cb.checked) disabled.delete(id); else disabled.add(id);
      revisionsConfigDraft.disabledIds = [...disabled].sort();
      renderRevisionsConfigList();
    });
  });
}

async function loadRevisionsConfigEditor() {
  setRevisionsConfigStatus('Loading config…');
  const trackedEl = document.getElementById('revCfgTrackedFields');
  document.getElementById('revCfgAddBtn').onclick = () => {
    const input = document.getElementById('revCfgNewId');
    const id = input?.value.trim();
    if (!id) { setRevisionsConfigStatus('Enter a revision ID.', 'var(--neon-pink)'); return; }
    if (!/^[a-z0-9][a-z0-9-_]*$/i.test(id)) {
      setRevisionsConfigStatus('Use letters, numbers, hyphens, underscores.', 'var(--neon-pink)');
      return;
    }
    const disabled = new Set(revisionsConfigDraft.disabledIds || []);
    if (!disabled.has(id)) {
      const all = [...collectCandidateRevisionIdsFromData(), ...disabled];
      if (!all.includes(id)) disabled.add(id);
    }
    revisionsConfigDraft.disabledIds = [...disabled].sort();
    if (input) input.value = '';
    renderRevisionsConfigList();
    setRevisionsConfigStatus(`Added "${String(id).replace(/"/g, '&quot;')}". Save to publish.`, 'var(--neon-gold)');
  };
  try {
    const snap = await db.collection('notifications').doc('revisions_config').get();
    if (snap.exists) {
      const data = snap.data();
      revisionsConfigDraft.disabledIds = Array.isArray(data.disabledIds) ? data.disabledIds : [];
      if (Array.isArray(data.trackedFields) && data.trackedFields.length) {
        revisionsConfigDraft.trackedFields = data.trackedFields;
        if (trackedEl) trackedEl.value = data.trackedFields.join(', ');
      } else {
        revisionsConfigDraft.trackedFields = [];
        if (trackedEl) trackedEl.value = '';
      }
    } else {
      revisionsConfigDraft.disabledIds = [];
      revisionsConfigDraft.trackedFields = [];
      if (trackedEl) trackedEl.value = 'houseJob, position, mdcat, degree';
    }
    renderRevisionsConfigList();
    setRevisionsConfigStatus('Revisions config loaded.', 'var(--neon-green)');
  } catch (e) {
    revisionsConfigDraft.disabledIds = [];
    revisionsConfigDraft.trackedFields = [];
    renderRevisionsConfigList();
    setRevisionsConfigStatus('Error loading: ' + e.message, 'var(--neon-pink)');
  }
}

function enableAllRevisions() {
  revisionsConfigDraft.disabledIds = [];
  renderRevisionsConfigList();
  setRevisionsConfigStatus('All revisions enabled. Save to publish.', 'var(--neon-gold)');
}

async function saveRevisionsConfigEditor() {
  setRevisionsConfigStatus('Saving…');
  const trackedEl = document.getElementById('revCfgTrackedFields');
  const trackedRaw = trackedEl?.value || '';
  const trackedFields = trackedRaw.split(',').map(s => s.trim()).filter(Boolean);
  try {
    const payload = {
      disabledIds: revisionsConfigDraft.disabledIds || [],
      trackedFields: trackedFields.length ? trackedFields : ['houseJob', 'position', 'mdcat', 'degree'],
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };
    await db.collection('notifications').doc('revisions_config').set(payload);
    revisionsConfigDraft.trackedFields = payload.trackedFields;
    setRevisionsConfigStatus('✓ Revisions config saved. User dropdowns update on next page load.', 'var(--neon-green)');
    showAdminToast('Revisions config saved.', 'success');
  } catch (e) {
    setRevisionsConfigStatus('Error saving: ' + e.message, 'var(--neon-pink)');
  }
}

function switchTab(tab) {
  const tabs = ['overview', 'logs', 'screenshots', 'warnings', 'grievances', 'users', 'access-requests', 'contributions', 'mentorship', 'broadcast', 'config', 'profiles', 'download-logs', 'user-activity', 'jobs-sync', 'candidates'];
  for (const t of tabs) {
    const el = document.getElementById('tab-' + t);
    if (el) el.style.display = tab === t ? '' : 'none';
  }
  document.querySelectorAll('.sidebar-link[data-tab], .tab-btn[data-tab]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  const meta = TAB_META[tab] || TAB_META.overview;
  const titleEl = document.getElementById('dashPageTitle');
  const subEl = document.getElementById('dashPageSub');
  if (titleEl) titleEl.textContent = meta.title;
  if (subEl) subEl.textContent = meta.sub;
  try { localStorage.setItem(ADMIN_TAB_KEY, tab); } catch (_) {}

  if (tab === 'overview')     { loadOverviewMetrics(); renderAccessTrendChart(); renderRecentActivity(); }
  if (tab === 'users')         loadUsers();
  if (tab === 'access-requests') loadAccessRequests();
  if (tab === 'contributions') loadContributions();
  if (tab === 'mentorship')    loadMentorship();
  if (tab === 'broadcast')     loadBroadcast();
  if (tab === 'config')        loadConfig();
  if (tab === 'profiles')      loadProfiles();
  if (tab === 'logs')          loadLogs();
  if (tab === 'screenshots')   loadScreenshotLogs();
  if (tab === 'download-logs') loadDownloadLogs();
  if (tab === 'user-activity') {} // loaded on search
  if (tab === 'warnings')      loadWarnings();
  if (tab === 'grievances')    loadGrievances();
  if (tab === 'candidates')    loadCandidatesTab();
  if (tab === 'jobs-sync')     _refreshJobsMetaPill();
}

// ── BROADCAST NOTIFICATIONS ──────────────────────────────────────────────────
function loadBroadcast() {
  loadSubCount();
  document.getElementById('bcSendBtn').onclick = sendLiveUpdate;
  document.getElementById('bcClearBtn').onclick = clearLiveBanner;
  document.getElementById('simNotifLoadBtn').onclick = loadSimulationNotificationsEditor;
  document.getElementById('simNotifFallbackBtn').onclick = loadSimulationNotificationsFallback;
  document.getElementById('simNotifSaveBtn').onclick = saveSimulationNotificationsEditor;
  document.getElementById('fpLoadBtn').onclick = loadFetchProgressEditor;
  document.getElementById('fpNowBtn').onclick = () => {
    const el = document.getElementById('fpStartedAt');
    if (el) el.value = tsToDatetimeLocal(new Date());
  };
  document.getElementById('fpSaveBtn').onclick = saveFetchProgressEditor;
  document.getElementById('fpClearBtn').onclick = clearFetchProgressEditor;
  document.getElementById('schedAdminLoadBtn')?.addEventListener('click', loadScheduleAdminEditor);
  document.getElementById('schedAdminStaticBtn')?.addEventListener('click', loadScheduleAdminStatic);
  document.getElementById('schedAdminSaveBtn')?.addEventListener('click', saveScheduleAdminEditor);
  document.getElementById('psAdminLoadBtn')?.addEventListener('click', loadProfileStatusAdminEditor);
  document.getElementById('psAdminStaticBtn')?.addEventListener('click', loadProfileStatusAdminStatic);
  document.getElementById('psAdminSaveBtn')?.addEventListener('click', saveProfileStatusAdminEditor);
  document.getElementById('chatPinLoadBtn')?.addEventListener('click', loadChatPinEditor);
  document.getElementById('chatPinSaveBtn')?.addEventListener('click', saveChatPinEditor);
  document.getElementById('chatPinClearBtn')?.addEventListener('click', clearChatPinEditor);
  loadSimulationNotificationsEditor();
  loadFetchProgressEditor();
  loadScheduleAdminEditor();
  loadProfileStatusAdminEditor();
  loadChatPinEditor();
}

function loadConfig() {
  document.getElementById('revCfgLoadBtn')?.addEventListener('click', loadRevisionsConfigEditor);
  document.getElementById('revCfgDefaultsBtn')?.addEventListener('click', () => enableAllRevisions());
  document.getElementById('revCfgSaveBtn')?.addEventListener('click', saveRevisionsConfigEditor);
  const simCfgLoadBtn = document.getElementById('simCfgLoadBtn');
  const simCfgDefaultsBtn = document.getElementById('simCfgDefaultsBtn');
  const simCfgSaveBtn = document.getElementById('simCfgSaveBtn');
  const simCfgCustomAddBtn = document.getElementById('simCfgCustomAddBtn');
  if (simCfgLoadBtn) simCfgLoadBtn.onclick = loadSimulationConfigEditor;
  if (simCfgDefaultsBtn) simCfgDefaultsBtn.onclick = loadSimulationConfigDefaults;
  if (simCfgSaveBtn) simCfgSaveBtn.onclick = saveSimulationConfigEditor;
  if (simCfgCustomAddBtn) simCfgCustomAddBtn.onclick = addCustomSimulationScope;
  initMarksConfigAdmin();
  initAccessConfigAdmin();
  loadSimulationConfigEditor();
  renderDropdownConfig();
}

function setScheduleAdminStatus(message, color = 'var(--text-muted)') {
  const el = document.getElementById('schedAdminStatus');
  if (!el) return;
  el.textContent = message;
  el.style.color = color;
}

function normalizeScheduleAdminSteps(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw?.Table && Array.isArray(raw.Table)) return raw.Table;
  if (raw?.steps && Array.isArray(raw.steps)) return raw.steps;
  return null;
}

async function loadScheduleAdminEditor() {
  setScheduleAdminStatus('Loading schedule from Firestore…');
  try {
    const snap = await db.collection('notifications').doc('induction_schedule').get();
    if (!snap.exists) {
      setScheduleAdminStatus('No live schedule in Firestore yet. Load static snapshot or paste JSON.', 'var(--neon-gold)');
      return;
    }
    const data = snap.data();
    const steps = normalizeScheduleAdminSteps(data);
    const ta = document.getElementById('schedAdminJson');
    if (ta && steps) ta.value = JSON.stringify({ Table: steps }, null, 2);
    setScheduleAdminStatus(`Loaded ${steps?.length || 0} steps from Firestore.`, 'var(--neon-green)');
  } catch (e) {
    setScheduleAdminStatus('Error loading schedule: ' + e.message, 'var(--neon-pink)');
  }
}

async function loadScheduleAdminStatic() {
  setScheduleAdminStatus('Loading static snapshot…');
  try {
    const res = await fetch('data/induction21_schedule.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const steps = normalizeScheduleAdminSteps(data);
    const ta = document.getElementById('schedAdminJson');
    if (ta && steps) ta.value = JSON.stringify({ Table: steps }, null, 2);
    setScheduleAdminStatus(`Loaded ${steps?.length || 0} steps from static snapshot (not saved yet).`, 'var(--neon-green)');
  } catch (e) {
    setScheduleAdminStatus('Error loading static snapshot: ' + e.message, 'var(--neon-pink)');
  }
}

async function saveScheduleAdminEditor() {
  const ta = document.getElementById('schedAdminJson');
  if (!ta?.value.trim()) {
    setScheduleAdminStatus('Paste schedule JSON first.', 'var(--neon-pink)');
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(ta.value);
  } catch (e) {
    setScheduleAdminStatus('Invalid JSON: ' + e.message, 'var(--neon-pink)');
    return;
  }
  const steps = normalizeScheduleAdminSteps(parsed);
  if (!steps?.length) {
    setScheduleAdminStatus('JSON must contain a Table/steps array with at least one step.', 'var(--neon-pink)');
    return;
  }
  setScheduleAdminStatus('Saving…');
  try {
    await db.collection('notifications').doc('induction_schedule').set({
      induction: 21,
      source: 'admin_paste',
      steps,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    setScheduleAdminStatus(`Saved ${steps.length} steps. Schedule tab will update live.`, 'var(--neon-green)');
  } catch (e) {
    setScheduleAdminStatus('Error saving schedule: ' + e.message, 'var(--neon-pink)');
  }
}

function setProfileStatusAdminStatus(message, color = 'var(--text-muted)') {
  const el = document.getElementById('psAdminStatus');
  if (!el) return;
  el.textContent = message;
  el.style.color = color;
}

function normalizeProfileStatusAdminEntries(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw?.entries && Array.isArray(raw.entries)) return raw.entries;
  if (raw?.Table && Array.isArray(raw.Table)) return raw.Table;
  return null;
}

function detectV2Payload(raw) {
  return raw && typeof raw === 'object' && !Array.isArray(raw) && raw.statusTypes && typeof raw.statusTypes === 'object' && Object.keys(raw.statusTypes).length > 0;
}

async function loadProfileStatusAdminEditor() {
  setProfileStatusAdminStatus('Loading profile status from Firestore…');
  try {
    const snap = await db.collection('notifications').doc('profile_status').get();
    if (!snap.exists) {
      setProfileStatusAdminStatus('No live profile status in Firestore yet. Load static snapshot or paste JSON.', 'var(--neon-gold)');
      return;
    }
    const data = snap.data();
    const ta = document.getElementById('psAdminJson');
    const stTa = document.getElementById('psAdminStatusTypes');

    if (detectV2Payload(data)) {
      if (ta && data.entries) ta.value = JSON.stringify(data.entries, null, 2);
      if (stTa) stTa.value = JSON.stringify(data.statusTypes, null, 2);
      setProfileStatusAdminStatus(`Loaded v2 payload from Firestore: ${Object.keys(data.statusTypes).length} type(s), ${data.entries?.length || 0} entries.`, 'var(--neon-green)');
    } else {
      const entries = normalizeProfileStatusAdminEntries(data);
      if (ta && entries) ta.value = JSON.stringify(entries, null, 2);
      if (stTa && data.statusTypeId != null && data.statusTypeLabel) {
        const legacyTypes = {};
        legacyTypes[String(data.statusTypeId)] = {
          label: data.statusTypeLabel,
          statusLabels: data.statusLabels || { '1': 'Accepted', '2': 'Rejected', '11': 'Pending' },
        };
        stTa.value = JSON.stringify(legacyTypes, null, 2);
      }
      setProfileStatusAdminStatus(`Loaded legacy payload: ${entries?.length || 0} entries (single type). Converted to v2 format in editor — review before saving.`, 'var(--neon-gold)');
    }
  } catch (e) {
    setProfileStatusAdminStatus('Error loading profile status: ' + e.message, 'var(--neon-pink)');
  }
}

async function loadProfileStatusAdminStatic() {
  setProfileStatusAdminStatus('Loading static snapshot…');
  try {
    const res = await fetch('data/ProfileStatus.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const ta = document.getElementById('psAdminJson');
    const stTa = document.getElementById('psAdminStatusTypes');

    if (detectV2Payload(data)) {
      if (ta && data.entries) ta.value = JSON.stringify(data.entries, null, 2);
      if (stTa) stTa.value = JSON.stringify(data.statusTypes, null, 2);
      setProfileStatusAdminStatus(`Loaded v2 snapshot: ${Object.keys(data.statusTypes).length} type(s), ${data.entries?.length || 0} entries (not saved yet).`, 'var(--neon-green)');
    } else if (Array.isArray(data)) {
      if (ta) ta.value = JSON.stringify(data, null, 2);
      setProfileStatusAdminStatus(`Loaded ${data.length} entries from static snapshot (not saved yet).`, 'var(--neon-green)');
    } else {
      setProfileStatusAdminStatus('Static snapshot has unexpected format.', 'var(--neon-pink)');
    }
  } catch (e) {
    setProfileStatusAdminStatus('Error loading static snapshot: ' + e.message, 'var(--neon-pink)');
  }
}

async function saveProfileStatusAdminEditor() {
  const ta = document.getElementById('psAdminJson');
  if (!ta?.value.trim()) {
    setProfileStatusAdminStatus('Paste profile status JSON first.', 'var(--neon-pink)');
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(ta.value);
  } catch (e) {
    setProfileStatusAdminStatus('Invalid entries JSON: ' + e.message, 'var(--neon-pink)');
    return;
  }
  const entries = normalizeProfileStatusAdminEntries(parsed);
  if (!entries?.length) {
    setProfileStatusAdminStatus('Entries must be an array with at least one row.', 'var(--neon-pink)');
    return;
  }
  const stTa = document.getElementById('psAdminStatusTypes');
  let statusTypes = null;
  if (stTa?.value.trim()) {
    try {
      statusTypes = JSON.parse(stTa.value.trim());
      if (typeof statusTypes !== 'object' || Array.isArray(statusTypes)) {
        setProfileStatusAdminStatus('Status types metadata must be a JSON object (not array).', 'var(--neon-pink)');
        return;
      }
    } catch (e) {
      setProfileStatusAdminStatus('Invalid status types JSON: ' + e.message, 'var(--neon-pink)');
      return;
    }
  }
  setProfileStatusAdminStatus('Saving…');
  try {
    if (statusTypes && Object.keys(statusTypes).length > 0) {
      // Save as full v2 grouped format
      await db.collection('notifications').doc('profile_status').set({
        version: 2,
        statusTypes,
        entries,
        source: 'admin_paste',
        meta: {
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        },
      }, { merge: true });
      setProfileStatusAdminStatus(`Saved v2 payload: ${Object.keys(statusTypes).length} type(s), ${entries.length} entries.`, 'var(--neon-green)');
    } else {
      // Fall back to legacy single-type save
      const typeLabel = 'Profile status';
      const typeIds = [...new Set(entries.map(e => e.statusTypeId).filter(t => t != null))];
      const typeId = typeIds.length === 1 ? Number(typeIds[0]) : 131;
      await db.collection('notifications').doc('profile_status').set({
        source: 'admin_paste',
        statusTypeId: Number.isFinite(typeId) ? typeId : null,
        statusTypeLabel: typeLabel,
        statusLabels: { '1': 'Accepted', '2': 'Rejected', '11': 'Pending' },
        entries,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      setProfileStatusAdminStatus(`Saved ${entries.length} entries (legacy format).`, 'var(--neon-green)');
    }
  } catch (e) {
    setProfileStatusAdminStatus('Error saving profile status: ' + e.message, 'var(--neon-pink)');
  }
}

function setChatPinAdminStatus(message, color = 'var(--text-muted)') {
  const el = document.getElementById('chatPinStatus');
  if (!el) return;
  el.textContent = message;
  el.style.color = color;
}

async function loadChatPinEditor() {
  setChatPinAdminStatus('Loading…');
  try {
    const snap = await db.collection('notifications').doc('chat_pin').get();
    const ta = document.getElementById('chatPinText');
    if (!snap.exists || !snap.data()?.active) {
      if (ta) ta.value = '';
      setChatPinAdminStatus('No pinned message active.', 'var(--neon-gold)');
      return;
    }
    if (ta) ta.value = snap.data().text || '';
    setChatPinAdminStatus('Loaded current pin.', 'var(--neon-green)');
  } catch (e) {
    setChatPinAdminStatus('Error: ' + e.message, 'var(--neon-pink)');
  }
}

async function saveChatPinEditor() {
  const text = document.getElementById('chatPinText')?.value?.trim();
  if (!text) {
    setChatPinAdminStatus('Enter a message to pin.', 'var(--neon-pink)');
    return;
  }
  setChatPinAdminStatus('Saving…');
  try {
    const adminEmail = getAdminSessionEmail() || 'admin';
    await db.collection('notifications').doc('chat_pin').set({
      active: true,
      text,
      pinnedBy: adminEmail,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    setChatPinAdminStatus('Pinned — chat will update live.', 'var(--neon-green)');
  } catch (e) {
    setChatPinAdminStatus('Error: ' + e.message, 'var(--neon-pink)');
  }
}

async function clearChatPinEditor() {
  setChatPinAdminStatus('Clearing…');
  try {
    await db.collection('notifications').doc('chat_pin').set({
      active: false,
      text: '',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    const ta = document.getElementById('chatPinText');
    if (ta) ta.value = '';
    setChatPinAdminStatus('Pin cleared.', 'var(--neon-green)');
  } catch (e) {
    setChatPinAdminStatus('Error: ' + e.message, 'var(--neon-pink)');
  }
}

function setSimulationConfigStatus(message, color = 'var(--text-muted)') {
  const el = document.getElementById('simCfgStatus');
  if (!el) return;
  el.textContent = message;
  el.style.color = color;
}

function normalizeSimulationScopeAdmin(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `scope-${idx + 1}`;
  const label = typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : id;
  const description = typeof raw.description === 'string' ? raw.description.trim() : '';
  const includeAll = raw.includeAll === true || id === 'all';
  const statusIds = includeAll
    ? []
    : (Array.isArray(raw.statusIds) ? raw.statusIds : [])
        .map(Number)
        .filter(Number.isFinite);
  if (!includeAll && !statusIds.length) return null;
  return { id, label, description, includeAll, statusIds };
}

function cloneDefaultSimulationScopesAdmin() {
  return DEFAULT_SIM_STATUS_SCOPES_ADMIN.map(scope => ({
    ...scope,
    statusIds: [...(scope.statusIds || [])],
  }));
}

function simulationScopeIsDefault(scopeId) {
  return DEFAULT_SIM_STATUS_SCOPES_ADMIN.some(scope => scope.id === scopeId);
}

function allSimulationScopeTemplatesAdmin() {
  const merged = new Map();
  cloneDefaultSimulationScopesAdmin().forEach(scope => merged.set(scope.id, { ...scope, isDefault: true }));
  (simulationConfigDraft.statusScopes || []).forEach(scope => {
    if (!scope?.id) return;
    const existing = merged.get(scope.id) || {};
    merged.set(scope.id, {
      ...existing,
      ...scope,
      statusIds: [...(scope.statusIds || [])],
      isDefault: simulationScopeIsDefault(scope.id),
    });
  });
  return [...merged.values()];
}

function parseSimulationStatusIds(raw) {
  return String(raw || '')
    .split(',')
    .map(s => Number(s.trim()))
    .filter(Number.isFinite);
}

let simulationConfigDraft = {
  statusScopes: cloneDefaultSimulationScopesAdmin(),
  defaultStatusScopeId: 'all',
  showStatusScopeSelector: true,
};

function renderSimulationConfigEditor() {
  const scopesEl = document.getElementById('simCfgScopes');
  const defaultEl = document.getElementById('simCfgDefaultScope');
  const showEl = document.getElementById('simCfgShowSelector');
  if (!scopesEl || !defaultEl) return;

  const activeIds = new Set((simulationConfigDraft.statusScopes || []).map(scope => scope.id));
  const templates = allSimulationScopeTemplatesAdmin();
  const defaultOptions = DEFAULT_SIM_STATUS_SCOPES_ADMIN
    .filter(scope => activeIds.has(scope.id))
    .map(scope => `<option value="${escapeHtml(scope.id)}">${escapeHtml(scope.label)}</option>`)
    .concat(
      templates
        .filter(scope => activeIds.has(scope.id) && !simulationScopeIsDefault(scope.id))
        .map(scope => `<option value="${escapeHtml(scope.id)}">${escapeHtml(scope.label)}</option>`)
    );
  defaultEl.innerHTML = defaultOptions.join('');
  defaultEl.value = activeIds.has(simulationConfigDraft.defaultStatusScopeId)
    ? simulationConfigDraft.defaultStatusScopeId
    : (simulationConfigDraft.statusScopes[0]?.id || 'all');
  defaultEl.onchange = () => {
    simulationConfigDraft.defaultStatusScopeId = defaultEl.value || 'all';
  };
  if (showEl) showEl.checked = simulationConfigDraft.showStatusScopeSelector !== false;

  scopesEl.innerHTML = templates.map(scope => {
    const checked = activeIds.has(scope.id) ? 'checked' : '';
    const disabled = scope.id === 'all' ? 'disabled' : '';
    const statusLabel = scope.includeAll
      ? 'all statuses'
      : `status IDs: ${(scope.statusIds || []).join(', ')}`;
    const removeBtn = scope.isDefault
      ? ''
      : `<button type="button" class="sim-cfg-remove-scope" data-scope-id="${escapeHtml(scope.id)}" style="margin-top:0.45rem;padding:4px 8px;background:rgba(224,84,112,0.1);color:var(--neon-pink);border:1px solid rgba(224,84,112,0.25);border-radius:6px;cursor:pointer;font-size:0.7rem;">Remove custom</button>`;
    return `
      <label style="display:flex;gap:0.65rem;align-items:flex-start;padding:0.75rem;border:1px solid var(--border);border-radius:8px;background:rgba(255,255,255,0.02);cursor:pointer;">
        <input type="checkbox" class="sim-cfg-scope-check" value="${escapeHtml(scope.id)}" ${checked} ${disabled} style="margin-top:2px;accent-color:var(--accent);" />
        <span>
          <strong style="color:var(--text);font-size:0.84rem;">${escapeHtml(scope.label)}</strong>
          <br><span style="color:var(--text-muted);font-size:0.72rem;line-height:1.45;">${escapeHtml(statusLabel)}</span>
          ${scope.description ? `<br><span style="color:var(--text-muted);font-size:0.74rem;line-height:1.45;">${escapeHtml(scope.description)}</span>` : ''}
          ${removeBtn}
        </span>
      </label>`;
  }).join('');

  scopesEl.querySelectorAll('.sim-cfg-scope-check').forEach(input => {
    input.addEventListener('change', () => {
      const selected = new Set(['all']);
      scopesEl.querySelectorAll('.sim-cfg-scope-check:checked').forEach(chk => selected.add(chk.value));
      simulationConfigDraft.statusScopes = allSimulationScopeTemplatesAdmin()
        .filter(scope => selected.has(scope.id))
        .map(scope => ({ ...scope, statusIds: [...scope.statusIds] }));
      if (!selected.has(simulationConfigDraft.defaultStatusScopeId)) {
        simulationConfigDraft.defaultStatusScopeId = simulationConfigDraft.statusScopes[0]?.id || 'all';
      }
      renderSimulationConfigEditor();
    });
  });
  scopesEl.querySelectorAll('.sim-cfg-remove-scope').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.scopeId;
      simulationConfigDraft.statusScopes = (simulationConfigDraft.statusScopes || [])
        .filter(scope => scope.id !== id);
      if (simulationConfigDraft.defaultStatusScopeId === id) {
        simulationConfigDraft.defaultStatusScopeId = simulationConfigDraft.statusScopes[0]?.id || 'all';
      }
      renderSimulationConfigEditor();
      setSimulationConfigStatus('Custom scope removed. Save to publish.', 'var(--neon-gold)');
    });
  });
}

function addCustomSimulationScope() {
  const idEl = document.getElementById('simCfgCustomId');
  const labelEl = document.getElementById('simCfgCustomLabel');
  const statusEl = document.getElementById('simCfgCustomStatusIds');
  const descEl = document.getElementById('simCfgCustomDescription');

  const id = idEl?.value.trim() || '';
  const label = labelEl?.value.trim() || '';
  const statusIds = parseSimulationStatusIds(statusEl?.value || '');
  const description = descEl?.value.trim() || '';

  if (!id || !/^[a-z0-9][a-z0-9-_]*$/i.test(id)) {
    setSimulationConfigStatus('Custom scope ID is required (letters, numbers, hyphens, underscores).', 'var(--neon-pink)');
    return;
  }
  if (id === 'all') {
    setSimulationConfigStatus('The ID "all" is reserved.', 'var(--neon-pink)');
    return;
  }
  if (allSimulationScopeTemplatesAdmin().some(scope => scope.id === id)) {
    setSimulationConfigStatus('A scope with this ID already exists.', 'var(--neon-pink)');
    return;
  }
  if (!label) {
    setSimulationConfigStatus('Custom scope label is required.', 'var(--neon-pink)');
    return;
  }
  if (!statusIds.length) {
    setSimulationConfigStatus('Enter at least one numeric status ID, e.g. 1,11.', 'var(--neon-pink)');
    return;
  }

  simulationConfigDraft.statusScopes.push({
    id,
    label,
    description,
    includeAll: false,
    statusIds,
  });
  if (idEl) idEl.value = '';
  if (labelEl) labelEl.value = '';
  if (statusEl) statusEl.value = '';
  if (descEl) descEl.value = '';
  renderSimulationConfigEditor();
  setSimulationConfigStatus(`Added custom scope "${label}". Save to publish.`, 'var(--neon-green)');
}

function loadSimulationConfigDefaults() {
  simulationConfigDraft = {
    statusScopes: cloneDefaultSimulationScopesAdmin(),
    defaultStatusScopeId: 'all',
    showStatusScopeSelector: true,
  };
  renderSimulationConfigEditor();
  setSimulationConfigStatus('Loaded built-in defaults (not saved yet).', 'var(--neon-green)');
}

async function loadSimulationConfigEditor() {
  setSimulationConfigStatus('Loading config…');
  try {
    const snap = await db.collection('notifications').doc('simulation_config').get();
    if (snap.exists) {
      const data = snap.data();
      const parsed = Array.isArray(data.statusScopes)
        ? data.statusScopes.map(normalizeSimulationScopeAdmin).filter(Boolean)
        : [];
      simulationConfigDraft = {
        statusScopes: parsed.length ? parsed : cloneDefaultSimulationScopesAdmin(),
        defaultStatusScopeId: typeof data.defaultStatusScopeId === 'string' ? data.defaultStatusScopeId : 'all',
        showStatusScopeSelector: readConfigBool(data.showStatusScopeSelector, true),
      };
      if (!simulationConfigDraft.statusScopes.some(scope => scope.id === 'all')) {
        simulationConfigDraft.statusScopes.unshift({ ...DEFAULT_SIM_STATUS_SCOPES_ADMIN[0], statusIds: [] });
      }
      renderSimulationConfigEditor();
      setSimulationConfigStatus('Loaded Firestore simulation config.', 'var(--neon-green)');
    } else {
      loadSimulationConfigDefaults();
      setSimulationConfigStatus('No saved config — showing defaults.', 'var(--neon-gold)');
    }
  } catch (e) {
    loadSimulationConfigDefaults();
    setSimulationConfigStatus('Error loading config: ' + e.message, 'var(--neon-pink)');
  }
}

async function saveSimulationConfigEditor() {
  const defaultStatusScopeId = document.getElementById('simCfgDefaultScope')?.value
    || simulationConfigDraft.defaultStatusScopeId
    || 'all';
  const showStatusScopeSelector = !!document.getElementById('simCfgShowSelector')?.checked;
  const activeIds = new Set((simulationConfigDraft.statusScopes || []).map(scope => scope.id));
  if (!activeIds.has(defaultStatusScopeId)) {
    setSimulationConfigStatus('Default scope must be one of the enabled scopes.', 'var(--neon-pink)');
    return;
  }
  setSimulationConfigStatus('Saving config…');
  try {
    const payload = {
      statusScopes: simulationConfigDraft.statusScopes.map(scope => ({
        id: scope.id,
        label: scope.label,
        description: scope.description || '',
        includeAll: !!scope.includeAll,
        statusIds: scope.statusIds || [],
      })),
      defaultStatusScopeId,
      showStatusScopeSelector,
      source: 'admin',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };
    await db.collection('notifications').doc('simulation_config').set(payload, { merge: true });
    simulationConfigDraft.defaultStatusScopeId = defaultStatusScopeId;
    simulationConfigDraft.showStatusScopeSelector = showStatusScopeSelector;
    setSimulationConfigStatus('✓ Simulation config saved. Seat Allocation updates live.', 'var(--neon-green)');
  } catch (e) {
    setSimulationConfigStatus('Error saving config: ' + e.message, 'var(--neon-pink)');
  }
}

async function loadSubCount() {
  const el = document.getElementById('bcSubCount');
  if (!el) return;
  try {
    const snap = await db.collection('push_subscriptions').get();
    el.textContent = snap.size + (snap.size === 1 ? ' user' : ' users');
  } catch (e) {
    el.textContent = 'n/a';
  }
}

async function sendLiveUpdate() {
  const status = document.getElementById('bcStatus');
  const title  = document.getElementById('bcTitle').value.trim();
  const body   = document.getElementById('bcBody').value.trim();
  const type   = document.getElementById('bcType').value;
  const icon   = document.getElementById('bcIcon').value.trim() || '🔔';
  const link   = document.getElementById('bcLink').value.trim();
  const ltext  = document.getElementById('bcLinkText').value.trim();
  if (!body) { status.textContent = 'Body is required.'; status.style.color = 'var(--neon-pink)'; return; }
  status.textContent = 'Sending…'; status.style.color = 'var(--text-muted)';
  try {
    const payload = {
      active: true,
      type, icon,
      id: Date.now().toString(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };
    if (title)  payload.title    = title;
    if (body)   payload.body     = body;
    if (link)   payload.link     = link;
    if (ltext)  payload.linkText = ltext;
    await db.collection('notifications').doc('latest').set(payload);
    status.textContent = '✓ Banner sent! Users will see it instantly.';
    status.style.color = 'var(--neon-green)';
    showAdminToast('Live banner sent.', 'success');
  } catch (e) {
    status.textContent = 'Error: ' + e.message;
    status.style.color = 'var(--neon-pink)';
  }
}

async function clearLiveBanner() {
  const status = document.getElementById('bcStatus');
  status.textContent = 'Clearing…'; status.style.color = 'var(--text-muted)';
  try {
    await db.collection('notifications').doc('latest').set({ active: false });
    status.textContent = '✓ Banner cleared.';
    status.style.color = 'var(--neon-green)';
  } catch (e) {
    status.textContent = 'Error: ' + e.message;
    status.style.color = 'var(--neon-pink)';
  }
}

function setFetchProgressStatus(message, color = 'var(--text-muted)') {
  const el = document.getElementById('fpStatus');
  if (!el) return;
  el.textContent = message;
  el.style.color = color;
}

function tsToDatetimeLocal(ts) {
  const d = ts?.toDate ? ts.toDate() : (ts instanceof Date ? ts : new Date(ts));
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function datetimeLocalToDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fillFetchProgressForm(data) {
  const d = data || {};
  document.getElementById('fpActive').checked = d.active === true;
  document.getElementById('fpStatus').value = ['running', 'paused', 'completed'].includes(d.status) ? d.status : 'running';
  document.getElementById('fpPercent').value = Number.isFinite(Number(d.percent)) ? Math.max(0, Math.min(100, Number(d.percent))) : 0;
  document.getElementById('fpFetched').value = Number.isFinite(Number(d.fetched)) ? Number(d.fetched) : '';
  document.getElementById('fpTotal').value = Number.isFinite(Number(d.total)) ? Number(d.total) : '';
  document.getElementById('fpTitle').value = d.title || '';
  document.getElementById('fpMessage').value = d.message || '';
  document.getElementById('fpIcon').value = d.icon || '';
  document.getElementById('fpStartedAt').value = tsToDatetimeLocal(d.startedAt);
  document.getElementById('fpPausedAt').value = tsToDatetimeLocal(d.pausedAt);
}

async function loadFetchProgressEditor() {
  setFetchProgressStatus('Loading fetch progress…');
  try {
    const snap = await db.collection('notifications').doc('fetch_progress').get();
    fillFetchProgressForm(snap.exists ? snap.data() : {});
    setFetchProgressStatus(snap.exists ? 'Loaded current fetch progress.' : 'No saved progress yet — defaults loaded.', 'var(--neon-green)');
  } catch (e) {
    setFetchProgressStatus('Error: ' + e.message, 'var(--neon-pink)');
  }
}

async function saveFetchProgressEditor() {
  setFetchProgressStatus('Saving…');
  try {
    const active = document.getElementById('fpActive').checked;
    const status = document.getElementById('fpStatus').value;
    const percent = Math.max(0, Math.min(100, Number(document.getElementById('fpPercent').value) || 0));
    const fetchedRaw = document.getElementById('fpFetched').value.trim();
    const totalRaw = document.getElementById('fpTotal').value.trim();
    const title = document.getElementById('fpTitle').value.trim();
    const message = document.getElementById('fpMessage').value.trim();
    const icon = document.getElementById('fpIcon').value.trim();
    const startedAt = datetimeLocalToDate(document.getElementById('fpStartedAt').value);
    const pausedAtInput = document.getElementById('fpPausedAt').value;
    let pausedAt = datetimeLocalToDate(pausedAtInput);

    const existing = await db.collection('notifications').doc('fetch_progress').get();
    const prev = existing.exists ? existing.data() : {};

    const payload = {
      active,
      status,
      percent,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };

    if (title) payload.title = title;
    else payload.title = 'Fetching candidate data';
    if (message) payload.message = message;
    if (icon) payload.icon = icon;

    if (fetchedRaw !== '') payload.fetched = Math.max(0, Number(fetchedRaw) || 0);
    if (totalRaw !== '') payload.total = Math.max(0, Number(totalRaw) || 0);

    if (startedAt) payload.startedAt = firebase.firestore.Timestamp.fromDate(startedAt);
    else if (active && prev.startedAt) payload.startedAt = prev.startedAt;
    else if (active) payload.startedAt = firebase.firestore.FieldValue.serverTimestamp();

    if (status === 'paused') {
      payload.pausedAt = pausedAt
        ? firebase.firestore.Timestamp.fromDate(pausedAt)
        : firebase.firestore.FieldValue.serverTimestamp();
    } else {
      payload.pausedAt = firebase.firestore.FieldValue.delete();
    }

    await db.collection('notifications').doc('fetch_progress').set(payload, { merge: true });
    setFetchProgressStatus('✓ Fetch progress saved. Simulation page updates instantly.', 'var(--neon-green)');
    await loadFetchProgressEditor();
  } catch (e) {
    setFetchProgressStatus('Error: ' + e.message, 'var(--neon-pink)');
  }
}

async function clearFetchProgressEditor() {
  setFetchProgressStatus('Hiding progress bar…');
  try {
    await db.collection('notifications').doc('fetch_progress').set({
      active: false,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    document.getElementById('fpActive').checked = false;
    setFetchProgressStatus('✓ Progress bar hidden on simulation page.', 'var(--neon-green)');
  } catch (e) {
    setFetchProgressStatus('Error: ' + e.message, 'var(--neon-pink)');
  }
}

function setSimNotifStatus(message, color = 'var(--text-muted)') {
  const el = document.getElementById('simNotifStatus');
  if (!el) return;
  el.textContent = message;
  el.style.color = color;
}

function normalizeSimulationNotifications(items) {
  if (!Array.isArray(items)) {
    throw new Error('JSON must be an array of notification objects.');
  }
  return items.map((item, idx) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`Item ${idx + 1} must be an object.`);
    }
    if (!item.id || typeof item.id !== 'string') {
      throw new Error(`Item ${idx + 1} is missing a string "id".`);
    }
    if (typeof item.body !== 'string' || !item.body.trim()) {
      throw new Error(`Item ${idx + 1} is missing a non-empty "body".`);
    }
    return {
      id: item.id.trim(),
      active: item.active !== false,
      type: ['info', 'success', 'warning', 'danger'].includes(item.type) ? item.type : 'info',
      icon: typeof item.icon === 'string' ? item.icon : '',
      title: typeof item.title === 'string' ? item.title : '',
      body: item.body,
      dismissable: item.dismissable !== false,
      link: typeof item.link === 'string' && item.link.trim() ? item.link.trim() : null,
      linkText: typeof item.linkText === 'string' && item.linkText.trim() ? item.linkText.trim() : null,
    };
  });
}

async function loadSimulationNotificationsEditor() {
  const textarea = document.getElementById('simNotifJson');
  if (!textarea) return;
  setSimNotifStatus('Loading feed…');
  try {
    const snap = await db.collection('notifications').doc('simulation_feed').get();
    const data = snap.exists ? snap.data() : null;
    if (Array.isArray(data?.items)) {
      textarea.value = JSON.stringify(data.items, null, 2);
      setSimNotifStatus('Loaded Firestore simulation feed.', 'var(--neon-green)');
      return;
    }
    await loadSimulationNotificationsFallback();
  } catch (e) {
    setSimNotifStatus('Error loading Firestore feed: ' + e.message, 'var(--neon-pink)');
  }
}

async function loadSimulationNotificationsFallback() {
  const textarea = document.getElementById('simNotifJson');
  if (!textarea) return;
  setSimNotifStatus('Loading JSON fallback…');
  try {
    const res = await fetch('data/notifications.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const items = await res.json();
    textarea.value = JSON.stringify(items, null, 2);
    setSimNotifStatus('Loaded fallback from data/notifications.json.', 'var(--neon-green)');
  } catch (e) {
    setSimNotifStatus('Error loading JSON fallback: ' + e.message, 'var(--neon-pink)');
  }
}

async function saveSimulationNotificationsEditor() {
  const textarea = document.getElementById('simNotifJson');
  if (!textarea) return;
  setSimNotifStatus('Saving feed…');
  try {
    const parsed = JSON.parse(textarea.value);
    const items = normalizeSimulationNotifications(parsed);
    textarea.value = JSON.stringify(items, null, 2);
    await db.collection('notifications').doc('simulation_feed').set({
      items,
      source: 'admin',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    setSimNotifStatus('✓ Simulation feed saved. simulation.html will pick it up live.', 'var(--neon-green)');
  } catch (e) {
    setSimNotifStatus('Error saving simulation feed: ' + e.message, 'var(--neon-pink)');
  }
}

// ── SIMULATION MERIT FORMULAS ────────────────────────────────────────────────
const MARKS_COMPONENT_FIELDS = [
  'mdcat', 'experience', 'matric', 'fsc', 'degree', 'houseJob',
  'research', 'position', 'hardAreas', 'attempts',
];
const PROGRAM_DICT_ROOTS = ['programAttempt', 'programAttempts', 'programPercentage', 'programMarks', 'adjusted'];
const PROGRAM_DICT_SPECS = [
  { field: 'programAttempt', subkeys: ['FCPS', 'FCPSD'] },
  { field: 'programPercentage', subkeys: ['MD', 'MS'] },
  { field: 'programMarks', subkeys: ['FCPS', 'FCPSD', 'MS', 'MD', 'MDS'] },
  { field: 'adjusted', subkeys: ['FCPS', 'FCPSD', 'MS', 'MD', 'MDS'] },
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

function populateMarksFormulaDatalist() {
  const dl = document.getElementById('marksFormulaFieldList');
  if (!dl) return;
  dl.innerHTML = marksFormulaFieldSuggestions()
    .map(v => `<option value="${escapeHtml(v)}"></option>`)
    .join('');
}
const MARKS_OPTION_NOTICES = MNNotif.MARKS_OPTION_NOTICES;
const DEFAULT_MARKS_OPTIONS = MNNotif.DEFAULT_MARKS_OPTIONS;

let marksCfgDraft = {
  options: [],
  defaultOptionId: 'portal',
  showSelector: true,
  noticeTitle: 'About merit marks',
  candidateNotice: '',
  showNotice: true,
};

function cloneDefaultMarksOptions() {
  return MNNotif.cloneDefaultMarksOptions();
}

function ensureMarksCfgDraft() {
  if (!Array.isArray(marksCfgDraft.options) || !marksCfgDraft.options.length) {
    marksCfgDraft.options = cloneDefaultMarksOptions();
  }
  const ids = new Set(marksCfgDraft.options.map(o => o.id));
  if (!marksCfgDraft.defaultOptionId || !ids.has(marksCfgDraft.defaultOptionId)) {
    marksCfgDraft.defaultOptionId = marksCfgDraft.options[0]?.id || 'portal';
  }
}

function readConfigBool(value, defaultValue = true) {
  if (value === true || value === false) return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return defaultValue;
}

function setMarksCfgStatus(message, color = 'var(--text-muted)') {
  const el = document.getElementById('marksCfgStatus');
  if (!el) return;
  el.textContent = message;
  el.style.color = color;
}

function normalizeMarksOptionAdmin(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `opt-${idx + 1}`;
  const label = typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : id;
  const base = raw.base === 'sum' ? 'sum' : 'marksTotal';
  const sumFields = Array.isArray(raw.sumFields)
    ? raw.sumFields.filter(f => isValidMarksFormulaField(f))
    : [];
  const adjustments = Array.isArray(raw.adjustments)
    ? raw.adjustments
        .filter(a => a && (a.op === 'add' || a.op === 'subtract') && isValidMarksFormulaField(a.field))
        .map(a => ({ field: a.field, op: a.op }))
    : [];
  const notice = typeof raw.notice === 'string' && raw.notice.trim() ? raw.notice.trim() : '';
  const out = { id, label, base, adjustments };
  if (base === 'sum') out.sumFields = sumFields.length ? sumFields : ['degree', 'houseJob'];
  if (notice) out.notice = notice;
  else if (MARKS_OPTION_NOTICES[id]) out.notice = MARKS_OPTION_NOTICES[id];
  return out;
}

function formatMarksOptionSummary(opt) {
  if (opt.base === 'sum') {
    const sum = (opt.sumFields || []).join(' + ') || 'components';
    const adj = (opt.adjustments || []).map(a => `${a.op === 'add' ? '+' : '−'} ${a.field}`).join(' ');
    return adj ? `${sum} ${adj}` : sum;
  }
  const adj = (opt.adjustments || []).map(a => `${a.op === 'add' ? '+' : '−'} ${a.field}`).join(' ');
  return adj ? `marksTotal ${adj}` : 'marksTotal';
}

function renderMarksCfgList() {
  const list = document.getElementById('marksCfgList');
  const defSel = document.getElementById('marksCfgDefault');
  if (!list || !defSel) return;

  ensureMarksCfgDraft();

  if (!marksCfgDraft.options.length) {
    list.innerHTML = '<p style="font-size:0.8rem;color:var(--text-muted);">No options yet. Add one below.</p>';
    defSel.innerHTML = '<option value="">— No options —</option>';
    defSel.value = '';
    return;
  }
    list.innerHTML = marksCfgDraft.options.map((opt, idx) => `
      <div style="display:flex;align-items:center;gap:0.75rem;padding:0.65rem 0.75rem;border:1px solid var(--border);border-radius:8px;margin-bottom:0.5rem;background:rgba(255,255,255,0.02);">
        <div style="flex:1;min-width:0;">
          <div style="font-size:0.85rem;font-weight:600;color:var(--text);">${escapeHtml(opt.label)}</div>
          <div style="font-size:0.72rem;color:var(--text-muted);font-family:var(--mono);">${escapeHtml(opt.id)} · ${escapeHtml(formatMarksOptionSummary(opt))}</div>
        </div>
        <button type="button" data-marks-remove="${idx}" style="padding:4px 10px;background:rgba(224,84,112,0.12);color:var(--danger);border:1px solid rgba(224,84,112,0.28);border-radius:6px;cursor:pointer;font-size:0.75rem;">Remove</button>
      </div>
    `).join('');
    list.querySelectorAll('[data-marks-remove]').forEach(btn => {
      btn.onclick = () => {
        const i = +btn.dataset.marksRemove;
        marksCfgDraft.options.splice(i, 1);
        if (!marksCfgDraft.options.some(o => o.id === marksCfgDraft.defaultOptionId)) {
          marksCfgDraft.defaultOptionId = marksCfgDraft.options[0]?.id || '';
        }
        renderMarksCfgList();
      };
    });

  defSel.innerHTML = marksCfgDraft.options.map(o =>
    `<option value="${escapeHtml(o.id)}">${escapeHtml(o.label)}</option>`
  ).join('');
  defSel.value = marksCfgDraft.defaultOptionId;
  if (!defSel.value) defSel.value = marksCfgDraft.options[0].id;
}

function addMarksNewAdjRow(field = 'mdcat', op = 'subtract') {
  const wrap = document.getElementById('marksNewAdjRows');
  if (!wrap) return;
  const row = document.createElement('div');
  row.style.cssText = 'display:grid;grid-template-columns:auto minmax(240px,1fr) auto;gap:10px;align-items:center;width:100%;';
  row.innerHTML = `
    <select class="marks-adj-op" style="padding:8px 10px;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:0.9rem;min-width:7.5rem;">
      <option value="subtract">Subtract</option>
      <option value="add">Add</option>
    </select>
    <input type="text" class="marks-adj-field" list="marksFormulaFieldList" placeholder="field name (e.g. programMarks, adjusted)" autocomplete="off" style="width:100%;min-width:240px;padding:8px 12px;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:0.95rem;font-family:var(--mono,monospace);">
    <button type="button" class="marks-adj-rm" style="padding:6px 10px;background:rgba(224,84,112,0.1);color:var(--danger);border:1px solid rgba(224,84,112,0.25);border-radius:6px;cursor:pointer;">✕</button>
  `;
  row.querySelector('.marks-adj-op').value = op;
  row.querySelector('.marks-adj-field').value = field;
  row.querySelector('.marks-adj-rm').onclick = () => row.remove();
  wrap.appendChild(row);
}

function readMarksNewAdjRows() {
  const wrap = document.getElementById('marksNewAdjRows');
  if (!wrap) return [];
  return [...wrap.querySelectorAll('div')].map(row => ({
    op: row.querySelector('.marks-adj-op')?.value === 'add' ? 'add' : 'subtract',
    field: (row.querySelector('.marks-adj-field')?.value || 'mdcat').trim(),
  })).filter(a => isValidMarksFormulaField(a.field));
}

let _marksCfgAdminReady = false;

function initMarksConfigAdmin() {
  if (_marksCfgAdminReady) {
    renderMarksCfgList();
    loadMarksConfigEditor();
    return;
  }
  _marksCfgAdminReady = true;
  populateMarksFormulaDatalist();
  const baseSel = document.getElementById('marksNewBase');
  const sumWrap = document.getElementById('marksNewSumWrap');
  if (baseSel && sumWrap) {
    baseSel.onchange = () => {
      sumWrap.style.display = baseSel.value === 'sum' ? '' : 'none';
    };
    baseSel.dispatchEvent(new Event('change'));
  }

  document.getElementById('marksCfgLoadBtn')?.addEventListener('click', loadMarksConfigEditor);
  document.getElementById('marksCfgDefaultsBtn')?.addEventListener('click', () => {
    marksCfgDraft = {
      options: cloneDefaultMarksOptions(),
      defaultOptionId: 'portal',
      showSelector: true,
      noticeTitle: 'About merit marks',
      candidateNotice: '',
      showNotice: true,
    };
    document.getElementById('marksCfgShowSelector').checked = true;
    document.getElementById('marksCfgShowNotice').checked = true;
    document.getElementById('marksCfgNoticeTitle').value = marksCfgDraft.noticeTitle;
    document.getElementById('marksCfgNotice').value = '';
    renderMarksCfgList();
    setMarksCfgStatus('Loaded built-in defaults (not saved yet).', 'var(--neon-green)');
  });
  document.getElementById('marksCfgSaveBtn')?.addEventListener('click', saveMarksConfigEditor);
  document.getElementById('marksNewAdjAddBtn')?.addEventListener('click', () => addMarksNewAdjRow());
  document.getElementById('marksNewAddBtn')?.addEventListener('click', addMarksOptionFromForm);

  addMarksNewAdjRow();
  renderMarksCfgList();
  loadMarksConfigEditor();
}

async function loadMarksConfigEditor() {
  setMarksCfgStatus('Loading config…');
  try {
    const snap = await db.collection('notifications').doc('marks_config').get();
    if (snap.exists) {
      const data = snap.data();
      const parsed = Array.isArray(data.options)
        ? data.options.map((o, i) => normalizeMarksOptionAdmin(o, i)).filter(Boolean)
        : [];
      marksCfgDraft.options = parsed.length ? parsed : cloneDefaultMarksOptions();
      marksCfgDraft.defaultOptionId = typeof data.defaultOptionId === 'string'
        ? data.defaultOptionId
        : marksCfgDraft.options[0]?.id || 'portal';
      marksCfgDraft.showSelector = readConfigBool(data.showSelector, true);
      marksCfgDraft.noticeTitle = typeof data.noticeTitle === 'string' && data.noticeTitle.trim()
        ? data.noticeTitle.trim()
        : 'About merit marks';
      marksCfgDraft.candidateNotice = typeof data.candidateNotice === 'string' ? data.candidateNotice : '';
      marksCfgDraft.showNotice = readConfigBool(data.showNotice, true);
    } else {
      marksCfgDraft = {
        options: cloneDefaultMarksOptions(),
        defaultOptionId: 'portal',
        showSelector: true,
        noticeTitle: 'About merit marks',
        candidateNotice: '',
        showNotice: true,
      };
    }
    ensureMarksCfgDraft();
    document.getElementById('marksCfgShowSelector').checked = marksCfgDraft.showSelector;
    document.getElementById('marksCfgShowNotice').checked = marksCfgDraft.showNotice;
    document.getElementById('marksCfgNoticeTitle').value = marksCfgDraft.noticeTitle;
    document.getElementById('marksCfgNotice').value = marksCfgDraft.candidateNotice;
    renderMarksCfgList();
    setMarksCfgStatus(snap.exists ? 'Loaded Firestore marks config.' : 'No saved config — showing defaults.', 'var(--neon-green)');
  } catch (e) {
    marksCfgDraft = {
      options: cloneDefaultMarksOptions(),
      defaultOptionId: 'portal',
      showSelector: true,
      noticeTitle: 'About merit marks',
      candidateNotice: '',
      showNotice: true,
    };
    ensureMarksCfgDraft();
    document.getElementById('marksCfgShowSelector').checked = true;
    document.getElementById('marksCfgShowNotice').checked = true;
    document.getElementById('marksCfgNoticeTitle').value = marksCfgDraft.noticeTitle;
    document.getElementById('marksCfgNotice').value = '';
    renderMarksCfgList();
    setMarksCfgStatus('Error loading config — showing defaults: ' + e.message, 'var(--neon-pink)');
  }
}

function addMarksOptionFromForm() {
  const id = document.getElementById('marksNewId')?.value.trim();
  const label = document.getElementById('marksNewLabel')?.value.trim();
  const base = document.getElementById('marksNewBase')?.value === 'sum' ? 'sum' : 'marksTotal';
  const sumRaw = document.getElementById('marksNewSumFields')?.value || '';
  const sumFields = sumRaw.split(',').map(s => s.trim()).filter(Boolean);
  const adjustments = readMarksNewAdjRows();
  const notice = document.getElementById('marksNewNotice')?.value.trim() || '';

  if (!id || !/^[a-z0-9][a-z0-9-_]*$/i.test(id)) {
    setMarksCfgStatus('Option ID is required (letters, numbers, hyphens, underscores).', 'var(--neon-pink)');
    return;
  }
  if (!label) {
    setMarksCfgStatus('Label is required.', 'var(--neon-pink)');
    return;
  }
  if (marksCfgDraft.options.some(o => o.id === id)) {
    setMarksCfgStatus('An option with this ID already exists.', 'var(--neon-pink)');
    return;
  }

  const opt = normalizeMarksOptionAdmin({ id, label, base, sumFields, adjustments, notice });
  if (!opt) {
    setMarksCfgStatus('Could not build option.', 'var(--neon-pink)');
    return;
  }
  marksCfgDraft.options.push(opt);
  if (!marksCfgDraft.defaultOptionId) marksCfgDraft.defaultOptionId = opt.id;
  renderMarksCfgList();
  document.getElementById('marksNewId').value = '';
  document.getElementById('marksNewLabel').value = '';
  document.getElementById('marksNewNotice').value = '';
  document.getElementById('marksNewAdjRows').innerHTML = '';
  addMarksNewAdjRow();
  setMarksCfgStatus(`Added "${label}". Save to publish.`, 'var(--neon-green)');
}

async function saveMarksConfigEditor() {
  ensureMarksCfgDraft();
  if (!marksCfgDraft.options.length) {
    setMarksCfgStatus('Add at least one formula option.', 'var(--neon-pink)');
    return;
  }
  const defaultOptionId = document.getElementById('marksCfgDefault')?.value
    || marksCfgDraft.defaultOptionId
    || marksCfgDraft.options[0].id;
  const showSelector = !!document.getElementById('marksCfgShowSelector')?.checked;
  const showNotice = !!document.getElementById('marksCfgShowNotice')?.checked;
  const noticeTitle = document.getElementById('marksCfgNoticeTitle')?.value.trim() || 'About merit marks';
  const candidateNotice = document.getElementById('marksCfgNotice')?.value || '';
  setMarksCfgStatus('Saving config…');
  try {
    const payload = {
      options: marksCfgDraft.options.map(o => {
        const item = { id: o.id, label: o.label, base: o.base, adjustments: o.adjustments || [] };
        if (o.base === 'sum') item.sumFields = o.sumFields || [];
        if (o.notice?.trim()) item.notice = o.notice.trim();
        return item;
      }),
      defaultOptionId,
      showSelector,
      showNotice,
      noticeTitle,
      candidateNotice,
      source: 'admin',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };
    await db.collection('notifications').doc('marks_config').set(payload);
    marksCfgDraft.defaultOptionId = defaultOptionId;
    marksCfgDraft.showSelector = showSelector;
    marksCfgDraft.showNotice = showNotice;
    marksCfgDraft.noticeTitle = noticeTitle;
    marksCfgDraft.candidateNotice = candidateNotice;
    setMarksCfgStatus('✓ Marks config saved. Simulation page updates live.', 'var(--neon-green)');
  } catch (e) {
    setMarksCfgStatus('Error saving config: ' + e.message, 'var(--neon-pink)');
  }
}

// --- UI Binding ---
function showDashboard() {
  document.getElementById('loginWrap').style.display = 'none';
  document.getElementById('logoutBtn').style.display = '';
  document.getElementById('dashboard').classList.add('active');
  const session = getAdminSession();
  const sub = document.querySelector('.topbar-sub');
  if (sub && session) sub.textContent = session.email;
  startSessionTimer();
  loadLogs();
  loadOverviewMetrics();
  refreshAccessRequestBadge();
  refreshGrievanceBadge();
  subscribePresence();
  const savedTab = localStorage.getItem(ADMIN_TAB_KEY) || 'overview';
  switchTab(Object.prototype.hasOwnProperty.call(TAB_META, savedTab) ? savedTab : 'overview');
}

async function refreshAllAdminData() {
  const btn = document.getElementById('refreshAllBtn');
  if (btn) { btn.disabled = true; btn.textContent = '↻ …'; }
  try {
    await loadLogs();
    await loadOverviewMetrics();
    const tab = localStorage.getItem(ADMIN_TAB_KEY) || 'overview';
    if (tab === 'users') await loadUsers();
    if (tab === 'screenshots') await loadScreenshotLogs();
    if (tab === 'warnings') await loadWarnings();
    if (tab === 'grievances') await loadGrievances();
    if (tab === 'access-requests') await loadAccessRequests();
    if (tab === 'contributions') await loadContributions();
    if (tab === 'profiles') await loadProfiles();
    if (tab === 'mentorship') await loadMentorship();
    if (tab === 'broadcast') await loadBroadcast();
    if (tab === 'config') await loadConfig();
    if (tab === 'download-logs') await loadDownloadLogs();
    showAdminToast('Data refreshed.', 'success');
  } catch (e) {
    showAdminToast('Refresh failed: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '↻ Refresh'; }
  }
}

function showLogin() {
  clearAdminSession();
  if (sessionTimerInterval) { clearInterval(sessionTimerInterval); sessionTimerInterval = null; }
  if (presenceUnsubscribe) { presenceUnsubscribe(); presenceUnsubscribe = null; }
  document.getElementById('loginWrap').style.display = '';
  document.getElementById('logoutBtn').style.display = 'none';
  document.getElementById('dashboard').classList.remove('active');
  document.getElementById('adminEmail').value = '';
  document.getElementById('adminPass').value = '';
  document.getElementById('adminError').textContent = '';
}

document.getElementById('adminPass').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('adminSubmit').click();
});
document.getElementById('adminSubmit').addEventListener('click', async function () {
  const email = document.getElementById('adminEmail').value;
  const pin = document.getElementById('adminPass').value;
  const errorEl = document.getElementById('adminError');

  if (!email || !pin) {
    errorEl.textContent = 'Enter email and PIN.';
    return;
  }

  this.disabled = true;
  this.classList.add('loading');
  errorEl.textContent = '';

  const valid = await verifyAdmin(email, pin);
  if (valid) {
    setAdminSession(email);
    showDashboard();
  } else {
    errorEl.textContent = 'Invalid admin credentials.';
  }

  this.disabled = false;
  this.classList.remove('loading');
});

document.getElementById('logoutBtn').addEventListener('click', showLogin);
document.getElementById('refreshAllBtn')?.addEventListener('click', refreshAllAdminData);
document.getElementById('presenceBody')?.addEventListener('click', function (e) {
  const row = e.target.closest('[data-presence-email]');
  if (row) openUserHistory(row.getAttribute('data-presence-email'));
});
document.getElementById('userHistoryCloseBtn')?.addEventListener('click', closeUserHistoryModal);
document.getElementById('userHistoryModal')?.addEventListener('click', function (e) {
  if (e.target === this) closeUserHistoryModal();
});
document.getElementById('refreshBtn').addEventListener('click', loadLogs);
document.getElementById('filterEmail').addEventListener('input', renderLogs);
document.getElementById('filterStatus').addEventListener('change', renderLogs);
document.getElementById('logsBody')?.addEventListener('click', function (e) {
  const btn = e.target.closest('[data-history-email]');
  if (btn) {
    e.stopPropagation();
    openUserHistory(btn.getAttribute('data-history-email'));
  }
});
document.getElementById('refreshScreenshotLogsBtn')?.addEventListener('click', loadScreenshotLogs);
document.getElementById('filterScreenshotEmail')?.addEventListener('input', renderScreenshotLogs);
document.getElementById('filterScreenshotType')?.addEventListener('change', renderScreenshotLogs);
document.getElementById('refreshDownloadLogsBtn')?.addEventListener('click', loadDownloadLogs);
document.getElementById('filterDownloadEmail')?.addEventListener('input', renderDownloadLogs);
document.getElementById('filterDownloadType')?.addEventListener('input', renderDownloadLogs);
document.getElementById('uaSearchBtn')?.addEventListener('click', function () {
  const email = document.getElementById('uaEmail')?.value || '';
  loadUserActivity(email);
});
document.getElementById('uaEmail')?.addEventListener('keydown', function (e) {
  if (e.key === 'Enter') {
    const email = document.getElementById('uaEmail')?.value || '';
    loadUserActivity(email);
  }
});
document.getElementById('screenshotLogsBody')?.addEventListener('click', function (e) {
  const btn = e.target.closest('[data-warning-email]');
  if (!btn) return;
  openWarningComposer(btn.getAttribute('data-warning-email'), btn.getAttribute('data-warning-context') || '');
});
document.getElementById('sendWarningBtn')?.addEventListener('click', sendUserWarning);
document.getElementById('clearWarningBtn')?.addEventListener('click', clearWarningComposer);
document.getElementById('refreshWarningsBtn')?.addEventListener('click', loadWarnings);
document.getElementById('filterWarnings')?.addEventListener('input', renderWarningsAdmin);
document.getElementById('warningsBody')?.addEventListener('click', function (e) {
  const btn = e.target.closest('[data-warning-archive]');
  if (btn) archiveWarning(btn.getAttribute('data-warning-archive'));
});
document.getElementById('refreshGrievancesBtn')?.addEventListener('click', loadGrievances);
document.getElementById('filterGrievances')?.addEventListener('input', renderGrievancesAdmin);
document.getElementById('filterGrievanceStatus')?.addEventListener('change', renderGrievancesAdmin);
document.getElementById('grievancesBody')?.addEventListener('click', function (e) {
  const redraftBtn = e.target.closest('[data-grievance-redraft]');
  if (redraftBtn) {
    const id = redraftBtn.getAttribute('data-grievance-redraft');
    const item = allGrievances.find(g => g.id === id);
    if (item) {
      buildGrievanceResponderDraft(item).then(draft => {
        setGrievanceTextarea(id, draft.response);
        showAdminToast('Data draft restored.', 'success');
      }).catch(err => showAdminToast('Draft failed: ' + err.message, 'error'));
    }
    return;
  }
  const approveBtn = e.target.closest('[data-grievance-approve]');
  if (approveBtn) approveGrievanceResponse(approveBtn.getAttribute('data-grievance-approve'));
});
document.getElementById('addUserBtn').addEventListener('click', () => openAddUserModal(''));
document.getElementById('addUserBtn2').addEventListener('click', () => openAddUserModal(''));
document.getElementById('refreshUsersBtn').addEventListener('click', loadUsers);
document.getElementById('filterUsers')?.addEventListener('input', renderUsers);
document.querySelectorAll('.sidebar-link[data-tab], .tab-btn[data-tab]').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeAddUserModal();
    closeContribModal();
    closeUserHistoryModal();
    document.getElementById('addContribModal')?.classList.remove('open');
  }
});
document.getElementById('modalCancelBtn').addEventListener('click', closeAddUserModal);
document.getElementById('modalSubmitBtn').addEventListener('click', submitAddUser);
// Close modal when clicking outside the card
document.getElementById('addUserModal').addEventListener('click', function (e) {
  if (e.target === this) closeAddUserModal();
});

// --- Contributions Management ---
let allContributions = [];

async function loadContributions() {
  const tbody = document.getElementById('contribBody');
  tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Loading\u2026</td></tr>';
  try {
    const snapshot = await db.collection('contributions').orderBy('date', 'desc').get();
    allContributions = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      date: doc.data().date ? doc.data().date.toDate() : null,
    }));
    renderContributions();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Error: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderContributions() {
  const tbody = document.getElementById('contribBody');
  let sumPKR = 0, sumUSD = 0;
  for (const c of allContributions) {
    sumPKR += Number(c.amountPKR) || 0;
    sumUSD += Number(c.amountUSD) || 0;
  }
  setText('contribTotalPKR', sumPKR ? 'PKR ' + sumPKR.toLocaleString() : '0');
  setText('contribTotalUSD', sumUSD ? '$' + sumUSD.toFixed(2) : '$0');
  setText('contribCount', allContributions.length);
  if (allContributions.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No contributions recorded yet.</td></tr>';
    return;
  }
  tbody.innerHTML = allContributions.map(c => {
    const dateStr = c.date
      ? c.date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
      : '\u2014';
    const pkr = c.amountPKR ? `PKR ${Number(c.amountPKR).toLocaleString()}` : '\u2014';
    const usd = c.amountUSD ? `$${Number(c.amountUSD).toFixed(2)}` : '\u2014';
    const source = c.source === 'access_request_payment'
      ? '<div class="invite-meta-sub">Verified from access request</div>'
      : '';
    return `<tr>
      <td>${escapeHtml(c.name || 'Anonymous')}${c.email ? `<div class="invite-meta-sub">${escapeHtml(c.email)}</div>` : ''}${source}</td>
      <td>${pkr}</td>
      <td>${usd}</td>
      <td>${dateStr}</td>
      <td>
        <button class="action-btn" onclick="editContribution('${escapeHtml(c.id)}')">Edit</button>
        <button class="remove-btn" onclick="deleteContribution('${escapeHtml(c.id)}')">Delete</button>
      </td>
    </tr>`;
  }).join('');
}

function openContribModal(editData) {
  document.getElementById('contribEditId').value = editData ? editData.id : '';
  document.getElementById('contribName').value   = editData ? (editData.name || '') : '';
  document.getElementById('contribPKR').value    = editData ? (editData.amountPKR || '') : '';
  document.getElementById('contribUSD').value    = editData ? (editData.amountUSD || '') : '';
  document.getElementById('contribRate').value   = editData ? (editData.conversionRate || 278) : 278;
  document.getElementById('contribEmail').value  = editData ? (editData.email || '') : '';
  document.getElementById('contribDate').value   = editData && editData.date
    ? editData.date.toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
  document.getElementById('contribModalTitle').textContent = editData ? 'Edit Contribution' : 'Add Contribution';
  document.getElementById('contribStatus').textContent = '';
  document.getElementById('contribStatus').className = 'modal-status';
  document.getElementById('addContribModal').classList.add('open');
}

function closeContribModal() {
  document.getElementById('addContribModal').classList.remove('open');
}

function editContribution(id) {
  const c = allContributions.find(x => x.id === id);
  if (c) openContribModal(c);
}

async function deleteContribution(id) {
  if (!confirm('Delete this contribution record?')) return;
  try {
    await db.collection('contributions').doc(id).delete();
    allContributions = allContributions.filter(c => c.id !== id);
    renderContributions();
  } catch (err) {
    alert('Failed to delete: ' + err.message);
  }
}

async function submitContribution() {
  const name     = document.getElementById('contribName').value.trim();
  const pkr      = parseFloat(document.getElementById('contribPKR').value) || 0;
  const usdInput = parseFloat(document.getElementById('contribUSD').value) || 0;
  const rate     = parseFloat(document.getElementById('contribRate').value) || 278;
  const dateVal  = document.getElementById('contribDate').value;
  const email    = document.getElementById('contribEmail').value.trim().toLowerCase();
  const editId   = document.getElementById('contribEditId').value;
  const statusEl = document.getElementById('contribStatus');
  const btn      = document.getElementById('contribSubmitBtn');

  if (!name && !email) {
    statusEl.textContent = 'Name or email is required.';
    statusEl.className = 'modal-status error';
    return;
  }
  if (!pkr && !usdInput) {
    statusEl.textContent = 'Enter an amount in PKR or USD.';
    statusEl.className = 'modal-status error';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Saving\u2026';

  // Auto-convert: use provided values, only calculate missing ones
  const amountUSD = usdInput || (pkr / rate);
  const amountPKR = pkr || (usdInput * rate);

  const data = {
    name: name || 'Anonymous',
    amountPKR: Math.round(amountPKR),
    amountUSD: parseFloat(amountUSD.toFixed(2)),
    conversionRate: rate,
    email: email || '',
    date: dateVal ? firebase.firestore.Timestamp.fromDate(new Date(dateVal)) : firebase.firestore.FieldValue.serverTimestamp(),
  };

  try {
    if (editId) {
      await db.collection('contributions').doc(editId).update(data);
    } else {
      await db.collection('contributions').add(data);
    }
    statusEl.textContent = '\u2713 Saved!';
    statusEl.className = 'modal-status success';
    setTimeout(closeContribModal, 1500);
    loadContributions();
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message;
    statusEl.className = 'modal-status error';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Contribution';
  }
}

document.getElementById('addContribBtn').addEventListener('click', () => openContribModal(null));
document.getElementById('refreshContribBtn').addEventListener('click', loadContributions);
document.getElementById('contribCancelBtn').addEventListener('click', closeContribModal);
document.getElementById('contribSubmitBtn').addEventListener('click', submitContribution);
document.getElementById('addContribModal').addEventListener('click', function (e) {
  if (e.target === this) closeContribModal();
});

// Auto-calculate USD when PKR changes
document.getElementById('contribPKR').addEventListener('input', function() {
  const pkr = parseFloat(this.value) || 0;
  const rate = parseFloat(document.getElementById('contribRate').value) || 278;
  if (pkr && !document.getElementById('contribUSD').value) {
    document.getElementById('contribUSD').placeholder = `≈ $${(pkr / rate).toFixed(2)}`;
  }
});

document.getElementById('refreshMentorsBtn')?.addEventListener('click', loadMentors);
document.getElementById('refreshMReqBtn')?.addEventListener('click', loadMentorRequests);
document.getElementById('refreshProfilesBtn')?.addEventListener('click', loadProfiles);
document.getElementById('filterProfiles')?.addEventListener('input', renderProfiles);

// --- User Profiles ---
let allProfiles = [];
let adminProfileDonors = new Map();

function buildAdminDonorMap(contributions) {
  const map = new Map();
  contributions.forEach(c => {
    const email = String(c.email || '').toLowerCase().trim();
    if (!email) return;
    const prev = map.get(email) || { count: 0, amountPKR: 0, amountUSD: 0 };
    prev.count += 1;
    prev.amountPKR += Number(c.amountPKR) || 0;
    prev.amountUSD += Number(c.amountUSD) || 0;
    map.set(email, prev);
  });
  return map;
}

async function loadProfiles() {
  const tbody = document.getElementById('profilesBody');
  const countEl = document.getElementById('profilesCount');
  tbody.innerHTML = '<tr><td colspan="9" class="empty-state">Loading…</td></tr>';
  countEl.textContent = 'Loading…';
  try {
    const [snap, contribSnap] = await Promise.all([
      db.collection('user_profiles').orderBy('updatedAt', 'desc').get(),
      db.collection('contributions').get().catch(() => ({ docs: [] })),
    ]);
    adminProfileDonors = buildAdminDonorMap((contribSnap.docs || []).map(d => d.data()));
    allProfiles = snap.docs.map(doc => ({ email: doc.id, ...doc.data() }));
    renderProfiles();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty-state">Error: ${escapeHtml(err.message)}</td></tr>`;
    countEl.textContent = '';
  }
}

function renderProfiles() {
  const tbody = document.getElementById('profilesBody');
  const countEl = document.getElementById('profilesCount');
  const q = (document.getElementById('filterProfiles')?.value || '').toLowerCase().trim();
  let list = allProfiles;
  if (q) {
    list = list.filter(d =>
      (d.name || '').toLowerCase().includes(q) ||
      (d.email || '').toLowerCase().includes(q) ||
      (d.specialty || '').toLowerCase().includes(q) ||
      (d.hospital || '').toLowerCase().includes(q)
    );
  }
  const inducted = allProfiles.filter(d => d.inducted).length;
  const privateCount = allProfiles.filter(d => d.isPublic !== true).length;
  countEl.textContent = `${list.length} shown · ${allProfiles.length} total · ${inducted} inducted · ${privateCount} private`;
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state">No profiles match.</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(d => {
    const email = d.email;
    const specialty = d.specialty ? escapeHtml(d.specialty) : '<span style="color:var(--muted);">—</span>';
    const hospital = d.hospital ? escapeHtml(d.hospital) : '<span style="color:var(--muted);">—</span>';
    const status = d.inducted
      ? `<span style="color:var(--success);font-weight:600;">Inducted ${d.inductionYear ? escapeHtml(String(d.inductionYear)) : ''}</span>`
      : '<span style="color:var(--text-muted);">Applicant</span>';
    const visibility = d.isPublic
      ? '<span class="badge badge-success">Public</span>'
      : '<span class="badge badge-muted">Private</span>';
    const donor = adminProfileDonors.get(String(email || '').toLowerCase());
    const support = donor
      ? `<span class="badge" style="background:rgba(232,166,39,0.14);border-color:rgba(232,166,39,0.34);color:var(--neon-gold);">★ Supporter</span><div class="invite-meta-sub">${donor.count} contribution${donor.count !== 1 ? 's' : ''}</div>`
      : '<span style="color:var(--muted);">—</span>';
    const appId = d.applicantId ? `<code style="font-size:0.78rem;">${escapeHtml(String(d.applicantId))}</code>` : '<span style="color:var(--muted);">—</span>';
    const updated = d.updatedAt
      ? d.updatedAt.toDate().toLocaleDateString('en-PK', { day:'2-digit', month:'short', year:'numeric' })
      : '—';
    return `<tr>
      <td>${escapeHtml(d.name || '—')}</td>
      <td style="font-size:0.78rem;">${escapeHtml(email)}</td>
      <td>${specialty}</td>
      <td>${hospital}</td>
      <td>${status}</td>
      <td>${visibility}</td>
      <td>${support}</td>
      <td>${appId}</td>
      <td style="font-size:0.78rem;">${updated}</td>
    </tr>`;
  }).join('');
}

// --- Mentorship ---
async function loadMentorship() {
  await Promise.all([loadMentors(), loadMentorRequests()]);
}

let allMentors = [];
async function loadMentors() {
  const tbody = document.getElementById('mentorsBody');
  tbody.innerHTML = '<tr><td colspan="9" class="empty-state">Loading\u2026</td></tr>';
  try {
    const snap = await db.collection('mentors').orderBy('name').get();
    allMentors = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderMentors();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty-state">Error: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderMentors() {
  const tbody = document.getElementById('mentorsBody');
  if (!allMentors.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state">No mentors registered yet.</td></tr>';
    return;
  }
  tbody.innerHTML = allMentors.map(m => {
    const wa = m.whatsapp
      ? `<a href="https://wa.me/${m.whatsapp.replace(/[^0-9]/g,'')}" target="_blank" rel="noopener" style="color:var(--success);">${escapeHtml(m.whatsapp)}</a>`
      : '<span style="color:var(--muted);">—</span>';
    const avail = m.available
      ? '<span style="color:var(--success);font-weight:700;">Yes</span>'
      : '<span style="color:var(--muted);">No</span>';
    return `<tr>
      <td>${escapeHtml(m.name || '—')}</td>
      <td>${escapeHtml(m.email || m.id || '—')}</td>
      <td>${escapeHtml(m.hospital || '—')}</td>
      <td>${escapeHtml(m.specialty || '—')}</td>
      <td>${escapeHtml(m.programme || '—')}</td>
      <td>${m.yearOfTraining || '—'}</td>
      <td>${wa}</td>
      <td>${avail}</td>
      <td><button onclick="toggleMentorAvailability('${escapeHtml(m.id)}')" style="font-size:0.75rem;padding:0.25rem 0.6rem;border:1px solid var(--border-hv);border-radius:6px;background:none;color:var(--accent);cursor:pointer;">${m.available ? 'Deactivate' : 'Activate'}</button></td>
    </tr>`;
  }).join('');
}

async function toggleMentorAvailability(id) {
  const mentor = allMentors.find(m => m.id === id);
  if (!mentor) return;
  try {
    await db.collection('mentors').doc(id).update({ available: !mentor.available });
    mentor.available = !mentor.available;
    renderMentors();
  } catch (err) {
    alert('Failed to update: ' + err.message);
  }
}

let allMentorReqs = [];
async function loadMentorRequests() {
  const tbody = document.getElementById('mreqBody');
  tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Loading\u2026</td></tr>';
  try {
    const snap = await db.collection('mentorship_requests').orderBy('createdAt', 'desc').limit(100).get();
    allMentorReqs = snap.docs.map(d => ({
      id: d.id, ...d.data(),
      createdAt: d.data().createdAt ? d.data().createdAt.toDate() : null,
    }));
    renderMentorRequests();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">Error: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderMentorRequests() {
  const tbody = document.getElementById('mreqBody');
  if (!allMentorReqs.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No requests yet.</td></tr>';
    return;
  }
  tbody.innerHTML = allMentorReqs.map(r => {
    const matched = Array.isArray(r.matchedMentors) && r.matchedMentors.length
      ? r.matchedMentors.map(e => escapeHtml(e)).join(', ')
      : '<span style="color:var(--muted);">none</span>';
    const statusColor = r.status === 'pending' ? 'var(--accent)' : 'var(--success)';
    const dateStr = r.createdAt ? r.createdAt.toLocaleDateString('en-PK', { day:'2-digit', month:'short', year:'numeric' }) : '—';
    return `<tr>
      <td>${escapeHtml(r.requesterEmail || '—')}</td>
      <td>${escapeHtml(r.hospital || '—')}</td>
      <td>${escapeHtml(r.specialty || '—')}</td>
      <td style="font-size:0.78rem;">${matched}</td>
      <td><span style="color:${statusColor};font-weight:600;">${escapeHtml(r.status || 'pending')}</span></td>
      <td style="font-size:0.8rem;">${dateStr}</td>
    </tr>`;
  }).join('');
}

// Auto-login if session valid
async function refreshAccessRequestBadge() {
  try {
    const snap = await db.collection('access_requests').get();
    allAccessRequests = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    updateAccessRequestBadge();
  } catch (_) { /* ignore */ }
}

document.getElementById('refreshRequestsBtn')?.addEventListener('click', loadAccessRequests);
document.getElementById('filterRequestStatus')?.addEventListener('change', renderAccessRequests);
document.getElementById('filterRequests')?.addEventListener('input', renderAccessRequests);
document.getElementById('requestsBody')?.addEventListener('click', function (e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const email = btn.getAttribute('data-email');
  const action = btn.getAttribute('data-action');
  if (action === 'approve-req') approveAccessRequest(email);
  else if (action === 'reject-req') rejectAccessRequest(email);
  else if (action === 'resend-req') resendAccessRequestEmail(email);
  else if (action === 'copy-req-pin') copyAccessRequestPin(email);
  else if (action === 'verify-payment') verifyAccessRequestPayment(email);
  else if (action === 'send-payment-due') sendPaymentDueToRequest(email);
});
