'use strict';
// ═══════════════════════════════════════════════════════
// PRESENCE — tracks which page each logged-in user is on
// Writes to Firestore `presence/{email}` every 60s.
// Admin dashboard reads this collection in real-time.
// ═══════════════════════════════════════════════════════

(function () {
  const SESSION_KEY  = 'meritnama_auth_session';
  const HEARTBEAT_MS = 60 * 1000; // 60 seconds

  const PAGE_TITLES = {
    '/':                'Main Dashboard',
    '/index.html':      'Main Dashboard',
    '/reviews.html':    'Reviews & Forum',
    '/simulation.html': 'Merit Simulation',
    '/donate.html':     'Donate',
  };

  function getEmail() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      return (s && typeof s.email === 'string') ? s.email : null;
    } catch (e) { return null; }
  }

  function getPageTitle() {
    // Strip any subfolder prefix (e.g. GitHub Pages /meritnama/reviews.html → /reviews.html)
    const parts = window.location.pathname.split('/');
    const file  = '/' + (parts[parts.length - 1] || '');
    return PAGE_TITLES[file] || PAGE_TITLES[window.location.pathname] || document.title || window.location.pathname;
  }

  function waitForFirebase(cb) {
    if (window.firebase && firebase.firestore) return cb();
    const t = setInterval(() => {
      if (window.firebase && firebase.firestore) { clearInterval(t); cb(); }
    }, 200);
  }

  waitForFirebase(function () {
    const email = getEmail();
    if (!email) return; // not authenticated — nothing to track

    const db   = firebase.firestore();
    const ref  = db.collection('presence').doc(email);
    const page = window.location.pathname;
    const pageTitle = getPageTitle();

    function writePresence(online) {
      ref.set({
        email,
        page,
        pageTitle,
        online,
        lastSeen: firebase.firestore.FieldValue.serverTimestamp(),
      }, { merge: true }).catch(() => {}); // best-effort, never throw
    }

    // ── Initial write ───────────────────────────────────
    writePresence(true);

    // ── Periodic heartbeat (keep lastSeen fresh) ────────
    const heartbeatInterval = setInterval(() => {
      if (document.visibilityState !== 'hidden') {
        writePresence(true);
      }
    }, HEARTBEAT_MS);

    // ── Pause when tab goes background, resume on focus ─
    document.addEventListener('visibilitychange', () => {
      writePresence(document.visibilityState === 'visible');
    });

    // ── Best-effort offline mark on page close ──────────
    // Firestore SDK is async so this may not always complete,
    // but the admin dashboard also uses a 2-min timeout as fallback.
    window.addEventListener('beforeunload', () => {
      clearInterval(heartbeatInterval);
      ref.update({
        online:   false,
        lastSeen: firebase.firestore.FieldValue.serverTimestamp(),
      }).catch(() => {});
    });
  });
})();
