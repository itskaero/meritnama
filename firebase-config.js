// ═══════════════════════════════════════════════════════
// Firebase Configuration — Replace with your project values
// ═══════════════════════════════════════════════════════
const firebaseConfig = {
  apiKey: "AIzaSyAPo6RETEq61cFLPY6Gpuog2yI7Ijtfh0I",
  authDomain: "mortality-review.firebaseapp.com",
  projectId: "mortality-review",
  storageBucket: "mortality-review.firebasestorage.app",
  messagingSenderId: "947249523930",
  appId: "1:947249523930:web:a7726922936f70c477c9e3",
  measurementId: "G-DRMZ0ZKSLD"
};

// Web Push VAPID key — Firebase Console → Project Settings → Cloud Messaging → Web Push certificates
// Paste your key pair's public key here. Without this the Alerts bell is hidden for all users.
const FIREBASE_VAPID_KEY = "BOcPGgIDFLFP1XErdlNH_uyeGGW-cobRlK5_zVmpKaJg2ANyfe7LT2JBGVFTawPtHr002HEzSwEuuUlCqLM9vkQ";