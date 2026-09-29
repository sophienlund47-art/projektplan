// Gemmer appens egne filer, så den starter hurtigt og kan åbnes uden net.
// Firebase-data går altid direkte til Firebase (den har sin egen offline-lagring).
const CACHE = 'projektplan-v1';
const SHELL = ['./', './index.html', './firebase-config.js', './app-firebase.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];
const CDN = ['https://www.gstatic.com', 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin){
    // Egne filer: hent nyeste version, brug gemt kopi uden net
    e.respondWith(fetch(req).then(res => {
      if (res.ok){ const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then(r => r || caches.match('./index.html'))));
    return;
  }
  if (CDN.some(o => url.href.startsWith(o)) && !url.pathname.includes('/__/')){
    // Firebase-biblioteket og skrifttyper: gemt kopi først
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok || res.type === 'opaque'){ const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    })));
  }
});
