// ---------------- 歌词全屏页（含换源支持） ----------------
import { $, esc, albumCover, singerAvatar, toast, PLAY_ICON, PAUSE_ICON, fetchBlockedList, blockedSectionHtml, bindBlockedSection, saveBlockedMeta } from './utils.js';
import { api } from './api.js';
import { state } from './state.js';
import { LyricsSource } from './platform.js';
import * as offline from './offlineCache.js';

// 无封面时的占位图标（音乐符号，240x240 画布上居中）
const PLACEHOLDER_COVER_SVG = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240" fill="none">' +
  '<rect width="240" height="240" fill="#a0a0a0" opacity=".12" rx="0"/>' +
  '<g transform="translate(72,56)">' +
  '<path d="M18 126V39l84-14v91" stroke="#6b6b6b" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>' +
  '<circle cx="30" cy="126" r="21" fill="#6b6b6b"/>' +
  '<circle cx="90" cy="112" r="21" fill="#6b6b6b"/>' +
  '</g></svg>'
);

// 预加载 player 模块（避免在 setInterval 中重复 import，解决循环依赖）
const _playerP = import('./player.js');
const _uiP = import('./ui.js');

export let lyricsLines = [];
export let lyricsFor = '';
export let lyricsCandidates = []; // 当前候选列表
export let lyricsCurrentSourceId = null; // 当前使用的网易云 songId
export let lyricsDebug = null;   // 最近一次歌词搜索的 debug 数据
let _lyricsSeq = 0;          // 单调递增序列号，防止陈旧网络响应覆盖当前数据
let _lyricsUISyncId = null;  // UI 同步 setInterval ID
let _lyricsSyncId = null;    // 进度同步 setInterval ID
let _spectrumEnabled = false;
let _spectrumRafId = null;
let _spectrumAnalyser = null;
let _spectrumData = null;
let _spectrumBufferLength = 0;
let _spectrumBars = null;     // 平滑后的每柱高度（0-1）
let _spectrumStyle = 'gradient'; // gradient | glow | wave
let _accentCache = { key: '', rgb: [42, 183, 88] };

// 用户滚动状态管理：区分主动滚动与自动滚动
let _userScrolling = false;      // 用户是否正在主动滚动歌词
let _scrollIdleTimer = null;     // 闲置倒计时 setTimeout ID
let _ignoreScrollUntil = 0;      // 时间戳，在此之前忽略 scroll 事件（过滤程序触发的滚动）
const SCROLL_IDLE_MS = 3000;     // 闲置超时：3 秒

export function setLyricsFor(v) { lyricsFor = v; }

// ---- localStorage 缓存：song_mid → netease_song_id ----
function getSourceCache() {
  try { return JSON.parse(localStorage.getItem('wemusic_lyrics_src') || '{}'); }
  catch { return {}; }
}
function saveSourceCache(songMid, sourceId) {
  const cache = getSourceCache();
  cache[songMid] = sourceId;
  localStorage.setItem('wemusic_lyrics_src', JSON.stringify(cache));
}

// 加载当前歌曲的背景信息（专辑简介）
let _bgLoading = false;
let _bgLoadedFor = '';

// 清理 QQ 音乐专辑简介：截断重复内容、去营销语
function cleanAlbumDesc(raw) {
  if (!raw) return '';
  // 去掉明显重复的段落（相同开头的段落保留第一个）
  const paras = raw.split(/\n\n+/);
  const seen = new Set();
  const clean = [];
  for (const p of paras) {
    const key = p.trim().slice(0, 30);
    if (seen.has(key)) continue;
    seen.add(key);
    clean.push(p);
  }
  let text = clean.join('\n\n');
  // 截断到 400 字左右
  if (text.length > 450) {
    text = text.slice(0, 450).replace(/\n[^\n]*$/, '') + '…';
  }
  return text;
}

export async function loadSongBackground(song) {
  const key = song.song_mid || `${song.name}__${song.singer || ''}`;
  if (_bgLoadedFor === key) return;
  _bgLoadedFor = key;
  if (_bgLoading) return;
  _bgLoading = true;
  const btn = document.getElementById('lpBgBtn');
  if (btn) btn.classList.remove('has-bg');
  try {
    const bg = await api(`/music/song-background?name=${encodeURIComponent(song.name)}&singer=${encodeURIComponent(song.singer || '')}&album_mid=${encodeURIComponent(song.album_mid || '')}`);
    if (!bg || !bg.desc) return;
    const title = bg.album_name || song.album || '未知专辑';
    const sub = [bg.aDate, bg.genre, bg.lan, bg.company].filter(Boolean).join(' · ');
    const desc = cleanAlbumDesc(bg.desc).replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>');
    $('lpBgCardTitle').textContent = title;
    $('lpBgCardSub').textContent = sub;
    $('lpBgCardBody').innerHTML = `<p>${desc}</p>`;
    if (btn) btn.classList.add('has-bg');
  } catch { console.warn('loadSongBackground 失败') }
  _bgLoading = false;
}

export function updateLyricsPanelMeta(song) {
  if (!song) return;
  $('lpTitle').textContent = `${song.name} · ${(song.singer || '').split('/')[0]}`;
  $('lpSongName').textContent = song.name || '';
  $('lpSongSinger').textContent = song.singer || '';

  // 三级兜底：专辑封面 → 歌手头像 → 默认音乐图标
  const albumUrl = song.album_mid ? albumCover(song.album_mid, 500) : '';
  const singerUrl = song.singer_mid ? singerAvatar(song.singer_mid, 500) : '';
  const coverImg = $('lpCoverImg');
  const bg = $('lpBg');

  function tryCover(url, fallback) {
    if (!url) return fallback();
    coverImg.src = url;
    coverImg.style.display = 'block';
    coverImg.removeAttribute('data-no-cover');
    bg.style.backgroundImage = `url(${url})`;
    coverImg.onerror = () => { coverImg.onerror = null; fallback(); };
  }

  tryCover(albumUrl, () => {
    tryCover(singerUrl, () => {
      // 最后兜底：默认音乐图标 + 渐变背景
      coverImg.src = PLACEHOLDER_COVER_SVG;
      coverImg.style.display = 'block';
      coverImg.setAttribute('data-no-cover', '');
      bg.style.backgroundImage = 'linear-gradient(135deg, var(--bg-card) 0%, var(--bg) 100%)';
    });
  });

  _uiP.then(({ heartOutline, heartFilled }) => {
  const isLiked = song.song_mid && state.likedMids && state.likedMids.has(song.song_mid);
  // .lp-like-row 是 grid 布局。上行：歌单/歌词/背景 三列；下行：♡ 按钮居中（grid-column: 1/-1 全宽 + justify-self: center）。
  $('lpLikeRow').innerHTML = `
    <button class="lp-action-btn" title="添加到歌单" id="lpAddBtn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg> 歌单</button>
    <button class="lp-action-btn" title="歌词换源" id="lpSwitchBtn">⤢ 歌词</button>
    <button class="lp-action-btn lp-bg-action" title="歌曲背景" id="lpBgBtn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg> 背景</button>
    ${song.song_mid ? `<button class="lp-action-btn like-btn${isLiked ? ' liked' : ''}" title="${isLiked ? '取消喜欢' : '喜欢'}" id="lpLikeBtn" style="grid-column:1/-1;justify-self:center">${isLiked ? heartFilled : heartOutline}</button>` : ''}
  `;
  const lpLikeBtn = document.getElementById('lpLikeBtn');
  if (lpLikeBtn) {
      lpLikeBtn.onclick = async () => {
      const { toggleLike, heartOutline, heartFilled } = await _uiP;
      await toggleLike(song, null);
      const liked2 = state.likedMids.has(song.song_mid);
      lpLikeBtn.innerHTML = liked2 ? heartFilled : heartOutline;
      lpLikeBtn.classList.toggle('liked', liked2);
      lpLikeBtn.title = liked2 ? '取消喜欢' : '喜欢';
    };
  }
  const lpAdd = document.getElementById('lpAddBtn');
  if (lpAdd) lpAdd.onclick = async () => {
    const { addSongs } = await import('./playlist-ui.js');
    addSongs([song]);
  };
  const lpSwitch = document.getElementById('lpSwitchBtn');
  if (lpSwitch) lpSwitch.onclick = () => openLyricsSwitchModal(song);
  const bgBtn = document.getElementById('lpBgBtn');
  if (bgBtn) bgBtn.onclick = () => {
    const ov = $('lpBgOverlay');
    ov.style.display = ov.style.display === 'none' || !ov.style.display ? 'flex' : 'none';
  };
  }); // close _uiP.then(...)
}

export function openLyricsPanel() {
  const panel = $('lyricsPanel');
  const cover = $('npCover');
  if (cover) {
    const r = cover.getBoundingClientRect();
    const cx = ((r.left + r.width / 2) / window.innerWidth * 100).toFixed(1) + '%';
    const cy = ((r.top + r.height / 2) / window.innerHeight * 100).toFixed(1) + '%';
    panel.style.setProperty('--lp-origin-x', cx);
    panel.style.setProperty('--lp-origin-y', cy);
  }
  panel.classList.add('show');
  document.body.style.overflow = 'hidden';
  startSpectrum();
  // 重置滚动状态：打开面板时恢复自动跟随
  _userScrolling = false;
  if (_scrollIdleTimer) { clearTimeout(_scrollIdleTimer); _scrollIdleTimer = null; }
  if (state.current) {
    updateLyricsPanelMeta(state.current);
    loadLyrics(state.current);
  }
  _playerP.then(({ autoTimer, timerPaused }) => {
    if (autoTimer && !timerPaused) panel.classList.add('playing');
    $('lpPlayBtn').innerHTML = timerPaused ? PLAY_ICON : PAUSE_ICON;
  });

  // 启动 UI 同步定时器（仅在面板显示时运行）
  if (_lyricsUISyncId) clearInterval(_lyricsUISyncId);
  _lyricsUISyncId = setInterval(() => {
    _playerP.then(({ isSeeking }) => {
      // 用户正在拖动任一进度条时跳过同步，避免覆盖拖拽中的滑块值
      if (isSeeking()) return;
      // 脏检查：仅在值变化时更新 DOM
      const ct = $('curTime').textContent,
            dt = $('durTime').textContent,
            sb = $('seekBar').value,
            pb = $('playPauseBtn').innerHTML;
      if ($('lpCurTime').textContent !== ct) $('lpCurTime').textContent = ct;
      if ($('lpDurTime').textContent !== dt) $('lpDurTime').textContent = dt;
      if ($('lpSeekBar').value !== sb) $('lpSeekBar').value = sb;
      if ($('lpPlayBtn').innerHTML !== pb) $('lpPlayBtn').innerHTML = pb;
    });
  }, 500);

  // 启动歌词进度同步定时器
  if (_lyricsSyncId) clearInterval(_lyricsSyncId);
  _lyricsSyncId = setInterval(() => {
    _playerP.then(({ autoTimer, timerPaused, elapsed }) => {
      if (!autoTimer) { panel.classList.remove('playing'); return; }
      panel.classList.toggle('playing', !timerPaused);
      if (!timerPaused && lyricsLines.length) {
        syncLyrics(elapsed);
      }
    });
  }, 1000);
}

export function closeLyricsPanel() {
  // 清除定时器
  if (_lyricsUISyncId) { clearInterval(_lyricsUISyncId); _lyricsUISyncId = null; }
  if (_lyricsSyncId) { clearInterval(_lyricsSyncId); _lyricsSyncId = null; }
  // 重置滚动状态
  _userScrolling = false;
  if (_scrollIdleTimer) { clearTimeout(_scrollIdleTimer); _scrollIdleTimer = null; }
  _ignoreScrollUntil = 0;
  const panel = $('lyricsPanel');
  // 关闭时同步更新 origin，让动画缩回当前封面位置
  const cover = $('npCover');
  if (cover) {
    const r = cover.getBoundingClientRect();
    const cx = ((r.left + r.width / 2) / window.innerWidth * 100).toFixed(1) + '%';
    const cy = ((r.top + r.height / 2) / window.innerHeight * 100).toFixed(1) + '%';
    panel.style.setProperty('--lp-origin-x', cx);
    panel.style.setProperty('--lp-origin-y', cy);
  }
  stopSpectrum();
  panel.classList.remove('show');
  document.body.style.overflow = '';
}

// ---- 频谱可视化 ----
// 解析主题色 --accent 为 [r,g,b]（带缓存，避免每帧重复解析）
function _getAccentRgb() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  if (raw === _accentCache.key) return _accentCache.rgb;
  let rgb = [42, 183, 88];
  if (raw.startsWith('#')) {
    let h = raw.slice(1);
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    if (h.length >= 6) {
      rgb = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
  } else {
    const m = raw.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
    if (m) rgb = [+m[1], +m[2], +m[3]];
  }
  _accentCache = { key: raw, rgb };
  return rgb;
}

// 圆角矩形路径（radii 为 [tl,tr,br,bl]），降级为直角
function _rr(ctx, x, y, w, h, radii) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, radii);
  else ctx.rect(x, y, w, h);
}

// 对数频率映射 + dB 归一化 + 平滑衰减
const _specLogFreqs = new Float32Array(128); // 预计算的对数 bin 索引表
function _precomputeLogBins(barCount) {
  const nyquist = _spectrumAnalyser.context.sampleRate / 2;
  const minHz = 40, maxHz = Math.min(nyquist, 16000);
  const logMin = Math.log(minHz), logRange = Math.log(maxHz / minHz);
  for (let i = 0; i < barCount; i++) {
    const hz = minHz * Math.exp(logRange * (i / (barCount - 1)));
    _specLogFreqs[i] = (hz / nyquist) * _spectrumBufferLength;
  }
}
function _computeBars(barCount) {
  if (!_spectrumBars || _spectrumBars.length !== barCount) { 
    _spectrumBars = new Float32Array(barCount);
    _precomputeLogBins(barCount);
  }
  for (let i = 0; i < barCount; i++) {
    const idx = Math.min(Math.floor(_specLogFreqs[i]), _spectrumBufferLength - 1);
    // 取相邻 3 bins 平均，减少高频抖动
    const v = (_spectrumData[idx] + _spectrumData[Math.min(idx+1, _spectrumBufferLength-1)] + _spectrumData[Math.max(idx-1, 0)]) / (3 * 255);
    // dB 归一化：把线性值转为感知均匀的 0-1
    const target = v < 0.001 ? 0 : Math.min(1, (Math.log10(v + 0.0001) + 4) / 4);
    const cur = _spectrumBars[i];
    _spectrumBars[i] = target > cur ? cur + (target - cur) * 0.5 : cur + (target - cur) * 0.12;
  }
  return _spectrumBars;
}

// A. 渐变镜像：圆角柱 + 垂直渐变 + 底部倒影
function _renderGradient(ctx, W, H, bars, n, r, g, b) {
  const gap = 2, bw = W / n;
  const baseY = H * 0.70;
  const maxH = baseY * 0.95;
  const reflMax = H - baseY;
  const dR = Math.round(r * 0.5), dG = Math.round(g * 0.5), dB = Math.round(b * 0.5);
  for (let i = 0; i < n; i++) {
    const v = bars[i];
    const bh = Math.max(v * maxH, 1);
    const x = i * bw + gap / 2, w = bw - gap, rad = Math.min(w / 2, 3);
    const grad = ctx.createLinearGradient(0, baseY - bh, 0, baseY);
    grad.addColorStop(0, `rgba(${r},${g},${b},1)`);
    grad.addColorStop(1, `rgba(${dR},${dG},${dB},0.85)`);
    ctx.fillStyle = grad;
    _rr(ctx, x, baseY - bh, w, bh, [rad, rad, 0, 0]); ctx.fill();
    const rh = Math.min(bh * 0.6, reflMax);
    const rgrad = ctx.createLinearGradient(0, baseY, 0, baseY + rh);
    rgrad.addColorStop(0, `rgba(${r},${g},${b},0.28)`);
    rgrad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = rgrad;
    _rr(ctx, x, baseY, w, rh, [0, 0, rad, rad]); ctx.fill();
  }
}

// B. 霓虹辉光：柱体外发光 + 顶部高亮线
function _renderGlow(ctx, W, H, bars, n, r, g, b) {
  const gap = 2, bw = W / n;
  const hiR = Math.min(r + 80, 255), hiG = Math.min(g + 80, 255), hiB = Math.min(b + 80, 255);
  for (let i = 0; i < n; i++) {
    const v = bars[i];
    const bh = Math.max(v * H * 0.92, 1);
    const x = i * bw + gap / 2, w = bw - gap, rad = Math.min(w / 2, 2.5);
    const y = H - bh;
    ctx.shadowColor = `rgba(${r},${g},${b},0.9)`;
    ctx.shadowBlur = 10 + v * 10;
    const grad = ctx.createLinearGradient(0, y, 0, H);
    grad.addColorStop(0, `rgba(${hiR},${hiG},${hiB},1)`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0.7)`);
    ctx.fillStyle = grad;
    _rr(ctx, x, y, w, bh, [rad, rad, rad, rad]); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = `rgba(255,255,255,${0.35 + v * 0.4})`;
    _rr(ctx, x, y, w, Math.min(2, bh), [rad, rad, 0, 0]); ctx.fill();
  }
  ctx.shadowBlur = 0;
}

// C. 波形填充：平滑曲线连接柱顶 + 渐变填充下方区域
function _renderWave(ctx, W, H, bars, n, r, g, b) {
  const step = W / (n - 1);
  const pts = [];
  for (let i = 0; i < n; i++) pts.push({ x: i * step, y: H - Math.max(bars[i] * H * 0.9, 1) });
  const trace = () => {
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 0; i < n - 1; i++) {
      const xc = (pts[i].x + pts[i + 1].x) / 2, yc = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, xc, yc);
    }
    ctx.lineTo(pts[n - 1].x, pts[n - 1].y);
  };
  // 填充区域
  ctx.beginPath();
  ctx.moveTo(0, H);
  ctx.lineTo(pts[0].x, pts[0].y);
  for (let i = 0; i < n - 1; i++) {
    const xc = (pts[i].x + pts[i + 1].x) / 2, yc = (pts[i].y + pts[i + 1].y) / 2;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, xc, yc);
  }
  ctx.lineTo(pts[n - 1].x, pts[n - 1].y);
  ctx.lineTo(W, H);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, `rgba(${r},${g},${b},0.55)`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0.02)`);
  ctx.fillStyle = grad; ctx.fill();
  // 顶部描边（带辉光）
  ctx.beginPath(); trace();
  ctx.strokeStyle = `rgba(${r},${g},${b},0.95)`;
  ctx.lineWidth = 2; ctx.lineJoin = 'round';
  ctx.shadowColor = `rgba(${r},${g},${b},0.6)`; ctx.shadowBlur = 8;
  ctx.stroke(); ctx.shadowBlur = 0;
}

function _drawSpectrum() {
  if (!_spectrumEnabled) { _spectrumRafId = null; return; }
  _spectrumRafId = requestAnimationFrame(_drawSpectrum);

  const canvas = $('lpSpectrum');
  if (!canvas || !_spectrumAnalyser || !_spectrumData) return;

  _spectrumAnalyser.getByteFrequencyData(_spectrumData);
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const barCount = 64;
  const bars = _computeBars(barCount);
  const [r, g, b] = _getAccentRgb();

  if (_spectrumStyle === 'glow') _renderGlow(ctx, W, H, bars, barCount, r, g, b);
  else if (_spectrumStyle === 'wave') _renderWave(ctx, W, H, bars, barCount, r, g, b);
  else _renderGradient(ctx, W, H, bars, barCount, r, g, b);
}

function startSpectrum() {
  if (window.innerWidth < 720) return;
  if (localStorage.getItem('wemusic_spectrum') !== '1') return;
  _spectrumEnabled = true;
  _spectrumStyle = localStorage.getItem('wemusic_spectrum_style') || 'gradient';
  const canvas = $('lpSpectrum');
  if (canvas) canvas.classList.add('on');

  _playerP.then(({ getAnalyserNode }) => {
    _spectrumAnalyser = getAnalyserNode();
    if (_spectrumAnalyser) {
      _spectrumBufferLength = _spectrumAnalyser.frequencyBinCount;
      _spectrumData = new Uint8Array(_spectrumBufferLength);
    }
    if (!_spectrumRafId) _spectrumRafId = requestAnimationFrame(_drawSpectrum);
  });
}

function stopSpectrum() {
  _spectrumEnabled = false;
  if (_spectrumRafId) { cancelAnimationFrame(_spectrumRafId); _spectrumRafId = null; }
  const canvas = $('lpSpectrum');
  if (canvas) canvas.classList.remove('on');
}

export async function loadLyrics(song) {
  const key = `${song.name}__${song.singer || ''}`;
  if (lyricsFor === key && lyricsLines.length) return;

  // 检查是否有缓存的 sourceId
  const cache = getSourceCache();
  const cachedSourceId = song.song_mid && cache[song.song_mid];
  await doLoadLyrics(song, cachedSourceId || undefined);
}

async function doLoadLyrics(song, forceSourceId) {
  const key = `${song.name}__${song.singer || ''}`;
  const seq = ++_lyricsSeq; // 捕获当前序列号，防止陈旧响应覆盖后续请求的数据
  // 新歌加载时重置 debug 数据，防止旧歌的数据泄漏到新歌的 Debug 面板
  lyricsDebug = null;
  $('lpBody').innerHTML = '<div class="lp-loading">加载歌词中…</div>';

  // 离线优先：若本地缓存命中且已有歌词整包，直接复用，不发网络请求
  // 但用户显式切换歌词源（forceSourceId）且离线缓存的源与之不一致时，
  // 必须落到网络请求以尊重用户选择，否则切换歌词源会无效。
  if (song.bvid) {
    try {
      const cached = await offline.get(song.bvid);
      if (seq !== _lyricsSeq) return false; // 已被更新的请求取代，丢弃
      if (cached && cached.lyrics) {
        const offlineSourceId = cached.lyrics.sourceId || null;
        const sameSource = !forceSourceId || String(offlineSourceId) === String(forceSourceId);
        if (sameSource) {
          lyricsLines = cached.lyrics.lines || [];
          lyricsFor = key;
          lyricsCandidates = cached.lyrics.candidates || [];
          lyricsCurrentSourceId = offlineSourceId || forceSourceId || null;
          renderLyricsLines();
          return true;
        }
      }
    } catch { /* 离线读取失败则回退到网络 */ }
  }

  try {
    const params = `name=${encodeURIComponent(song.name)}&singer=${encodeURIComponent(song.singer || '')}${forceSourceId ? `&sourceId=${forceSourceId}` : ''}`;
    const data = await api(`/stats/lyrics?${params}`);
    if (seq !== _lyricsSeq) return false; // 已被更新的请求取代，丢弃

    // 纯音乐检测：歌名命中关键词，跳过歌词搜索
    if (data.instrumental) {
      lyricsLines = [];
      lyricsFor = key;
      lyricsCandidates = [];
      lyricsCurrentSourceId = null;
      _userScrolling = false;
      if (_scrollIdleTimer) { clearTimeout(_scrollIdleTimer); _scrollIdleTimer = null; }
      $('lpBody').innerHTML = '<div class="lp-placeholder lp-instrumental">纯音乐，暂无歌词</div>';
      return true;
    }

    lyricsLines = data.lines || [];
    lyricsFor = key;
    // 换源快速通道（带 sourceId 请求）响应里不含 candidates 字段，
    // 此时必须保留已有候选列表，否则会被清空导致下次打开弹窗重新拉取，
    // 重新拉取时不带 sourceId 会走"自动选最优源"逻辑，把用户刚选的源覆盖回默认值。
    if (data.candidates) lyricsCandidates = data.candidates;
    lyricsCurrentSourceId = data.sourceId || forceSourceId || null;
    // 存储 debug 数据（仅在非换源请求时有 debug 数据；换源快速通道不返回 debug）
    if (data._debug) lyricsDebug = data._debug;

    if (!lyricsLines.length && lyricsCandidates.length && data.error) {
      $('lpBody').innerHTML = `<div class="lp-placeholder">${esc(data.error)}<br><span style="font-size:12px;color:var(--text-dim)">点「⤢ 歌词」选择其他版本</span></div>`;
      throw new Error(data.error); // 通知调用方失败
    } else {
      renderLyricsLines();
    }
    return true;
  } catch (e) {
    if (seq !== _lyricsSeq) return false; // 已被取代，静默丢弃
    $('lpBody').innerHTML = `<div class="lp-error">${esc(e.message)}</div>`;
    lyricsLines = []; lyricsFor = ''; lyricsCandidates = []; lyricsCurrentSourceId = null;
    throw e; // 重新抛出，让调用方感知失败
  }
}

function renderLyricsLines() {
  // 新歌词加载时重置滚动状态，恢复自动跟随
  _userScrolling = false;
  if (_scrollIdleTimer) { clearTimeout(_scrollIdleTimer); _scrollIdleTimer = null; }
  if (!lyricsLines.length) {
    $('lpBody').innerHTML = '<div class="lp-placeholder">暂无歌词</div>';
    return;
  }
  $('lpBody').innerHTML = lyricsLines.map((l, i) => {
    const trans = l.transText ? `<span class="lp-trans">${esc(l.transText)}</span>` : '';
    return `<div class="lp-line" data-i="${i}">${esc(l.text)}${trans}</div>`;
  }).join('');
}

// ---- 歌词 Debug 渲染 ----
function renderLyricsDebug(el, d) {
  if (!d) { el.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-dim)">暂无 debug 数据。打开歌词页播放一首歌曲后将自动获得最近一次歌词搜索的 debug 信息。</div>'; return; }

  const badge = (v, cls) => `<span class="debug-badge ${cls}">${esc(String(v))}</span>`;
  const kv = (k, v, mono) => `<div class="debug-kv"><span class="dk">${esc(k)}</span><span class="dv${mono ? ' mono' : ''}">${esc(String(v))}</span></div>`;
  const kvHtml = (k, v) => `<div class="debug-kv"><span class="dk">${esc(k)}</span><span class="dv">${v}</span></div>`;
  const section = (title, body, open) => `
    <div class="debug-section${open ? ' open' : ''}">
      <div class="debug-section-header"><span class="debug-arrow">▶</span>${esc(title)}</div>
      <div class="debug-section-body">${body}</div>
    </div>`;

  const sections = [];

  // 1. 输入参数
  sections.push(section('输入参数', `
    ${kv('歌名', d.input.name)}
    ${kv('歌手', d.input.singer || '(无)')}
    ${kv('singerFirst', d.input.singerFirst || '(空)')}
    ${kv('nameClean', d.input.nameClean || '(同歌名)')}
    ${kv('bracketCN', d.input.bracketCN || '(无)')}
  `, true));

  // 2. 搜索 Query
  if (d.queries && d.queries.length) {
    const qList = d.queries.map(q => `<div class="debug-query-row"><span class="q-text">${esc(q)}</span></div>`).join('');
    sections.push(section(`搜索 Query（${d.queries.length} 组）`, qList));
  }

  // 3. 网易云搜索结果
  if (d.ne) {
    let neBody = '';
    neBody += kvHtml('状态', d.ne.status === 'ok' ? badge('成功', 'ok') : badge('失败', 'fail'));
    if (d.ne.queryResults && d.ne.queryResults.length) {
      const qrList = d.ne.queryResults.map(qr =>
        `<div class="debug-query-row">
          <span class="q-text">${esc(qr.query)}</span>
          ${qr.status === 'ok' ? badge(qr.count + ' 条', 'info') : badge('失败', 'fail')}
        </div>`
      ).join('');
      neBody += kvHtml('每组 Query 返回', '<div style="display:flex;flex-direction:column;gap:2px">' + qrList + '</div>');
    }
    neBody += kv('去重后候选', d.ne.totalDeduped);
    if (d.ne.samples && d.ne.samples.length) {
      const sampList = d.ne.samples.map((s, i) =>
        `<div class="debug-query-row" style="opacity:.8">
          <span class="q-text"><span style="color:var(--text-dim)">#${i + 1}</span> ${esc(s.name)} — ${esc(s.artist)} </span>
          ${badge('基础分 ' + s.quality, 'info')} ${s.crowdBonus > 0 ? badge('+'+s.crowdBonus, 'ok') : ''}
        </div>`
      ).join('');
      neBody += kvHtml(`评分样本（前 ${d.ne.samples.length} 条）`, '<div style="display:flex;flex-direction:column;gap:2px">' + sampList + '</div>');
    }
    sections.push(section('网易云音乐', neBody, true));
  }

  // 4. QQ 音乐搜索结果
  if (d.qq && d.qq.status === 'ok') {
    let qqBody = '';
    qqBody += kv('状态', '成功');
    qqBody += kv('原始候选', d.qq.totalRaw);
    qqBody += kvHtml('quality ≥ 4 过滤后', badge(d.qq.filteredByQuality, d.qq.filteredByQuality > 0 ? 'ok' : 'warn'));
    if (d.qq.samples && d.qq.samples.length) {
      const qqSampList = d.qq.samples.map((s, i) =>
        `<div class="debug-query-row">
          <span class="q-text"><span style="color:var(--text-dim)">#${i + 1}</span> ${esc(s.name)} — ${esc(s.artist)}</span>
          ${badge('分 ' + s.quality, 'info')}
        </div>`
      ).join('');
      qqBody += kvHtml(`样本（前 ${d.qq.samples.length} 条）`, '<div style="display:flex;flex-direction:column;gap:2px">' + qqSampList + '</div>');
    }
    sections.push(section('QQ 音乐', qqBody));
  }

  // 5. 原始候选（合并去重、评分排序后，分层过滤前）
  if (d.rawCandidates && d.rawCandidates.length) {
    const rawList = d.rawCandidates.map((c, i) => {
      const srcLabel = c.source === 'qq' ? 'QQ' : 'NE';
      const srcCls = c.source === 'qq' ? '' : 'info';
      return `<div class="debug-query-row">
        <span class="q-text"><span style="color:var(--text-dim)">#${i + 1}</span> ${esc(c.name)} — ${esc(c.artist)}</span>
        ${badge(srcLabel, srcCls)} ${badge('分 ' + c.quality, c.quality >= 5 ? 'ok' : (c.quality >= 4 ? 'info' : 'warn'))}
      </div>`;
    }).join('');
    sections.push(section(`原始候选（${d.rawCandidates.length} 条，评分排序后）`, rawList));
  }

  // 6. 分层过滤
  if (d.tiers) {
    const t = d.tiers;
    const tierTotal = (t.tier1_ge2 || 0) + (t.supplement_ge1 || 0) + (t.fallback_lt1 || 0);
    let tierBody = '';
    tierBody += kvHtml('候选总数', badge(t.total, 'info'));
    tierBody += kvHtml('Tier 1（quality ≥ 2）', badge(t.tier1_ge2, t.tier1_ge2 > 0 ? 'ok' : 'warn'));
    if (t.supplement_ge1 > 0) tierBody += kvHtml('Tier 2 补充（quality ≥ 1）', badge(t.supplement_ge1, 'info'));
    if (t.fallback_lt1 > 0) tierBody += kvHtml('Tier 3 兜底（quality < 1）', badge(t.fallback_lt1, 'warn'));
    tierBody += kvHtml('进入验证', badge(tierTotal, 'info'));
    sections.push(section('分层过滤', tierBody));
  }

  // 7. 验证结果
  if (d.verify) {
    const v = d.verify;
    let verifyBody = '';
    verifyBody += kv('验证总数', v.total);
    verifyBody += kvHtml('有效（有歌词）', badge(v.valid, v.valid > 0 ? 'ok' : 'warn'));
    verifyBody += kvHtml('空歌词', badge(v.empty, v.empty > 0 ? 'warn' : 'ok'));
    verifyBody += kvHtml('拉取失败', badge(v.failed, v.failed > 0 ? 'fail' : 'ok'));
    sections.push(section('歌词验证', verifyBody));
  }

  // 8. 最终输出
  sections.push(section('最终输出', kvHtml('候选数', badge(d.finalCount != null ? d.finalCount : '-', d.finalCount > 0 ? 'ok' : 'fail')), true));

  el.innerHTML = sections.join('');

  // 折叠/展开
  el.querySelectorAll('.debug-section-header').forEach(hdr => {
    hdr.onclick = () => hdr.parentElement.classList.toggle('open');
  });
}

// ---- 歌词换源弹层 ----
async function openLyricsSwitchModal(song) {
  // 如果还没有候选列表或没有 debug 数据，重新拉取
  if (!lyricsCandidates.length || !lyricsDebug) {
    try {
      const data = await api(`/stats/lyrics?name=${encodeURIComponent(song.name)}&singer=${encodeURIComponent(song.singer || '')}`);
      lyricsCandidates = data.candidates || [];
      if (data.sourceId) lyricsCurrentSourceId = String(data.sourceId);
      if (data._debug) lyricsDebug = data._debug;
    } catch { toast('获取候选列表失败'); return; }
  }

  if (!lyricsCandidates.length) { toast('暂无其他歌词版本'); return; }

  const modal = $('candModal');
  const list = $('candList');
  const debugPanel = $('candDebug');

  // 歌词模式：显示 tabs
  const tabsEl = modal.querySelector('.cand-tabs');
  if (tabsEl) tabsEl.style.display = 'flex';
  // 更新 tab 标签为歌词相关
  const tabs = tabsEl?.querySelectorAll('.cand-tab');
  if (tabs && tabs.length >= 2) {
    tabs[0].textContent = '选择歌词版本';
    tabs[1].textContent = 'Debug';
  }
  // 默认展示候选列表
  modal.querySelectorAll('.cand-panel').forEach(p => p.classList.remove('active'));
  list.classList.add('active');

  // 设置 tab 点击事件
  const setActiveTab = (tab) => {
    modal.querySelectorAll('.cand-tab').forEach(t => t.classList.remove('active'));
    modal.querySelector(`.cand-tab[data-tab="${tab}"]`)?.classList.add('active');
    modal.querySelectorAll('.cand-panel').forEach(p => p.classList.remove('active'));
    if (tab === 'candidates') list.classList.add('active');
    else if (tab === 'debug') debugPanel.classList.add('active');
  };
  tabsEl?.querySelectorAll('.cand-tab').forEach(tab => {
    tab.onclick = () => setActiveTab(tab.dataset.tab);
  });

  const songKey = `${song.name}__${song.singer || ''}`;

  // 拉取已屏蔽的歌词源
  const blockedList = await fetchBlockedList(api, songKey, 'lyrics', { name: song.name, singer: song.singer });

  list.innerHTML = lyricsCandidates.map((c, i) => {
    const isCurrent = String(c.id) === String(lyricsCurrentSourceId);
    const isQQ = c.source === LyricsSource.QQ;
    const platformLabel = isQQ ? 'QQ音乐' : '网易云';
    return `<div class="cand-row ${isCurrent ? 'current' : ''}" data-id="${esc(String(c.id))}" data-i="${i}">
      <span class="cand-rank">${i + 1}</span>
      <div class="ct">
        <div class="title">
          ${esc(c.name)}
          <span class="cand-source-tag${isQQ ? ' qq' : ''}">${esc(platformLabel)}</span>
        </div>
        <div class="meta">歌手：${esc(c.artist || '未知')} ${isCurrent ? '（当前）' : ''}</div>
      </div>
      <span class="tag ${isCurrent ? 'current' : ''}">${isCurrent ? '当前' : '选择'}</span>
      <button class="cand-block-btn" title="屏蔽此歌词源，以后不再出现"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>`;
  }).join('') + blockedSectionHtml(blockedList, 'candLyrics');

  modal.classList.add('show');

  // 渲染 debug 面板
  renderLyricsDebug(debugPanel, lyricsDebug);

  // 关闭时恢复标题和 tab 文字
  const restoreModal = () => {
    const tabs = modal.querySelectorAll('.cand-tab');
    if (tabs.length >= 2) {
      tabs[0].textContent = '选择播放资源';
      tabs[1].textContent = 'Debug';
    }
  };

  // 辅助函数：按 data-id 从 candidates 数组查找候选（替代不稳定数组下标）
  const findById = (id) => lyricsCandidates.find(c => String(c.id) === String(id));

  list.querySelectorAll('.cand-row').forEach((row) => {
    row.onclick = async () => {
      const c = findById(row.dataset.id);
      if (!c) return;
      modal.classList.remove('show');
      restoreModal();
      try {
        await doLoadLyrics(song, c.id);
        if (song.song_mid) saveSourceCache(song.song_mid, c.id);
        toast(`已切换到：${c.name}`);
      } catch {
        toast('该歌词源暂无内容，请换一个试试');
      }
    };
    row.querySelector('.cand-block-btn')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const targetId = row.dataset.id;
      const c = findById(targetId);
      if (!c) return;
      try {
        const sourceLabel = c.source === LyricsSource.QQ ? 'QQ音乐' : '网易云';
        await api('/stats/blocked', { method: 'POST', body: {
          song: songKey, type: 'lyrics', sourceId: String(c.id),
          name: c.name, artist: c.artist, sourceLabel,
        } });
        saveBlockedMeta(c.id, { name: c.name, artist: c.artist, source: c.source });
        lyricsCandidates = lyricsCandidates.filter(c => String(c.id) !== String(targetId));
        if (song.song_mid && String(lyricsCurrentSourceId) === String(c.id)) {
          const cache = getSourceCache();
          delete cache[song.song_mid];
          localStorage.setItem('wemusic_lyrics_src', JSON.stringify(cache));
          lyricsCurrentSourceId = null;
        }
        row.remove();
        const oldBlocked = list.querySelector('.cand-blocked-section');
        if (oldBlocked) oldBlocked.remove();
        const newBlocked = await fetchBlockedList(api, songKey, 'lyrics', { name: song.name, singer: song.singer });
        list.insertAdjacentHTML('beforeend', blockedSectionHtml(newBlocked, 'candLyrics'));
        bindBlockedSection(list, api, songKey, 'lyrics', 'candLyrics');
        toast('已屏蔽，刷新后不再出现');
      } catch (err) { toast('屏蔽失败：' + err.message); }
    });
  });

  // 点叉关闭时恢复
  const origClose = $('candClose').onclick;
  $('candClose').onclick = () => { restoreModal(); modal.classList.remove('show'); $('candClose').onclick = origClose; };

  // 已屏蔽列表事件
  bindBlockedSection(list, api, songKey, 'lyrics', 'candLyrics');
}

export function syncLyrics(sec) {
  if (!lyricsLines.length) return;
  let idx = 0;
  for (let i = 0; i < lyricsLines.length; i++) {
    if (lyricsLines[i].time <= sec) idx = i;
    else break;
  }
  const lines = $('lpBody').querySelectorAll('.lp-line');
  lines.forEach((el, i) => el.classList.toggle('active', i === idx));
  if (lines[idx] && $('lyricsPanel').classList.contains('show')) {
    // 用户主动滚动时跳过自动滚动，允许自由浏览
    if (_userScrolling) return;
    const body = $('lpBody');
    const lineTop = lines[idx].offsetTop;
    // 标记程序触发的滚动，让 scroll 事件处理器忽略此次滚动
    _ignoreScrollUntil = Date.now() + 600;
    body.scrollTo({ top: lineTop - body.clientHeight / 2 + lines[idx].clientHeight / 2, behavior: 'smooth' });
  }
}

// ---- 用户滚动检测与自动跟随恢复 ----

/**
 * lpBody 的 scroll 事件处理器。
 * 过滤程序触发的滚动（syncLyrics 的 scrollTo），
 * 检测到用户主动滚动时暂停自动跟随，并启动闲置倒计时。
 */
function _onLyricsScroll() {
  // 忽略程序触发的滚动（syncLyrics 设置了 _ignoreScrollUntil）
  if (Date.now() < _ignoreScrollUntil) return;

  _userScrolling = true;

  // 重置闲置倒计时：每次滚动都重新计时
  if (_scrollIdleTimer) clearTimeout(_scrollIdleTimer);
  _scrollIdleTimer = setTimeout(_resumeAutoScroll, SCROLL_IDLE_MS);
}

/**
 * 闲置倒计时到期后，平滑恢复自动跟随到当前播放位置。
 */
function _resumeAutoScroll() {
  _userScrolling = false;
  _scrollIdleTimer = null;
  // 立即滚动回当前播放行
  _playerP.then(({ elapsed, autoTimer, timerPaused }) => {
    if (!autoTimer || timerPaused) return;
    if (!lyricsLines.length) return;
    syncLyrics(elapsed);
  });
}

export function initLyrics() {
  $('npCover').style.cursor = 'pointer';
  $('npCover').onclick = openLyricsPanel;
  $('lpClose').onclick = closeLyricsPanel;

  // 背景面板关闭方式（静态绑定）
  $('lpBgCardClose').onclick = () => { $('lpBgOverlay').style.display = 'none'; };
  $('lpBgOverlay').onclick = (e) => { if (e.target === e.currentTarget) $('lpBgOverlay').style.display = 'none'; };
  $('lpPrevBtn').onclick = () => _playerP.then(({ playPrev }) => playPrev());
  $('lpNextBtn').onclick = () => _playerP.then(({ playNext }) => playNext(false));
  $('lpPlayBtn').onclick = async () => {
    const { togglePause } = await _playerP;
    const result = togglePause();
    if (result === 'noSong') return toast('请选择一首歌曲播放');
    if (result === 'mounted') return;
    // togglePause 已更新 playPauseBtn，这里同步更新歌词页按钮
    $('lpPlayBtn').innerHTML = $('playPauseBtn').innerHTML;
    toast(result ? '已暂停自动连播' : '继续自动连播');
  };
  _playerP.then(({ bindSeekBar }) => bindSeekBar($('lpSeekBar'), $('lpCurTime')));

  // 歌词滚动监听：检测用户主动滚动以暂停/恢复自动跟随
  $('lpBody').addEventListener('scroll', _onLyricsScroll, { passive: true });

  // 点击歌词行跳转播放进度（事件委托）
  $('lpBody').addEventListener('click', (e) => {
    const line = e.target.closest('.lp-line');
    if (!line) return;
    const i = Number(line.dataset.i);
    if (!lyricsLines[i] || lyricsLines[i].time < 0) return;
    const sec = Math.round(lyricsLines[i].time);
    // 重置滚动状态：用户点击是明确的导航意图，恢复自动跟随
    _userScrolling = false;
    if (_scrollIdleTimer) { clearTimeout(_scrollIdleTimer); _scrollIdleTimer = null; }
    _playerP.then(({ seekTo }) => seekTo(sec));
  });

  // 频谱可视化开关监听：用户在设置中切换时，如果面板已打开则即时生效
  window.addEventListener('spectrum_changed', () => {
    if ($('lyricsPanel').classList.contains('show')) {
      stopSpectrum();
      startSpectrum();
    }
  });
}
