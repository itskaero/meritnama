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

## 5. Admin Dashboard

- Access at: `your-site.com/admin.html`
- Requires an `authorized_users` document with `isAdmin: true`
- Shows: all access attempts, IPs, timestamps, success/failure
- Filter by email or status
- Only you should know the admin email/PIN

---

## 6. Security Notes

- **Access gating**: The page content is hidden via CSS `body.auth-locked` class which hides ALL elements. The auth gate runs before any content renders. This provides effective access control for normal users. Note: Since this is a client-side static site, a technically sophisticated user could potentially view the HTML source. For sensitive data, store it in Firestore with security rules that require proper authentication tokens.
  
- **For maximum security**: Move sensitive data (merit tables, predictions) into Firestore collections protected by security rules. The app would then only fetch data after successful PIN verification, making it truly server-side protected.
  
- **PIN Storage**: You can store PINs as plain text (for convenience when adding via Firebase Console) or as SHA-256 hashes. The system auto-detects based on string length (64 chars = hash).

- **Session**: After successful auth, a 24-hour session is stored in localStorage. Users don't need to re-enter PIN on every page load.

- **IP Logging**: Uses `api.ipify.org` to fetch the user's public IP for logging.

---

## 7. Generating SHA-256 PIN Hash (Optional)

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
