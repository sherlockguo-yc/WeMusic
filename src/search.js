// ---------------- 搜索、歌手页、专辑页 ----------------
import { $, esc, fmtDur, fmtPlay, albumCover, toast } from './utils.js';
import { api } from './api.js';
import { state } from './state.js';
import { renderSongList, listToolsHtml, bindListTools, addSongs, songInPlaylists } from './playlist-ui.js';

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
  const box = $('searchSuggest');
  const q = $('searchInput').value.trim().toLowerCase();
  const hist = getSearchHistory();
  const list = q ? hist.filter((x) => x.toLowerCase().includes(q)) : hist;
  if (list.length === 0) { box.classList.remove('show'); return; }
  box.innerHTML =
    `<div class="ss-head"><span>搜索历史</span><span class="ss-clear" id="ssClear">清空</span></div>` +
    list.map((k) => `<div class="ss-row" data-k="${esc(k)}">
      <span class="ss-icon">🕘</span><span class="ss-key">${esc(k)}</span>
      <span class="ss-del" data-del="${esc(k)}" title="删除">✕</span>
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
  const main = $('main');
  main.innerHTML = `<div class="loading">搜索中...</div>`;
  try {
    const data = await api(`/music/search?keyword=${encodeURIComponent(keyword)}`);
    const isSingerResult = !!(data.singer && data.singer.mid);
    const totalNote = isSingerResult ? `已加载 ${data.songs.length} / ${data.total || '?'} 首` : `${data.songs.length} 首`;
    let html = `<div class="view-title">搜索：${esc(keyword)}</div>`;
    if (isSingerResult) {
      html += `<div class="singer-card"><div class="info"><h3>歌手 · ${esc(data.singer.name)}</h3><p>查看 TA 的全部歌曲与专辑，可一键批量添加</p></div><button class="btn green" id="openArtistBtn">进入歌手页</button></div>`;
    }
    html += `<div class="section-head"><h2>${isSingerResult ? '歌手歌曲' : '单曲'}（${totalNote}）</h2></div>
             ${data.songs.length ? listToolsHtml() : ''}
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
          ? `<span class="in-pl-mark" title="已在 ${inPls.size} 个歌单中">🔖</span>`
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

export async function openArtist(mid, name) {
  state.view = 'artist';
  const main = $('main');
  main.innerHTML = `<div class="loading">加载歌手「${esc(name)}」...</div>`;
  try {
    const data = await api(`/music/artist?mid=${encodeURIComponent(mid)}&name=${encodeURIComponent(name || '')}`);
    const songBuf = [...data.songs];
    const totalNote = `已加载 ${songBuf.length} / ${data.total || '?'} 首`;
    main.innerHTML = `
      <div class="singer-card">
        <div class="info"><h3>${esc(data.singer.name)}</h3><p>共 ${data.total} 首歌曲 · ${data.albums.length} 张专辑</p></div>
        <button class="btn green" id="addAllSongs">添加已加载歌曲</button>
      </div>
      <div class="section-head"><h2>歌曲（${totalNote}）</h2></div>
      ${data.songs.length ? listToolsHtml() : ''}
      <div class="song-list" id="artistSongs"></div>
      <div class="section-head"><h2>专辑（${data.albums.length}）</h2></div>
      <div class="album-grid" id="artistAlbums"></div>`;
    const aContainer = $('artistSongs');
    renderSongList(aContainer, songBuf, { showAdd: true });
    bindListTools(main, songBuf, aContainer, null, null);
    $('addAllSongs').onclick = () => addSongs(songBuf);
    if (data.hasMore !== false) appendLoadMore(main, aContainer, songBuf, data.singer, data.total);
    const grid = $('artistAlbums');
    grid.innerHTML = data.albums.map((a) => `
      <div class="album-card" data-mid="${esc(a.album_mid)}" data-name="${esc(a.name)}">
        <div class="cover">${a.album_mid ? `<img class="cover-img" src="${albumCover(a.album_mid)}" loading="lazy" onerror="this.remove()" />` : '♪'}</div>
        <div class="a-name">${esc(a.name)}</div>
        <div class="a-time">${esc(a.pub_time || '')}</div>
      </div>`).join('') || '<div class="empty">暂无专辑</div>';
    grid.querySelectorAll('.album-card').forEach((el) => { el.onclick = () => openAlbum(el.dataset.mid, el.dataset.name); });
  } catch (e) { main.innerHTML = `<div class="empty">加载失败：${esc(e.message)}</div>`; }
}

export async function openAlbum(mid, name) {
  state.view = 'album';
  const main = $('main');
  main.innerHTML = `<div class="loading">加载专辑「${esc(name)}」...</div>`;
  try {
    const data = await api(`/music/album?mid=${encodeURIComponent(mid)}`);
    main.innerHTML = `
      <div class="view-title">专辑 · ${esc(data.album || name)}</div>
      <div class="view-sub">${data.songs.length} 首</div>
      <div class="section-head"><h2>曲目</h2><button class="btn green sm" id="addAlbumAll">整张添加</button></div>
      ${data.songs.length ? listToolsHtml() : ''}
      <div class="song-list" id="albumSongs"></div>`;
    const albContainer = $('albumSongs');
    renderSongList(albContainer, data.songs, { showAdd: true });
    bindListTools(main, data.songs, albContainer, null, null);
    $('addAlbumAll').onclick = () => addSongs(data.songs);
  } catch (e) { main.innerHTML = `<div class="empty">加载失败：${esc(e.message)}</div>`; }
}

export function initSearch() {
  $('searchBtn').onclick = doSearch;
  $('searchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { $('searchSuggest').classList.remove('show'); doSearch(); }
    else if (e.key === 'Escape') $('searchSuggest').classList.remove('show');
  });
  $('searchInput').addEventListener('focus', renderSuggest);
  $('searchInput').addEventListener('input', renderSuggest);
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-box')) $('searchSuggest').classList.remove('show');
  });
}
