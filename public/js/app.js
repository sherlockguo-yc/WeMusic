// ---------------- 登录态校验 ----------------
if (!Auth.token) location.href = '/login.html';

const $ = (id) => document.getElementById(id);

// ---------------- 全局状态 ----------------
const state = {
  playlists: [],
  targetPlaylistId: null, // 当前选中 / 添加目标歌单
  view: 'home',
  queue: [],              // 当前播放队列
  queueIndex: -1,
  current: null,          // 当前播放的歌曲对象
  currentContext: null,   // 'playlist' 时记录 playlistId，用于缓存 bvid
  playMode: localStorage.getItem('wemusic_mode') || 'loop', // loop|single|shuffle
  history: [],            // 随机模式下用于「上一首」回溯
  paneVisible: localStorage.getItem('wemusic_pane') !== 'false', // 记住视频浮窗展开/收起
};

// ---------------- 工具 ----------------
function fmtDur(sec) {
  sec = Number(sec) || 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
function fmtPlay(n) {
  n = Number(n) || 0;
  if (n >= 1e8) return (n / 1e8).toFixed(1) + '亿';
  if (n >= 1e4) return (n / 1e4).toFixed(1) + '万';
  return String(n);
}
function esc(str) {
  return String(str || '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])
  );
}
let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

function biliEmbed(bvid) {
  return `https://player.bilibili.com/player.html?bvid=${bvid}&autoplay=1&high_quality=1&danmaku=0&as_wide=1`;
}

// 专辑封面图（QQ 音乐）
function albumCover(albumMid, size = 300) {
  return albumMid ? `https://y.qq.com/music/photo_new/T002R${size}x${size}M000${albumMid}.jpg` : '';
}

// 歌单封面拼图（用前 4 张专辑封面拼成 2x2，不足用占位填充）
function playlistCoverHtml(mids = []) {
  const cells = [];
  for (let i = 0; i < 4; i++) {
    const mid = mids[i];
    cells.push(
      mid
        ? `<img src="${albumCover(mid, 150)}" loading="lazy" onerror="this.style.visibility='hidden'" />`
        : '<div class="ph">♪</div>'
    );
  }
  return `<div class="pl-grid-cover">${cells.join('')}</div>`;
}

// ---------------- 自定义输入/确认弹层（替代被预览环境拦截的原生 prompt/confirm） ----------------
function uiPrompt(title, defaultVal = '') {
  return new Promise((resolve) => {
    const mask = $('promptModal');
    const input = $('promptInput');
    $('promptTitle').textContent = title;
    input.value = defaultVal;
    mask.classList.add('show');
    setTimeout(() => { input.focus(); input.select(); }, 30);

    const done = (val) => {
      mask.classList.remove('show');
      $('promptOk').onclick = null;
      $('promptCancel').onclick = null;
      input.onkeydown = null;
      mask.onclick = null;
      resolve(val);
    };
    $('promptOk').onclick = () => done(input.value.trim() || null);
    $('promptCancel').onclick = () => done(null);
    mask.onclick = (e) => { if (e.target === mask) done(null); };
    input.onkeydown = (e) => {
      if (e.key === 'Enter') done(input.value.trim() || null);
      else if (e.key === 'Escape') done(null);
    };
  });
}

function uiConfirm(message) {
  return new Promise((resolve) => {
    const mask = $('promptModal');
    const input = $('promptInput');
    $('promptTitle').textContent = message;
    input.style.display = 'none';
    mask.classList.add('show');
    const done = (val) => {
      mask.classList.remove('show');
      input.style.display = '';
      $('promptOk').onclick = null;
      $('promptCancel').onclick = null;
      mask.onclick = null;
      document.removeEventListener('keydown', onKey);
      resolve(val);
    };
    const onKey = (e) => { if (e.key === 'Escape') done(false); };
    document.addEventListener('keydown', onKey);
    $('promptOk').onclick = () => done(true);
    $('promptCancel').onclick = () => done(false);
    mask.onclick = (e) => { if (e.target === mask) done(false); };
  });
}

// ---------------- 初始化 ----------------
async function init() {
  $('userName').textContent = Auth.user?.username || '';
  await loadPlaylists();
  renderHome();
  restoreSession();
}

$('logoutBtn').onclick = () => { Auth.clear(); location.href = '/login.html'; };

// ---------------- 主题切换（支持跟随系统） ----------------
const mq = window.matchMedia('(prefers-color-scheme: light)');
function applyTheme(theme) {
  const effective = theme === 'system' ? (mq.matches ? 'light' : 'dark') : theme;
  document.body.classList.toggle('light', effective === 'light');
  // 更新设置面板 active 状态（若已渲染）
  document.querySelectorAll('.theme-opt').forEach((b) => {
    b.classList.toggle('active', b.dataset.theme === theme);
  });
}
// 跟随系统时实时响应系统主题变化
mq.addEventListener('change', () => {
  if ((localStorage.getItem('wemusic_theme') || 'dark') === 'system') applyTheme('system');
});
applyTheme(localStorage.getItem('wemusic_theme') || 'dark');

// ---------------- 设置面板 ----------------
$('settingsBtn').onclick = openSettings;
$('settingsClose').onclick = () => $('settingsModal').classList.remove('show');
$('settingsModal').onclick = (e) => { if (e.target.id === 'settingsModal') $('settingsModal').classList.remove('show'); };
$('settingsLogout').onclick = () => { Auth.clear(); location.href = '/login.html'; };

function openSettings() {
  $('settingsUser').textContent = Auth.user?.username || '';
  // 主题按钮状态
  const curTheme = localStorage.getItem('wemusic_theme') || 'dark';
  document.querySelectorAll('.theme-opt').forEach((b) => {
    b.classList.toggle('active', b.dataset.theme === curTheme);
    b.onclick = () => {
      localStorage.setItem('wemusic_theme', b.dataset.theme);
      applyTheme(b.dataset.theme);
      document.querySelectorAll('.theme-opt').forEach((x) => x.classList.toggle('active', x === b));
    };
  });
  // 定时停止按钮状态
  updateSleepHint();
  document.querySelectorAll('.sleep-opt').forEach((b) => {
    b.classList.toggle('active', false);
    b.onclick = () => {
      setSleep(b.dataset.min);
      document.querySelectorAll('.sleep-opt').forEach((x) => x.classList.toggle('active', x === b));
    };
  });
  $('settingsModal').classList.add('show');
}

function updateSleepHint() {
  const hint = $('sleepHint');
  if (!hint) return;
  if (sleepAfterSong) { hint.textContent = '将在当前歌曲播完后停止'; return; }
  if (sleepTimeout) { hint.textContent = '定时已设置，播放中…'; return; }
  hint.textContent = '';
}

// ---------------- 侧边栏宽度拖拽 ----------------
(function sidebarResize() {
  const app = document.querySelector('.app');
  const resizer = $('sidebarResizer');
  const MIN = 180, MAX = 440;
  function apply(w) {
    app.style.setProperty('--side-w', w + 'px');
    resizer.style.left = w + 'px';
  }
  const saved = parseInt(localStorage.getItem('wemusic_sidebar') || '', 10);
  if (saved >= MIN && saved <= MAX) apply(saved);
  let dragging = false;
  resizer.addEventListener('mousedown', (e) => {
    if (window.innerWidth <= 720) return;
    dragging = true;
    resizer.classList.add('active');
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const w = Math.max(MIN, Math.min(MAX, e.clientX));
    apply(w);
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    resizer.classList.remove('active');
    document.body.style.userSelect = '';
    const w = parseInt(getComputedStyle(app).getPropertyValue('--side-w')) || 240;
    localStorage.setItem('wemusic_sidebar', String(w));
  });
})();

// ---------------- 定时关闭 ----------------
let sleepTimeout = null;
let sleepAfterSong = false;
function clearSleep() {
  if (sleepTimeout) { clearTimeout(sleepTimeout); sleepTimeout = null; }
  sleepAfterSong = false;
}
function stopPlayback() {
  destroyVideo();
  setStatus('已停止');
  // 定时停止后恢复标签页标题
  document.title = 'WeMusic · 个人音乐';
}
function setSleep(v) {
  clearSleep();
  if (v === '0') { toast('已取消定时关闭'); updateSleepHint(); return; }
  if (v === 'song') {
    sleepAfterSong = true;
    toast('将在当前歌曲播完后停止');
    updateSleepHint();
    return;
  }
  const min = Number(v);
  sleepTimeout = setTimeout(() => {
    stopPlayback();
    clearSleep();
    toast('定时已到，已停止播放');
  }, min * 60000);
  toast(`已设置 ${min} 分钟后停止`);
  updateSleepHint();
}

// ---------------- 歌单侧边栏 ----------------
// 全局歌曲索引：key = "歌名__歌手"，value = Set<playlistId>
// 供"已添加"标记与歌单选择器 ✓ 使用
state.songIndex = new Map(); // 懒初始化

let _indexBuilding = false;
let _indexDirty = true; // 标记索引是否需要重建

async function buildSongIndex() {
  if (_indexBuilding) return; // 防并发
  _indexBuilding = true;
  try {
    const results = await Promise.all(
      state.playlists.map((p) =>
        api(`/playlists/${p.id}/songs`).then((d) => ({ id: p.id, songs: d.songs || [] }))
      )
    );
    const idx = new Map();
    for (const { id, songs } of results) {
      for (const s of songs) {
        const k = `${s.name}__${s.singer || ''}`;
        if (!idx.has(k)) idx.set(k, new Set());
        idx.get(k).add(id);
      }
    }
    state.songIndex = idx;
    _indexDirty = false;
  } catch { /* 静默失败 */ }
  finally { _indexBuilding = false; }
}

/** 标记索引为脏，下次渲染歌曲列表时懒重建 */
function dirtyIndex() { _indexDirty = true; }

/**
 * 强制重建索引后立即刷新页面上所有可见歌曲行的书签标记。
 * 用于添加/删除歌曲后实时反馈。
 */
function refreshAllBookmarks() {
  buildSongIndex().then(() => {
    document.querySelectorAll('.song-list').forEach((list) => {
      const songs = list._songs;
      if (!songs) return;
      list.querySelectorAll('.song-row').forEach((row) => {
        const i = Number(row.dataset.i);
        const s = songs[i];
        if (!s) return;
        const ops = row.querySelector('.ops');
        if (!ops) return;
        // 歌单页（有 del 按钮）不显示书签
        const isPlaylistPage = !!ops.querySelector('[data-act="del"]');
        const inPls = songInPlaylists(s);
        const existing = ops.querySelector('.in-pl-mark');
        const showBadge = !isPlaylistPage && inPls.size > 0;
        if (showBadge && !existing) {
          const mark = document.createElement('span');
          mark.className = 'in-pl-mark';
          mark.title = `已在 ${inPls.size} 个歌单中`;
          mark.textContent = '🔖';
          ops.insertBefore(mark, ops.firstChild);
        } else if (!showBadge && existing) {
          existing.remove();
        } else if (existing && showBadge) {
          existing.title = `已在 ${inPls.size} 个歌单中`;
        }
      });
    });
  }).catch(() => {});
}

function songInPlaylists(song) {
  const k = `${song.name}__${song.singer || ''}`;
  return state.songIndex.get(k) || new Set();
}

async function loadPlaylists() {
  const { playlists } = await api('/playlists');
  state.playlists = playlists;
  if (!state.targetPlaylistId && playlists[0]) state.targetPlaylistId = playlists[0].id;
  renderSidebar();
  // 标脏，但不立即重建——等到真正需要渲染歌曲列表时才拉
  dirtyIndex();
}

function renderSidebar() {
  const box = $('playlistList');
  box.innerHTML = state.playlists
    .map(
      (p) => `
      <div class="playlist-item ${p.id === state.targetPlaylistId ? 'active' : ''}" data-id="${p.id}">
        <span class="pl-name">${esc(p.name)}</span>
        <span><span class="count">${p.count}</span> <span class="del" data-del="${p.id}">✕</span></span>
      </div>`
    )
    .join('');

  box.querySelectorAll('.playlist-item').forEach((el) => {
    const id = Number(el.dataset.id);
    el.onclick = (e) => {
      if (e.target.dataset.del) return;
      state.targetPlaylistId = id;
      renderSidebar();
      openPlaylist(id);
    };
    // 双击歌单名重命名
    const nameEl = el.querySelector('.pl-name');
    if (nameEl) {
      nameEl.title = '双击可重命名';
      nameEl.ondblclick = async (e) => {
        e.stopPropagation();
        const p = state.playlists.find((x) => x.id === id);
        const name = await uiPrompt('重命名歌单', p ? p.name : '');
        if (!name) return;
        await api(`/playlists/${id}`, { method: 'PUT', body: { name } });
        await loadPlaylists();
        if (state.view === 'playlist' && state.targetPlaylistId === id) openPlaylist(id);
      };
    }
  });
  box.querySelectorAll('.del').forEach((el) => {
    el.onclick = async (e) => {
      e.stopPropagation();
      const id = Number(el.dataset.del);
      const pl = state.playlists.find((x) => x.id === id);
      const cnt = pl ? pl.count : 0;
      if (!(await uiConfirm(`确定删除歌单「${pl ? pl.name : ''}」？${cnt ? `（含 ${cnt} 首歌曲）` : ''}此操作不可恢复`))) return;
      await api(`/playlists/${id}`, { method: 'DELETE' });
      const wasActive = state.targetPlaylistId === id;
      if (wasActive) state.targetPlaylistId = null;
      await loadPlaylists();
      // 如果当前正在查看被删歌单，或已无歌单，跳回首页
      if (wasActive || state.view === 'playlist') renderHome();
    };
  });
}

// 侧边栏导航
$('navHome').onclick = () => { renderHome(); $('navHome').classList.add('active'); $('navHistory').classList.remove('active'); };
$('navHistory').onclick = () => {
  activeTab = 'history';
  $('queueDrawer').classList.add('show');
  setTab('history');
  renderHistory();
};

$('newPlaylistBtn').onclick = async () => {
  const name = await uiPrompt('新歌单名称', '');
  if (!name) return;
  await api('/playlists', { method: 'POST', body: { name } });
  await loadPlaylists();
  toast('歌单已创建');
};

// ---------------- 首页 / 导入区 ----------------
function renderHome() {
  state.view = 'home';
  $('main').innerHTML = `
    <div class="view-title">导入与管理</div>
    <div class="view-sub">从 QQ 音乐导入歌单，或在上方搜索歌手批量添加</div>
    <div class="toolbar">
      <input id="qqUrl" placeholder="粘贴 QQ 音乐歌单链接，例如 https://y.qq.com/n/ryqq/playlist/xxxx" />
      <button class="btn green" id="parseBtn">解析歌单</button>
    </div>
    <div id="homeResult" class="empty">解析结果将显示在这里</div>
  `;
  $('parseBtn').onclick = parsePlaylistFlow;
  $('qqUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') parsePlaylistFlow(); });
}

async function parsePlaylistFlow() {
  const url = $('qqUrl').value.trim();
  if (!url) return toast('请粘贴歌单链接');
  const box = $('homeResult');
  box.className = 'loading';
  box.textContent = '正在解析歌单...';
  try {
    const data = await api('/music/parse-playlist', { method: 'POST', body: { url } });
    box.className = '';
    box.innerHTML = `
      <div class="section-head">
        <h2>${esc(data.name)}（${data.songs.length} 首）</h2>
        <button class="btn green sm" id="addAllParsed">全部添加到歌单</button>
      </div>
      <div class="song-list" id="parsedList"></div>`;
    renderSongList($('parsedList'), data.songs, { showAdd: true });
    $('addAllParsed').onclick = () => addSongs(data.songs);
  } catch (e) {
    box.className = 'empty';
    box.textContent = '解析失败：' + e.message;
  }
}

// ---------------- 搜索历史 / 建议 ----------------
function getSearchHistory() {
  try { return JSON.parse(localStorage.getItem('wemusic_search_hist') || '[]'); }
  catch { return []; }
}
function pushSearchHistory(kw) {
  if (!kw) return;
  let h = getSearchHistory().filter((x) => x !== kw);
  h.unshift(kw);
  h = h.slice(0, 12);
  localStorage.setItem('wemusic_search_hist', JSON.stringify(h));
}
function removeSearchHistory(kw) {
  const h = getSearchHistory().filter((x) => x !== kw);
  localStorage.setItem('wemusic_search_hist', JSON.stringify(h));
}
function clearSearchHistory() {
  localStorage.removeItem('wemusic_search_hist');
}

function renderSuggest() {
  const box = $('searchSuggest');
  const q = $('searchInput').value.trim().toLowerCase();
  const hist = getSearchHistory();
  const list = q ? hist.filter((x) => x.toLowerCase().includes(q)) : hist;
  if (list.length === 0 && !q) { box.classList.remove('show'); return; }
  if (list.length === 0 && q) {
    // 有输入内容但无历史匹配：隐藏下拉，直接回车搜索即可
    box.classList.remove('show');
    return;
  }
  box.innerHTML =
    `<div class="ss-head"><span>搜索历史</span><span class="ss-clear" id="ssClear">清空</span></div>` +
    list
      .map(
        (k) => `<div class="ss-row" data-k="${esc(k)}">
          <span class="ss-icon">🕘</span>
          <span class="ss-key">${esc(k)}</span>
          <span class="ss-del" data-del="${esc(k)}" title="删除">✕</span>
        </div>`
      )
      .join('');
  box.classList.add('show');
  $('ssClear').onclick = () => { clearSearchHistory(); box.classList.remove('show'); };
  box.querySelectorAll('.ss-row').forEach((row) => {
    // 删除按钮单独绑定，避免 esc() 转义导致 key 不匹配
    const delEl = row.querySelector('.ss-del');
    if (delEl) {
      delEl.onclick = (e) => {
        e.stopPropagation();
        removeSearchHistory(row.dataset.k); // 使用原始 key（row.dataset.k 是原始值）
        renderSuggest();
      };
    }
    row.onclick = (e) => {
      if (e.target.classList.contains('ss-del')) return;
      $('searchInput').value = row.dataset.k;
      box.classList.remove('show');
      doSearch();
    };
  });
}

// ---------------- 搜索 ----------------
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

async function doSearch() {
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
    const totalNote = isSingerResult
      ? `已加载 ${data.songs.length} / ${data.total || '?'} 首`
      : `${data.songs.length} 首`;
    let html = `<div class="view-title">搜索：${esc(keyword)}</div>`;
    if (isSingerResult) {
      html += `
        <div class="singer-card">
          <div class="info">
            <h3>歌手 · ${esc(data.singer.name)}</h3>
            <p>查看 TA 的全部歌曲与专辑，可一键批量添加</p>
          </div>
          <button class="btn green" id="openArtistBtn">进入歌手页</button>
        </div>`;
    }
    html += `<div class="section-head"><h2>${isSingerResult ? '歌手歌曲' : '单曲'}（${totalNote}）</h2></div>
             ${data.songs.length ? listToolsHtml() : ''}
             <div class="song-list" id="searchSongs"></div>`;
    main.innerHTML = html;
    const sContainer = $('searchSongs');
    const songBuf = [...data.songs];
    renderSongList(sContainer, songBuf, { showAdd: true });
    bindListTools(main, songBuf, sContainer, null, null);
    // 如果是歌手结果且还有更多，追加"加载更多"按钮
    if (isSingerResult && data.hasMore !== false) {
      appendLoadMore(main, sContainer, songBuf, data.singer, data.total);
    }
    if (isSingerResult) {
      $('openArtistBtn').onclick = () => openArtist(data.singer.mid, data.singer.name);
    }
  } catch (e) {
    main.innerHTML = `<div class="empty">搜索失败：${esc(e.message)}</div>`;
  }
}

/** 在歌曲列表底部附加"加载更多"按钮（搜索页和歌手页共用） */
function appendLoadMore(main, container, songBuf, singer, total) {
  let begin = songBuf.length;
  const wrap = document.createElement('div');
  wrap.className = 'load-more-wrap';
  wrap.id = 'loadMoreWrap';
  const btn = document.createElement('button');
  btn.className = 'btn sm load-more-btn';
  btn.id = 'loadMoreBtn';
  btn.textContent = `加载更多（已加载 ${begin} / ${total || '?'} 首）`;
  wrap.appendChild(btn);
  main.appendChild(wrap);

  btn.onclick = async () => {
    btn.disabled = true;
    btn.textContent = '加载中…';
    try {
      const res = await api(
        `/music/artist?mid=${encodeURIComponent(singer.mid)}&name=${encodeURIComponent(singer.name || '')}&begin=${begin}`
      );
      const newSongs = res.songs || [];
      if (newSongs.length === 0) { wrap.remove(); return; }
      // 追加到 songBuf（保持引用一致，播放队列不受影响）
      const prevLen = songBuf.length;
      songBuf.push(...newSongs);
      begin = songBuf.length;
      // 只追加新行（不重建全表，避免工具条重复绑定、滚动位置跳动）
      const frag = document.createDocumentFragment();
      newSongs.forEach((s, j) => {
        const i = prevLen + j;
        const inPls = songInPlaylists(s);
        const bookmark = inPls.size > 0
          ? `<span class="in-pl-mark" title="已在 ${inPls.size} 个歌单中">🔖</span>` : '';
        const div = document.createElement('div');
        div.className = 'song-row';
        div.dataset.i = String(i);
        div.innerHTML = `
          <span class="idx">${i + 1}</span>
          <span class="name">${esc(s.name)}</span>
          <span class="singer">${esc(s.singer)}</span>
          <span class="album">${esc(s.album)}</span>
          <span class="dur">${fmtDur(s.duration)}</span>
          <span class="ops">
            ${bookmark}
            <button class="icon-btn play" title="播放" data-act="play">▶</button>
            <button class="icon-btn" title="添加到歌单" data-act="add">＋</button>
          </span>`;
        div.onclick = () => playFromList(songBuf, i, null, null);
        div.querySelectorAll('[data-act]').forEach((btn) => {
          btn.onclick = (ev) => {
            ev.stopPropagation();
            if (btn.dataset.act === 'play') playFromList(songBuf, i, null, null);
            else if (btn.dataset.act === 'add') addSongs([songBuf[i]]);
          };
        });
        div.oncontextmenu = (ev) => { ev.preventDefault(); openSongMenu(ev, songBuf, i, null, null, div); };
        frag.appendChild(div);
      });
      container.appendChild(frag);
      container._songs = songBuf; // 保持引用同步
      // 更新计数标题
      const h2 = main.querySelector('.section-head h2');
      if (h2) h2.textContent = h2.textContent.replace(/已加载 \d+/, `已加载 ${begin}`);
      if (res.hasMore === false || begin >= (res.total || begin)) {
        wrap.remove();
      } else {
        btn.disabled = false;
        btn.textContent = `加载更多（已加载 ${begin} / ${res.total || '?'} 首）`;
      }
    } catch (e) {
      btn.disabled = false;
      btn.textContent = '加载失败，点击重试';
      toast('加载失败：' + e.message);
    }
  };
}

// ---------------- 歌手页 ----------------
async function openArtist(mid, name) {
  state.view = 'artist';
  const main = $('main');
  main.innerHTML = `<div class="loading">加载歌手「${esc(name)}」...</div>`;
  try {
    const data = await api(
      `/music/artist?mid=${encodeURIComponent(mid)}&name=${encodeURIComponent(name || '')}`
    );
    const songBuf = [...data.songs];
    const totalNote = `已加载 ${songBuf.length} / ${data.total || '?'} 首`;
    let html = `
      <div class="singer-card">
        <div class="info">
          <h3>${esc(data.singer.name)}</h3>
          <p>共 ${data.total} 首歌曲 · ${data.albums.length} 张专辑</p>
        </div>
        <button class="btn green" id="addAllSongs">添加已加载歌曲</button>
      </div>
      <div class="section-head"><h2>歌曲（${totalNote}）</h2></div>
      ${data.songs.length ? listToolsHtml() : ''}
      <div class="song-list" id="artistSongs"></div>
      <div class="section-head"><h2>专辑（${data.albums.length}）</h2></div>
      <div class="album-grid" id="artistAlbums"></div>`;
    main.innerHTML = html;
    const aContainer = $('artistSongs');
    renderSongList(aContainer, songBuf, { showAdd: true });
    bindListTools(main, songBuf, aContainer, null, null);
    $('addAllSongs').onclick = () => addSongs(songBuf);
    if (data.hasMore !== false) {
      appendLoadMore(main, aContainer, songBuf, data.singer, data.total);
    }

    const grid = $('artistAlbums');
    grid.innerHTML = data.albums
      .map(
        (a) => `
        <div class="album-card" data-mid="${esc(a.album_mid)}" data-name="${esc(a.name)}">
          <div class="cover">${a.album_mid ? `<img class="cover-img" src="${albumCover(a.album_mid)}" loading="lazy" onerror="this.remove()" />` : '♪'}</div>
          <div class="a-name">${esc(a.name)}</div>
          <div class="a-time">${esc(a.pub_time || '')}</div>
        </div>`
      )
      .join('') || '<div class="empty">暂无专辑</div>';
    grid.querySelectorAll('.album-card').forEach((el) => {
      el.onclick = () => openAlbum(el.dataset.mid, el.dataset.name);
    });
  } catch (e) {
    main.innerHTML = `<div class="empty">加载失败：${esc(e.message)}</div>`;
  }
}

// ---------------- 专辑页 ----------------
async function openAlbum(mid, name) {
  state.view = 'album';
  const main = $('main');
  main.innerHTML = `<div class="loading">加载专辑「${esc(name)}」...</div>`;
  try {
    const data = await api(`/music/album?mid=${encodeURIComponent(mid)}`);
    main.innerHTML = `
      <div class="view-title">专辑 · ${esc(data.album || name)}</div>
      <div class="view-sub">${data.songs.length} 首</div>
      <div class="section-head">
        <h2>曲目</h2>
        <button class="btn green sm" id="addAlbumAll">整张添加</button>
      </div>
      ${data.songs.length ? listToolsHtml() : ''}
      <div class="song-list" id="albumSongs"></div>`;
    const albContainer = $('albumSongs');
    renderSongList(albContainer, data.songs, { showAdd: true });
    bindListTools(main, data.songs, albContainer, null, null);
    $('addAlbumAll').onclick = () => addSongs(data.songs);
  } catch (e) {
    main.innerHTML = `<div class="empty">加载失败：${esc(e.message)}</div>`;
  }
}

// ---------------- 歌单详情 ----------------
async function openPlaylist(id) {
  state.view = 'playlist';
  const main = $('main');
  main.innerHTML = `<div class="loading">加载歌单...</div>`;
  try {
    const data = await api(`/playlists/${id}/songs`);
    const totalSec = data.songs.reduce((acc, s) => acc + (Number(s.duration) || 0), 0);
    const coverMids = [...new Set(data.songs.map((s) => s.album_mid).filter(Boolean))].slice(0, 4);
    main.innerHTML = `
      <div class="pl-header">
        <div class="pl-cover-wrap">${playlistCoverHtml(coverMids)}</div>
        <div class="pl-meta">
          <div class="view-title">${esc(data.playlist.name)}</div>
          <div class="view-sub">${data.songs.length} 首 · 总时长 ${fmtTotal(totalSec)} · 点击播放自动从 Bilibili 匹配</div>
          <div class="section-head" style="margin:12px 0 0">
            <button class="btn sm" id="exportPlBtn">⤓ 导出歌单</button>
          </div>
        </div>
      </div>
      ${data.songs.length ? listToolsHtml() : ''}
      <div class="song-list" id="plSongs"></div>`;
    $('exportPlBtn').onclick = () => exportPlaylist(id, data.playlist.name);
    if (data.songs.length === 0) {
      $('plSongs').innerHTML = '<div class="empty">歌单还是空的，去搜索添加歌曲吧</div>';
      return; // 歌单为空时提前返回，下面的 renderSongList 不会执行，逻辑正确
    }
    const container = $('plSongs');
    renderSongList(container, data.songs, { showDelete: true, playlistId: id, context: 'playlist' });
    bindListTools(main, data.songs, container, 'playlist', id);
  } catch (e) {
    main.innerHTML = `<div class="empty">加载失败：${esc(e.message)}</div>`;
  }
}

// ---------------- 歌曲列表渲染 ----------------
function renderSongList(container, songs, opts = {}) {
  // 索引脏时后台静默重建，先置 false 防止重复触发
  if (_indexDirty) { _indexDirty = false; buildSongIndex().then(() => refreshAllBookmarks()).catch(() => {}); }

  const { showAdd = false, showDelete = false, playlistId = null, context = null } = opts;
  container.innerHTML = songs
    .map((s, i) => {
      const inPls = songInPlaylists(s);
      // 书签标记：非歌单页且已加入过任意歌单时显示
      const bookmark = (!showDelete && inPls.size > 0)
        ? `<span class="in-pl-mark" title="已在 ${inPls.size} 个歌单中">🔖</span>`
        : '';
      return `
      <div class="song-row" data-i="${i}">
        <span class="idx">${i + 1}</span>
        <span class="name">${esc(s.name)}</span>
        <span class="singer">${esc(s.singer)}</span>
        <span class="album">${esc(s.album)}</span>
        <span class="dur">${fmtDur(s.duration)}</span>
        <span class="ops">
          ${bookmark}
          <button class="icon-btn play" title="播放" data-act="play">▶</button>
          ${showAdd ? '<button class="icon-btn" title="添加到歌单" data-act="add">＋</button>' : ''}
          ${showDelete ? '<button class="icon-btn" title="从歌单移除" data-act="del">✕</button>' : ''}
        </span>
      </div>`;
    })
    .join('');

  container.querySelectorAll('.song-row').forEach((row) => {
    const i = Number(row.dataset.i);
    // 整行点击即播放（操作按钮通过 stopPropagation 避免触发）
    row.onclick = () => playFromList(songs, i, context, playlistId);
    row.querySelectorAll('[data-act]').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const act = btn.dataset.act;
        if (act === 'play') playFromList(songs, i, context, playlistId);
        else if (act === 'add') addSongs([songs[i]]);
        else if (act === 'del') deleteSong(playlistId, songs[i].id, row);
      };
    });
    // 右键菜单
    row.oncontextmenu = (e) => {
      e.preventDefault();
      openSongMenu(e, songs, i, context, playlistId, row);
    };
  });
  container._songs = songs;

  // 歌单视图支持拖拽排序
  if (context === 'playlist') enableRowDrag(container, songs, playlistId);
}

// 拖拽排序
function enableRowDrag(container, songs, playlistId) {
  let fromIdx = -1;
  container.querySelectorAll('.song-row').forEach((row) => {
    row.setAttribute('draggable', 'true');
    row.addEventListener('dragstart', (e) => {
      fromIdx = Number(row.dataset.i);
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      container.querySelectorAll('.drag-over').forEach((r) => r.classList.remove('drag-over'));
    });
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      row.classList.add('drag-over');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      row.classList.remove('drag-over');
      const toIdx = Number(row.dataset.i);
      if (fromIdx < 0 || fromIdx === toIdx) return;
      const [moved] = songs.splice(fromIdx, 1);
      songs.splice(toIdx, 0, moved);
      renderSongList(container, songs, { showDelete: true, playlistId, context: 'playlist' });
      // 同步当前播放索引
      if (state.queue === songs && state.current) {
        const ni = songs.indexOf(state.current);
        if (ni >= 0) state.queueIndex = ni;
      }
      highlightPlaying();
      saveSession();
      api(`/playlists/${playlistId}/reorder`, {
        method: 'PUT',
        body: { orderedIds: songs.map((s) => s.id) },
      }).catch(() => {});
    });
  });
}

// ---------------- 添加到歌单（选择器） ----------------
let pendingAddSongs = null;

function addSongs(songs) {
  if (!songs || songs.length === 0) return toast('没有可添加的歌曲');
  pendingAddSongs = songs;
  openAddModal();
}

function openAddModal() {
  // 计算 pendingAddSongs 里每首歌已在哪些歌单
  const pendingKeys = (pendingAddSongs || []).map((s) => `${s.name}__${s.singer || ''}`);
  const list = $('addList');
  list.innerHTML =
    state.playlists
      .map((p) => {
        // 当前歌单中已包含所有待添加歌曲时显示 ✓，部分包含时显示 •
        const contained = pendingKeys.filter((k) => {
          const pls = state.songIndex.get(k);
          return pls && pls.has(p.id);
        }).length;
        const all = pendingKeys.length > 0 && contained === pendingKeys.length;
        const some = contained > 0 && !all;
        const badge = all
          ? '<span class="add-pl-check all" title="全部已在此歌单">✓</span>'
          : some
          ? `<span class="add-pl-check some" title="${contained}/${pendingKeys.length} 首已在此歌单">•</span>`
          : '';
        return `<div class="add-pl-row" data-id="${p.id}">
          <span>${esc(p.name)}</span>
          <span class="add-pl-meta">${badge}<span class="count">${p.count} 首</span></span>
        </div>`;
      })
      .join('') || '<div class="empty">还没有歌单，点下方新建</div>';
  $('addModal').classList.add('show');
  list.querySelectorAll('.add-pl-row').forEach((el) => {
    el.onclick = () => commitAdd(Number(el.dataset.id));
  });
}

async function commitAdd(playlistId) {
  const songs = pendingAddSongs;
  if (!songs) return;
  $('addModal').classList.remove('show');
  try {
    const r = await api(`/playlists/${playlistId}/songs`, { method: 'POST', body: { songs } });
    const p = state.playlists.find((x) => x.id === playlistId);
    toast(`已添加 ${r.added} 首${r.skipped ? `，跳过 ${r.skipped} 首重复` : ''} → ${p ? p.name : ''}`);
    await loadPlaylists();
    // 强制重建索引并立即刷新所有可见歌曲行的书签（实时反馈）
    refreshAllBookmarks();
    if (state.view === 'playlist' && state.targetPlaylistId === playlistId) openPlaylist(playlistId);
  } catch (e) {
    toast('添加失败：' + e.message);
  } finally {
    pendingAddSongs = null;
  }
}

$('addClose').onclick = () => { $('addModal').classList.remove('show'); pendingAddSongs = null; };
$('addModal').onclick = (e) => {
  if (e.target.id === 'addModal') { $('addModal').classList.remove('show'); pendingAddSongs = null; }
};
$('addNewPl').onclick = async () => {
  const name = await uiPrompt('新歌单名称', '');
  if (!name) return;
  const res = await api('/playlists', { method: 'POST', body: { name } });
  await loadPlaylists();
  commitAdd(res.id); // 新建后直接加入
};

// ---------------- 导出 / 导入歌单 ----------------
async function exportPlaylist(id, name) {
  try {
    const data = await api(`/playlists/${id}/export`);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `WeMusic-${(name || '歌单').replace(/[\\/:*?"<>|]/g, '_')}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('已导出 JSON 备份');
  } catch (e) {
    toast('导出失败：' + e.message);
  }
}

$('importPlBtn').onclick = () => $('importFile').click();
$('importFile').onchange = async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = ''; // 允许重复选同一文件
  if (!file) return;
  try {
    const text = await file.text();
    const json = JSON.parse(text);
    const songs = Array.isArray(json.songs) ? json.songs : [];
    if (songs.length === 0) return toast('文件中没有歌曲数据');
    const defName = json.name || file.name.replace(/\.json$/i, '');
    const name = await uiPrompt('导入为新歌单，名称：', defName);
    if (!name) return;
    const res = await api('/playlists/import', { method: 'POST', body: { name, songs } });
    await loadPlaylists();
    state.targetPlaylistId = res.id;
    renderSidebar();
    openPlaylist(res.id);
    toast(`已导入 ${res.added} 首到「${res.name}」`);
  } catch (err) {
    toast('导入失败：文件格式不正确');
  }
};

// 播放整个列表（顺序 / 随机）
function playAll(songs, context, playlistId, shuffle = false) {
  if (!songs || songs.length === 0) return toast('列表为空');
  if (shuffle && state.playMode !== 'shuffle') {
    state.playMode = 'shuffle';
    localStorage.setItem('wemusic_mode', 'shuffle');
    renderMode();
  }
  state.history = []; // 切换新列表时清空随机回溯历史
  const start = shuffle ? Math.floor(Math.random() * songs.length) : 0;
  playFromList(songs, start, context, playlistId);
}

// 列表内过滤（仅隐藏不匹配行，不重建，保证播放索引有效）
function attachFilter(inputEl, container) {
  if (!inputEl || !container) return;
  inputEl.addEventListener('input', () => {
    const q = inputEl.value.trim().toLowerCase();
    container.querySelectorAll('.song-row').forEach((row) => {
      const name = row.querySelector('.name')?.textContent || '';
      const singer = row.querySelector('.singer')?.textContent || '';
      const hit = !q || (name + ' ' + singer).toLowerCase().includes(q);
      row.style.display = hit ? '' : 'none';
    });
  });
}

// 列表工具条 HTML（播放全部 / 随机 / 过滤）
function listToolsHtml() {
  return `
    <div class="list-tools">
      <button class="btn green sm" data-tool="playall">▶ 播放全部</button>
      <button class="btn sm" data-tool="shuffle">🔀 随机播放</button>
      <input class="filter-input" data-tool="filter" placeholder="在列表中筛选…" />
    </div>`;
}

// 绑定列表工具条
function bindListTools(scopeEl, songs, container, context, playlistId) {
  const playBtn = scopeEl.querySelector('[data-tool="playall"]');
  const shuffleBtn = scopeEl.querySelector('[data-tool="shuffle"]');
  const filterEl = scopeEl.querySelector('[data-tool="filter"]');
  if (playBtn) playBtn.onclick = () => playAll(songs, context, playlistId, false);
  if (shuffleBtn) shuffleBtn.onclick = () => playAll(songs, context, playlistId, true);
  attachFilter(filterEl, container);
}

function fmtTotal(sec) {
  sec = Number(sec) || 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h} 小时 ${m} 分`;
  return `${m} 分`;
}

async function deleteSong(playlistId, songId, row) {
  try {
    await api(`/playlists/${playlistId}/songs/${songId}`, { method: 'DELETE' });
    row.remove();
    await loadPlaylists();
    refreshAllBookmarks();
    // 刷新歌单头部统计（首 / 总时长），无需重新渲染整个列表
    const sub = document.querySelector('.view-sub');
    if (sub && state.view === 'playlist') {
      const container = $('plSongs');
      if (container) {
        const remaining = container._songs || [];
        const totalSec = remaining.reduce((acc, s) => acc + (Number(s.duration) || 0), 0);
        sub.textContent = `${remaining.length} 首 · 总时长 ${fmtTotal(totalSec)} · 点击播放自动从 Bilibili 匹配`;
      }
    }
  } catch (e) {
    toast('删除失败：' + e.message);
  }
}

// ---------------- 歌曲右键菜单 ----------------
function closeCtxMenu() { $('ctxMenu').classList.remove('show'); }
document.addEventListener('click', closeCtxMenu);
document.addEventListener('scroll', closeCtxMenu, true);

function openSongMenu(evt, songs, i, context, playlistId, row) {
  const song = songs[i];
  if (!song) return;
  const menu = $('ctxMenu');
  const inPlaylist = context === 'playlist';
  const items = [
    { label: '▶ 播放', act: 'play' },
    { label: '＋ 添加到歌单', act: 'add' },
    { sep: true },
    { label: '🔗 复制 Bilibili 链接', act: 'copy', dim: !song.bvid, dimTip: '请先播放一次以匹配资源' },
    { label: '🔍 在 Bilibili 搜索此歌', act: 'search' },
  ];
  if (inPlaylist) {
    items.push({ sep: true }, { label: '✕ 从歌单移除', act: 'del', danger: true });
  }
  menu.innerHTML = items
    .map((it) =>
      it.sep
        ? '<div class="ctx-sep"></div>'
        : `<div class="ctx-item${it.danger ? ' danger' : ''}${it.dim ? ' dim' : ''}" data-act="${it.act}"${it.dimTip ? ` data-dim-tip="${esc(it.dimTip)}"` : ''}>${it.label}</div>`
    )
    .join('');
  menu.classList.add('show');
  // 定位（避免溢出视口）
  const mw = menu.offsetWidth || 170;
  const mh = menu.offsetHeight || 200;
  let x = evt.clientX, y = evt.clientY;
  if (x + mw > window.innerWidth) x = window.innerWidth - mw - 8;
  if (y + mh > window.innerHeight) y = window.innerHeight - mh - 8;
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';

  menu.querySelectorAll('.ctx-item').forEach((el) => {
    el.onclick = async (e) => {
      e.stopPropagation();
      // dim 状态：给出友好提示而非静默无响应
      if (el.classList.contains('dim')) {
        closeCtxMenu();
        toast(el.dataset.dimTip || '暂不可用');
        return;
      }
      closeCtxMenu();
      const act = el.dataset.act;
      if (act === 'play') playFromList(songs, i, context, playlistId);
      else if (act === 'add') addSongs([song]);
      else if (act === 'del') deleteSong(playlistId, song.id, row);
      else if (act === 'copy') copyBiliLink(song);
      else if (act === 'search') {
        const kw = `${song.name} ${(song.singer || '').split('/')[0]}`.trim();
        window.open(`https://search.bilibili.com/all?keyword=${encodeURIComponent(kw)}`, '_blank');
      }
    };
  });
}

async function copyBiliLink(song) {
  if (!song.bvid) return toast('该歌曲尚未匹配资源，先播放一次');
  const link = `https://www.bilibili.com/video/${song.bvid}`;
  try {
    await navigator.clipboard.writeText(link);
    toast('已复制 Bilibili 链接');
  } catch {
    // 回退：用临时输入框
    const ta = document.createElement('textarea');
    ta.value = link;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('已复制 Bilibili 链接'); }
    catch { toast('复制失败：' + link); }
    ta.remove();
  }
}

// ---------------- 播放核心（Bilibili 官方播放器） ----------------
// 说明：B 站音频流接口对游客有 412 风控、无法稳定取流，故统一用官方 iframe 播放器
// （自带音量/进度/全屏）。「收起」只隐藏画面、保留 iframe 存活，声音不中断。
// 自动连播由歌曲时长计时器驱动。
let autoTimer = null;
let elapsed = 0;
let totalDur = 0;
let timerPaused = false;
let playSeq = 0; // 播放序号：防止快速切歌时过期的匹配结果覆盖当前播放

// 进度条与音量改由浮窗内官方播放器控制，底栏隐藏对应控件
const volWrap = document.querySelector('.volume-wrap');
if (volWrap) volWrap.style.display = 'none';
$('seekBar').disabled = true;

function setStatus(html) { $('playStatus').innerHTML = html; }

async function playFromList(songs, index, context, playlistId) {
  state.queue = songs;
  state.queueIndex = index;
  state.currentContext = context === 'playlist' ? playlistId : null;
  await playCurrent();
}

async function playCurrent() {
  stopTimer();
  const song = state.queue[state.queueIndex];
  if (!song) return;
  const seq = ++playSeq; // 标记本次播放
  state.current = song;
  highlightPlaying();
  $('npTitle').textContent = song.name;
  $('npSinger').textContent = song.singer || '';
  document.title = `${song.name}${song.singer ? ' · ' + song.singer.split('/')[0] : ''} — WeMusic`;
  updateNpCover(song);
  resetProgress(song.duration);

  if (!song.bvid) {
    setStatus('正在从 Bilibili 匹配资源…');
    try {
      const { best, candidates } = await api('/play/resolve', {
        method: 'POST',
        body: { name: song.name, singer: song.singer, duration: song.duration },
      });
      if (seq !== playSeq) return; // 已切到别的歌，丢弃过期结果
      song._candidates = candidates;
      if (!best) { setStatus('未找到合适资源，可点「换源」'); return; }
      song.bvid = best.bvid;
      song._biliTitle = best.title;
      song._biliDur = best.duration || song.duration;
      cacheBvid(song);
    } catch (e) {
      if (seq !== playSeq) return;
      setStatus('匹配失败：' + esc(e.message));
      return;
    }
  }
  if (seq !== playSeq) return;
  startVideo(song.bvid, song._biliTitle, song._biliDur || song.duration);
}

// 用官方 iframe 播放器播放，并启动连播计时
function startVideo(bvid, title, dur) {
  mountVideo(bvid, title);
  applyPaneVisibility(); // 按记住的展开/收起偏好显示，不强制弹出
  $('vpTitle').textContent = title || 'Bilibili';
  setStatus(`<span class="badge">▶ Bilibili</span> ${esc((title || '').slice(0, 26))}`);
  startTimer(dur);
  saveSession();
  pushPlayHistory(state.current);
  if ($('queueDrawer').classList.contains('show')) renderActiveTab();
}

// ---- 播放历史记录 ----
function getPlayHistory() {
  try { return JSON.parse(localStorage.getItem('wemusic_play_hist') || '[]'); }
  catch { return []; }
}
function pushPlayHistory(song) {
  if (!song || !song.name) return;
  const item = {
    song_mid: song.song_mid, name: song.name, singer: song.singer,
    album: song.album, album_mid: song.album_mid, duration: song.duration,
    bvid: song.bvid, _biliTitle: song._biliTitle, _biliDur: song._biliDur,
    at: Date.now(),
  };
  let h = getPlayHistory().filter((x) => `${x.name}__${x.singer || ''}` !== `${item.name}__${item.singer || ''}`);
  h.unshift(item);
  h = h.slice(0, 100);
  localStorage.setItem('wemusic_play_hist', JSON.stringify(h));
  if ($('queueDrawer').classList.contains('show') && activeTab === 'history') renderHistory();
}

// 按偏好显示/隐藏浮窗（iframe 始终挂载，隐藏时音频继续）
function applyPaneVisibility() {
  const pane = $('videoPane');
  const mounted = $('videoContainer').children.length > 0;
  if (state.paneVisible && mounted) pane.classList.add('show');
  else pane.classList.remove('show');
  $('videoBtn').textContent = mounted ? (state.paneVisible ? '收起' : '展开') : '看视频';
}

function setPaneVisible(v) {
  state.paneVisible = v;
  localStorage.setItem('wemusic_pane', String(v));
  applyPaneVisibility();
}

// ---- 上次播放会话 持久化/恢复 ----
function saveSession() {
  try {
    const q = state.queue.slice(0, 800).map((s) => ({
      id: s.id, song_mid: s.song_mid, name: s.name, singer: s.singer,
      album: s.album, album_mid: s.album_mid, duration: s.duration, bvid: s.bvid,
      _biliTitle: s._biliTitle, _biliDur: s._biliDur,
    }));
    localStorage.setItem('wemusic_session', JSON.stringify({
      queue: q, queueIndex: state.queueIndex, currentContext: state.currentContext,
    }));
  } catch { /* 忽略存储异常 */ }
}

function restoreSession() {
  try {
    const s = JSON.parse(localStorage.getItem('wemusic_session') || 'null');
    if (!s || !Array.isArray(s.queue) || s.queue.length === 0) return;
    state.queue = s.queue;
    state.queueIndex = s.queueIndex >= 0 && s.queueIndex < s.queue.length ? s.queueIndex : 0;
    state.currentContext = s.currentContext || null;
    state.current = state.queue[state.queueIndex];
    if (state.current) {
      $('npTitle').textContent = state.current.name;
      $('npSinger').textContent = state.current.singer || '';
      updateNpCover(state.current);
      $('durTime').textContent = fmtDur(state.current._biliDur || state.current.duration);
      setStatus('上次播放 · 点 ▶ 继续');
    }
  } catch { /* 忽略 */ }
}

function destroyVideo() {
  $('videoPane').classList.remove('show', 'fullscreen');
  $('videoContainer').innerHTML = '';
  stopTimer();
}

function cacheBvid(song) {
  if (state.currentContext && song.id) {
    api(`/playlists/${state.currentContext}/songs/${song.id}/bvid`, {
      method: 'PUT', body: { bvid: song.bvid },
    }).catch(() => {});
  }
}

function mountVideo(bvid, title) {
  $('vpTitle').textContent = title || 'Bilibili 播放';
  $('videoContainer').innerHTML =
    `<iframe src="${biliEmbed(bvid)}" allowfullscreen scrolling="no" frameborder="0"></iframe>`;
}

// 更新底栏正在播放封面
function updateNpCover(song) {
  const npc = $('npCover');
  const url = albumCover(song && song.album_mid, 150);
  if (url) {
    const img = new Image();
    img.onload = () => { npc.style.backgroundImage = `url(${url})`; npc.classList.add('show'); };
    img.onerror = () => { npc.classList.remove('show'); npc.style.backgroundImage = ''; };
    img.src = url;
  } else {
    npc.classList.remove('show');
    npc.style.backgroundImage = '';
  }
}

function highlightPlaying() {
  document.querySelectorAll('.song-row.playing').forEach((r) => r.classList.remove('playing'));
  if (!state.current) return;
  const curKey = `${state.current.name}__${state.current.singer || ''}`;
  document.querySelectorAll('.song-list').forEach((list) => {
    // 方式1：引用相同（歌单/队列）→ 精确按索引高亮
    if (list._songs === state.queue) {
      const row = list.querySelector(`.song-row[data-i="${state.queueIndex}"]`);
      if (row) {
        row.classList.add('playing');
        try { row.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch {}
      }
      return;
    }
    // 方式2：不同引用（搜索/歌手/专辑页）→ 按歌名+歌手匹配高亮
    const rows = list.querySelectorAll('.song-row');
    rows.forEach((row) => {
      const i = Number(row.dataset.i);
      const s = list._songs && list._songs[i];
      if (s && `${s.name}__${s.singer || ''}` === curKey) {
        row.classList.add('playing');
      }
    });
  });
}

// ---- 进度显示与自动连播计时 ----
function resetProgress(d) {
  elapsed = 0;
  totalDur = Number(d) || 0;
  timerPaused = false;
  $('curTime').textContent = '0:00';
  $('durTime').textContent = fmtDur(totalDur);
  $('seekBar').value = 0;
}
function startTimer(d) {
  stopTimer();
  totalDur = Number(d) || totalDur || (state.current && state.current.duration) || 0;
  $('durTime').textContent = fmtDur(totalDur);
  timerPaused = false;
  $('playPauseBtn').textContent = '⏸';
  autoTimer = setInterval(() => {
    if (timerPaused) return;
    elapsed++;
    $('curTime').textContent = fmtDur(elapsed);
    if (totalDur > 0) {
      $('seekBar').value = Math.min(1000, Math.round((elapsed / totalDur) * 1000));
      if (elapsed >= totalDur + 1) autoAdvance();
    }
  }, 1000);
}
function stopTimer() { if (autoTimer) { clearInterval(autoTimer); autoTimer = null; } }
function autoAdvance() {
  stopTimer();
  if (sleepAfterSong) { stopPlayback(); clearSleep(); toast('定时已到，已停止'); return; }
  if (state.playMode === 'single') { playCurrent(); return; }
  playNext(true);
}

// ---- 播放模式 ----
const MODE_META = {
  loop:    { icon: '🔁', label: '列表循环' },
  single:  { icon: '🔂', label: '单曲循环' },
  shuffle: { icon: '🔀', label: '随机播放' },
};
const MODE_ORDER = ['loop', 'single', 'shuffle'];
function renderMode() {
  const m = MODE_META[state.playMode] || MODE_META.loop;
  const btn = $('modeBtn');
  btn.textContent = m.icon;
  btn.title = '播放模式：' + m.label;
}
$('modeBtn').onclick = () => {
  const idx = MODE_ORDER.indexOf(state.playMode);
  state.playMode = MODE_ORDER[(idx + 1) % MODE_ORDER.length];
  localStorage.setItem('wemusic_mode', state.playMode);
  renderMode();
  toast('播放模式：' + MODE_META[state.playMode].label);
};
renderMode();

// 计算下一首索引
function computeNextIndex() {
  const n = state.queue.length;
  if (n === 0) return -1;
  if (n === 1) return 0;
  if (state.playMode === 'shuffle') {
    let i;
    do { i = Math.floor(Math.random() * n); } while (i === state.queueIndex);
    return i;
  }
  // loop / single（手动下一首时 single 也顺延）
  const i = state.queueIndex + 1;
  return i >= n ? 0 : i;
}

// ---- 播放控制 ----
function playPrev() {
  if (state.queue.length === 0) return;
  if (state.playMode === 'shuffle' && state.history.length) {
    state.queueIndex = state.history.pop();
  } else {
    state.queueIndex = state.queueIndex > 0 ? state.queueIndex - 1 : state.queue.length - 1;
  }
  playCurrent();
}
function playNext(auto = false) {
  const i = computeNextIndex();
  if (i === -1) return;
  if (state.playMode === 'shuffle') state.history.push(state.queueIndex);
  state.queueIndex = i;
  playCurrent();
}
$('prevBtn').onclick = () => playPrev();
$('nextBtn').onclick = () => playNext(false);
// 播放/暂停
$('playPauseBtn').onclick = () => {
  if (!state.current) return toast('请选择一首歌曲播放');
  // 尚未挂载播放器（如恢复上次播放后）→ 开始播放
  const mounted = $('videoContainer').children.length > 0;
  if (!mounted) { playCurrent(); return; }
  // 否则切换自动连播计时（视频本身的播放/暂停请用浮窗内播放器）
  timerPaused = !timerPaused;
  $('playPauseBtn').textContent = timerPaused ? '▶' : '⏸';
  toast(timerPaused ? '已暂停自动连播' : '继续自动连播');
};

// ---------------- 播放队列 + 历史 合并抽屉 ----------------
let activeTab = 'queue'; // 'queue' | 'history'

$('queueBtn').onclick = () => {
  const d = $('queueDrawer');
  const show = d.classList.toggle('show');
  if (show) renderActiveTab();
};
$('qdClose').onclick = () => $('queueDrawer').classList.remove('show');
$('qdClear').onclick = () => {
  if (activeTab === 'queue') {
    state.queue = []; state.queueIndex = -1; state.current = null; state.history = [];
    destroyVideo();
    $('npTitle').textContent = '未在播放';
    $('npSinger').textContent = '—';
    $('npCover').classList.remove('show');
    document.title = 'WeMusic · 个人音乐';
    setStatus('');
    saveSession();
    renderQueue(); toast('已清空播放队列');
  } else {
    localStorage.removeItem('wemusic_play_hist');
    renderHistory(); toast('已清空播放历史');
  }
};
$('tabQueue').onclick = () => { activeTab = 'queue'; setTab('queue'); renderQueue(); };
$('tabHistory').onclick = () => { activeTab = 'history'; setTab('history'); renderHistory(); };

function setTab(t) {
  $('tabQueue').classList.toggle('active', t === 'queue');
  $('tabHistory').classList.toggle('active', t === 'history');
}
function renderActiveTab() { activeTab === 'queue' ? renderQueue() : renderHistory(); }

function renderQueue() {
  const list = $('qdList');
  if (!state.queue.length) {
    list.innerHTML = '<div class="empty">队列为空</div>';
    return;
  }
  list.innerHTML = state.queue
    .map(
      (s, i) => `
      <div class="qd-row ${i === state.queueIndex ? 'playing' : ''}" data-i="${i}">
        <div class="qd-ct">
          <div class="qd-name">${esc(s.name)}</div>
          <div class="qd-singer">${esc(s.singer || '')}</div>
        </div>
        <span class="qd-del" data-i="${i}" title="移出队列">✕</span>
      </div>`
    )
    .join('');
  list.querySelectorAll('.qd-row').forEach((row) => {
    row.onclick = (e) => {
      if (e.target.classList.contains('qd-del')) return;
      state.queueIndex = Number(row.dataset.i);
      playCurrent();
      renderQueue();
    };
  });
  list.querySelectorAll('.qd-del').forEach((el) => {
    el.onclick = (e) => {
      e.stopPropagation();
      removeFromQueue(Number(el.dataset.i));
    };
  });
}

function removeFromQueue(i) {
  if (i < 0 || i >= state.queue.length) return;
  const removingCurrent = i === state.queueIndex;
  state.queue.splice(i, 1);
  if (i < state.queueIndex) {
    state.queueIndex--;
  } else if (removingCurrent) {
    // 移除了正在播放的曲目
    if (state.queue.length === 0) {
      // 队列空了：停止播放，重置状态
      state.queueIndex = -1;
      state.current = null;
      destroyVideo();
      $('npTitle').textContent = '未在播放';
      $('npSinger').textContent = '—';
      document.title = 'WeMusic · 个人音乐';
      setStatus('');
    } else {
      // 索引不变（下一首自动顶上来），重新播放
      if (state.queueIndex >= state.queue.length) state.queueIndex = 0;
      playCurrent();
    }
  }
  saveSession();
  renderQueue();
}

// 播放历史由合并抽屉的 Tab 管理，此处为空占位（已移至 queueDrawer Tab）

function renderHistory() {
  const list = $('qdList');
  const hist = getPlayHistory();
  if (!hist.length) {
    list.innerHTML = '<div class="empty">还没有播放记录</div>';
    return;
  }
  list.innerHTML = hist
    .map(
      (s, i) => `
      <div class="qd-row" data-i="${i}">
        <div class="qd-ct">
          <div class="qd-name">${esc(s.name)}</div>
          <div class="qd-singer">${esc(s.singer || '')}</div>
        </div>
        <span class="qd-del" data-i="${i}" title="移出历史">✕</span>
      </div>`
    )
    .join('');
  list.querySelectorAll('.qd-row').forEach((row) => {
    row.onclick = (e) => {
      if (e.target.classList.contains('qd-del')) return;
      const song = hist[Number(row.dataset.i)];
      // 以历史项为单首队列播放
      playFromList([{ ...song }], 0, null, null);
    };
  });
  list.querySelectorAll('.qd-del').forEach((el) => {
    el.onclick = (e) => {
      e.stopPropagation();
      const h = getPlayHistory();
      h.splice(Number(el.dataset.i), 1);
      localStorage.setItem('wemusic_play_hist', JSON.stringify(h));
      renderHistory();
    };
  });
}

// ---- 收起 / 展开视频（记住偏好；仅隐藏画面，iframe 保持播放，声音不中断） ----
$('videoBtn').onclick = () => {
  if (!state.current || !state.current.bvid) return toast('请先播放一首歌曲');
  // 尚未挂载（如恢复上次播放后）→ 先开始播放
  if ($('videoContainer').children.length === 0) { playCurrent(); return; }
  setPaneVisible(!state.paneVisible);
};
// 关闭：彻底停止播放
$('vpClose').onclick = () => {
  destroyVideo();
  applyPaneVisibility(); // 刷新按钮文案为「看视频」
  setStatus('已停止');
};
$('vpFull').onclick = () => {
  const pane = $('videoPane');
  if (!document.fullscreenElement) {
    (pane.requestFullscreen ? pane.requestFullscreen() : Promise.reject()).catch(() => {
      // 浏览器不支持原生全屏时，用样式铺满
      pane.classList.toggle('fullscreen');
    });
  } else {
    document.exitFullscreen?.();
  }
};

// 视频浮窗拖动
(function enableDrag() {
  const pane = $('videoPane');
  const head = $('vpHead');
  let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
  head.addEventListener('mousedown', (e) => {
    if (e.target.classList.contains('vp-btn')) return; // 点按钮不拖动
    if (pane.classList.contains('fullscreen')) return;
    if (!pane.classList.contains('show')) return; // 隐藏时不触发拖动
    dragging = true;
    const rect = pane.getBoundingClientRect();
    ox = rect.left; oy = rect.top; sx = e.clientX; sy = e.clientY;
    // 由 right/bottom 定位切换为 left/top 定位
    pane.style.left = ox + 'px';
    pane.style.top = oy + 'px';
    pane.style.right = 'auto';
    pane.style.bottom = 'auto';
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    let nx = ox + (e.clientX - sx);
    let ny = oy + (e.clientY - sy);
    nx = Math.max(0, Math.min(nx, window.innerWidth - pane.offsetWidth));
    ny = Math.max(0, Math.min(ny, window.innerHeight - pane.offsetHeight));
    pane.style.left = nx + 'px';
    pane.style.top = ny + 'px';
  });
  window.addEventListener('mouseup', () => { dragging = false; });
})();

// ---------------- 换源 ----------------
$('switchSrcBtn').onclick = openCandModal;
$('vpSwitch').onclick = openCandModal;
$('candClose').onclick = () => $('candModal').classList.remove('show');
$('candModal').onclick = (e) => { if (e.target.id === 'candModal') $('candModal').classList.remove('show'); };

async function openCandModal() {
  if (!state.current) return toast('请先播放一首歌曲');
  const modal = $('candModal');
  const list = $('candList');
  modal.classList.add('show');
  let candidates = state.current._candidates;
  if (!candidates) {
    list.innerHTML = '<div class="loading">搜索中…</div>';
    try {
      const kw = `${state.current.name} ${(state.current.singer || '').split('/')[0]}`;
      const r = await api(`/play/search?keyword=${encodeURIComponent(kw)}`);
      candidates = r.candidates;
      state.current._candidates = candidates;
    } catch (e) {
      list.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
      return;
    }
  }
  list.innerHTML = candidates
    .map(
      (c, i) => `
      <div class="cand-row ${c.live ? 'live' : ''}" data-i="${i}">
        <div class="ct">
          <div class="title">${esc(c.title)}</div>
          <div class="meta">UP：${esc(c.author)} · ${fmtPlay(c.play)} 播放 · ${fmtDur(c.duration)}</div>
        </div>
        <span class="tag ${c.live ? 'live' : ''}">${c.live ? '现场' : '推荐'}</span>
      </div>`
    )
    .join('');
  list.querySelectorAll('.cand-row').forEach((row) => {
    row.onclick = () => {
      const c = candidates[Number(row.dataset.i)];
      state.current.bvid = c.bvid;
      state.current._biliTitle = c.title;
      state.current._biliDur = c.duration || state.current.duration;
      cacheBvid(state.current);
      // 换源后用官方播放器重新播放
      resetProgress(state.current._biliDur);
      startVideo(c.bvid, c.title, state.current._biliDur);
      modal.classList.remove('show');
    };
  });
}

// ---------------- 快捷键帮助浮层 ----------------
$('helpBtn').onclick = () => $('helpModal').classList.add('show');
$('helpClose').onclick = () => $('helpModal').classList.remove('show');
$('helpModal').onclick = (e) => { if (e.target.id === 'helpModal') $('helpModal').classList.remove('show'); };

// ---------------- 键盘快捷键 ----------------
function closeOverlays() {
  let closed = false;
  ['candModal', 'addModal', 'promptModal', 'helpModal', 'settingsModal'].forEach((id) => {
    const el = $(id);
    if (el && el.classList.contains('show')) { el.classList.remove('show'); closed = true; }
  });
  closeCtxMenu();
  if ($('searchSuggest').classList.contains('show')) { $('searchSuggest').classList.remove('show'); closed = true; }
  if ($('queueDrawer').classList.contains('show')) { $('queueDrawer').classList.remove('show'); closed = true; }
  if (!closed && $('videoPane').classList.contains('show')) {
    $('videoPane').classList.remove('fullscreen');
    setPaneVisible(false); // 收起并记住偏好
  }
}

document.addEventListener('keydown', (e) => {
  const tag = (e.target.tagName || '').toLowerCase();
  const typing = tag === 'input' || tag === 'textarea' || e.target.isContentEditable;
  if (e.key === 'Escape') { closeOverlays(); return; }
  if (e.key === '/' && !typing) { e.preventDefault(); $('searchInput').focus(); return; }
  if (e.key === '?' && !typing) { e.preventDefault(); $('helpModal').classList.toggle('show'); return; }
  if (typing) return;
  if (e.code === 'Space') {
    if (!state.current) return;
    e.preventDefault();
    $('playPauseBtn').click();
  } else if (e.key === 'ArrowRight') {
    if (state.current) { e.preventDefault(); playNext(false); }
  } else if (e.key === 'ArrowLeft') {
    if (state.current) { e.preventDefault(); playPrev(); }
  }
});

// ---------------- 启动 ----------------
init().catch((e) => console.error(e));
