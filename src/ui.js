// ---------------- 通用 UI：右键菜单、换源、喜欢、弹幕 ----------------
import { $, esc, fmtDur, fmtPlay, toast, fetchBlockedList, blockedSectionHtml, bindBlockedSection, saveBlockedMeta, BROKEN_HEART_OUTLINE, BROKEN_HEART_FILLED, CACHE_ICON } from './utils.js';
import { api, Auth } from './api.js';
import { state } from './state.js';

// ---- 右键菜单 ----
export function closeCtxMenu() { $('ctxMenu').classList.remove('show'); }
document.addEventListener('click', closeCtxMenu);
document.addEventListener('scroll', closeCtxMenu, true);

export function openSongMenu(evt, songs, i, context, playlistId, row) {
  const song = songs[i]; if (!song) return;
  const menu = $('ctxMenu');
  const inPlaylist = context === 'playlist';
  const items = [
    { label: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg> 下一首播放', act: 'enqueue' },
    { sep: true },
    { label: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg> 添加到歌单', act: 'add' },
    { label: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg> 分享', act: 'share', dim: !song.song_mid, dimTip: '该歌曲不支持分享' },
    { sep: true },
    { label: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> 复制 Bilibili 链接', act: 'copy', dim: !song.bvid, dimTip: '请先播放一次以匹配资源' },
    { label: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg> 在 Bilibili 搜索此歌', act: 'search' },
    { sep: true },
    { label: CACHE_ICON + ' 缓存到本地', act: 'cacheoffline', dim: !song.bvid, dimTip: '请先播放一次以匹配资源' },
  ];
  if (inPlaylist) items.push({ sep: true }, { label: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> 从歌单移除', act: 'del', danger: true });
  menu.innerHTML = items.map((it) =>
    it.sep ? '<div class="ctx-sep"></div>'
    : `<div class="ctx-item${it.danger ? ' danger' : ''}${it.dim ? ' dim' : ''}" data-act="${it.act}"${it.dimTip ? ` data-dim-tip="${esc(it.dimTip)}"` : ''}>${it.label}</div>`
  ).join('');
  menu.classList.add('show');
  const mw = menu.offsetWidth || 170, mh = menu.offsetHeight || 200;
  let x = evt.clientX, y = evt.clientY;
  if (x + mw > window.innerWidth) x = window.innerWidth - mw - 8;
  if (y + mh > window.innerHeight) y = window.innerHeight - mh - 8;
  menu.style.left = x + 'px'; menu.style.top = y + 'px';

  menu.querySelectorAll('.ctx-item').forEach((el) => {
    el.onclick = async (e) => {
      e.stopPropagation();
      if (el.classList.contains('dim')) { closeCtxMenu(); toast(el.dataset.dimTip || '暂不可用'); return; }
      closeCtxMenu();
      const act = el.dataset.act;
      if (act === 'enqueue') import('./queue.js').then(({ enqueueNext }) => enqueueNext(song));
      else if (act === 'add') import('./playlist-ui.js').then(({ addSongs }) => addSongs([song]));
      else if (act === 'share') import('./share.js').then(({ openShareModal }) => openShareModal(song));
      else if (act === 'del') import('./playlist-ui.js').then(({ deleteSong }) => deleteSong(playlistId, song.id, row));
      else if (act === 'copy') copyBiliLink(song);
      else if (act === 'search') {
        const kw = `${song.name} ${(song.singer || '').split('/')[0]}`.trim();
        window.open(`https://search.bilibili.com/all?keyword=${encodeURIComponent(kw)}`, '_blank');
      }
      else if (act === 'cacheoffline') {
        import('./offlineCache.js').then(({ fetchAndStore }) => {
          toast('正在缓存到本地…');
          fetchAndStore(song.bvid, Auth.token, { pinned: true, videoSource: { bvid: song.bvid }, lyrics: null, song: { name: song.name, singer: song.singer } })
            .then(() => { toast('已缓存到本地'); window.dispatchEvent(new CustomEvent('offline_cache_changed')); })
            .catch(e => toast('缓存失败：' + e.message));
        });
      }
    };
  });
}

async function copyBiliLink(song) {
  if (!song.bvid) return toast('该歌曲尚未匹配资源，先播放一次');
  const link = `https://www.bilibili.com/video/${song.bvid}`;
  try { await navigator.clipboard.writeText(link); toast('已复制 Bilibili 链接'); }
  catch {
    const ta = document.createElement('textarea');
    ta.value = link; ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('已复制 Bilibili 链接'); } catch { toast('复制失败：' + link); }
    ta.remove();
  }
}

// ---- 换源 ----
export async function openCandModal() {
  if (!state.current) return toast('请先播放一首歌曲');
  const modal = $('candModal');
  const list = $('candList');
  modal.querySelector('h3').textContent = '选择播放资源（Bilibili）';
  modal.classList.add('show');
  let candidates = state.current._candidates;
  if (!candidates) {
    list.innerHTML = '<div class="loading">搜索中…</div>';
    try {
      const name = state.current.name;
      const singer = (state.current.singer || '').split('/')[0];
      const params = new URLSearchParams({ keyword: `${name} ${singer}`, name, singer });
      const r = await api(`/play/search?${params.toString()}`);
      candidates = r.candidates; state.current._candidates = candidates;
    } catch (e) { list.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  }
  const songKey = `${state.current.name}__${state.current.singer || ''}`;
  const currentBvid = state.current.bvid || '';

  // 拉取用户已屏蔽的源（含 metadata）
  const blockedList = await fetchBlockedList(api, songKey, 'video');
  list.innerHTML = candidates.map((c, i) => {
    const isCurrent = c.bvid && c.bvid === currentBvid;
    return `
    <div class="cand-row ${c.live ? 'live' : ''}${isCurrent ? ' current' : ''}" data-bvid="${esc(c.bvid)}" data-i="${i}">
      <span class="cand-rank">${i + 1}</span>
      <div class="ct">
        <div class="title">${esc(c.title)}</div>
        <div class="meta">UP：${esc(c.author)} · ${fmtPlay(c.play)} 播放 · ${fmtDur(c.duration)}</div>
      </div>
      <span class="tag ${c.live ? 'live' : ''}${isCurrent ? ' current' : ''}">${isCurrent ? '当前' : (c.live ? '现场' : '推荐')}</span>
      <button class="cand-block-btn" title="屏蔽此视频源，以后不再出现"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>`;
  }).join('') + blockedSectionHtml(blockedList, 'cand');

  // 辅助：按 bvid 从 candidates 查找（替代不稳定数组下标）
  const findByBvid = (bvid) => candidates.find(c => c.bvid === bvid);

  list.querySelectorAll('.cand-row').forEach((row) => {
    row.onclick = () => {
      const c = findByBvid(row.dataset.bvid);
      if (!c) return;
      const oldBvid = currentBvid;
      state.current.bvid = c.bvid; state.current._biliTitle = c.title;
      state.current._biliDur = c.duration || state.current.duration;
      // 钉住随源迁移：旧源已钉住则释放并钉住新源
      if (oldBvid && oldBvid !== c.bvid) {
        import('./offlineCache.js').then(({ migratePin }) => migratePin(oldBvid, c.bvid, Auth.token, { name: state.current.name, singer: state.current.singer }).catch(() => {}));
      }
      import('./player.js').then(({ cacheBvid, resetProgress, startVideo }) => {
        cacheBvid(state.current);
        resetProgress(state.current._biliDur);
        startVideo(c.bvid, c.title, state.current._biliDur);
      });
      modal.classList.remove('show');
    };
    // 屏蔽按钮
    row.querySelector('.cand-block-btn').onclick = async (e) => {
      e.stopPropagation();
      const targetBvid = row.dataset.bvid;
      const c = findByBvid(targetBvid);
      if (!c) return;
      try {
        await api('/stats/blocked', { method: 'POST', body: {
          song: songKey, type: 'video', sourceId: c.bvid,
          name: c.title, artist: c.author, sourceLabel: 'B站',
        } });
        saveBlockedMeta(c.bvid, { name: c.title, artist: c.author, source: 'bili' });
        candidates = candidates.filter(c => c.bvid !== targetBvid);
        state.current._candidates = candidates;
        row.remove();
        // 立即刷新底部「已屏蔽的源」区域
        const oldBlocked = list.querySelector('.cand-blocked-section');
        if (oldBlocked) oldBlocked.remove();
        const newBlocked = await fetchBlockedList(api, songKey, 'video');
        list.insertAdjacentHTML('beforeend', blockedSectionHtml(newBlocked, 'cand'));
        bindBlockedSection(list, api, songKey, 'video', 'cand');
        toast('已屏蔽，刷新后不再出现');
      } catch (err) { toast('屏蔽失败：' + err.message); }
    };
  });

  // 已屏蔽列表事件（折叠/恢复）
  bindBlockedSection(list, api, songKey, 'video', 'cand');
}

// ---- 换源 ----
export async function toggleLike(song, btn) {
  if (!song.song_mid) return toast('该歌曲无 mid，无法标记喜欢');
  try {
    const r = await api(`/stats/likes/${encodeURIComponent(song.song_mid)}`, {
      method: 'POST',
      body: { name: song.name, singer: song.singer, album: song.album, album_mid: song.album_mid, duration: song.duration },
    });
    if (r.liked) {
      state.likedMids.add(song.song_mid);
      if (btn) {
        btn.classList.add('liked-active');
        const svg = btn.querySelector('svg'); if (svg) svg.setAttribute('fill', 'currentColor');
      }
      toast('已添加到喜欢');
    } else {
      state.likedMids.delete(song.song_mid);
      if (btn) {
        btn.classList.remove('liked-active');
        const svg = btn.querySelector('svg'); if (svg) svg.setAttribute('fill', 'none');
      }
      toast('已取消喜欢');
    }
    // 更新侧边栏计数
    updateLikesCount();
  } catch (e) { toast('操作失败：' + e.message); }
}

export const heartOutline = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>`;
export const heartFilled = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>`;

// ---- 不喜欢 ----
export async function toggleDislike(song, btn) {
  const songKey = `${song.name}__${song.singer || ''}`;
  try {
    const r = await api('/stats/disliked-songs', {
      method: 'POST',
      body: { song_key: songKey },
    });
    const isCurrent = state.current && `${state.current.name}__${state.current.singer || ''}` === songKey;

    if (r.disliked) {
      state.dislikedSongKeys.add(songKey);
      if (btn) {
        btn.classList.add('disliked-active');
        btn.title = '取消不喜欢';
        // 通用：更新按钮内 SVG 的 fill 和 line stroke
        updateDislikeBtnSVG(btn, true);
      }
      toast('已标记为不喜欢');
      // 如果是当前播放的歌 → 同步播放器按钮状态 + 自动切下一首
      if (isCurrent) {
        updateNpDislikeBtn();
        import('./player.js').then(({ playNext }) => playNext(false));
      }
    } else {
      state.dislikedSongKeys.delete(songKey);
      if (btn) {
        btn.classList.remove('disliked-active');
        btn.title = '不喜欢';
        updateDislikeBtnSVG(btn, false);
      }
      toast('已取消不喜欢');
      // 如果是当前播放的歌 → 同步播放器按钮状态
      if (isCurrent) updateNpDislikeBtn();
    }
  } catch (e) { toast('操作失败：' + e.message); }
}

/** 通用：更新 dislike 按钮内的 SVG — 对 player 用 innerHTML 替换，对列表行用 setAttribute */
function updateDislikeBtnSVG(btn, disliked) {
  if (btn.id === 'npDislikeBtn') {
    btn.innerHTML = disliked ? BROKEN_HEART_FILLED : BROKEN_HEART_OUTLINE;
    return;
  }
  // 列表行按钮：直接改 SVG 属性（避免重建 DOM）
  const svg = btn.querySelector('svg');
  if (!svg) return;
  svg.setAttribute('fill', disliked ? 'currentColor' : 'none');
  const line = svg.querySelector('line');
  if (line) line.setAttribute('stroke', disliked ? '#6b6b6b' : 'currentColor');
}

export function updateNpDislikeBtn() {
  const btn = $('npDislikeBtn');
  if (!btn || !state.current) return;
  const songKey = `${state.current.name}__${state.current.singer || ''}`;
  const disliked = state.dislikedSongKeys.has(songKey);
  btn.classList.toggle('disliked-active', !!disliked);
  btn.title = disliked ? '取消不喜欢' : '不喜欢';
  // 关键：切换底部播放器按钮的图标（静态 HTML 里的 fill="none" 不会自动变）
  btn.innerHTML = disliked ? BROKEN_HEART_FILLED : BROKEN_HEART_OUTLINE;
}

// 启动时从服务端加载已不喜欢的歌曲
export async function loadDislikedSongs() {
  try {
    const { disliked } = await api('/stats/disliked-songs');
    state.dislikedSongKeys = new Set(disliked);
  } catch { console.warn('加载不喜欢列表失败'); }
}

export function updateNpLikeBtn() {
  const btn = $('npLikeBtn');
  if (!btn || !state.current) return;
  const liked = state.current.song_mid && state.likedMids.has(state.current.song_mid);
  btn.innerHTML = liked ? heartFilled : heartOutline;
  btn.title = liked ? '取消喜欢' : '喜欢';
  btn.classList.toggle('liked-active', !!liked);
}

export function updateLikesCount() {
  const el = document.getElementById('navLikes');
  if (el) {
    const n = state.likedMids.size;
    el.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg> 我喜欢的${n ? `<span class="side-count">${n}</span>` : ''}`;
  }
}

export async function updateAlbumCount() {
  const el = document.getElementById('navSavedAlbums');
  if (!el) return;
  try {
    const { albums } = await api('/stats/albums');
    el.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg> 我的专辑${albums.length ? `<span class="side-count">${albums.length}</span>` : ''}`;
  } catch { console.warn('更新专辑数失败') }
}

export function initUI() {
  // 换源
  $('switchSrcBtn').onclick = openCandModal;
  $('vpSwitch').onclick = openCandModal;
  $('candClose').onclick = () => $('candModal').classList.remove('show');
  $('candModal').onclick = (e) => { if (e.target.id === 'candModal') $('candModal').classList.remove('show'); };

  // 播放器喜欢 + 不喜欢 + 三点菜单
  $('npLikeBtn').onclick = async () => {
    if (!state.current) return toast('当前没有播放的歌曲');
    await toggleLike(state.current, null);
    updateNpLikeBtn();
  };
  $('npDislikeBtn').onclick = async () => {
    if (!state.current) return toast('当前没有播放的歌曲');
    await toggleDislike(state.current, $('npDislikeBtn'));
    updateNpDislikeBtn();
  };
  $('npMoreBtn').onclick = (e) => {
    e.stopPropagation();
    if (!state.current) return toast('当前没有播放的歌曲');
    const song = state.current;
    const btn = $('npMoreBtn');
    const rect = btn.getBoundingClientRect();
    const menu = $('ctxMenu');
    menu.innerHTML = `
      <div class="ctx-item" id="ctxNpAdd"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg> 添加到歌单</div>
      ${song.song_mid ? `<div class="ctx-item" id="ctxNpShare"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg> 分享</div>` : ''}
      ${song.bvid ? `<div class="ctx-item" id="ctxNpCopy"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> 复制 Bilibili 链接</div>` : ''}
      ${song.bvid ? `<div class="ctx-item" id="ctxNpCache">${CACHE_ICON} 缓存到本地</div>` : ''}`;
    menu.style.left = Math.min(rect.left, window.innerWidth - 180) + 'px';
    menu.style.top = (rect.top - menu.offsetHeight - 4) + 'px';
    menu.classList.add('show');
    document.getElementById('ctxNpAdd').onclick = () => { menu.classList.remove('show'); import('./playlist-ui.js').then(({ addSongs }) => addSongs([song])); };
    const shareBtn = document.getElementById('ctxNpShare');
    if (shareBtn) shareBtn.onclick = () => { menu.classList.remove('show'); import('./share.js').then(({ openShareModal }) => openShareModal(song)); };
    const cpBtn = document.getElementById('ctxNpCopy');
    if (cpBtn) cpBtn.onclick = () => { menu.classList.remove('show'); copyBiliLink(song); };
    const cacheBtn = document.getElementById('ctxNpCache');
    if (cacheBtn) cacheBtn.onclick = () => {
      menu.classList.remove('show');
      import('./offlineCache.js').then(({ fetchAndStore }) => {
        toast('正在缓存到本地…');
        fetchAndStore(song.bvid, Auth.token, { pinned: true, videoSource: { bvid: song.bvid }, lyrics: null, song: { name: song.name, singer: song.singer } })
          .then(() => { toast('已缓存到本地（钉住）'); window.dispatchEvent(new CustomEvent('offline_cache_changed')); })
          .catch(e => toast('缓存失败：' + e.message));
      });
    };
    requestAnimationFrame(() => { menu.style.top = (rect.top - menu.offsetHeight - 4) + 'px'; });
  };

  // 帮助
  $('helpBtn').onclick = () => $('helpModal').classList.add('show');
  $('helpClose').onclick = () => $('helpModal').classList.remove('show');
  $('helpModal').onclick = (e) => { if (e.target.id === 'helpModal') $('helpModal').classList.remove('show'); };
}
