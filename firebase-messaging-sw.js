/*
  GastAr — Service worker (avisos push + modo "red primero")
  Versión: 1.0.0 · 2026-11-18
  PENDIENTE: pegar la misma configuración de Firebase que tiene index.html (bloque FIREBASE_CONFIG).
*/
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

const SW_VERSION = 'gastar-sw-1.0.0';
firebase.initializeApp({
  apiKey: 'AIzaSyBlftKE_pqK6afzv1pe8PS58sYlb2Z93Uk',
  authDomain: 'charlar-e5408.firebaseapp.com',
  projectId: 'charlar-e5408',
  storageBucket: 'charlar-e5408.firebasestorage.app',
  messagingSenderId: '471550179133',
  appId: '1:471550179133:web:3c06e945f81eb9fd477754'
});
// Con payload "notification", FCM muestra el aviso solo; este objeto lo deja listo.
firebase.messaging();

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('gastar-') && k !== SW_VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())
));

// Red primero: siempre intenta traer la versión nueva; si no hay conexión, usa la copia guardada.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req).then(res => {
      if (res && res.ok) { const copia = res.clone(); caches.open(SW_VERSION).then(c => c.put(req, copia)); }
      return res;
    }).catch(() => caches.match(req).then(r => r || caches.match('./')))
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({type: 'window', includeUncontrolled: true}).then(list => {
    for (const c of list) { if ('focus' in c) return c.focus(); }
    return self.clients.openWindow(self.registration.scope);
  }));
});
