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
        '<div class="auth-tabs" id="authTabs">' +
          '<button type="button" class="auth-tab active" data-auth-tab="login">Sign In</button>' +
          '<button type="button" class="auth-tab" data-auth-tab="request" id="authRequestTab" style="display:none;">Request Access</button>' +
        '</div>' +
        '<div class="auth-panel active" id="authPanelLogin">' +
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
        '</div>' +
        '<div class="auth-panel" id="authPanelRequest">' +
          '<h2>Request Access</h2>' +
          '<p class="auth-subtitle">Induction 21 candidates — verify with portal email &amp; Applicant ID</p>' +
          '<div class="auth-field">' +
            '<label for="reqEmail">Portal Email</label>' +
            '<input type="email" id="reqEmail" placeholder="same as induction portal" autocomplete="email" />' +
          '</div>' +
          '<div class="auth-field">' +
            '<label for="reqApplicantId">Applicant ID</label>' +
            '<input type="text" id="reqApplicantId" placeholder="e.g. 39244" inputmode="numeric" autocomplete="off" />' +
          '</div>' +
          '<div class="auth-candidate-preview" id="reqPreview"></div>' +
          '<div id="reqPaymentWrap"></div>' +
          '<div class="auth-field auth-admin-message">' +
            '<label for="reqAdminMessage">Message to admin <span style="text-transform:none;font-weight:400;">(optional)</span></label>' +
            '<textarea id="reqAdminMessage" maxlength="600" placeholder="Use this for access issues, complaints, or questions. If you paid, put only the payment transaction/reference number in the Transaction Reference field above."></textarea>' +
            '<p class="auth-field-hint">This message is reviewed with your access request. Do not put random text in Transaction Reference.</p>' +
          '</div>' +
          '<button class="auth-btn" id="reqSubmit">Submit Request</button>' +
          '<p class="auth-error" id="reqError"></p>' +
          '<p class="auth-success" id="reqSuccess" style="display:none;"></p>' +
        '</div>' +
        '<p class="auth-footer">Access is invite-only. Approved requests receive credentials by email.</p>' +
        '<p class="auth-link-row"><a href="request-access.html" id="authRequestFullLink" style="display:none;">Open full request page</a><span id="authRequestLinkSep" style="display:none;"> &middot; </span><a href="donate.html">Support MeritNama</a></p>' +
      '</div>';
    document.body.prepend(gate);

    gate.querySelectorAll('.auth-tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        var name = tab.getAttribute('data-auth-tab');
        gate.querySelectorAll('.auth-tab').forEach(function (t) {
          t.classList.toggle('active', t.getAttribute('data-auth-tab') === name);
        });
        gate.querySelectorAll('.auth-panel').forEach(function (p) { p.classList.remove('active'); });
        var panel = document.getElementById(name === 'login' ? 'authPanelLogin' : 'authPanelRequest');
        if (panel) panel.classList.add('active');
      });
    });

    waitForFirebase(function () {
      var db = firebase.firestore();

      var emailInput = document.getElementById('authEmail');
      var pinInput   = document.getElementById('authPin');
      var submitBtn  = document.getElementById('authSubmit');
      var errorEl    = document.getElementById('authError');

      configureRequestAccess(db, gate);

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

  function setRequestAccessVisible(gate, enabled) {
    var tab = document.getElementById('authRequestTab');
    var panel = document.getElementById('authPanelRequest');
    var loginPanel = document.getElementById('authPanelLogin');
    var fullLink = document.getElementById('authRequestFullLink');
    var linkSep = document.getElementById('authRequestLinkSep');
    if (tab) tab.style.display = enabled ? '' : 'none';
    if (fullLink) fullLink.style.display = enabled ? '' : 'none';
    if (linkSep) linkSep.style.display = enabled ? '' : 'none';
    if (!enabled) {
      if (tab) tab.classList.remove('active');
      if (panel) panel.classList.remove('active');
      gate.querySelector('[data-auth-tab="login"]')?.classList.add('active');
      if (loginPanel) loginPanel.classList.add('active');
    }
  }

  function configureRequestAccess(db, gate) {
    if (!window.MNAccessRequest) {
      setRequestAccessVisible(gate, false);
      return;
    }

    var AR = window.MNAccessRequest;
    AR.loadAccessConfig(db).then(function (cfg) {
      var enabled = cfg.requestAccessEnabled !== false;
      setRequestAccessVisible(gate, enabled);
      if (enabled) initRequestPanel(db, gate, cfg);
    }).catch(function () {
      var cfg = AR.DEFAULT_ACCESS_CONFIG || { requestAccessEnabled: true };
      setRequestAccessVisible(gate, cfg.requestAccessEnabled !== false);
      if (cfg.requestAccessEnabled !== false) initRequestPanel(db, gate, cfg);
    });
  }

  function initRequestPanel(db, gate, initialConfig) {
    if (!window.MNAccessRequest) return;

    var AR = window.MNAccessRequest;
    var reqEmail = document.getElementById('reqEmail');
    var reqId    = document.getElementById('reqApplicantId');
    var reqPrev  = document.getElementById('reqPreview');
    var reqPay   = document.getElementById('reqPaymentWrap');
    var reqMsg   = document.getElementById('reqAdminMessage');
    var reqBtn   = document.getElementById('reqSubmit');
    var reqErr   = document.getElementById('reqError');
    var reqOk    = document.getElementById('reqSuccess');
    var accessConfig = null;
    var verifiedCandidate = null;
    var verifyTimer = null;

    function applyAccessConfig(cfg) {
      accessConfig = cfg;
      if (reqPay) reqPay.innerHTML = AR.renderPaymentBlock(cfg, '');
      wireCopyHandlers(gate);
    }

    if (initialConfig) {
      applyAccessConfig(initialConfig);
    } else {
      AR.loadAccessConfig(db).then(applyAccessConfig).catch(function () { /* optional payment block */ });
    }

    function wireCopyHandlers(root) {
      root.querySelectorAll('[data-copy]').forEach(function (el) {
        el.addEventListener('click', function () {
          var text = el.getAttribute('data-copy') || el.textContent;
          navigator.clipboard.writeText(text).catch(function () {});
        });
      });
    }

    async function runVerify() {
      verifiedCandidate = null;
      if (reqPrev) { reqPrev.classList.remove('visible'); reqPrev.textContent = ''; }
      if (!reqEmail.value.trim() || !reqId.value.trim()) return;

      try {
        var result = await AR.verifyCandidate(reqEmail.value, reqId.value);
        if (result.ok) {
          verifiedCandidate = result;
          if (reqPrev) {
            reqPrev.classList.add('visible');
            reqPrev.innerHTML = '\u2713 Matched: <strong>' + escReq(result.nameFull || result.email) + '</strong><br>Applicant ID: <strong>' + escReq(result.applicantId) + '</strong>';
          }
          if (reqPay && accessConfig) {
            reqPay.innerHTML = AR.renderPaymentBlock(accessConfig, result.applicantId);
            wireCopyHandlers(gate);
          }
        }
      } catch (e) { /* silent */ }
    }

    function escReq(s) {
      return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function scheduleVerify() {
      if (verifyTimer) clearTimeout(verifyTimer);
      verifyTimer = setTimeout(runVerify, 400);
    }

    if (reqEmail) reqEmail.addEventListener('input', scheduleVerify);
    if (reqId) reqId.addEventListener('input', scheduleVerify);

    if (reqBtn) {
      reqBtn.addEventListener('click', async function () {
        reqErr.textContent = '';
        if (reqOk) { reqOk.style.display = 'none'; reqOk.textContent = ''; }
        reqBtn.disabled = true;
        reqBtn.textContent = 'Submitting\u2026';

        try {
          var payDeclared = !!document.getElementById('authPayDeclared')?.checked;
          var payAmount = document.getElementById('authPayAmountPKR')?.value || '';
          var payRef = document.getElementById('authPayRef')?.value || '';
          var result = await AR.submitAccessRequest(db, {
            email: reqEmail.value,
            applicantId: reqId.value,
            paymentDeclared: payDeclared,
            paymentAmountPKR: payAmount,
            paymentReference: payRef,
            message: reqMsg?.value || '',
          });

          if (!result.ok) {
            reqErr.textContent = result.error || 'Request failed.';
            return;
          }

          if (reqOk) {
            reqOk.style.display = 'block';
            reqOk.innerHTML = 'Request submitted for <strong>' + escReq(result.email) + '</strong> (ID ' + escReq(result.applicantId) + '). You will receive an email once approved.';
          }
          reqBtn.textContent = 'Submitted';
        } catch (err) {
          reqErr.textContent = 'Could not submit request. Try again.';
          console.error(err);
        } finally {
          if (reqBtn.textContent === 'Submitting\u2026') {
            reqBtn.disabled = false;
            reqBtn.textContent = 'Submit Request';
          }
        }
      });
    }
  }

})();