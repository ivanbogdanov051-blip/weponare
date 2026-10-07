'use strict';
// Network first (so a new version always wins), falling back to the last copy
// that was cached, so the menu still opens instantly on a slow link or offline.
// Game traffic (the WebSocket) and the API are never touched.
const CACHE = 'weponare-v1';
const SHELL = ['./', 'index.html', 'styles.css', 'client.js', 'sprites.js', 'weapons.js', 'pixel.js', 'audio.js', 'icon-192.png', 'manifest.webmanifest'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request).then(r => r || caches.match('./'))));
});
