// ---------------- 歌单侧边栏 + 歌曲列表渲染 + 导入导出 ----------------
import { $, esc, toast, fmtDur, fmtTotal, uiPrompt, uiPromptDual, uiConfirm, albumCover, playlistCoverHtml } from './utils.js';

const colHeader = `<div class="song-row-head">
  <span class="h-idx">#</span><span class="h-name">歌名</span><span class="h-singer">歌手</span><span class="h-album">专辑</span><span class="h-bookmark"></span><span class="h-dur">时长</span><span class="h-ops">操作</span>
</div>`;
import { api } from './api.js';
import { state } from './state.js';

// ---- 歌曲索引 ----
let _indexBuilding = false;
export let _indexDirty = true;

export async function buildSongIndex() {
  if (_indexBuilding) return;
  _indexBuilding = true;
  try {
    const results = await Promise.all(
      state.playlists.map((p) => api(`/playlists/${p.id}/songs`).then((d) => ({ id: p.id, songs: d.songs || [] })))
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
  } catch {}
  finally { _indexBuilding = false; }
}

export function dirtyIndex() { _indexDirty = true; }

export function refreshAllBookmarks() {
  buildSongIndex().then(() => {
    document.querySelectorAll('.song-list').forEach((list) => {
      const songs = list._songs;
      if (!songs) return;
      list.querySelectorAll('.song-row').forEach((row) => {
        const i = Number(row.dataset.i);
        const s = songs[i]; if (!s) return;
        const ops = row.querySelector('.ops'); if (!ops) return;
        const isPlaylistPage = !!ops.querySelector('[data-act="del"]');
        const inPls = songInPlaylists(s);
        const existing = row.querySelector('.in-pl-mark');
        const placeholder = row.querySelector('.in-pl-placeholder');
        const showBadge = !isPlaylistPage && inPls.size > 0;
        const dur = row.querySelector('.dur');
        if (showBadge && !existing) {
          const mark = document.createElement('span');
          mark.className = 'in-pl-mark'; mark.dataset.tip = `已在 ${inPls.size} 个歌单中`; mark.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>';
          if (placeholder) placeholder.replaceWith(mark);
          else if (dur) dur.before(mark);
        } else if (!showBadge && existing) {
          const ph = document.createElement('span'); ph.className = 'in-pl-placeholder';
          existing.replaceWith(ph);
        } else if (existing && showBadge) {
          existing.dataset.tip = `已在 ${inPls.size} 个歌单中`;
        }
      });
    });
  }).catch(() => {});
}

export function songInPlaylists(song) {
  const k = `${song.name}__${song.singer || ''}`;
  return state.songIndex.get(k) || new Set();
}

// ---- 歌单侧边栏 ----
export async function loadPlaylists() {
  const { playlists } = await api('/playlists');
  state.playlists = playlists;
  if (!state.targetPlaylistId && playlists[0]) state.targetPlaylistId = playlists[0].id;
  renderSidebar();
  dirtyIndex();
}

export function setActiveNav(id) {
  ['navDiscover', 'navHistory', 'navStats', 'navLikes', 'navSavedAlbums'].forEach((n) => {
    const el = $(n); if (el) el.classList.toggle('active', n === id);
  });
}

export function renderHome() {
  state.view = 'home';
  setActiveNav(null);
  $('main').innerHTML = `<div class="empty" style="padding-top:80px">从左侧选择歌单，或在上方搜索歌曲 / 歌手</div>`;
}

export function renderSidebar() {
  const box = $('playlistList');
  box.innerHTML = state.playlists.map((p) => `
    <div class="playlist-item ${p.id === state.targetPlaylistId ? 'active' : ''}" data-id="${p.id}" draggable="true">
      <span class="pl-name">${esc(p.name)}</span>
      <span class="pl-ops"><span class="count">${p.count}</span> <span class="edit" data-edit="${p.id}" title="编辑歌单"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></span> <span class="del" data-del="${p.id}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></span></span>
    </div>`).join('');

  // 拖拽排序
  box.querySelectorAll('.playlist-item').forEach((el) => {
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed = 'move';
      el.classList.add('dragging');
      el._dragId = Number(el.dataset.id);
    });
    el.addEventListener('dragend', () => { el.classList.remove('dragging'); });
    el.addEventListener('dragover', (e) => e.preventDefault());
    el.addEventListener('drop', async (e) => {
      e.preventDefault();
      const fromId = box.querySelector('.dragging')?._dragId;
      const toId = Number(el.dataset.id);
      if (!fromId || fromId === toId) return;
      const fromIdx = state.playlists.findIndex((p) => p.id === fromId);
      const toIdx = state.playlists.findIndex((p) => p.id === toId);
      if (fromIdx < 0 || toIdx < 0) return;
      const [moved] = state.playlists.splice(fromIdx, 1);
      state.playlists.splice(toIdx, 0, moved);
      renderSidebar();
      api('/playlists/reorder', { method: 'PUT', body: { orderedIds: state.playlists.map((p) => p.id) } }).catch(() => loadPlaylists());
    });
  });

  box.querySelectorAll('.playlist-item').forEach((el) => {
    const id = Number(el.dataset.id);
    el.onclick = () => { state.targetPlaylistId = id; renderSidebar(); openPlaylist(id); };
    // 右键菜单替代 hover 编辑/删除，避免误触
    el.oncontextmenu = (e) => {
      e.preventDefault();
      const pl = state.playlists.find((x) => x.id === id); if (!pl) return;
      const menu = document.getElementById('ctxMenu');
      if (!menu) return;
      menu.innerHTML = `
        <div class="ctx-item" data-act="edit"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> 编辑歌单</div>
        <div class="ctx-sep"></div>
        <div class="ctx-item danger" data-act="del"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> 删除歌单</div>`;
      menu.querySelectorAll('.ctx-item').forEach((it) => {
        it.onclick = async (ev) => {
          ev.stopPropagation();
          menu.classList.remove('show');
          if (it.dataset.act === 'edit') {
            const r = await uiPromptDual('编辑歌单名称', pl.name, '编辑歌单简介（可选）', pl.desc || '');
            if (!r) return;
            await api(`/playlists/${id}`, { method: 'PUT', body: { name: r.val1, desc: r.val2 || '' } });
            await loadPlaylists();
            if (state.view === 'playlist' && state.targetPlaylistId === id) openPlaylist(id);
          } else if (it.dataset.act === 'del') {
            deletePlaylist(id);
          }
        };
      });
      menu.classList.add('show');
      const mw = menu.offsetWidth || 140, mh = menu.offsetHeight || 80;
      let x = e.clientX, y = e.clientY;
      if (x + mw > window.innerWidth) x = window.innerWidth - mw - 8;
      if (y + mh > window.innerHeight) y = window.innerHeight - mh - 8;
      menu.style.left = x + 'px'; menu.style.top = y + 'px';
    };
  });

  // 删除歌单独立函数（右键菜单复用）
  async function deletePlaylist(id) {
    const pl = state.playlists.find((x) => x.id === id);
    const cnt = pl ? pl.count : 0;
    if (!(await uiConfirm(`确定删除歌单「${pl ? pl.name : ''}」？${cnt ? `（含 ${cnt} 首歌曲）` : ''}此操作不可恢复`))) return;
    await api(`/playlists/${id}`, { method: 'DELETE' });
    const wasActive = state.targetPlaylistId === id;
    if (wasActive) state.targetPlaylistId = null;
    await loadPlaylists();
    if (wasActive || state.view === 'playlist') renderHome();
  }
}

// ---- 列表渲染 ----
export function listToolsHtml() {
  return `<div class="list-tools">
    <button class="btn green sm" data-tool="playall"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg> 播放全部</button>
    <button class="btn sm" data-tool="shuffle"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="m15 15 6 6"/><path d="M4 4l5 5"/></svg> 随机播放</button>
    <input class="filter-input" data-tool="filter" placeholder="在列表中筛选…" />
  </div>`;
}

export function bindListTools(scopeEl, songs, container, context, playlistId) {
  const playBtn = scopeEl.querySelector('[data-tool="playall"]');
  const shuffleBtn = scopeEl.querySelector('[data-tool="shuffle"]');
  const filterEl = scopeEl.querySelector('[data-tool="filter"]');
  if (playBtn) playBtn.onclick = () => playAll(songs, context, playlistId, false);
  if (shuffleBtn) shuffleBtn.onclick = () => playAll(songs, context, playlistId, true);
  attachFilter(filterEl, container);
}

function attachFilter(inputEl, container) {
  if (!inputEl || !container) return;
  inputEl.addEventListener('input', () => {
    const q = inputEl.value.trim().toLowerCase();
    container.querySelectorAll('.song-row').forEach((row) => {
      const name = row.querySelector('.name')?.textContent || '';
      const singer = row.querySelector('.singer')?.textContent || '';
      row.style.display = !q || (name + ' ' + singer).toLowerCase().includes(q) ? '' : 'none';
    });
  });
}

function playAll(songs, context, playlistId, shuffle = false) {
  if (!songs || songs.length === 0) return toast('列表为空');
  import('./player.js').then(({ playFromList, renderMode }) => {
    if (shuffle && state.playMode !== 'shuffle') {
      state.playMode = 'shuffle';
      localStorage.setItem('wemusic_mode', 'shuffle');
      renderMode();
    }
    state.history = [];
    const start = shuffle ? Math.floor(Math.random() * songs.length) : 0;
    playFromList(songs, start, context, playlistId);
  });
}

export function renderSongList(container, songs, opts = {}) {
  if (_indexDirty) { _indexDirty = false; buildSongIndex().then(() => refreshAllBookmarks()).catch(() => {}); }
  const { showAdd = false, showDelete = false, playlistId = null, context = null } = opts;
  container.innerHTML = songs.map((s, i) => {
    const inPls = songInPlaylists(s);
    const bookmark = (!showDelete && inPls.size > 0)
      ? `<span class="in-pl-mark" data-tip="已在 ${inPls.size} 个歌单中"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg></span>`
      : '<span class="in-pl-placeholder"></span>';
    const isLiked = s.song_mid ? (state.likedMids && state.likedMids.has(s.song_mid)) : false;
    const heartSVG = `<svg viewBox="0 0 24 24" width="15" height="15" fill="${isLiked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>`;
    const brokenHeartSVG = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/><line x1="3" y1="3" x2="21" y2="21"/></svg>`;
    const likeBtns = s.song_mid
      ? `<button class="np-act-btn song-like-btn${isLiked ? ' liked-active' : ''}" title="${isLiked ? '取消喜欢' : '喜欢'}" data-act="like">${heartSVG}</button>
         <button class="np-act-btn" title="不喜欢" data-act="dislike">${brokenHeartSVG}</button>`
      : '';
    return `
    <div class="song-row" data-i="${i}">
      <span class="idx">${i + 1}</span>
      <span class="name">${esc(s.name)}</span>
      <span class="singer">${esc(s.singer)}</span>
      <span class="album">${esc(s.album)}</span>
      ${bookmark}
      <span class="dur">${fmtDur(s.duration)}</span>
      <span class="ops">
        ${likeBtns}
        ${showAdd ? '<button class="icon-btn" title="添加到歌单" data-act="add"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg></button>' : ''}
        ${showDelete ? '<button class="icon-btn" title="从歌单移除" data-act="del"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>' : ''}
      </span>
    </div>`;
  }).join('');

  container.querySelectorAll('.song-row').forEach((row) => {
    const i = Number(row.dataset.i);
    row.onclick = () => import('./player.js').then(({ playFromList }) => playFromList(songs, i, context, playlistId));
    row.querySelectorAll('[data-act]').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const act = btn.dataset.act;
        if (act === 'add') addSongs([songs[i]]);
        else if (act === 'del') deleteSong(playlistId, songs[i].id, row);
        else if (act === 'like') import('./ui.js').then(({ toggleLike }) => toggleLike(songs[i], btn));
      };
    });
    row.oncontextmenu = (e) => { e.preventDefault(); import('./ui.js').then(({ openSongMenu }) => openSongMenu(e, songs, i, context, playlistId, row)); };
  });
  container._songs = songs;
  if (context === 'playlist') enableRowDrag(container, songs, playlistId);
}

function enableRowDrag(container, songs, playlistId) {
  let fromIdx = -1;
  container.querySelectorAll('.song-row').forEach((row) => {
    row.setAttribute('draggable', 'true');
    row.addEventListener('dragstart', (e) => { fromIdx = Number(row.dataset.i); row.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
    row.addEventListener('dragend', () => { row.classList.remove('dragging'); container.querySelectorAll('.drag-over').forEach((r) => r.classList.remove('drag-over')); });
    row.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; row.classList.add('drag-over'); });
    row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
    row.addEventListener('drop', (e) => {
      e.preventDefault(); row.classList.remove('drag-over');
      const toIdx = Number(row.dataset.i);
      if (fromIdx < 0 || fromIdx === toIdx) return;
      const [moved] = songs.splice(fromIdx, 1);
      songs.splice(toIdx, 0, moved);
      renderSongList(container, songs, { showDelete: true, playlistId, context: 'playlist' });
      if (state.queue === songs && state.current) {
        const ni = songs.indexOf(state.current);
        if (ni >= 0) state.queueIndex = ni;
      }
      import('./player.js').then(({ highlightPlaying, saveSession }) => { highlightPlaying(); saveSession(); });
      api(`/playlists/${playlistId}/reorder`, { method: 'PUT', body: { orderedIds: songs.map((s) => s.id) } }).catch(() => {});
    });
  });
}

// ---- 添加到歌单 ----
let pendingAddSongs = null;

export function addSongs(songs) {
  if (!songs || songs.length === 0) return toast('没有可添加的歌曲');
  pendingAddSongs = songs; openAddModal();
}

function openAddModal() {
  const pendingKeys = (pendingAddSongs || []).map((s) => `${s.name}__${s.singer || ''}`);
  const list = $('addList');
  list.innerHTML = state.playlists.map((p) => {
    const contained = pendingKeys.filter((k) => { const pls = state.songIndex.get(k); return pls && pls.has(p.id); }).length;
    const all = pendingKeys.length > 0 && contained === pendingKeys.length;
    const some = contained > 0 && !all;
    const badge = all ? '<span class="add-pl-check all" title="全部已在此歌单"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>'
      : some ? `<span class="add-pl-check some" title="${contained}/${pendingKeys.length} 首已在此歌单">•</span>` : '';
    return `<div class="add-pl-row" data-id="${p.id}"><span>${esc(p.name)}</span><span class="add-pl-meta">${badge}<span class="count">${p.count} 首</span></span></div>`;
  }).join('') || '<div class="empty">还没有歌单，点下方新建</div>';
  $('addModal').classList.add('show');
  list.querySelectorAll('.add-pl-row').forEach((el) => { el.onclick = () => commitAdd(Number(el.dataset.id)); });
}

async function commitAdd(playlistId) {
  const songs = pendingAddSongs; if (!songs) return;
  $('addModal').classList.remove('show');
  try {
    const r = await api(`/playlists/${playlistId}/songs`, { method: 'POST', body: { songs } });
    const p = state.playlists.find((x) => x.id === playlistId);
    toast(`已添加 ${r.added} 首${r.skipped ? `，跳过 ${r.skipped} 首重复` : ''} → ${p ? p.name : ''}`);
    await loadPlaylists(); refreshAllBookmarks();
    if (state.view === 'playlist' && state.targetPlaylistId === playlistId) openPlaylist(playlistId);
  } catch (e) { toast('添加失败：' + e.message); }
  finally { pendingAddSongs = null; }
}

// ---- 导出/导入 ----
export async function exportPlaylist(id, name) {
  try {
    const data = await api(`/playlists/${id}/export`);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `WeMusic-${(name || '歌单').replace(/[\\/:*?"<>|]/g, '_')}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('已导出 JSON 备份');
  } catch (e) { toast('导出失败：' + e.message); }
}

export async function deleteSong(playlistId, songId, row) {
  try {
    await api(`/playlists/${playlistId}/songs/${songId}`, { method: 'DELETE' });
    row.remove(); await loadPlaylists(); refreshAllBookmarks();
    const sub = document.querySelector('.view-sub');
    if (sub && state.view === 'playlist') {
      const container = $('plSongs');
      if (container) {
        const remaining = container._songs || [];
        const totalSec = remaining.reduce((acc, s) => acc + (Number(s.duration) || 0), 0);
        sub.textContent = `${remaining.length} 首 · 总时长 ${fmtTotal(totalSec)}`;
      }
    }
  } catch (e) { toast('删除失败：' + e.message); }
}

// ---- 歌单详情 ----
export async function openPlaylist(id) {
  state.view = 'playlist';
  import('./main.js').then(({ navPush }) => navPush('playlist', { id }));
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
          <div class="view-title" id="plTitle">${esc(data.playlist.name)}
            <button class="pl-rename-btn" id="plRenameBtn" title="编辑歌单"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></button>
          </div>
          <div class="view-sub">${data.songs.length} 首 · 总时长 ${fmtTotal(totalSec)}</div>
          ${data.playlist.desc ? `<div class="pl-desc-detail">${esc(data.playlist.desc)}</div>` : ''}
          <div class="section-head" style="margin:12px 0 0">
            <button class="btn sm" id="exportPlBtn">⤓ 导出歌单</button>
          </div>
        </div>
      </div>
      ${data.songs.length ? listToolsHtml() : ''}
      ${colHeader}
      <div class="song-list" id="plSongs"></div>`;
    $('exportPlBtn').onclick = () => exportPlaylist(id, data.playlist.name);
    $('plRenameBtn').onclick = async () => {
      const r = await uiPromptDual('编辑歌单名称', data.playlist.name, '编辑歌单简介（可选）', data.playlist.desc || '');
      if (!r) return;
      await api(`/playlists/${id}`, { method: 'PUT', body: { name: r.val1, desc: r.val2 || '' } });
      await loadPlaylists();
      openPlaylist(id);
    };
    if (data.songs.length === 0) { $('plSongs').innerHTML = '<div class="empty">歌单还是空的，去搜索添加歌曲吧</div>'; return; }
    const container = $('plSongs');
    renderSongList(container, data.songs, { showDelete: true, playlistId: id, context: 'playlist' });
    bindListTools(main, data.songs, container, 'playlist', id);
  } catch (e) { main.innerHTML = `<div class="empty">加载失败：${esc(e.message)}</div>`; }
}

// 全局即时 tooltip（替代 title 属性，无延迟）
let _tipEl = null;
function _initTip() { if (_tipEl) return; _tipEl = document.createElement('div'); _tipEl.style.cssText = 'display:none;position:fixed;z-index:9999;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;padding:4px 10px;font-size:12px;color:var(--text);pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,.15);white-space:nowrap'; document.body.appendChild(_tipEl); }
document.addEventListener('mouseover', (e) => {
  const el = e.target.closest('[data-tip]');
  if (!el) return;
  _initTip(); _tipEl.textContent = el.dataset.tip; _tipEl.style.display = 'block';
  const onMove = (ev) => { _tipEl.style.left = (ev.clientX + 12) + 'px'; _tipEl.style.top = (ev.clientY - 28) + 'px'; };
  onMove(e); el.addEventListener('mousemove', onMove, { once: true });
  const hide = () => { _tipEl.style.display = 'none'; el.removeEventListener('mouseleave', hide); };
  el.addEventListener('mouseleave', hide);
});

export function initPlaylistUI() {
  $('addClose').onclick = () => { $('addModal').classList.remove('show'); pendingAddSongs = null; };
  $('addModal').onclick = (e) => { if (e.target.id === 'addModal') { $('addModal').classList.remove('show'); pendingAddSongs = null; } };
  $('addNewPl').onclick = async () => {
    const name = await uiPrompt('新歌单名称', '');
    if (!name) return;
    const res = await api('/playlists', { method: 'POST', body: { name } });
    await loadPlaylists(); commitAdd(res.id);
  };
  $('newPlaylistBtn').onclick = async () => {
    const name = await uiPrompt('新歌单名称', '');
    if (!name) return;
    await api('/playlists', { method: 'POST', body: { name } });
    await loadPlaylists(); toast('歌单已创建');
  };

  // 导入弹层
  $('importPlBtn').onclick = () => $('importModal').classList.add('show');
  $('importModalClose').onclick = () => $('importModal').classList.remove('show');
  $('importModal').onclick = (e) => { if (e.target.id === 'importModal') $('importModal').classList.remove('show'); };
  $('importQqBtn').onclick = async () => {
    const url = $('importQqUrl').value.trim();
    if (!url) return toast('请粘贴歌单链接');
    $('importModal').classList.remove('show');
    const main = $('main');
    main.innerHTML = '<div class="loading">正在解析歌单…</div>';
    try {
      const data = await api('/music/parse-playlist', { method: 'POST', body: { url } });
      main.innerHTML = `
        <div class="view-title">${esc(data.name)}</div>
        <div class="view-sub">${data.songs.length} 首 · 解析完成</div>
        <div class="list-tools"><button class="btn green sm" id="addAllParsed">全部添加到歌单</button></div>
        <div class="song-list" id="parsedList"></div>`;
      renderSongList($('parsedList'), data.songs, { showAdd: true });
      $('addAllParsed').onclick = () => addSongs(data.songs);
      $('importQqUrl').value = '';
    } catch (e) { main.innerHTML = `<div class="empty">解析失败：${esc(e.message)}</div>`; }
  };
  $('importQqUrl') && $('importQqUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('importQqBtn').click(); });
  $('importJsonBtn').onclick = () => $('importFile').click();
  $('importFile').onchange = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; if (!file) return;
    $('importModal').classList.remove('show');
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const songs = Array.isArray(json.songs) ? json.songs : [];
      if (songs.length === 0) return toast('文件中没有歌曲数据');
      const defName = json.name || file.name.replace(/\.json$/i, '');
      const name = await uiPrompt('导入为新歌单，名称：', defName);
      if (!name) return;
      const res = await api('/playlists/import', { method: 'POST', body: { name, songs } });
      await loadPlaylists(); state.targetPlaylistId = res.id; renderSidebar(); openPlaylist(res.id);
      toast(`已导入 ${res.added} 首到「${res.name}」`);
    } catch { toast('导入失败：文件格式不正确'); }
  };
}
