// WeMusic 主应用入口
import { Auth, api } from './api.js';
import { state } from './state.js';
import { loadPlaylists, setActiveNav, initPlaylistUI } from './playlist-ui.js';
import { initPlayer, restoreSession, renderMode } from './player.js';
import { initQueue } from './queue.js';
import { initSearch } from './search.js';
import { initLyrics } from './lyrics.js';
import { initUI } from './ui.js';
import { initSettings, loadAvatar } from './settings.js';
import { initStats, openDiscover } from './stats.js';

// 登录拦截
if (!Auth.token) location.href = '/login.html';

// 初始化全部模块
initSettings();
initPlayer();
initQueue();
initSearch();
initLyrics();
initUI();
initPlaylistUI();
initStats();

// 键盘快捷键
document.addEventListener('keydown', (e) => {
  const tag = (e.target.tagName || '').toLowerCase();
  const typing = tag === 'input' || tag === 'textarea' || e.target.isContentEditable;
  if (e.key === 'Escape') {
    // 关闭所有浮层
    const lyricsPanel = document.getElementById('lyricsPanel');
    if (lyricsPanel?.classList.contains('show')) {
      import('./lyrics.js').then(({ closeLyricsPanel }) => closeLyricsPanel());
      return;
    }
    ['candModal', 'addModal', 'promptModal', 'helpModal', 'settingsModal', 'importModal'].forEach((id) => {
      const el = document.getElementById(id);
      if (el?.classList.contains('show')) el.classList.remove('show');
    });
    const ctxMenu = document.getElementById('ctxMenu');
    if (ctxMenu) ctxMenu.classList.remove('show');
    const suggest = document.getElementById('searchSuggest');
    if (suggest?.classList.contains('show')) suggest.classList.remove('show');
    const queueDrawer = document.getElementById('queueDrawer');
    if (queueDrawer?.classList.contains('show')) queueDrawer.classList.remove('show');
    return;
  }
  if (e.key === '/' && !typing) { e.preventDefault(); document.getElementById('searchInput').focus(); return; }
  if (e.key === '?' && !typing) { e.preventDefault(); document.getElementById('helpModal').classList.toggle('show'); return; }
  if (typing) return;
  if (e.code === 'Space') {
    if (!state.current) return;
    e.preventDefault();
    document.getElementById('playPauseBtn').click();
  } else if (e.key === 'ArrowRight') {
    if (state.current) { e.preventDefault(); import('./player.js').then(({ playNext }) => playNext(false)); }
  } else if (e.key === 'ArrowLeft') {
    if (state.current) { e.preventDefault(); import('./player.js').then(({ playPrev }) => playPrev()); }
  }
});

// 应用初始化
async function init() {
  await loadPlaylists();
  openDiscover();
  restoreSession();
  loadLikes().catch(() => {});
  loadAvatar().catch(() => {});
}

async function loadLikes() {
  const { likes } = await api('/stats/likes');
  state.likedMids = new Set(likes.map((l) => l.song_mid).filter(Boolean));
}

init().catch((e) => console.error(e));
