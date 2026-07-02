// WeMusic 主应用入口
import { Auth, api } from './api.js';
import { state } from './state.js';
import { loadPlaylists, setActiveNav, initPlaylistUI } from './playlist-ui.js';
import { initPlayer, restoreSession, renderMode } from './player.js';
import { initQueue } from './queue.js';
import { initSearch } from './search.js';
import { initLyrics } from './lyrics.js';
import { initUI } from './ui.js';
import { initSettings, loadAvatar, loadPrefsFromServer } from './settings.js';
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
    ['candModal', 'addModal', 'promptModal', 'helpModal', 'settingsModal', 'importModal', 'posterModal', 'donateModal', 'feedbackModal'].forEach((id) => {
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

// ---- 全局路由历史（支持前进后退） ----
// 关键：popstate 恢复视图时，视图内部会调 navPush()。此时不能用 pushState（会擦除前进历史），
// 而应该用 replaceState 替换当前历史条目，保持前进栈完整。
let _popstateView = null; // popstate 恢复时设为对应 view，navPush 消费后置 null

export function navPush(view, data) {
  const wasPop = !!_popstateView;
  console.log('[nav] navPush:', view, 'popstateView:', _popstateView || '(null)', 'len:', history.length);
  if (_popstateView) {
    history.replaceState({ view, data }, '', location.href);
    _popstateView = null;
  } else {
    history.pushState({ view, data }, '', location.href);
  }
  // 如果是从 popstate 恢复的（wasPop），额外标记避免恢复时再次 push
  if (wasPop) {
    console.log('[nav] replaceState (popstate restore)');
  }
}

async function restoreView(view, data) {
  console.log('[nav] restoreView:', view, 'data:', JSON.stringify(data));
  _popstateView = view;
  // 保险：5 秒后如果还没被 navPush 消费，自动清除（防止 import 失败等边缘情况卡住）
  const safetyView = view;
  setTimeout(() => {
    if (_popstateView === safetyView) {
      console.warn('[nav] _popstateView stuck at', safetyView, '— auto-clear');
      _popstateView = null;
    }
  }, 5000);
  if (view === 'discover')    openDiscover();
  else if (view === 'search'  && data?.kw) { document.getElementById('searchInput').value = data.kw; import('./search.js').then(({ doSearch }) => doSearch()).catch((e) => { console.error('[nav] search restore fail:', e); _popstateView = null; }); }
  else if (view === 'artist'  && data?.mid) import('./search.js').then(({ openArtist }) => openArtist(data.mid, data.name)).catch((e) => { console.error('[nav] artist restore fail:', e); _popstateView = null; });
  else if (view === 'album'       && data?.mid) import('./search.js').then(({ openAlbum }) => openAlbum(data.mid, data.name)).catch((e) => { console.error('[nav] album restore fail:', e); _popstateView = null; });
  else if (view === 'stats')       import('./stats.js').then(({ openStats }) => openStats()).catch((e) => { console.error('[nav] stats restore fail:', e); _popstateView = null; });
  else if (view === 'savedAlbums') import('./stats.js').then(({ openSavedAlbums }) => openSavedAlbums()).catch((e) => { console.error('[nav] savedAlbums restore fail:', e); _popstateView = null; });
  else if (view === 'likes')   import('./stats.js').then(({ openLikesPage }) => openLikesPage()).catch((e) => { console.error('[nav] likes restore fail:', e); _popstateView = null; });
  else if (view === 'playlist' && data?.id) import('./playlist-ui.js').then(({ openPlaylist }) => openPlaylist(data.id)).catch((e) => { console.error('[nav] playlist restore fail:', e); _popstateView = null; });
}


// 顶栏前进后退按钮
function updateNavArrows() {
  // 后退：history.length > 1（有历史可退）
  document.getElementById('navBack').disabled = history.length <= 1;
  // 前进：始终可用，让浏览器自行判断（history.forward 无前进条目时静默无效）
  document.getElementById('navFwd').disabled = false;
}
document.getElementById('navBack').onclick = () => history.back();
document.getElementById('navFwd').onclick = () => history.forward();
// 初始状态及每次 pushState 后更新
const _origPush = history.pushState.bind(history);
history.pushState = function(state, title, url) {
  console.log('[nav] pushState:', state?.view, history.length);
  _origPush(state, title, url);
  updateNavArrows();
};
// 监控 popstate
window.addEventListener('popstate', (e) => {
  console.log('[nav] popstate:', e.state?.view, 'length:', history.length, 'current:', history.state?.view);
  if (!e.state?.view) return;
  restoreView(e.state.view, e.state.data);
  updateNavArrows();
});
// 移除旧的 popstate 监听器（上面已注册）— 但下面还有一个重复的，需要合并
updateNavArrows();

// 应用初始化
async function init() {
  // loadPlaylists 与不依赖歌单数据的操作并行执行
  const plPromise = loadPlaylists();
  restoreSession();
  // 加载头像 -> 同时设置 state.isAdmin / state.user；加载服务端偏好同步
  loadAvatar().then(() => {
    if (state.isAdmin) {
      $('navAdmin').style.display = '';
      $('navAdmin').onclick = async () => {
        const { openAdmin } = await import('./admin.js');
        openAdmin();
      };
    }
  });
  loadPrefsFromServer();
  loadLikes();
  // 等待歌单加载完成后渲染视图（openDiscover 依赖 songIndex）
  await plPromise;
  const params = new URL(location.href).searchParams;
  const v = params.get('v');
  if (v) {
    try { restoreView(v, JSON.parse(params.get('d') || '{}')); } catch { openDiscover(); }
  } else {
    openDiscover();
  }
}

async function loadLikes() {
  const { likes } = await api('/stats/likes');
  state.likedMids = new Set(likes.map((l) => l.song_mid).filter(Boolean));
  import('./ui.js').then(({ updateLikesCount, updateAlbumCount }) => { updateLikesCount(); updateAlbumCount(); });
}

init().catch((e) => console.error(e));
