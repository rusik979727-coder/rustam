// Clinic cash register: cache the app shell so it opens without internet.
const CACHE = "klinika-kassasy-v9";
const FILES = ["./", "./index.html", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png", "./icons/logo-mark.png", "./fonts/montserrat-cyrillic-500-normal.woff2", "./fonts/montserrat-cyrillic-700-normal.woff2", "./fonts/montserrat-cyrillic-800-normal.woff2", "./fonts/montserrat-cyrillic-ext-500-normal.woff2", "./fonts/montserrat-cyrillic-ext-700-normal.woff2", "./fonts/montserrat-cyrillic-ext-800-normal.woff2", "./fonts/montserrat-latin-500-normal.woff2", "./fonts/montserrat-latin-700-normal.woff2", "./fonts/montserrat-latin-800-normal.woff2"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network first for the page (so updates arrive when online), cache fallback offline.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  const u = new URL(req.url);
  if (req.method !== "GET" || u.origin !== self.location.origin || u.pathname.includes("/primemed/")) return;
  e.respondWith(
    fetch(req, { cache: "no-cache" })
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match("./index.html")))
  );
});
