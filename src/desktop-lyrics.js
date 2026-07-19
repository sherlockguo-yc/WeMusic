// ---------------- 桌面歌词（PiP 迷你窗口） ----------------
import { $, esc, toast, PLAY_ICON, PAUSE_ICON } from './utils.js';
import { state } from './state.js';
import { lyricsLines, loadLyrics } from './lyrics.js';

const _playerP = import('./player.js');

// Lucide SVG 图标（仅供本模块使用）
const SKIP_BACK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5"/></svg>';
const SKIP_FWD  = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg>';
const GEAR_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
const PIANO_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';

// ---- 模块状态 ----
let pipWindow = null;
let _pipSyncId = null;
let _isOpen = false;
let _currentLayout = 'double';   // 'double' | 'single'
let _currentBg = 'blur';         // 'blur' | 'dark' | 'theme'
let _settingsVisible = false;
let _userWidth = 320; // 记录用户手动拖动的窗口宽度，布局切换时保留

// ---- PiP 窗口内部 CSS ----
const PIP_CSS = `
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;overflow:hidden}
.dt-lyrics{
  width:100%;height:100vh;display:flex;flex-direction:column;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;
  user-select:none;-webkit-user-select:none;position:relative;overflow:hidden;
}
/* ---- 背景风格 ---- */
.dt-lyrics[data-bg="blur"]{
  background:linear-gradient(135deg,rgba(20,20,30,0.65) 0%,rgba(10,10,18,0.75) 100%);
  backdrop-filter:blur(24px) saturate(1.4);-webkit-backdrop-filter:blur(24px) saturate(1.4);
  color:#fff;
}
.dt-lyrics[data-bg="dark"]{
  background:linear-gradient(160deg,rgba(18,18,22,0.94) 0%,rgba(8,8,12,0.98) 100%);
  color:#eaecef;
}
.dt-lyrics[data-bg="theme"].dt-light{
  background:linear-gradient(135deg,#f6f7f9 0%,#eef0f4 100%);color:#1b1d22;
}
.dt-lyrics[data-bg="theme"]:not(.dt-light){
  background:linear-gradient(160deg,#14161a 0%,#0a0c0e 100%);color:#eaecef;
}
/* ---- 歌词区域 ---- */
.dt-lyrics-body{
  flex:1;display:flex;flex-direction:column;justify-content:center;align-items:center;
  padding:10px 20px 6px;min-height:0;position:relative;
}
.dt-line{
  text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  max-width:100%;transition:all .25s ease;
}
.dt-current{
  font-size:17px;font-weight:700;line-height:1.45;
  letter-spacing:.5px;text-shadow:0 1px 8px rgba(0,0,0,0.3);
}
.dt-next{
  font-size:12px;opacity:.38;margin-top:3px;font-weight:400;
  letter-spacing:.2px;
}
.dt-placeholder{
  font-size:12px;opacity:.45;display:flex;align-items:center;gap:6px;
  font-weight:400;
}
.dt-placeholder svg{flex-shrink:0;opacity:.55;}
/* ---- 分隔线（歌词与控件之间）---- */
.dt-divider{
  height:1px;margin:0 16px;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.08),transparent);
  flex-shrink:0;
}
.dt-lyrics[data-bg="theme"].dt-light .dt-divider{
  background:linear-gradient(90deg,transparent,rgba(0,0,0,0.07),transparent);
}
/* ---- 播放控制 ---- */
.dt-controls{
  display:flex;justify-content:center;gap:18px;padding:6px 20px 10px;
}
.dt-btn{
  background:none;border:none;cursor:pointer;padding:5px;border-radius:5px;
  display:flex;align-items:center;justify-content:center;opacity:.65;
  transition:opacity .15s,background .15s,transform .12s;
}
.dt-lyrics[data-bg="blur"] .dt-btn{color:#fff}
.dt-lyrics[data-bg="dark"] .dt-btn{color:#eaecef}
.dt-lyrics[data-bg="theme"].dt-light .dt-btn{color:#1b1d22}
.dt-lyrics[data-bg="theme"]:not(.dt-light) .dt-btn{color:#eaecef}
.dt-btn:hover{opacity:1;background:rgba(255,255,255,0.1);transform:scale(1.08)}
.dt-lyrics[data-bg="theme"].dt-light .dt-btn:hover{background:rgba(0,0,0,0.06)}
.dt-btn:active{transform:scale(0.95)}
.dt-btn.paused{opacity:.35}
/* ---- 设置按钮 & 面板（向上展开）---- */
.dt-settings-wrap{position:absolute;top:4px;right:6px;z-index:20;}
.dt-settings-popover{
  position:absolute;bottom:100%;right:0;margin-bottom:4px;display:none;
  background:rgba(22,22,28,0.95);border-radius:10px;padding:12px;
  min-width:156px;z-index:30;backdrop-filter:blur(16px);
  border:1px solid rgba(255,255,255,0.09);
  box-shadow:0 8px 24px rgba(0,0,0,0.35),0 2px 8px rgba(0,0,0,0.2);
}
.dt-lyrics[data-bg="theme"].dt-light .dt-settings-popover{
  background:rgba(255,255,255,0.97);border-color:rgba(0,0,0,0.08);
  color:#1b1d22;
  box-shadow:0 8px 24px rgba(0,0,0,0.1),0 2px 8px rgba(0,0,0,0.06);
}
.dt-settings-popover.show{display:block;animation:dtPopIn .15s ease}
@keyframes dtPopIn{from{opacity:0;transform:translateY(4px) scale(.96)}to{opacity:1;transform:translateY(0) scale(1)}}
.dt-setting-row{margin-bottom:10px}
.dt-setting-row:last-child{margin-bottom:0}
.dt-setting-label{
  font-size:10px;opacity:.42;display:block;margin-bottom:5px;
  text-transform:uppercase;letter-spacing:.8px;font-weight:600;
}
.dt-setting-options{display:flex;gap:5px}
.dt-setting-opt{
  flex:1;font-size:11px;padding:5px 8px;border-radius:5px;cursor:pointer;
  border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);
  color:inherit;text-align:center;white-space:nowrap;font-weight:500;
  transition:all .12s ease;
}
.dt-lyrics[data-bg="theme"].dt-light .dt-setting-opt{
  border-color:rgba(0,0,0,0.1);background:rgba(0,0,0,0.03);
}
.dt-setting-opt:hover{background:rgba(255,255,255,0.12);border-color:rgba(255,255,255,0.18)}
.dt-lyrics[data-bg="theme"].dt-light .dt-setting-opt:hover{background:rgba(0,0,0,0.07)}
.dt-setting-opt.active{
  border-color:#2ab758;background:rgba(42,183,88,0.18);color:#2ab758;
  font-weight:600;
}
@media all and (display-mode:picture-in-picture){body{margin:0}}
`;

// ---- 偏好存取 ----
function loadPrefs() {
  try {
    _currentLayout = localStorage.getItem('wemusic_desktop_lyrics_layout') || 'double';
    _currentBg = localStorage.getItem('wemusic_desktop_lyrics_bg') || 'blur';
  } catch { /* ignored */ }
}
function savePrefs() {
  try {
    localStorage.setItem('wemusic_desktop_lyrics_layout', _currentLayout);
    localStorage.setItem('wemusic_desktop_lyrics_bg', _currentBg);
  } catch { /* ignored */ }
}

// ---- 公开 API ----
export function isOpen() { return _isOpen; }

export async function openDesktopLyrics() {
  if (_isOpen) {
    try { pipWindow?.focus?.(); } catch {}
    return;
  }

  loadPrefs();
  _userWidth = 320; // 每次打开重置为默认宽度

  // 确保歌词已加载
  if (state.current && !lyricsLines.length) {
    try { await loadLyrics(state.current); } catch { /* 加载失败不阻塞 */ }
  }

  if ('documentPictureInPicture' in window) {
    try {
      pipWindow = await documentPictureInPicture.requestWindow({
        width: 320,
        height: _currentLayout === 'single' ? 72 : 120,
      });
      pipWindow.document.head.innerHTML = `<style>${PIP_CSS}</style>`;
      pipWindow.document.body.innerHTML = buildPipHTML(state.current);

      // 窗口关闭时清理
      pipWindow.addEventListener('pagehide', () => { cleanup(); });

      // 跟踪用户手动调整的窗口宽度（布局切换时保留）
      pipWindow.addEventListener('resize', () => {
        if (pipWindow && typeof pipWindow.outerWidth === 'number') {
          _userWidth = pipWindow.outerWidth;
        }
      });

      // 绑定事件
      bindPiPEvents(pipWindow.document);

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

// ---- 构建 PiP 窗口 HTML ----
function buildPipHTML(song) {
  const isLight = document.body.classList.contains('light');
  const lightClass = _currentBg === 'theme' && isLight ? ' dt-light' : '';
  const hasLyrics = lyricsLines.length > 0;
  const instrumental = !hasLyrics && song;
  return `
<div class="dt-lyrics" data-layout="${_currentLayout}" data-bg="${_currentBg}"${lightClass}>
  <div class="dt-settings-wrap">
    <button class="dt-btn" id="dtGearBtn" title="设置">${GEAR_ICON}</button>
    <div class="dt-settings-popover" id="dtSettingsPop">
      ${buildSettingsHTML()}
    </div>
  </div>
  <div class="dt-lyrics-body" id="dtBody">
    ${hasLyrics ? `
      <div class="dt-line dt-current" id="dtCurrent"></div>
      <div class="dt-line dt-next" id="dtNext"></div>
    ` : (instrumental ? `
      <div class="dt-placeholder">${PIANO_ICON} 纯音乐，暂无歌词</div>
    ` : `
      <div class="dt-placeholder">${PIANO_ICON} 加载中…</div>
    `)}
  </div>
  <div class="dt-divider"></div>
  <div class="dt-controls">
    <button class="dt-btn" id="dtPrevBtn" title="上一首">${SKIP_BACK}</button>
    <button class="dt-btn" id="dtPlayBtn" title="播放 / 暂停">${PLAY_ICON}</button>
    <button class="dt-btn" id="dtNextBtn" title="下一首">${SKIP_FWD}</button>
  </div>
</div>`;
}

function buildSettingsHTML() {
  const layouts = [
    ['double', '双行'],
    ['single', '单行'],
  ];
  const bgs = [
    ['blur', '毛玻璃'],
    ['dark', '暗色'],
    ['theme', '主题'],
  ];
  const layoutOpts = layouts.map(([v, label]) =>
    `<button class="dt-setting-opt${v === _currentLayout ? ' active' : ''}" data-setting="layout" data-value="${v}">${label}</button>`
  ).join('');
  const bgOpts = bgs.map(([v, label]) =>
    `<button class="dt-setting-opt${v === _currentBg ? ' active' : ''}" data-setting="bg" data-value="${v}">${label}</button>`
  ).join('');
  return `
<div class="dt-setting-row">
  <span class="dt-setting-label">布局</span>
  <div class="dt-setting-options">${layoutOpts}</div>
</div>
<div class="dt-setting-row">
  <span class="dt-setting-label">背景</span>
  <div class="dt-setting-options">${bgOpts}</div>
</div>`;
}

// ---- 绑定 PiP 窗口内部事件 ----
function bindPiPEvents(doc) {
  // 齿轮 → 切换设置面板
  doc.getElementById('dtGearBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const pop = doc.getElementById('dtSettingsPop');
    _settingsVisible = !_settingsVisible;
    pop.classList.toggle('show', _settingsVisible);
  });

  // 点击其他地方关闭设置
  doc.addEventListener('click', (e) => {
    if (_settingsVisible && !e.target.closest('.dt-settings-wrap')) {
      _settingsVisible = false;
      doc.getElementById('dtSettingsPop')?.classList.remove('show');
    }
  });

  // 设置选项点击
  doc.querySelectorAll('.dt-setting-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      const setting = btn.dataset.setting;
      const value = btn.dataset.value;
      if (setting === 'layout') {
        _currentLayout = value;
        // 仅布局切换时调整窗口高度（单行/双行），保留用户已调整的宽度
        if (pipWindow && typeof pipWindow.resizeTo === 'function') {
          try {
            pipWindow.resizeTo(Math.max(200, _userWidth), value === 'single' ? 72 : 120);
          } catch { /* 部分版本不支持 resizeTo */ }
        }
      } else if (setting === 'bg') {
        _currentBg = value;
        // 背景变化不改变窗口尺寸，仅更新 light class
        const isLight = document.body.classList.contains('light');
        const root = doc.querySelector('.dt-lyrics');
        if (value === 'theme' && isLight) root.classList.add('dt-light');
        else root.classList.remove('dt-light');
      }
      savePrefs();
      refreshSettings(doc);
    });
  });

  // 播放控制按钮
  doc.getElementById('dtPrevBtn')?.addEventListener('click', () => {
    _playerP.then(({ playPrev }) => playPrev());
  });
  doc.getElementById('dtNextBtn')?.addEventListener('click', () => {
    _playerP.then(({ playNext }) => playNext(false));
  });
  doc.getElementById('dtPlayBtn')?.addEventListener('click', async () => {
    const { togglePause } = await _playerP;
    const result = togglePause();
    if (result === 'noSong') return;
    if (result === 'mounted') return;
    // 同步按钮图标
    const playBtn = doc.getElementById('dtPlayBtn');
    if (playBtn) {
      playBtn.innerHTML = result ? PLAY_ICON : PAUSE_ICON;
      playBtn.classList.toggle('paused', !!result);
    }
  });
}

// 刷新设置面板（切换选项高亮）
function refreshSettings(doc) {
  doc.querySelectorAll('.dt-setting-opt[data-setting="layout"]').forEach(b => {
    b.classList.toggle('active', b.dataset.value === _currentLayout);
  });
  doc.querySelectorAll('.dt-setting-opt[data-setting="bg"]').forEach(b => {
    b.classList.toggle('active', b.dataset.value === _currentBg);
  });
}

// ---- 同步循环 ----
let _lastHasLyrics = null; // 跟踪 lyricsLines 是否有内容，用于检测变化
function startSync() {
  if (_pipSyncId) clearInterval(_pipSyncId);
  _lastHasLyrics = null;
  _pipSyncId = setInterval(() => {
    if (!pipWindow || pipWindow.closed) { cleanup(); return; }
    _playerP.then(({ elapsed, timerPaused, autoTimer }) => {
      if (!pipWindow || pipWindow.closed) return;
      if (!autoTimer) return;

      const doc = pipWindow.document;
      if (!doc) return;

      const body = doc.getElementById('dtBody');
      if (!body) return;

      const hasLyrics = lyricsLines.length > 0;

      // 歌词状态变化时重建 body（占位 ↔ 歌词行）
      if (_lastHasLyrics !== null && _lastHasLyrics !== hasLyrics) {
        rebuildBody(doc, hasLyrics);
      }
      _lastHasLyrics = hasLyrics;

      if (!hasLyrics) {
        // 将「加载中…」替换为「暂无歌词」（loadLyrics 完成且无数据后）
        const ph = body.querySelector('.dt-placeholder');
        if (ph && ph.innerHTML.includes('加载中')) {
          ph.innerHTML = `${PIANO_ICON} 暂无歌词`;
        }
        return;
      }

      let idx = 0;
      for (let i = 0; i < lyricsLines.length; i++) {
        if (lyricsLines[i].time <= elapsed) idx = i;
        else break;
      }

      const currentEl = doc.getElementById('dtCurrent');
      const nextEl = doc.getElementById('dtNext');
      const playBtn = doc.getElementById('dtPlayBtn');

      if (currentEl) currentEl.textContent = lyricsLines[idx]?.text || '';
      if (nextEl) nextEl.textContent = _currentLayout === 'single' ? '' : (lyricsLines[idx + 1]?.text || '');

      // 同步播放/暂停按钮
      if (playBtn) {
        playBtn.innerHTML = timerPaused ? PLAY_ICON : PAUSE_ICON;
        playBtn.classList.toggle('paused', timerPaused);
      }
    });
  }, 500);
}

// 重建 dtBody：在占位文本和歌词行之间切换
function rebuildBody(doc, hasLyrics) {
  const body = doc.getElementById('dtBody');
  if (!body) return;
  if (hasLyrics) {
    body.innerHTML = `
      <div class="dt-line dt-current" id="dtCurrent"></div>
      <div class="dt-line dt-next" id="dtNext"></div>`;
  } else if (state.current) {
    body.innerHTML = `<div class="dt-placeholder">${PIANO_ICON} 暂无歌词</div>`;
  } else {
    body.innerHTML = `<div class="dt-placeholder">${PIANO_ICON} 加载中…</div>`;
  }
}

function stopSync() {
  if (_pipSyncId) { clearInterval(_pipSyncId); _pipSyncId = null; }
}

// ---- 降级方案：window.open() 弹窗 ----
function openPopup() {
  const w = 320;
  const h = _currentLayout === 'single' ? 72 : 120;
  // 放在右下角
  const left = Math.max(0, window.screenX + window.outerWidth - w - 40);
  const top = Math.max(0, window.screenY + window.outerHeight - h - 80);

  const popup = window.open('', 'wemusic_desktop_lyrics',
    `width=${w},height=${h},left=${left},top=${top},` +
    'menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=no'
  );

  if (!popup) {
    toast('请允许弹出窗口以使用桌面歌词');
    return;
  }

  const isLight = document.body.classList.contains('light');
  const lightClass = _currentBg === 'theme' && isLight ? ' dt-light' : '';

  popup.document.write(`
<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>${PIP_CSS}</style></head>
<body>${buildPipHTML(state.current)}</body></html>
  `);
  popup.document.close();

  pipWindow = popup;
  bindPiPEvents(popup.document);

  // 跟踪用户手动调整的窗口宽度
  popup.addEventListener('resize', () => {
    if (popup && typeof popup.outerWidth === 'number') {
      _userWidth = popup.outerWidth;
    }
  });

  popup.addEventListener('beforeunload', () => { cleanup(); });

  _isOpen = true;
  startSync();
  updateBtnState();

  // 弹窗失焦不关闭，只靠 beforeunload 检测
}

// ---- 清理 ----
function cleanup() {
  stopSync();
  try { pipWindow?.close?.(); } catch {}
  pipWindow = null;
  _isOpen = false;
  updateBtnState();
}

// ---- 更新底栏按钮状态 ----
function updateBtnState() {
  const btn = $('dtLyricsBtn');
  if (btn) {
    btn.classList.toggle('active', _isOpen);
    btn.title = _isOpen ? '关闭桌面歌词' : '打开桌面歌词';
  }
}
