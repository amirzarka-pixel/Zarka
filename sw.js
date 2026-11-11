// App-shell cache: the list works offline; Firebase keeps its own offline data.
const CACHE = "kniyot-v3";
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

// Push notifications (sent by the Cloud Function as data messages through Firebase Cloud Messaging).
self.addEventListener("push", e => {
  let payload = {};
  try { payload = e.data ? e.data.json() : {}; } catch { payload = { data: { body: e.data && e.data.text() } }; }
  const d = payload.data || payload.notification || {};
  e.waitUntil(self.registration.showNotification(d.title || "הקניות שלנו", {
    body: d.body || "",
    icon: "icon-192.png",
    badge: "icon-192.png",
    tag: "kniyot-" + (d.family || ""),
    renotify: true,
    dir: "rtl",
    lang: "he",
    data: { url: d.url || "./" }
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "./";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const c of list) { if ("focus" in c) return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
