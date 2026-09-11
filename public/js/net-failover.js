// WeMusic 网络故障转移（2026-09-11）
// 背景：国内蜂窝网络到 Cloudflare（免费版香港节点）的下行链路极差——
// 静态资源靠 SW 缓存能展示页面，但任何带响应内容的 API 请求都收不到，
// 表现为"页面正常但数据全空"。家庭宽带有公网 IPv6，且国内蜂窝到家庭
// IPv6 直连延迟仅 14-48ms（实测全国 200 节点连通）。
//
// 策略：域名入口持续探测 API 健康度；连续失败后探测 IPv6 直连可用性；
// 直连可达则自动跳转（登录态经 URL hash 迁移，不经过服务器）。
// 仅当当前 origin 为域名（非 IP 直连）时生效，避免循环。
(function () {
  'use strict';

  var PROBE_INTERVAL_MS = 10000;   // 正常探测间隔
  var PROBE_TIMEOUT_MS = 3000;     // 单次探测超时
  var FAIL_THRESHOLD = 2;          // 连续失败阈值
  var DIRECT_PORT = 5174;
  // 兜底 IPv6（当 health 接口也无法返回 v6 时使用；地址变化时探测失败则不跳转，无副作用）
  var FALLBACK_V6 = '2409:8a55:2eb0:bb61::2f6';

  var host = location.hostname;
  // 已是 IP 直连（IPv6 字面量含冒号，IPv4 为纯数字点分）→ 不启用
  if (host.indexOf(':') >= 0 || /^(\d+\.){3}\d+$/.test(host) || host === 'localhost' || host === '127.0.0.1') return;

  var lastKnownV6 = FALLBACK_V6;
  var consecutiveFails = 0;

  function probe(url, timeoutMs) {
    return new Promise(function (resolve) {
      var done = false;
      var timer = setTimeout(function () { finish(false); }, timeoutMs);
      function finish(ok, data) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(ok ? (data || true) : false);
      }
      fetch(url, { cache: 'no-store', credentials: 'omit' })
        .then(function (res) { return res.ok ? res.json() : null; })
        .then(function (data) { finish(!!data, data); })
        .catch(function () { finish(false); });
    });
  }

  function directUrl(v6) {
    return 'http://[' + v6 + ']:' + DIRECT_PORT + '/api/health';
  }

  // 迁移登录态：token/user 编码进 URL hash（hash 不发送到服务器）
  function migrateHash() {
    try {
      var token = localStorage.getItem('wemusic_token');
      var user = localStorage.getItem('wemusic_user');
      if (!token) return '';
      return '#mig=' + encodeURIComponent(JSON.stringify({ token: token, user: user }));
    } catch (e) { return ''; }
  }

  async function tryFailover() {
    // 候选 v6：优先 health 返回的最新地址，其次硬编码兜底
    var candidates = [];
    if (lastKnownV6 && lastKnownV6 !== FALLBACK_V6) candidates.push(lastKnownV6);
    candidates.push(FALLBACK_V6);
    for (var i = 0; i < candidates.length; i++) {
      var v6 = candidates[i];
      if (!v6) continue;
      var ok = await probe(directUrl(v6), PROBE_TIMEOUT_MS);
      if (ok) {
        var target = 'http://[' + v6 + ']:' + DIRECT_PORT + location.pathname + location.search + migrateHash();
        console.warn('[failover] 域名链路不可用，切换到直连:', v6);
        location.replace(target);
        return true;
      }
    }
    return false;
  }

  async function tick() {
    var res = await probe('/api/health', PROBE_TIMEOUT_MS);
    if (res) {
      consecutiveFails = 0;
      if (res.v6) lastKnownV6 = res.v6; // 每次成功的探测刷新最新 v6 地址
      return;
    }
    consecutiveFails++;
    console.warn('[failover] health 探测失败 x' + consecutiveFails);
    if (consecutiveFails >= FAIL_THRESHOLD) {
      var moved = await tryFailover();
      if (!moved) {
        // 直连也不可达：间隔拉长再试，避免频繁探测
        consecutiveFails = 0;
      }
    }
  }

  // 页面加载 8 秒后开始探测（给正常加载留时间，避免与 init 并发竞争）
  setTimeout(function () {
    tick();
    setInterval(tick, PROBE_INTERVAL_MS);
  }, 8000);
})();
