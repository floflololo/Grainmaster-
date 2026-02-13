const CACHE = "grainmaster-cache-v7";
const CORE = [
  "./",
  "./index.html",
  "./styles.css",
  "./machine-data.js",
  "./advisor-engine.js",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon-192.svg",
  "./icons/icon-512.svg"
];

// Cache-Bust Varianten ebenfalls erlauben
function stripV(url){
  try{
    const u = new URL(url);
    u.search = "";
    return u.toString();
  }catch{
    return url;
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache)=>{
      await cache.addAll(CORE);
    }).then(()=> self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => (k !== CACHE ? caches.delete(k) : Promise.resolve())))
    ).then(()=> self.clients.claim())
  );
});

// Network-first für HTML/JS, damit Updates sofort kommen.
// Für alles andere cache-first.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  const path = url.pathname;

  const isHTML = req.mode === "navigate" || path.endsWith("/index.html");
  const isJS = path.endsWith(".js");
  const isCSS = path.endsWith(".css");

  if(isHTML || isJS || isCSS){
    event.respondWith(
      fetch(req).then(async (res)=>{
        const cache = await caches.open(CACHE);
        cache.put(stripV(req.url), res.clone());
        return res;
      }).catch(async ()=>{
        const cached = await caches.match(stripV(req.url));
        return cached || caches.match("./index.html");
      })
    );
    return;
  }

  event.respondWith(
    caches.match(stripV(req.url)).then((cached)=> cached || fetch(req).catch(()=>caches.match("./index.html")))
  );
});
