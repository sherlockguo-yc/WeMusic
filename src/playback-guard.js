// ---------------- 播放容错：纯逻辑（无 DOM / 无全局状态依赖，可用假时钟单测）----------------
// 背景（2026-11-04）：player.js 里「超时 → 恢复 → 重试 → 切歌」的回调，原先都是各自拿一个
// 全局 setTimeout 句柄，没有任何「这个回调属于哪次加载」的概念。结果是：
//   - 换了歌 / 换了线路之后，旧回调仍会触发，把新歌重载到 0 秒或提前跳歌；
//   - canplay 超时时把监听器移除，数据稍晚到就再也没人启动播放；
//   - 恢复闸门在「1.5s 后重试」真正执行前就放开，同一轮卡顿能连跳多首。
// 这里用「加载代次（gen）」统一约束：每次换 src / 换线路 / 换歌都 bump 一次，
// 所有挂在旧代次上的定时器与监听器要么被清掉，要么触发时自动作废。

export const STALL_TICK_THRESHOLD = 8;     // 已出声后 currentTime 连续 8 个 tick 不前进 → 判停滞
export const CANPLAY_TIMEOUT_MS = 8000;    // 加载后 8s 仍没数据 → 进入恢复
export const DIRECT_PROBE_MS = 4000;       // 直连 4s 无数据（也无 error）→ 切代理
export const STALLED_EVENT_MS = 8000;      // 播放中收到 stalled 后 8s 仍无数据 → 进入恢复
export const RETRY_DELAY_MS = 1500;        // 同源重试前的等待
export const CACHE_POLL_MS = 2000;         // 被动缓存：就绪检测间隔
export const CACHE_MAX_WAIT_MS = 120000;   // 被动缓存：最长等待，超时放弃
export const PROXY_AHEAD_SEC = 30;         // 代理线路播放时，缓冲余量达到该秒数才允许并行下载
export const DIRECT_MIN_PLAYED_SEC = 5;    // 直连线路播放时，播放满该秒数才允许下载

/**
 * 停滞判定（每秒一次）。只有「已经真正出过声」的曲目才会计数：
 * 加载 / 降级 / 首缓冲阶段 currentTime 本来就不动，那由 canplay 超时与直连探活负责。
 * @returns {{ticks:number, stalled:boolean}}
 */
export function evaluateStall({ ticks, started, paused, crossfading, currentTime, lastTime, threshold = STALL_TICK_THRESHOLD }) {
  if (paused || crossfading || !started) return { ticks: 0, stalled: false };
  if (Math.abs(currentTime - lastTime) >= 0.3) return { ticks: 0, stalled: false };
  const next = ticks + 1;
  return next >= threshold ? { ticks: 0, stalled: true } : { ticks: next, stalled: false };
}

/**
 * 被动缓存（整首音频再下载一遍）是否可以开始。
 *  - 展开视频：声音由 B 站 iframe 直接输出，不经过本站隧道，下载不会与播放争带宽。
 *  - 代理线路播放：播放流与缓存下载走同一条隧道，必须等缓冲余量足够（或已缓冲到曲尾）。
 *  - 直连线路播放：播放不占隧道，起播稳定后即可。
 */
export function cacheReady({ mode, crossfading, playingSeen, viaProxy, currentTime, bufferedAhead, readyState, duration }) {
  if (mode === 'iframe') return true;
  if (crossfading || !playingSeen) return false;
  if (!viaProxy) return currentTime >= DIRECT_MIN_PLAYED_SEC;
  if (readyState < 3) return false;
  const remaining = Number.isFinite(duration) && duration > 0 ? duration - currentTime : Infinity;
  const need = Math.min(PROXY_AHEAD_SEC, Math.max(remaining - 1, 0));
  return bufferedAhead >= need;
}

/**
 * 加载代次守卫。
 * bump()：开始一次新的加载（换 src / 换线路 / 换歌）。清掉所有具名定时器，执行并丢弃已登记的清理函数
 *         （如 removeEventListener），之后旧代次的任何回调都不会再生效。
 */
export function createLoadGuard(timerApi = globalThis) {
  let gen = 0;
  const timers = new Map();
  let cleanups = [];

  const stop = (name) => {
    const id = timers.get(name);
    if (id !== undefined) { timerApi.clearTimeout(id); timers.delete(name); }
  };

  return {
    get gen() { return gen; },
    isCurrent: (g) => g === gen,
    bump() {
      gen++;
      for (const name of [...timers.keys()]) stop(name);
      const fns = cleanups; cleanups = [];
      for (const fn of fns) { try { fn(); } catch { /* 清理失败不影响新一轮加载 */ } }
      return gen;
    },
    /** 设置具名定时器；同名覆盖；触发时若代次已变则静默作废。 */
    setTimer(name, ms, fn) {
      stop(name);
      const g = gen;
      const id = timerApi.setTimeout(() => {
        timers.delete(name);
        if (g === gen) fn();
      }, ms);
      timers.set(name, id);
    },
    clearTimer: stop,
    hasTimer: (name) => timers.has(name),
    /** 登记「下一次 bump 时执行」的清理函数（典型：移除 audio 事件监听）。 */
    onCleanup(fn) { cleanups.push(fn); },
  };
}

/**
 * 恢复闸门：保证同一轮卡顿只触发一次「换源 / 重试 / 切歌」。
 * 关键点：选择「延迟重试」时闸门保持关闭，直到重试真正执行（或被 reset）才放开，
 * 否则重试前再来一个超时回调，就会绕过重试直接切歌。
 */
export function createRecoveryGate(timerApi = globalThis) {
  let busy = false;
  let retryId = null;
  return {
    get busy() { return busy; },
    tryEnter() { if (busy) return false; busy = true; return true; },
    leave() { busy = false; },
    holdForRetry(ms, fn) {
      if (retryId !== null) timerApi.clearTimeout(retryId);
      retryId = timerApi.setTimeout(() => { retryId = null; busy = false; fn(); }, ms);
    },
    reset() {
      if (retryId !== null) { timerApi.clearTimeout(retryId); retryId = null; }
      busy = false;
    },
  };
}

/**
 * 被动缓存调度：轮询 isReady，就绪后只执行一次 run；曲目变化 / 超时 / cancel 则放弃。
 * 同一时刻只关心一个 key（当前曲目）。
 */
export function createCacheScheduler({ isReady, isStale, run, pollMs = CACHE_POLL_MS, maxWaitMs = CACHE_MAX_WAIT_MS }, timerApi = globalThis) {
  let id = null;
  let active = null;

  const cancel = () => {
    if (id !== null) timerApi.clearTimeout(id);
    id = null;
    active = null;
  };

  const poll = (key, waited) => {
    id = null;
    if (active !== key) return;
    if (isStale(key)) { active = null; return; }
    if (isReady(key)) { active = null; run(key); return; }
    if (waited >= maxWaitMs) { active = null; return; }
    id = timerApi.setTimeout(() => poll(key, waited + pollMs), pollMs);
  };

  return {
    schedule(key) {
      cancel();
      active = key;
      id = timerApi.setTimeout(() => poll(key, pollMs), pollMs);
    },
    cancel,
    get pending() { return active !== null; },
  };
}
