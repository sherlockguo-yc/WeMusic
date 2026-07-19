// ---------------- 桌面歌词（PiP 迷你窗口） ----------------
import { $, esc, toast, PLAY_ICON, PAUSE_ICON } from './utils.js';
import { state } from './state.js';
import { lyricsLines, loadLyrics } from './lyrics.js';

const _playerP = import('./player.js');

// Lucide SVG 图标（仅供本模块使用）
const SKIP_BACK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5"/></svg>';
const SKIP_FWD  = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg>';
const GEAR_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06-.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
const PIANO_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';

// ---- 模块状态 ----
let pipWindow = null;
let _pipSyncId = null;
let _isOpen = false;
let _currentLayout = 'double';   // 'double' | 'single'
let _currentBg = 'blur';         // 'blur' | 'dark' | 'theme'
let _currentSize = 'med';        // 'sm' | 'med' | 'lg'
let _settingsVisible = false;

// ---- PiP 窗口内部 CSS ----
const PIP_CSS = `
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;overflow:hidden;font-size:14px}
.dt-root{
  width:100%;height:100vh;display:flex;flex-direction:column;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;
  user-select:none;-webkit-user-select:none;position:relative;overflow:hidden;
  border-radius:10px;
}

/* ====== 背景风格 ====== */
/* 毛玻璃：半透明深色底 + backdrop-filter（不支持时优雅降级为纯色） */
.dt-root[data-bg="blur"]{
  background:rgba(18,18,28,0.72);
  backdrop-filter:blur(28px) saturate(1.6);-webkit-backdrop-filter:blur(28px) saturate(1.6);
  color:#f0f0f5;
  box-shadow:inset 0 0 0 0.5px rgba(255,255,255,0.08);
}
/* 暗色：深邃渐变，有层次感 */
.dt-root[data-bg="dark"]{
  background:linear-gradient(145deg,#1a1c22 0%,#101216 50%,#0a0b0e 100%);
  color:#e8eaef;
  box-shadow:inset 0 0 0 0.5px rgba(255,255,255,0.05);
}
/* 跟随主题 - 浅色 */
.dt-root[data-bg="theme"].dt-light{
  background:linear-gradient(145deg,#fafbfd 0%,#f0f2f5 100%);
  color:#1a1c20;
  box-shadow:inset 0 0 0 0.5px rgba(0,0,0,0.06);
}
/* 跟随主题 - 深色 */
.dt-root[data-bg="theme"]:not(.dt-light){
  background:linear-gradient(145deg,#181a1f 0%,#0e0f12 100%);
  color:#e8eaef;
  box-shadow:inset 0 0 0 0.5px rgba(255,255,255,0.04);
}

/* ====== 歌词区域 ====== */
.dt-body{
  flex:1;display:flex;flex-direction:column;justify-content:center;align-items:center;
  padding:12px 22px 4px;min-height:0;position:relative;
}
.dt-line{
  text-align:center;white-space:nowrap;text-overflow:ellipsis;max-width:100%;
  overflow:hidden;line-height:1.5;transition:opacity .2s ease;
}
.dt-current{
  font-size:17px;font-weight:700;letter-spacing:.6px;
  text-shadow:0 1px 12px rgba(0,0,0,0.25);
}
.dt-next{
  font-size:12px;opacity:.32;margin-top:2px;letter-spacing:.15px;font-weight:400;
}
/* 单行模式：隐藏下一行 */
.dt-root[data-layout="single"] .dt-next{display:none}

/* ====== 字号（data-size 控制）====== */
/* 小 */
.dt-root[data-size="sm"] .dt-current{font-size:14px}
.dt-root[data-size="sm"] .dt-next{font-size:10px}
/* 中（默认） */
.dt-root[data-size="med"] .dt-current{font-size:17px}
.dt-root[data-size="med"] .dt-next{font-size:12px}
/* 大 */
.dt-root[data-size="lg"] .dt-current{font-size:20px;letter-spacing:.8px}
.dt-root[data-size="lg"] .dt-next{font-size:14px}
.dt-placeholder{
  font-size:11.5px;opacity:.4;display:flex;align-items:center;gap:5px;
  font-weight:400;letter-spacing:.2px;
}
.dt-placeholder svg{flex-shrink:0;opacity:.5;}

/* ====== 分隔线 ====== */
.dt-sep{
  flex-shrink:0;height:1px;margin:0 18px;
  background:linear-gradient(90deg,transparent 0%,rgba(255,255,255,0.07) 30%,rgba(255,255,255,0.07) 70%,transparent 100%);
}
.dt-root[data-bg="theme"].dt-light .dt-sep{
  background:linear-gradient(90deg,transparent 0%,rgba(0,0,0,0.06) 30%,rgba(0,0,0,0.06) 70%,transparent 100%);
}

/* ====== 控制栏 ====== */
.dt-bar{
  display:flex;justify-content:center;align-items:center;gap:16px;
  padding:5px 22px 10px;flex-shrink:0;
}
.dt-cbtn{
  background:none;border:none;cursor:pointer;padding:5px;border-radius:6px;
  display:flex;align-items:center;justify-content:center;color:inherit;
  opacity:.55;transition:all .15s ease;
}
.dt-cbtn:hover{opacity:1;background:rgba(255,255,255,0.09);transform:scale(1.06)}
.dt-cbtn:active{transform:scale(0.94)}
.dt-root[data-bg="theme"].dt-light .dt-cbtn:hover{background:rgba(0,0,0,0.06)}
.dt-cbtn.paused{opacity:.3}

/* ====== 设置按钮 & 面板 ====== */
.dt-set-btn{
  position:absolute;top:5px;right:7px;z-index:20;
  background:none;border:none;cursor:pointer;padding:4px;
  border-radius:5px;display:flex;align-items:center;justify-content:center;
  color:inherit;opacity:.45;transition:opacity .15s;
}
.dt-set-btn:hover{opacity:.85}
.dt-set-pop{
  position:absolute;top:28px;right:7px;display:none;
  background:rgba(20,20,26,0.96);border-radius:10px;padding:10px 12px;
  min-width:150px;z-index:30;
  border:1px solid rgba(255,255,255,0.07);
  box-shadow:0 8px 24px rgba(0,0,0,0.35),0 2px 8px rgba(0,0,0,0.2);
  color:inherit;
}
.dt-root[data-bg="theme"].dt-light .dt-set-pop{
  background:rgba(255,255,255,0.98);border-color:rgba(0,0,0,0.07);
  color:#1a1c20;
  box-shadow:0 10px 30px rgba(0,0,0,0.12),0 2px 8px rgba(0,0,0,0.06);
}
.dt-set-pop.show{display:block;animation:dtpopIn .14s ease-out}
@keyframes dtpopIn{from{opacity:0;transform:translateY(-3px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}
.dt-srow{margin-bottom:11px}
.dt-srow:last-child{margin-bottom:0}
.dt-slabel{
  font-size:9.5px;opacity:.38;display:block;margin-bottom:5px;
  text-transform:uppercase;letter-spacing:1px;font-weight:600;
}
.dtopts{display:flex;gap:5px}
.dtopt{
  flex:1;font-size:11px;padding:5px 7px;border-radius:5px;cursor:pointer;
  border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.04);
  color:inherit;text-align:center;white-space:nowrap;font-weight:500;
  transition:all .12s ease;
}
.dt-root[data-bg="theme"].dt-light .dtopt{
  border-color:rgba(0,0,0,0.08);background:rgba(0,0,0,0.03);
}
.dtopt:hover{background:rgba(255,255,255,0.1);border-color:rgba(255,255,255,0.14)}
.dt-root[data-bg="theme"].dt-light .dtopt:hover{background:rgba(0,0,0,0.07)}
.dtopt.on{border-color:#2ab758;background:rgba(42,183,88,0.16);color:#2ab758;font-weight:600}
@media all and (display-mode:picture-in-picture){body{margin:0}}
`;

// ---- 偏好存取 ----
function loadPrefs() {
  try {
    _currentLayout = localStorage.getItem('wemusic_desktop_lyrics_layout') || 'double';
    _currentBg = localStorage.getItem('wemusic_desktop_lyrics_bg') || 'blur';
    _currentSize = localStorage.getItem('wemusic_desktop_lyrics_size') || 'med';
  } catch { /* ignored */ }
}
function savePrefs() {
  try {
    localStorage.setItem('wemusic_desktop_lyrics_layout', _currentLayout);
    localStorage.setItem('wemusic_desktop_lyrics_bg', _currentBg);
    localStorage.setItem('wemusic_desktop_lyrics_size', _currentSize);
  } catch { /* ignored */ }
}

// ---- 公开 API ----
export function isOpen() { return _isOpen; }

export async function openDesktopLyrics() {
  if (_isOpen) { try { pipWindow?.focus?.(); } catch {} return; }

  loadPrefs();

  // 确保歌词已加载
  if (state.current && !lyricsLines.length) {
    try { await loadLyrics(state.current); } catch { /* 不阻塞 */ }
  }

  if ('documentPictureInPicture' in window) {
    try {
      // 固定初始尺寸，后续不再改变
      pipWindow = await documentPictureInPicture.requestWindow({ width: 340, height: 130 });
      pipWindow.document.head.innerHTML = `<style>${PIP_CSS}</style>`;
      pipWindow.document.body.innerHTML = buildHTML(state.current);

      pipWindow.addEventListener('pagehide', () => { cleanup(); });
      bindEvents(pipWindow.document);

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

export function closeDesktopLyrics() {
  cleanup();
}

// ---- 构建 HTML ----
function buildHTML(song) {
  const isLight = document.body.classList.contains('light');
  const lightClass = _currentBg === 'theme' && isLight ? ' dt-light' : '';
  const hasLyrics = lyricsLines.length > 0;
  const instrumental = !hasLyrics && song;

  const bodyHTML = hasLyrics
    ? `<div class="dt-line dt-current" id="dtCurrent"></div><div class="dt-line dt-next" id="dtNext"></div>`
    : instrumental
      ? `<div class="dt-placeholder">${PIANO_ICON} 纯音乐</div>`
      : `<div class="dt-placeholder">${PIANO_ICON} 加载中…</div>`;

  return `
<div class="dt-root" data-layout="${_currentLayout}" data-bg="${_currentBg}${lightClass}" data-size="${_currentSize}">
  <button class="dt-set-btn" id="dtGearBtn">${GEAR_ICON}</button>
  <div class="dt-set-pop" id="dtPop">${settingsHTML()}</div>
  <div class="dt-body" id="dtBody">${bodyHTML}</div>
  <div class="dt-sep"></div>
  <div class="dt-bar">
    <button class="dt-cbtn" id="dtPrevBtn" title="上一首">${SKIP_BACK}</button>
    <button class="dt-cbtn" id="dtPlayBtn" title="播放/暂停">${PLAY_ICON}</button>
    <button class="dt-cbtn" id="dtNextBtn" title="下一首">${SKIP_FWD}</button>
  </div>
</div>`;
}

function settingsHTML() {
  const lopts = [['double','双行'],['single','单行']].map(([v,l]) =>
    `<button class="dtopt${v===_currentLayout?' on':''}" data-s="layout" data-v="${v}">${l}</button>`
  ).join('');
  const bopts = [['blur','毛玻璃'],['dark','暗色'],['theme','主题']].map(([v,l]) =>
    `<button class="dtopt${v===_currentBg?' on':''}" data-s="bg" data-v="${v}">${l}</button>`
  ).join('');
  const sopts = [['sm','小'],['med','中'],['lg','大']].map(([v,l]) =>
    `<button class="dtopt${v===_currentSize?' on':''}" data-s="size" data-v="${v}">${l}</button>`
  ).join('');
  return `<div class="dt-srow"><span class="dt-slabel">布局</span><div class="dtops">${lopts}</div></div><div class="dt-srow"><span class="dt-slabel">背景</span><div class="dtops">${bopts}</div></div><div class="dt-srow"><span class="dt-slabel">字号</span><div class="dtops">${sopts}</div></div>`;
}

// ---- 绑定事件 ----
function bindEvents(doc) {
  doc.getElementById('dtGearBtn')?.addEventListener('click', e => {
    e.stopPropagation();
    const pop = doc.getElementById('dtPop');
    _settingsVisible = !_settingsVisible;
    pop.classList.toggle('show', _settingsVisible);
  });

  doc.addEventListener('click', e => {
    if (_settingsVisible && !e.target.closest('.dt-set-btn')) {
      _settingsVisible = false;
      doc.getElementById('dtPop')?.classList.remove('show');
    }
  });

  // 设置选项：仅更新 DOM 属性和 CSS class，不调用 resizeTo
  doc.querySelectorAll('.dtopt').forEach(btn => {
    btn.addEventListener('click', () => {
      const s = btn.dataset.s, v = btn.dataset.v;
      const root = doc.querySelector('.dt-root');

      if (s === 'layout') {
        _currentLayout = v;
        root.dataset.layout = v; // CSS 自动隐藏/显示 .dt-next
      } else if (s === 'bg') {
        _currentBg = v;
        root.dataset.bg = v;
        const isLight = document.body.classList.contains('light');
        root.classList.toggle('dt-light', v === 'theme' && isLight);
      } else if (s === 'size') {
        _currentSize = v;
        root.dataset.size = v; // CSS 字号自动切换
      }
      savePrefs();
      refreshOpts(doc);
    });
  });

  // 播放控制
  doc.getElementById('dtPrevBtn')?.addEventListener('click',
    () => _playerP.then(({ playPrev }) => playPrev()));
  doc.getElementById('dtNextBtn')?.addEventListener('click',
    () => _playerP.then(({ playNext }) => playNext(false)));
  doc.getElementById('dtPlayBtn')?.addEventListener('click', async () => {
    const { togglePause } = await _playerP;
    const r = togglePause();
    if (r === 'noSong' || r === 'mounted') return;
    const pb = doc.getElementById('dtPlayBtn');
    if (pb) { pb.innerHTML = r ? PLAY_ICON : PAUSE_ICON; pb.classList.toggle('paused', !!r); }
  });
}

function refreshOpts(doc) {
  doc.querySelectorAll('.dtopt[data-s="layout"]').forEach(b => b.classList.toggle('on', b.dataset.v === _currentLayout));
  doc.querySelectorAll('.dtopt[data-s="bg"]').forEach(b => b.classList.toggle('on', b.dataset.v === _currentBg));
  doc.querySelectorAll('.dtopt[data-s="size"]').forEach(b => b.classList.toggle('on', b.dataset.v === _currentSize));
}

// ---- 同步循环 ----
let _lastHasLyrics = null;
function startSync() {
  if (_pipSyncId) clearInterval(_pipSyncId);
  _lastHasLyrics = null;
  _pipSyncId = setInterval(() => {
    if (!pipWindow || pipWindow.closed) { cleanup(); return; }
    _playerP.then(({ elapsed, timerPaused, autoTimer }) => {
      if (!pipWindow || pipWindow.closed || !autoTimer) return;
      const doc = pipWindow.document; if (!doc) return;
      const body = doc.getElementById('dtBody'); if (!body) return;

      const hasLrc = lyricsLines.length > 0;
      if (_lastHasLyrics !== null && _lastHasLyrics !== hasLrc) rebuildBody(doc, hasLrc);
      _lastHasLyrics = hasLrc;

      if (!hasLrc) {
        const ph = body.querySelector('.dt-placeholder');
        if (ph && ph.textContent.includes('加载中')) ph.textContent = `${PIANO_ICON} 纯音乐`.replace(/<\/?[^>]+>/g, '');
        return;
      }

      let idx = 0;
      for (let i = 0; i < lyricsLines.length; i++) { if (lyricsLines[i].time <= elapsed) idx = i; else break; }

      const cur = doc.getElementById('dtCurrent'), nxt = doc.getElementById('dtNext'), pbtn = doc.getElementById('dtPlayBtn');
      if (cur) cur.textContent = lyricsLines[idx]?.text || '';
      if (nxt) nxt.textContent = _currentLayout === 'single' ? '' : (lyricsLines[idx+1]?.text || '');
      if (pbtn) { pbtn.innerHTML = timerPaused ? PLAY_ICON : PAUSE_ICON; pbtn.classList.toggle('paused', timerPaused); }
    });
  }, 500);
}

function rebuildBody(doc, hasLrc) {
  const body = doc.getElementById('dtBody'); if (!body) return;
  if (hasLrc) {
    body.innerHTML = '<div class="dt-line dt-current" id="dtCurrent"></div><div class="dt-line dt-next" id="dtNext"></div>';
  } else {
    body.innerHTML = `<div class="dt-placeholder">${PIANO_ICON} ${state.current ? '纯音乐' : '加载中…'}</div>`;
  }
}

function stopSync() { if (_pipSyncId) { clearInterval(_pipSyncId); _pipSyncId = null; } }

// ---- popup 降级 ----
function openPopup() {
  const w = 340, h = 130;
  const left = Math.max(0, window.screenX + window.outerWidth - w - 40);
  const top = Math.max(0, window.screenY + window.outerHeight - h - 80);
  const pop = window.open('', 'wemusic_dl',
    `width=${w},height=${h},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=no`);
  if (!pop) { toast('请允许弹出窗口以使用桌面歌词'); return; }

  pop.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>${PIP_CSS}</style></head><body>${buildHTML(state.current)}</body></html>`);
  pop.document.close();

  pipWindow = pop;
  bindEvents(pop.document);
  pop.addEventListener('beforeunload', () => { cleanup(); });

  _isOpen = true;
  startSync();
  updateBtnState();
}

// ---- 清理 ----
function cleanup() {
  stopSync();
  try { pipWindow?.close?.(); } catch {}
  pipWindow = null;
  _isOpen = false;
  updateBtnState();
}

function updateBtnState() {
  const btn = $('dtLyricsBtn');
  if (btn) { btn.classList.toggle('active', _isOpen); btn.title = _isOpen ? '关闭桌面歌词' : '打开桌面歌词'; }
}
