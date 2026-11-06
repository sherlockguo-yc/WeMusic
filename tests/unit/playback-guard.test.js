import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  STALL_TICK_THRESHOLD, CACHE_MAX_WAIT_MS, CACHE_POLL_MS, RETRY_DELAY_MS,
  evaluateStall, cacheReady, createLoadGuard, createRecoveryGate, createCacheScheduler,
} from '../../src/playback-guard.js';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('evaluateStall', () => {
  const base = { ticks: 0, started: true, paused: false, crossfading: false, currentTime: 20, lastTime: 20 };

  it('尚未出声（加载 / 降级 / 首缓冲）永远不计数', () => {
    let s = { ticks: 0 };
    for (let i = 0; i < 30; i++) s = evaluateStall({ ...base, started: false, ticks: s.ticks });
    expect(s).toEqual({ ticks: 0, stalled: false });
  });

  it('已出声且位置不前进，连续 8 次才判停滞，并清零计数', () => {
    let s = { ticks: 0, stalled: false };
    for (let i = 1; i < STALL_TICK_THRESHOLD; i++) {
      s = evaluateStall({ ...base, ticks: s.ticks });
      expect(s.stalled).toBe(false);
    }
    s = evaluateStall({ ...base, ticks: s.ticks });
    expect(s).toEqual({ ticks: 0, stalled: true });
  });

  it('缓冲耗尽（readyState 掉到 1）不影响判定：只看位置是否前进', () => {
    // 回归：旧版额外要求 readyState>=2，导致最需要恢复的场景反而不触发
    let s = { ticks: 0, stalled: false };
    for (let i = 0; i < STALL_TICK_THRESHOLD; i++) s = evaluateStall({ ...base, ticks: s.ticks });
    expect(s.stalled).toBe(true);
  });

  it('位置前进、暂停、淡入淡出期间都会清零', () => {
    expect(evaluateStall({ ...base, ticks: 5, currentTime: 21 })).toEqual({ ticks: 0, stalled: false });
    expect(evaluateStall({ ...base, ticks: 5, paused: true })).toEqual({ ticks: 0, stalled: false });
    expect(evaluateStall({ ...base, ticks: 5, crossfading: true })).toEqual({ ticks: 0, stalled: false });
  });
});

describe('cacheReady', () => {
  const direct = { mode: 'bg', crossfading: false, playingSeen: true, viaProxy: false, currentTime: 6, bufferedAhead: 1, readyState: 4, duration: 200 };
  const proxy = { ...direct, viaProxy: true, currentTime: 10, bufferedAhead: 40 };

  it('展开视频：声音走 iframe，不占本站隧道，直接放行', () => {
    expect(cacheReady({ ...direct, mode: 'iframe', playingSeen: false })).toBe(true);
  });

  it('淡入淡出期间、尚未出声：不下载', () => {
    expect(cacheReady({ ...direct, crossfading: true })).toBe(false);
    expect(cacheReady({ ...direct, playingSeen: false })).toBe(false);
  });

  it('直连播放：播放满 5 秒才下载', () => {
    expect(cacheReady({ ...direct, currentTime: 4.9 })).toBe(false);
    expect(cacheReady({ ...direct, currentTime: 5 })).toBe(true);
  });

  it('代理播放：缓冲余量不足 30 秒不下载（避免与播放流争同一条隧道）', () => {
    expect(cacheReady({ ...proxy, bufferedAhead: 29 })).toBe(false);
    expect(cacheReady({ ...proxy, bufferedAhead: 30 })).toBe(true);
    expect(cacheReady({ ...proxy, readyState: 2 })).toBe(false);
  });

  it('代理播放接近曲尾：只要缓冲到曲尾即可，不要求 30 秒', () => {
    expect(cacheReady({ ...proxy, currentTime: 190, bufferedAhead: 9, duration: 200 })).toBe(true);
    expect(cacheReady({ ...proxy, currentTime: 190, bufferedAhead: 3, duration: 200 })).toBe(false);
  });

  it('时长未知（Infinity / NaN）时仍按 30 秒余量判断', () => {
    expect(cacheReady({ ...proxy, duration: Infinity, bufferedAhead: 10 })).toBe(false);
    expect(cacheReady({ ...proxy, duration: NaN, bufferedAhead: 31 })).toBe(true);
  });
});

describe('createLoadGuard', () => {
  it('当前代次的定时器正常触发', () => {
    const g = createLoadGuard();
    const fn = vi.fn();
    g.setTimer('canplay', 8000, fn);
    expect(g.hasTimer('canplay')).toBe(true);
    vi.advanceTimersByTime(8000);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(g.hasTimer('canplay')).toBe(false);
  });

  it('bump 之后旧代次的所有定时器都不会触发', () => {
    const g = createLoadGuard();
    const a = vi.fn(); const b = vi.fn();
    g.setTimer('canplay', 8000, a);
    g.setTimer('probe', 4000, b);
    g.bump();
    vi.advanceTimersByTime(20000);
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
  });

  it('bump 后新设置的同名定时器正常生效，不受旧代次影响', () => {
    const g = createLoadGuard();
    const oldFn = vi.fn(); const newFn = vi.fn();
    g.setTimer('canplay', 8000, oldFn);
    g.bump();
    g.setTimer('canplay', 8000, newFn);
    vi.advanceTimersByTime(8000);
    expect(oldFn).not.toHaveBeenCalled();
    expect(newFn).toHaveBeenCalledTimes(1);
  });

  it('同名定时器重复设置只保留最后一个', () => {
    const g = createLoadGuard();
    const first = vi.fn(); const second = vi.fn();
    g.setTimer('stalled', 8000, first);
    g.setTimer('stalled', 8000, second);
    vi.advanceTimersByTime(8000);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('clearTimer 只取消指定定时器（playing 事件清除看门狗的场景）', () => {
    const g = createLoadGuard();
    const watchdog = vi.fn(); const stalled = vi.fn();
    g.setTimer('canplay', 8000, watchdog);
    g.setTimer('stalled', 8000, stalled);
    g.clearTimer('canplay');
    vi.advanceTimersByTime(8000);
    expect(watchdog).not.toHaveBeenCalled();
    expect(stalled).toHaveBeenCalledTimes(1);
  });

  it('bump 时执行且仅执行一次已登记的清理函数（摘除 audio 监听）', () => {
    const g = createLoadGuard();
    const cleanup = vi.fn();
    g.onCleanup(cleanup);
    g.bump();
    g.bump();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('清理函数抛错不影响 bump 完成与后续清理', () => {
    const g = createLoadGuard();
    const second = vi.fn();
    g.onCleanup(() => { throw new Error('boom'); });
    g.onCleanup(second);
    expect(() => g.bump()).not.toThrow();
    expect(second).toHaveBeenCalled();
  });

  it('isCurrent 能识别已过期的代次', () => {
    const g = createLoadGuard();
    const old = g.gen;
    g.bump();
    expect(g.isCurrent(old)).toBe(false);
    expect(g.isCurrent(g.gen)).toBe(true);
  });
});

describe('createRecoveryGate', () => {
  it('同一时刻只允许一个恢复流程', () => {
    const gate = createRecoveryGate();
    expect(gate.tryEnter()).toBe(true);
    expect(gate.tryEnter()).toBe(false);
    gate.leave();
    expect(gate.tryEnter()).toBe(true);
  });

  it('选择延迟重试后，闸门保持关闭直到重试真正执行', () => {
    // 回归：旧版在 finally 里立即放开闸门，重试执行前第二个超时回调会绕过重试直接切歌
    const gate = createRecoveryGate();
    const retry = vi.fn();
    expect(gate.tryEnter()).toBe(true);
    gate.holdForRetry(RETRY_DELAY_MS, retry);

    expect(gate.tryEnter()).toBe(false);          // 重试前：第二个回调进不来
    vi.advanceTimersByTime(RETRY_DELAY_MS - 1);
    expect(gate.tryEnter()).toBe(false);
    expect(retry).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(retry).toHaveBeenCalledTimes(1);
    expect(gate.busy).toBe(false);                // 重试执行后才放开
    expect(gate.tryEnter()).toBe(true);
  });

  it('reset（切歌）取消尚未执行的重试并放开闸门', () => {
    // 回归：旧版重试任务不可取消，会把刚切换的新歌重载到 0 秒
    const gate = createRecoveryGate();
    const retry = vi.fn();
    gate.tryEnter();
    gate.holdForRetry(RETRY_DELAY_MS, retry);
    gate.reset();
    vi.advanceTimersByTime(RETRY_DELAY_MS * 3);
    expect(retry).not.toHaveBeenCalled();
    expect(gate.busy).toBe(false);
  });

  it('重复 holdForRetry 只保留最后一次', () => {
    const gate = createRecoveryGate();
    const a = vi.fn(); const b = vi.fn();
    gate.tryEnter();
    gate.holdForRetry(RETRY_DELAY_MS, a);
    gate.holdForRetry(RETRY_DELAY_MS, b);
    vi.advanceTimersByTime(RETRY_DELAY_MS);
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });
});

describe('加载代次 + 恢复闸门：播放器典型时序', () => {
  it('加载看门狗超时后触发一次恢复；数据晚到时 canplay 监听仍然有效', () => {
    // 回归：旧版超时回调里直接 removeEventListener，数据稍晚到就再没有人启动播放
    const g = createLoadGuard();
    const listeners = new Set();
    const audio = {
      addEventListener: (_n, f) => listeners.add(f),
      removeEventListener: (_n, f) => listeners.delete(f),
    };
    const onCan = vi.fn();
    audio.addEventListener('canplay', onCan);
    g.onCleanup(() => audio.removeEventListener('canplay', onCan));

    const recover = vi.fn();
    g.setTimer('canplay', 8000, recover);
    vi.advanceTimersByTime(8000);

    expect(recover).toHaveBeenCalledTimes(1);
    expect(listeners.has(onCan)).toBe(true);   // 超时本身不摘除监听
    g.bump();                                    // 只有开启新一轮加载才统一清理
    expect(listeners.has(onCan)).toBe(false);
  });

  it('切歌后旧曲遗留的恢复任务全部作废，且不影响新曲的恢复', () => {
    const g = createLoadGuard();
    const gate = createRecoveryGate();
    const oldRetry = vi.fn(); const newWatchdog = vi.fn();

    gate.tryEnter();
    gate.holdForRetry(RETRY_DELAY_MS, oldRetry);
    g.setTimer('canplay', 8000, vi.fn());

    // 用户切歌（playCurrent 做的事）
    g.bump(); gate.reset();
    g.setTimer('canplay', 8000, newWatchdog);

    vi.advanceTimersByTime(8000);
    expect(oldRetry).not.toHaveBeenCalled();
    expect(newWatchdog).toHaveBeenCalledTimes(1);
    expect(gate.tryEnter()).toBe(true);
  });
});

describe('createCacheScheduler', () => {
  const make = (over = {}) => {
    const run = vi.fn();
    const state = { ready: false, stale: false };
    const sched = createCacheScheduler({
      isReady: () => state.ready, isStale: () => state.stale, run, ...over,
    });
    return { sched, run, state };
  };

  it('未就绪时持续等待，就绪后只执行一次', () => {
    const { sched, run, state } = make();
    sched.schedule('BV1');
    vi.advanceTimersByTime(CACHE_POLL_MS * 5);
    expect(run).not.toHaveBeenCalled();
    state.ready = true;
    vi.advanceTimersByTime(CACHE_POLL_MS);
    expect(run).toHaveBeenCalledWith('BV1');
    vi.advanceTimersByTime(CACHE_POLL_MS * 10);
    expect(run).toHaveBeenCalledTimes(1);
    expect(sched.pending).toBe(false);
  });

  it('曲目已变化（stale）则放弃，不下载上一首', () => {
    const { sched, run, state } = make();
    sched.schedule('BV1');
    state.stale = true; state.ready = true;
    vi.advanceTimersByTime(CACHE_POLL_MS * 3);
    expect(run).not.toHaveBeenCalled();
    expect(sched.pending).toBe(false);
  });

  it('等待超过上限后放弃', () => {
    const { sched, run, state } = make();
    sched.schedule('BV1');
    vi.advanceTimersByTime(CACHE_MAX_WAIT_MS + CACHE_POLL_MS * 2);
    state.ready = true;
    vi.advanceTimersByTime(CACHE_POLL_MS * 5);
    expect(run).not.toHaveBeenCalled();
    expect(sched.pending).toBe(false);
  });

  it('重新 schedule 会取消上一个 key；cancel 后不再执行', () => {
    const { sched, run, state } = make();
    sched.schedule('BV1');
    sched.schedule('BV2');
    state.ready = true;
    vi.advanceTimersByTime(CACHE_POLL_MS);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('BV2');

    sched.schedule('BV3');
    sched.cancel();
    vi.advanceTimersByTime(CACHE_POLL_MS * 5);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('展开视频后再收起：调度不会因 mode 切换而被消耗（回归：旧版固定 15s 定时器过期即丢）', () => {
    let mode = 'bg';
    const run = vi.fn();
    const sched = createCacheScheduler({
      isStale: () => false,
      isReady: () => cacheReady({ mode, crossfading: false, playingSeen: true, viaProxy: true, currentTime: 3, bufferedAhead: 2, readyState: 4, duration: 200 }),
      run,
    });
    sched.schedule('BV1');
    mode = 'iframe';            // 播放 3 秒后用户展开视频：iframe 不占隧道
    vi.advanceTimersByTime(CACHE_POLL_MS);
    expect(run).toHaveBeenCalledWith('BV1');
  });
});
