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
}

export function destroyVideo() {
  $('videoPane').classList.remove('show', 'fullscreen');
  const vc = $('videoContainer');
  vc.innerHTML = '';
  delete vc.dataset.pendingBvid;
  _pendingMount = null;
  _stopBgAudio();
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

// ---- 双轨播放：后台用 <audio> 代理流，前台用 iframe ----
// 后台 Tab 时 iframe autoplay 会被浏览器阻止；<audio> 即使后台也可正常播放
const bgAudio = $('audio'); // HTML 中已有 <audio id="audio">

// 后台期间如果切了歌，记录需要在回前台时 mount 的 bvid/title
let _pendingMount = null; // { bvid, title }

export function startVideo(bvid, title, dur) {
  if (document.hidden) {
    // 后台：只启动 bgAudio，不操作 iframe（避免 autoplay 失败）
    // 记录待挂载信息，回前台时再建 iframe
    _pendingMount = { bvid, title };
    // 更新 videoContainer 占位信息（保证 applyPaneVisibility 判断正确）
    $('videoContainer').dataset.pendingBvid = bvid;
    _startBgAudio(bvid);
  } else {
    _pendingMount = null;
    delete $('videoContainer').dataset.pendingBvid;
    _stopBgAudio();
    mountVideo(bvid, title);
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
}

let _bgAudioBvid = null;
let _bgAudioTimeHandler = null;

function _startBgAudio(bvid) {
  if (_bgAudioBvid === bvid && !bgAudio.paused) return; // 已经在播这个
  _bgAudioBvid = bvid;
  _bgAudioEndGuard = false; // 新歌开始，重置切歌守卫

  // 移除旧的 timeupdate 监听
  if (_bgAudioTimeHandler) {
    bgAudio.removeEventListener('timeupdate', _bgAudioTimeHandler);
    _bgAudioTimeHandler = null;
  }

  bgAudio.src = `/api/play/stream?bvid=${bvid}`;
  bgAudio.load(); // 显式触发加载，避免旧状态残留导致 play() 失败
  bgAudio.volume = 1;
  bgAudio.muted = false;

  // 等音频元数据就绪后再播放（避免 ended 竞态导致的 AbortError）
  bgAudio.addEventListener('canplay', () => {
    if (_bgAudioBvid !== bvid) return;
    bgAudio.play().catch(() => {});
  }, { once: true });

  setStatus(`<span class="badge">▶ 后台播放</span> ${esc((state.current?.name || '').slice(0, 26))}`);

  // timeupdate 检测歌曲结束（替代 ended，稳定触发且不受竞态影响）
  _bgAudioTimeHandler = () => {
    if (!document.hidden) return;
    if (timerPaused) return;
    // bgAudio.currentTime 接近总长（前后留 2 秒容差）
    if (!bgAudio.duration || isNaN(bgAudio.duration)) return;
    if (bgAudio.currentTime < bgAudio.duration - 2) return;
    // 确认为结束时切歌
    if (_bgAudioEndGuard) return;
    _bgAudioEndGuard = true;
    stopTimer();
    _flushLog(totalDur || elapsed);
    if (sleepAfterSong) { stopPlayback(); clearSleep(); toast('定时已到，已停止'); return; }
    if (state.playMode === 'single') { playCurrent(); return; }
    playNext(true);
  };
  bgAudio.addEventListener('timeupdate', _bgAudioTimeHandler);
}
let _bgAudioEndGuard = false;

function _stopBgAudio() {
  if (_bgAudioTimeHandler) {
    bgAudio.removeEventListener('timeupdate', _bgAudioTimeHandler);
    _bgAudioTimeHandler = null;
  }
  _bgAudioEndGuard = false;
  if (!bgAudio.src && !_bgAudioBvid) return;
  bgAudio.pause();
  bgAudio.src = '';
  // 注意：不调用 bgAudio.load()，避免回前台时触发额外网络请求造成卡顿
  _bgAudioBvid = null;
}

export function initPlayer() {
  // 禁用进度条（跨域 iframe 限制）
  const volWrap = document.querySelector('.volume-wrap');
  if (volWrap) volWrap.style.display = 'none';
  $('seekBar').disabled = true;

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
    const mounted = $('videoContainer').children.length > 0;
    if (!mounted) { playCurrent(); return; }
    timerPaused = !timerPaused;
    $('playPauseBtn').textContent = timerPaused ? '▶' : '⏸';
    // 同步后台音频暂停/恢复
    if (document.hidden && state.current?.bvid) {
      if (timerPaused) { bgAudio.pause(); }
      else { bgAudio.play().catch(() => {}); }
    }
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
    if (!state.current?.bvid) return;

    if (document.hidden) {
      // 进入后台：启动 <audio> 代理流保持音频连续
      if (!timerPaused) _startBgAudio(state.current.bvid);
    } else {
      // 回到前台：
      // 1. 用 bgAudio.currentTime 校正 elapsed（消除后台计时器节流导致的进度滞后）
      const bgPos = bgAudio.currentTime; // bgAudio 的实际播放位置（秒）
      if (bgPos > 1 && bgPos < (totalDur || 99999)) {
        elapsed = Math.round(bgPos);
        $('curTime').textContent = fmtDur(elapsed);
        if (totalDur > 0) $('seekBar').value = Math.min(1000, Math.round((elapsed / totalDur) * 1000));
      }

      // 2. 停止 bgAudio（不 load()，避免额外网络请求造成卡顿）
      _stopBgAudio();

      // 3. 挂载/重载 iframe：优先用 _pendingMount（后台切了歌），否则用当前歌
      const target = _pendingMount || (
        ($('videoContainer').children.length > 0 || $('videoContainer').dataset.pendingBvid)
          ? { bvid: state.current.bvid, title: state.current._biliTitle }
          : null
      );
      if (target) {
        _pendingMount = null;
        delete $('videoContainer').dataset.pendingBvid;
        // 带时间戳参数让 B 站播放器从当前进度开始，减少体感滞后
        const seekSec = elapsed > 5 ? elapsed : 0;
        mountVideoAt(target.bvid, target.title, seekSec);
        applyPaneVisibility();
      }
    }
  });
}
