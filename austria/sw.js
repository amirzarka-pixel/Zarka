// שומר את האפליקציה ואת אריחי המפה שכבר נצפו, כדי שיעבדו גם בלי קליטה
const V='trip-v1',SHELL=['./','index.html','app.js','data.js','firebase-config.js','manifest.webmanifest','icon-192.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(SHELL)));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==V&&x!=='tiles').map(x=>caches.delete(x)))));self.clients.claim()});
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET')return;
  if(u.hostname.endsWith('tile.openstreetmap.org')){e.respondWith(caches.open('tiles').then(c=>c.match(e.request).then(r=>r||fetch(e.request).then(n=>{c.put(e.request,n.clone());return n}))));return}
  if(u.origin===location.origin||u.hostname==='unpkg.com'){e.respondWith(fetch(e.request).then(n=>{const cl=n.clone();caches.open(V).then(c=>c.put(e.request,cl));return n}).catch(()=>caches.match(e.request)))}});
