// 我收藏的歌曲（星标，独立于「我喜欢的」）
import { $, esc, toast, songColHeader } from './utils.js';
import { api } from './api.js';
import { state } from './state.js';
import { renderSongList, listToolsHtml, bindListTools, setActiveNav } from './playlist-ui.js';
export async function openFavoritesPage() {
  state.view = 'favorites';
  setActiveNav('navFavorites');
  import('./main.js').then(({ navPush }) => navPush('favorites'));
  const main = $('main');
  main.innerHTML = '<div class="loading">加载中…</div>';
  try {
    const { favorites } = await api('/stats/favorites');
    if (!favorites.length) {
      main.innerHTML = '<div class="view-title">我收藏的</div><div class="empty">还没有收藏的歌曲</div>';
      return;
    }
    const songs = favorites.map((l) => ({ ...l, id: null }));
    renderFavoritesView(main, songs);
  } catch (e) { main.innerHTML = `<div class="empty">加载失败：${esc(e.message)}</div>`; }
}

function renderFavoritesView(main, songs, mode = 'list') {
  if (mode === 'singer') {
    // 按歌手分组
    const groups = {};
    for (const s of songs) {
      const key = s.singer || '未知歌手';
      if (!groups[key]) groups[key] = [];
      groups[key].push(s);
    }
    // 按歌曲数量排序
    const sorted = Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
    const renderSingerGroups = (filter = '') => {
      const filtered = filter ? sorted.filter(([singer]) => singer.toLowerCase().includes(filter.toLowerCase())) : sorted;
      if (filtered.length === 0 && filter) {
        document.getElementById('favsSingerList').innerHTML = '<div class="empty">没有匹配的歌手</div>';
        return;
      }
      const html = filtered.map(([singer, ss]) => `
        <div class="likes-singer-group" data-singer-name="${esc(singer).toLowerCase()}">
          <div class="likes-singer-head">
            <span class="likes-singer-name">${esc(singer)}</span>
            <span class="likes-singer-cnt">${ss.length} 首</span>
            <button class="btn sm green likes-singer-play" data-singer="${esc(singer)}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg> 播放</button>
          </div>
          <div class="song-list"></div>
        </div>
      `).join('');
      document.getElementById('favsSingerList').innerHTML = html;
      filtered.forEach(([singer, ss]) => {
        const group = document.querySelector(`.likes-singer-group[data-singer-name="${esc(singer).toLowerCase()}"]`);
        if (group) renderSongList(group.querySelector('.song-list'), ss, { showAdd: true });
      });
      // 播放按钮
      document.querySelectorAll('.likes-singer-play').forEach((btn) => {
        btn.onclick = () => {
          const s = btn.dataset.singer;
          const sss = songs.filter((x) => x.singer === s);
          import('./player.js').then(({ playFromList }) => playFromList(sss, 0, 'favorites', null));
        };
      });
    };

    main.innerHTML = `<div class="view-title">我收藏的（${songs.length} 首）
      <span class="likes-toggle">
        <button class="likes-tab active" data-tab="singer">按歌手</button>
        <button class="likes-tab" data-tab="list">列表</button>
      </span></div>
      <input class="likes-filter" id="favsFilter" placeholder="筛选歌手…" />
      <div id="favsSingerList"></div>`;
    renderSingerGroups();
    $('favsFilter').addEventListener('input', (e) => renderSingerGroups(e.target.value));
    bindFavsToggle(main, songs);
  } else {
    main.innerHTML = `<div class="view-title">我收藏的（${songs.length} 首）
      <span class="likes-toggle">
        <button class="likes-tab" data-tab="singer">按歌手</button>
        <button class="likes-tab active" data-tab="list">列表</button>
      </span></div>${listToolsHtml()}${songColHeader}<div class="song-list" id="favsList"></div>`;
    const container = $('favsList');
    renderSongList(container, songs, { showAdd: true });
    bindListTools(main, songs, container, null, null);
    bindFavsToggle(main, songs);
  }
}

function bindFavsToggle(main, songs) {
  main.querySelectorAll('.likes-tab').forEach((btn) => {
    btn.onclick = () => { renderFavoritesView(main, songs, btn.dataset.tab); };
  });
}
