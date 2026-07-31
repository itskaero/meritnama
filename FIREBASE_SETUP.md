# Firebase Authentication Setup Guide

## Overview

MeritNama uses Firebase Firestore for:
- **PIN-per-email authentication** — No registration/login flow; you add users directly in Firebase Console
- **Access logging** — Every access attempt (success/fail) is logged with IP, timestamp, user agent
- **Admin dashboard** — View all logs at `/admin.html`

---

## 1. Create Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project (or use existing)
3. Enable **Firestore Database** (start in production mode)

---

## 2. Configure Firebase

1. Go to Project Settings → General → Your apps → Web app
2. Copy the config object
3. Paste values into `firebase-config.js`:

```javascript
const firebaseConfig = {
  apiKey: "your-api-key",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123:web:abc123"
};
```

### Optional: Generate config from GitHub Secrets

This repository includes:
- `firebase-config.template.js`
- `.github/workflows/render-firebase-config.yml`

To use the workflow, add these repository secrets:
- `FIREBASE_API_KEY`
- `FIREBASE_AUTH_DOMAIN`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_STORAGE_BUCKET`
- `FIREBASE_MESSAGING_SENDER_ID`
- `FIREBASE_APP_ID`

After adding the secrets, every push to `main` deploys GitHub Pages with a rendered `firebase-config.js`.  
You can also run it manually from **Actions → Render Firebase Config → Run workflow**.

---

## 3. Set Up Firestore Collections

### `authorized_users` Collection

Each document ID = email address (lowercase). Fields:

| Field     | Type    | Description                           |
|-----------|---------|---------------------------------------|
| `pin`     | string  | Plain text PIN or SHA-256 hash of PIN |
| `name`    | string  | (Optional) User's name                |
| `isAdmin` | boolean | Set `true` for admin dashboard access |

**Example document:**
- Document ID: `user@example.com`
- Fields:
  - `pin`: `"123456"` (plain) or SHA-256 hash
  - `name`: `"Dr. Ahmed"`
  - `isAdmin`: `false`

### To add a user:
1. Go to Firebase Console → Firestore
2. Create collection `authorized_users` (if not exists)
3. Add document with ID = email address
4. Add `pin` field with their PIN value

---

## 4. Deploy Security Rules

1. Go to Firebase Console → Firestore → Rules
2. Copy contents of `firestore.rules` and paste
3. Click **Publish**

---

## 5. Set Up Portal Access Emails

MeritNama sends portal access emails through the Firebase **Trigger Email from Firestore** extension. The admin dashboard writes a document to the `mail` collection with this shape:

```javascript
{
  to: ["user@example.com"],
  template: {
    name: "welcome_access",
    data: {
      name: "Dr Ahmed",
      email: "user@example.com",
      pin: "123456",
      accessLevel: "Standard User",
      portalUrl: "https://itskaero.github.io/meritnama/",
      logoUrl: "https://itskaero.github.io/meritnama/logo.svg"
    }
  },
  createdAt: serverTimestamp(),
  source: "admin_portal_access"
}
```

### Install the extension

1. Firebase Console → Extensions → **Trigger Email from Firestore**
2. Use:
   - Email documents collection: `mail`
   - Templates collection: `email_templates`
   - Default FROM email/name: your verified sender, for example `MeritNama <namamerit@gmail.com>`
3. Configure SMTP credentials from your mail provider.
   - For Gmail, use a Google **App Password** if available; do not use the normal Gmail account password.
   - If Gmail App Passwords are unavailable, use a transactional provider such as SendGrid, Mailgun, Postmark, or Mailtrap.

### Create the welcome template

Create this Firestore document:

- Collection: `email_templates`
- Document ID: `welcome_access`

Fields:

- `subject`:

```text
MeritNama - Your Portal Access
```

- `html`:

```html
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>MeritNama Portal Access</title></head>
<body style="margin:0;padding:0;background-color:#f4f7fb;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f7fb;padding:40px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
      <tr>
        <td align="center" style="background:linear-gradient(135deg,#0f172a,#1e293b);padding:40px 30px;">
          <img src="{{logoUrl}}" alt="MeritNama" style="max-width:170px;height:auto;margin-bottom:20px;" />
          <h1 style="color:#ffffff;margin:0;font-size:28px;font-weight:700;letter-spacing:0.5px;">Access Granted</h1>
          <p style="color:#cbd5e1;margin-top:10px;font-size:15px;line-height:24px;">Your MeritNama portal access has been successfully activated.</p>
        </td>
      </tr>
      <tr>
        <td style="padding:40px 35px;color:#334155;">
          <p style="font-size:16px;line-height:28px;margin-top:0;">Dear <strong>{{name}}</strong>,</p>
          <p style="font-size:15px;line-height:28px;color:#475569;">We are pleased to inform you that your access to the <strong>MeritNama Portal</strong> has been approved.</p>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:30px 0;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">
            <tr><td style="padding:24px;">
              <p style="margin:0 0 14px;font-size:14px;color:#64748b;text-transform:uppercase;letter-spacing:0.8px;">Your Credentials</p>
              <p style="margin:8px 0;font-size:15px;color:#0f172a;"><strong>Email:</strong> {{email}}</p>
              <p style="margin:8px 0;font-size:15px;color:#0f172a;"><strong>Access PIN:</strong>
                <code style="background:#f1f5f9;padding:2px 10px;border-radius:4px;font-family:monospace;font-size:15px;letter-spacing:2px;">{{pin}}</code></p>
              <p style="margin:8px 0;font-size:15px;color:#0f172a;"><strong>Access Level:</strong> {{accessLevel}}</p>
              <p style="margin:8px 0;font-size:15px;color:#0f172a;"><strong>Portal URL:</strong>
                <a href="{{portalUrl}}" style="color:#2563eb;text-decoration:none;">{{portalUrl}}</a></p>
              <p style="margin:16px 0 0;font-size:13px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:12px;">
                &#128274; Keep your PIN confidential. Do not share your credentials with anyone.</p>
            </td></tr>
          </table>
          <div style="text-align:center;margin:35px 0;">
            <a href="{{portalUrl}}" style="background:#2563eb;color:#ffffff;text-decoration:none;padding:15px 34px;border-radius:10px;display:inline-block;font-size:15px;font-weight:600;letter-spacing:0.3px;">Access Portal</a>
          </div>
          <p style="font-size:15px;line-height:28px;color:#475569;">For security, please keep your login credentials confidential and do not share access with unauthorized individuals.</p>
          <p style="font-size:15px;line-height:28px;color:#475569;margin-bottom:0;">If you encounter any issues accessing the portal, feel free to contact the admin.</p>
        </td>
      </tr>
      <tr>
        <td style="background:#f8fafc;padding:28px 35px;border-top:1px solid #e2e8f0;text-align:center;">
          <p style="margin:0;font-size:14px;color:#64748b;line-height:24px;">&copy; 2026 MeritNama. All rights reserved.</p>
          <p style="margin:10px 0 0;font-size:13px;color:#94a3b8;line-height:22px;">This is an automated notification regarding your portal access.</p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body></html>
```

---

## 5b. Joining Status — "Happy Residency" Email

Same `mail` collection / `email_templates` mechanism as the welcome email above, added for the Merit List "Joining Status" feature (`js/sim-merit-list.js` + `js/admin-toggles.js`). Sent in bulk from the Merit List page to candidates whose `induction21_joining_status.json` row has `status: "Joined"`, via `db.collection('mail').add({ to, template: { name: 'happy_residency', data } })`.

### Regenerating the underlying data

The joining-status data itself is **not** entered by hand — it's converted from three admin-exported spreadsheets:

```bash
python scripts/convert_joining_status.py
```

reads `joined/selected.xlsx` (authoritative seat placement + `status`/`joiningDate`), cross-references `joined/joined.xlsx` and `joined/pending.xlsx` (a separate profile-status export), and writes `meritnama/data/induction21_joining_status.json`. Re-run this whenever a fresh export lands in `joined/`. Rows where the two sources disagree are written with `profileMismatch: true` rather than silently resolved — the Merit List UI surfaces these with a "Profile mismatch" tag.

### Create the happy_residency template

Create this Firestore document:

- Collection: `email_templates`
- Document ID: `happy_residency`

Fields:

- `subject`:

```text
Welcome to Your Residency — MeritNama
```

- `html`:

```html
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Welcome to Your Residency</title></head>
<body style="margin:0;padding:0;background-color:#f4f7fb;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f7fb;padding:40px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
      <tr>
        <td align="center" style="background:linear-gradient(135deg,#0e2a22,#0a0e16);padding:40px 30px;">
          <img src="{{logoUrl}}" alt="MeritNama" style="max-width:150px;height:auto;margin-bottom:18px;" />
          <div style="display:inline-block;background:rgba(62,207,142,0.14);border:1px solid rgba(62,207,142,0.4);color:#3ecf8e;font-size:12px;font-weight:700;padding:5px 14px;border-radius:100px;margin-bottom:16px;">&#127881; Placement Confirmed</div>
          <h1 style="color:#ffffff;margin:0;font-size:26px;font-weight:700;letter-spacing:0.3px;">Welcome to your residency,<br>{{name}}</h1>
          <p style="color:#9fb0c3;margin-top:10px;font-size:15px;line-height:24px;">MeritNama wishes you a joyful, fulfilling journey ahead.</p>
        </td>
      </tr>
      <tr>
        <td style="padding:36px 35px;color:#334155;">
          <p style="font-size:15px;line-height:26px;margin-top:0;color:#475569;">You've officially joined your seat. Here's where you're headed:</p>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 30px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">
            <tr><td style="padding:22px 24px;">
              <p style="margin:0 0 10px;font-size:15px;color:#0f172a;"><strong>Program:</strong> {{program}}</p>
              <p style="margin:0 0 10px;font-size:15px;color:#0f172a;"><strong>Specialty:</strong> {{specialty}}</p>
              <p style="margin:0 0 10px;font-size:15px;color:#0f172a;"><strong>Hospital:</strong> {{hospital}}</p>
              <p style="margin:0 0 10px;font-size:15px;color:#0f172a;"><strong>Preference:</strong> Choice #{{preferenceNo}}</p>
              <p style="margin:0;font-size:15px;color:#0f172a;"><strong>Joined on:</strong> {{joiningDate}}</p>
            </td></tr>
          </table>
          <div style="text-align:center;margin:30px 0;">
            <a href="{{portalUrl}}" style="background:#3ecf8e;color:#04140c;text-decoration:none;padding:15px 34px;border-radius:10px;display:inline-block;font-size:15px;font-weight:700;letter-spacing:0.3px;">Visit Your MeritNama Dashboard &rarr;</a>
          </div>
          <p style="font-size:14px;line-height:24px;color:#64748b;margin-bottom:0;">MeritNama helped guide your placement from merit list to match. If it helped you, the biggest thank-you is passing it on — tell a colleague still waiting on their round.</p>
        </td>
      </tr>
      <tr>
        <td style="background:#f8fafc;padding:26px 35px;border-top:1px solid #e2e8f0;text-align:center;">
          <p style="margin:0;font-size:13px;color:#64748b;line-height:22px;">&copy; 2026 MeritNama. All rights reserved.</p>
          <p style="margin:10px 0 0;font-size:12px;color:#94a3b8;line-height:20px;">This is an automated notification regarding your residency placement.</p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body></html>
```

Note: unlike the in-app "joined" celebration shown on the Merit List page (which can use CSS animation freely), this template deliberately has **no animation** — Gmail and Outlook strip `<style>` keyframes from inbound HTML mail, so an animated version would render broken or static-but-oddly-cropped in most inboxes. Apple/iOS Mail are the exception if a lightly-animated variant is ever wanted, but it shouldn't be the only version shipped.

### Firestore rules

`firestore.rules` now also has a `joining_notifications/{applicantId}` collection (tracks who's already been emailed, so re-running the xlsx import never causes a resend). Redeploy rules after pulling this change:

```bash
firebase deploy --only firestore:rules
```

---

## 6. Admin Dashboard

- Access at: `your-site.com/admin.html`
- Requires an `authorized_users` document with `isAdmin: true`
- Shows: all access attempts, IPs, timestamps, success/failure
- Filter by email or status
- Only you should know the admin email/PIN

---

## 7. Security Notes

- **Access gating**: The page content is hidden via CSS `body.auth-locked` class which hides ALL elements. The auth gate runs before any content renders. This provides effective access control for normal users. Note: Since this is a client-side static site, a technically sophisticated user could potentially view the HTML source. For sensitive data, store it in Firestore with security rules that require proper authentication tokens.
  
- **For maximum security**: Move sensitive data (merit tables, predictions) into Firestore collections protected by security rules. The app would then only fetch data after successful PIN verification, making it truly server-side protected.
  
- **PIN Storage**: You can store PINs as plain text (for convenience when adding via Firebase Console) or as SHA-256 hashes. The system auto-detects based on string length (64 chars = hash).

- **Session**: After successful auth, a 24-hour session is stored in localStorage. Users don't need to re-enter PIN on every page load.

- **IP Logging**: Uses `api.ipify.org` to fetch the user's public IP for logging.

---

## 8. Generating SHA-256 PIN Hash (Optional)

If you prefer to store hashed PINs, generate them with:

```bash
echo -n "123456" | shasum -a 256
# Output: 8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92
```

Or in browser console:
```javascript
async function hashPin(pin) {
  const data = new TextEncoder().encode(pin);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
hashPin('123456').then(console.log);
```
