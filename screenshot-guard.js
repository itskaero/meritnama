'use strict';

(function () {
  const SESSION_KEY = 'meritnama_auth_session';
  const LOG_COLLECTION = 'screenshot_logs';
  const LOG_THROTTLE_MS = 3000;
  const PAGE = window.location.pathname || '/';

  if (PAGE.endsWith('/admin.html') || PAGE.endsWith('admin.html')) return;
  if (window.__MNScreenshotGuardLoaded) return;
  window.__MNScreenshotGuardLoaded = true;

  const state = {
    lastLogAt: {},
    shieldTimer: null,
    blurTimer: null,
    watermarkLabel: '',
  };

  function getSessionEmail() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return '';
      const session = JSON.parse(raw);
      return (session && typeof session.email === 'string') ? session.email.toLowerCase().trim() : '';
    } catch (_) {
      return '';
    }
  }

  function getDb() {
    try {
      if (window.firebase && firebase.firestore) return firebase.firestore();
    } catch (_) {}
    return null;
  }

  function serverTimestamp() {
    try {
      return firebase.firestore.FieldValue.serverTimestamp();
    } catch (_) {
      return new Date();
    }
  }

  function ensureStyles() {
    if (document.getElementById('mnScreenshotGuardStyle')) return;
    const style = document.createElement('style');
    style.id = 'mnScreenshotGuardStyle';
    style.textContent = `
      body.mn-screen-guard-active {
        -webkit-touch-callout: none;
      }
      #mnPrivacyShield {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 2rem;
        text-align: center;
        color: #dbeafe;
        background: rgba(5, 10, 22, 0.97);
        backdrop-filter: blur(18px);
        -webkit-backdrop-filter: blur(18px);
      }
      #mnPrivacyShield .mn-shield-card {
        max-width: 520px;
        padding: 2rem;
        border: 1px solid rgba(77, 184, 217, 0.35);
        border-radius: 18px;
        background: rgba(16, 26, 52, 0.92);
        box-shadow: 0 24px 80px rgba(0, 0, 0, 0.55);
      }
      #mnPrivacyShield .mn-shield-title {
        margin: 0 0 0.55rem;
        color: #4db8d9;
        font-size: 1.25rem;
        font-weight: 800;
      }
      #mnPrivacyShield .mn-shield-text {
        margin: 0;
        color: #c8daf0;
        line-height: 1.55;
      }
      body.mn-privacy-shielded #mnPrivacyShield {
        display: flex;
      }
      body.mn-privacy-shielded > *:not(#mnPrivacyShield):not(#mnPrivacyWatermark):not(script):not(style) {
        filter: blur(20px) brightness(0.25) !important;
      }
      #mnPrivacyWatermark {
        position: fixed;
        left: max(0.7rem, env(safe-area-inset-left));
        bottom: max(0.7rem, env(safe-area-inset-bottom));
        z-index: 2147483000;
        display: none;
        max-width: min(340px, calc(100vw - 1.4rem));
        padding: 0.38rem 0.62rem;
        pointer-events: none;
        color: rgba(219, 234, 254, 0.78);
        background: rgba(5, 10, 22, 0.54);
        border: 1px solid rgba(77, 184, 217, 0.22);
        border-radius: 999px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
      }
      #mnPrivacyWatermark span {
        display: block;
        overflow: hidden;
        font: 600 11px/1.35 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: 0.03em;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      body.mn-watermark-enabled #mnPrivacyWatermark {
        display: block;
      }
      @media print {
        body * {
          visibility: hidden !important;
        }
        body::before {
          content: "Printing and screenshots are disabled for MeritNama private content.";
          visibility: visible !important;
          position: fixed;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 2rem;
          background: #050a16;
          color: #dbeafe;
          font: 700 18px/1.5 system-ui, sans-serif;
          text-align: center;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function ensureShield() {
    let shield = document.getElementById('mnPrivacyShield');
    if (shield) return shield;
    shield = document.createElement('div');
    shield.id = 'mnPrivacyShield';
    shield.setAttribute('aria-live', 'polite');
    shield.innerHTML =
      '<div class="mn-shield-card">' +
        '<div class="mn-shield-title">Protected content</div>' +
        '<p class="mn-shield-text" id="mnPrivacyShieldText">Screenshots are disabled on this site.</p>' +
      '</div>';
    document.body.appendChild(shield);
    return shield;
  }

  function ensureWatermark() {
    let watermark = document.getElementById('mnPrivacyWatermark');
    if (watermark) return watermark;
    watermark = document.createElement('div');
    watermark.id = 'mnPrivacyWatermark';
    watermark.setAttribute('aria-hidden', 'true');
    watermark.innerHTML = '<span></span>';
    document.body.appendChild(watermark);
    return watermark;
  }

  function refreshWatermark() {
    const email = getSessionEmail();
    const label = email ? `Private session: ${email}` : '';
    if (label === state.watermarkLabel) return;
    state.watermarkLabel = label;

    const watermark = ensureWatermark();
    const text = watermark.querySelector('span');
    if (text) text.textContent = label;
    document.body.classList.toggle('mn-watermark-enabled', !!label);
  }

  function showShield(message, options) {
    const opts = options || {};
    ensureShield();
    const text = document.getElementById('mnPrivacyShieldText');
    if (text) text.textContent = message || 'Screenshots are disabled on this site.';
    document.body.classList.add('mn-privacy-shielded');

    if (opts.logType) logScreenshotEvent(opts.logType, opts.extra || {});

    clearTimeout(state.shieldTimer);
    if (!opts.persistent) {
      state.shieldTimer = setTimeout(hideShield, opts.duration || 2400);
    }
  }

  function hideShield() {
    clearTimeout(state.shieldTimer);
    state.shieldTimer = null;
    document.body.classList.remove('mn-privacy-shielded');
  }

  function logScreenshotEvent(eventType, extra) {
    const now = Date.now();
    const throttleKey = eventType + '|' + PAGE;
    if (state.lastLogAt[throttleKey] && now - state.lastLogAt[throttleKey] < LOG_THROTTLE_MS) return;
    state.lastLogAt[throttleKey] = now;

    const db = getDb();
    if (!db) return;

    const payload = {
      email: getSessionEmail() || 'unknown',
      eventType,
      page: PAGE,
      path: window.location.pathname + window.location.search,
      title: document.title || '',
      userAgent: (navigator.userAgent || '').substring(0, 300),
      visibilityState: document.visibilityState || '',
      viewport: `${window.innerWidth || 0}x${window.innerHeight || 0}`,
      screen: window.screen ? `${screen.width}x${screen.height}` : '',
      clientAt: new Date().toISOString(),
      createdAt: serverTimestamp(),
      ...(extra || {}),
    };

    db.collection(LOG_COLLECTION).add(payload).catch(function (err) {
      console.warn('[MeritNama] Screenshot log failed:', err && err.message ? err.message : err);
    });
  }

  function clearClipboard() {
    if (!navigator.clipboard || !navigator.clipboard.writeText) return;
    navigator.clipboard.writeText('Screenshots are disabled on MeritNama.').catch(function () {});
  }

  function isScreenshotShortcut(e) {
    const key = String(e.key || '').toLowerCase();
    if (e.key === 'PrintScreen' || e.code === 'PrintScreen' || e.keyCode === 44) return 'printscreen_key';
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && (key === 's' || key === '3' || key === '4' || key === '5')) {
      return 'screenshot_shortcut';
    }
    return '';
  }

  function blockScreenshotEvent(e, source) {
    if (e && e.cancelable) e.preventDefault();
    if (e) e.stopPropagation();
    clearClipboard();
    showShield('Screenshot capture is disabled. This attempt has been logged for admin review.', {
      logType: source,
      extra: { key: e ? (e.key || e.code || '') : '' },
    });
  }

  function onKeyEvent(e) {
    const screenshotType = isScreenshotShortcut(e);
    if (screenshotType) {
      blockScreenshotEvent(e, screenshotType);
      return;
    }

    const key = String(e.key || '').toLowerCase();
    if ((e.ctrlKey || e.metaKey) && key === 'p') {
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
      showShield('Printing is disabled for private MeritNama content.', { logType: 'print_blocked' });
    }
  }

  function init() {
    ensureStyles();
    ensureShield();
    ensureWatermark();
    document.body.classList.add('mn-screen-guard-active');
    refreshWatermark();

    document.addEventListener('keydown', onKeyEvent, true);
    document.addEventListener('keyup', function (e) {
      if (isScreenshotShortcut(e)) blockScreenshotEvent(e, isScreenshotShortcut(e));
    }, true);
    window.addEventListener('beforeprint', function () {
      showShield('Printing is disabled for private MeritNama content.', { logType: 'print_blocked' });
    });
    window.addEventListener('blur', function () {
      clearTimeout(state.blurTimer);
      state.blurTimer = setTimeout(function () {
        showShield('Content hidden while the window is not active.', { persistent: true });
      }, 120);
    });
    window.addEventListener('focus', function () {
      clearTimeout(state.blurTimer);
      hideShield();
      refreshWatermark();
    });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        showShield('Content hidden while the page is not active.', { persistent: true });
      } else {
        hideShield();
        refreshWatermark();
      }
    });
    window.addEventListener('storage', refreshWatermark);
    setInterval(refreshWatermark, 2000);
  }

  window.MNScreenshotGuard = {
    logEvent: logScreenshotEvent,
    showShield,
    refresh: refreshWatermark,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
