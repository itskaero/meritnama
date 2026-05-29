'use strict';
// ═══════════════════════════════════════════════════════
// AUTH GATE — Firebase PIN-per-email authentication
// Session is verified against Firestore on resume,
// so forged localStorage entries are rejected.
// ═══════════════════════════════════════════════════════

// Apply saved background theme before anything renders
(function () {
  var BG_THEMES = ['bg-default','bg-grid','bg-aurora','bg-dots','bg-lines','bg-void','bg-rose','bg-northern','bg-nebula','bg-solar','bg-dusk','bg-midnight'];
  var saved = localStorage.getItem('mn_bg_theme') || 'bg-default';
  if (BG_THEMES.indexOf(saved) !== -1) document.body.classList.add(saved);
  else document.body.classList.add('bg-default');
})();

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

  const BG_KEY = 'mn_bg_theme';
  const BG_THEMES = [
    { id: 'bg-default', name: 'Ambiance',
      style: 'background:#0d1626;background-image:radial-gradient(ellipse at 25% 35%,rgba(77,184,217,.25) 0%,transparent 55%),radial-gradient(ellipse at 75% 65%,rgba(124,101,196,.2) 0%,transparent 55%)' },
    { id: 'bg-grid', name: 'Grid',
      style: 'background-color:#0d1626;background-image:linear-gradient(rgba(77,184,217,.2) 1px,transparent 1px),linear-gradient(90deg,rgba(77,184,217,.2) 1px,transparent 1px);background-size:10px 10px' },
    { id: 'bg-aurora', name: 'Aurora',
      style: 'background:radial-gradient(ellipse at 20% 50%,rgba(77,184,217,.45) 0%,transparent 55%),radial-gradient(ellipse at 80% 30%,rgba(124,101,196,.45) 0%,transparent 55%),radial-gradient(ellipse at 50% 90%,rgba(62,207,142,.3) 0%,transparent 50%),#080d1a' },
    { id: 'bg-dots', name: 'Dots',
      style: 'background-color:#0d1626;background-image:radial-gradient(circle,rgba(77,184,217,.45) 1px,transparent 1px);background-size:8px 8px' },
    { id: 'bg-lines', name: 'Lines',
      style: 'background-color:#0d1626;background-image:repeating-linear-gradient(45deg,transparent,transparent 5px,rgba(77,184,217,.2) 5px,rgba(77,184,217,.2) 6px)' },
    { id: 'bg-void', name: 'Void',
      style: 'background:#070b14' },
    { id: 'bg-rose', name: 'Rose',
      style: 'background:#0e0a1a;background-image:radial-gradient(ellipse at 10% 30%,rgba(212,79,126,.55) 0%,transparent 55%),radial-gradient(ellipse at 90% 20%,rgba(180,60,220,.5) 0%,transparent 55%),radial-gradient(ellipse at 50% 85%,rgba(232,100,39,.35) 0%,transparent 50%)' },
    { id: 'bg-northern', name: 'Northern',
      style: 'background:#061410;background-image:radial-gradient(ellipse at 10% 35%,rgba(62,207,142,.55) 0%,transparent 55%),radial-gradient(ellipse at 88% 22%,rgba(77,184,217,.45) 0%,transparent 55%),radial-gradient(ellipse at 50% 80%,rgba(62,207,142,.35) 0%,transparent 50%)' },
    { id: 'bg-nebula', name: 'Nebula',
      style: 'background:#09061a;background-image:radial-gradient(ellipse at 8% 20%,rgba(124,101,196,.6) 0%,transparent 55%),radial-gradient(ellipse at 92% 30%,rgba(212,79,126,.5) 0%,transparent 55%),radial-gradient(ellipse at 50% 80%,rgba(77,184,217,.35) 0%,transparent 50%)' },
    { id: 'bg-solar', name: 'Solar',
      style: 'background:#0f0c07;background-image:radial-gradient(ellipse at 8% 25%,rgba(232,166,39,.55) 0%,transparent 55%),radial-gradient(ellipse at 92% 18%,rgba(210,110,30,.5) 0%,transparent 55%),radial-gradient(ellipse at 50% 85%,rgba(200,60,40,.3) 0%,transparent 50%)' },
    { id: 'bg-dusk', name: 'Dusk',
      style: 'background:#0c0818;background-image:radial-gradient(ellipse at 50% 100%,rgba(212,79,126,.5) 0%,transparent 55%),radial-gradient(ellipse at 5% 30%,rgba(124,101,196,.55) 0%,transparent 55%),radial-gradient(ellipse at 95% 25%,rgba(77,184,217,.4) 0%,transparent 55%)' },
    { id: 'bg-midnight', name: 'Midnight',
      style: 'background:#050e1f;background-image:radial-gradient(ellipse at 0% 50%,rgba(77,184,217,.5) 0%,transparent 55%),radial-gradient(ellipse at 100% 45%,rgba(130,190,255,.45) 0%,transparent 55%),radial-gradient(ellipse at 50% 95%,rgba(77,184,217,.3) 0%,transparent 50%)' }
  ];

  const storedSession = getStoredSession();

  if (storedSession) {
    // Session found locally. Determine if we need to re-verify with Firestore.
    const needsVerify = !storedSession.verified ||
                        (Date.now() - storedSession.verified) > VERIFY_INTERVAL;

    if (!needsVerify) {
      // Recent Firestore check — trust the cache and unlock immediately
      document.body.classList.remove('auth-locked');
      injectProfileBtn(storedSession.email);
      injectBgPicker();
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
            injectProfileBtn(storedSession.email);
            injectBgPicker();
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
          injectProfileBtn(storedSession.email);
          injectBgPicker();
        });
    });
    return;
  }

  // ── No valid session ─────────────────────────────────
  showAuthGate();

  // ────────────────────────────────────────────────────
  function injectProfileBtn(email) {
    if (document.getElementById('profileNavBtn')) return;
    var initial = email ? email.charAt(0).toUpperCase() : '?';
    var savedPic = localStorage.getItem('mn_profile_pic') || '';
    var avatarHtml = savedPic
      ? '<img src="' + savedPic + '" class="profile-nav-avatar-img" alt="" />'
      : initial;
    var btn = document.createElement('a');
    btn.id = 'profileNavBtn';
    btn.href = 'candidate.html';
    btn.title = 'My Profile \u2014 ' + email;
    btn.innerHTML =
      '<span class="profile-nav-avatar">' + avatarHtml + '</span>' +
      '<span class="profile-nav-label">My Profile</span>';
    var headerMeta = document.getElementById('headerMeta');
    if (headerMeta) {
      headerMeta.insertBefore(btn, headerMeta.firstChild);
    } else {
      btn.classList.add('profile-nav-floating');
      document.body.appendChild(btn);
    }
  }

  function injectBgPicker() {
    if (document.getElementById('bgPickerWrap')) return;

    var current = localStorage.getItem(BG_KEY) || 'bg-default';

    var swatchHtml = BG_THEMES.map(function (t) {
      return '<div class="bp-swatch' + (t.id === current ? ' active' : '') +
        '" data-bg="' + t.id + '">' +
        '<div class="bp-swatch-preview" style="' + t.style + '"></div>' +
        '<span class="bp-swatch-name">' + t.name + '</span>' +
        '</div>';
    }).join('');

    var wrap = document.createElement('div');
    wrap.id = 'bgPickerWrap';
    wrap.innerHTML =
      '<button id="bgPickerToggle" title="Change background theme" aria-label="Background theme">' +
        '&#127912;' +
      '</button>' +
      '<div id="bgPickerPanel">' +
        '<span class="bp-label">Background</span>' +
        '<div class="bp-swatches">' + swatchHtml + '</div>' +
      '</div>';
    document.body.appendChild(wrap);

    var toggle = document.getElementById('bgPickerToggle');
    var panel  = document.getElementById('bgPickerPanel');

    toggle.addEventListener('click', function (e) {
      e.stopPropagation();
      panel.classList.toggle('open');
    });
    document.addEventListener('click', function (e) {
      if (!wrap.contains(e.target)) panel.classList.remove('open');
    });

    wrap.querySelectorAll('.bp-swatch').forEach(function (sw) {
      sw.addEventListener('click', function () {
        var bgId = sw.getAttribute('data-bg');
        BG_THEMES.forEach(function (t) { document.body.classList.remove(t.id); });
        document.body.classList.add(bgId);
        localStorage.setItem(BG_KEY, bgId);
        wrap.querySelectorAll('.bp-swatch').forEach(function (s) {
          s.classList.toggle('active', s.getAttribute('data-bg') === bgId);
        });
        panel.classList.remove('open');
      });
    });
  }

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
          injectProfileBtn(email);
          injectBgPicker();

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