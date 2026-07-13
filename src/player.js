// ---------------- 播放核心 ----------------
import { $, fmtDur, esc, biliEmbed, albumCover, singerAvatar, toast, PLAY_ICON, PAUSE_ICON } from './utils.js';
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
  $('curTime').textContent = '0:00';
  $('durTime').textContent = fmtDur(totalDur);
  _updateSeekBarUI(0, totalDur);
  const ring = $('coverProgressFill');
  if (ring) ring.style.strokeDashoffset = COVER_RING_CIRC;
}

// ---- 计时器 / 进度驱动 ----
// mode === 'bg'：唯一常规模式，进度直接读取 bgAudio.currentTime（真实播放位置）。
// mode === 'iframe'：仅当用户点击「展开」观看视频时进入，B 站 iframe 跨域，无法读取真实进度，
//                     只能用「每秒 +1」的计时器估算（与展开前的历史实现一致）。
let _lastTickCurrentTime = 0;
let _stallTicks = 0;
const STALL_TICK_THRESHOLD = 5; // 连续 5 次（约 5 秒）currentTime 无变化 → 判定播放流已死
let _hasStartedPlaying = false; // 当前曲目是否已经成功开始播放过一次（区分"加载中"与"意外暂停"）

function _tick() {
  if (timerPaused) return;
  if (mode === 'bg') {
    if (bgAudio.duration && isFinite(bgAudio.duration)) totalDur = Math.floor(bgAudio.duration);
    const ct = bgAudio.currentTime || 0;
    elapsed = Math.floor(ct);
    $('curTime').textContent = fmtDur(elapsed);
    if (totalDur > 0) { _updateSeekBarUI(elapsed, totalDur); _updateCoverRing(); }
    if (!bgAudio.paused) _hasStartedPlaying = true;
    if (bgAudio.paused) {
      // 尚未成功开始播放过（曲目还在加载中）属于正常状态，不算"意外暂停"
      if (_hasStartedPlaying) {
        console.warn('[bgAudio] 意外暂停，尝试恢复播放');
        bgAudio.play().catch(() => {});
      }
    } else if (Math.abs(ct - _lastTickCurrentTime) < 0.3) {
      _stallTicks++;
      if (_stallTicks >= STALL_TICK_THRESHOLD) {
        console.warn(`[bgAudio] currentTime 停滞 ${STALL_TICK_THRESHOLD}s+，自动切歌`);
        _stallTicks = 0;
        autoAdvance();
        return;
      }
    } else {
      _stallTicks = 0;
    }
    _lastTickCurrentTime = ct;
  } else {
    // iframe 展开模式：计时器估算进度（跨域无法读取真实播放位置）
    elapsed++;
    $('curTime').textContent = fmtDur(elapsed);
    if (totalDur > 0) {
      _updateSeekBarUI(elapsed, totalDur);
      _updateCoverRing();
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
  console.log(`[advance] autoAdvance (mode=${mode}, elapsed=${elapsed}s, dur=${totalDur}s)`);
  stopTimer();
  _flushLog(totalDur || elapsed);
  if (sleepAfterSong) { stopPlayback(); clearSleep(); toast('定时已到，已停止'); return; }
  if (state.playMode === 'single') { playCurrent(); return; }
  playNext(true);
}

export function stopPlayback() {
  destroyVideo();
  setStatus('已停止');
  document.title = 'WeMusic · 个人音乐';
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
        album: s.album, album_mid: s.album_mid, duration: s.duration, bvid: s.bvid,
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

export function computeNextIndex() {
  const n = state.queue.length;
  if (n === 0) return -1;
  if (n === 1) return 0;
  if (state.playMode === 'shuffle') {
    let i;
    do { i = Math.floor(Math.random() * n); } while (i === state.queueIndex);
    return i;
  }
  const i = state.queueIndex + 1;
  return i >= n ? 0 : i;
}

export function playPrev() {
  if (state.queue.length === 0) return;
  if (state.playMode === 'shuffle' && state.history.length) {
    state.queueIndex = state.history.pop();
  } else {
    state.queueIndex = state.queueIndex > 0 ? state.queueIndex - 1 : state.queue.length - 1;
  }
  playCurrent();
}

export function playNext(auto = false) {
  const i = computeNextIndex();
  if (i === -1) return;
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
    const { best, candidates } = await api('/play/resolve', {
      method: 'POST',
      body: { name: song.name, singer: song.singer, duration: song.duration },
    });
    song._candidates = candidates;
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
  _flushLog(elapsed);
  stopTimer();
  const song = state.queue[state.queueIndex];
  if (!song) return;
  const seq = ++playSeq;
  state.current = song;
  highlightPlaying();
  $('npTitle').textContent = song.singer ? `${song.name} - ${song.singer}` : song.name;
  checkMarquee($('npTitle'));
  document.title = `${song.name}${song.singer ? ' · ' + song.singer.split('/')[0] : ''} — WeMusic`;
  updateNpCover(song);
  updateMediaSession(song);
  setTimeout(() => import('./ui.js').then(({ updateNpLikeBtn, updateNpDislikeBtn }) => { updateNpLikeBtn(); updateNpDislikeBtn(); }), 0);
  resetProgress(song.duration);

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
    setStatus('正在从 Bilibili 匹配资源…');
    try {
      const { best, candidates } = await api('/play/resolve', {
        method: 'POST',
        body: { name: song.name, singer: song.singer, duration: song.duration },
      });
      if (seq !== playSeq) return;
      song._candidates = candidates;
      if (!best) { setStatus('未找到合适资源，可点「换源」'); toast('⚠ 未找到合适资源，可点换源'); return; }
      song.bvid = best.bvid;
      // 优先用 candidates 里同名 bvid 的 title（B 站偶尔返回 best.title 为空时回查）
      const match = best.bvid ? candidates.find(c => c.bvid === best.bvid) : null;
      song._biliTitle = match?.title || best.title || '';
      song._biliDur = (match?.duration || best.duration || song.duration);
      cacheBvid(song);
    } catch (e) {
      if (seq !== playSeq) return;
      setStatus('匹配失败：' + esc(e.message));
      return;
    }
  }
  if (seq !== playSeq) return;
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
let _usedFallback = false;   // 当前曲目是否已经从「直连 CDN」降级到「服务端代理」
let _healthCheckId = null;   // play() 成功后 5s 健康检查 setTimeout ID
let _stalledTimer = null;    // stalled 事件 3s 兜底切歌 setTimeout ID
let _volume = 0.8;           // 用户手动设置的音量（0~1），持久化，前后台/是否展开视频都用同一个值

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
  const source = _audioCtx.createMediaElementSource(bgAudio);
  _gainNode = _audioCtx.createGain();
  source.connect(_gainNode);
  _gainNode.connect(_audioCtx.destination);
  const resume = () => {
    if (_audioCtx.state === 'suspended') _audioCtx.resume();
    document.removeEventListener('click', resume);
    document.removeEventListener('keydown', resume);
  };
  document.addEventListener('click', resume);
  document.addEventListener('keydown', resume);
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
  _gainNode.gain.value = effectiveGain;
  // 更新音量按钮 tooltip，显示归一化增益
  if (_volBtn) {
    const normInfo = skipNorm ? '归一化已关闭'
      : (_normGain !== 1.0 ? `增益 ${_normGain.toFixed(2)}x` : '增益 1.00x（无缓存）');
    _volBtn.title = mode === 'iframe' ? `音量 | ${normInfo}（展开视频时请在视频内调节）` : `音量 | ${normInfo}`;
  }
}

// 解析可播放地址：优先直连 B 站 CDN（不占用自建服务器带宽），
// 若服务端解析失败则直接降级为服务端代理地址。
// <audio> 标签跨域直连失败（CORS/风控节点差异）时，由 bgAudio 的 error 事件在播放期兜底降级。
async function _getPlayableUrl(bvid) {
  try {
    const r = await api(`/play/direct-url?bvid=${encodeURIComponent(bvid)}`);
    if (r && r.url) return { url: r.url, isDirect: true };
  } catch { /* 直连地址解析失败，走代理 */ }
  return { url: `/api/play/stream?bvid=${encodeURIComponent(bvid)}&token=${encodeURIComponent(Auth.token)}`, isDirect: false };
}

// 加载曲目到 bgAudio 并立即播放（mode === 'bg' 时使用）
async function _loadAndPlayBgTrack(bvid, seekSec = 0) {
  const seq = playSeq;
  _usedFallback = false;
  const { url } = await _getPlayableUrl(bvid);
  if (seq !== playSeq || mode !== 'bg') return; // 期间歌曲已切换，或用户已展开视频
  bgAudio.src = url;
  bgAudio.load();
  _fetchGain(bvid);
  _playBgAudioWithRetry(seekSec);
}

// 静默加载曲目到 bgAudio（不播放）：用户正在看视频时，提前把 bgAudio 准备好，
// 这样收起视频时可以立刻续播，不需要现场再请求一次直链。
async function _loadBgTrack(bvid) {
  const seq = playSeq;
  _usedFallback = false;
  const { url } = await _getPlayableUrl(bvid);
  if (seq !== playSeq) return;
  bgAudio.src = url;
  bgAudio.load();
  _fetchGain(bvid);
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
bgAudio.addEventListener('ended', () => {
  if (mode === 'bg' && !timerPaused) {
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
  const displayTitle = title || (state.current?.name && state.current?.singer ? `${state.current.name} - ${state.current.singer}` : 'Bilibili 播放');
  $('playStatus').innerHTML = `<span class="status-inner"><span class="badge">${PLAY_ICON} Bilibili</span> ${esc(displayTitle)}</span>`;
  const inner = $('playStatus').querySelector('.status-inner');
  if (inner) checkMarquee(inner);
  startTimer(dur);
  saveSession();
  import('./queue.js').then(({ pushPlayHistory, renderActiveTab }) => {
    pushPlayHistory(state.current);
    if ($('queueDrawer').classList.contains('show')) renderActiveTab();
  });
  logPlay(state.current, dur);
  import('./lyrics.js').then(({ updateLyricsPanelMeta, loadLyrics, loadSongBackground, setLyricsFor }) => {
    if ($('lyricsPanel').classList.contains('show') && state.current) {
      updateLyricsPanelMeta(state.current);
      $('lyricsPanel').classList.add('playing');
      setLyricsFor('');
      loadLyrics(state.current);
    }
    // 异步加载歌曲背景（不阻塞播放）
    if (state.current) loadSongBackground(state.current);
  });
  prefetchNextBvid();
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

export function initPlayer() {
  // seekBar 禁用：无论是 bgAudio 真实进度还是 iframe 估算进度，都不支持跳转到任意位置
  $('seekBar').disabled = true;

  // 监听 B 站 iframe postMessage，检测视频真实启动时刻，校正展开模式下的估算进度
  window.addEventListener('message', _onBiliMessage);

  // 初始化 AudioContext（音量归一化用，createMediaElementSource 只能调一次）
  _initAudioCtx();

  // 设置面板切换归一化开关 → 立即生效
  window.addEventListener('volume_normalize_changed', () => _applyNormVol());

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
    _applyNormVol();
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

  // 用户展开视频后把浏览器标签页切到后台：iframe 会被浏览器限流/静音，
  // 此时自动收起视频面板，改回 bgAudio 继续播放声音，避免"看视频时切走导致没声音"。
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && mode === 'iframe') {
      console.log('[video] 标签页切到后台且视频处于展开状态 — 自动收起，交回 bgAudio 播放');
      collapseVideo();
    }
  });
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
