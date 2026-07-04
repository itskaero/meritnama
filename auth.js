'use strict';

/**
 * MeritNama Authentication System
 * Firebase PIN-per-email access control.
 * Restyled with Zinc & Burnt Orange aesthetic system.
 */

(function () {
  const SESSION_KEY      = 'meritnama_auth_session';
  const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours
  const VERIFY_INTERVAL  =  1 * 60 * 60 * 1000; // re-verify with Firestore every hour

  // Wait for Firebase SDKs to be fully loaded
  function waitForFirebase(cb) {
    if (window.firebase && firebase.firestore) return cb();
    const iv = setInterval(function () {
      if (window.firebase && firebase.firestore) { clearInterval(iv); cb(); }
    }, 100);
  }

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

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
    window.location.hash = '#/';
    window.location.reload();
  }

  function updateSidebarUserInfo(email) {
    const avatar = document.getElementById('sidebarAvatar');
    const nameLabel = document.getElementById('sidebarUserName');
    if (avatar && email) {
      avatar.textContent = email.charAt(0).toUpperCase();
    }
    if (nameLabel && email) {
      nameLabel.textContent = email;
    }

    // Attach click listener to sign out
    const userBtn = document.getElementById('sidebarUserBtn');
    if (userBtn) {
      userBtn.onclick = function(e) {
        e.preventDefault();
        if (confirm('Are you sure you want to sign out?')) {
          clearSession();
        }
      };
    }
  }

  window.showAuthGate = function () {
    const gate = document.getElementById('authGate');
    if (!gate) return;

    gate.innerHTML = `
      <div class="auth-card">
        <img src="logo.svg" class="auth-logo" alt="MeritNama Logo">
        <h2>Private Access</h2>
        <p class="auth-subtitle">Enter your registered email and PIN to continue</p>
        
        <div class="auth-field">
          <label for="authEmail">Email Address</label>
          <input type="email" id="authEmail" class="input" placeholder="your@email.com" autocomplete="email" spellcheck="false">
          <p class="form-error" id="authEmailError"></p>
        </div>
        
        <div class="auth-field">
          <label for="authPin">PIN</label>
          <input type="password" id="authPin" class="input" placeholder="••••••••" autocomplete="current-password">
          <p class="form-error" id="authPinError"></p>
        </div>
        
        <button class="auth-btn" id="authSubmit">Unlock Portal</button>
        <p class="auth-error" id="authGlobalError"></p>
        
        <p class="auth-subtitle" style="font-size:11px; margin-top: var(--spacing-sm);">
          Access is invite-only. Approved requests receive credentials by email.
        </p>
      </div>
    `;

    gate.classList.remove('hidden');

    waitForFirebase(function () {
      const db = firebase.firestore();
      const emailInput = document.getElementById('authEmail');
      const pinInput = document.getElementById('authPin');
      const submitBtn = document.getElementById('authSubmit');
      
      const emailError = document.getElementById('authEmailError');
      const pinError = document.getElementById('authPinError');
      const globalError = document.getElementById('authGlobalError');

      async function getUserIP() {
        try {
          const res = await fetch('https://api.ipify.org?format=json');
          const data = await res.json();
          return data.ip;
        } catch (e) { return 'unknown'; }
      }

      async function hashPin(pin) {
        const encoder = new TextEncoder();
        const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(pin));
        return Array.from(new Uint8Array(hashBuffer))
          .map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
      }

      async function logAccess(email, success, ip) {
        try {
          await db.collection('access_logs').add({
            email: email, success: success, ip: ip,
            userAgent: navigator.userAgent,
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            page: window.location.hash || '#/'
          });
        } catch (e) { console.warn('Access log write failed:', e.message); }
      }

      async function handleAuth() {
        const email = emailInput.value.trim().toLowerCase();
        const pin = pinInput.value.trim();

        // Clear error states
        emailError.textContent = '';
        pinError.textContent = '';
        globalError.textContent = '';

        let hasError = false;
        if (!email) {
          emailError.textContent = 'Email address is required.';
          hasError = true;
        }
        if (!pin) {
          pinError.textContent = 'PIN code is required.';
          hasError = true;
        }

        if (hasError) return;

        submitBtn.disabled = true;
        submitBtn.textContent = 'Verifying…';

        try {
          const ip = await getUserIP();
          const pinHash = await hashPin(pin);
          const userDoc = await db.collection('authorized_users').doc(email).get();

          if (!userDoc.exists) {
            globalError.textContent = 'Access denied. Email not registered.';
            await logAccess(email, false, ip);
            submitBtn.disabled = false;
            submitBtn.textContent = 'Unlock Portal';
            return;
          }

          const userData = userDoc.data();
          const pinValid = (userData.pin && userData.pin.length === 64)
            ? (pinHash === userData.pin)
            : (userData.pin === pin);

          if (!pinValid) {
            globalError.textContent = 'Incorrect PIN code.';
            await logAccess(email, false, ip);
            submitBtn.disabled = false;
            submitBtn.textContent = 'Unlock Portal';
            return;
          }

          // Successful Auth
          await logAccess(email, true, ip);
          setSession(email);
          gate.classList.add('hidden');
          updateSidebarUserInfo(email);

          // Trigger router to refresh page now that user is logged in
          if (window.Router) {
            window.Router.handleRouting();
          }

        } catch (err) {
          globalError.textContent = 'Connection error. Please try again.';
          console.error('Authentication Error:', err);
          submitBtn.disabled = false;
          submitBtn.textContent = 'Unlock Portal';
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
  };

  // Check if session is already valid on startup
  const session = getStoredSession();
  if (session) {
    const needsVerify = !session.verified || (Date.now() - session.verified) > VERIFY_INTERVAL;
    
    updateSidebarUserInfo(session.email);

    if (needsVerify) {
      // Re-verify with Firestore in the background
      waitForFirebase(function () {
        const db = firebase.firestore();
        db.collection('authorized_users').doc(session.email).get()
          .then(function (doc) {
            if (doc.exists) {
              // Update verified timestamp
              localStorage.setItem(SESSION_KEY, JSON.stringify({
                email: session.email,
                ts: session.ts,
                verified: Date.now()
              }));
            } else {
              // De-authorize
              clearSession();
            }
          })
          .catch(function () {
            // Fail open if internet is flaky to preserve user experience
          });
      });
    }
  }

  // Export sign out globally if needed by other templates
  window.clearSession = clearSession;
})();