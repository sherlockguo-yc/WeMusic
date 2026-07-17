// ---------------- 搜索、歌手页、专辑页 ----------------
import { $, esc, fmtDur, albumCover, singerAvatar, toast, songColHeader, refreshCacheBadges } from './utils.js';
import { heartOutline, heartFilled } from './ui.js';
import { api } from './api.js';
import { state } from './state.js';
import { renderSongList, listToolsHtml, bindListTools, addSongs, songInPlaylists } from './playlist-ui.js';
// 动态导入避免与 main.js 的循环依赖
const _navPush = (view, data) => import('./main.js').then(m => m.navPush(view, data));



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
  _navPush('search', { kw: keyword });
  const main = $('main');
  main.innerHTML = `<div class="loading">搜索中...</div>`;
  try {
    const data = await api(`/music/search?keyword=${encodeURIComponent(keyword)}`);
    const isSingerResult = !!(data.singer && data.singer.mid);
    const totalNote = isSingerResult ? `已加载 ${data.songs.length} / ${data.total || '?'} 首` : `${data.songs.length} 首`;
    let html = `<div class="view-title">搜索：${esc(keyword)}</div>`;
    if (isSingerResult) {
      const singerPh = '<div class="singer-avatar" style="display:flex;align-items:center;justify-content:center;color:var(--text-dim)"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div>';
      html += `<div class="singer-card">
        <img class="singer-avatar" src="${singerAvatar(data.singer.mid, 300)}" data-fb="${esc(singerPh)}" onerror="this.outerHTML=this.dataset.fb" />
        <div class="info"><h3>${esc(data.singer.name)}</h3><p>共 ${data.total} 首歌曲${data.album_count ? ' · ' + data.album_count + ' 张专辑' : ''}</p></div>
        <button class="btn green" id="openArtistBtn">进入歌手页</button>
      </div>`;
    }
    html += `<div class="section-head"><h2>${isSingerResult ? '歌曲' : '单曲'}（${totalNote}）</h2></div>
             ${data.songs.length ? `${listToolsHtml()}${songColHeader}<div class="song-list" id="searchSongs"></div>` : '<div class="empty">未搜索到结果</div>'}`;
    main.innerHTML = html;
    const sContainer = $('searchSongs');
    const songBuf = [...data.songs];
    renderSongList(sContainer, songBuf, { showAdd: true });
    bindListTools(main, songBuf, sContainer, null, null);
    if (isSingerResult && data.hasMore !== false) {
      appendLoadMore(main, sContainer, songBuf, data.singer, data.total);
      wrapPlayBtnsForBgLoad(main, songBuf, data.singer, data.total);
    }
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
          <span class="name">${esc(s.name)}<span class="cache-badge-slot" data-bvid="${esc(s.bvid || '')}" data-name="${esc(s.name)}" data-singer="${esc(s.singer || '')}"></span></span>
          <span class="singer">${esc(s.singer)}</span>
          <span class="album">${esc(s.album)}</span>
          ${bookmark}
          <span class="dur">${fmtDur(s.duration)}</span>
          <span class="ops">
            <button class="icon-btn play" title="播放" data-act="play"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg></button>
            <button class="icon-btn" title="添加到歌单" data-act="add"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg></button>
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
      container.appendChild(frag); container._songs = songBuf; refreshCacheBadges();
      const h2 = main.querySelector('.section-head h2');
      if (h2) h2.textContent = h2.textContent.replace(/已加载 \d+/, `已加载 ${begin}`);
      if (res.hasMore === false || begin >= (res.total || begin)) wrap.remove();
      else { btn.disabled = false; btn.textContent = `加载更多（已加载 ${begin} / ${res.total || '?'} 首）`; }
    } catch (e) { btn.disabled = false; btn.textContent = '加载失败，点击重试'; toast('加载失败：' + e.message); }
  };
}

// ---- 后台加载：播放时将未加载的歌曲追加到队列 ----
let _bgLoadSeq = 0;

async function loadRemainingSongs(songBuf, singer, total) {
  const seq = ++_bgLoadSeq;
  let begin = songBuf.length;
  let retries = 0;

  while (begin < total) {
    if (seq !== _bgLoadSeq) return; // 被新搜索取消
    try {
      const res = await api(`/music/artist?mid=${encodeURIComponent(singer.mid)}&name=${encodeURIComponent(singer.name || '')}&begin=${begin}`);
      if (seq !== _bgLoadSeq) return;
      const newSongs = res.songs || [];
      if (newSongs.length === 0) break;

      // 去重后追加到队列
      const existingKeys = new Set(state.queue.map(s => `${s.name}__${s.singer || ''}`));
      for (const s of newSongs) {
        const key = `${s.name}__${s.singer || ''}`;
        if (!existingKeys.has(key)) {
          state.queue.push(s);
          existingKeys.add(key);
        }
      }
      begin += newSongs.length;

      // 队列抽屉打开时刷新
      const drawer = document.getElementById('queueDrawer');
      if (drawer && drawer.classList.contains('show')) {
        import('./queue.js').then(({ renderActiveTab }) => renderActiveTab());
      }
    } catch (e) {
      retries++;
      if (retries >= 3) break;
      await new Promise(r => setTimeout(r, 1000 * retries));
    }
  }
}

function wrapPlayBtnsForBgLoad(main, songBuf, singer, total) {
  const playBtn = main.querySelector('[data-tool="playall"]');
  const shuffleBtn = main.querySelector('[data-tool="shuffle"]');

  const doPlay = (shuffle) => {
    if (!songBuf || songBuf.length === 0) return toast('列表为空');
    import('./player.js').then(({ playFromList, renderMode }) => {
      if (shuffle && state.playMode !== 'shuffle') {
        state.playMode = 'shuffle';
        localStorage.setItem('wemusic_mode', 'shuffle');
        renderMode();
      }
      state.history = [];
      const start = shuffle ? Math.floor(Math.random() * songBuf.length) : 0;
      playFromList(songBuf, start, null, null);
    });
    loadRemainingSongs(songBuf, singer, total);
  };

  if (playBtn) playBtn.onclick = () => doPlay(false);
  if (shuffleBtn) shuffleBtn.onclick = () => doPlay(true);
}

let _artistTab = 'songs'; // 记住上次在专辑页点了哪个 tab
let _lbPhotos = [];       // lightbox 图片列表（模块级，跨歌手页共享）
let _lbIdx = 0;           // lightbox 当前索引
let _lbTimer = null;      // lightbox 自动播放定时器
let _lbPlaying = false;   // 是否正在自动播放
let _lbLayerA = true;     // 双图层切换：当前活跃的是 A 还是 B

export async function openArtist(mid, name) {
  state.view = 'artist';
  _navPush('artist', { mid, name });
  const main = $('main');
  main.innerHTML = `<div class="loading">加载歌手「${esc(name)}」...</div>`;
  try {
    const data = await api(`/music/artist?mid=${encodeURIComponent(mid)}&name=${encodeURIComponent(name || '')}`);
    const songBuf = [...data.songs];
    const totalNote = `已加载 ${songBuf.length} / ${data.total || '?'} 首`;

    // 歌手顶栏：头像 + 信息
    const singerName = data.singer?.name || name;
    const singerSub = `共 ${data.total || 0} 首歌曲 · ${data.albums.length} 张专辑`;

    const artistPh = '<div class="artist-avatar" style="display:flex;align-items:center;justify-content:center;color:var(--text-dim)"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div>';
    main.innerHTML = `
      <div class="artist-header">
        <img class="artist-avatar" src="${singerAvatar(mid, 300)}" data-fb="${esc(artistPh)}" onerror="this.outerHTML=this.dataset.fb" />
        <div class="artist-info">
          <h2 class="artist-name">${esc(singerName)}</h2>
          <p class="artist-sub">${singerSub}</p>
        </div>
      </div>
      <div class="artist-tabs">
        <button class="artist-tab${_artistTab === 'songs' ? ' active' : ''}" data-tab="songs">歌曲（${totalNote}）</button>
        <button class="artist-tab${_artistTab === 'albums' ? ' active' : ''}" data-tab="albums">专辑（${data.albums.length}）</button>
        <button class="artist-tab${_artistTab === 'photos' ? ' active' : ''}" data-tab="photos">写真（${data.albums.length}）</button>
      </div>
      <div class="artist-tab-content" id="artistTabContent">
        <div class="artist-pane" id="artistSongsPane" style="display:${_artistTab === 'songs' ? 'block' : 'none'}">
          ${songColHeader}
          <div class="song-list" id="artistSongs"></div>
        </div>
        <div class="artist-pane" id="artistAlbumsPane" style="display:${_artistTab === 'albums' ? 'block' : 'none'}">
          <div class="album-grid" id="artistAlbums"></div>
        </div>
        <div class="artist-pane" id="artistPhotosPane" style="display:${_artistTab === 'photos' ? 'block' : 'none'}">
          <div class="photo-gallery" id="artistPhotos"></div>
        </div>
      </div>`;

    // 歌曲面板
    const aContainer = $('artistSongs');
    renderSongList(aContainer, songBuf, { showAdd: true });
    bindListTools(main, songBuf, aContainer, null, null);
    $('addAllSongs')?.remove(); // 旧按钮不存在
    if (data.hasMore !== false) {
      appendLoadMore(main, aContainer, songBuf, data.singer, data.total);
      wrapPlayBtnsForBgLoad(main, songBuf, data.singer, data.total);
    }

    // 专辑面板
    const grid = $('artistAlbums');
    grid.innerHTML = data.albums.map((a) => `
      <div class="album-card" data-mid="${esc(a.album_mid)}" data-name="${esc(a.name)}">
        <div class="cover">${a.album_mid ? `<img class="cover-img" src="${albumCover(a.album_mid)}" loading="lazy" onerror="this.remove()" />` : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>'}</div>
        <div class="a-name">${esc(a.name)}</div>
        <div class="a-time">${esc(a.pub_time || '')}</div>
      </div>`).join('') || '<div class="empty">暂无专辑</div>';
    grid.querySelectorAll('.album-card').forEach((el) => { el.onclick = () => openAlbum(el.dataset.mid, el.dataset.name); });

    // 写真面板
    const photosContainer = $('artistPhotos');
    const allPhotos = [
      { src: singerAvatar(mid, 800), label: singerName, isSinger: true },
      ...data.albums.map((a) => ({
        src: albumCover(a.album_mid, 800),
        label: a.name,
        albumMid: a.album_mid,
      })),
    ];
    photosContainer.innerHTML = allPhotos.map((p, i) => `
      <div class="photo-item${p.isSinger ? ' photo-hero' : ''}" data-idx="${i}">
        <img src="${esc(p.src)}" loading="lazy"
          onerror="this.closest('.photo-item').remove()"
          title="${esc(p.label)}" />
      </div>`).join('') || '<div class="empty">暂无写真</div>';

    // Lightbox（DOM 只创建一次，状态在模块级）
    function ensureLightbox() {
      if (document.getElementById('photoLightbox')) return;
      const mask = document.createElement('div');
      mask.id = 'photoLightbox';
      mask.className = 'lightbox-mask';
      mask.innerHTML = `
        <button class="lightbox-close"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        <button class="lightbox-prev"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg></button>
        <div class="lightbox-img-wrap">
          <img class="lightbox-img lightbox-img-a" src="" alt="" />
          <img class="lightbox-img lightbox-img-b" src="" alt="" />
        </div>
        <div class="lightbox-label"></div>
        <div class="lightbox-counter"></div>
        <button class="lightbox-play" title="自动播放"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg></button>
        <button class="lightbox-next"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></button>`;
      document.body.appendChild(mask);
      mask.addEventListener('click', (e) => { if (e.target === mask) closeLightbox(); });
      mask.querySelector('.lightbox-close').onclick = closeLightbox;
      mask.querySelector('.lightbox-prev').onclick = () => { pauseAuto(); _lbIdx = _lbIdx <= 0 ? _lbPhotos.length - 1 : _lbIdx - 1; showLightbox(); };
      mask.querySelector('.lightbox-next').onclick = () => { pauseAuto(); _lbIdx = _lbIdx >= _lbPhotos.length - 1 ? 0 : _lbIdx + 1; showLightbox(); };
      mask.querySelector('.lightbox-play').onclick = togglePlay;
    }
    function showLightbox(isFirst) {
      const mask = document.getElementById('photoLightbox');
      const p = _lbPhotos[_lbIdx];
      mask.querySelector('.lightbox-label').textContent = p.label || '';
      mask.querySelector('.lightbox-counter').textContent = `${_lbIdx + 1} / ${_lbPhotos.length}`;
      updatePlayBtn();

      const active = mask.querySelector(_lbLayerA ? '.lightbox-img-a' : '.lightbox-img-b');
      const inactive = mask.querySelector(_lbLayerA ? '.lightbox-img-b' : '.lightbox-img-a');

      if (isFirst) {
        // 首次打开：直接显示，不做过渡
        active.src = p.src;
        active.classList.add('on');
        inactive.classList.remove('on');
        return;
      }
      // 双图层 cross-fade：下一张在图加载到后台，加载完后交叉淡入淡出
      inactive.src = p.src;
      const done = () => {
        inactive.classList.add('on');
        active.classList.remove('on');
        _lbLayerA = !_lbLayerA;
      };
      if (inactive.complete) { done(); }
      else { inactive.onload = done; inactive.onerror = () => { done(); }; }
    }
    function openLightbox() {
      _lbPlaying = false;
      clearTimeout(_lbTimer);
      showLightbox(true);
      document.getElementById('photoLightbox').classList.add('show');
      document.body.style.overflow = 'hidden';
    }
    function closeLightbox() {
      _lbPlaying = false;
      clearTimeout(_lbTimer);
      const mask = document.getElementById('photoLightbox');
      if (mask) mask.classList.remove('show');
      document.body.style.overflow = '';
    }
    function togglePlay() {
      _lbPlaying = !_lbPlaying;
      updatePlayBtn();
      if (_lbPlaying) autoNext();
      else clearTimeout(_lbTimer);
    }
    function autoNext() {
      if (!_lbPlaying) return;
      _lbTimer = setTimeout(() => {
        _lbIdx = _lbIdx >= _lbPhotos.length - 1 ? 0 : _lbIdx + 1;
        showLightbox();
        autoNext();
      }, 6000);
    }
    function pauseAuto() {
      if (_lbPlaying) { _lbPlaying = false; clearTimeout(_lbTimer); updatePlayBtn(); }
    }
    function updatePlayBtn() {
      const btn = document.querySelector('#photoLightbox .lightbox-play');
      if (!btn) return;
      btn.innerHTML = _lbPlaying
        ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>'
        : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
    }
    ensureLightbox();
    // 键盘导航（只绑定一次）
    if (!document._lbKeyBound) {
      document._lbKeyBound = true;
      document.addEventListener('keydown', (e) => {
        const mask = document.getElementById('photoLightbox');
        if (!mask || !mask.classList.contains('show')) return;
        if (e.key === 'Escape') closeLightbox();
        else if (e.key === 'ArrowLeft') { pauseAuto(); _lbIdx = _lbIdx <= 0 ? _lbPhotos.length - 1 : _lbIdx - 1; showLightbox(); }
        else if (e.key === 'ArrowRight') { pauseAuto(); _lbIdx = _lbIdx >= _lbPhotos.length - 1 ? 0 : _lbIdx + 1; showLightbox(); }
      });
    }

    // 点击画廊中的图片 → 打开 lightbox
    photosContainer.querySelectorAll('.photo-item').forEach((el) => {
      el.onclick = () => {
        const container = el.closest('#artistPhotos');
        const items = [...container.querySelectorAll('.photo-item')];
        _lbPhotos = items.map((it) => ({
          src: it.querySelector('img').src,
          label: it.querySelector('img').title || '',
        }));
        _lbIdx = items.indexOf(el);
        openLightbox();
      };
    });

    // Tab 切换
    main.querySelectorAll('.artist-tab').forEach((btn) => {
      btn.onclick = () => {
        _artistTab = btn.dataset.tab;
        main.querySelectorAll('.artist-tab').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        $('artistSongsPane').style.display = btn.dataset.tab === 'songs' ? 'block' : 'none';
        $('artistAlbumsPane').style.display = btn.dataset.tab === 'albums' ? 'block' : 'none';
        $('artistPhotosPane').style.display = btn.dataset.tab === 'photos' ? 'block' : 'none';
        const loadMore = document.getElementById('loadMoreWrap');
        if (loadMore) loadMore.style.display = btn.dataset.tab === 'songs' ? '' : 'none';
      };
    });

  } catch (e) { main.innerHTML = `<div class="empty">加载失败：${esc(e.message)}</div>`; }
}

export async function openAlbum(mid, name) {
  state.view = 'album';
  _navPush('album', { mid, name });
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
      ? `<button class="btn sm" id="albumSaveBtn"><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg> 已收藏</button>`
      : `<button class="btn sm" id="albumSaveBtn"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg> 收藏专辑</button>`;

    const coverUrl = albumCover(mid, 500);
    const albumPh = '<div class="album-detail-cover" style="display:flex;align-items:center;justify-content:center;color:var(--text-dim)"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg></div>';
    const coverHtml = `<img class="album-detail-cover" src="${coverUrl}" alt="" data-fb="${esc(albumPh)}" onerror="this.outerHTML=this.dataset.fb" />`;
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
      <div class="section-head album-head"><h2>曲目</h2>
        <div class="album-actions">
          <button class="btn green sm" id="playAlbumAll"><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg> 播放全部</button>
          <button class="btn sm" id="shuffleAlbum"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="m15 15 6 6"/><path d="M4 4l5 5"/></svg> 随机播放</button>
          <button class="btn sm" id="addAlbumAllSave"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg> 添加到歌单</button>
          ${saveBtnHtml}
        </div>
      </div>
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
    // 播放全部
    $('playAlbumAll').onclick = () => import('./player.js').then(({ playFromList }) => playFromList(data.songs, 0, 'album', null));
    // 随机播放
    $('shuffleAlbum').onclick = () => import('./player.js').then(({ playFromList, renderMode }) => {
      state.playMode = 'shuffle'; renderMode();
      playFromList(data.songs, 0, 'album', null);
    });
    // 添加到歌单
    $('addAlbumAllSave').onclick = () => addSongs(data.songs);
    // 收藏/取消收藏
    const hOut = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>';
    const hFill = '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>';
    $('albumSaveBtn').onclick = async () => {
      const btn = $('albumSaveBtn');
      if (isSaved) {
        await api(`/stats/albums/${encodeURIComponent(mid)}`, { method: 'DELETE' });
        btn.innerHTML = hOut + ' 收藏专辑'; isSaved = false;
        toast('已取消收藏');
      } else {
        await api(`/stats/albums/${encodeURIComponent(mid)}`, {
          method: 'POST',
          body: { name: data.name, singer, desc: data.desc || '', company: data.company || '', genre: data.genre || '', lan: data.lan || '', aDate: data.aDate || '' },
        });
        btn.innerHTML = hFill + ' 已收藏'; isSaved = true;
        toast('专辑已收藏');
      }
    };
  } catch (e) { main.innerHTML = `<div class="empty">加载失败：${esc(e.message)}</div>`; }
}

// 搜索建议键盘导航选中索引
let _selIdx = -1;

export function initSearch() {
  $('searchBtn').onclick = doSearch;
  // 清除按钮
  const si = $('searchInput'), sc = $('searchClear');
  si.addEventListener('input', () => sc.classList.toggle('visible', si.value.length > 0));
  si.addEventListener('focus', () => sc.classList.toggle('visible', si.value.length > 0));
  si.addEventListener('blur', () => setTimeout(() => sc.classList.remove('visible'), 150)); // 延迟隐藏防止按钮点击不到
  sc.addEventListener('click', () => { si.value = ''; sc.classList.remove('visible'); si.focus(); });
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
