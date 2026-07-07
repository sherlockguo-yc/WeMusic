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
  $('curTime').textContent = '0:00';
  $('durTime').textContent = fmtDur(totalDur);
  _updateSeekBarUI(0, totalDur);
  const ring = $('coverProgressFill');
  if (ring) ring.style.strokeDashoffset = COVER_RING_CIRC;
}

export function startTimer(d) {
  stopTimer();
  totalDur = Number(d) || totalDur || (state.current && state.current.duration) || 0;
  $('durTime').textContent = fmtDur(totalDur);
  timerPaused = false;
  $('playPauseBtn').innerHTML = PAUSE_ICON;
  $('playPauseBtn').title = '暂停自动连播';
  autoTimer = setInterval(() => {
    if (timerPaused) return;
    elapsed++;
    $('curTime').textContent = fmtDur(elapsed);
    if (totalDur > 0) {
      _updateSeekBarUI(elapsed, totalDur);
      _updateCoverRing();
      if (elapsed >= totalDur + 1) autoAdvance();
    }
  }, 1000);
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
  const from = document.hidden ? 'bg-ended/sync' : 'timer';
  console.log(`[bg:advance] autoAdvance (from=${from}, elapsed=${elapsed}s, dur=${totalDur}s, hidden=${document.hidden})`);
  stopTimer();
  _stopBgSync(); // 停止后台校准定时器，避免干扰下一首歌曲初始化
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

// 带起始时间戳挂载 iframe（回前台时对齐进度用）
export function mountVideoAt(bvid, title, startSec) {
  setVpTitle(title);
  $('videoContainer').innerHTML =
    `<iframe src="${biliEmbed(bvid, startSec)}" allowfullscreen allow="autoplay; fullscreen" scrolling="no" frameborder="0"></iframe>`;
  // 记录 iframe 创建的时间戳，用于检测 B 站视频真实启动时间
  $('videoContainer').dataset.mountedAt = Date.now();
}

export function destroyVideo() {
  $('videoPane').classList.remove('show', 'fullscreen');
  const vc = $('videoContainer');
  vc.innerHTML = '';
  delete vc.dataset.pendingBvid;
  _pendingMount = null;
  _bgStop();
  stopTimer();
}

export function applyPaneVisibility() {
  const pane = $('videoPane');
  const vc = $('videoContainer');
  const mounted = vc.children.length > 0 || !!vc.dataset.pendingBvid;
  if (state.paneVisible && mounted) pane.classList.add('show');
  else pane.classList.remove('show');
  $('videoBtn').textContent = mounted ? (state.paneVisible ? '收起' : '展开') : '看视频';
}

export function setPaneVisible(v) {
  state.paneVisible = v;
  localStorage.setItem('wemusic_pane', String(v));
  applyPaneVisibility();
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
  state.queue = songs;
  state.queueIndex = index;
  state.currentContext = context === 'playlist' ? playlistId : null;
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

// ---- 后台播放：bgAudio 接管 ----
// 流程：
//   前台播放时：bgAudio 静音预缓冲当前歌曲（preload），切后台几乎零延迟接续
//   切后台：销毁 iframe → bgAudio 解除静音、seek 到 elapsed → play()
//   后台切歌：bgAudio 换 src → 重新 preload → play()
//   回前台：mountVideoAt 带时间戳建 iframe → iframe canplay 后停 bgAudio（交叉，无空档）
const bgAudio = document.getElementById('audio');
let _bgBvid = null;         // 当前 bgAudio 加载的 bvid（preload 或正在播）
let _bgPlaying = false;     // bgAudio 当前是否在有声播放（非 preload）

// bgAudio ended 事件：后台切歌最可靠的通知（不被 Chrome 节流/冻结影响）
bgAudio.addEventListener('ended', () => {
  if (_bgPlaying) {
    console.log(`[bgAudio] ended at ${bgAudio.currentTime?.toFixed(1)}s — auto advance`);
    _bgPlaying = false;
    autoAdvance();
  }
});
// 后台诊断日志：监听 bgAudio 各种状态事件 —— 附带恢复逻辑
// 流中断时 <audio> 不会触发 ended，而是 stalled + 静默停止，必须主动恢复
let _bgStalledTimer = null;
bgAudio.addEventListener('error', () => {
  const err = bgAudio.error;
  console.warn(`[bgAudio] ERROR code=${err?.code} message="${err?.message}" src=${bgAudio.src?.slice(0,60)}`);
  // 后台播放中流错误 → 直接切歌（无法恢复）
  if (_bgPlaying) {
    console.warn(`[bgAudio] ERROR during bg play — auto advance`);
    _bgPlaying = false;
    autoAdvance();
  }
});
bgAudio.addEventListener('stalled', () => {
  const ct = bgAudio.currentTime?.toFixed(1) || '?';
  console.warn(`[bgAudio] STALLED currentTime=${ct}s readyState=${bgAudio.readyState}`);
  // 后台播放中卡住 → 等 3 秒，如果还没恢复就切歌
  if (_bgPlaying && !_bgStalledTimer) {
    _bgStalledTimer = setTimeout(() => {
      _bgStalledTimer = null;
      if (!_bgPlaying) return;
      const ct2 = bgAudio.currentTime?.toFixed(1) || '?';
      console.warn(`[bgAudio] STALLED 3s+ at ${ct2}s — auto advance`);
      _bgPlaying = false;
      autoAdvance();
    }, 3000);
  }
});
bgAudio.addEventListener('playing', () => {
  // 恢复播放时清除 stalled 定时器
  if (_bgStalledTimer) { clearTimeout(_bgStalledTimer); _bgStalledTimer = null; }
});
bgAudio.addEventListener('waiting', () => {
  console.log(`[bgAudio] waiting (buffering) currentTime=${bgAudio.currentTime?.toFixed(1)}s`);
});
bgAudio.addEventListener('canplay', () => {
  console.log(`[bgAudio] canplay readyState=${bgAudio.readyState} duration=${bgAudio.duration?.toFixed(1)}s`);
});
bgAudio.addEventListener('loadeddata', () => {
  console.log(`[bgAudio] loadeddata duration=${bgAudio.duration?.toFixed(1)}s`);
});
bgAudio.addEventListener('pause', () => {
  if (_bgPlaying) console.log(`[bgAudio] pause event (unexpected? bgPlaying=${_bgPlaying})`);
});
bgAudio.addEventListener('play', () => {
  console.log(`[bgAudio] play event currentTime=${bgAudio.currentTime?.toFixed(1)}s`);
});
let _pendingMount = null;   // { bvid, title }：回前台时需要挂载的 iframe
let _bgVolume = 0.8;        // WeMusic 自维护音量（0~1），持久化

// 前台静音预缓冲：加载 src 但不 play，切后台时可立即接续
function _bgPreload(bvid) {
  if (_bgBvid === bvid) return;
  console.log(`[bg:state] preload bvid=${bvid} (was ${_bgBvid || 'none'})`);
  _bgBvid = bvid;
  _bgPlaying = false;
  bgAudio.src = `/api/play/stream?bvid=${bvid}&token=${encodeURIComponent(Auth.token)}`;
  bgAudio.muted = true;
  bgAudio.volume = _bgVolume;
  bgAudio.load();
}

// 解除静音并从指定进度开始播放（切后台时调用）
function _bgUnmuteAndPlay(seekSec) {
  console.log(`[bg:state] unmute+play seekSec=${seekSec}s bvid=${_bgBvid}`);
  bgAudio.muted = false;
  bgAudio.volume = _bgVolume;
  _bgPlaying = true;

  // 重试 play() 直到成功或达到上限（后台 src 刚换完，数据可能还没加载好）
  let retries = 0;
  const doPlay = () => {
    bgAudio.play().then(() => {
      console.log(`[bg:retry] play() SUCCESS at retry=${retries}, currentTime=${bgAudio.currentTime?.toFixed(1)}s`);
      // play() 成功后 5 秒做健康检查：如果又停了且没被外部暂停，重试
      if (_bgHealthCheckId) clearTimeout(_bgHealthCheckId);
      _bgHealthCheckId = setTimeout(() => {
        _bgHealthCheckId = null;
        if (_bgPlaying && bgAudio.paused && !timerPaused) {
          console.warn(`[bgAudio] health-check FAILED (paused at ${bgAudio.currentTime?.toFixed(1)}s) — retrying`);
          retries = 0;
          doPlay();
        }
      }, 5000);
    }).catch((e) => {
      retries++;
      if (retries <= 10) {
        const delay = 500 * Math.min(retries, 6);
        console.log(`[bg:retry] play() attempt ${retries}/10 failed (${e.name}) — retry in ${delay}ms`);
        setTimeout(doPlay, delay);
      } else {
        console.warn(`[bg:retry] play() FAILED after 10 retries — giving up`);
      }
    });
  };

  if (seekSec > 2 && Math.abs(bgAudio.currentTime - seekSec) > 1) {
    const onSeeked = () => { bgAudio.removeEventListener('seeked', onSeeked); doPlay(); };
    bgAudio.addEventListener('seeked', onSeeked);
    bgAudio.currentTime = seekSec;
    // 兜底：seek 超过 1.5s 未响应则直接 play（避免死等）
    setTimeout(() => {
      bgAudio.removeEventListener('seeked', onSeeked);
      if (bgAudio.paused) doPlay();
    }, 1500);
  } else {
    // 等 canplay 再播，避免数据没加载好就被浏览器拒绝
    if (bgAudio.readyState >= 2) { // HAVE_CURRENT_DATA 或更高
      doPlay();
    } else {
      const onCan = () => { bgAudio.removeEventListener('canplay', onCan); doPlay(); };
      bgAudio.addEventListener('canplay', onCan);
    }
  }
}

let _bgHealthCheckId = null;
function _bgStop() {
  _stopBgSync();
  if (_bgHealthCheckId) { clearTimeout(_bgHealthCheckId); _bgHealthCheckId = null; }
  if (_bgStalledTimer) { clearTimeout(_bgStalledTimer); _bgStalledTimer = null; }
  if (!_bgBvid) return;
  console.log(`[bg:state] stop bvid=${_bgBvid}`);
  bgAudio.pause();
  bgAudio.muted = true;
  bgAudio.src = '';
  _bgBvid = null;
  _bgPlaying = false;
}

// 后台时每 4 秒用 bgAudio.currentTime 校准 elapsed（消除 setInterval 节流漂移）
let _bgSyncTimer = null;
let _bgLastCurrentTime = 0; // 上一次检测的 currentTime，用于停滞检测
function _startBgSync() {
  _stopBgSync();
  _bgLastCurrentTime = bgAudio.currentTime || 0;
  _bgSyncTimer = setInterval(() => {
    // 恢复检查：后台应该播放但 bgAudio 停了 → 尝试重启
    if (_bgPlaying && bgAudio.paused && !timerPaused) {
      const ct = bgAudio.currentTime?.toFixed(1) || '?';
      console.warn(`[bgSync] bgAudio paused unexpectedly at ${ct}s (elapsed=${elapsed}s, dur=${totalDur}s, readyState=${bgAudio.readyState}) — restarting`);
      bgAudio.play().then(() => {
        console.log(`[bgSync] restart succeeded, now at ${bgAudio.currentTime?.toFixed(1)}s`);
      }).catch((e) => {
        console.warn(`[bgSync] restart FAILED: ${e.name} — ${e.message?.slice(0,60)}`);
      });
      _bgLastCurrentTime = bgAudio.currentTime || 0;
      return;
    }
    if (!_bgPlaying || bgAudio.paused || !bgAudio.currentTime) {
      _bgLastCurrentTime = bgAudio.currentTime || 0;
      return;
    }
    const real = Math.round(bgAudio.currentTime);
    if (Math.abs(real - elapsed) >= 2) {
      console.log(`[bgSync] calibrate elapsed ${elapsed}s → ${real}s (bgAudio.currentTime)`);
      elapsed = real;
      _updateCoverRing();
    }
    // 停滞检测：currentTime 连续 2 轮没变化（8s+）且已播放过半 → 流已死，切歌
    if (_bgLastCurrentTime > 0 && Math.abs(bgAudio.currentTime - _bgLastCurrentTime) < 0.5) {
      const pct = totalDur > 0 ? Math.round(real / totalDur * 100) : 0;
      console.warn(`[bgSync] STALL DETECTED — currentTime stuck at ${real}s (~${pct}%), dur=${totalDur}s — auto advance`);
      _bgPlaying = false;
      _bgLastCurrentTime = 0;
      autoAdvance();
      return;
    }
    _bgLastCurrentTime = bgAudio.currentTime;
    // autoAdvance 完全由 bgAudio.ended 事件触发，不在此主动切歌
    // 避免 bgAudio.currentTime 瞬时跳变 / 流时长与元数据不一致时提前切断播放
  }, 4000);
  console.log('[bgSync] timer started (4s interval)');
}
function _stopBgSync() {
  if (_bgSyncTimer) { clearInterval(_bgSyncTimer); _bgSyncTimer = null; }
}

// 通过 postMessage 控制 B 站 iframe 音量（官方支持的消息协议）
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

export function startVideo(bvid, title, dur) {
  _iframeStartCalibrated = false;
  if (document.hidden) {
    // 后台切歌：重新 preload 新歌，立即播放
    console.log(`[bg:state] startVideo (hidden) bvid=${bvid} title="${title?.slice(0,30)}"`);
    _bgBvid = null; // 强制重新 preload
    _bgPreload(bvid);
    _bgUnmuteAndPlay(0); // 新歌从 0 开始
    _pendingMount = { bvid, title };
    $('videoContainer').dataset.pendingBvid = bvid;
  } else {
    // 前台：挂载 iframe，同时静音预缓冲 bgAudio（为下次切后台做准备）
    _bgStop();
    _pendingMount = null;
    delete $('videoContainer').dataset.pendingBvid;
    mountVideo(bvid, title);
    // 500ms 后预缓冲：给 iframe 短暂优先带宽启动，避免争抢导致双方都慢
    setTimeout(() => _bgPreload(bvid), 500);
  }
  applyPaneVisibility();
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

// B 站 iframe 真实启动时间检测：
// B 站播放器会通过 postMessage 发送心跳（包含 type:'heartbeat' 或 currentTime 等）
// 监听第一条有效消息即可知道视频真正开始播放的时刻，用于校正计时器偏移
let _iframeStartCalibrated = false; // 当前歌是否已校正过

function _onBiliMessage(e) {
  if (_iframeStartCalibrated) return;
  if (!state.current?.bvid || document.hidden) return;
  // B 站消息结构：{ type, data } 或直接字符串，只要收到任意一条就说明播放器已初始化
  try {
    const d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
    if (!d || typeof d !== 'object') return;
    // 任意 B 站播放器消息（heartbeat / statechange 等）
    if (!d.type && !d.event) return;
  } catch { return; }

  const mountedAt = Number($('videoContainer').dataset.mountedAt || 0);
  if (!mountedAt) return;
  const delay = (Date.now() - mountedAt) / 1000; // iframe 从创建到视频开始的秒数
  if (delay < 0.5 || delay > 15) return; // 不合理则忽略

  // 把计时器往回拨：elapsed 实际上多走了 delay 秒
  // 修正：elapsed = 当前 elapsed - delay（但不能小于 0）
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
  // seekBar 禁用（跨域 iframe 无法 seek）
  $('seekBar').disabled = true;

  // 监听 B 站 iframe postMessage，检测视频真实启动时刻，校正计时器
  window.addEventListener('message', _onBiliMessage);

  // 音量控件：控制后台 bgAudio 的音量（前台 iframe 音量需在 B 站播放器内调节）
  _bgVolume = Number(localStorage.getItem('wemusic_vol') || 0.8);
  const volBar = $('volBar');
  const volBtn = $('volBtn');
  const volOnIcon = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19 11,5"/><path d="M15.5 8.5a4.5 4.5 0 0 1 0 7"/><path d="M19 5a9 9 0 0 1 0 14"/></svg>`;
  const volOffIcon = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19 11,5"/><line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/></svg>`;
  const _applyVol = () => {
    bgAudio.volume = _bgVolume;
    bgAudio.muted = (_bgVolume === 0);
    const pct = Math.round(_bgVolume * 100);
    volBar.value = pct;
    volBar.style.setProperty('--vol-fill', pct + '%');
    // 静音时隐掉滑块拇指，避免残留的 accent 色
    volBar.style.setProperty('--vol-thumb-bg', pct === 0 ? 'transparent' : 'var(--accent)');
    volBar.style.setProperty('--vol-thumb-border', pct === 0 ? 'transparent' : 'var(--accent)');
    volBtn.innerHTML = _bgVolume === 0 ? volOffIcon : volOnIcon;
    volBtn.title = document.hidden ? '后台音量' : '后台音量（前台请在视频内调节）';
  };
  _applyVol();
  volBar.oninput = () => {
    _bgVolume = volBar.value / 100;
    localStorage.setItem('wemusic_vol', _bgVolume);
    _applyVol();
    _setIframeVolume(_bgVolume); // 同步 iframe 音量
  };
  let _prevVol = _bgVolume;
  const volWrap = document.querySelector('.volume-wrap');
  volBtn.onclick = (e) => {
    e.stopPropagation();
    if (!volWrap.classList.contains('open')) {
      volWrap.classList.add('open');
    } else {
      if (_bgVolume > 0) { _prevVol = _bgVolume; _bgVolume = 0; }
      else { _bgVolume = _prevVol || 0.8; }
      localStorage.setItem('wemusic_vol', _bgVolume);
      _applyVol();
      _setIframeVolume(_bgVolume);
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

  $('videoBtn').onclick = () => {
    if (!state.current || !state.current.bvid) return toast('请先播放一首歌曲');
    if ($('videoContainer').children.length === 0) { playCurrent(); return; }
    setPaneVisible(!state.paneVisible);
  };
  $('vpHide').onclick = () => setPaneVisible(false);
  $('vpClose').onclick = () => { destroyVideo(); applyPaneVisibility(); setStatus('已停止'); };
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
    if (state.current && $('videoContainer').children.length > 0) {
      timerPaused = false; $('playPauseBtn').innerHTML = PAUSE_ICON;
      $('playPauseBtn').title = '暂停自动连播';
    } else if (state.current) { playCurrent(); }
  });
  navigator.mediaSession.setActionHandler('pause', () => {
    timerPaused = true; $('playPauseBtn').innerHTML = PLAY_ICON;
    $('playPauseBtn').title = '继续自动连播';
  });
  navigator.mediaSession.setActionHandler('previoustrack', playPrev);
  navigator.mediaSession.setActionHandler('nexttrack', () => playNext(false));

  document.addEventListener('visibilitychange', () => {
    if (!bgAudio) return;
    if (!autoTimer || timerPaused) return;

    if (document.hidden) {
      // 切到后台：销毁 iframe，bgAudio 接管
      if (!state.current?.bvid) return;
      console.log(`[bg:state] visibility HIDDEN — switching to bgAudio (elapsed=${elapsed}s, bvid=${state.current.bvid})`);
      if (_bgBvid !== state.current.bvid) _bgPreload(state.current.bvid);
      $('videoContainer').innerHTML = '';
      _pendingMount = { bvid: state.current.bvid, title: state.current._biliTitle };
      $('videoContainer').dataset.pendingBvid = state.current.bvid;
      _bgUnmuteAndPlay(elapsed);
      _startBgSync();
    } else {
      // 回到前台：停 bgAudio，重建 iframe
      if (!state.current?.bvid) return;
      console.log(`[bg:state] visibility VISIBLE — switching to iframe (elapsed=${elapsed}s, bgPlaying=${_bgPlaying}, bgPaused=${bgAudio.paused})`);
      _stopBgSync(); // 停止后台校准

      // 用 bgAudio.currentTime 校正进度
      if (_bgPlaying && bgAudio.currentTime > 1) {
        elapsed = Math.round(bgAudio.currentTime);
        $('curTime').textContent = fmtDur(elapsed);
        if (totalDur > 0) _updateSeekBarUI(elapsed, totalDur);
      }

      // 重建 iframe，带时间戳对齐进度
      const target = _pendingMount ?? { bvid: state.current.bvid, title: state.current._biliTitle };
      _pendingMount = null;
      delete $('videoContainer').dataset.pendingBvid;
      mountVideoAt(target.bvid, target.title, elapsed > 5 ? elapsed : 0);
      applyPaneVisibility();
      // 更新底部播放器视频标题（空值时兜底为歌名）
      const vt = target.title || (state.current?.name && state.current?.singer ? `${state.current.name} - ${state.current.singer}` : 'Bilibili 播放');
      $('playStatus').innerHTML = `<span class="status-inner"><span class="badge">${PLAY_ICON} Bilibili</span> ${esc(vt)}</span>`;
      const inner = $('playStatus').querySelector('.status-inner');
      if (inner) checkMarquee(inner);

      // 交叉：收到来自 B 站的 postMessage（视频已初始化）时立即停 bgAudio
      // 兜底：800ms 后无论如何停止（避免双声道时间过长）
      let _crossStopped = false;
      const stopCross = () => {
        if (_crossStopped) return;
        _crossStopped = true;
        window.removeEventListener('message', crossMsg);
        _bgStop();
      };
      const crossMsg = (e) => {
        // 只处理来自 B 站播放器域名的消息，排除 WeMusic 自发的
        if (!e.origin?.includes('bilibili.com')) return;
        try {
          const d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
          if (d && typeof d === 'object' && (d.type || d.event)) stopCross();
        } catch { /* 消息格式非法，忽略 */ }
      };
      window.addEventListener('message', crossMsg);
      setTimeout(stopCross, 800); // 兜底缩短到 800ms

      // 同步 iframe 音量
      setTimeout(() => _setIframeVolume(_bgVolume), 400);
    }
  });
}

// 导出可被外部（歌词页、键盘快捷键）调用的暂停切换函数
// 不能通过 p.timerPaused 直接赋值（构建后为只读 getter），只能通过此函数操作
export function togglePause() {
  if (!state.current) return 'noSong';
  const vc = $('videoContainer');
  const mounted = vc.children.length > 0 || !!vc.dataset.pendingBvid;
  if (!mounted) { playCurrent(); return 'mounted'; }
  timerPaused = !timerPaused;
  $('playPauseBtn').innerHTML = timerPaused ? PLAY_ICON : PAUSE_ICON;
  $('playPauseBtn').title = timerPaused ? '继续自动连播' : '暂停自动连播';
  if (document.hidden && _bgBvid) {
    if (timerPaused) bgAudio.pause();
    else bgAudio.play().catch(() => {});
  }
  return timerPaused;
}
