// App-shell cache: the list works offline; Firebase keeps its own offline data.
const CACHE = "kniyot-v2";
const SHELL = ["./", "index.html", "app.js", "styles.css", "firebase-config.js", "manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Same-origin files: network first (so updates arrive), cache when offline.
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request.mode === "navigate" ? "index.html" : e.request, copy));
      return res;
    }).catch(() => caches.match(e.request.mode === "navigate" ? "index.html" : e.request, { ignoreSearch: true }))
  );
});
