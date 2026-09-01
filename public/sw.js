/**
 * Fiscus Service Worker：静态资源缓存 + 离线兜壳。
 * 策略：API 请求不缓存；页面导航 network-first；其余同源 GET 资源 stale-while-revalidate。
 */
const CACHE_NAME = 'fiscus-cache-v3';
const PRECACHE_URLS = ['/', '/manifest.webmanifest', '/icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        // 逐个缓存并容忍单个失败（未登录时静态资源返回 401，
        // addAll 任一失败会导致整个 SW 安装失败）
        Promise.allSettled(
          PRECACHE_URLS.map((u) =>
            fetch(u).then((res) => {
              if (res && res.ok) return cache.put(u, res);
            })
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // 页面导航：network-first，失败时回退缓存的壳页面
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('/', copy));
          return res;
        })
        .catch(() => caches.match('/'))
    );
    return;
  }

  // 静态资源：stale-while-revalidate
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
