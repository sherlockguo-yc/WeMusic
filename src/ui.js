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
    { label: '▶ 播放', act: 'play' },
    { label: '＋ 添加到歌单', act: 'add' },
    { sep: true },
    { label: '🔗 复制 Bilibili 链接', act: 'copy', dim: !song.bvid, dimTip: '请先播放一次以匹配资源' },
    { label: '🔍 在 Bilibili 搜索此歌', act: 'search' },
  ];
  if (inPlaylist) items.push({ sep: true }, { label: '✕ 从歌单移除', act: 'del', danger: true });
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
      if (act === 'play') import('./player.js').then(({ playFromList }) => playFromList(songs, i, context, playlistId));
      else if (act === 'add') import('./playlist-ui.js').then(({ addSongs }) => addSongs([song]));
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
      const kw = `${state.current.name} ${(state.current.singer || '').split('/')[0]}`;
      const r = await api(`/play/search?keyword=${encodeURIComponent(kw)}`);
      candidates = r.candidates; state.current._candidates = candidates;
    } catch (e) { list.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  }
  list.innerHTML = candidates.map((c, i) => `
    <div class="cand-row ${c.live ? 'live' : ''}" data-i="${i}">
      <div class="ct">
        <div class="title">${esc(c.title)}</div>
        <div class="meta">UP：${esc(c.author)} · ${fmtPlay(c.play)} 播放 · ${fmtDur(c.duration)}</div>
      </div>
      <span class="tag ${c.live ? 'live' : ''}">${c.live ? '现场' : '推荐'}</span>
    </div>`).join('');
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
      if (btn) { btn.textContent = '❤'; btn.classList.add('liked'); }
      toast('已添加到喜欢');
    } else {
      state.likedMids.delete(song.song_mid);
      if (btn) { btn.textContent = '🤍'; btn.classList.remove('liked'); }
      toast('已取消喜欢');
    }
  } catch (e) { toast('操作失败：' + e.message); }
}

export function updateNpLikeBtn() {
  const btn = $('npLikeBtn');
  if (!btn || !state.current) return;
  const liked = state.current.song_mid && state.likedMids.has(state.current.song_mid);
  btn.textContent = liked ? '❤' : '🤍';
  btn.classList.toggle('liked-active', !!liked);
  btn.title = liked ? '取消喜欢' : '喜欢';
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
