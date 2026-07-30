// WeMusic 全量日志持久化前端 shim。
//
// 必须以经典（非 module）<script> 方式、在 /dist/app.js /dist/login.js 之前加载：
// 1. type="module" 脚本天然延迟执行（deferred），且 Vite/Rollup 打包后 chunk 之间
//    的 import 顺序由构建工具决定，不保证与源码里的 import 顺序一致；
// 2. 经典同步 <script> 会在浏览器解析到它时立即执行，只要这个标签在 HTML 中位于
//    所有模块脚本之前，就一定先于它们运行——这是唯一能保证"最早时机"的方式。
//
// 因此这个文件不参与 Vite 构建，作为纯静态文件由 public/js/ 直接提供。
(function () {
  'use strict';
  var TOKEN_KEY = 'wemusic_token';
  var FLUSH_INTERVAL = 5000; // 5 秒
  var FLUSH_THRESHOLD = 20;  // 攒够 20 条立即上报
  var MAX_QUEUE = 200;       // 长时间离线时的队列上限，防止无限增长

  var queue = [];
  var timer = null;

  function toMsg(args) {
    var parts = [];
    for (var i = 0; i < args.length; i++) {
      var a = args[i];
      if (typeof a === 'string') parts.push(a);
      else if (a instanceof Error) parts.push(a.stack || a.message);
      else {
        try { parts.push(JSON.stringify(a)); } catch (e) { parts.push(String(a)); }
      }
    }
    return parts.join(' ');
  }

  function enqueue(level, args) {
    if (queue.length >= MAX_QUEUE) queue.shift(); // 队满时丢最老的一条
    queue.push({ level: level, message: toMsg(args), ts: Date.now() });
    if (queue.length >= FLUSH_THRESHOLD) flush(false);
    else if (!timer) timer = setTimeout(function () { flush(false); }, FLUSH_INTERVAL);
  }

  function flush(useBeacon) {
    if (timer) { clearTimeout(timer); timer = null; }
    if (queue.length === 0) return;
    var events = queue;
    queue = [];
    var body = JSON.stringify({ events: events });

    // 页面卸载时用 sendBeacon（不支持自定义头，退化为不带认证的匿名上报，但保证发得出去）
    if (useBeacon && navigator.sendBeacon) {
      try {
        navigator.sendBeacon('/api/logs/client', new Blob([body], { type: 'application/json' }));
        return;
      } catch (e) { /* 回退到 fetch */ }
    }

    var headers = { 'Content-Type': 'application/json' };
    try {
      var token = localStorage.getItem(TOKEN_KEY);
      if (token) headers.Authorization = 'Bearer ' + token;
    } catch (e) { /* localStorage 不可用（隐私模式等），跳过认证头 */ }

    fetch('/api/logs/client', { method: 'POST', headers: headers, body: body, keepalive: true }).catch(function () {
      /* 上报失败静默丢弃，不影响正常使用；下一批日志仍会正常尝试上报 */
    });
  }

  var origLog = console.log.bind(console);
  var origWarn = console.warn.bind(console);
  var origError = console.error.bind(console);

  console.log = function () { origLog.apply(console, arguments); enqueue('info', arguments); };
  console.warn = function () { origWarn.apply(console, arguments); enqueue('warn', arguments); };
  console.error = function () { origError.apply(console, arguments); enqueue('error', arguments); };

  window.addEventListener('beforeunload', function () { flush(true); });
  window.addEventListener('pagehide', function () { flush(true); });
})();
