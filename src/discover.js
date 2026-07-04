// 发现页
import { $, esc, albumCover, toast, fmtFullMin, rankBadge, setTooltip, songColHeader } from './utils.js';
import { api } from './api.js';
import { state } from './state.js';
import { renderSongList, setActiveNav } from './playlist-ui.js';
const CHART_TABS = [
  { id: 26,  label: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg> 热歌榜` },
  { id: 27,  label: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> 新歌榜` },
  { id: 4,   label: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg> 流行指数` },
];
export async function openDiscover() {
  state.view = 'discover';
  setActiveNav('navDiscover');
  import('./main.js').then(({ navPush }) => navPush('discover'));
  const main = $('main');
  main.innerHTML = `
    <div class="view-title">发现音乐</div>
    <div class="discover-tabs" id="discoverTabs">
      <button class="disc-tab active" data-tab="recommend"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/></svg> 为你推荐</button>
      ${CHART_TABS.map((t) => `<button class="disc-tab" data-tab="chart-${t.id}">${t.label}</button>`).join('')}
    </div>
    <div id="discoverContent"><div class="loading">加载中…</div></div>`;

  main.querySelectorAll('.disc-tab').forEach((btn) => {
    btn.onclick = async () => {
      main.querySelectorAll('.disc-tab').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      await loadDiscoverTab(btn.dataset.tab);
    };
  });
  await loadDiscoverTab('recommend');
}

async function loadDiscoverTab(tab) {
  const container = $('discoverContent');
  container.innerHTML = '<div class="loading">加载中…</div>';
  try {
    if (tab === 'recommend') {
      const data = await api('/stats/recommend');
      if (!data.songs.length) {
        container.innerHTML = `
          <div class="discover-empty">
            <div style="font-size:40px;margin-bottom:16px"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>
            <div>多听一些歌曲后，这里会根据你的喜好为你推荐</div>
            <div style="color:var(--text-dim);font-size:13px;margin-top:8px">
              推荐基于：<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg> 红心 · 加入歌单 · 完播率 · 重复播放次数
            </div>
          </div>`;
        return;
      }

      // 展示推荐依据
      let headerHtml = '';
      if (data.reason === 'cold_start') {
        headerHtml = `<div class="discover-based-on">当前为热门推荐，多听几首歌曲后将根据你的口味个性化推荐</div>`;
      } else if (data._stats?.top_artists?.length) {
        const artistTags = data._stats.top_artists.slice(0, 4).map((a) =>
          `<span class="rec-artist-tag">${esc(a.name)}</span>`
        ).join('');
        headerHtml = `
          <div class="rec-header">
            <div class="rec-title">根据你的兴趣推荐
              <span class="rec-help" data-tip-text="推荐综合了：喜欢 · 歌单收藏 · 完播率 · 重复收听 · 同风格扩散"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg></span>
            </div>
            <div class="rec-artists">偏好：${artistTags}</div>
          </div>`;
      } else if (data.artists?.length) {
        headerHtml = `<div class="discover-based-on">基于你喜欢的：${data.artists.slice(0, 4).map(esc).join(' · ')}</div>`;
      }

      container.innerHTML = `${headerHtml}${songColHeader}<div class="song-list" id="discoverList"></div>`;
      // 推荐说明 tooltip（立即出现，不走 title 属性延迟）
      const recHelp = container.querySelector('.rec-help');
      if (recHelp) setTooltip(recHelp, recHelp.dataset.tipText);
      renderSongList($('discoverList'), data.songs, { showAdd: true });
    } else {
      const topId = tab.replace('chart-', '');
      const data = await api(`/stats/chart/${topId}`);
      container.innerHTML = `<div class="chart-meta">${data.cached ? '<span class="chart-cached">已缓存</span>' : '<span class="chart-fresh">实时</span>'}</div><div class="song-list" id="discoverList"></div>`;
      renderChartList($('discoverList'), data.songs.map((s, i) => ({ ...s, _chartRank: i + 1 })));
    }
  } catch (e) { container.innerHTML = `<div class="empty">加载失败：${esc(e.message)}</div>`; }
}

function renderChartList(container, songs) {
  if (!songs.length) { container.innerHTML = '<div class="empty">暂无数据</div>'; return; }
  container.innerHTML = songs.map((s, i) => {
    const rank = s._chartRank || i + 1;
    const rankClass = rank <= 3 ? `rank-top rank-${rank}` : 'rank-normal';
    const cover = s.album_mid ? albumCover(s.album_mid, 150) : ''; // QQ 音乐最小支持 150x150
    return `<div class="chart-row" data-i="${i}">
      <span class="chart-rank ${rankClass}">${rank}</span>
      ${cover ? `<img class="chart-cover" src="${cover}" loading="lazy" data-song="${esc(s.name)}" data-url="${cover}" />` : '<div class="chart-cover-ph"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>'}
      <div class="chart-info"><div class="chart-name">${esc(s.name)}${s.album ? ` <span class="chart-album">${esc(s.album)}</span>` : ''}</div><div class="chart-singer">${esc(s.singer || '')}</div></div>
      <div class="chart-ops"><button class="icon-btn play" title="播放" data-act="play"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg></button><button class="icon-btn" title="添加到歌单" data-act="add"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg></button></div>
    </div>`;
  }).join('');
  // 封面加载失败 → 显示占位图标
  container.querySelectorAll('.chart-cover').forEach((img) => {
    img.addEventListener('error', () => {
      const ph = document.createElement('div');
      ph.className = 'chart-cover-ph';
      ph.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
      img.replaceWith(ph);
    });
  });
  container.querySelectorAll('.chart-row').forEach((row) => {
    const i = Number(row.dataset.i);
    row.querySelector('[data-act="play"]').onclick = (e) => { e.stopPropagation(); import('./player.js').then(({ playFromList }) => playFromList(songs, i, 'chart', null)); };
    row.querySelector('[data-act="add"]').onclick = (e) => { e.stopPropagation(); import('./playlist-ui.js').then(({ addSongs }) => addSongs([songs[i]])); };
    row.onclick = () => import('./player.js').then(({ playFromList }) => playFromList(songs, i, 'chart', null));
  });
}
