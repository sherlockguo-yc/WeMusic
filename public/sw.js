/**
 * WeMusic Service Worker
 * 策略：
 *   - HTML / 入口 JS / CSS / 图标：Network First，版本号更新时自动失效
 *   - 构建产物 chunks（hash 命名，内容不可变）：Cache First
 *   - API 请求（/api/）：Network Only，不缓存
 *   - 音乐封面图（QQ 音乐 CDN）：Stale While Revalidate
 *
 * 预缓存：install 时读取 /dist/sw-precache.json（由 vite.config.js 的
 * sw-precache-manifest 插件在构建时生成），全量缓存所有 JS 产物
 * （含业务 chunks）。修复历史 bug：v8 只预缓存 app.js/login.js，网络
 * 抖动时未缓存的 chunks 返回 503，ES module 链断裂导致整页死页。
 */

const CACHE_VERSION = 'wemusic-v11';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const IMG_CACHE    = `${CACHE_VERSION}-img`;
// API 读数据缓存：按账号分桶（bucket 名含 Authorization hash，不同登录态不串数据）
const DATA_CACHE_PREFIX = `${CACHE_VERSION}-data`;

// 可缓存的读接口白名单（GET 幂等读数据）：网络失败时回退上次成功的响应，
// 解决弱网/CF 链路抖动时「页面正常但数据全空」的问题。
const API_CACHEABLE_RE = /^\/api\/(playlists\b|stats\/|auth\/(session|me|preferences|custom-palettes)\b)/;

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/login.html',
  '/css/style.css',
  '/css/admin.css',
  '/dist/app.js',
  '/dist/login.js',
  '/js/log-shim.js',
  '/js/net-failover.js',
  '/manifest.json',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg',
];

// ---- 安装：合并基础清单与构建产物清单，逐文件缓存，避免单个失败导致全部失败 ----
async function buildPrecacheList() {
  const urls = [...PRECACHE_URLS];
  try {
    const res = await fetch('/dist/sw-precache.json', { cache: 'no-store' });
    if (res.ok) {
      const { files } = await res.json();
      if (Array.isArray(files)) urls.push(...files.filter((f) => typeof f === 'string'));
    }
  } catch { /* 清单不可用（dev 模式等）时退回基础清单 */ }
  return urls;
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    buildPrecacheList().then((urls) =>
      caches.open(STATIC_CACHE).then((cache) =>
        Promise.allSettled(urls.map((url) =>
          fetch(url).then((res) => { if (res.ok) cache.put(url, res); }).catch(() => {})
        ))
      )
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
          .filter((k) => k.startsWith('wemusic-') && k !== STATIC_CACHE && k !== IMG_CACHE && !k.startsWith(DATA_CACHE_PREFIX))
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ---- 请求拦截 ----
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // API 请求：
  //  - GET 且命中读缓存白名单 → Network First，失败时回退该账号的上次成功缓存
  //  - 其余（写操作/播放等实时接口）→ 网络直通
  if (url.pathname.startsWith('/api/')) {
    if (e.request.method === 'GET' && API_CACHEABLE_RE.test(url.pathname)) {
      e.respondWith(apiNetworkFirst(e.request));
    } else {
      e.respondWith(
        fetch(e.request).catch(() =>
          new Response(JSON.stringify({ error: '网络不可用' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          })
        )
      );
    }
    return;
  }

  // Bilibili 播放器 iframe（跨域）：直接走网络
  if (url.hostname.includes('bilibili.com') || url.hostname.includes('bilivideo.com')) {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response('', { status: 503 })
      )
    );
    return;
  }

  // 专辑封面图（QQ 音乐 CDN）：Stale While Revalidate
  if (url.hostname.includes('y.qq.com') || url.hostname.includes('gtimg.com')) {
    e.respondWith(staleWhileRevalidate(e.request, IMG_CACHE));
    return;
  }

  // 构建产物 chunks（hash 命名，内容不可变）：Cache First。
  // 命中即返回、零网络依赖；未命中走网络并缓存。
  if (url.pathname.startsWith('/dist/chunks/')) {
    e.respondWith(cacheFirst(e.request, STATIC_CACHE));
    return;
  }

  // 其余静态资源（HTML / 入口 JS / CSS）：Network First（优先网络确保最新，离线回退缓存）
  e.respondWith(networkFirst(e.request, STATIC_CACHE));
});

// ---- API 读缓存：Network First + 失败回退 ----
// 按 Authorization 头哈希分桶（不同账号的数据缓存在不同 bucket，不串号）
function _authBucket(authHeader) {
  let h = 0;
  const s = authHeader || 'anon';
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `${DATA_CACHE_PREFIX}-${h >>> 0}`;
}

async function apiNetworkFirst(request) {
  const bucket = _authBucket(request.headers.get('Authorization'));
  const cache = await caches.open(bucket);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: '网络不可用' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

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

// Network First：优先走网络拿最新内容，网络失败再回退缓存。
// 注意 cache:'no-cache'：CF 的 Browser Cache TTL 会把 JS 的 max-age 改写成
// 4 小时，若用默认缓存语义，"网络优先"实际拿到的是浏览器 HTTP 缓存里的
// 旧资源，导致部署后最长 4 小时无法更新。强制每次与服务器 revalidate（304 很快）。
async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request, { cache: 'no-cache' });
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
