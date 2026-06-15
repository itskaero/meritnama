
function onDataReady() {
  computeMeritPercentOfMax();
  computeYearlyPercentiles();
  renderInductionSummary();
  populateAllFilters();
  setupTabNavigation();
  setupMeritTable();
  setupPredictorTab();
  setupCalculatorTab();
  setupReverseCalcTab();
  setupCurrentMerit();
  setupCompetitionTab();
  setupSeatMatrixTab();
  setupCompareTab();
  setupBackToTop();
  setupHamburger();
  setupKeyboardShortcuts();
  initTooltips();
  updateHeaderMeta();
  updateFooterStats();
  handleURLParams();
  renderMeritTable();
  initNotifications();
}

// ═══════════════════════════════════════════════════════
// NOTIFICATIONS — live banner (Option A) + web push (Option B)
// ═══════════════════════════════════════════════════════

const NOTIF_KEY = 'mn_push_subscribed';

function initNotifications() {
  // ── Option A: live in-app banner via Firestore onSnapshot ──
  try {
    const db = firebase.firestore();
    db.collection('notifications').doc('latest').onSnapshot(snap => {
      if (!snap.exists) { hideLiveBanner(); return; }
      const n = snap.data();
      if (!n || !n.active) { hideLiveBanner(); return; }
      showLiveBanner(n);
    });
  } catch (e) { /* Firestore not available */ }

  // ── Option B: web push subscription button ──
  const btn = document.getElementById('notifBellBtn');
  if (!btn) return;

  const supported = ('serviceWorker' in navigator) && ('Notification' in window) && !!window.FIREBASE_VAPID_KEY;
  if (!supported) {
    btn.style.display = 'none';
    return;
  }

  updateBellUI();

  btn.addEventListener('click', async () => {
    if (btn.classList.contains('subscribed')) {
      await unsubscribePush();
    } else {
      await subscribePush();
    }
  });
}

function updateBellUI() {
  const btn   = document.getElementById('notifBellBtn');
  const label = document.getElementById('bellLabel');
  const dot   = document.getElementById('bellDot');
  if (!btn) return;
  const subbed = localStorage.getItem(NOTIF_KEY) === '1';
  btn.classList.toggle('subscribed', subbed);
  if (label) label.textContent = subbed ? 'Subscribed' : 'Alerts';
  if (dot)   dot.style.display = subbed ? 'none' : '';
  btn.title = subbed ? 'Unsubscribe from data update alerts' : 'Subscribe to data update alerts';
}

async function subscribePush() {
  const btn = document.getElementById('notifBellBtn');
  btn.classList.add('loading');
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      alert('Please allow notifications in your browser to subscribe to data updates.');
      return;
    }

    const swReg = await navigator.serviceWorker.register('./firebase-messaging-sw.js', { scope: './' });
    const messaging = firebase.messaging();
    const token = await messaging.getToken({ vapidKey: window.FIREBASE_VAPID_KEY, serviceWorkerRegistration: swReg });

    if (token) {
      const db = firebase.firestore();
      await db.collection('push_subscriptions').doc(token).set({
        token,
        subscribedAt: firebase.firestore.FieldValue.serverTimestamp(),
        userAgent: navigator.userAgent.substring(0, 200),
      }, { merge: true });

      localStorage.setItem(NOTIF_KEY, '1');
      updateBellUI();
    }
  } catch (e) {
    console.error('Push subscribe error:', e);
    alert('Could not enable notifications: ' + e.message);
  } finally {
    btn.classList.remove('loading');
  }
}

async function unsubscribePush() {
  const btn = document.getElementById('notifBellBtn');
  btn.classList.add('loading');
  try {
    const messaging = firebase.messaging();
    const token = await messaging.getToken({ vapidKey: window.FIREBASE_VAPID_KEY }).catch(() => null);
    if (token) {
      await messaging.deleteToken();
      const db = firebase.firestore();
      await db.collection('push_subscriptions').doc(token).delete().catch(() => {});
    }
    localStorage.removeItem(NOTIF_KEY);
    updateBellUI();
  } catch (e) {
    localStorage.removeItem(NOTIF_KEY);
    updateBellUI();
  } finally {
    btn.classList.remove('loading');
  }
}

// ── Live banner display ──────────────────────────────────
function showLiveBanner(n) {
  const banner = document.getElementById('liveUpdateBanner');
  const text   = document.getElementById('lubText');
  const icon   = document.getElementById('lubIcon');
  const link   = document.getElementById('lubLink');
  const close  = document.getElementById('lubClose');
  if (!banner) return;

  // Dismiss key — don't re-show if already dismissed this version
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

document.addEventListener('DOMContentLoaded', loadAllData);
