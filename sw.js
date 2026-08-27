const CACHE_NAME = "chinese-game-v2";

const PRECACHE_URLS = [
  "./",
  "index.html",
  "style.css",
  "game.js",
  "data.js",
  "music.js",
  "manifest.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-192.png",
  "icons/icon-maskable-512.png",
];

// Archivos de código/contenido: se piden siempre a la red primero para que
// las actualizaciones (nuevos caracteres, canciones, lógica) se vean de
// inmediato; si no hay conexión, se usa la copia en caché.
const NETWORK_FIRST_RE = /\.(html|js|css|json)$/;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function networkFirst(req) {
  return fetch(req)
    .then((res) => {
      const copy = res.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
      return res;
    })
    .catch(() => caches.match(req));
}

function cacheFirst(req) {
  return caches.match(req).then((cached) => {
    if (cached) return cached;
    return fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
      return res;
    });
  });
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;

  const isAppShell = req.mode === "navigate" || url.pathname === "/" || NETWORK_FIRST_RE.test(url.pathname);

  event.respondWith(isAppShell ? networkFirst(req) : cacheFirst(req));
});
