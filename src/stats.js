// ---------------- 统计页、发现页、喜欢页 ----------------
import { $, esc, fmtSec, albumCover, toast } from './utils.js';
import { api } from './api.js';
import { state } from './state.js';
import { renderSongList, listToolsHtml, bindListTools, setActiveNav } from './playlist-ui.js';

const CHART_TABS = [
  { id: 26,  label: '🔥 热歌榜' },
  { id: 27,  label: '✨ 新歌榜' },
  { id: 4,   label: '📊 流行指数' },
  { id: 67,  label: '👂 识曲榜' },
];

// 格式化分钟数为可读字符串
function fmtMin(sec) {
  if (!sec) return '0 分钟';
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60), rm = m % 60;
  return rm ? `${h} 小时 ${rm} 分` : `${h} 小时`;
}

// 自定义 tooltip（即时显示，无延迟）
function bindTooltip(container) {
  const tip = document.createElement('div');
  tip.className = 'stats-tip';
  tip.style.cssText = 'display:none;position:fixed;z-index:9999;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;padding:5px 10px;font-size:12px;color:var(--text);pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,.15);white-space:nowrap';
  document.body.appendChild(tip);
  container.addEventListener('mouseover', (e) => {
    const el = e.target.closest('[data-tip]');
    if (!el) return;
    tip.innerHTML = el.dataset.tip;
    tip.style.display = 'block';
  });
  container.addEventListener('mousemove', (e) => {
    tip.style.left = (e.clientX + 12) + 'px';
    tip.style.top = (e.clientY - 28) + 'px';
  });
  container.addEventListener('mouseout', (e) => {
    if (!e.target.closest('[data-tip]')) tip.style.display = 'none';
  });
  container.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
  return tip;
}

export async function openStats() {
  state.view = 'stats';
  setActiveNav('navStats');
  const main = $('main');
  main.innerHTML = '<div class="loading">加载统计数据…</div>';
  try {
    const [ov, topSongs, topArtists, daily, hourly] = await Promise.all([
      api('/stats/overview'),
      api('/stats/top-songs?limit=10'),
      api('/stats/top-artists?limit=8'),
      api('/stats/daily?days=30'),
      api('/stats/hourly'),
    ]);

    const today = new Date();
    const dailyMap = new Map((daily.daily || []).map((d) => [d.day, d]));
    const days30 = Array.from({ length: 30 }, (_, i) => {
      const d = new Date(today); d.setDate(today.getDate() - 29 + i);
      const key = d.toISOString().slice(0, 10);
      const row = dailyMap.get(key);
      return {
        day: key, label: `${d.getMonth() + 1}/${d.getDate()}`,
        play_count: row?.play_count || 0,
        total_sec: row?.total_sec || 0,
      };
    });

    // 渲染柱状图（mode: 'count' | 'duration'）
    // 结构：.bar-chart-wrap > .bar-chart-new（柱子）+ .bar-chart-axis（x轴标签）
    const BAR_PX = 90; // 柱子区域高度（px），与 CSS .bar-chart-wrap height 保持一致
    function renderBarChart(mode) {
      const vals = days30.map((d) => mode === 'count' ? d.play_count : Math.round(d.total_sec / 60));
      const maxVal = Math.max(...vals, 1);
      const bars = days30.map((d, i) => {
        const val = vals[i];
        const px = val ? Math.max(3, Math.round((val / maxVal) * BAR_PX)) : 0;
        const tipContent = mode === 'count'
          ? `${d.label}<br><b>${d.play_count} 次</b> · ${fmtMin(d.total_sec)}`
          : `${d.label}<br><b>${fmtMin(d.total_sec)}</b> · ${d.play_count} 次`;
        const valLabel = val > 0 ? (mode === 'count' ? val : Math.round(d.total_sec / 60) + 'm') : '';
        return `<div class="bar-item" data-tip="${tipContent}">
          <div class="bar-val-label">${valLabel}</div>
          <div class="bar-fill" style="height:${px}px"></div>
        </div>`;
      }).join('');
      const axis = days30.map((d, i) => {
        const showLabel = i === 0 || i === 14 || i === 29;
        return `<div class="bar-axis-item">${showLabel ? d.label : ''}</div>`;
      }).join('');
      return `<div class="bar-chart-new">${bars}</div><div class="bar-chart-axis">${axis}</div>`;
    }

    // 时段分布（次数）
    const maxH = Math.max(...hourly.hourly.map((h) => h.play_count), 1);
    const hourHtml = Array.from({ length: 24 }, (_, i) => {
      const row = hourly.hourly.find((r) => r.hour === i);
      const cnt = row ? row.play_count : 0;
      const opacity = cnt ? 0.15 + (cnt / maxH) * 0.85 : 0;
      const tipStr = `${i}:00 ~ ${i + 1}:00<br><b>${cnt} 次</b>`;
      return `<div class="hour-cell${cnt > 0 ? ' active' : ''}"
        style="${cnt > 0 ? `background:rgba(29,185,84,${opacity.toFixed(2)});color:#fff` : ''}"
        data-tip="${tipStr}">${i}</div>`;
    }).join('');

    // 歌手条形图（次数 + 时长双行）
    const maxArtistPlay = Math.max(...topArtists.artists.map((a) => a.play_count), 1);
    const artistBars = topArtists.artists.map((a) => {
      const pct = Math.round((a.play_count / maxArtistPlay) * 100);
      const tipStr = `${esc(a.singer)}<br><b>${a.play_count} 次</b>　${fmtMin(a.total_sec || 0)}`;
      return `<div class="artist-bar-row" data-singer="${esc(a.singer)}" data-tip="${tipStr}">
        <div class="artist-bar-name">${esc(a.singer)}</div>
        <div class="artist-bar-wrap"><div class="artist-bar-fill" style="width:${pct}%"></div></div>
        <div class="artist-bar-val">${a.play_count}次</div>
      </div>`;
    }).join('');

    // 近30天汇总
    const sum30Plays = days30.reduce((s, d) => s + d.play_count, 0);
    const sum30Sec = days30.reduce((s, d) => s + d.total_sec, 0);

    main.innerHTML = `
      <div class="view-title">我的数据</div>
      <div class="stats-overview">
        <div class="stat-ov-card accent"><div class="soc-val">${ov.plays}</div><div class="soc-label">总播放次数</div></div>
        <div class="stat-ov-card accent2"><div class="soc-val">${fmtSec(ov.total_sec)}</div><div class="soc-label">总播放时长</div></div>
        <div class="stat-ov-card"><div class="soc-val">${ov.unique_songs}</div><div class="soc-label">不重复歌曲</div></div>
        <div class="stat-ov-card"><div class="soc-val">${ov.active_days}</div><div class="soc-label">听歌天数</div></div>
      </div>
      <div class="stats-two-col">
        <div class="stats-panel">
          <div class="stats-panel-hd">
            <div class="stats-panel-title">最近 30 天趋势
              <span class="stats-sub">共 ${sum30Plays} 次 · ${fmtMin(sum30Sec)}</span>
            </div>
            <div class="stats-bar-tabs">
              <button class="stats-bar-tab active" data-mode="count">次数</button>
              <button class="stats-bar-tab" data-mode="duration">时长</button>
            </div>
          </div>
          <div class="bar-chart-wrap" id="barChart">
            ${days30.some((d) => d.play_count > 0) ? renderBarChart('count') : '<div class="stats-empty">暂无数据</div>'}
          </div>
        </div>
        <div class="stats-panel">
          <div class="stats-panel-hd">
            <div class="stats-panel-title">听歌时段分布</div>
          </div>
          <div class="hour-grid" id="hourGrid">${hourHtml}</div>
        </div>
      </div>
      <div class="stats-two-col">
        <div class="stats-panel">
          <div class="stats-panel-title">最爱歌手</div>
          <div class="artist-bars" id="artistBars">${artistBars || '<div class="stats-empty">暂无数据</div>'}</div>
        </div>
        <div class="stats-panel">
          <div class="stats-panel-title">最常播放 Top 10</div>
          <div class="top-songs-list" id="statsTopSongs"></div>
        </div>
      </div>`;

    // 绑定自定义 tooltip（barChart 在切换逻辑里绑定）
    bindTooltip($('hourGrid'));
    bindTooltip($('artistBars'));

    // 次数/时长切换：更新 wrap 内容，重新绑 tooltip
    main.querySelectorAll('.stats-bar-tab').forEach((btn) => {
      btn.onclick = () => {
        main.querySelectorAll('.stats-bar-tab').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const wrap = $('barChart');
        wrap.innerHTML = renderBarChart(btn.dataset.mode);
        // tooltip 绑在 .bar-chart-new 上
        const chartInner = wrap.querySelector('.bar-chart-new');
        if (chartInner) bindTooltip(chartInner);
      };
    });
    // 初始 tooltip 绑定
    const initChartInner = $('barChart').querySelector('.bar-chart-new');
    if (initChartInner) { bindTooltip(initChartInner); }

    $('statsTopSongs').innerHTML = topSongs.songs.length
      ? topSongs.songs.map((s, i) => `
        <div class="top-song-row" data-i="${i}">
          <span class="ts-rank">${i + 1}</span>
          <div class="ts-info"><div class="ts-name">${esc(s.name)}</div><div class="ts-singer">${esc(s.singer || '')}</div></div>
          <div class="ts-meta">
            <span class="ts-cnt">${s.play_count}次</span>
            <span class="ts-dur">${fmtMin(s.total_sec || 0)}</span>
            <button class="icon-btn play ts-play" title="播放" data-i="${i}">▶</button>
          </div>
        </div>`).join('')
      : '<div class="stats-empty">还没有播放记录</div>';

    $('statsTopSongs').querySelectorAll('.ts-play').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const i = Number(btn.dataset.i);
        import('./player.js').then(({ playFromList }) => playFromList(topSongs.songs, i, 'stats', null));
      };
    });
    main.querySelectorAll('.artist-bar-row').forEach((row) => {
      row.style.cursor = 'pointer';
      row.onclick = () => { $('searchInput').value = row.dataset.singer; import('./search.js').then(({ doSearch }) => doSearch()); };
    });
  } catch (e) { main.innerHTML = `<div class="empty">加载失败：${esc(e.message)}</div>`; }
}

export async function openDiscover() {
  state.view = 'discover';
  setActiveNav('navDiscover');
  const main = $('main');
  main.innerHTML = `
    <div class="view-title">发现音乐</div>
    <div class="discover-tabs" id="discoverTabs">
      <button class="disc-tab active" data-tab="recommend">🎵 为你推荐</button>
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
            <div style="font-size:40px;margin-bottom:16px">🎵</div>
            <div>多听一些歌曲后，这里会根据你的喜好为你推荐</div>
            <div style="color:var(--text-dim);font-size:13px;margin-top:8px">
              推荐基于：❤️ 红心 · 加入歌单 · 完播率 · 重复播放次数
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
            <div class="rec-title">根据你的兴趣推荐</div>
            <div class="rec-artists">偏好：${artistTags}</div>
            <div class="rec-hint">推荐综合了：❤️ 喜欢 · 歌单收藏 · 完播率 · 重复收听 · 同风格扩散</div>
          </div>`;
      } else if (data.artists?.length) {
        headerHtml = `<div class="discover-based-on">基于你喜欢的：${data.artists.slice(0, 4).map(esc).join(' · ')}</div>`;
      }

      container.innerHTML = `${headerHtml}<div class="song-list" id="discoverList"></div>`;
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
    const cover = s.album_mid ? albumCover(s.album_mid, 80) : '';
    return `<div class="chart-row" data-i="${i}">
      <span class="chart-rank ${rankClass}">${rank}</span>
      ${cover ? `<img class="chart-cover" src="${cover}" loading="lazy" onerror="this.style.display='none'" />` : '<div class="chart-cover-ph">♪</div>'}
      <div class="chart-info"><div class="chart-name">${esc(s.name)}</div><div class="chart-singer">${esc(s.singer || '')}</div></div>
      <div class="chart-ops"><button class="icon-btn play" title="播放" data-act="play">▶</button><button class="icon-btn" title="添加到歌单" data-act="add">＋</button></div>
    </div>`;
  }).join('');
  container.querySelectorAll('.chart-row').forEach((row) => {
    const i = Number(row.dataset.i);
    row.querySelector('[data-act="play"]').onclick = (e) => { e.stopPropagation(); import('./player.js').then(({ playFromList }) => playFromList(songs, i, 'chart', null)); };
    row.querySelector('[data-act="add"]').onclick = (e) => { e.stopPropagation(); import('./playlist-ui.js').then(({ addSongs }) => addSongs([songs[i]])); };
    row.onclick = () => import('./player.js').then(({ playFromList }) => playFromList(songs, i, 'chart', null));
  });
}

export async function openLikesPage() {
  state.view = 'likes';
  setActiveNav('navLikes');
  const main = $('main');
  main.innerHTML = '<div class="loading">加载中…</div>';
  try {
    const { likes } = await api('/stats/likes');
    if (!likes.length) {
      main.innerHTML = '<div class="view-title">我喜欢的</div><div class="empty">还没有标记喜欢的歌曲</div>';
      return;
    }
    main.innerHTML = `<div class="view-title">我喜欢的（${likes.length} 首）</div>${listToolsHtml()}<div class="song-list" id="likesList"></div>`;
    const songs = likes.map((l) => ({ ...l, id: null }));
    const container = $('likesList');
    renderSongList(container, songs, { showAdd: true });
    bindListTools(main, songs, container, null, null);
  } catch (e) { main.innerHTML = `<div class="empty">加载失败：${esc(e.message)}</div>`; }
}

export function initStats() {
  $('navStats').onclick = openStats;
  $('navLikes').onclick = openLikesPage;
  $('navDiscover').onclick = openDiscover;
}
