/* InkWeb service worker — cache-first for the app shell, so it works offline. */
const VERSION = 'inkweb-v1';
const SHELL = [
  './', './index.html', './css/app.css', './manifest.webmanifest', './icon.svg',
  './js/main.js', './js/doc.js', './js/geom.js', './js/bool.js', './js/view.js',
  './js/tools.js', './js/tools-shapes.js', './js/tools-draw.js', './js/tools-text.js',
  './js/commands.js', './js/dialogs.js', './js/ui.js', './js/io.js', './js/dom.js',
  './js/raster.js', './js/trace.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()).catch(() => { }));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

/* Network-first: you always get the newest build when online, and the cached
   copy keeps the editor usable offline. */
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req).then(res => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(req, copy)).catch(() => { });
      }
      return res;
    }).catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
  );
});
