// ---------------- 播放核心 ----------------
import { $, fmtDur, esc, biliEmbed, albumCover, toast } from './utils.js';
import { api } from './api.js';
import { state } from './state.js';
import { clearSleep, sleepAfterSong } from './settings.js';

export let autoTimer = null;
export let elapsed = 0;
export let totalDur = 0;
export let timerPaused = false;
export let playSeq = 0;

// ---- 播放日志 ----
let _logTimer = null;
let _pendingSong = null;
let _pendingDur = 0;

export function logPlay(song, dur) {
  if (!song) return;
  _flushLog(elapsed);
  if (_logTimer) clearTimeout(_logTimer);
  _pendingSong = null;
  _logTimer = setTimeout(() => {
    _pendingSong = song;
    _pendingDur = dur || song.duration || 0;
  }, 5000);
}

export function _flushLog(playedSec) {
  if (!_pendingSong) return;
  const song = _pendingSong;
  const dur = _pendingDur;
  _pendingSong = null; _pendingDur = 0;
  const sec = Math.max(0, Math.min(Math.round(playedSec), dur || 9999));
  if (sec < 5) return;
  api('/stats/log', {
    method: 'POST',
    body: {
      song_mid: song.song_mid, name: song.name, singer: song.singer,
      album: song.album, album_mid: song.album_mid, duration: dur,
      played_sec: sec, bvid: song.bvid,
    },
  }).catch(() => {});
}

// ---- 进度控制 ----
export function resetProgress(d) {
  elapsed = 0; totalDur = Number(d) || 0; timerPaused = false;
  $('curTime').textContent = '0:00';
  $('durTime').textContent = fmtDur(totalDur);
  $('seekBar').value = 0;
}

export function startTimer(d) {
  stopTimer();
  totalDur = Number(d) || totalDur || (state.current && state.current.duration) || 0;
  $('durTime').textContent = fmtDur(totalDur);
  timerPaused = false;
  $('playPauseBtn').textContent = '⏸';
  autoTimer = setInterval(() => {
    if (timerPaused) return;
    elapsed++;
    $('curTime').textContent = fmtDur(elapsed);
    if (totalDur > 0) {
      $('seekBar').value = Math.min(1000, Math.round((elapsed / totalDur) * 1000));
      if (elapsed >= totalDur + 1) autoAdvance();
    }
  }, 1000);
}

export function stopTimer() {
  if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
}

function autoAdvance() {
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
  el.textContent = title || 'Bilibili 播放';
  el.classList.remove('scrolling');
  requestAnimationFrame(() => {
    if (el.scrollWidth > el.clientWidth + 4) {
      const dist = -(el.scrollWidth - el.clientWidth + 20);
      el.style.setProperty('--scroll-dist', dist + 'px');
      el.classList.add('scrolling');
    }
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
  const npc = $('npCover');
  const url = albumCover(song && song.album_mid, 150);
  if (url) {
    const img = new Image();
    img.onload = () => { npc.style.backgroundImage = `url(${url})`; npc.classList.add('show'); };
    img.onerror = () => { npc.classList.remove('show'); npc.style.backgroundImage = ''; };
    img.src = url;
  } else {
    npc.classList.remove('show');
    npc.style.backgroundImage = '';
  }
}

export function highlightPlaying() {
  document.querySelectorAll('.song-row.playing').forEach((r) => r.classList.remove('playing'));
  if (!state.current) return;
  const curKey = `${state.current.name}__${state.current.singer || ''}`;
  document.querySelectorAll('.song-list').forEach((list) => {
    if (list._songs === state.queue) {
      const row = list.querySelector(`.song-row[data-i="${state.queueIndex}"]`);
      if (row) { row.classList.add('playing'); try { row.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch {} }
      return;
    }
    list.querySelectorAll('.song-row').forEach((row) => {
      const i = Number(row.dataset.i);
      const s = list._songs && list._songs[i];
      if (s && `${s.name}__${s.singer || ''}` === curKey) row.classList.add('playing');
    });
  });
}

// ---- 会话持久化 ----
export function saveSession() {
  try {
    const q = state.queue.slice(0, 800).map((s) => ({
      id: s.id, song_mid: s.song_mid, name: s.name, singer: s.singer,
      album: s.album, album_mid: s.album_mid, duration: s.duration, bvid: s.bvid,
      _biliTitle: s._biliTitle, _biliDur: s._biliDur,
    }));
    localStorage.setItem('wemusic_session', JSON.stringify({
      queue: q, queueIndex: state.queueIndex, currentContext: state.currentContext,
    }));
  } catch {}
}

export function restoreSession() {
  try {
    const s = JSON.parse(localStorage.getItem('wemusic_session') || 'null');
    if (!s || !Array.isArray(s.queue) || s.queue.length === 0) return;
    state.queue = s.queue;
    state.queueIndex = s.queueIndex >= 0 && s.queueIndex < s.queue.length ? s.queueIndex : 0;
    state.currentContext = s.currentContext || null;
    state.current = state.queue[state.queueIndex];
    if (state.current) {
      $('npTitle').textContent = state.current.name;
      $('npSinger').textContent = state.current.singer || '';
      updateNpCover(state.current);
      $('durTime').textContent = fmtDur(state.current._biliDur || state.current.duration);
      setStatus('上次播放 · 点 ▶ 继续');
    }
  } catch {}
}

// ---- bvid 缓存 ----
export function cacheBvid(song) {
  if (state.currentContext && song.id) {
    api(`/playlists/${state.currentContext}/songs/${song.id}/bvid`, {
      method: 'PUT', body: { bvid: song.bvid },
    }).catch(() => {});
  }
  if (song.song_mid) {
    api(`/stats/bvid/${encodeURIComponent(song.song_mid)}`, {
      method: 'PUT',
      body: { name: song.name, singer: song.singer, bvid: song.bvid, bili_title: song._biliTitle, bili_dur: song._biliDur },
    }).catch(() => {});
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
  loop: { icon: '🔁', label: '列表循环' },
  single: { icon: '🔂', label: '单曲循环' },
  shuffle: { icon: '🔀', label: '随机播放' },
};
const MODE_ORDER = ['loop', 'single', 'shuffle'];

export function renderMode() {
  const m = MODE_META[state.playMode] || MODE_META.loop;
  const btn = $('modeBtn');
  btn.textContent = m.icon;
  btn.title = '播放模式：' + m.label;
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
    if (song.song_mid) {
      const cached = await api(`/stats/bvid/${encodeURIComponent(song.song_mid)}`);
      if (cached.cached) {
        song.bvid = cached.bvid;
        song._biliTitle = cached.bili_title;
        song._biliDur = cached.bili_dur || song.duration;
        return;
      }
    }
    const { best, candidates } = await api('/play/resolve', {
      method: 'POST',
      body: { name: song.name, singer: song.singer, duration: song.duration },
    });
    song._candidates = candidates;
    if (best) {
      song.bvid = best.bvid;
      song._biliTitle = best.title;
      song._biliDur = best.duration || song.duration;
      cacheBvid(song);
    }
  } catch {}
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
  $('npTitle').textContent = song.name;
  $('npSinger').textContent = song.singer || '';
  document.title = `${song.name}${song.singer ? ' · ' + song.singer.split('/')[0] : ''} — WeMusic`;
  updateNpCover(song);
  updateMediaSession(song);
  setTimeout(() => import('./ui.js').then(({ updateNpLikeBtn }) => updateNpLikeBtn()), 0);
  resetProgress(song.duration);

  if (!song.bvid && song.song_mid) {
    try {
      const cached = await api(`/stats/bvid/${encodeURIComponent(song.song_mid)}`);
      if (cached.cached && seq === playSeq) {
        song.bvid = cached.bvid;
        song._biliTitle = cached.bili_title;
        song._biliDur = cached.bili_dur || song.duration;
      }
    } catch {}
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
      if (!best) { setStatus('未找到合适资源，可点「换源」'); return; }
      song.bvid = best.bvid;
      song._biliTitle = best.title;
      song._biliDur = best.duration || song.duration;
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
let _pendingMount = null;   // { bvid, title }：回前台时需要挂载的 iframe
let _bgVolume = 0.8;        // WeMusic 自维护音量（0~1），持久化

// 前台静音预缓冲：加载 src 但不 play，切后台时可立即接续
function _bgPreload(bvid) {
  if (_bgBvid === bvid) return; // 已加载
  _bgBvid = bvid;
  _bgPlaying = false;
  bgAudio.src = `/api/play/stream?bvid=${bvid}`;
  bgAudio.muted = true;   // 静音，避免与 iframe 叠声
  bgAudio.volume = _bgVolume;
  bgAudio.load();         // 触发网络请求，开始缓冲（不 play）
}

// 解除静音并从指定进度开始播放（切后台时调用）
function _bgUnmuteAndPlay(seekSec) {
  bgAudio.muted = false;
  bgAudio.volume = _bgVolume;
  _bgPlaying = true;

  const doPlay = () => bgAudio.play().catch(() => setTimeout(() => bgAudio.play().catch(() => {}), 500));

  if (seekSec > 2 && Math.abs(bgAudio.currentTime - seekSec) > 1) {
    // 需要 seek：等 seeked 后再 play
    const onSeeked = () => { bgAudio.removeEventListener('seeked', onSeeked); doPlay(); };
    bgAudio.addEventListener('seeked', onSeeked);
    bgAudio.currentTime = seekSec;
  } else {
    doPlay();
  }
}

function _bgStop() {
  if (!_bgBvid) return;
  bgAudio.pause();
  bgAudio.muted = true;
  bgAudio.src = '';
  _bgBvid = null;
  _bgPlaying = false;
}

export function startVideo(bvid, title, dur) {
  _iframeStartCalibrated = false; // 每首新歌重置校正状态
  if (document.hidden) {
    // 后台切歌：重新 preload 新歌，立即播放
    _bgBvid = null; // 强制重新 preload
    _bgPreload(bvid);
    _bgUnmuteAndPlay(0); // 新歌从 0 开始
    _pendingMount = { bvid, title };
    $('videoContainer').dataset.pendingBvid = bvid;
  } else {
    // 前台：挂载 iframe，静音预缓冲 bgAudio（为下次切后台做准备）
    _bgStop();
    _pendingMount = null;
    delete $('videoContainer').dataset.pendingBvid;
    mountVideo(bvid, title);
    // 延迟 1s 再预缓冲，避免与 iframe 初始加载抢带宽
    setTimeout(() => _bgPreload(bvid), 1000);
  }
  applyPaneVisibility();
  setStatus(`<span class="badge">▶ Bilibili</span> ${esc((title || '').slice(0, 26))}`);
  startTimer(dur);
  saveSession();
  import('./queue.js').then(({ pushPlayHistory, renderActiveTab }) => {
    pushPlayHistory(state.current);
    if ($('queueDrawer').classList.contains('show')) renderActiveTab();
  });
  logPlay(state.current, dur);
  import('./lyrics.js').then(({ updateLyricsPanelMeta, loadLyrics, lyricsFor, setLyricsFor }) => {
    if ($('lyricsPanel').classList.contains('show') && state.current) {
      updateLyricsPanelMeta(state.current);
      $('lyricsPanel').classList.add('playing');
      setLyricsFor('');
      loadLyrics(state.current);
    }
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
    if (totalDur > 0) $('seekBar').value = Math.min(1000, Math.round((elapsed / totalDur) * 1000));
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
  const _applyVol = () => {
    bgAudio.volume = _bgVolume;
    bgAudio.muted = (_bgVolume === 0);
    volBar.value = Math.round(_bgVolume * 100);
    volBtn.textContent = _bgVolume === 0 ? '🔇' : '🔊';
    volBtn.title = document.hidden ? '后台音量' : '后台音量（前台请在视频内调节）';
  };
  _applyVol();
  volBar.oninput = () => {
    _bgVolume = volBar.value / 100;
    localStorage.setItem('wemusic_vol', _bgVolume);
    _applyVol();
  };
  let _prevVol = _bgVolume;
  volBtn.onclick = () => {
    if (_bgVolume > 0) { _prevVol = _bgVolume; _bgVolume = 0; }
    else { _bgVolume = _prevVol || 0.8; }
    localStorage.setItem('wemusic_vol', _bgVolume);
    _applyVol();
  };

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
    if (!state.current) return toast('请选择一首歌曲播放');
    const vc = $('videoContainer');
    const mounted = vc.children.length > 0 || !!vc.dataset.pendingBvid;
    if (!mounted) { playCurrent(); return; }
    timerPaused = !timerPaused;
    $('playPauseBtn').textContent = timerPaused ? '▶' : '⏸';
    // 后台时同步控制 bgAudio
    if (document.hidden && _bgBvid) {
      if (timerPaused) bgAudio.pause();
      else bgAudio.play().catch(() => {});
    }
    toast(timerPaused ? '已暂停' : '继续播放');
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

  // Media Session
  navigator.mediaSession.setActionHandler('play', () => {
    if (state.current && $('videoContainer').children.length > 0) {
      timerPaused = false; $('playPauseBtn').textContent = '⏸';
    } else if (state.current) { playCurrent(); }
  });
  navigator.mediaSession.setActionHandler('pause', () => {
    timerPaused = true; $('playPauseBtn').textContent = '▶';
  });
  navigator.mediaSession.setActionHandler('previoustrack', playPrev);
  navigator.mediaSession.setActionHandler('nexttrack', () => playNext(false));

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      // 切到后台：bgAudio 已预缓冲，直接 seek+play，几乎无延迟
      if (!state.current?.bvid || timerPaused) return;
      // 确保 preload 的是当前歌曲（正常情况下 startVideo 已经 preload 过了）
      if (_bgBvid !== state.current.bvid) _bgPreload(state.current.bvid);
      $('videoContainer').innerHTML = '';
      _pendingMount = { bvid: state.current.bvid, title: state.current._biliTitle };
      $('videoContainer').dataset.pendingBvid = state.current.bvid;
      _bgUnmuteAndPlay(elapsed);
    } else {
      // 回到前台：
      if (!state.current?.bvid) return;

      // 用 bgAudio.currentTime 校正进度（后台计时器可能有节流误差）
      if (_bgPlaying && bgAudio.currentTime > 1) {
        elapsed = Math.round(bgAudio.currentTime);
        $('curTime').textContent = fmtDur(elapsed);
        if (totalDur > 0) $('seekBar').value = Math.min(1000, Math.round((elapsed / totalDur) * 1000));
      }

      // 重建 iframe，带时间戳对齐进度
      const target = _pendingMount ?? { bvid: state.current.bvid, title: state.current._biliTitle };
      _pendingMount = null;
      delete $('videoContainer').dataset.pendingBvid;
      mountVideoAt(target.bvid, target.title, elapsed > 5 ? elapsed : 0);
      applyPaneVisibility();

      // 交叉：等 iframe 内容开始加载后再停 bgAudio，避免空档期卡顿
      // 用短延迟兜底（iframe canplay 跨域无法监听）
      setTimeout(() => _bgStop(), 1800);
    }
  });
}
