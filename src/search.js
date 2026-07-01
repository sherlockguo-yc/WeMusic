// ---------------- 搜索、歌手页、专辑页 ----------------
import { $, esc, fmtDur, albumCover, toast } from './utils.js';
import { api } from './api.js';
import { state } from './state.js';
import { renderSongList, listToolsHtml, bindListTools, addSongs, songInPlaylists } from './playlist-ui.js';
import { navPush } from './main.js';

// 歌手头像 URL
const singerAvatar = (mid) => `https://y.gtimg.cn/music/photo_new/T001R300x300M000${mid}.jpg`;

// 歌曲列表列头
const songColHeader = `<div class="song-row-head">
  <span class="h-idx">#</span>
  <span class="h-name">歌名</span>
  <span class="h-singer">歌手</span>
  <span class="h-album">专辑</span>
  <span class="h-bookmark"></span>
  <span class="h-dur">时长</span>
  <span class="h-ops"></span>
</div>`;

// ---- 搜索历史 ----
function getSearchHistory() {
  try { return JSON.parse(localStorage.getItem('wemusic_search_hist') || '[]'); } catch { return []; }
}
function pushSearchHistory(kw) {
  if (!kw) return;
  let h = getSearchHistory().filter((x) => x !== kw);
  h.unshift(kw); h = h.slice(0, 12);
  localStorage.setItem('wemusic_search_hist', JSON.stringify(h));
}
function removeSearchHistory(kw) {
  localStorage.setItem('wemusic_search_hist', JSON.stringify(getSearchHistory().filter((x) => x !== kw)));
}
function clearSearchHistory() { localStorage.removeItem('wemusic_search_hist'); }

function renderSuggest() {
  _selIdx = -1; // 重置键盘导航选中
  const box = $('searchSuggest');
  const q = $('searchInput').value.trim().toLowerCase();
  const hist = getSearchHistory();
  const list = q ? hist.filter((x) => x.toLowerCase().includes(q)) : hist;
  if (list.length === 0) { box.classList.remove('show'); return; }
  box.innerHTML =
    `<div class="ss-head"><span>搜索历史</span><span class="ss-clear" id="ssClear">清空</span></div>` +
    list.map((k) => `<div class="ss-row" data-k="${esc(k)}">
      <span class="ss-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg></span><span class="ss-key">${esc(k)}</span>
      <span class="ss-del" data-del="${esc(k)}" title="删除"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></span>
    </div>`).join('');
  box.classList.add('show');
  $('ssClear').onclick = () => { clearSearchHistory(); box.classList.remove('show'); };
  box.querySelectorAll('.ss-row').forEach((row) => {
    const delEl = row.querySelector('.ss-del');
    if (delEl) delEl.onclick = (e) => { e.stopPropagation(); removeSearchHistory(row.dataset.k); renderSuggest(); };
    row.onclick = (e) => {
      if (e.target.classList.contains('ss-del')) return;
      $('searchInput').value = row.dataset.k; box.classList.remove('show'); doSearch();
    };
  });
}

// ---- 搜索 ----
export async function doSearch() {
  const keyword = $('searchInput').value.trim();
  if (!keyword) return;
  pushSearchHistory(keyword);
  $('searchSuggest').classList.remove('show');
  state.view = 'search';
  navPush('search', { kw: keyword });
  const main = $('main');
  main.innerHTML = `<div class="loading">搜索中...</div>`;
  try {
    const data = await api(`/music/search?keyword=${encodeURIComponent(keyword)}`);
    const isSingerResult = !!(data.singer && data.singer.mid);
    const totalNote = isSingerResult ? `已加载 ${data.songs.length} / ${data.total || '?'} 首` : `${data.songs.length} 首`;
    let html = `<div class="view-title">搜索：${esc(keyword)}</div>`;
    if (isSingerResult) {
      html += `<div class="singer-card">
        <img class="singer-avatar" src="${singerAvatar(data.singer.mid)}" onerror="this.style.display='none'" />
        <div class="info"><h3>${esc(data.singer.name)}</h3><p>共 ${data.total} 首歌曲${data.album_count ? ' · ' + data.album_count + ' 张专辑' : ''}</p></div>
        <button class="btn green" id="openArtistBtn">进入歌手页</button>
      </div>`;
    }
    html += `<div class="section-head"><h2>${isSingerResult ? '歌曲' : '单曲'}（${totalNote}）</h2></div>
             ${data.songs.length ? listToolsHtml() : ''}
             ${songColHeader}
             <div class="song-list" id="searchSongs"></div>`;
    main.innerHTML = html;
    const sContainer = $('searchSongs');
    const songBuf = [...data.songs];
    renderSongList(sContainer, songBuf, { showAdd: true });
    bindListTools(main, songBuf, sContainer, null, null);
    if (isSingerResult && data.hasMore !== false) appendLoadMore(main, sContainer, songBuf, data.singer, data.total);
    if (isSingerResult) $('openArtistBtn').onclick = () => openArtist(data.singer.mid, data.singer.name);
  } catch (e) { main.innerHTML = `<div class="empty">搜索失败：${esc(e.message)}</div>`; }
}

function appendLoadMore(main, container, songBuf, singer, total) {
  let begin = songBuf.length;
  const wrap = document.createElement('div');
  wrap.className = 'load-more-wrap'; wrap.id = 'loadMoreWrap';
  const btn = document.createElement('button');
  btn.className = 'btn sm load-more-btn'; btn.id = 'loadMoreBtn';
  btn.textContent = `加载更多（已加载 ${begin} / ${total || '?'} 首）`;
  wrap.appendChild(btn); main.appendChild(wrap);

  btn.onclick = async () => {
    btn.disabled = true; btn.textContent = '加载中…';
    try {
      const res = await api(`/music/artist?mid=${encodeURIComponent(singer.mid)}&name=${encodeURIComponent(singer.name || '')}&begin=${begin}`);
      const newSongs = res.songs || [];
      if (newSongs.length === 0) { wrap.remove(); return; }
      const prevLen = songBuf.length;
      songBuf.push(...newSongs); begin = songBuf.length;
      const frag = document.createDocumentFragment();
      newSongs.forEach((s, j) => {
        const i = prevLen + j;
        const inPls = songInPlaylists(s);
        const bookmark = inPls.size > 0
          ? `<span class="in-pl-mark" data-tip="已在 ${inPls.size} 个歌单中"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg></span>`
          : '<span class="in-pl-placeholder"></span>';
        const div = document.createElement('div');
        div.className = 'song-row'; div.dataset.i = String(i);
        div.innerHTML = `
          <span class="idx">${i + 1}</span>
          <span class="name">${esc(s.name)}</span>
          <span class="singer">${esc(s.singer)}</span>
          <span class="album">${esc(s.album)}</span>
          ${bookmark}
          <span class="dur">${fmtDur(s.duration)}</span>
          <span class="ops">
            <button class="icon-btn play" title="播放" data-act="play">▶</button>
            <button class="icon-btn" title="添加到歌单" data-act="add">＋</button>
          </span>`;
        div.onclick = () => import('./player.js').then(({ playFromList }) => playFromList(songBuf, i, null, null));
        div.querySelectorAll('[data-act]').forEach((b) => {
          b.onclick = (ev) => {
            ev.stopPropagation();
            if (b.dataset.act === 'play') import('./player.js').then(({ playFromList }) => playFromList(songBuf, i, null, null));
            else if (b.dataset.act === 'add') addSongs([songBuf[i]]);
          };
        });
        div.oncontextmenu = (ev) => { ev.preventDefault(); import('./ui.js').then(({ openSongMenu }) => openSongMenu(ev, songBuf, i, null, null, div)); };
        frag.appendChild(div);
      });
      container.appendChild(frag); container._songs = songBuf;
      const h2 = main.querySelector('.section-head h2');
      if (h2) h2.textContent = h2.textContent.replace(/已加载 \d+/, `已加载 ${begin}`);
      if (res.hasMore === false || begin >= (res.total || begin)) wrap.remove();
      else { btn.disabled = false; btn.textContent = `加载更多（已加载 ${begin} / ${res.total || '?'} 首）`; }
    } catch (e) { btn.disabled = false; btn.textContent = '加载失败，点击重试'; toast('加载失败：' + e.message); }
  };
}

let _artistTab = 'songs'; // 记住上次在专辑页点了哪个 tab

export async function openArtist(mid, name) {
  state.view = 'artist';
  navPush('artist', { mid, name });
  const main = $('main');
  main.innerHTML = `<div class="loading">加载歌手「${esc(name)}」...</div>`;
  try {
    const data = await api(`/music/artist?mid=${encodeURIComponent(mid)}&name=${encodeURIComponent(name || '')}`);
    const songBuf = [...data.songs];
    const totalNote = `已加载 ${songBuf.length} / ${data.total || '?'} 首`;

    // 歌手顶栏：头像 + 信息
    const singerName = data.singer?.name || name;
    const singerSub = `共 ${data.total || 0} 首歌曲 · ${data.albums.length} 张专辑`;

    main.innerHTML = `
      <div class="artist-header">
        <img class="artist-avatar" src="${singerAvatar(mid)}" onerror="this.style.display='none'" />
        <div class="artist-info">
          <h2 class="artist-name">${esc(singerName)}</h2>
          <p class="artist-sub">${singerSub}</p>
        </div>
      </div>
      <div class="artist-tabs">
        <button class="artist-tab${_artistTab === 'songs' ? ' active' : ''}" data-tab="songs">歌曲（${totalNote}）</button>
        <button class="artist-tab${_artistTab === 'albums' ? ' active' : ''}" data-tab="albums">专辑（${data.albums.length}）</button>
      </div>
      <div class="artist-tab-content" id="artistTabContent">
        <div class="artist-pane" id="artistSongsPane" style="display:${_artistTab === 'songs' ? 'block' : 'none'}">
          ${songColHeader}
          <div class="song-list" id="artistSongs"></div>
        </div>
        <div class="artist-pane" id="artistAlbumsPane" style="display:${_artistTab === 'albums' ? 'block' : 'none'}">
          <div class="album-grid" id="artistAlbums"></div>
        </div>
      </div>`;

    // 歌曲面板
    const aContainer = $('artistSongs');
    renderSongList(aContainer, songBuf, { showAdd: true });
    bindListTools(main, songBuf, aContainer, null, null);
    $('addAllSongs')?.remove(); // 旧按钮不存在
    if (data.hasMore !== false) appendLoadMore(main, aContainer, songBuf, data.singer, data.total);

    // 专辑面板
    const grid = $('artistAlbums');
    grid.innerHTML = data.albums.map((a) => `
      <div class="album-card" data-mid="${esc(a.album_mid)}" data-name="${esc(a.name)}">
        <div class="cover">${a.album_mid ? `<img class="cover-img" src="${albumCover(a.album_mid)}" loading="lazy" onerror="this.remove()" />` : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>'}</div>
        <div class="a-name">${esc(a.name)}</div>
        <div class="a-time">${esc(a.pub_time || '')}</div>
      </div>`).join('') || '<div class="empty">暂无专辑</div>';
    grid.querySelectorAll('.album-card').forEach((el) => { el.onclick = () => openAlbum(el.dataset.mid, el.dataset.name); });

    // Tab 切换
    main.querySelectorAll('.artist-tab').forEach((btn) => {
      btn.onclick = () => {
        _artistTab = btn.dataset.tab;
        main.querySelectorAll('.artist-tab').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const isSongs = btn.dataset.tab === 'songs';
        $('artistSongsPane').style.display = isSongs ? 'block' : 'none';
        $('artistAlbumsPane').style.display = isSongs ? 'none' : 'block';
        const loadMore = document.getElementById('loadMoreWrap');
        if (loadMore) loadMore.style.display = isSongs ? '' : 'none';
      };
    });

  } catch (e) { main.innerHTML = `<div class="empty">加载失败：${esc(e.message)}</div>`; }
}

export async function openAlbum(mid, name) {
  state.view = 'album';
  navPush('album', { mid, name });
  const main = $('main');
  main.innerHTML = `<div class="loading">加载专辑「${esc(name)}」...</div>`;
  try {
    const data = await api(`/music/album?mid=${encodeURIComponent(mid)}`);
    const metaHtml = ((data.genre || data.lan || data.company || data.aDate)
      ? `<div class="album-meta">
        ${data.genre ? `<span class="album-meta-tag">${esc(data.genre)}</span>` : ''}
        ${data.lan ? `<span class="album-meta-tag">${esc(data.lan)}</span>` : ''}
        ${data.company ? `<span class="album-meta-tag">${esc(data.company)}</span>` : ''}
        ${data.aDate ? `<span class="album-meta-tag">${esc(data.aDate)}</span>` : ''}
      </div>`
      : '');
    // 检查是否已收藏
    const singer = data.songs[0]?.singer || '';
    let isSaved = false;
    try { const chk = await api(`/stats/albums/${encodeURIComponent(mid)}/check`); isSaved = chk.saved; } catch { /* ignore */ }

    const saveBtnHtml = isSaved
      ? `<button class="btn sm" id="albumSaveBtn"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg> 已收藏</button>`
      : `<button class="btn sm" id="albumSaveBtn">＋ 收藏专辑</button>`;

    const coverUrl = albumCover(mid, 500);
    const coverHtml = `<img class="album-detail-cover" src="${coverUrl}" alt="" ${coverUrl ? 'onerror="this.style.display=\'none\'"' : ''} />`;
    const descText = data.desc ? data.desc.split(/\n\n+/).filter((p, i, arr) => i === 0 || arr[i-1].trim().slice(0,30) !== p.trim().slice(0,30)).join('\n\n') : '';

    main.innerHTML = `
      <div class="album-detail-header">
        ${coverHtml}
        <div class="album-detail-info">
          <div class="view-title" style="margin-bottom:6px">${esc(data.name || name)}</div>
          ${metaHtml}
          ${descText ? `
            <div class="album-desc-wrap" style="margin-top:6px">
              <div class="album-desc clamp" id="albumDesc">${esc(descText).replace(/\n/g, '<br>')}</div>
              <button class="album-desc-more" id="albumDescMore">展开全文</button>
            </div>` : ''}
        </div>
      </div>
      <div class="section-head"><h2>曲目</h2>
        <div class="album-actions">
          <button class="btn green sm" id="addAlbumAllSave">＋ 整张添加到歌单</button>
          ${saveBtnHtml}
        </div>
      </div>
      ${data.songs.length ? listToolsHtml() : ''}
      ${songColHeader}
      <div class="song-list" id="albumSongs"></div>`;

    if (data.desc) {
      $('albumDescMore').onclick = () => {
        const el = $('albumDesc');
        const more = $('albumDescMore');
        el.classList.toggle('clamp');
        more.textContent = el.classList.contains('clamp') ? '展开全文' : '收起';
      };
    }
    const albContainer = $('albumSongs');
    renderSongList(albContainer, data.songs, { showAdd: true });
    bindListTools(main, data.songs, albContainer, null, null);
    // 整张添加到歌单
    $('addAlbumAllSave').onclick = () => addSongs(data.songs);
    // 收藏/取消收藏
    $('albumSaveBtn').onclick = async () => {
      const btn = $('albumSaveBtn');
      if (isSaved) {
        try { await api(`/stats/albums/${encodeURIComponent(mid)}`, { method: 'DELETE' }); } catch { /* ignore */ }
        btn.textContent = '＋ 收藏专辑'; isSaved = false;
        toast('已取消收藏');
      } else {
        await api(`/stats/albums/${encodeURIComponent(mid)}`, {
          method: 'POST',
          body: { name: data.name, singer, desc: data.desc || '', company: data.company || '', genre: data.genre || '', lan: data.lan || '', aDate: data.aDate || '' },
        });
        btn.textContent = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg> 已收藏'; isSaved = true;
        toast('专辑已收藏 <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>');
      }
    };
  } catch (e) { main.innerHTML = `<div class="empty">加载失败：${esc(e.message)}</div>`; }
}

// 搜索建议键盘导航选中索引
let _selIdx = -1;

export function initSearch() {
  $('searchBtn').onclick = doSearch;
  $('searchInput').addEventListener('keydown', (e) => {
    const box = $('searchSuggest');
    const rows = box.querySelectorAll('.ss-row');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      _selIdx = Math.min(_selIdx + 1, rows.length - 1);
      rows.forEach((r, i) => r.classList.toggle('ss-hover', i === _selIdx));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      _selIdx = Math.max(_selIdx - 1, -1);
      rows.forEach((r, i) => r.classList.toggle('ss-hover', i === _selIdx));
    } else if (e.key === 'Enter') {
      box.classList.remove('show');
      if (_selIdx >= 0 && rows[_selIdx]) {
        $('searchInput').value = rows[_selIdx].dataset.k;
      }
      doSearch();
    } else if (e.key === 'Escape') {
      box.classList.remove('show');
      _selIdx = -1;
    }
  });
  $('searchInput').addEventListener('focus', renderSuggest);
  $('searchInput').addEventListener('input', renderSuggest);
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-box')) $('searchSuggest').classList.remove('show');
  });
}
