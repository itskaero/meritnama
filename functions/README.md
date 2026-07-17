# grantPortalAccess — closing the `authorized_users` write hole

## The problem

`firestore.rules` currently has:

```
match /authorized_users/{email} {
  allow read: if true;
  allow create, update: if true;  // <- anyone can write here directly
  allow delete: if true;
}
```

MeritNama has no Firebase Auth, so there is no `request.auth` for rules to check.
Every write to `authorized_users` — admin grants, request approvals, peer invites —
is currently only "gated" by client-side JavaScript in `admin.html` / `candidate.html`.
Anyone can open devtools on the live site and run:

```js
firebase.firestore().collection('authorized_users').doc('me@x.com')
  .set({ pin: '<any-sha256-hex>', isAdmin: false });
```

...and grant themselves full portal access. No PIN review, no payment, no admin.

## The fix

This function (`grantPortalAccess`) moves the actual write server-side. Cloud
Functions using the Admin SDK bypass Firestore rules entirely, so once the
client is cut over to call this function instead of writing directly, the
rule can be locked to `allow write: if false` and the client-side bypass
above stops working completely.

It does **not** change the PIN-based login UX at all — users still type an
email + PIN exactly as today. The only difference is *where* that PIN gets
checked: today the check runs in the browser (skippable via devtools);
after cutover it runs in the function (not skippable, since the caller
never sees whether their PIN matched — the function just accepts or rejects).

## What's inside

One callable function, two modes:

- `mode: 'admin_grant'` — used by admin.html's "Grant Access" modal and by
  approving a pending `access_requests` doc. Requires the caller to pass
  their own `callerEmail`/`callerPin`; the function verifies server-side
  that this really is an `authorized_users` doc with `isAdmin: true` before
  writing anything.
- `mode: 'peer_invite'` — used by candidate.html's "Invite a colleague"
  panel. Requires the caller's own `callerEmail`/`callerPin`; the function
  verifies they're a real authorized user, checks their invite quota by
  *counting* `authorized_users` docs with `invitedBy == callerEmail` (not
  trusting a cached counter), and checks the same `blockInvites` /
  `requestAccessEnabled` config the client already checks.

## Deploy steps (do this yourself — I won't run `firebase deploy` on your live project)

```bash
cd functions
npm install
firebase login              # if not already
firebase use mortality-review
firebase deploy --only functions
```

This only *adds* a function — it does not touch hosting, Firestore rules, or
any existing data. Nothing on the live site changes yet.

## Verify it works before touching anything else

From the Firebase Console → Functions → `grantPortalAccess` → Testing tab
(easiest — no SDK setup needed), or from browser devtools on any live
MeritNama page: none of them currently load the Firebase **Functions**
client SDK (only `app`/`firestore`/`storage`/`messaging`), so
`firebase.functions()` will throw `firebase.functions is not a function`
until you load it. Paste this whole block into devtools console — it loads
the missing SDK piece first, then calls the function:

```js
var s = document.createElement('script');
s.src = 'https://www.gstatic.com/firebasejs/9.23.0/firebase-functions-compat.js';
s.onload = function () {
  firebase.functions().httpsCallable('grantPortalAccess')({
    mode: 'admin_grant',
    callerEmail: '<a real admin email>',
    callerPin: '<that admin\'s real PIN>',
    email: 'smoke-test@example.com',
    pin: '1234',
    level: 'Standard User',
    sendEmail: false,
  }).then(r => console.log(r.data)).catch(e => console.error(e.code, e.message));
};
document.head.appendChild(s);
```

Confirm: (1) it succeeds and a `smoke-test@example.com` doc appears in
`authorized_users`, (2) calling it again with a **wrong** `callerPin`
returns `permission-denied` and writes nothing. Then delete the test doc
from the admin dashboard's Users tab.

## Cutover (only after the above is verified) — not yet applied

Once you've confirmed the function works, tell me and I'll apply these in
one pass so nothing is broken in between:

1. **`admin.html`** — `grantPortalAccess()` (~line 2601), the caller in
   `submitAddUser()`, and `approveAccessRequest()` switch from
   `db.collection('authorized_users').doc(email).set(...)` to
   `firebase.functions().httpsCallable('grantPortalAccess')({ mode: 'admin_grant', callerEmail: getAdminSessionEmail(), callerPin: <cached admin PIN>, ... })`.
   This needs the admin's PIN available after login without retyping it —
   I'll stash it in `sessionStorage` (not `localStorage`, so it clears on
   tab close) right after `verifyAdmin()` succeeds in the login handler.

2. **`candidate.html`** — `submitInvite()` (~line 2730) switches its direct
   `inviteeAuthRef.set(inviteData)` to the same callable with
   `mode: 'peer_invite'`, similarly using a PIN stashed at login in
   `auth.js`'s `handleAuth()`.

3. **`firestore.rules`** — `authorized_users` becomes:
   ```
   match /authorized_users/{email} {
     allow read: if true;
     allow write: if false;   // all writes go through grantPortalAccess now
   }
   ```
   Deploy with `firebase deploy --only firestore:rules`.

Step 3 is the one that actually closes the hole — steps 1–2 just make the
UI use the safe path. Do 1–2 first, confirm grant/approve/invite still work
end-to-end on the live site, *then* do 3. Deploying 3 before the client is
cut over will break admin grant/approve/invite immediately.

## Rollback

If anything breaks after cutover: revert `firestore.rules` to
`allow create, update: if true` and redeploy rules — that instantly restores
the pre-fix (insecure but working) behavior while you debug, with zero
client-side changes needed.
