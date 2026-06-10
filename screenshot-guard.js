'use strict';

(function () {
  const SESSION_KEY = 'meritnama_auth_session';
  const LOG_COLLECTION = 'screenshot_logs';
  const ACTIVITY_COLLECTION = 'user_activity_logs';
  const LOG_THROTTLE_MS = 3000;
  const ACTIVITY_HEARTBEAT_MS = 30 * 1000;
  const PAGE = window.location.pathname || '/';

  if (PAGE.endsWith('/admin.html') || PAGE.endsWith('admin.html')) return;
  if (window.__MNScreenshotGuardLoaded) return;
  window.__MNScreenshotGuardLoaded = true;

  const state = {
    lastLogAt: {},
    shieldTimer: null,
    blurTimer: null,
    warningUnsubscribe: null,
    warningEmail: '',
    warnings: [],
    lastActivitySignature: '',
    lastActivityAt: 0,
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
      body.mn-privacy-shielded > *:not(#mnPrivacyShield):not(script):not(style) {
        filter: blur(20px) brightness(0.25) !important;
      }
      #mnWarningInboxBtn {
        position: fixed;
        right: max(0.85rem, env(safe-area-inset-right));
        bottom: max(0.85rem, env(safe-area-inset-bottom));
        z-index: 3500;
        display: none;
        align-items: center;
        gap: 0.4rem;
        padding: 0.48rem 0.68rem;
        border: 1px solid rgba(245, 200, 66, 0.32);
        border-radius: 999px;
        color: #f8df7a;
        background: rgba(5, 10, 22, 0.72);
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.25);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        cursor: pointer;
        font: 700 12px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #mnWarningInboxBtn.visible {
        display: inline-flex;
      }
      #mnWarningInboxBtn .mn-warning-count {
        min-width: 18px;
        padding: 2px 5px;
        border-radius: 999px;
        color: #07101f;
        background: #f5c842;
        font-size: 10px;
        text-align: center;
      }
      #mnWarningDialog {
        position: fixed;
        right: max(0.85rem, env(safe-area-inset-right));
        bottom: calc(max(0.85rem, env(safe-area-inset-bottom)) + 3.2rem);
        z-index: 3500;
        display: none;
        width: min(380px, calc(100vw - 1.7rem));
        max-height: min(520px, calc(100vh - 5rem));
        overflow: hidden;
        border: 1px solid rgba(245, 200, 66, 0.26);
        border-radius: 16px;
        color: #dbeafe;
        background: rgba(10, 18, 35, 0.96);
        box-shadow: 0 24px 80px rgba(0, 0, 0, 0.48);
        backdrop-filter: blur(18px);
        -webkit-backdrop-filter: blur(18px);
      }
      #mnWarningDialog.open {
        display: block;
      }
      .mn-warning-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        padding: 0.9rem 1rem;
        border-bottom: 1px solid rgba(245, 200, 66, 0.18);
      }
      .mn-warning-title {
        color: #f8df7a;
        font-weight: 800;
        font-size: 0.92rem;
      }
      .mn-warning-close {
        border: 0;
        color: #9fb1cb;
        background: transparent;
        cursor: pointer;
        font-size: 1.25rem;
        line-height: 1;
      }
      .mn-warning-list {
        max-height: min(430px, calc(100vh - 9rem));
        overflow: auto;
        padding: 0.75rem;
      }
      .mn-warning-item {
        padding: 0.75rem;
        border: 1px solid rgba(219, 234, 254, 0.1);
        border-left: 3px solid #f5c842;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.035);
        margin-bottom: 0.65rem;
      }
      .mn-warning-item.read {
        opacity: 0.68;
      }
      .mn-warning-item.danger { border-left-color: #e05470; }
      .mn-warning-item.info { border-left-color: #4db8d9; }
      .mn-warning-item.success { border-left-color: #3ecf8e; }
      .mn-warning-item h4 {
        margin: 0 0 0.35rem;
        font-size: 0.86rem;
        color: #fff;
      }
      .mn-warning-item p {
        margin: 0;
        color: #c8daf0;
        font-size: 0.78rem;
        line-height: 1.45;
        white-space: pre-wrap;
      }
      .mn-warning-meta {
        display: flex;
        justify-content: space-between;
        gap: 0.75rem;
        margin-top: 0.55rem;
        color: #7f93b4;
        font-size: 0.68rem;
      }
      .mn-warning-read-btn {
        border: 1px solid rgba(77, 184, 217, 0.25);
        border-radius: 999px;
        color: #4db8d9;
        background: rgba(77, 184, 217, 0.08);
        cursor: pointer;
        font-size: 0.68rem;
        padding: 0.18rem 0.5rem;
      }
      .mn-warning-reply {
        margin-top: 0.65rem;
        display: grid;
        gap: 0.45rem;
      }
      .mn-warning-reply textarea {
        width: 100%;
        min-height: 58px;
        resize: vertical;
        padding: 0.5rem 0.6rem;
        border: 1px solid rgba(77, 184, 217, 0.18);
        border-radius: 10px;
        color: #dbeafe;
        background: rgba(255, 255, 255, 0.045);
        font: 0.78rem/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .mn-warning-reply button {
        justify-self: end;
        border: 1px solid rgba(62, 207, 142, 0.28);
        border-radius: 999px;
        color: #3ecf8e;
        background: rgba(62, 207, 142, 0.08);
        cursor: pointer;
        font-size: 0.7rem;
        padding: 0.28rem 0.7rem;
      }
      .mn-warning-replies {
        margin-top: 0.55rem;
        color: #9fb1cb;
        font-size: 0.7rem;
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

  function makeTraceId(email) {
    let hash = 2166136261;
    for (let i = 0; i < email.length; i++) {
      hash ^= email.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36).toUpperCase().padStart(7, '0').slice(0, 7);
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function getVisibleModalElement() {
    const selectors = [
      '.modal-overlay.open',
      '.modal-overlay:not(.hidden)',
      '.modal.open',
      '.modal:not(.hidden)',
      '[id*="Modal"]:not(.hidden)',
      '[id*="modal"]:not(.hidden)',
      '#authGate',
    ];
    const candidates = document.querySelectorAll(selectors.join(','));
    for (const el of candidates) {
      if (el.id === 'mnWarningDialog' || el.id === 'mnPrivacyShield') continue;
      if (isVisible(el)) return el;
    }
    return null;
  }

  function textSnippet(el, maxLen) {
    return String(el?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, maxLen || 120);
  }

  function activeTabContext() {
    const btn = document.querySelector('.tab-btn.active[data-tab], [role="tab"][aria-selected="true"][data-tab], .sidebar-link.active[data-tab]');
    const section = document.querySelector('.tab-content.active, [id^="tab-"]:not([style*="display:none"])');
    const tab = btn?.getAttribute('data-tab')
      || section?.id?.replace(/^tab-/, '')
      || '';
    return {
      activeTab: tab,
      activeTabLabel: textSnippet(btn, 80),
      activeSectionId: section?.id || '',
    };
  }

  function findApplicantId(scope) {
    const root = scope || document;
    const attrEl = root.querySelector?.('[data-applicant-id], [data-candidate-id], [data-cand-id], [data-id]');
    const attrVal = attrEl?.getAttribute('data-applicant-id')
      || attrEl?.getAttribute('data-candidate-id')
      || attrEl?.getAttribute('data-cand-id')
      || attrEl?.getAttribute('data-id')
      || '';
    if (/^\d{3,}$/.test(String(attrVal))) return String(attrVal);

    const inputs = root.querySelectorAll?.('input, select, textarea') || [];
    for (const input of inputs) {
      const key = `${input.id || ''} ${input.name || ''} ${input.placeholder || ''}`.toLowerCase();
      if (key.includes('applicant') || key.includes('candidate') || key.endsWith(' id') || key.includes(' id ')) {
        const val = String(input.value || '').trim();
        if (/^\d{3,}$/.test(val)) return val;
      }
    }

    const text = textSnippet(root, 2000);
    const match = text.match(/(?:applicant\s*id|candidate\s*id|\bid)\s*:?\s*([0-9]{3,})/i);
    if (match) return match[1];

    try {
      const params = new URLSearchParams(window.location.search);
      const fromUrl = params.get('applicantId') || params.get('candidateId') || params.get('id') || '';
      if (/^\d{3,}$/.test(fromUrl)) return fromUrl;
    } catch (_) {}

    try {
      const ownId = localStorage.getItem('mn_sim_my_id') || '';
      if (/^\d{3,}$/.test(ownId)) return ownId;
    } catch (_) {}
    return '';
  }

  function modalContext() {
    const modal = getVisibleModalElement();
    if (!modal) return { modalId: '', modalTitle: '', applicantId: findApplicantId(document) };
    const titleEl = modal.querySelector('.modal-title, .cand-detail-title, h1, h2, h3, [data-modal-title]');
    return {
      modalId: modal.id || '',
      modalTitle: textSnippet(titleEl || modal, 120),
      applicantId: findApplicantId(modal) || findApplicantId(document),
    };
  }

  function collectPageContext() {
    return {
      ...activeTabContext(),
      ...modalContext(),
      hash: window.location.hash || '',
      focusedElement: document.activeElement
        ? `${document.activeElement.tagName || ''}${document.activeElement.id ? '#' + document.activeElement.id : ''}`.toLowerCase()
        : '',
    };
  }

  function activitySignature(context) {
    return [
      PAGE,
      window.location.search || '',
      context.activeTab || '',
      context.modalId || '',
      context.modalTitle || '',
      context.applicantId || '',
      context.hash || '',
    ].join('|');
  }

  function pageLabelFromContext(context) {
    const parts = [];
    if (document.title) parts.push(document.title.replace(/\s+—\s+MeritNama/i, '').trim());
    if (context.activeTabLabel || context.activeTab) parts.push(context.activeTabLabel || context.activeTab);
    if (context.modalTitle || context.modalId) parts.push(`Modal: ${context.modalTitle || context.modalId}`);
    if (context.applicantId) parts.push(`Applicant ID: ${context.applicantId}`);
    return parts.filter(Boolean).join(' / ') || PAGE;
  }

  function writeUserActivity(reason) {
    const email = getSessionEmail();
    const db = getDb();
    if (!email || !db) return;

    const context = collectPageContext();
    const signature = activitySignature(context);
    const now = Date.now();
    const shouldWriteLog = signature !== state.lastActivitySignature ||
      (now - state.lastActivityAt) > ACTIVITY_HEARTBEAT_MS;

    const payload = {
      email,
      traceId: makeTraceId(email),
      page: PAGE,
      path: window.location.pathname + window.location.search,
      title: document.title || '',
      pageLabel: pageLabelFromContext(context),
      activeTab: context.activeTab || '',
      activeTabLabel: context.activeTabLabel || '',
      modalId: context.modalId || '',
      modalTitle: context.modalTitle || '',
      applicantId: context.applicantId || '',
      hash: context.hash || '',
      focusedElement: context.focusedElement || '',
      visibilityState: document.visibilityState || '',
      reason: reason || 'heartbeat',
      context,
      updatedAt: serverTimestamp(),
    };

    db.collection('presence').doc(email).set({
      ...payload,
      pageTitle: payload.pageLabel,
      online: document.visibilityState !== 'hidden',
      lastSeen: serverTimestamp(),
    }, { merge: true }).catch(function () {});

    if (shouldWriteLog) {
      state.lastActivitySignature = signature;
      state.lastActivityAt = now;
      db.collection(ACTIVITY_COLLECTION).add({
        ...payload,
        createdAt: serverTimestamp(),
      }).catch(function () {});
    }
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

    const email = getSessionEmail();
    const context = collectPageContext();
    const payload = {
      email: email || 'unknown',
      traceId: email ? makeTraceId(email) : '',
      eventType,
      page: PAGE,
      path: window.location.pathname + window.location.search,
      title: document.title || '',
      activeTab: context.activeTab || '',
      activeTabLabel: context.activeTabLabel || '',
      modalId: context.modalId || '',
      modalTitle: context.modalTitle || '',
      applicantId: context.applicantId || '',
      context,
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

  function ensureWarningInbox() {
    let btn = document.getElementById('mnWarningInboxBtn');
    let dialog = document.getElementById('mnWarningDialog');
    if (btn && dialog) return { btn, dialog };

    btn = document.createElement('button');
    btn.id = 'mnWarningInboxBtn';
    btn.type = 'button';
    btn.innerHTML = '<span>Admin inbox</span><span class="mn-warning-count">0</span>';

    dialog = document.createElement('div');
    dialog.id = 'mnWarningDialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', 'Admin warnings');
    dialog.innerHTML =
      '<div class="mn-warning-head">' +
        '<div class="mn-warning-title">Admin messages</div>' +
        '<button class="mn-warning-close" type="button" aria-label="Close">&times;</button>' +
      '</div>' +
      '<div class="mn-warning-list"><div class="mn-warning-empty">No messages.</div></div>';

    document.body.appendChild(btn);
    document.body.appendChild(dialog);

    btn.addEventListener('click', function () {
      dialog.classList.toggle('open');
      if (dialog.classList.contains('open')) markVisibleWarningsRead();
    });
    dialog.querySelector('.mn-warning-close')?.addEventListener('click', function () {
      dialog.classList.remove('open');
    });
    dialog.addEventListener('click', function (e) {
      const readBtn = e.target.closest('[data-warning-read]');
      if (readBtn) {
        markWarningRead(readBtn.getAttribute('data-warning-read'));
        return;
      }
      const replyBtn = e.target.closest('[data-warning-reply]');
      if (replyBtn) {
        const id = replyBtn.getAttribute('data-warning-reply');
        const textarea = Array.from(dialog.querySelectorAll('[data-warning-reply-text]'))
          .find(el => el.getAttribute('data-warning-reply-text') === id);
        sendWarningReply(id, textarea?.value || '');
      }
    });
    return { btn, dialog };
  }

  function warningDate(value) {
    const d = value?.toDate ? value.toDate() : (value ? new Date(value) : null);
    if (!d || Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = String(value || '');
    return div.innerHTML;
  }

  function renderWarnings() {
    const { btn, dialog } = ensureWarningInbox();
    const list = dialog.querySelector('.mn-warning-list');
    const activeWarnings = state.warnings
      .filter(w => (w.status || 'active') === 'active')
      .sort((a, b) => {
        const ad = a.createdAt?.toDate?.()?.getTime?.() || Date.parse(a.createdAt || '') || 0;
        const bd = b.createdAt?.toDate?.()?.getTime?.() || Date.parse(b.createdAt || '') || 0;
        return bd - ad;
      });
    const unread = activeWarnings.filter(w => !w.readAt).length;
    btn.classList.toggle('visible', activeWarnings.length > 0);
    const count = btn.querySelector('.mn-warning-count');
    if (count) count.textContent = unread || activeWarnings.length;
    btn.title = unread ? `${unread} unread admin message${unread === 1 ? '' : 's'}` : 'Admin messages';

    if (!list) return;
    if (!activeWarnings.length) {
      list.innerHTML = '<div class="mn-warning-empty">No messages.</div>';
      return;
    }
    list.innerHTML = activeWarnings.map(w => {
      const severity = ['info', 'success', 'warning', 'danger'].includes(w.severity) ? w.severity : 'warning';
      const title = w.title || (severity === 'danger' ? 'Important warning' : 'Admin message');
      const readClass = w.readAt ? ' read' : '';
      const replies = Array.isArray(w.replies) ? w.replies : [];
      const latestReply = replies.length ? replies[replies.length - 1] : null;
      const replyMeta = latestReply
        ? `<div class="mn-warning-replies">Last reply: ${escapeHtml(String(latestReply.message || '').slice(0, 120))}</div>`
        : '';
      return `<article class="mn-warning-item ${severity}${readClass}">
        <h4>${escapeHtml(title)}</h4>
        <p>${escapeHtml(w.message || '')}</p>
        ${replyMeta}
        <div class="mn-warning-reply">
          <textarea data-warning-reply-text="${escapeHtml(w.id)}" maxlength="800" placeholder="Reply to admin..."></textarea>
          <button type="button" data-warning-reply="${escapeHtml(w.id)}">Send reply</button>
        </div>
        <div class="mn-warning-meta">
          <span>${escapeHtml(warningDate(w.createdAt) || 'Just now')}</span>
          ${w.readAt ? '<span>Read</span>' : `<button class="mn-warning-read-btn" type="button" data-warning-read="${escapeHtml(w.id)}">Mark read</button>`}
        </div>
      </article>`;
    }).join('');
  }

  function subscribeWarnings() {
    const email = getSessionEmail();
    const db = getDb();
    if (!email || !db) {
      if (state.warningUnsubscribe) {
        state.warningUnsubscribe();
        state.warningUnsubscribe = null;
      }
      state.warnings = [];
      renderWarnings();
      return;
    }
    if (state.warningEmail === email && state.warningUnsubscribe) return;
    if (state.warningUnsubscribe) state.warningUnsubscribe();
    state.warningEmail = email;
    state.warningUnsubscribe = db.collection('user_warnings')
      .where('recipientEmail', '==', email)
      .limit(50)
      .onSnapshot(function (snap) {
        state.warnings = snap.docs.map(function (doc) {
          return { id: doc.id, ...doc.data() };
        });
        renderWarnings();
      }, function (err) {
        console.warn('[MeritNama] Warning inbox unavailable:', err && err.message ? err.message : err);
      });
  }

  function markWarningRead(id) {
    if (!id) return;
    const db = getDb();
    if (!db) return;
    db.collection('user_warnings').doc(id).set({
      readAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true }).catch(function () {});
  }

  function sendWarningReply(id, message) {
    const text = String(message || '').trim();
    if (!id || !text) return;
    const db = getDb();
    const email = getSessionEmail();
    if (!db || !email) return;
    db.collection('user_warnings').doc(id).set({
      replies: firebase.firestore.FieldValue.arrayUnion({
        email,
        message: text.slice(0, 800),
        createdAt: new Date().toISOString(),
      }),
      lastReplyAt: serverTimestamp(),
      lastReplyBy: email,
      readAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true }).then(function () {
      const dialog = document.getElementById('mnWarningDialog');
      const textarea = Array.from(dialog?.querySelectorAll('[data-warning-reply-text]') || [])
        .find(el => el.getAttribute('data-warning-reply-text') === id);
      if (textarea) textarea.value = '';
    }).catch(function () {});
  }

  function markVisibleWarningsRead() {
    state.warnings.filter(w => !w.readAt).slice(0, 10).forEach(w => markWarningRead(w.id));
  }

  function init() {
    ensureStyles();
    ensureShield();
    ensureWarningInbox();
    document.body.classList.add('mn-screen-guard-active');
    writeUserActivity('page_load');
    subscribeWarnings();

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
      writeUserActivity('focus');
    });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        writeUserActivity('hidden');
        showShield('Content hidden while the page is not active.', { persistent: true });
      } else {
        hideShield();
        writeUserActivity('visible');
      }
    });
    window.addEventListener('hashchange', function () { writeUserActivity('hashchange'); });
    window.addEventListener('storage', function () {
      writeUserActivity('storage');
      subscribeWarnings();
    });
    document.addEventListener('click', function () {
      setTimeout(function () { writeUserActivity('click'); }, 80);
    }, true);
    setInterval(function () {
      writeUserActivity('heartbeat');
      subscribeWarnings();
    }, 10 * 1000);
  }

  window.MNScreenshotGuard = {
    logEvent: logScreenshotEvent,
    showShield,
    getContext: collectPageContext,
    writeActivity: writeUserActivity,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
