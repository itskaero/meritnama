'use strict';
// Shared access-request helpers — candidate verification + Firestore config
(function (global) {
  const AUTH_INDEX_PATH = 'data/candidate_auth_index.json';
  const CONFIG_DOC = 'access_config';

  const DEFAULT_ACCESS_CONFIG = {
    showOnRequestPage: true,
    paymentOptional: true,
    accessPriceMinPKR: 250,
    accessPriceMaxPKR: 670,
    accessPriceMinUSD: 0.9,
    accessPriceMaxUSD: 2.4,
    accountNumber: '0891-2007-4774',
    raastId: '089120074774',
    bankName: 'Mashreq Pakistan',
    showAccountTitle: false,
    paymentNote: 'Optional — minimum PKR 250. Include your Applicant ID in the transfer reference.',
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
    var verified = await verifyCandidate(payload.email, payload.applicantId);
    if (!verified.ok) return verified;

    var email = verified.email;

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

    return { ok: true, email: email, applicantId: verified.applicantId, nameFull: verified.nameFull };
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
    var priceLine = '';
    var range = formatPriceRange(config);
    if (range.minPkr || range.maxPkr) {
      priceLine = '<p class="auth-pay-price">Suggested contribution: <strong>' + range.pkrPart + '</strong> <span class="auth-pay-usd">(≈ ' + range.usdPart + ' USD)</span></p>' +
        '<p class="auth-pay-min">Minimum <strong>PKR ' + range.minPkr.toLocaleString() + '</strong> — pay any amount in this range.</p>';
    }
    var optional = config.paymentOptional
      ? '<span class="auth-pay-badge">Optional</span>'
      : '<span class="auth-pay-badge required">Required before approval</span>';
    var refHint = applicantId
      ? 'Use reference: <code>ID ' + escHtml(applicantId) + '</code>'
      : 'Include your Applicant ID in the reference.';
    return (
      '<div class="auth-pay-box">' +
        '<div class="auth-pay-head">' + optional + ' Support / access fee</div>' +
        priceLine +
        '<p class="auth-pay-note">' + escHtml(config.paymentNote || '') + '</p>' +
        '<div class="auth-pay-row"><span>Account</span><code class="auth-pay-val" data-copy="' + escAttr(formatAccountNumber(config.accountNumber)) + '">' + escHtml(config.accountNumber || '—') + '</code></div>' +
        (config.raastId ? '<div class="auth-pay-row"><span>Raast</span><code class="auth-pay-val" data-copy="' + escAttr(formatAccountNumber(config.raastId)) + '">' + escHtml(config.raastId) + '</code></div>' : '') +
        (config.bankName ? '<div class="auth-pay-row"><span>Bank</span><span>' + escHtml(config.bankName) + '</span></div>' : '') +
        '<p class="auth-pay-ref">' + refHint + '</p>' +
        '<label class="auth-pay-check"><input type="checkbox" id="authPayDeclared" /> I have sent payment (or will send soon)</label>' +
        '<input type="text" id="authPayRef" class="auth-pay-ref-input" placeholder="Transaction reference (optional)" maxlength="120" />' +
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

  global.MNAccessRequest = {
    DEFAULT_ACCESS_CONFIG: DEFAULT_ACCESS_CONFIG,
    CONFIG_DOC: CONFIG_DOC,
    hashPin: hashPin,
    loadAuthIndex: loadAuthIndex,
    loadAccessConfig: loadAccessConfig,
    invalidateAccessConfigCache: invalidateAccessConfigCache,
    verifyCandidate: verifyCandidate,
    submitAccessRequest: submitAccessRequest,
    renderPaymentBlock: renderPaymentBlock,
    formatPriceRange: formatPriceRange,
    normalizePaymentConfig: normalizePaymentConfig,
    formatAccountNumber: formatAccountNumber,
  };
})(window);
