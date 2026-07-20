// ---------------- 桌面歌词（PiP 迷你窗口） ----------------
import { $, esc, toast, PLAY_ICON, PAUSE_ICON, albumCover } from './utils.js';
import { state } from './state.js';
import { lyricsLines, loadLyrics } from './lyrics.js';

const _playerP = import('./player.js');

// Lucide SVG 图标
const SKIP_BACK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5"/></svg>';
const SKIP_FWD  = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg>';
const GEAR_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06-.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
const PIANO_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
const CLOSE_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

// 模块状态
let pipWindow = null;
let _pipSyncId = null;
let _isOpen = false;
let _currentMode = 'lyrics';     // 'lyrics' | 'cover'
let _currentLayout = 'double';
let _currentBg = 'system';
let _currentSize = 'med';
let _settingsVisible = false;
let _coverLoaded = false;

// ---- PiP 窗口 CSS ----
const PIP_CSS = `
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;overflow:hidden;font-size:14px;background:#000}
.dt-root{
  width:100%;height:100vh;display:flex;flex-direction:column;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;
  user-select:none;-webkit-user-select:none;position:relative;overflow:hidden;
  border-radius:10px;color:#fff;
}
.dt-root.dt-light{color:#1a1c20}
.dt-root.dt-light .dt-current{text-shadow:0 1px 6px rgba(0,0,0,0.06)}

/* ====== 封面图层 ====== */
.dt-cover{
  position:absolute;inset:-10px;overflow:hidden;z-index:0;
}
.dt-cover-img{
  position:absolute;inset:0;
  width:100%;height:100%;object-fit:cover;
  filter:blur(36px) brightness(0.32);
  transition:filter .6s ease;
}
/* 封面淡入 */
.dt-cover-img.ready{filter:blur(36px) brightness(0.32);opacity:1}
.dt-cover-img:not(.ready){opacity:0;transition:opacity .5s ease}
.dt-cover-img.ready.full{opacity:1}
/* 浅色模式：封面更亮 */
.dt-root.dt-light .dt-cover-img{filter:blur(30px) brightness(0.65)}
/* 无封面时隐藏 */
.dt-cover.nocover{display:none}

/* 暗色渐变蒙层：底部和顶部加深，文字可读 */
.dt-overlay{
  position:absolute;inset:0;z-index:1;
  background:linear-gradient(180deg,
    rgba(0,0,0,0.35) 0%,rgba(0,0,0,0.15) 30%,rgba(0,0,0,0.05) 55%,
    rgba(0,0,0,0.35) 85%,rgba(0,0,0,0.55) 100%);
}
.dt-root.dt-light .dt-overlay{
  background:linear-gradient(180deg,
    rgba(0,0,0,0.08) 0%,rgba(0,0,0,0.02) 40%,rgba(0,0,0,0.02) 60%,
    rgba(0,0,0,0.12) 85%,rgba(0,0,0,0.22) 100%);
}
/* 无封面时补一个纯色底 */
.dt-fallback{
  position:absolute;inset:0;z-index:0;display:none;
  background:linear-gradient(160deg,#1a1c22 0%,#101216 50%,#0a0c10 100%);
}
.dt-cover.nocover ~ .dt-fallback{display:block}
.dt-root.dt-light .dt-fallback{
  background:linear-gradient(160deg,#f6f7f9 0%,#eef0f4 100%);
}

/* ====== 歌词区 ====== */
.dt-body{
  position:relative;z-index:2;flex:1;display:flex;flex-direction:column;
  justify-content:center;align-items:center;padding:20px 24px 8px;min-height:0;
}
.dt-line{
  text-align:center;white-space:nowrap;text-overflow:ellipsis;max-width:100%;
  overflow:hidden;line-height:1.55;transition:opacity .25s ease;
}
/* 当前行 */
.dt-current{
  font-size:22px;font-weight:800;letter-spacing:.8px;
  text-shadow:0 2px 16px rgba(0,0,0,0.4),0 0 4px rgba(0,0,0,0.2);
  margin:6px 0;
}
/* 前/后行 */
.dt-prev,.dt-next{
  font-size:14px;opacity:.38;letter-spacing:.2px;font-weight:400;
}
.dt-prev{margin-bottom:2px}
.dt-next{margin-top:2px}

/* 字号 */
.dt-root[data-size="sm"] .dt-current{font-size:18px}
.dt-root[data-size="sm"] .dt-prev,.dt-root[data-size="sm"] .dt-next{font-size:12px}
.dt-root[data-size="lg"] .dt-current{font-size:26px;letter-spacing:1px}
.dt-root[data-size="lg"] .dt-prev,.dt-root[data-size="lg"] .dt-next{font-size:16px}

/* 单行：只显示当前行 */
.dt-root[data-layout="single"] .dt-prev,.dt-root[data-layout="single"] .dt-next{display:none}

/* 无歌词 / 纯音乐 */
.dt-placeholder{
  font-size:13px;opacity:.45;display:flex;align-items:center;gap:6px;
  letter-spacing:.2px;font-weight:400;
}
.dt-placeholder svg{flex-shrink:0;opacity:.55;}

/* ====== 控制栏 ====== */
.dt-bar{
  position:relative;z-index:2;
  display:flex;justify-content:center;align-items:center;gap:22px;
  padding:6px 22px 14px;flex-shrink:0;
}
.dt-cbtn{
  background:none;border:none;cursor:pointer;padding:6px;border-radius:50%;
  display:flex;align-items:center;justify-content:center;color:inherit;
  opacity:.5;transition:all .15s ease;
}
.dt-cbtn:hover{opacity:.9;background:rgba(255,255,255,0.1);transform:scale(1.08)}
.dt-cbtn:active{transform:scale(0.92)}
.dt-cbtn.paused{opacity:.25}

/* ====== 设置齿轮（右上角）====== */
.dt-set-btn{
  position:absolute;top:8px;right:10px;z-index:50;
  background:rgba(0,0,0,0.3);border:none;cursor:pointer;padding:5px;
  border-radius:6px;display:flex;align-items:center;justify-content:center;
  color:rgba(255,255,255,0.6);transition:all .15s;
  backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);
}
.dt-set-btn:hover{color:#fff;background:rgba(0,0,0,0.5)}
/* ====== 设置面板（全窗口覆盖）====== */
.dt-set-pop{
  position:fixed;inset:0;display:none;
  background:rgba(10,10,16,0.95);border-radius:10px;
  padding:32px 16px 14px;z-index:40;overflow-y:auto;color:#e0e2e8;
  border:1px solid rgba(255,255,255,0.06);
}
.dt-root.dt-light .dt-set-pop{
  background:rgba(255,255,255,0.97);border-color:rgba(0,0,0,0.07);color:#1a1c20;
}
.dt-set-pop.show{display:block;animation:dtpopIn .14s ease-out}
@keyframes dtpopIn{from{opacity:0}to{opacity:1}}
.dt-set-close{
  position:absolute;top:7px;right:10px;z-index:51;
  background:rgba(255,255,255,0.08);border:none;cursor:pointer;
  padding:4px;border-radius:5px;display:flex;align-items:center;justify-content:center;
  color:inherit;opacity:.6;transition:opacity .12s;
}
.dt-set-close:hover{opacity:1;background:rgba(255,255,255,0.15)}
.dt-srow{
  display:flex;align-items:center;justify-content:space-between;gap:10px;
  margin-bottom:11px;
}
.dt-srow:last-child{margin-bottom:0}
.dt-slabel{
  font-size:11px;opacity:.5;margin:0;flex-shrink:0;
  letter-spacing:.5px;font-weight:600;white-space:nowrap;
}
.dtops{display:flex;gap:6px;flex-shrink:0}
.dtopt{
  font-size:11px;padding:6px 10px;border-radius:6px;cursor:pointer;
  border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.05);
  color:inherit;text-align:center;white-space:nowrap;font-weight:500;
  transition:all .12s ease;
}
.dt-root.dt-light .dtopt{
  border-color:rgba(0,0,0,0.08);background:rgba(0,0,0,0.03);
}
.dtopt:hover{background:rgba(255,255,255,0.12);border-color:rgba(255,255,255,0.15)}
.dt-root.dt-light .dtopt:hover{background:rgba(0,0,0,0.07)}
.dtopt.on{border-color:#2ab758;background:rgba(42,183,88,0.18);color:#2ab758;font-weight:600}

/* ====== 封面模式（清晰封面 + 歌名/歌手）====== */
/* 封面去模糊，原图展示 */
.dt-root[data-mode="cover"] .dt-cover-img{filter:none;opacity:1}
/* 蒙层改为底部渐变：上半透明看封面，底部深保证文字可读 */
.dt-root[data-mode="cover"] .dt-overlay{
  background:linear-gradient(180deg,
    rgba(0,0,0,0) 0%,rgba(0,0,0,0) 45%,
    rgba(0,0,0,0.3) 70%,rgba(0,0,0,0.65) 100%);
}
/* 浅色 mode 下的封面蒙层 */
.dt-root[data-mode="cover"].dt-light .dt-overlay{
  background:linear-gradient(180deg,
    rgba(0,0,0,0) 0%,rgba(0,0,0,0) 45%,
    rgba(0,0,0,0.06) 70%,rgba(0,0,0,0.2) 100%);
}
/* 隐藏歌词，显示歌名/歌手 */
.dt-root[data-mode="cover"] .dt-body{display:none}
.dt-root[data-mode="cover"] .dt-song-info{display:flex}
/* 歌名/歌手叠加层 */
.dt-song-info{
  display:none;position:absolute;bottom:52px;left:0;right:0;z-index:2;
  flex-direction:column;align-items:center;gap:1px;padding:0 20px;
}
.dt-si-name{
  font-size:19px;font-weight:700;color:#fff;
  text-shadow:0 1px 8px rgba(0,0,0,0.5);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;
}
.dt-root.dt-light .dt-si-name{color:#1a1c20;text-shadow:0 1px 8px rgba(0,0,0,0.08)}
.dt-si-singer{
  font-size:13px;opacity:.6;color:#fff;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;
}
.dt-root.dt-light .dt-si-singer{color:#1a1c20;opacity:.45}

@media all and (display-mode:picture-in-picture){body{margin:0}}
`;

// ---- 偏好 ----
function loadPrefs() {
  try {
    _currentMode = localStorage.getItem('wemusic_desktop_lyrics_mode') || 'lyrics';
    _currentLayout = localStorage.getItem('wemusic_desktop_lyrics_layout') || 'double';
    _currentBg = localStorage.getItem('wemusic_desktop_lyrics_bg') || 'system';
    _currentSize = localStorage.getItem('wemusic_desktop_lyrics_size') || 'med';
  } catch {}
}
function savePrefs() {
  try {
    localStorage.setItem('wemusic_desktop_lyrics_mode', _currentMode);
    localStorage.setItem('wemusic_desktop_lyrics_layout', _currentLayout);
    localStorage.setItem('wemusic_desktop_lyrics_bg', _currentBg);
    localStorage.setItem('wemusic_desktop_lyrics_size', _currentSize);
  } catch {}
}

// ---- 公开 API ----
export function isOpen() { return _isOpen; }

export async function openDesktopLyrics() {
  if (_isOpen) { try { pipWindow?.focus?.(); } catch {} return; }
  loadPrefs();
  if (state.current && !lyricsLines.length) {
    try { await loadLyrics(state.current); } catch {}
  }
  if ('documentPictureInPicture' in window) {
    try {
      pipWindow = await documentPictureInPicture.requestWindow({ width: 400, height: 300 });
      pipWindow.document.head.innerHTML = `<style>${PIP_CSS}</style>`;
      pipWindow.document.body.innerHTML = buildHTML(state.current);
      pipWindow.document.documentElement.classList.add('ready');
      pipWindow.addEventListener('pagehide', () => { cleanup(); });
      bindEvents(pipWindow.document);
      loadCover(pipWindow.document, state.current);
      _isOpen = true;
      startSync();
      updateBtnState();
    } catch (e) {
      console.warn('PiP 打开失败，降级 popup:', e.message);
      openPopup();
    }
  } else {
    openPopup();
  }
}

export function closeDesktopLyrics() { cleanup(); }

// ---- 构建 HTML ----
function buildHTML(song) {
  let lightClass = '';
  if (_currentBg === 'light') lightClass = ' dt-light';
  else if (_currentBg === 'system') {
    lightClass = window.matchMedia('(prefers-color-scheme: dark)').matches ? '' : ' dt-light';
  }
  const hasLyrics = lyricsLines.length > 0;
  const instrumental = !hasLyrics && song;

  const bodyHTML = hasLyrics
    ? `<div class="dt-line dt-prev" id="dtPrev"></div><div class="dt-line dt-current" id="dtCurrent"></div><div class="dt-line dt-next" id="dtNext"></div>`
    : instrumental
      ? `<div class="dt-placeholder">${PIANO_ICON} 纯音乐，暂无歌词</div>`
      : `<div class="dt-placeholder">${PIANO_ICON} 加载中…</div>`;

  const name = esc(song?.name || '');
  const singer = esc(song?.singer || '');

  return `
<div class="dt-root" data-mode="${_currentMode}" data-layout="${_currentLayout}" data-bg="${_currentBg}${lightClass}" data-size="${_currentSize}">
  <div class="dt-cover" id="dtCover"><img class="dt-cover-img" id="dtCoverImg" alt="" /></div>
  <div class="dt-fallback"></div>
  <div class="dt-overlay"></div>
  <div class="dt-song-info" id="dtSongInfo">
    <div class="dt-si-name" id="dtSiName">${name}</div>
    <div class="dt-si-singer" id="dtSiSinger">${singer}</div>
  </div>
  <button class="dt-set-btn" id="dtGearBtn" title="设置">${GEAR_ICON}</button>
  <div class="dt-set-pop" id="dtPop">
    <button class="dt-set-close" id="dtSetClose" title="关闭">${CLOSE_ICON}</button>
    ${settingsHTML()}
  </div>
  <div class="dt-body" id="dtBody">${bodyHTML}</div>
  <div class="dt-bar">
    <button class="dt-cbtn" id="dtPrevBtn" title="上一首">${SKIP_BACK}</button>
    <button class="dt-cbtn" id="dtPlayBtn" title="播放/暂停">${PLAY_ICON}</button>
    <button class="dt-cbtn" id="dtNextBtn" title="下一首">${SKIP_FWD}</button>
  </div>
</div>`;
}

function settingsHTML() {
  const mopts = [['lyrics','歌词'],['cover','封面']].map(([v,l]) =>
    `<button class="dtopt${v===_currentMode?' on':''}" data-s="mode" data-v="${v}">${l}</button>`
  ).join('');
  const lopts = [['double','双行'],['single','单行']].map(([v,l]) =>
    `<button class="dtopt${v===_currentLayout?' on':''}" data-s="layout" data-v="${v}">${l}</button>`
  ).join('');
  const bopts = [['light','浅色'],['dark','深色'],['system','跟随系统']].map(([v,l]) =>
    `<button class="dtopt${v===_currentBg?' on':''}" data-s="bg" data-v="${v}">${l}</button>`
  ).join('');
  const sopts = [['sm','小'],['med','中'],['lg','大']].map(([v,l]) =>
    `<button class="dtopt${v===_currentSize?' on':''}" data-s="size" data-v="${v}">${l}</button>`
  ).join('');
  return `<div class="dt-srow"><span class="dt-slabel">模式</span><div class="dtops">${mopts}</div></div><div class="dt-srow"><span class="dt-slabel">布局</span><div class="dtops">${lopts}</div></div><div class="dt-srow"><span class="dt-slabel">背景</span><div class="dtops">${bopts}</div></div><div class="dt-srow"><span class="dt-slabel">字号</span><div class="dtops">${sopts}</div></div>`;
}

// ---- 封面加载 ----
function loadCover(doc, song) {
  _coverLoaded = false;
  if (!song?.album_mid) {
    doc.getElementById('dtCover')?.classList.add('nocover');
    return;
  }
  const url = albumCover(song.album_mid, 500);
  if (!url) { doc.getElementById('dtCover')?.classList.add('nocover'); return; }
  doc.getElementById('dtCover')?.classList.remove('nocover');
  const img = doc.getElementById('dtCoverImg');
  if (!img) return;
  // 重置状态
  img.classList.remove('ready', 'full');
  let done = false;
  // 3 秒超时，回退到 fallback 底
  const timer = setTimeout(() => {
    if (!done) { done = true; doc.getElementById('dtCover')?.classList.add('nocover'); }
  }, 3000);
  img.onload = () => {
    if (done) return;
    done = true; clearTimeout(timer);
    _coverLoaded = true;
    // 用 requestAnimationFrame 确保浏览器渲染了图片后再触发过渡
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        img.classList.add('ready');
        requestAnimationFrame(() => { img.classList.add('full'); });
      });
    });
  };
  img.onerror = () => {
    if (done) return;
    done = true; clearTimeout(timer);
    doc.getElementById('dtCover')?.classList.add('nocover');
  };
  img.src = url;
}

// ---- 绑定事件 ----
function bindEvents(doc) {
  // 齿轮 & 关闭按钮 toggle 设置面板
  doc.getElementById('dtGearBtn')?.addEventListener('click', e => {
    e.stopPropagation();
    toggleSettings(doc);
  });
  doc.getElementById('dtSetClose')?.addEventListener('click', e => {
    e.stopPropagation();
    toggleSettings(doc);
  });

  // 点击面板外关闭
  doc.addEventListener('click', e => {
    if (_settingsVisible && !e.target.closest('.dt-set-btn') && !e.target.closest('.dt-set-pop')) {
      _settingsVisible = false;
      doc.getElementById('dtPop')?.classList.remove('show');
    }
  });

  // 设置选项
  doc.querySelectorAll('.dtopt').forEach(btn => {
    btn.addEventListener('click', () => {
      const s = btn.dataset.s, v = btn.dataset.v;
      const root = doc.querySelector('.dt-root');
      if (s === 'mode') {
        _currentMode = v; root.dataset.mode = v;
        // 切换到封面模式时立即更新歌名/歌手
        if (v === 'cover') updateSongInfo(doc);
      }
      else if (s === 'layout') { _currentLayout = v; root.dataset.layout = v; }
      else if (s === 'bg') {
        _currentBg = v; root.dataset.bg = v;
        if (v === 'light') root.classList.add('dt-light');
        else if (v === 'dark') root.classList.remove('dt-light');
        else if (v === 'system') {
          const prefersDark = doc.defaultView.matchMedia('(prefers-color-scheme: dark)').matches;
          root.classList.toggle('dt-light', !prefersDark);
        }
      }
      else if (s === 'size') { _currentSize = v; root.dataset.size = v; }
      savePrefs();
      refreshOpts(doc);
    });
  });

  // 播放控制
  doc.getElementById('dtPrevBtn')?.addEventListener('click', () => _playerP.then(({ playPrev }) => playPrev()));
  doc.getElementById('dtNextBtn')?.addEventListener('click', () => _playerP.then(({ playNext }) => playNext(false)));
  doc.getElementById('dtPlayBtn')?.addEventListener('click', async () => {
    const { togglePause } = await _playerP;
    const r = togglePause();
    if (r === 'noSong' || r === 'mounted') return;
    const pb = doc.getElementById('dtPlayBtn');
    if (pb) { pb.innerHTML = r ? PLAY_ICON : PAUSE_ICON; pb.classList.toggle('paused', !!r); }
  });
}

function toggleSettings(doc) {
  _settingsVisible = !_settingsVisible;
  doc.getElementById('dtPop')?.classList.toggle('show', _settingsVisible);
}

function refreshOpts(doc) {
  doc.querySelectorAll('.dtopt[data-s="mode"]').forEach(b => b.classList.toggle('on', b.dataset.v === _currentMode));
  doc.querySelectorAll('.dtopt[data-s="layout"]').forEach(b => b.classList.toggle('on', b.dataset.v === _currentLayout));
  doc.querySelectorAll('.dtopt[data-s="bg"]').forEach(b => b.classList.toggle('on', b.dataset.v === _currentBg));
  doc.querySelectorAll('.dtopt[data-s="size"]').forEach(b => b.classList.toggle('on', b.dataset.v === _currentSize));
}

// 更新封面模式的歌名/歌手显示
function updateSongInfo(doc) {
  const nameEl = doc.getElementById('dtSiName');
  const singerEl = doc.getElementById('dtSiSinger');
  if (nameEl) nameEl.textContent = state.current?.name || '未知歌曲';
  if (singerEl) singerEl.textContent = state.current?.singer || '未知歌手';
}

// ---- 同步循环 ----
let _lastHasLyrics = null, _lastCoverMid = null;
function startSync() {
  if (_pipSyncId) clearInterval(_pipSyncId);
  _lastHasLyrics = null; _lastCoverMid = null;
  _pipSyncId = setInterval(() => {
    if (!pipWindow || pipWindow.closed) { cleanup(); return; }
    _playerP.then(({ elapsed, timerPaused, autoTimer }) => {
      if (!pipWindow || pipWindow.closed || !autoTimer) return;
      const doc = pipWindow.document; if (!doc) return;
      const body = doc.getElementById('dtBody'); if (!body) return;

      // 切歌：封面变化 → 重新加载 + 更新歌名/歌手
      const curMid = state.current?.album_mid;
      if (_lastCoverMid !== null && _lastCoverMid !== curMid) {
        loadCover(doc, state.current);
        updateSongInfo(doc);
      }
      _lastCoverMid = curMid || null;

      // 歌词行数变化 → 重建 body
      const hasLrc = lyricsLines.length > 0;
      if (_lastHasLyrics !== null && _lastHasLyrics !== hasLrc) rebuildBody(doc, hasLrc);
      _lastHasLyrics = hasLrc;

      if (!hasLrc) {
        const ph = body.querySelector('.dt-placeholder');
        // 仅在当前歌曲的歌词请求已返回且结果为空时，才显示"纯音乐"
        // 避免将尚未返回的网络请求误判为纯音乐
        if (ph && ph.textContent.includes('加载中')) {
          const songKey = state.current ? `${state.current.name}__${state.current.singer || ''}` : '';
          if (lyricsFor && lyricsFor === songKey) {
            ph.textContent = `${PIANO_ICON} 纯音乐，暂无歌词`.replace(/<\/?[^>]+>/g, '');
          }
        }
        return;
      }

      let idx = 0;
      for (let i = 0; i < lyricsLines.length; i++) { if (lyricsLines[i].time <= elapsed) idx = i; else break; }

      const prev = doc.getElementById('dtPrev'),
        cur = doc.getElementById('dtCurrent'),
        nxt = doc.getElementById('dtNext'),
        pbtn = doc.getElementById('dtPlayBtn');
      if (_currentLayout === 'single') {
        if (prev) prev.textContent = '';
        if (nxt) nxt.textContent = '';
        if (cur) cur.textContent = lyricsLines[idx]?.text || '';
      } else {
        if (prev) prev.textContent = idx > 0 ? lyricsLines[idx - 1]?.text || '' : '';
        if (cur) cur.textContent = lyricsLines[idx]?.text || '';
        if (nxt) nxt.textContent = lyricsLines[idx + 1]?.text || '';
      }
      if (pbtn) { pbtn.innerHTML = timerPaused ? PLAY_ICON : PAUSE_ICON; pbtn.classList.toggle('paused', timerPaused); }
    });
  }, 500);
}

function rebuildBody(doc, hasLrc) {
  const body = doc.getElementById('dtBody'); if (!body) return;
  if (hasLrc) {
    body.innerHTML = '<div class="dt-line dt-prev" id="dtPrev"></div><div class="dt-line dt-current" id="dtCurrent"></div><div class="dt-line dt-next" id="dtNext"></div>';
  } else {
    body.innerHTML = `<div class="dt-placeholder">${PIANO_ICON} ${state.current ? '纯音乐，暂无歌词' : '加载中…'}</div>`;
  }
}

function stopSync() { if (_pipSyncId) { clearInterval(_pipSyncId); _pipSyncId = null; } }

// ---- popup 降级 ----
function openPopup() {
  const w = 400, h = 300;
  const left = Math.max(0, window.screenX + window.outerWidth - w - 40);
  const top = Math.max(0, window.screenY + window.outerHeight - h - 80);
  const pop = window.open('', 'wemusic_dl',
    `width=${w},height=${h},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=no`);
  if (!pop) { toast('请允许弹出窗口以使用桌面歌词'); return; }
  pop.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>${PIP_CSS}</style></head><body>${buildHTML(state.current)}</body></html>`);
  pop.document.close();
  pipWindow = pop;
  loadCover(pop.document, state.current);
  bindEvents(pop.document);
  pop.addEventListener('beforeunload', () => { cleanup(); });
  _isOpen = true;
  startSync();
  updateBtnState();
}

// ---- 清理 ----
function cleanup() {
  stopSync();
  _coverLoaded = false;
  _lastCoverMid = null;
  try { pipWindow?.close?.(); } catch {}
  pipWindow = null;
  _isOpen = false;
  updateBtnState();
}

function updateBtnState() {
  const btn = $('dtLyricsBtn');
  if (btn) { btn.classList.toggle('active', _isOpen); btn.title = _isOpen ? '关闭桌面歌词' : '打开桌面歌词'; }
}
