// Firebase Messaging Service Worker
// Generated from firebase-messaging-sw.template.js by GitHub Actions.
// Handles background push notifications when the site is closed/in background.

importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey:            "${FIREBASE_API_KEY}",
  authDomain:        "${FIREBASE_AUTH_DOMAIN}",
  projectId:         "${FIREBASE_PROJECT_ID}",
  storageBucket:     "${FIREBASE_STORAGE_BUCKET}",
  messagingSenderId: "${FIREBASE_MESSAGING_SENDER_ID}",
  appId:             "${FIREBASE_APP_ID}"
});

const messaging = firebase.messaging();

// Background message handler (fires when site is not in foreground)
messaging.onBackgroundMessage(function (payload) {
  const title = payload.notification?.title || payload.data?.title || 'MeritNama Update';
  const body  = payload.notification?.body  || payload.data?.body  || 'Candidate data has been updated.';
  const icon  = '/logo.png';
  const url   = payload.data?.url || '/';

  self.registration.showNotification(title, {
    body,
    icon,
    badge: icon,
    tag: 'meritnama-update',
    renotify: true,
    data: { url }
  });
});

// Open site when notification is clicked
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        if (client.url.includes('meritnama') && 'focus' in client) {
          client.focus(); return;
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
