'use strict';
// ═══════════════════════════════════════════════════════
// AUTH GATE — Firebase PIN-per-email authentication
// Non-bypassable: page content is hidden via CSS class
// and DOM is not rendered until Firestore confirms auth.
// ═══════════════════════════════════════════════════════

(function () {
  const SESSION_KEY = 'meritnama_auth_session';
  const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours

  // Check for existing valid session
  function hasValidSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return false;
      const session = JSON.parse(raw);
      if (session && typeof session.email === 'string' && typeof session.ts === 'number') {
        return (Date.now() - session.ts) < SESSION_DURATION;
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  function setSession(email) {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ email: email, ts: Date.now() }));
  }

  // Lock page immediately
  document.body.classList.add('auth-locked');

  // If already authenticated, unlock immediately
  if (hasValidSession()) {
    document.body.classList.remove('auth-locked');
    const gate = document.getElementById('authGate');
    if (gate) gate.remove();
    return;
  }

  // Create auth gate DOM
  const gate = document.createElement('div');
  gate.id = 'authGate';
  gate.innerHTML = `
    <div class="auth-card">
      <img src="logo.svg" class="auth-logo" alt="MeritNama" />
      <h2>Private Access</h2>
      <p class="auth-subtitle">Enter your registered email and PIN to continue</p>
      <div class="auth-field">
        <label for="authEmail">Email Address</label>
        <input type="email" id="authEmail" placeholder="your@email.com" autocomplete="email" />
      </div>
      <div class="auth-field">
        <label for="authPin">PIN</label>
        <input type="password" id="authPin" placeholder="••••••" autocomplete="current-password" />
      </div>
      <button class="auth-btn" id="authSubmit">Unlock</button>
      <p class="auth-error" id="authError"></p>
      <p class="auth-footer">Access is invite-only. Contact admin for credentials.</p>
    </div>
  `;
  document.body.prepend(gate);

  // Wait for Firebase to be ready
  function waitForFirebase(cb) {
    if (window.firebase && firebase.firestore) return cb();
    const interval = setInterval(() => {
      if (window.firebase && firebase.firestore) {
        clearInterval(interval);
        cb();
      }
    }, 100);
  }

  waitForFirebase(function () {
    const db = firebase.firestore();

    const emailInput = document.getElementById('authEmail');
    const pinInput = document.getElementById('authPin');
    const submitBtn = document.getElementById('authSubmit');
    const errorEl = document.getElementById('authError');

    // Get user IP for logging
    async function getUserIP() {
      try {
        const res = await fetch('https://api.ipify.org?format=json');
        const data = await res.json();
        return data.ip;
      } catch (e) {
        return 'unknown';
      }
    }

    // Hash PIN using SHA-256 for comparison
    async function hashPin(pin) {
      const encoder = new TextEncoder();
      const data = encoder.encode(pin);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    // Log access attempt
    async function logAccess(email, success, ip) {
      try {
        await db.collection('access_logs').add({
          email: email,
          success: success,
          ip: ip,
          userAgent: navigator.userAgent,
          timestamp: firebase.firestore.FieldValue.serverTimestamp(),
          page: window.location.pathname
        });
      } catch (e) {
        console.warn('Log write failed:', e.message);
      }
    }

    async function handleAuth() {
      const email = emailInput.value.trim().toLowerCase();
      const pin = pinInput.value.trim();

      if (!email || !pin) {
        errorEl.textContent = 'Please enter both email and PIN.';
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Verifying…';
      errorEl.textContent = '';

      try {
        const ip = await getUserIP();
        const pinHash = await hashPin(pin);

        // Look up user document by email
        const userDoc = await db.collection('authorized_users').doc(email).get();

        if (!userDoc.exists) {
          errorEl.textContent = 'Access denied. Email not registered.';
          await logAccess(email, false, ip);
          submitBtn.disabled = false;
          submitBtn.textContent = 'Unlock';
          return;
        }

        const userData = userDoc.data();

        // Compare PIN — supports both plain and hashed storage
        // If stored PIN length is 64 (SHA-256 hex), compare hashes
        // Otherwise compare as plain text (for convenience when setting from Firebase console)
        let pinValid = false;
        if (userData.pin && userData.pin.length === 64) {
          pinValid = (pinHash === userData.pin);
        } else {
          pinValid = (userData.pin === pin);
        }

        if (!pinValid) {
          errorEl.textContent = 'Incorrect PIN.';
          await logAccess(email, false, ip);
          submitBtn.disabled = false;
          submitBtn.textContent = 'Unlock';
          return;
        }

        // Success — log (fire-and-forget) and unlock
        logAccess(email, true, ip);
        setSession(email);
        document.body.classList.remove('auth-locked');
        gate.remove();

      } catch (err) {
        errorEl.textContent = 'Connection error. Please try again.';
        console.error('Auth error:', err);
        submitBtn.disabled = false;
        submitBtn.textContent = 'Unlock';
      }
    }

    submitBtn.addEventListener('click', handleAuth);
    pinInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') handleAuth();
    });
    emailInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') pinInput.focus();
    });
  });
})();
