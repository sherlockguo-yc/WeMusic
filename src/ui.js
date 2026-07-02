// ---------------- 通用 UI：右键菜单、换源、喜欢、弹幕 ----------------
import { $, esc, fmtDur, fmtPlay, toast } from './utils.js';
import { api } from './api.js';
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
    { label: '＋ 添加到歌单', act: 'add' },
    { sep: true },
    { label: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> 复制 Bilibili 链接', act: 'copy', dim: !song.bvid, dimTip: '请先播放一次以匹配资源' },
    { label: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg> 在 Bilibili 搜索此歌', act: 'search' },
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
      if (act === 'add') import('./playlist-ui.js').then(({ addSongs }) => addSongs([song]));
      else if (act === 'del') import('./playlist-ui.js').then(({ deleteSong }) => deleteSong(playlistId, song.id, row));
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
  let blockedList = [];
  try {
    const r = await api(`/stats/blocked/full?song=${encodeURIComponent(songKey)}&type=video`);
    blockedList = r.list || [];
  } catch {}
  list.innerHTML = candidates.map((c, i) => {
    const isCurrent = c.bvid && c.bvid === currentBvid;
    return `
    <div class="cand-row ${c.live ? 'live' : ''}${isCurrent ? ' current' : ''}" data-i="${i}">
      <span class="cand-rank">${i + 1}</span>
      <div class="ct">
        <div class="title">${esc(c.title)}</div>
        <div class="meta">UP：${esc(c.author)} · ${fmtPlay(c.play)} 播放 · ${fmtDur(c.duration)}</div>
      </div>
      <span class="tag ${c.live ? 'live' : ''}${isCurrent ? ' current' : ''}">${isCurrent ? '当前' : (c.live ? '现场' : '推荐')}</span>
      <button class="cand-block-btn" title="屏蔽此视频源，以后不再出现"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>`;
  }).join('') + (blockedList.length ? `
    <div class="cand-blocked-section">
      <button class="cand-blocked-toggle" id="candBlockedToggle">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        已屏蔽的源（${blockedList.length}）
      </button>
      <div class="cand-blocked-list" id="candBlockedList" style="display:none">
        ${blockedList.map(b => `
          <div class="cand-blocked-row" data-bvid="${esc(b.source_id)}">
            <span class="cand-blocked-id">${esc(b.source_id)}</span>
            <span class="cand-blocked-time">${new Date(b.blocked_at).toLocaleDateString()}</span>
            <button class="cand-unblock-btn" title="取消屏蔽"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9"/><polyline points="3 4 3 9 8 9"/></svg> 恢复</button>
          </div>
        `).join('')}
      </div>
    </div>
  ` : '');

  list.querySelectorAll('.cand-row').forEach((row) => {
    row.onclick = () => {
      const c = candidates[Number(row.dataset.i)];
      state.current.bvid = c.bvid; state.current._biliTitle = c.title;
      state.current._biliDur = c.duration || state.current.duration;
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
      const c = candidates[Number(row.dataset.i)];
      try {
        await api('/stats/blocked', { method: 'POST', body: { song: songKey, type: 'video', sourceId: c.bvid } });
        // 从列表移除
        candidates = candidates.filter((_, j) => j !== Number(row.dataset.i));
        state.current._candidates = candidates;
        row.remove();
        toast('已屏蔽，刷新后不再出现');
      } catch (err) { toast('屏蔽失败：' + err.message); }
    };
  });

  // 已屏蔽列表 - 折叠切换
  const toggle = $('candBlockedToggle');
  if (toggle) {
    toggle.onclick = () => {
      const bl = $('candBlockedList');
      const show = bl.style.display === 'none';
      bl.style.display = show ? '' : 'none';
    };
  }
  // 已屏蔽列表 - 恢复按钮
  list.querySelectorAll('.cand-unblock-btn').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const row = btn.closest('.cand-blocked-row');
      const bvid = row.dataset.bvid;
      try {
        await api('/stats/blocked', { method: 'DELETE', body: { song: songKey, type: 'video', sourceId: bvid } });
        row.remove();
        // 标记 candidates 缓存失效，下次打开弹窗会重新拉取
        state.current._candidates = null;
        toast('已取消屏蔽，下次换源时会重新出现');
      } catch (err) { toast('恢复失败：' + err.message); }
    };
  });
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
  } catch { /* ignore */ }
}

export function initUI() {
  // 换源
  $('switchSrcBtn').onclick = openCandModal;
  $('vpSwitch').onclick = openCandModal;
  $('candClose').onclick = () => $('candModal').classList.remove('show');
  $('candModal').onclick = (e) => { if (e.target.id === 'candModal') $('candModal').classList.remove('show'); };

  // 播放器喜欢 + 三点菜单
  $('npLikeBtn').onclick = async () => {
    if (!state.current) return toast('当前没有播放的歌曲');
    await toggleLike(state.current, null);
    updateNpLikeBtn();
  };
  $('npMoreBtn').onclick = (e) => {
    e.stopPropagation();
    if (!state.current) return toast('当前没有播放的歌曲');
    const song = state.current;
    const btn = $('npMoreBtn');
    const rect = btn.getBoundingClientRect();
    const menu = $('ctxMenu');
    menu.innerHTML = `
      <div class="ctx-item" id="ctxNpAdd">＋ 添加到歌单</div>
      ${song.bvid ? `<div class="ctx-item" id="ctxNpCopy">⎘ 复制 Bilibili 链接</div>` : ''}`;
    menu.style.left = Math.min(rect.left, window.innerWidth - 180) + 'px';
    menu.style.top = (rect.top - menu.offsetHeight - 4) + 'px';
    menu.classList.add('show');
    document.getElementById('ctxNpAdd').onclick = () => { menu.classList.remove('show'); import('./playlist-ui.js').then(({ addSongs }) => addSongs([song])); };
    const cpBtn = document.getElementById('ctxNpCopy');
    if (cpBtn) cpBtn.onclick = () => { menu.classList.remove('show'); copyBiliLink(song); };
    requestAnimationFrame(() => { menu.style.top = (rect.top - menu.offsetHeight - 4) + 'px'; });
  };

  // 帮助
  $('helpBtn').onclick = () => $('helpModal').classList.add('show');
  $('helpClose').onclick = () => $('helpModal').classList.remove('show');
  $('helpModal').onclick = (e) => { if (e.target.id === 'helpModal') $('helpModal').classList.remove('show'); };
}
