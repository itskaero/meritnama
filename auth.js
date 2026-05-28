'use strict';
// ═══════════════════════════════════════════════════════
// AUTH GATE — Firebase PIN-per-email authentication
// Session is verified against Firestore on resume,
// so forged localStorage entries are rejected.
// ═══════════════════════════════════════════════════════

(function () {
  const SESSION_KEY      = 'meritnama_auth_session';
  const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours
  const VERIFY_INTERVAL  =  1 * 60 * 60 * 1000; // re-check Firestore every 1 hour

  function getStoredSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (s && typeof s.email === 'string' && typeof s.ts === 'number') {
        if ((Date.now() - s.ts) < SESSION_DURATION) return s;
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  function setSession(email) {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      email: email, ts: Date.now(), verified: Date.now()
    }));
  }

  // Wait for Firebase SDKs to be ready
  function waitForFirebase(cb) {
    if (window.firebase && firebase.firestore) return cb();
    const iv = setInterval(function () {
      if (window.firebase && firebase.firestore) { clearInterval(iv); cb(); }
    }, 100);
  }

  // ── Lock page immediately ────────────────────────────
  document.body.classList.add('auth-locked');

  const storedSession = getStoredSession();

  if (storedSession) {
    // Session found locally. Determine if we need to re-verify with Firestore.
    const needsVerify = !storedSession.verified ||
                        (Date.now() - storedSession.verified) > VERIFY_INTERVAL;

    if (!needsVerify) {
      // Recent Firestore check — trust the cache and unlock immediately
      document.body.classList.remove('auth-locked');
      return;
    }

    // Show a lightweight spinner while we verify
    const spinner = document.createElement('div');
    spinner.id = 'authVerifying';
    spinner.innerHTML =
      '<div class="auth-verifying-inner">' +
        '<div class="auth-spinner"></div>' +
        '<p>Verifying session\u2026</p>' +
      '</div>';
    document.body.prepend(spinner);

    waitForFirebase(function () {
      var db = firebase.firestore();
      db.collection('authorized_users').doc(storedSession.email).get()
        .then(function (doc) {
          spinner.remove();
          if (doc.exists) {
            // Stamp fresh verification time and unlock
            localStorage.setItem(SESSION_KEY, JSON.stringify({
              email: storedSession.email,
              ts: storedSession.ts,
              verified: Date.now()
            }));
            document.body.classList.remove('auth-locked');
          } else {
            // Email no longer in authorized_users — invalidate and re-gate
            localStorage.removeItem(SESSION_KEY);
            showAuthGate();
          }
        })
        .catch(function () {
          // Network error — fail open (data is deterrence-level, UX > paranoia)
          spinner.remove();
          document.body.classList.remove('auth-locked');
        });
    });
    return;
  }

  // ── No valid session ─────────────────────────────────
  showAuthGate();

  // ────────────────────────────────────────────────────
  function showAuthGate() {
    var gate = document.createElement('div');
    gate.id = 'authGate';
    gate.innerHTML =
      '<div class="auth-card">' +
        '<img src="logo.svg" class="auth-logo" alt="MeritNama" />' +
        '<h2>Private Access</h2>' +
        '<p class="auth-subtitle">Enter your registered email and PIN to continue</p>' +
        '<div class="auth-field">' +
          '<label for="authEmail">Email Address</label>' +
          '<input type="email" id="authEmail" placeholder="your@email.com" autocomplete="email" />' +
        '</div>' +
        '<div class="auth-field">' +
          '<label for="authPin">PIN</label>' +
          '<input type="password" id="authPin" placeholder="\u2022\u2022\u2022\u2022\u2022\u2022" autocomplete="current-password" />' +
        '</div>' +
        '<button class="auth-btn" id="authSubmit">Unlock</button>' +
        '<p class="auth-error" id="authError"></p>' +
        '<p class="auth-footer">Access is invite-only. Contact admin for credentials.</p>' +
      '</div>';
    document.body.prepend(gate);

    waitForFirebase(function () {
      var db = firebase.firestore();

      var emailInput = document.getElementById('authEmail');
      var pinInput   = document.getElementById('authPin');
      var submitBtn  = document.getElementById('authSubmit');
      var errorEl    = document.getElementById('authError');

      async function getUserIP() {
        try {
          var res  = await fetch('https://api.ipify.org?format=json');
          var data = await res.json();
          return data.ip;
        } catch (e) { return 'unknown'; }
      }

      async function hashPin(pin) {
        var encoder    = new TextEncoder();
        var hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(pin));
        return Array.from(new Uint8Array(hashBuffer))
          .map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
      }

      async function logAccess(email, success, ip) {
        try {
          await db.collection('access_logs').add({
            email: email, success: success, ip: ip,
            userAgent: navigator.userAgent,
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            page: window.location.pathname
          });
        } catch (e) { console.warn('Log write failed:', e.message); }
      }

      async function handleAuth() {
        var email = emailInput.value.trim().toLowerCase();
        var pin   = pinInput.value.trim();

        if (!email || !pin) {
          errorEl.textContent = 'Please enter both email and PIN.';
          return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Verifying\u2026';
        errorEl.textContent = '';

        try {
          var ip      = await getUserIP();
          var pinHash = await hashPin(pin);

          var userDoc  = await db.collection('authorized_users').doc(email).get();

          if (!userDoc.exists) {
            errorEl.textContent = 'Access denied. Email not registered.';
            await logAccess(email, false, ip);
            submitBtn.disabled = false;
            submitBtn.textContent = 'Unlock';
            return;
          }

          var userData = userDoc.data();

          // Compare PIN — supports both plain and hashed (SHA-256 hex, length 64) storage
          var pinValid = (userData.pin && userData.pin.length === 64)
            ? (pinHash === userData.pin)
            : (userData.pin === pin);

          if (!pinValid) {
            errorEl.textContent = 'Incorrect PIN.';
            await logAccess(email, false, ip);
            submitBtn.disabled = false;
            submitBtn.textContent = 'Unlock';
            return;
          }

          // Success
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
  }

})();