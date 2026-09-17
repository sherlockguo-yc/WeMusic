// 「我的」页：移动端汇总入口
// 移动端底部 Tab 只保留 4 个核心入口（发现 / 我的数据 / 我喜欢的 / 我的），
// 歌单列表与收藏、专辑、离线缓存等次要入口收纳在本页，避免 Tab Bar 过载。
import { $, esc } from './utils.js';
import { state } from './state.js';
import { setActiveNav } from './playlist-ui.js';

export function openMyPage() {
  state.view = 'my';
  setActiveNav('navMy');
  import('./main.js').then(({ navPush }) => navPush('my'));
  const main = $('main');
  main.innerHTML = `
    <div class="view-title">我的</div>
    <div class="my-section">
      <div class="my-section-hd">
        <span>我的歌单（${state.playlists.length}）</span>
        <button class="btn sm green" id="myNewPlaylist">新建歌单</button>
      </div>
      <div class="my-playlists" id="myPlaylists"></div>
    </div>
    <div class="my-section">
      <div class="my-section-hd"><span>更多</span></div>
      <div class="my-entries">
        <button class="my-entry" id="myFavEntry">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          <span>我收藏的</span>
        </button>
        <button class="my-entry" id="myAlbumsEntry">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>
          <span>我的专辑</span>
        </button>
        <button class="my-entry" id="myOfflineEntry">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"/></svg>
          <span>离线缓存</span>
        </button>
      </div>
    </div>
  `;
  renderMyPlaylists();

  $('myFavEntry').onclick = () => import('./favorites.js').then(({ openFavoritesPage }) => openFavoritesPage());
  $('myAlbumsEntry').onclick = () => import('./stats.js').then(({ openSavedAlbums }) => openSavedAlbums());
  $('myOfflineEntry').onclick = () => import('./offline-page.js').then(({ openOfflinePage }) => openOfflinePage());
  $('myNewPlaylist').onclick = () => $('newPlaylistBtn').click();
}

function renderMyPlaylists() {
  const box = $('myPlaylists');
  if (!box) return;
  if (!state.playlists.length) {
    box.innerHTML = '<div class="empty">还没有歌单，点上方「新建歌单」</div>';
    return;
  }
  box.innerHTML = state.playlists.map((p) => `
    <div class="my-pl-item" data-id="${p.id}">
      <span class="my-pl-name">${esc(p.name)}</span>
      <span class="my-pl-count">${p.count ?? 0} 首</span>
    </div>
  `).join('');
  box.querySelectorAll('.my-pl-item').forEach((el) => {
    el.onclick = () => {
      const id = Number(el.dataset.id);
      import('./playlist-ui.js').then(({ openPlaylist }) => openPlaylist(id));
    };
  });
}
