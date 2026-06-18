'use strict';
// Shared access-request helpers — candidate verification + Firestore config
(function (global) {
  const AUTH_INDEX_PATH = 'data/candidate_auth_index.json';
  const CONFIG_DOC = 'access_config';

  const DEFAULT_ACCESS_CONFIG = {
    requestAccessEnabled: true,
    requestClosedMessage: 'Access requests are currently closed by admin. Please sign in if you already have credentials or check back later.',
    showOnRequestPage: true,
    blockInvites: false,
    paymentOptional: true,
    accessPriceMinPKR: 250,
    accessPriceMaxPKR: 670,
    accessPriceMinUSD: 0.9,
    accessPriceMaxUSD: 2.4,
    accountNumber: '0891-2007-4774',
    raastId: '',
    bankName: 'Mashreq Pakistan',
    showAccountTitle: false,
    paymentNote: 'Optional support contribution. If you pay, paste the actual transaction/reference number from your banking app below. Use Message to admin for access questions or complaints.',
  };

  let _authIndex = null;
  let _accessConfig = null;

  async function hashPin(pin) {
    var encoder = new TextEncoder();
    var hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(String(pin).trim()));
    return Array.from(new Uint8Array(hashBuffer))
      .map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  function normalizeIndexEntry(raw) {
    if (!raw) return null;
    if (typeof raw === 'string') return { pinHash: raw, nameFull: null };
    return {
      pinHash: raw.pinHash || null,
      nameFull: raw.nameFull || null,
    };
  }

  async function loadAuthIndex() {
    if (_authIndex) return _authIndex;
    var res = await fetch(AUTH_INDEX_PATH);
    if (!res.ok) throw new Error('Candidate lookup unavailable.');
    _authIndex = await res.json();
    return _authIndex;
  }

  async function loadAccessConfig(db) {
    if (_accessConfig) return _accessConfig;
    try {
      var snap = await db.collection('notifications').doc(CONFIG_DOC).get();
      if (snap.exists) {
        _accessConfig = normalizePaymentConfig(Object.assign({}, DEFAULT_ACCESS_CONFIG, snap.data()));
        return _accessConfig;
      }
    } catch (e) { /* use defaults */ }
    _accessConfig = Object.assign({}, DEFAULT_ACCESS_CONFIG);
    return _accessConfig;
  }

  function invalidateAccessConfigCache() {
    _accessConfig = null;
  }

  async function verifyCandidate(email, applicantId) {
    var emailKey = String(email || '').trim().toLowerCase();
    var idStr = String(applicantId || '').trim();
    if (!emailKey || !idStr) {
      return { ok: false, error: 'Enter both email and Applicant ID.' };
    }
    var index = await loadAuthIndex();
    var entry = normalizeIndexEntry((index.byEmail || {})[emailKey]);
    if (!entry || !entry.pinHash) {
      return { ok: false, error: 'Email not found in Induction 21 candidate records.' };
    }
    var pinHash = await hashPin(idStr);
    if (pinHash !== entry.pinHash) {
      return { ok: false, error: 'Applicant ID does not match this email.' };
    }
    return {
      ok: true,
      email: emailKey,
      applicantId: idStr,
      nameFull: entry.nameFull || null,
    };
  }

  async function submitAccessRequest(db, payload) {
    invalidateAccessConfigCache();
    var config = await loadAccessConfig(db);
    if (config && config.requestAccessEnabled === false) {
      return {
        ok: false,
        error: config.requestClosedMessage || DEFAULT_ACCESS_CONFIG.requestClosedMessage,
      };
    }

    var verified = await verifyCandidate(payload.email, payload.applicantId);
    if (!verified.ok) return verified;

    var email = verified.email;

    // Block all new invitations when toggled
    if (config.blockInvites === true) {
      return { ok: false, error: 'New user invitations are currently disabled.' };
    }

    // Enforce payment when flagged as required
    var minPkr = config.accessPriceMinPKR || DEFAULT_ACCESS_CONFIG.accessPriceMinPKR;
    if (config.paymentOptional === false) {
      payload.paymentDeclared = true;
      var amount = normalizePaymentAmount(payload.paymentAmountPKR);
      if (!amount || amount < minPkr) {
        return { ok: false, error: 'Minimum payment is PKR ' + minPkr.toLocaleString() + '. Please enter the amount you are sending.' };
      }
    }

    var existingUser = await db.collection('authorized_users').doc(email).get();
    if (existingUser.exists) {
      return { ok: false, error: 'This email already has portal access. Sign in instead.' };
    }

    var existingReq = await db.collection('access_requests').doc(email).get();
    if (existingReq.exists) {
      var status = existingReq.data().status;
      if (status === 'pending') {
        return { ok: false, error: 'A request is already pending for this email.' };
      }
      if (status === 'approved') {
        return { ok: false, error: 'Access was already approved for this email.' };
      }
    }

    await db.collection('access_requests').doc(email).set({
      email: email,
      applicantId: verified.applicantId,
      nameFull: verified.nameFull || payload.name || email,
      status: 'pending',
      paymentDeclared: !!payload.paymentDeclared,
      paymentAmountPKR: normalizePaymentAmount(payload.paymentAmountPKR),
      paymentReference: (payload.paymentReference || '').trim(),
      message: (payload.message || '').trim(),
      requestedAt: firebase.firestore.FieldValue.serverTimestamp(),
      reviewedAt: null,
      reviewedBy: null,
      approvedPin: null,
      emailSent: false,
      emailError: null,
      userAgent: navigator.userAgent.substring(0, 200),
    }, { merge: false });

    // Auto-send payment_due email when payment is required
    if (config.paymentOptional === false) {
      try {
        await sendPaymentDueEmail(db, verified.nameFull || payload.name || email, email, verified.applicantId);
      } catch (_) { /* non-blocking */ }
    }

    return { ok: true, email: email, applicantId: verified.applicantId, nameFull: verified.nameFull };
  }

  function normalizePaymentAmount(value) {
    var raw = String(value || '').replace(/,/g, '').trim();
    if (!raw) return null;
    var amount = Number(raw);
    if (!Number.isFinite(amount) || amount < 0) return null;
    return Math.round(amount * 100) / 100;
  }

  function formatAccountNumber(num) {
    return String(num || '').replace(/\s/g, '');
  }

  function normalizePaymentConfig(config) {
    var c = Object.assign({}, config);
    var legacyMaxPkr = Number(c.accessPricePKR) || 0;
    var minPkr = Number(c.accessPriceMinPKR);
    var maxPkr = Number(c.accessPriceMaxPKR);
    if (!minPkr && !maxPkr && legacyMaxPkr) {
      minPkr = 250;
      maxPkr = legacyMaxPkr;
    }
    if (!minPkr) minPkr = 250;
    if (!maxPkr) maxPkr = 670;
    if (minPkr > maxPkr) { var swap = minPkr; minPkr = maxPkr; maxPkr = swap; }

    var legacyMaxUsd = Number(c.accessPriceUSD) || 0;
    var minUsd = Number(c.accessPriceMinUSD);
    var maxUsd = Number(c.accessPriceMaxUSD);
    if (!minUsd && !maxUsd && legacyMaxUsd) {
      minUsd = Math.round((legacyMaxUsd * (minPkr / maxPkr)) * 100) / 100;
      maxUsd = legacyMaxUsd;
    }
    if (!minUsd) minUsd = 0.9;
    if (!maxUsd) maxUsd = 2.4;
    if (minUsd > maxUsd) { var swapU = minUsd; minUsd = maxUsd; maxUsd = swapU; }

    c.accessPriceMinPKR = minPkr;
    c.accessPriceMaxPKR = maxPkr;
    c.accessPriceMinUSD = minUsd;
    c.accessPriceMaxUSD = maxUsd;
    return c;
  }

  function formatPriceRange(config) {
    var cfg = normalizePaymentConfig(config || {});
    var minPkr = cfg.accessPriceMinPKR;
    var maxPkr = cfg.accessPriceMaxPKR;
    var minUsd = cfg.accessPriceMinUSD;
    var maxUsd = cfg.accessPriceMaxUSD;
    var pkrPart;
    if (minPkr === maxPkr) {
      pkrPart = 'PKR ' + minPkr.toLocaleString();
    } else {
      pkrPart = 'PKR ' + minPkr.toLocaleString() + '\u2013' + maxPkr.toLocaleString();
    }
    var usdPart;
    if (minUsd === maxUsd) {
      usdPart = '$' + minUsd.toFixed(2);
    } else {
      usdPart = '$' + minUsd.toFixed(2) + '\u2013$' + maxUsd.toFixed(2);
    }
    return { pkrPart: pkrPart, usdPart: usdPart, minPkr: minPkr, maxPkr: maxPkr };
  }

  function renderPaymentBlock(config, applicantId) {
    if (!config || !config.showOnRequestPage) return '';
    var range = formatPriceRange(config);
    var isRequired = config.paymentOptional === false;
    var badge = isRequired
      ? '<span class="auth-pay-badge required">Required</span>'
      : '<span class="auth-pay-badge">Optional</span>';
    var priceHtml = '';
    if (range.minPkr || range.maxPkr) {
      priceHtml = ' <span class="auth-pay-range">' + range.pkrPart + ' <span class="auth-pay-usd">(' + range.usdPart + ' USD)</span></span>';
    }
    var country = config.country || 'PK';
    var bankLine = '';
    if (config.bankName) {
      bankLine = ' &middot; <span class="auth-pay-bank">' + escHtml(config.bankName) + '</span>';
    }
    return (
      '<div class="auth-pay-box">' +
        '<div class="auth-pay-head">' + badge + ' Payment' + priceHtml + '</div>' +
        '<div class="auth-pay-account">' +
          '<span class="auth-pay-label">Account</span>' +
          '<code class="auth-pay-val" data-copy="' + escAttr(formatAccountNumber(config.accountNumber)) + '">' + escHtml(config.accountNumber || '—') + '</code>' +
          bankLine +
        '</div>' +
        (isRequired ? '' : '<label class="auth-pay-check">' +
          '<input type="checkbox" id="authPayDeclared" /> I want to contribute' +
        '</label>') +
        '<div class="auth-pay-details">' +
          '<input type="number" id="authPayAmountPKR" class="auth-pay-input" placeholder="Amount PKR" min="0" step="1" inputmode="numeric"' + (isRequired ? ' required' : '') + ' />' +
          '<input type="text" id="authPayRef" class="auth-pay-input" placeholder="Transaction ref (optional)" maxlength="120" />' +
        '</div>' +
      '</div>'
    );
  }

  function escHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function escAttr(s) {
    return escHtml(s).replace(/'/g, '&#39;');
  }

  async function sendPaymentDueEmail(dbInstance, name, email, applicantId) {
    try {
      await dbInstance.collection('mail').add({
        to: [email],
        template: {
          name: 'payment_due',
          data: {
            name: name || email,
            email: email,
            applicantId: applicantId || '',
            portalUrl: 'https://itskaero.github.io/meritnama/',
            logoUrl: 'https://itskaero.github.io/meritnama/logo.png',
          },
        },
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        source: 'payment_due_auto',
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  async function submitPaymentProof(dbInstance, email, photoBase64, textMessage) {
    var e = String(email || '').trim().toLowerCase();
    if (!e) return { ok: false, error: 'Email is required.' };
    var existingReq = await dbInstance.collection('access_requests').doc(e).get();
    if (!existingReq.exists) {
      return { ok: false, error: 'No access request found for this email.' };
    }
    var existingData = existingReq.data();
    if (existingData.status === 'approved' && !existingData.paymentVerified) {
      // Update the existing request doc with proof data
      await dbInstance.collection('access_requests').doc(e).update({
        paymentProof: {
          photoBase64: photoBase64 || null,
          textMessage: String(textMessage || '').trim(),
          submittedAt: firebase.firestore.FieldValue.serverTimestamp(),
        },
        paymentProofSubmitted: true,
        paymentProofSubmittedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      return { ok: true, email: e };
    }
    if (existingData.status === 'pending') {
      await dbInstance.collection('access_requests').doc(e).update({
        paymentProof: {
          photoBase64: photoBase64 || null,
          textMessage: String(textMessage || '').trim(),
          submittedAt: firebase.firestore.FieldValue.serverTimestamp(),
        },
        paymentProofSubmitted: true,
        paymentProofSubmittedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      return { ok: true, email: e };
    }
    if (existingData.paymentVerified) {
      return { ok: false, error: 'Payment already verified for this email.' };
    }
    return { ok: false, error: 'Cannot submit payment proof for this request.' };
  }

  global.MNAccessRequest = {
    DEFAULT_ACCESS_CONFIG: DEFAULT_ACCESS_CONFIG,
    CONFIG_DOC: CONFIG_DOC,
    hashPin: hashPin,
    loadAuthIndex: loadAuthIndex,
    loadAccessConfig: loadAccessConfig,
    invalidateAccessConfigCache: invalidateAccessConfigCache,
    verifyCandidate: verifyCandidate,
    submitAccessRequest: submitAccessRequest,
    normalizePaymentAmount: normalizePaymentAmount,
    renderPaymentBlock: renderPaymentBlock,
    formatPriceRange: formatPriceRange,
    normalizePaymentConfig: normalizePaymentConfig,
    formatAccountNumber: formatAccountNumber,
    sendPaymentDueEmail: sendPaymentDueEmail,
    submitPaymentProof: submitPaymentProof,
  };
})(window);
