// 收藏的专辑
import { $, esc, toast, albumCover } from './utils.js';
import { api } from './api.js';
import { state } from './state.js';
import { setActiveNav } from './playlist-ui.js';
export async function openSavedAlbums() {
  state.view = 'savedAlbums';
  setActiveNav('navSavedAlbums');
  import('./main.js').then(({ navPush }) => navPush('savedAlbums'));
  import('./ui.js').then(({ updateAlbumCount }) => updateAlbumCount());
  const main = $('main');
  main.innerHTML = '<div class="loading">加载收藏的专辑…</div>';
  try {
    const { albums } = await api('/stats/albums');
    if (!albums.length) {
      main.innerHTML = `<div class="view-title"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg> 我的专辑</div><div class="empty">还没有收藏专辑<br><br>试试搜一个歌手，点击专辑进入详情页，然后点「收藏专辑」</div>`;
      return;
    }
    const grid = albums.map((a) => {
      const cover = albumCover(a.album_mid, 500);
      const tagPills = [a.genre, a.lan].filter(Boolean).map((t) => `<span class="album-pill">${esc(t)}</span>`).join('');
      const metaRow = [
        a.company ? `<span class="a-meta-item" title="发行公司"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4"/><path d="M9 9v.01M9 12v.01M9 15v.01M9 18v.01"/></svg> ${esc(a.company)}</span>` : '',
        a.aDate ? `<span class="a-meta-item" title="发行日期"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg> ${esc(a.aDate)}</span>` : '',
      ].filter(Boolean).join('');
      const desc = a.desc ? `<div class="a-desc">${esc(a.desc.slice(0, 60))}${a.desc.length > 60 ? '…' : ''}</div>` : '';
      return `<div class="album-card saved" data-mid="${esc(a.album_mid)}" data-name="${esc(a.name)}">
        <div class="cover">${cover ? `<img src="${cover}" loading="lazy" onerror="this.style.visibility='hidden'" />` : '<div class="ph"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg></div>'}
          <div class="cover-play" data-mid="${esc(a.album_mid)}" title="播放"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg></div>
        </div>
        <div class="a-name" title="${esc(a.name)}">${esc(a.name)}</div>
        <div class="a-singer">${esc(a.singer || '')}</div>
        ${desc}
        ${tagPills ? `<div class="a-pills">${tagPills}</div>` : ''}
        ${metaRow ? `<div class="a-meta">${metaRow}</div>` : ''}
        <div class="a-btns">
          <button class="btn sm green a-play-all" data-mid="${esc(a.album_mid)}"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg> 播放</button>
          <button class="a-del-album" data-mid="${esc(a.album_mid)}" title="取消收藏"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>
      </div>`;
    }).join('');
    main.innerHTML = `<div class="view-title"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg> 我的专辑（${albums.length}）</div><div class="album-grid" id="savedAlbumGrid">${grid}</div>`;

    // 点击卡片跳转专辑详情
    $('savedAlbumGrid').querySelectorAll('.album-card').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('button')) return; // 不拦截按钮点击
        import('./search.js').then(({ openAlbum }) => openAlbum(el.dataset.mid, el.dataset.name));
      });
      el.style.cursor = 'pointer';
    });
    // 播放
    // 保存每个按钮的原始 HTML，避免多次点击后丢失
    const btnOrigHTML = {};
    $('savedAlbumGrid').querySelectorAll('.a-play-all').forEach((btn) => {
      btnOrigHTML[btn.dataset.mid] = btn.innerHTML;
    });
    const playAlbum = async (mid) => {
      const btn = document.querySelector(`.a-play-all[data-mid="${CSS.escape(mid)}"]`);
      const origHTML = btnOrigHTML[mid];
      if (btn && origHTML) { btn.innerHTML = '<span>加载中…</span>'; btn.disabled = true; }
      try {
        const data = await api(`/music/album?mid=${encodeURIComponent(mid)}`);
        if (!data.songs?.length) { toast('这张专辑暂无歌曲'); return; }
        import('./player.js').then(({ playFromList }) => playFromList(data.songs, 0, 'album', null));
      } catch (err) { toast('加载失败：' + err.message); }
      finally { if (btn && origHTML) { btn.innerHTML = origHTML; btn.disabled = false; } }
    };
    $('savedAlbumGrid').querySelectorAll('.a-play-all').forEach((btn) => {
      btn.onclick = (e) => { e.stopPropagation(); playAlbum(btn.dataset.mid); };
    });
    $('savedAlbumGrid').querySelectorAll('.cover-play').forEach((el) => {
      el.onclick = (e) => { e.stopPropagation(); playAlbum(el.dataset.mid); };
    });
    // 取消收藏
    $('savedAlbumGrid').querySelectorAll('.a-del-album').forEach((btn) => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const mid = btn.dataset.mid;
        await api(`/stats/albums/${encodeURIComponent(mid)}`, { method: 'DELETE' });
        btn.closest('.album-card').remove();
        toast('已取消收藏');
      };
    });
  } catch (e) { main.innerHTML = `<div class="empty">加载失败：${esc(e.message)}</div>`; }
}
