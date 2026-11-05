// Service Worker: macht die App installierbar und lädt sie auch bei schlechtem Netz.
// Bei Änderungen an der App die Versionsnummer erhöhen.
const CACHE = 'zweisam-v2';
const ASSETS = [
  './', './index.html', './style.css', './app.js', './util.js', './config.js', './manifest.webmanifest',
  './icon-192.png', './icon-512.png', './apple-touch-icon.png',
  './foto-1.jpg', './foto-2.jpg', './foto-3.jpg', './foto-4.jpg', './foto-5.jpg', './foto-6.jpg', './foto-7.jpg', './foto-8.jpg'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // Eigene Dateien: zuerst Netz (immer aktuell), sonst Cache
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(e.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      }).catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
    );
    return;
  }

  // Firebase-SDK & Schrift: aus dem Cache, wenn vorhanden
  if (['www.gstatic.com', 'fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) {
    e.respondWith(
      caches.match(e.request).then(r => r || fetch(e.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      }))
    );
  }
});
