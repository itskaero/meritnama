// ═══════════════════════════════════════════════════════════════════
// DATA LOADING
// ═══════════════════════════════════════════════════════════════════
async function loadData() {
  setStatus('loading', 'Loading…');
  try {
    const r = await fetch('data/induction21_candidates.json');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    // Support both {candidates:[...]} and the ID-keyed object format {"27267":{...}, ...}
    SIM.candidates = Array.isArray(d)
      ? d
      : (d.candidates || Object.values(d));
    SIM.candidates.forEach(ensureCandidateAdjusted);
  } catch (e) {
    setStatus('error', 'No data');
    document.getElementById('noDataBanner')?.classList.remove('hidden');
    return;
  }

  // Optional seats
  try {
    const r = await fetch('data/induction21_seats.json');
    if (r.ok) {
      const raw = await r.json();
      // Support both the flat array format [{typeName, quotaName, specialityName, hospitalName, seats}]
      // and the pre-nested format {program: {quota: {spec: {hosp: n}}}}
      if (Array.isArray(raw)) {
        SIM.flatSeats = raw;
        const nested = {};
        for (const row of raw) {
          const prog  = row.typeName;
          const quota = row.quotaName;
          const spec  = row.specialityName;
          const hosp  = row.hospitalName;
          nested[prog]        ??= {};
          nested[prog][quota] ??= {};
          nested[prog][quota][spec] ??= {};
          nested[prog][quota][spec][hosp] = row.seats;
        }
        SIM.seats = nested;
      } else {
        SIM.seats = raw;
        SIM.flatSeats = [];
      }
      SIM.seatsLoaded = true;
    }
  } catch (_) {}

  await loadSimulationNotifications();

  const n   = SIM.candidates.length;
  const smsg = SIM.seatsLoaded ? ' + seats' : '';
  setStatus('ok', `${n} candidates${smsg}`);
  document.getElementById('simNoSeatsWarn')?.classList.toggle('hidden', SIM.seatsLoaded);
}

function initLiveBanner() {
  try {
    firebase.firestore().collection('notifications').doc('latest').onSnapshot(snap => {
      if (!snap.exists) { hideLiveBanner(); return; }
      const n = snap.data();
      if (!n || !n.active) { hideLiveBanner(); return; }
      showLiveBanner(n);
    });
  } catch (_) {}
}

function showLiveBanner(n) {
  const banner = document.getElementById('liveUpdateBanner');
  const text   = document.getElementById('lubText');
  const icon   = document.getElementById('lubIcon');
  const link   = document.getElementById('lubLink');
  const close  = document.getElementById('lubClose');
  if (!banner) return;

  const dismissKey = 'mn_notif_dismissed_' + (n.id || n.updatedAt?.seconds || '0');
  if (sessionStorage.getItem(dismissKey)) return;

  const typeMap = { warning: 'lub-warning', info: 'lub-info', success: 'lub-success', danger: 'lub-danger' };
  banner.className = 'live-update-banner ' + (typeMap[n.type] || 'lub-info');
  if (icon) icon.textContent = n.icon || '🔔';
  if (text) text.textContent = (n.title ? n.title + ' — ' : '') + (n.body || '');

  if (link && n.link) {
    link.href = n.link;
    link.textContent = n.linkText || 'View';
    link.style.display = '';
  } else if (link) {
    link.style.display = 'none';
  }

  banner.style.display = 'flex';
  if (close) {
    close.onclick = () => {
      banner.style.display = 'none';
      sessionStorage.setItem(dismissKey, '1');
    };
  }
}

function hideLiveBanner() {
  const banner = document.getElementById('liveUpdateBanner');
  if (banner) banner.style.display = 'none';
}

const FETCH_PROGRESS = {
  unsubscribe: null,
  tickTimer:    null,
  data:         null,
};

function initFetchProgress() {
  try {
    if (FETCH_PROGRESS.unsubscribe) FETCH_PROGRESS.unsubscribe();
    FETCH_PROGRESS.unsubscribe = firebase.firestore()
      .collection('notifications').doc('fetch_progress')
      .onSnapshot(snap => {
        if (!snap.exists) { hideFetchProgress(); return; }
        const d = snap.data();
        if (!d?.active) { hideFetchProgress(); return; }
        FETCH_PROGRESS.data = d;
        renderFetchProgress(d);
        _startFetchProgressTick();
      });
  } catch (_) {}
}

function hideFetchProgress() {
  FETCH_PROGRESS.data = null;
  _stopFetchProgressTick();
  document.getElementById('fetchProgressWrap')?.classList.add('hidden');
}

function _clampFetchPercent(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function _fetchTsToDate(ts) {
  if (!ts) return null;
  if (ts.toDate) return ts.toDate();
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d;
}

function _formatFetchDuration(ms) {
  if (ms == null || ms < 0) return '—';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function _fetchElapsedMs(d) {
  const started = _fetchTsToDate(d.startedAt);
  if (!started) return null;
  const status = d.status || 'running';
  let endMs = Date.now();
  if (status === 'paused') {
    const paused = _fetchTsToDate(d.pausedAt);
    if (paused) endMs = paused.getTime();
  } else if (status === 'completed') {
    const updated = _fetchTsToDate(d.updatedAt);
    if (updated) endMs = updated.getTime();
  }
  return Math.max(0, endMs - started.getTime());
}

function _fetchStatusLabel(status) {
  if (status === 'paused') return 'Paused';
  if (status === 'completed') return 'Completed';
  return 'Running';
}

function _fetchStatusIcon(status) {
  if (status === 'paused') return '⏸';
  if (status === 'completed') return '✅';
  return '⏳';
}

function renderFetchProgress(d) {
  const wrap = document.getElementById('fetchProgressWrap');
  if (!wrap) return;

  const status = ['running', 'paused', 'completed'].includes(d.status) ? d.status : 'running';
  const percent = _clampFetchPercent(d.percent);
  wrap.classList.remove('hidden', 'is-paused', 'is-completed');
  if (status === 'paused') wrap.classList.add('is-paused');
  if (status === 'completed') wrap.classList.add('is-completed');

  const iconEl = document.getElementById('fetchProgressIcon');
  const titleEl = document.getElementById('fetchProgressTitle');
  const msgEl = document.getElementById('fetchProgressMessage');
  const statusEl = document.getElementById('fetchProgressStatus');
  const barEl = document.getElementById('fetchProgressBar');
  const countsEl = document.getElementById('fetchProgressCounts');
  const pctEl = document.getElementById('fetchProgressPercent');
  const startedEl = document.getElementById('fetchProgressStarted');
  const elapsedEl = document.getElementById('fetchProgressElapsed');

  if (iconEl) iconEl.textContent = d.icon || _fetchStatusIcon(status);
  if (titleEl) titleEl.textContent = d.title || 'Fetching candidate data';
  if (msgEl) {
    msgEl.textContent = d.message || '';
    msgEl.style.display = d.message ? '' : 'none';
  }
  if (statusEl) {
    statusEl.textContent = _fetchStatusLabel(status);
    statusEl.className = `fetch-progress-status fetch-progress-status-${status}`;
  }
  if (barEl) barEl.style.width = `${percent}%`;

  const fetched = Number(d.fetched);
  const total = Number(d.total);
  if (countsEl) {
    if (Number.isFinite(fetched) && Number.isFinite(total) && total > 0) {
      countsEl.innerHTML = `<strong>${fetched.toLocaleString()}</strong> / ${total.toLocaleString()} fetched`;
    } else if (Number.isFinite(fetched)) {
      countsEl.innerHTML = `<strong>${fetched.toLocaleString()}</strong> fetched`;
    } else {
      countsEl.textContent = '';
    }
  }

  if (pctEl) pctEl.innerHTML = `<strong>${percent}%</strong> complete`;

  const started = _fetchTsToDate(d.startedAt);
  if (startedEl) {
    startedEl.innerHTML = started
      ? `Started <strong>${started.toLocaleString('en-PK', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</strong>`
      : '';
  }

  if (elapsedEl) {
    const elapsed = _fetchElapsedMs(d);
    elapsedEl.innerHTML = elapsed != null
      ? `Elapsed <strong>${_formatFetchDuration(elapsed)}</strong>${status === 'paused' ? ' (paused)' : ''}`
      : '';
  }
}

function _startFetchProgressTick() {
  _stopFetchProgressTick();
  FETCH_PROGRESS.tickTimer = setInterval(() => {
    if (FETCH_PROGRESS.data?.status === 'running') renderFetchProgress(FETCH_PROGRESS.data);
  }, 1000);
}

function _stopFetchProgressTick() {
  if (FETCH_PROGRESS.tickTimer) {
    clearInterval(FETCH_PROGRESS.tickTimer);
    FETCH_PROGRESS.tickTimer = null;
  }
}

async function loadSimulationNotifications() {
  SIM.notifications = await MNNotif.loadFeedItems();
}

function initSimulationNotificationFeed() {
  MNNotif.initFeedListener(items => {
    SIM.notifications = items;
    renderNotifications();
  });
}

function setStatus(type, msg) {
  const el = document.getElementById('dataStatus');
  if (!el) return;
  el.textContent = msg;
  el.className = `badge badge-${type === 'error' ? 'danger' : type === 'loading' ? 'muted' : 'info'}`;
}

function showLoading(on) {
  const ov = document.getElementById('simLoadingOverlay');
  if (ov) ov.classList.toggle('hidden', !on);
}
