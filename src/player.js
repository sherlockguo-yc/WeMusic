// ---------------- 播放核心 ----------------
import { $, fmtDur, esc, biliEmbed, albumCover, singerAvatar, toast, PLAY_ICON, PAUSE_ICON, LOADING_ICON, OFFLINE_ICON } from './utils.js';
import * as offline from './offlineCache.js';
import { api, Auth } from './api.js';
import { state } from './state.js';
import { clearSleep, sleepAfterSong } from './settings.js';

// Lucide SVG 图标从 utils.js 导入（避免被 manualChunks 拆分时产生 TDZ 错误）

export let autoTimer = null;
export let elapsed = 0;
export let totalDur = 0;
export let timerPaused = false;
export let playSeq = 0;

// ---- 播放日志 ----
let _logTimer = null;
let _pendingSong = null;
let _pendingDur = 0;
let _pendingLyricsId = null; // 当前播放歌曲的默认歌词源 ID（预取，不依赖歌词面板）

export function logPlay(song, dur) {
  if (!song) return;
  _flushLog(elapsed);
  if (_logTimer) clearTimeout(_logTimer);
  _pendingSong = null; _pendingLyricsId = null;
  _logTimer = setTimeout(() => {
    _pendingSong = song;
    _pendingDur = dur || song.duration || 0;
  }, 3000);
  // 预取默认歌词源 ID（不依赖歌词面板是否打开），确保完播时能统计歌词源
  ensureLyricsSourceId(song);
}

// 页面关闭/刷新时上报最后一次播放日志
function _logBeforeUnload() { _flushLog(elapsed); }
window.addEventListener('beforeunload', _logBeforeUnload);
window.addEventListener('pagehide', _logBeforeUnload);

export function _flushLog(playedSec) {
  if (!_pendingSong) return;
  const song = _pendingSong;
  const dur = _pendingDur;
  const lyricsSourceId = _pendingLyricsId;
  _pendingSong = null; _pendingDur = 0; _pendingLyricsId = null;
  const sec = Math.max(0, Math.min(Math.round(playedSec), dur || 9999));
  if (sec < 5) return;
  api('/stats/log', {
    method: 'POST',
    body: {
      song_mid: song.song_mid, name: song.name, singer: song.singer,
      album: song.album, album_mid: song.album_mid, duration: dur,
      played_sec: sec, bvid: song.bvid,
      lyrics_source_id: lyricsSourceId || undefined,
    },
  }).catch(() => {});
}

/** 预取当前歌曲的默认歌词源 ID，写入 localStorage 缓存 + _pendingLyricsId */
async function ensureLyricsSourceId(song) {
  if (!song || !song.name) return;
  // 先查 localStorage 缓存（lyrics.js 写入的 song_mid → sourceId 映射）
  try {
    const cache = JSON.parse(localStorage.getItem('wemusic_lyrics_src') || '{}');
    if (song.song_mid && cache[song.song_mid]) {
      _pendingLyricsId = cache[song.song_mid];
      return;
    }
  } catch { /* ignored */ }
  // 缓存未命中 → 调公开 API 拉取默认歌词源（无需登录）
  try {
    const params = new URLSearchParams();
    params.set('n', song.name);
    if (song.singer) params.set('a', song.singer);
    const resp = await fetch(`/api/share/lyrics?${params.toString()}`);
    if (!resp.ok) return;
    const data = await resp.json();
    if (data && data.sourceId) {
      _pendingLyricsId = String(data.sourceId);
      // 写入缓存，后续同一首歌命中 localStorage
      try {
        const cache = JSON.parse(localStorage.getItem('wemusic_lyrics_src') || '{}');
        cache[song.song_mid] = data.sourceId;
        localStorage.setItem('wemusic_lyrics_src', JSON.stringify(cache));
      } catch { /* ignored */ }
    }
  } catch { /* 静默失败，不影响播放 */ }
}

// ---- 进度控制 ----
// 圆角方形周长：4*(w-2r) + 2*PI*r = 4*(46-16) + 2*PI*8 ≈ 170.27
const COVER_RING_CIRC = 4 * (46 - 2 * 8) + 2 * Math.PI * 8;

function _updateCoverRing() {
  const ring = $('coverProgressFill');
  if (!ring || totalDur <= 0) return;
  const progress = Math.min(1, elapsed / totalDur);
  ring.style.strokeDashoffset = COVER_RING_CIRC * (1 - progress);
}

function _updateSeekBarUI(elapsed, totalDur) {
  const pct = totalDur > 0 ? Math.min(100, (elapsed / totalDur) * 100) : 0;
  $('seekBar').value = totalDur > 0 ? Math.min(1000, Math.round((elapsed / totalDur) * 1000)) : 0;
  $('seekBar').style.setProperty('--seek-pct', pct + '%');
}

export function resetProgress(d) {
  elapsed = 0; totalDur = Number(d) || 0; timerPaused = false;
  _hasStartedPlaying = false;
  _seekDragging = false;
  $('curTime').textContent = '0:00';
  $('durTime').textContent = fmtDur(totalDur);
  _updateSeekBarUI(0, totalDur);
  const ring = $('coverProgressFill');
  if (ring) ring.style.strokeDashoffset = COVER_RING_CIRC;
}

// ---- 拖拽进度条：跳转播放位置 ----
// 仅 mode === 'bg' 时支持（bgAudio 是 WeMusic 自己的元素，可精确 seek）。
// mode === 'iframe' 时禁用：B 站官方未公开支持通过 postMessage 精确 seek 的协议，
// 此时进度条保持 disabled，请用户在视频内使用 B 站播放器自带的进度条。
export function seekTo(sec) {
  if (mode !== 'bg' || !state.current) return;
  sec = Math.max(0, totalDur > 0 ? Math.min(sec, totalDur) : sec);
  elapsed = sec;
  _hasStartedPlaying = true; // 跳转后即视为"已开始播放过"，避免误判为加载中
  _lastTickCurrentTime = sec; _stallTicks = 0; // 避免跳转产生的大幅跳变被误判为停滞
  if (bgAudio.readyState >= 1) {
    try { bgAudio.currentTime = sec; } catch { /* metadata 未加载完成，忽略 */ }
  }
  _updateSeekBarUI(elapsed, totalDur);
  _updateCoverRing();
  $('curTime').textContent = fmtDur(elapsed);
  if (!timerPaused) bgAudio.play().catch(() => {});
  _updateMediaSessionPosition();
}

// 根据当前 mode 切换进度条是否可拖动（展开视频时禁用）
function _updateSeekInteractivity() {
  const disabled = mode !== 'bg';
  const tip = disabled ? '展开视频时请在视频内拖动进度条' : '';
  $('seekBar').disabled = disabled;
  $('seekBar').title = tip;
  const lpSeekBar = $('lpSeekBar');
  if (lpSeekBar) { lpSeekBar.disabled = disabled; lpSeekBar.title = tip; }
}

// 同步播放进度到系统媒体控件（锁屏/通知中心/耳机快进快退），支持系统级拖动进度条
function _updateMediaSessionPosition() {
  if (!('mediaSession' in navigator) || typeof navigator.mediaSession.setPositionState !== 'function') return;
  if (!(totalDur > 0)) return;
  try {
    navigator.mediaSession.setPositionState({
      duration: totalDur,
      playbackRate: timerPaused ? 0 : 1,
      position: Math.min(Math.max(elapsed, 0), totalDur),
    });
  } catch { /* 部分浏览器对该 API 支持不完整，静默失败 */ }
}

// ---- 计时器 / 进度驱动 ----
// mode === 'bg'：唯一常规模式，进度直接读取 bgAudio.currentTime（真实播放位置）。
// mode === 'iframe'：仅当用户点击「展开」观看视频时进入，B 站 iframe 跨域，无法读取真实进度，
//                     只能用「每秒 +1」的计时器估算（与展开前的历史实现一致）。
let _lastTickCurrentTime = 0;
let _stallTicks = 0;
const STALL_TICK_THRESHOLD = 5; // 连续 5 次（约 5 秒）currentTime 无变化 → 判定播放流已死
let _hasStartedPlaying = false; // 当前曲目是否已经成功开始播放过一次（区分"加载中"与"意外暂停"）
let _seekDragging = false; // 用户正在拖动进度条：暂停 tick 对进度条/时间文字的覆盖，避免和拖拽打架

function _tick() {
  if (timerPaused || _seekDragging) return;
  if (mode === 'bg') {
    // 淡入淡出期间：elapsed 由 _crossfadeStartTime 合成，代表新歌已播放的时间。
    // 使用合成时间而不用 bgAudio.currentTime，因为 bgAudio 此时还在播放旧歌。
    if (_crossfading) {
      elapsed = Math.floor((Date.now() - _crossfadeStartTime) / 1000);
    } else {
      if (bgAudio.duration && isFinite(bgAudio.duration)) totalDur = Math.floor(bgAudio.duration);
      const ct = bgAudio.currentTime || 0;
      elapsed = Math.floor(ct);
    }
    $('curTime').textContent = fmtDur(elapsed);
    if (totalDur > 0) { _updateSeekBarUI(elapsed, totalDur); _updateCoverRing(); _updateMediaSessionPosition(); }
    if (!bgAudio.paused) _hasStartedPlaying = true;
    if (bgAudio.paused) {
      // 尚未成功开始播放过（曲目还在加载中）属于正常状态，不算"意外暂停"
      // crossfade 期间 bgAudio 可能自然结束（旧歌），跳过恢复逻辑
      if (_hasStartedPlaying && !_crossfading) {
        console.warn('[bgAudio] 意外暂停，尝试恢复播放');
        bgAudio.play().catch(() => {});
      }
    } else if (!_crossfading && Math.abs(bgAudio.currentTime - _lastTickCurrentTime) < 0.3) {
      _stallTicks++;
      if (_stallTicks >= STALL_TICK_THRESHOLD) {
        console.warn(`[bgAudio] currentTime 停滞 ${STALL_TICK_THRESHOLD}s+，自动切歌`);
        _stallTicks = 0;
        autoAdvance();
        return;
      }
    } else if (!_crossfading) {
      _stallTicks = 0;
    }
    _lastTickCurrentTime = _crossfading ? elapsed : (bgAudio.currentTime || 0);
  } else {
    // iframe 展开模式：计时器估算进度（跨域无法读取真实播放位置）
    elapsed++;
    $('curTime').textContent = fmtDur(elapsed);
    if (totalDur > 0) {
      _updateSeekBarUI(elapsed, totalDur);
      _updateCoverRing();
      _updateMediaSessionPosition();
      if (elapsed >= totalDur + 1) autoAdvance();
    }
  }
}

// 重启计时器但不重置 timerPaused / 播放按钮图标（用于展开/收起视频时的引擎切换）
function _restartTick() {
  if (autoTimer) clearInterval(autoTimer);
  _lastTickCurrentTime = mode === 'bg' ? (bgAudio.currentTime || 0) : elapsed;
  _stallTicks = 0;
  autoTimer = setInterval(_tick, 1000);
}

export function startTimer(d) {
  totalDur = Number(d) || totalDur || (state.current && state.current.duration) || 0;
  $('durTime').textContent = fmtDur(totalDur);
  timerPaused = false;
  $('playPauseBtn').innerHTML = PAUSE_ICON;
  $('playPauseBtn').title = '暂停自动连播';
  _restartTick();
}

export function stopTimer() {
  if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
}

// 检测文本溢出：比较 inner.scrollWidth（文本宽度）vs 父级.clientWidth（可见宽度）
// ---- 匀速滚动驱动 ----
// rAF 状态机：暂停 → 滚动 → 暂停 → 回滚，40px/s 匀速，支持 hover 暂停
function startMarquee(inner, extra) {
  if (extra <= 0) return;
  const SPEED = 40; // px/s
  const PAUSE = 2000; // ms
  const scrollTime = (extra / SPEED) * 1000;
  const cycle = PAUSE * 2 + scrollTime * 2;

  let t = 0, lastTs = 0, running = true;

  function tick(ts) {
    inner._mId = requestAnimationFrame(tick);
    if (!running) return; // hover 暂停
    if (!lastTs) lastTs = ts;
    const dt = Math.min(ts - lastTs, 100); // 防止切回后跳帧
    t += dt;
    lastTs = ts;

    const ct = t % cycle;
    let px;
    if (ct < PAUSE) {
      px = 0;
    } else if (ct < PAUSE + scrollTime) {
      px = -extra * ((ct - PAUSE) / scrollTime);
    } else if (ct < PAUSE * 2 + scrollTime) {
      px = -extra;
    } else {
      px = -extra * (1 - (ct - PAUSE * 2 - scrollTime) / scrollTime);
    }
    inner.style.transform = `translateX(${px.toFixed(1)}px)`;
  }

  inner.addEventListener('mouseenter', () => { running = false; });
  inner.addEventListener('mouseleave', () => { running = true; lastTs = 0; });
  inner._mId = requestAnimationFrame(tick);
}

// 检测溢出 → 启动/停止滚动
function checkMarquee(el) {
  if (!el) return;
  const parent = el.parentElement;
  if (!parent) return;
  if (el._mId) { cancelAnimationFrame(el._mId); el._mId = 0; }
  el.classList.remove('marquee');
  el.style.transform = '';
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const overflow = el.scrollWidth - parent.clientWidth;
      if (overflow > 4) { el.classList.add('marquee'); startMarquee(el, overflow + 8); }
    });
  });
}

function autoAdvance() {
  const oldBvid = state.current?.bvid;
  console.log(`[advance] autoAdvance (mode=${mode}, elapsed=${elapsed}s, dur=${totalDur}s, crossfadeDur=${_crossfadeDuration}, timerPaused=${timerPaused}, crossfading=${_crossfading}, oldBvid=${oldBvid?.slice(0,12) || 'none'})`);
  stopTimer();
  _flushLog(totalDur || elapsed);
  if (sleepAfterSong) { stopPlayback(); clearSleep(); toast('定时已到，已停止'); return; }
  if (state.playMode === 'single') { console.log('[advance] single mode → playCurrent'); playCurrent(); return; }

  // 淡入淡出：仅 bg 模式 + 已启用 + 下一首有 bvid 时生效
  const i = computeNextIndex();
  const nextSong = i >= 0 ? state.queue[i] : null;
  console.log(`[advance] nextIndex=${i}, nextSong=${nextSong?.name || 'none'}, nextBvid=${nextSong?.bvid?.slice(0,12) || 'none'}, crossfading=${_crossfading}, gainNode=${!!_gainNode}`);
  if (_crossfadeDuration > 0 && mode === 'bg' && i >= 0 && i !== state.queueIndex) {
    if (nextSong && nextSong.bvid && _gainNode) {
      // 更新队列状态（与 playNext 一致）
      if (state.playMode === 'shuffle') state.history.push(state.queueIndex);
      state.queueIndex = i;

      if (!oldBvid) { console.log('[advance] no oldBvid → fallback to playCurrent'); playCurrent(); return; } // 无旧 bvid（异常情况）→ 退化为常规切歌

      // 更新 UI 到下一首歌（同时保持歌词显示旧歌——方案 B）
      // 注意：不在这里加载新歌歌词（loadLyrics）—— 留在 _completeCrossfade 中执行
      _switchCurrentSongUI(nextSong);
      startTimer(nextSong._biliDur || nextSong.duration);
      saveSession();
      import('./queue.js').then(({ pushPlayHistory, renderActiveTab }) => {
        pushPlayHistory(nextSong);
        if ($('queueDrawer').classList.contains('show')) renderActiveTab();
      });
      logPlay(nextSong, nextSong._biliDur || nextSong.duration);
      // 注意：不在这里加载新歌歌词（loadLyrics）—— 留在 _completeCrossfade 中执行
      // 启动淡入淡出音频过渡
      console.log('[advance] → starting crossfade');
      _startCrossfade(nextSong.bvid);
      return;
    }
    console.log(`[advance] crossfade skipped: nextSong=${!!nextSong}, nextBvid=${!!nextSong?.bvid}, gainNode=${!!_gainNode}`);
  }
  console.log('[advance] → falling back to playNext (no crossfade)');
  playNext(true);
}

export function stopPlayback() {
  destroyVideo();
  setStatus('已停止');
  document.title = 'WeMusic · 个人音乐';
}

// 更新当前播放歌曲的 UI（歌名、封面、进度条等），供 playCurrent 和 autoAdvance 共用
function _switchCurrentSongUI(song) {
  state.current = song;
  highlightPlaying();
  $('npTitle').textContent = song.singer ? `${song.name} - ${song.singer}` : song.name;
  checkMarquee($('npTitle'));
  document.title = `${song.name}${song.singer ? ' · ' + song.singer.split('/')[0] : ''} — WeMusic`;
  updateNpCover(song);
  updateMediaSession(song);
  setTimeout(() => import('./ui.js').then(({ updateNpLikeBtn, updateNpDislikeBtn }) => { updateNpLikeBtn(); updateNpDislikeBtn(); }), 0);
  resetProgress(song.duration);
}

// ---- 状态栏 ----
export function setStatus(html) { $('playStatus').innerHTML = html; }

// ---- 视频面板 ----
export function setVpTitle(title) {
  const el = $('vpTitle');
  const text = title || 'Bilibili 播放';
  el.innerHTML = `<span class="vp-title-inner">${text}</span>`;
  const inner = el.querySelector('.vp-title-inner');
  // 清理旧动画：旧的 inner 已被 innerHTML 销毁，但 _mId 可能残留
  if (inner._mId) { cancelAnimationFrame(inner._mId); inner._mId = 0; }
  inner.classList.remove('scrolling');
  inner.style.transform = '';
  el.style.textOverflow = ''; // 恢复 ellipsis（由 CSS 控制）
  // 必须双帧 rAF：视频浮窗可能从 display:none 变为 display:flex，
  // 浏览器需要两帧才能完成 flex 布局计算。单帧会读到 clientWidth=0。
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (el.clientWidth <= 0) return; // 浮窗未显示，不启动滚动
      const overflow = inner.scrollWidth - el.clientWidth;
      if (overflow > 4) {
        inner.classList.add('scrolling');
        el.style.textOverflow = 'clip'; // 滚动时禁止 ellipsis 截断
        startMarquee(inner, overflow + 8);
      }
    });
  });
}

export function mountVideo(bvid, title) {
  mountVideoAt(bvid, title, 0);
}

// 带起始时间戳挂载 iframe（展开视频/切歌时对齐进度用）
export function mountVideoAt(bvid, title, startSec) {
  setVpTitle(title);
  $('videoContainer').innerHTML =
    `<iframe src="${biliEmbed(bvid, startSec)}" allowfullscreen allow="autoplay; fullscreen" scrolling="no" frameborder="0"></iframe>`;
  // 记录 iframe 创建的时间戳，用于检测 B 站视频真实启动时间
  $('videoContainer').dataset.mountedAt = Date.now();
}

// 完全停止播放：销毁 iframe（如果有）+ 停止 bgAudio + 停止计时器
export function destroyVideo() {
  $('videoPane').classList.remove('show', 'fullscreen');
  $('videoContainer').innerHTML = '';
  $('videoBtn').textContent = '展开';
  bgAudio.pause();
  bgAudio.removeAttribute('src');
  bgAudio.load();
  if (_cacheUrl) { URL.revokeObjectURL(_cacheUrl); _cacheUrl = null; }
  _cacheUse = null;
  _weakFallback = false;
  mode = 'bg';
  stopTimer();
}

// ---- 封面/高亮 ----
export function updateNpCover(song) {
  const wrap = $('npCoverWrap');
  const npc = $('npCover');
  const albumUrl = albumCover(song && song.album_mid, 150);
  const singerUrl = singerAvatar(song && song.singer_mid, 150);

  // 清除旧状态
  npc.style.backgroundImage = '';
  npc.classList.remove('has-cover');

  // 加载函数：成功设背景，失败走 fallback
  function tryLoad(url, fallback) {
    if (!url) return fallback();
    const img = new Image();
    img.onload = () => {
      npc.style.backgroundImage = `url(${url})`;
      npc.classList.add('has-cover');
    };
    img.onerror = () => {
      npc.style.backgroundImage = '';
      npc.classList.remove('has-cover');
      fallback();
    };
    img.src = url;
  }

  // 始终显示封面区域（用户需要点击进入歌词详情页）
  wrap.classList.add('show');

  // 三级兜底：专辑封面 → 歌手头像 → 默认音符图标
  tryLoad(albumUrl, () => {
    tryLoad(singerUrl, () => {
      // 默认音符图标已在 HTML 中，无 .has-cover 时自动可见
    });
  });
}

export function highlightPlaying() {
  document.querySelectorAll('.song-row.playing').forEach((r) => r.classList.remove('playing'));
  if (!state.current) return;
  const curKey = `${state.current.name}__${state.current.singer || ''}`;
  document.querySelectorAll('.song-list').forEach((list) => {
    if (!list._songs) return; // 跳过无数据引用的列表
    // 当前播放列表：直接用 index 查找
    if (list._songs === state.queue && state.queueIndex >= 0) {
      const row = list.querySelector(`.song-row[data-i="${state.queueIndex}"]`);
      if (row) { row.classList.add('playing'); try { row.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch {} }
      return;
    }
    // 其他列表：用内存数组查找索引，再取 DOM 行（避免遍历所有 DOM 行）
    const idx = list._songs.findIndex((s) => `${s.name}__${s.singer || ''}` === curKey);
    if (idx >= 0) {
      const row = list.querySelector(`.song-row[data-i="${idx}"]`);
      if (row) row.classList.add('playing');
    }
  });
}

// ---- 会话持久化 ----
let _saveSessTimer = null;
export function saveSession() {
  if (_saveSessTimer) clearTimeout(_saveSessTimer);
  _saveSessTimer = setTimeout(() => {
    try {
      const q = state.queue.slice(0, 800).map((s) => ({
        id: s.id, song_mid: s.song_mid, name: s.name, singer: s.singer,
        singer_mid: s.singer_mid, album: s.album, album_mid: s.album_mid,
        duration: s.duration, bvid: s.bvid,
        _biliTitle: s._biliTitle, _biliDur: s._biliDur,
      }));
      const data = { queue: q, queueIndex: state.queueIndex };
      localStorage.setItem('wemusic_session', JSON.stringify(data));
      // 跨设备同步到服务端
      api('/auth/session', { method: 'PUT', body: data }).catch(() => {});
    } catch { console.warn('保存本地会话失败') }
  }, 500);
}

export function flushSession() { if (_saveSessTimer) { clearTimeout(_saveSessTimer); saveSession(); } }

export async function restoreSession() {
  let s = null;
  // 优先从服务端恢复（跨设备同步），失败回退 localStorage
  try {
    const r = await api('/auth/session');
    if (r && Array.isArray(r.queue) && r.queue.length > 0) {
      s = r;
    }
  } catch { console.warn('服务端会话恢复失败，回退本地') }
  if (!s) {
    try {
      s = JSON.parse(localStorage.getItem('wemusic_session') || 'null');
      if (!s || !Array.isArray(s.queue) || s.queue.length === 0) s = null;
    } catch { s = null; }
  }
  if (!s) return;
  state.queue = s.queue;
  state.queueIndex = s.queueIndex >= 0 && s.queueIndex < s.queue.length ? s.queueIndex : 0;
  state.current = state.queue[state.queueIndex];
  if (state.current) {
    $('npTitle').textContent = state.current.singer ? `${state.current.name} - ${state.current.singer}` : state.current.name;
    checkMarquee($('npTitle'));
    updateNpCover(state.current);
    $('durTime').textContent = fmtDur(state.current._biliDur || state.current.duration);
    setStatus(`上次播放 · 点 ▶ 恢复连播`);
    highlightPlaying();
  }
}

// ---- bvid 缓存 ----
// 优先用 song_mid 作 key；无 song_mid 时用 "name__singer" 作备用 key
export function bvidCacheKey(song) {
  return song.song_mid || `__${song.name}__${song.singer || ''}`;
}

export function cacheBvid(song) {
  if (state.currentContext && song.id) {
    api(`/playlists/${state.currentContext}/songs/${song.id}/bvid`, {
      method: 'PUT', body: { bvid: song.bvid },
    }).catch(() => {});
  }
  const key = bvidCacheKey(song);
  if (key) {
    api(`/stats/bvid/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: { name: song.name, singer: song.singer, bvid: song.bvid, bili_title: song._biliTitle, bili_dur: song._biliDur },
    }).catch(() => { console.warn('全局 bvid 缓存保存失败') });
  }
}

// ---- Media Session ----
export function updateMediaSession(song) {
  if (!song || !('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: song.name, artist: song.singer || '', album: song.album || '',
    artwork: song.album_mid ? [{ src: albumCover(song.album_mid, 300), sizes: '300x300', type: 'image/jpeg' }] : [],
  });
  navigator.mediaSession.playbackState = 'playing';
}

// ---- 播放模式 ----
const MODE_META = {
  loop: {
    label: '列表循环',
    icon: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M17 2l4 4-4 4"/>
      <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
      <path d="M7 22l-4-4 4-4"/>
      <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
    </svg>`,
  },
  single: {
    label: '单曲循环',
    icon: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M17 2l4 4-4 4"/>
      <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
      <path d="M7 22l-4-4 4-4"/>
      <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
      <path d="M11 17V9l-2 2"/>
    </svg>`,
  },
  shuffle: {
    label: '随机播放',
    icon: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M16 3h5v5"/>
      <path d="M4 20l17-17"/>
      <path d="M21 16v5h-5"/>
      <path d="M4 4l5 5"/>
      <path d="M15 15l5 5"/>
    </svg>`,
  },
};
const MODE_ORDER = ['loop', 'single', 'shuffle'];

export function renderMode() {
  const m = MODE_META[state.playMode] || MODE_META.loop;
  const btn = $('modeBtn');
  if (!m._node) { const t = document.createElement('template'); t.innerHTML = m.icon; m._node = t.content.firstChild; }
  btn.replaceChildren(m._node.cloneNode(true));
  btn.title = '播放模式：' + m.label;
  btn.dataset.mode = state.playMode;
}

// 不喜欢跳过工具函数
const _songKey = (s) => `${s.name}__${s.singer || ''}`;
const _isDisliked = (s) => state.dislikedSongKeys && state.dislikedSongKeys.has(_songKey(s));

export function computeNextIndex() {
  const n = state.queue.length;
  if (n === 0) return -1;
  // 只有一首歌 → 让 playCurrent 自己判断（避免死循环）
  if (n === 1) return 0;
  if (state.playMode === 'shuffle') {
    const maxTries = n * 5;
    for (let t = 0; t < maxTries; t++) {
      const i = Math.floor(Math.random() * n);
      if (i !== state.queueIndex && !_isDisliked(state.queue[i])) return i;
    }
    return -1; // 全部不喜欢
  }
  // 顺序模式：向后走，跳过不喜欢，循环
  for (let step = 1; step <= n; step++) {
    const i = (state.queueIndex + step) % n;
    if (!_isDisliked(state.queue[i])) return i;
  }
  return -1; // 全部不喜欢
}

export function playPrev() {
  if (_crossfading) _cancelCrossfade();
  if (state.queue.length === 0) return;
  const n = state.queue.length;
  if (state.playMode === 'shuffle' && state.history.length) {
    while (state.history.length > 0) {
      const idx = state.history.pop();
      if (!_isDisliked(state.queue[idx])) {
        state.queueIndex = idx;
        playCurrent();
        return;
      }
    }
  }
  // 顺序模式 / shuffle 历史已耗尽：向前走，跳过不喜欢
  let idx = state.queueIndex > 0 ? state.queueIndex - 1 : n - 1;
  for (let step = 0; step < n; step++) {
    if (!_isDisliked(state.queue[idx])) {
      state.queueIndex = idx;
      playCurrent();
      return;
    }
    idx = idx > 0 ? idx - 1 : n - 1;
  }
  toast('队列中的歌曲均已标记为不喜欢');
}

export function playNext(auto = false) {
  console.log(`[player] playNext auto=${auto}, crossfading=${_crossfading}, queueIndex=${state.queueIndex}/${state.queue.length}`);
  if (_crossfading) _cancelCrossfade();
  const i = computeNextIndex();
  if (i === -1) {
    if (state.queue.length > 0) toast('队列中的歌曲均已标记为不喜欢');
    return;
  }
  if (state.playMode === 'shuffle') state.history.push(state.queueIndex);
  state.queueIndex = i;
  playCurrent();
}

// 预解析下一首的 bvid，写回歌曲对象。用于后台自动切歌时无需现场 await。
export async function prefetchNextBvid() {
  try {
    const i = computeNextIndex();
    if (i < 0) return;
    const song = state.queue[i];
    if (!song || song.bvid) return; // 已有 bvid，无需预取
    try {
      const key = bvidCacheKey(song);
      const cached = await api(`/stats/bvid/${encodeURIComponent(key)}`);
      if (cached.cached) {
        song.bvid = cached.bvid;
        song._biliTitle = cached.bili_title;
        song._biliDur = cached.bili_dur || song.duration;
        // 缓存里 bili_title 可能为空 → 回查 candidates
        if (!song._biliTitle && song._candidates) {
          const m = song._candidates.find(c => c.bvid === song.bvid);
          if (m?.title) song._biliTitle = m.title;
        }
        return;
      }
    } catch { console.warn('bvid 缓存读取失败') }
    const { best, candidates, _debug } = await api('/play/resolve', {
      method: 'POST',
      body: { name: song.name, singer: song.singer, duration: song.duration },
    });
    song._candidates = candidates;
    if (_debug) song._debug = _debug;
    if (best) {
      song.bvid = best.bvid;
      // 优先用 candidates 里同名 bvid 的 title
      const match = best.bvid ? candidates.find(c => c.bvid === best.bvid) : null;
      song._biliTitle = match?.title || best.title || '';
      song._biliDur = match?.duration || best.duration || song.duration;
      cacheBvid(song);
    }
  } catch { console.warn('预取 bvid 失败') }
}

export async function playFromList(songs, index, context, playlistId) {
  _resolveFailCount = 0;  // 新播放列表，重置连续失败计数
  // 队列中有待播歌时，提示替换
  const hasPending = state.queueIndex >= 0 && state.queue.length > state.queueIndex + 1;
  state.queue = songs;
  state.queueIndex = index;
  state.currentContext = context === 'playlist' ? playlistId : null;
  if (hasPending) {
    toast('已替换播放队列');
  }
  await playCurrent();
}

export async function playCurrent() {
  console.log(`[player] playCurrent queueIndex=${state.queueIndex}/${state.queue.length}, crossfading=${_crossfading}, mode=${mode}`);
  _flushLog(elapsed);
  stopTimer();
  if (_cacheUrl) { URL.revokeObjectURL(_cacheUrl); _cacheUrl = null; }
  _cacheUse = null;
  const song = state.queue[state.queueIndex];
  if (!song) return;

  // 跳过不喜欢：如果当前歌曲已被标记为不喜欢，自动切下一首
  if (_isDisliked(song)) {
    stopPlayback();
    if (state.queue.length === 1) {
      toast('这首歌已被标记为不喜欢');
      return;
    }
    playNext(true);
    return;
  }

  const seq = ++playSeq;
  _switchCurrentSongUI(song);

  if (!song.bvid) {
    try {
      const key = bvidCacheKey(song);
      const cached = await api(`/stats/bvid/${encodeURIComponent(key)}`);
      if (cached.cached && seq === playSeq) {
        song.bvid = cached.bvid;
        song._biliTitle = cached.bili_title;
        song._biliDur = cached.bili_dur || song.duration;
      }
    } catch { console.warn('bvid 缓存读取失败') }
    // 缓存里 bili_title 可能为空 → 回查 candidates 补全
    if (song.bvid && !song._biliTitle && song._candidates) {
      const m = song._candidates.find(c => c.bvid === song.bvid);
      if (m?.title) song._biliTitle = m.title;
    }
  }

  if (!song.bvid) {
    // 全局缓存未命中 → 需要 B 站搜索匹配（耗时 1-3s），显示加载态
    $('playPauseBtn').innerHTML = LOADING_ICON;
    $('npCoverWrap').classList.add('loading');
    setStatus('正在从 Bilibili 匹配资源…');
    try {
      const { best, candidates, _debug } = await api('/play/resolve', {
        method: 'POST',
        body: { name: song.name, singer: song.singer, duration: song.duration },
      });
      if (seq !== playSeq) return;
      song._candidates = candidates;
      if (_debug) song._debug = _debug;
      if (!best) {
        $('playPauseBtn').innerHTML = PLAY_ICON;
        $('npCoverWrap').classList.remove('loading');
        _resolveFailCount++;
        if (_resolveFailCount >= 5 || state.playMode === 'single' || state.queue.length <= 1) {
          stopPlayback();
          const reason = _resolveFailCount >= 5 ? '，已连续跳过 5 首' : '';
          setStatus('未找到合适资源'); toast('⚠ 未找到合适资源' + reason);
          _resolveFailCount = 0;
          return;
        }
        setStatus('未找到合适资源，已自动跳过'); toast('⚠ 未找到合适资源，自动切下一首');
        playNext(true);
        return;
      }
      song.bvid = best.bvid;
      // 优先用 candidates 里同名 bvid 的 title（B 站偶尔返回 best.title 为空时回查）
      const match = best.bvid ? candidates.find(c => c.bvid === best.bvid) : null;
      song._biliTitle = match?.title || best.title || '';
      song._biliDur = (match?.duration || best.duration || song.duration);
      cacheBvid(song);
      _resolveFailCount = 0;  // resolve 成功，重置连续失败计数
    } catch (e) {
      if (seq !== playSeq) return;
      $('playPauseBtn').innerHTML = PLAY_ICON;
      $('npCoverWrap').classList.remove('loading');
      _resolveFailCount++;
      if (_resolveFailCount >= 5 || state.playMode === 'single' || state.queue.length <= 1) {
        stopPlayback();
        const reason = _resolveFailCount >= 5 ? '，已连续跳过 5 首' : '';
        setStatus('匹配失败：' + esc(e.message)); toast('⚠ 匹配失败' + reason);
        _resolveFailCount = 0;
        return;
      }
      setStatus('匹配失败，已自动跳过'); toast('⚠ 匹配失败：' + esc(e.message) + '，自动切下一首');
      playNext(true);
      return;
    }
  }

  // 已有 bvid 但缺少 _biliTitle（如分享链接预设了 bvid）→ 补查 resolve 拿标题
  if (song.bvid && !song._biliTitle) {
    // 先尝试从已缓存的 candidates 中匹配
    if (song._candidates) {
      const m = song._candidates.find(c => c.bvid === song.bvid);
      if (m?.title) song._biliTitle = m.title;
    }
    // 仍未匹配到 → 调 resolve 拉取候选列表
    if (!song._biliTitle) {
      try {
        const { best, candidates, _debug } = await api('/play/resolve', {
          method: 'POST',
          body: { name: song.name, singer: song.singer, duration: song.duration },
        });
        if (seq !== playSeq) return;
        song._candidates = candidates;
        if (_debug) song._debug = _debug;
        const match = candidates.find(c => c.bvid === song.bvid);
        song._biliTitle = match?.title || best?.title || '';
        if (!song._biliDur) song._biliDur = (match?.duration || best?.duration || song.duration);
        cacheBvid(song);
      } catch { console.warn('补查 _biliTitle 失败') }
    }
  }

  if (seq !== playSeq) return;
  // 清理加载态（如果之前进入了 resolve 分支）
  $('npCoverWrap').classList.remove('loading');
  // 当前曲目 bvid 已确认，立即并行预取下一首，与直链解析/音频加载并行
  prefetchNextBvid();
  startVideo(song.bvid, song._biliTitle, song._biliDur || song.duration);
}

// ---- 音频播放引擎 ----
// WeMusic 只有一个真正会发声的「音频源」：bgAudio（一个隐藏的 <audio> 元素）。
// 无论用户在前台还是后台，日常听歌全部由 bgAudio 播放，因此不再需要「前后台切换引擎」
// 那一整套交叉过渡/健康检查逻辑。
//
// 唯一的例外：用户主动点击「展开」想看视频画面时，切换为 B 站官方 iframe（画面+声音）。
// 点击「收起」/关闭视频面板后，立即销毁 iframe，改回 bgAudio 从记录的进度继续播放声音。
//
// mode: 'bg'（默认，唯一常规模式） | 'iframe'（用户展开视频时）
let mode = 'bg';
const bgAudio = document.getElementById('audio');
let _usedFallback = false;
let _cacheUrl = null;
let _cacheUse = null;
let _weakFallback = false;   // 当前曲目是否已经从「直连 CDN」降级到「服务端代理」
let _healthCheckId = null;   // play() 成功后 5s 健康检查 setTimeout ID
let _stalledTimer = null;    // stalled 事件 3s 兜底切歌 setTimeout ID
let _resolveFailCount = 0;   // 连续 resolve 失败计数，≥5 首后停止自动跳过
let _volume = 0.8;           // 用户手动设置的音量（0~1），持久化，前后台/是否展开视频都用同一个值

// ---- 淡入淡出（crossfade）----
let _nextAudio = null;        // 第二个 <audio>，淡入淡出时播放下一首
let _nextGainNode = null;     // _nextAudio 的 GainNode
let _nextSource = null;       // _nextAudio 的 MediaElementSource
let _crossfadeDuration = 5;   // 淡入淡出时长（秒），0 表示关闭
let _crossfading = false;     // 是否正在淡入淡出
let _crossfadeBvid = null;    // 正在淡入的 bvid
let _crossfadeEndTimer = null; // 淡入淡出结束 setTimeout
let _crossfadeSeq = 0;        // 序列号，防止并发
let _crossfadeStartTime = 0;  // crossfade 开始的时间戳（ms），驱动进度条合成 elapsed
let _nextNormGain = 1.0;      // 下一首的归一化 gain

// ---- 均衡器（EQ）：5 段 BiquadFilter 预设曲线 ----
// 频段：60Hz(lowshelf) / 250Hz(peaking) / 1kHz(peaking) / 4kHz(peaking) / 12kHz(highshelf)
// 两根 gain node 合并后统一经过 EQ 链，保证淡入淡出期间的混合输出也走 EQ
const EQ_BANDS = [60, 250, 1000, 4000, 12000];
const EQ_TYPES = ['lowshelf', 'peaking', 'peaking', 'peaking', 'highshelf'];
const EQ_PRESETS = {
  flat:    [ 0,  0,  0,  0,  0],
  流行:    [+2, +1, +1, +2, +2],
  摇滚:    [+4, +2, -2, +2, +4],
  古典:    [+1, +1,  0,  0, -1],
  人声:    [-3, -2, +4, +2,  0],
  电子:    [+5, -1, -3, +1, +5],
};
let _eqFilters = [];          // 5 个 BiquadFilterNode
let _eqPreset = 'flat';       // 当前预设
let _analyserNode = null;    // AnalyserNode（音频可视化）

// ---- 音量归一化：AudioContext + GainNode ----
// GainNode 挂在 bgAudio 上，因此无论 bgAudio 是否正在展开视频时静默预载，
// 只要它是真正在出声的引擎（mode === 'bg'），归一化效果就会生效。
let _audioCtx = null;
let _gainNode = null;
let _normGain = 1.0;         // 服务端查询到的归一化 gain，默认 1.0（无归一化）
let _volBtn = null;          // 音量按钮 DOM 引用（用于 tooltip 显示 gain）

function _initAudioCtx() {
  if (_audioCtx) return;
  _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  // bgAudio 管线
  const source = _audioCtx.createMediaElementSource(bgAudio);
  _gainNode = _audioCtx.createGain();
  source.connect(_gainNode);
  // _nextAudio 管线（淡入淡出用，初始静音）
  _nextAudio = document.getElementById('audioNext');
  _nextSource = _audioCtx.createMediaElementSource(_nextAudio);
  _nextGainNode = _audioCtx.createGain();
  _nextSource.connect(_nextGainNode);
  _nextGainNode.gain.value = 0;
  _nextAudio.volume = 1.0;
  // EQ 滤镜链：两根 gain 合并 → 5 段 BiquadFilter → destination
  for (let i = 0; i < 5; i++) {
    const f = _audioCtx.createBiquadFilter();
    f.type = EQ_TYPES[i];
    f.frequency.value = EQ_BANDS[i];
    if (EQ_TYPES[i] === 'peaking') f.Q.value = 1.0;
    f.gain.value = 0; // 默认 flat
    _eqFilters.push(f);
  }
  // 音频可视化：AnalyserNode 插在 gain 合并点和 EQ 之间
  _analyserNode = _audioCtx.createAnalyser();
  _analyserNode.fftSize = 256;
  _gainNode.connect(_analyserNode);
  _nextGainNode.connect(_analyserNode);
  _analyserNode.connect(_eqFilters[0]);
  for (let i = 1; i < 5; i++) _eqFilters[i - 1].connect(_eqFilters[i]);
  _eqFilters[4].connect(_audioCtx.destination);
  const resume = () => {
    if (_audioCtx.state === 'suspended') _audioCtx.resume();
    document.removeEventListener('click', resume);
    document.removeEventListener('keydown', resume);
  };
  document.addEventListener('click', resume);
  document.addEventListener('keydown', resume);
}

// 应用 EQ 预设：将各组增益写入对应的 BiquadFilter
function _applyEQPreset(preset) {
  if (!_eqFilters.length) return;
  const gains = EQ_PRESETS[preset] || EQ_PRESETS.flat;
  _eqPreset = preset;
  const now = _audioCtx.currentTime;
  for (let i = 0; i < 5; i++) {
    _eqFilters[i].gain.cancelScheduledValues(now);
    _eqFilters[i].gain.linearRampToValueAtTime(gains[i], now + 0.01);
  }
}

async function _fetchGain(bvid) {
  try {
    const r = await api(`/play/gain?bvid=${encodeURIComponent(bvid)}`);
    if (r.gain != null && typeof r.gain === 'number') {
      _normGain = r.gain;
      _applyNormVol();
    }
  } catch { /* gain API 不可用时不影响播放 */ }
}

function _applyNormVol() {
  if (!_gainNode) return;
  const skipNorm = localStorage.getItem('wemusic_volume_normalize') !== '1';
  // 输出级安全阀：归一化增益不超过 8 倍，防止极静音频放大后炸耳朵
  const safeGain = Math.min(_normGain, 8.0);
  const effectiveGain = skipNorm ? _volume : (safeGain * _volume);
  // 淡入淡出期间：_gainNode 由 linearRampToValueAtTime 驱动，不覆盖
  if (!_crossfading) {
    _gainNode.gain.value = effectiveGain;
  }
  // 更新音量按钮 tooltip，显示归一化增益
  if (_volBtn) {
    const normInfo = skipNorm ? '归一化已关闭'
      : (_normGain !== 1.0 ? `增益 ${_normGain.toFixed(2)}x` : '增益 1.00x（无缓存）');
    _volBtn.title = mode === 'iframe' ? `音量 | ${normInfo}（展开视频时请在视频内调节）` : `音量 | ${normInfo}`;
  }
}

// 解析可播放地址：
//  - 离线（!onLine）→ 直接命中缓存（离线播放）
//  - 在线 → 优先直连 CDN
//  - 直连失败 → 有本地缓存则直接用缓存（跳过服务端代理，避免弱网下两轮等待）
//  - 无本地缓存 → 回退服务端代理（bgAudio error 事件仍有弱网降级兜底）
async function _getPlayableUrl(bvid) {
  if (!navigator.onLine) {
    try {
      const c = await offline.get(bvid);
      if (c && c.audio) {
        const url = _makeObjUrl(c.audio);
        offline.touch(bvid);
        _cacheUse = { fromCache: true, reason: '离线' };
        return { url, isDirect: false, fromCache: true };
      }
    } catch {}
    _cacheUse = null;
    return null; // 离线且无缓存，无法播放
  }
  _cacheUse = null;
  _weakFallback = false;
  try {
    const r = await api(`/play/direct-url?bvid=${encodeURIComponent(bvid)}`);
    if (r && r.url) return { url: r.url, isDirect: true, fromCache: false };
  } catch { /* 直连地址解析失败，跳过 */ }

  // 直连失败：如果本地有缓存则直接用缓存，不走服务端代理
  try {
    const c = await offline.get(bvid);
    if (c && c.audio) {
      const url = _makeObjUrl(c.audio);
      offline.touch(bvid);
      _cacheUse = { fromCache: true, reason: '网络不佳' };
      return { url, isDirect: false, fromCache: true };
    }
  } catch { /* IndexedDB 读取失败，忽略 */ }

  // 无本地缓存：回退服务端代理
  return { url: `/api/play/stream?bvid=${encodeURIComponent(bvid)}&token=${encodeURIComponent(Auth.token)}`, isDirect: false, fromCache: false };
}

// 创建缓存 audio 的 object URL；回收上一个，避免内存泄漏
function _makeObjUrl(blob) {
  if (_cacheUrl) URL.revokeObjectURL(_cacheUrl);
  _cacheUrl = URL.createObjectURL(blob);
  return _cacheUrl;
}

// 设置播放栏状态区：缓存命中显示「离线播放 + 原因」，否则显示 Bilibili 标
function _setPlayStatus() {
  const song = state.current;
  const title = song?._biliTitle || (song?.name && song?.singer ? `${song.name} - ${song.singer}` : 'Bilibili 播放');
  if (_cacheUse && _cacheUse.fromCache) {
    $('playStatus').innerHTML = `<span class="status-inner"><span class="badge offline-badge">${OFFLINE_ICON} 离线播放</span> <span class="offline-reason">${esc(_cacheUse.reason)}</span> ${esc(title)}</span>`;
  } else {
    $('playStatus').innerHTML = `<span class="status-inner"><span class="badge">${PLAY_ICON} Bilibili</span> ${esc(title)}</span>`;
  }
  const inner = $('playStatus').querySelector('.status-inner');
  if (inner) checkMarquee(inner);
}

// 边播边后台落盘（被动，pinned=false）；失败静默。完成后广播刷新角标。
function _cacheCurrent(bvid) {
  const cur = state.current;
  const song = cur && cur.name ? { name: cur.name, singer: cur.singer, album_mid: cur.album_mid } : null;
  offline.fetchAndStore(bvid, Auth.token, { pinned: false, videoSource: { bvid }, song })
    .then(() => { window.dispatchEvent(new CustomEvent('offline_cache_changed')); })
    .catch(e => console.warn('[offline] 后台缓存失败', bvid, e.message));
}

// ---- 淡入淡出（crossfade）核心逻辑 ----
// 通过 AudioContext 的 linearRampToValueAtTime 实现采样级平滑过渡。
// bgAudio（当前曲）的 GainNode 线性降到 0，_nextAudio（下一曲）的 GainNode 线性升到目标音量。

async function _fetchGainForNext(bvid) {
  try {
    const r = await api(`/play/gain?bvid=${encodeURIComponent(bvid)}`);
    _nextNormGain = (r.gain != null && typeof r.gain === 'number') ? r.gain : 1.0;
  } catch { _nextNormGain = 1.0; }
}

function _cancelCrossfade() {
  console.log(`[crossfade] _cancelCrossfade (hadTimer=${!!_crossfadeEndTimer})`);
  if (_crossfadeEndTimer) { clearTimeout(_crossfadeEndTimer); _crossfadeEndTimer = null; }
  _crossfading = false;
  _crossfadeBvid = null;
  _crossfadeStartTime = 0;
  _crossfadeSeq++;
  // 立即恢复增益：bgAudio 回到正常音量，_nextAudio 静音
  const now = _audioCtx.currentTime;
  _gainNode.gain.cancelScheduledValues(now);
  _applyNormVol();
  _nextGainNode.gain.cancelScheduledValues(now);
  _nextGainNode.gain.setValueAtTime(0, now);
  _nextAudio.pause();
  _nextAudio.src = '';
  console.log(`[crossfade] _cancelCrossfade done, gain restored to ${_gainNode.gain.value.toFixed(2)}, nextAudio.paused=${_nextAudio.paused}`);
}

// 淡入淡出结束：bgAudio 接管下一曲的播放
function _completeCrossfade(url) {
  console.log(`[crossfade] _completeCrossfade crossfading=${_crossfading}, nextPos=${_nextAudio.currentTime?.toFixed(1) || '?'}s, bgReady=${bgAudio.readyState}`);
  if (!_crossfading) { console.log('[crossfade] _completeCrossfade aborted: not crossfading'); return; }
  if (_crossfadeEndTimer) { clearTimeout(_crossfadeEndTimer); _crossfadeEndTimer = null; }
  // 重置增益：bgAudio 立即恢复到正常音量，_nextAudio 立即静音
  const now = _audioCtx.currentTime;
  _gainNode.gain.cancelScheduledValues(now);
  _nextGainNode.gain.cancelScheduledValues(now);
  // bgAudio 接管：设 src 为同一 URL（应已被浏览器缓存，加载极快），从 0 开始播放
  bgAudio.src = url;
  console.log('[crossfade] takeover: setting bgAudio.src, will play from 0');
  const doTakeover = () => {
    console.log(`[crossfade] takeover: canplay fired (readyState=${bgAudio.readyState}), bgGain=${_gainNode.gain.value.toFixed(2)}, nextGain=${_nextGainNode.gain.value.toFixed(2)}`);
    bgAudio.removeEventListener('canplay', doTakeover);
    _crossfading = false; // 必须在 _applyNormVol 之前置 false，否则 gain 不会被恢复
    _applyNormVol(); // 恢复 bgAudio 增益到正常
    _nextGainNode.gain.setValueAtTime(0, now);
    // 从 0 开始播放（不 seek），避免丢失歌曲开头
    console.log(`[crossfade] takeover: bgGain restored to ${_gainNode.gain.value.toFixed(2)}, playing bgAudio from 0`);
    bgAudio.play().then(() => { console.log('[crossfade] takeover: bgAudio.play() success'); }).catch(e => console.warn('[crossfade] bgAudio takeover failed:', e.message));
    // 短暂重叠后关掉 _nextAudio，避免音频断档
    setTimeout(() => { _nextAudio.pause(); _nextGainNode.gain.value = 0; _crossfadeBvid = null; console.log('[crossfade] takeover: cleanup done'); }, 250);
  };
  bgAudio.addEventListener('canplay', doTakeover, { once: true });
  bgAudio.load();
  // 兜底：1.5 秒后无论如何强制接管（避免 bgAudio 加载卡住导致 _nextAudio 一直播放）
  setTimeout(() => {
    if (_crossfading) {
      console.log(`[crossfade] FALLBACK triggered (1.5s timeout), removing canplay listener, readyState=${bgAudio.readyState}`);
      bgAudio.removeEventListener('canplay', doTakeover);
      _crossfading = false; // 必须在 _applyNormVol 之前置 false，否则 gain 不会被恢复
      _applyNormVol();
      _nextGainNode.gain.setValueAtTime(0, _audioCtx.currentTime);
      bgAudio.play().then(() => { console.log('[crossfade] FALLBACK: bgAudio.play() success'); }).catch(() => {});
      setTimeout(() => { _nextAudio.pause(); _nextGainNode.gain.value = 0; _crossfadeBvid = null; console.log('[crossfade] FALLBACK: cleanup done'); }, 250);
    }
  }, 1500);

  // 歌词跟随：淡入淡出期间保持旧歌词，结束时加载新歌歌词（方案 B）
  if (state.current) {
    import('./lyrics.js').then(({ loadLyrics, setLyricsFor }) => {
      setLyricsFor('');
      loadLyrics(state.current);
    });
  }

  setStatus('Bilibili 播放');
}

// 启动淡入淡出：bgAudio 淡出，_nextAudio 淡入
async function _startCrossfade(newBvid) {
  console.log(`[crossfade] _startCrossfade bvid=${newBvid?.slice(0,12)} (wasCrossfading=${_crossfading})`);
  if (_crossfading) _cancelCrossfade();
  _crossfading = true;
  _crossfadeBvid = newBvid;
  const seq = ++_crossfadeSeq;

  // 获取下一首的播放链接
  _usedFallback = false;
  console.log(`[crossfade] seq=${seq} → fetching playable URL for ${newBvid?.slice(0,12)}`);
  const info = await _getPlayableUrl(newBvid);
  console.log(`[crossfade] seq=${seq} URL fetch done, info=${!!info}, curSeq=${_crossfadeSeq}, crossfading=${_crossfading}`);
  if (seq !== _crossfadeSeq || !_crossfading) { console.log('[crossfade] aborted: seq mismatch or no longer crossfading'); return; }
  if (!info) { console.log('[crossfade] no playable URL → abort'); _crossfading = false; return; }

  // 异步拉取下一首的归一化增益
  _fetchGainForNext(newBvid);

  _nextAudio.src = info.url;
  _nextAudio.load();

  // 记录 crossfade 开始时间戳，用于 _tick 合成新歌的 elapsed
  _crossfadeStartTime = Date.now();

  const dur = _crossfadeDuration;
  const ctx = _audioCtx;
  const now = ctx.currentTime;
  const endTime = now + dur;

  // bgAudio 淡出到 0
  _gainNode.gain.cancelScheduledValues(now);
  _gainNode.gain.linearRampToValueAtTime(0, endTime);
  console.log(`[crossfade] seq=${seq} ramp: bgAudio.gain 1→0 over ${dur}s (now=${now.toFixed(1)}, end=${endTime.toFixed(1)})`);
  // _nextAudio 从 0 淡入到目标音量
  const skipNorm = localStorage.getItem('wemusic_volume_normalize') !== '1';
  const safeNextGain = Math.min(_nextNormGain, 8.0);
  const targetVol = skipNorm ? _volume : (safeNextGain * _volume);
  _nextGainNode.gain.cancelScheduledValues(now);
  _nextGainNode.gain.setValueAtTime(0, now);
  _nextGainNode.gain.linearRampToValueAtTime(targetVol, endTime);
  console.log(`[crossfade] seq=${seq} ramp: nextGain 0→${targetVol.toFixed(2)} over ${dur}s (skipNorm=${skipNorm}, nextNormGain=${_nextNormGain.toFixed(2)})`);

  _nextAudio.play().then(() => { console.log(`[crossfade] seq=${seq} _nextAudio.play() success`); }).catch(e => console.warn(`[crossfade] seq=${seq} play next failed:`, e.message));

  _crossfadeEndTimer = setTimeout(() => {
    console.log(`[crossfade] seq=${seq} crossfade timer fired (${dur}s), calling _completeCrossfade`);
    _completeCrossfade(info.url);
  }, dur * 1000);

  if (!info.fromCache) _cacheCurrent(newBvid);
  setStatus('Bilibili 播放');
  console.log(`[crossfade] seq=${seq} _startCrossfade done, timer set for ${dur}s`);
}

// 加载曲目到 bgAudio 并立即播放（mode === 'bg' 时使用）
async function _loadAndPlayBgTrack(bvid, seekSec = 0) {
  const seq = playSeq;
  _usedFallback = false;
  const info = await _getPlayableUrl(bvid);
  if (seq !== playSeq || mode !== 'bg') return; // 期间歌曲已切换，或用户已展开视频
  if (!info) { setStatus('离线状态且无缓存，无法播放'); toast('离线状态且无缓存，无法播放'); return; }
  bgAudio.src = info.url;
  bgAudio.load();
  _fetchGain(bvid);
  _setPlayStatus();
  if (!info.fromCache) _cacheCurrent(bvid); // 走网络才后台落盘（被动）
  _playBgAudioWithRetry(seekSec);
}

// 静默加载曲目到 bgAudio（不播放）：用户正在看视频时，提前把 bgAudio 准备好，
// 这样收起视频时可以立刻续播，不需要现场再请求一次直链。
async function _loadBgTrack(bvid) {
  const seq = playSeq;
  _usedFallback = false;
  const info = await _getPlayableUrl(bvid);
  if (seq !== playSeq) return;
  if (!info) return; // 离线且无缓存，静默预载跳过
  bgAudio.src = info.url;
  bgAudio.load();
  _fetchGain(bvid);
  _setPlayStatus();
  if (!info.fromCache) _cacheCurrent(bvid);
}

// 播放 bgAudio，必要时 seek 到指定秒数；play() 失败自动重试（最多 10 次，间隔递增）
function _playBgAudioWithRetry(seekSec) {
  let retries = 0;
  const doPlay = () => {
    if (mode !== 'bg') return; // 用户已展开视频，不再尝试播放 bgAudio（避免双声道）
    bgAudio.play().then(() => {
      if (_healthCheckId) clearTimeout(_healthCheckId);
      // play() 成功后 5 秒做健康检查：如果又停了且没被用户手动暂停，重试
      _healthCheckId = setTimeout(() => {
        _healthCheckId = null;
        if (mode === 'bg' && !timerPaused && bgAudio.paused) {
          console.warn(`[bgAudio] health-check FAILED (paused at ${bgAudio.currentTime?.toFixed(1)}s) — retrying`);
          retries = 0;
          doPlay();
        }
      }, 5000);
    }).catch((e) => {
      if (mode !== 'bg') return;
      retries++;
      if (retries <= 10) {
        const delay = 500 * Math.min(retries, 6);
        console.log(`[bg:retry] play() attempt ${retries}/10 failed (${e.name}) — retry in ${delay}ms`);
        setTimeout(doPlay, delay);
      } else {
        console.warn('[bg:retry] play() FAILED after 10 retries — giving up');
      }
    });
  };

  if (seekSec > 0.5 && Math.abs(bgAudio.currentTime - seekSec) > 1) {
    const onSeeked = () => { bgAudio.removeEventListener('seeked', onSeeked); doPlay(); };
    bgAudio.addEventListener('seeked', onSeeked);
    try { bgAudio.currentTime = seekSec; } catch { /* metadata 未加载完成，忽略 */ }
    // 兜底：seek 超过 1.5s 未响应则直接 play（避免死等）
    setTimeout(() => {
      bgAudio.removeEventListener('seeked', onSeeked);
      if (bgAudio.paused && mode === 'bg') doPlay();
    }, 1500);
  } else if (bgAudio.readyState >= 2) { // HAVE_CURRENT_DATA 或更高
    doPlay();
  } else {
    const onCan = () => { bgAudio.removeEventListener('canplay', onCan); doPlay(); };
    bgAudio.addEventListener('canplay', onCan);
  }
}

// bgAudio 'ended' 事件：正常播完，触发自动连播
// crossfade 期间 bgAudio 是旧歌，它的 ended 由 crossfade 定时器接管，不应触发 autoAdvance
bgAudio.addEventListener('ended', () => {
  if (mode === 'bg' && !timerPaused) {
    if (_crossfading) {
      console.log(`[bgAudio] ended at ${bgAudio.currentTime?.toFixed(1)}s but crossfade active — ignoring (crossfade timer handles transition)`);
      return;
    }
    console.log(`[bgAudio] ended at ${bgAudio.currentTime?.toFixed(1)}s — auto advance`);
    autoAdvance();
  }
});

// error 事件：先尝试从「直连」降级为「服务端代理」，仍失败才判定播放失败自动切歌
bgAudio.addEventListener('error', () => {
  const err = bgAudio.error;
  console.warn(`[bgAudio] ERROR code=${err?.code} message="${err?.message}" src=${bgAudio.src?.slice(0, 60)}`);
  if (!_usedFallback && state.current?.bvid) {
    _usedFallback = true;
    console.warn('[bgAudio] 直连 CDN 失败，降级为服务端代理');
    bgAudio.src = `/api/play/stream?bvid=${encodeURIComponent(state.current.bvid)}&token=${encodeURIComponent(Auth.token)}`;
    bgAudio.load();
    if (mode === 'bg' && !timerPaused) _playBgAudioWithRetry(elapsed);
    return;
  }
  // 代理也失败 → 尝试缓存（弱网降级到离线缓存）
  if (_usedFallback && !_weakFallback && state.current?.bvid) {
    offline.get(state.current.bvid).then((c) => {
      if (c && c.audio) {
        _weakFallback = true;
        const url = _makeObjUrl(c.audio);
        offline.touch(state.current.bvid);
        _cacheUse = { fromCache: true, reason: '网络不佳' };
        _setPlayStatus();
        bgAudio.src = url;
        bgAudio.load();
        if (mode === 'bg' && !timerPaused) _playBgAudioWithRetry(elapsed);
      } else if (mode === 'bg' && !timerPaused) {
        console.warn('[bgAudio] ERROR (fallback+缓存均用尽) — auto advance');
        autoAdvance();
      }
    }).catch(() => { if (mode === 'bg' && !timerPaused) autoAdvance(); });
    return;
  }
  if (mode === 'bg' && !timerPaused) {
    console.warn('[bgAudio] ERROR during playback (fallback 已用尽) — auto advance');
    autoAdvance();
  }
});

// stalled：卡住 3 秒仍未恢复则判定失败切歌；流中断时 <audio> 常不触发 ended，需主动兜底
bgAudio.addEventListener('stalled', () => {
  if (mode !== 'bg' || timerPaused) return;
  const ct = bgAudio.currentTime?.toFixed(1) || '?';
  console.warn(`[bgAudio] STALLED currentTime=${ct}s readyState=${bgAudio.readyState}`);
  if (!_stalledTimer) {
    _stalledTimer = setTimeout(() => {
      _stalledTimer = null;
      if (mode === 'bg' && !timerPaused) {
        console.warn('[bgAudio] STALLED 3s+ — auto advance');
        autoAdvance();
      }
    }, 3000);
  }
});
bgAudio.addEventListener('playing', () => {
  if (_stalledTimer) { clearTimeout(_stalledTimer); _stalledTimer = null; }
});

// 通过 postMessage 控制 B 站 iframe 音量（官方支持的消息协议）
// 注意：归一化增益不作用于 iframe——iframe 是 B 站官方播放器，WeMusic 无法在音量之外
// 再对它做处理，只能远程喊话调节音量本身。
function _setIframeVolume(vol) {
  const iframe = $('videoContainer').querySelector('iframe');
  if (!iframe) return;
  try {
    iframe.contentWindow.postMessage(
      JSON.stringify({ type: 'setVolume', data: { volume: Math.round(vol * 100) } }),
      'https://player.bilibili.com'
    );
  } catch { console.warn('B站 iframe 音量通信失败') }
}

// 播放/切换到某个 bvid（供 playCurrent / 换源 调用）。
// mode === 'bg'：加载并播放 bgAudio。
// mode === 'iframe'：挂载新 iframe（保持展开状态），同时静默预载 bgAudio 供随时收起。
export function startVideo(bvid, title, dur) {
  _iframeStartCalibrated = false;
  if (mode === 'iframe') {
    mountVideoAt(bvid, title, 0);
    elapsed = 0;
    _loadBgTrack(bvid);
  } else {
    _loadAndPlayBgTrack(bvid, 0);
  }
  startTimer(dur);
  saveSession();
  import('./queue.js').then(({ pushPlayHistory, renderActiveTab }) => {
    pushPlayHistory(state.current);
    if ($('queueDrawer').classList.contains('show')) renderActiveTab();
  });
  logPlay(state.current, dur);
  import('./lyrics.js').then(({ updateLyricsPanelMeta, loadLyrics, loadSongBackground, setLyricsFor }) => {
    if (state.current) {
      // 歌词详情页打开时，同步更新面板 meta 和「播放中」状态
      if ($('lyricsPanel').classList.contains('show')) {
        updateLyricsPanelMeta(state.current);
        $('lyricsPanel').classList.add('playing');
        setLyricsFor(''); // 清除旧 key 以强制重新加载新歌歌词
      }
      // 始终加载歌词数据：桌面歌词/PiP 浮窗依赖此全局数据源，
      // 不再依赖歌词详情页是否打开。loadLyrics 内部有去重逻辑。
      loadLyrics(state.current);
    }
    // 异步加载歌曲背景（不阻塞播放）
    if (state.current) loadSongBackground(state.current);
  });
}

// ---- 展开 / 收起视频（唯一的引擎切换入口，替代原来的前后台切换）----
export function expandVideo() {
  if (!state.current?.bvid || mode === 'iframe') return;
  const startSec = Math.floor(bgAudio.currentTime || elapsed);
  bgAudio.pause();
  mode = 'iframe';
  _iframeStartCalibrated = false;
  mountVideoAt(state.current.bvid, state.current._biliTitle, startSec);
  elapsed = startSec;
  $('videoPane').classList.add('show');
  $('videoBtn').textContent = '收起';
  _setIframeVolume(_volume);
  _restartTick();
  _updateSeekInteractivity();
}

export function collapseVideo() {
  if (mode !== 'iframe') return;
  const startSec = elapsed;
  $('videoPane').classList.remove('show', 'fullscreen');
  $('videoContainer').innerHTML = '';
  $('videoBtn').textContent = '展开';
  mode = 'bg';
  if (!timerPaused) {
    _playBgAudioWithRetry(startSec);
  } else if (bgAudio.readyState >= 1) {
    try { bgAudio.currentTime = startSec; } catch { /* 忽略 */ }
  }
  _restartTick();
  _updateSeekInteractivity();
}

// B 站 iframe 真实启动时间检测（仅在展开视频、mode === 'iframe' 时有意义）：
// B 站播放器会通过 postMessage 发送心跳（包含 type:'heartbeat' 或 currentTime 等）
// 监听第一条有效消息即可知道视频真正开始播放的时刻，用于校正「计时器估算进度」的偏移
let _iframeStartCalibrated = false; // 当前歌是否已校正过

function _onBiliMessage(e) {
  if (mode !== 'iframe' || _iframeStartCalibrated) return;
  if (!state.current?.bvid) return;
  // B 站消息结构：{ type, data } 或直接字符串，只要收到任意一条就说明播放器已初始化
  try {
    const d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
    if (!d || typeof d !== 'object') return;
    if (!d.type && !d.event) return;
  } catch { return; }

  const mountedAt = Number($('videoContainer').dataset.mountedAt || 0);
  if (!mountedAt) return;
  const delay = (Date.now() - mountedAt) / 1000; // iframe 从创建到视频开始的秒数
  if (delay < 0.5 || delay > 15) return; // 不合理则忽略

  // 把计时器往回拨：elapsed 实际上多走了 delay 秒
  if (elapsed > delay + 1) {
    elapsed = Math.max(0, Math.round(elapsed - delay));
    $('curTime').textContent = fmtDur(elapsed);
    if (totalDur > 0) {
      _updateSeekBarUI(elapsed, totalDur);
      _updateCoverRing();
    }
  }
  _iframeStartCalibrated = true;
}

// 当前是否正在拖拽任一进度条（底部播放器或歌词页），供外部（歌词页 UI 同步循环）判断是否要跳过覆盖滑块值
export function isSeeking() { return _seekDragging; }

// 音频可视化：暴露 AnalyserNode 供 lyrics.js 读取频谱数据
export function getAnalyserNode() { return _analyserNode; }

// 绑定一组「时间文字 + seek 滑块」的拖拽交互，同时用于底部播放器和歌词全屏页。
// 拖拽期间实时预览时间文字，松手才真正触发 seekTo（避免拖拽途中频繁 seek 造成卡顿）。
export function bindSeekBar(bar, curTimeEl) {
  const previewTime = () => {
    if (totalDur <= 0) return 0;
    return Math.round((bar.value / 1000) * totalDur);
  };
  bar.addEventListener('pointerdown', () => { _seekDragging = true; });
  bar.addEventListener('input', () => {
    // 拖拽中实时预览时间文字 + 滑块填充位置，不触发真正的 seek
    const t = previewTime();
    if (curTimeEl) curTimeEl.textContent = fmtDur(t);
    const pct = totalDur > 0 ? (t / totalDur) * 100 : 0;
    bar.style.setProperty('--seek-pct', pct + '%');
  });
  const commit = () => {
    if (!_seekDragging) return;
    _seekDragging = false;
    seekTo(previewTime());
  };
  bar.addEventListener('pointerup', commit);
  bar.addEventListener('pointercancel', () => { _seekDragging = false; });
  // 键盘方向键操作 range 时无 pointerup，用 change 事件兜底触发一次
  bar.addEventListener('change', commit);
}

export function initPlayer() {
  // seekBar 支持拖拽跳转：mode === 'bg' 时可用（bgAudio 是 WeMusic 自己的元素，可精确 seek）；
  // mode === 'iframe'（展开视频）时禁用，因为 B 站官方未公开支持 postMessage 精确 seek。
  _updateSeekInteractivity();
  bindSeekBar($('seekBar'), $('curTime'));

  // 监听 B 站 iframe postMessage，检测视频真实启动时刻，校正展开模式下的估算进度
  window.addEventListener('message', _onBiliMessage);

  // 初始化 AudioContext（音量归一化用，createMediaElementSource 只能调一次）
  _initAudioCtx();

  // 设置面板切换归一化开关 → 立即生效
  window.addEventListener('volume_normalize_changed', () => _applyNormVol());

  // 淡入淡出：开关 + 时长
  const crossfadeEnabled = localStorage.getItem('wemusic_crossfade_enabled') === '1';
  _crossfadeDuration = crossfadeEnabled ? Number(localStorage.getItem('wemusic_crossfade_duration') || 5) : 0;
  window.addEventListener('crossfade_changed', () => {
    const on = localStorage.getItem('wemusic_crossfade_enabled') === '1';
    _crossfadeDuration = on ? Number(localStorage.getItem('wemusic_crossfade_duration') || 5) : 0;
  });

  // EQ：加载预设 + 监听变更。必须在 _initAudioCtx() 之后（滤波器已创建）
  _eqPreset = localStorage.getItem('wemusic_eq') || 'flat';
  _applyEQPreset(_eqPreset);
  window.addEventListener('eq_changed', () => {
    const p = localStorage.getItem('wemusic_eq') || 'flat';
    _applyEQPreset(p);
  });

  // 音量控件：通过 GainNode 控制 bgAudio 的实际输出音量；同时通过 postMessage 同步 iframe 音量。
  // 无论当前是 bg 模式还是 iframe 模式，这一个滑块始终同时驱动两者，保证前后台/展开态音量一致。
  _volume = Number(localStorage.getItem('wemusic_vol') || 0.8);
  const volBar = $('volBar');
  const volBtn = $('volBtn');
  _volBtn = volBtn; // 保存引用供 _applyNormVol 更新 tooltip
  const volOnIcon = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19 11,5"/><path d="M15.5 8.5a4.5 4.5 0 0 1 0 7"/><path d="M19 5a9 9 0 0 1 0 14"/></svg>`;
  const volOffIcon = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19 11,5"/><line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/></svg>`;
  const _applyVol = () => {
    // 音量由 GainNode 统一控制：bgAudio.volume 始终 1.0
    bgAudio.volume = 1.0;
    bgAudio.muted = (_volume === 0);
    // 淡入淡出期间：_gainNode 由 linearRampToValueAtTime 驱动，不覆盖
    if (!_crossfading) _applyNormVol();
    const pct = Math.round(_volume * 100);
    volBar.value = pct;
    volBar.style.setProperty('--vol-fill', pct + '%');
    // 静音时隐掉滑块拇指，避免残留的 accent 色
    volBar.style.setProperty('--vol-thumb-bg', pct === 0 ? 'transparent' : 'var(--accent)');
    volBar.style.setProperty('--vol-thumb-border', pct === 0 ? 'transparent' : 'var(--accent)');
    volBtn.innerHTML = _volume === 0 ? volOffIcon : volOnIcon;
    // tooltip 由 _applyNormVol 统一设置（含 gain 信息）
  };
  _applyVol();
  volBar.oninput = () => {
    _volume = volBar.value / 100;
    localStorage.setItem('wemusic_vol', _volume);
    _applyVol();
    _setIframeVolume(_volume); // 同步 iframe 音量（展开视频时生效）
  };
  let _prevVol = _volume;
  const volWrap = document.querySelector('.volume-wrap');
  volBtn.onclick = (e) => {
    e.stopPropagation();
    if (!volWrap.classList.contains('open')) {
      volWrap.classList.add('open');
    } else {
      if (_volume > 0) { _prevVol = _volume; _volume = 0; }
      else { _volume = _prevVol || 0.8; }
      localStorage.setItem('wemusic_vol', _volume);
      _applyVol();
      _setIframeVolume(_volume);
    }
  };
  // 点击其他地方关闭音量条
  document.addEventListener('click', (e) => {
    if (!volWrap.contains(e.target)) volWrap.classList.remove('open');
  });

  $('modeBtn').onclick = () => {
    const idx = MODE_ORDER.indexOf(state.playMode);
    state.playMode = MODE_ORDER[(idx + 1) % MODE_ORDER.length];
    localStorage.setItem('wemusic_mode', state.playMode);
    renderMode();
    toast('播放模式：' + MODE_META[state.playMode].label);
  };
  renderMode();

  $('prevBtn').onclick = () => playPrev();
  $('nextBtn').onclick = () => playNext(false);
  $('playPauseBtn').onclick = () => {
    const result = togglePause();
    if (result === 'noSong') return toast('请选择一首歌曲播放');
    if (result === 'mounted') return;
    $('playPauseBtn').title = timerPaused ? '继续自动连播' : '暂停自动连播';
    toast(timerPaused ? '已暂停自动连播' : '继续自动连播');
  };

  // 展开/收起视频：展开 = 用户想看画面（切到 iframe，声音也归 iframe）；
  // 收起 = 用户只想听歌（销毁 iframe，声音无缝交回 bgAudio）
  $('videoBtn').onclick = () => {
    if (!state.current || !state.current.bvid) return toast('请先播放一首歌曲');
    if (mode === 'iframe') collapseVideo(); else expandVideo();
  };
  $('vpHide').onclick = () => collapseVideo(); // 「收起（保持播放）」
  $('vpClose').onclick = () => { destroyVideo(); setStatus('已停止'); };
  $('vpFull').onclick = () => {
    const pane = $('videoPane');
    if (!document.fullscreenElement) {
      (pane.requestFullscreen ? pane.requestFullscreen() : Promise.reject()).catch(() => {
        pane.classList.toggle('fullscreen');
      });
    } else { document.exitFullscreen?.(); }
  };

  // 视频浮窗拖动
  const pane = $('videoPane');
  const head = $('vpHead');
  let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
  head.addEventListener('mousedown', (e) => {
    if (e.target.classList.contains('vp-btn')) return;
    if (pane.classList.contains('fullscreen')) return;
    if (!pane.classList.contains('show')) return;
    dragging = true;
    const rect = pane.getBoundingClientRect();
    ox = rect.left; oy = rect.top; sx = e.clientX; sy = e.clientY;
    pane.style.left = ox + 'px'; pane.style.top = oy + 'px';
    pane.style.right = 'auto'; pane.style.bottom = 'auto';
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    let nx = Math.max(0, Math.min(ox + (e.clientX - sx), window.innerWidth - pane.offsetWidth));
    let ny = Math.max(0, Math.min(oy + (e.clientY - sy), window.innerHeight - pane.offsetHeight));
    pane.style.left = nx + 'px'; pane.style.top = ny + 'px';
  });
  window.addEventListener('mouseup', () => { dragging = false; });

  // Media Session（"播放"=恢复自动连播 / "暂停"=暂停自动连播）
  navigator.mediaSession.setActionHandler('play', () => {
    if (!state.current) return;
    if (autoTimer) togglePause();
    else playCurrent();
  });
  navigator.mediaSession.setActionHandler('pause', () => {
    if (autoTimer && !timerPaused) togglePause();
  });
  navigator.mediaSession.setActionHandler('previoustrack', playPrev);
  navigator.mediaSession.setActionHandler('nexttrack', () => playNext(false));
  // 系统级拖拽进度条（锁屏/通知中心/耳机快进快退），仅 mode === 'bg' 时生效（原理同底部播放器 seekBar）
  try {
    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (mode !== 'bg') return;
      seekTo(details.seekTime);
    });
    navigator.mediaSession.setActionHandler('seekbackward', (details) => {
      if (mode !== 'bg') return;
      seekTo(elapsed - (details.seekOffset || 10));
    });
    navigator.mediaSession.setActionHandler('seekforward', (details) => {
      if (mode !== 'bg') return;
      seekTo(elapsed + (details.seekOffset || 10));
    });
  } catch { /* 部分浏览器不支持这三个 action，静默忽略 */ }

  // 用户展开视频后把浏览器标签页切到后台：iframe 会被浏览器限流/静音，
  // 此时自动收起视频面板，改回 bgAudio 继续播放声音，避免"看视频时切走导致没声音"。
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && mode === 'iframe') {
      console.log('[video] 标签页切到后台且视频处于展开状态 — 自动收起，交回 bgAudio 播放');
      collapseVideo();
    }
  });

  // 桌面歌词按钮
  $('dtLyricsBtn').onclick = async () => {
    const { openDesktopLyrics, closeDesktopLyrics, isOpen } = await import('./desktop-lyrics.js');
    if (isOpen()) {
      closeDesktopLyrics();
    } else {
      if (!state.current) return toast('请先播放一首歌曲');
      openDesktopLyrics();
    }
  };
}

// 导出可被外部（歌词页、键盘快捷键）调用的暂停切换函数
// 不能通过 p.timerPaused 直接赋值（构建后为只读 getter），只能通过此函数操作
export function togglePause() {
  if (!state.current) return 'noSong';
  if (!autoTimer) { playCurrent(); return 'mounted'; }
  timerPaused = !timerPaused;
  $('playPauseBtn').innerHTML = timerPaused ? PLAY_ICON : PAUSE_ICON;
  $('playPauseBtn').title = timerPaused ? '继续自动连播' : '暂停自动连播';
  if (mode === 'bg') {
    if (timerPaused) bgAudio.pause();
    else bgAudio.play().catch(() => {});
  }
  // mode === 'iframe' 时，B 站播放器由用户在视频内自行暂停/播放，这里只暂停计时器/歌词同步
  return timerPaused;
}
