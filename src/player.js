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
  setVpTitle(title);
  $('videoContainer').innerHTML =
    `<iframe src="${biliEmbed(bvid)}" allowfullscreen allow="autoplay; fullscreen" scrolling="no" frameborder="0"></iframe>`;
}

export function destroyVideo() {
  $('videoPane').classList.remove('show', 'fullscreen');
  $('videoContainer').innerHTML = '';
  stopTimer();
}

export function applyPaneVisibility() {
  const pane = $('videoPane');
  const mounted = $('videoContainer').children.length > 0;
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

export function startVideo(bvid, title, dur) {
  mountVideo(bvid, title);
  applyPaneVisibility();
  setVpTitle(title);
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
}
