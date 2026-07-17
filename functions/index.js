'use strict';

// ═══════════════════════════════════════════════════════════════════════
// grantPortalAccess — the ONLY place that may write to `authorized_users`.
//
// MeritNama has no Firebase Auth; access is a PIN checked against
// `authorized_users` docs, and the Firestore rule for that collection is
// currently `allow create, update: if true` — meaning any client can grant
// itself portal access directly from devtools, bypassing every check the
// UI performs. This function moves the actual write server-side (Admin SDK
// writes bypass security rules) so the rule can be locked down to
// `allow write: if false` once this is deployed and the client is cut over.
//
// There is still no real identity provider, so "proof of identity" is the
// same PIN the user already types to log in — this function just verifies
// it server-side instead of trusting a client-side check that can be
// skipped entirely. See functions/README.md for the deploy + cutover steps.
// ═══════════════════════════════════════════════════════════════════════

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const crypto = require('crypto');

admin.initializeApp();
const db = admin.firestore();

setGlobalOptions({ region: 'us-central1', maxInstances: 10 });

const DEFAULT_INVITE_LIMIT = 2;

function hashPin(pin) {
  return crypto.createHash('sha256').update(String(pin)).digest('hex');
}

function pinMatches(storedPin, candidatePin) {
  if (!storedPin) return false;
  if (storedPin.length === 64) return storedPin === hashPin(candidatePin);
  return storedPin === candidatePin; // legacy plaintext-stored PINs
}

// Verifies {email, pin} against authorized_users. Throws HttpsError if invalid.
// Returns the caller's authorized_users doc data.
async function verifyCaller(email, pin, { requireAdmin = false } = {}) {
  const normalizedEmail = String(email || '').toLowerCase().trim();
  if (!normalizedEmail || !pin) {
    throw new HttpsError('invalid-argument', 'Email and PIN are required.');
  }
  const snap = await db.collection('authorized_users').doc(normalizedEmail).get();
  if (!snap.exists) throw new HttpsError('permission-denied', 'Invalid credentials.');
  const data = snap.data();
  if (!pinMatches(data.pin, pin)) throw new HttpsError('permission-denied', 'Invalid credentials.');
  if (requireAdmin && !data.isAdmin) throw new HttpsError('permission-denied', 'Admin privileges required.');
  return { email: normalizedEmail, data };
}

async function writeAuthorizedUser(email, fields) {
  await db.collection('authorized_users').doc(email).set(fields, { merge: true });
}

async function queueWelcomeEmail({ name, email, pin, level }) {
  await db.collection('mail').add({
    to: [email],
    template: {
      name: 'welcome_access',
      data: {
        name: name || email,
        email,
        pin,
        accessLevel: level,
        portalUrl: 'https://itskaero.github.io/meritnama/',
        logoUrl: 'https://itskaero.github.io/meritnama/logo.png',
      },
    },
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    source: 'admin_portal_access',
  });
}

// ── mode: admin_grant — admin creates/edits a user, optionally approving
// a pending access_requests doc and queuing the welcome email. Mirrors
// admin.html's grantPortalAccess()/submitAddUser()/approveAccessRequest(). ──
async function handleAdminGrant(callerEmail, payload) {
  const email = String(payload.email || '').toLowerCase().trim();
  const name = String(payload.name || email).trim();
  const pin = String(payload.pin || '').trim();
  const level = payload.level || 'Standard User';
  const inviteLimit = Number.isFinite(payload.inviteLimit) ? payload.inviteLimit : DEFAULT_INVITE_LIMIT;
  const applicantId = payload.applicantId ? String(payload.applicantId) : '';
  const sendEmail = payload.sendEmail !== false;
  const approveRequestId = payload.approveRequestId ? String(payload.approveRequestId) : '';

  if (!email) throw new HttpsError('invalid-argument', 'Target email is required.');
  if (!pin || pin.length < 4) throw new HttpsError('invalid-argument', 'PIN must be at least 4 characters.');

  const userData = {
    pin: hashPin(pin),
    isAdmin: level === 'Admin',
    name: name || email,
    inviteLimit,
    addedAt: admin.firestore.FieldValue.serverTimestamp(),
    grantedBy: callerEmail,
  };
  await writeAuthorizedUser(email, userData);

  const profileData = { inviteLimit, email };
  if (name) profileData.name = name;
  if (applicantId) profileData.applicantId = applicantId;
  await db.collection('user_profiles').doc(email).set(profileData, { merge: true });

  if (approveRequestId) {
    await db.collection('access_requests').doc(approveRequestId).set({
      status: 'approved',
      approvedBy: callerEmail,
      approvedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  let emailSent = false;
  let emailError = null;
  if (sendEmail) {
    try {
      await queueWelcomeEmail({ name, email, pin, level });
      emailSent = true;
    } catch (err) {
      emailError = err.message || String(err);
    }
  }

  return { email, pin, emailSent, emailError };
}

// ── mode: peer_invite — any authorized user invites another, within their
// quota. Mirrors candidate.html's submitInvite(). Quota is counted live
// against authorized_users (invitedBy == caller) rather than trusting a
// cached counter, so it can't be inflated by racing writes. ──
async function handlePeerInvite(callerEmail, callerAuthData, payload) {
  const inviteeEmail = String(payload.inviteeEmail || '').toLowerCase().trim();
  const inviteePin = String(payload.inviteePin || '').trim();
  const name = String(payload.name || '').trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteeEmail)) {
    throw new HttpsError('invalid-argument', 'Enter a valid email address.');
  }
  if (!inviteePin || inviteePin.length < 4) {
    throw new HttpsError('invalid-argument', 'PIN must be at least 4 characters.');
  }
  if (inviteeEmail === callerEmail) {
    throw new HttpsError('invalid-argument', 'You cannot invite your own account.');
  }

  const cfgSnap = await db.collection('notifications').doc('access_config').get();
  const cfg = cfgSnap.exists ? cfgSnap.data() : {};
  if (cfg.blockInvites === true) {
    throw new HttpsError('failed-precondition', 'New user invitations are currently disabled by admin.');
  }
  if (cfg.requestAccessEnabled === false) {
    throw new HttpsError('failed-precondition', 'New user access is currently closed by admin.');
  }

  const inviteLimit = Number.isFinite(callerAuthData.inviteLimit) ? callerAuthData.inviteLimit : DEFAULT_INVITE_LIMIT;
  const usedSnap = await db.collection('authorized_users').where('invitedBy', '==', callerEmail).get();
  if (usedSnap.size >= inviteLimit) {
    throw new HttpsError('resource-exhausted', `Invite limit reached (${usedSnap.size}/${inviteLimit}).`);
  }

  const inviteeRef = db.collection('authorized_users').doc(inviteeEmail);
  const inviteeDoc = await inviteeRef.get();
  if (inviteeDoc.exists) throw new HttpsError('already-exists', 'That email already has portal access.');

  await inviteeRef.set({
    pin: hashPin(inviteePin),
    manualInvitePin: inviteePin,
    isAdmin: false,
    name: name || inviteeEmail,
    addedAt: admin.firestore.FieldValue.serverTimestamp(),
    invitedBy: callerEmail,
    invitedAt: admin.firestore.FieldValue.serverTimestamp(),
    inviteSource: 'manual_profile_invite',
    inviteLimit: DEFAULT_INVITE_LIMIT,
  });

  await db.collection('user_profiles').doc(callerEmail).set({
    inviteLimit,
    invitesUsed: usedSnap.size + 1,
    lastInvitedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  return { inviteeEmail, invitesUsed: usedSnap.size + 1, inviteLimit };
}

exports.grantPortalAccess = onCall(async (request) => {
  const { mode, callerEmail, callerPin } = request.data || {};

  if (mode === 'admin_grant') {
    const caller = await verifyCaller(callerEmail, callerPin, { requireAdmin: true });
    return handleAdminGrant(caller.email, request.data);
  }

  if (mode === 'peer_invite') {
    const caller = await verifyCaller(callerEmail, callerPin, { requireAdmin: false });
    return handlePeerInvite(caller.email, caller.data, request.data);
  }

  throw new HttpsError('invalid-argument', `Unknown mode: ${mode}`);
});
