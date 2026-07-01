/**
 * WeMusic Service Worker
 * 策略：
 *   - 静态资源（HTML/CSS/JS/图标）：Cache First，版本号更新时自动失效
 *   - API 请求（/api/）：Network Only，不缓存
 *   - 音乐封面图（QQ 音乐 CDN）：Stale While Revalidate
 */

const CACHE_VERSION = 'wemusic-v3';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const IMG_CACHE    = `${CACHE_VERSION}-img`;

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/login.html',
  '/css/style.css',
  '/dist/app.js',
  '/dist/login.js',
  '/manifest.json',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg',
];

// ---- 安装：逐文件缓存，避免单个失败导致全部失败 ----
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(STATIC_CACHE).then((cache) =>
      Promise.allSettled(PRECACHE_URLS.map((url) =>
        fetch(url).then((res) => { if (res.ok) cache.put(url, res); }).catch(() => {})
      ))
    )
  );
  self.skipWaiting();
});

// ---- 激活：清理旧版缓存 ----
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith('wemusic-') && k !== STATIC_CACHE && k !== IMG_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ---- 请求拦截 ----
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // API 请求：直接走网络，不缓存
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(e.request));
    return;
  }

  // Bilibili 播放器 iframe（跨域）：直接走网络
  if (url.hostname.includes('bilibili.com') || url.hostname.includes('bilivideo.com')) {
    e.respondWith(fetch(e.request));
    return;
  }

  // 专辑封面图（QQ 音乐 CDN）：Stale While Revalidate
  if (url.hostname.includes('y.qq.com') || url.hostname.includes('gtimg.com')) {
    e.respondWith(staleWhileRevalidate(e.request, IMG_CACHE));
    return;
  }

  // 静态资源：Network First（优先网络，确保拿到最新版本；离线时回退缓存）
  e.respondWith(networkFirst(e.request, STATIC_CACHE));
});

// Cache First：先找缓存，缓存没有再走网络并缓存结果
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('网络不可用', { status: 503, headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
  }
}

// Network First：优先走网络拿最新内容，网络失败再回退缓存
async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response('网络不可用', { status: 503, headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
  }
}

// Stale While Revalidate：先返回缓存，后台更新缓存
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  return cached || fetchPromise;
}
