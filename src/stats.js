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

// ---- 全局 tooltip：单例 div + 索引化内容，避免 data-tip 属性内嵌 HTML 导致的问题 ----
const TIP_ID = '__stats_tooltip__';
let _tipRegistry = []; // { el, html } — 每个绑定元素的 tooltip HTML 内容

function getTip() {
  let el = document.getElementById(TIP_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = TIP_ID;
    el.style.cssText = 'display:none;position:fixed;z-index:9999;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;padding:5px 10px;font-size:12px;color:var(--text);pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,.15);white-space:nowrap;max-width:200px';
    document.body.appendChild(el);
  }
  return el;
}

// 绑定 tooltip：tipHtml 为可选参数；若不传，则用元素自身的 data-tip-text（纯文本索引）
function attachTip(el, tipHtml) {
  el.removeAttribute('title'); // 清除原生 title 干扰
  el.addEventListener('mouseenter', (e) => {
    const tip = getTip();
    tip.innerHTML = tipHtml || el.dataset.tipText || '';
    tip.style.display = 'block';
    tip.style.left = (e.clientX + 12) + 'px';
    tip.style.top = (e.clientY - 28) + 'px';
  });
  el.addEventListener('mousemove', (e) => {
    const tip = getTip();
    if (tip.style.display === 'none') return;
    tip.style.left = (e.clientX + 12) + 'px';
    tip.style.top = (e.clientY - 28) + 'px';
  });
  el.addEventListener('mouseleave', () => {
    getTip().style.display = 'none';
  });
}

export async function openStats() {
  state.view = 'stats';
  setActiveNav('navStats');
  import('./main.js').then(({ navPush }) => navPush('stats'));
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
    // 用本地日期（与后端 SQLite date(...,'localtime') 对齐），避免 UTC 时区偏移
    const fmtLocal = (d) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const dailyMap = new Map((daily.daily || []).map((d) => [d.day, d]));
    const days30 = Array.from({ length: 30 }, (_, i) => {
      const d = new Date(today); d.setDate(today.getDate() - 29 + i);
      const key = fmtLocal(d);
      const row = dailyMap.get(key);
      return {
        day: key, label: `${d.getMonth() + 1}/${d.getDate()}`,
        play_count: row?.play_count || 0,
        total_sec: row?.total_sec || 0,
      };
    });

    // 渲染柱状图（mode: 'count' | 'duration'）
    const BAR_PX = 250; // 与 CSS .bar-chart-wrap 柱区高度一致
    // 存储每个柱子的 tooltip HTML，渲染后用 attachTip 绑定
    let _barTipMap = [];
    function renderBarChart(mode) {
      const vals = days30.map((d) => mode === 'count' ? d.play_count : Math.round(d.total_sec / 60));
      const maxVal = Math.max(...vals, 1);
      _barTipMap = days30.map((d) => {
        return mode === 'count'
          ? `${d.label}<br><b>${d.play_count} 次</b> · ${fmtMin(d.total_sec)}`
          : `${d.label}<br><b>${fmtMin(d.total_sec)}</b> · ${d.play_count} 次`;
      });
      // 线性等比例：真实反映数值比例
      const bars = days30.map((d, i) => {
        const val = vals[i];
        const px = val > 0 ? Math.max(2, Math.round((val / maxVal) * BAR_PX)) : 0;
        const showLabel = val > 0;
        const valLabel = showLabel
          ? (mode === 'count' ? val : (d.total_sec >= 3600 ? Math.round(d.total_sec / 3600) + 'h' : Math.round(d.total_sec / 60) + 'm'))
          : '';
        return `<div class="bar-item" data-idx="${i}">
          ${valLabel ? `<div class="bar-val-label">${valLabel}</div>` : ''}
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
    const _hourTips = [];
    const hourHtml = Array.from({ length: 24 }, (_, i) => {
      const row = hourly.hourly.find((r) => r.hour === i);
      const cnt = row ? row.play_count : 0;
      const opacity = cnt ? 0.15 + (cnt / maxH) * 0.85 : 0;
      _hourTips[i] = `${i}:00 ~ ${i + 1}:00<br><b>${cnt} 次</b>`;
      return `<div class="hour-cell${cnt > 0 ? ' active' : ''}" data-idx="${i}"
        style="${cnt > 0 ? `background:rgba(29,185,84,${opacity.toFixed(2)});color:#fff` : ''}">${i}</div>`;
    }).join('');

    // 歌手条形图（次数 + 时长双行）
    const maxArtistPlay = Math.max(...topArtists.artists.map((a) => a.play_count), 1);
    const _artistTips = [];
    const artistBars = topArtists.artists.map((a, i) => {
      const pct = Math.round((a.play_count / maxArtistPlay) * 100);
      _artistTips[i] = `${esc(a.singer)}<br><b>${a.play_count} 次</b>　${fmtMin(a.total_sec || 0)}`;
      return `<div class="artist-bar-row" data-singer="${esc(a.singer)}" data-idx="${i}">
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

    // 绑定自定义 tooltip
    // 时段网格
    $('hourGrid').querySelectorAll('.hour-cell').forEach((el) => {
      const i = Number(el.dataset.idx);
      attachTip(el, _hourTips[i]);
    });
    // 歌手条形图
    $('artistBars').querySelectorAll('.artist-bar-row').forEach((el) => {
      const i = Number(el.dataset.idx);
      attachTip(el, _artistTips[i]);
    });

    // 次数/时长切换
    function bindBarChartTips() {
      $('barChart').querySelectorAll('.bar-item').forEach((el) => {
        const i = Number(el.dataset.idx);
        attachTip(el, _barTipMap[i]);
      });
    }
    main.querySelectorAll('.stats-bar-tab').forEach((btn) => {
      btn.onclick = () => {
        main.querySelectorAll('.stats-bar-tab').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const wrap = $('barChart');
        wrap.innerHTML = renderBarChart(btn.dataset.mode);
        bindBarChartTips();
      };
    });
    bindBarChartTips(); // 初始绑定

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
  import('./main.js').then(({ navPush }) => navPush('discover'));
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
  import('./main.js').then(({ navPush }) => navPush('likes'));
  const main = $('main');
  main.innerHTML = '<div class="loading">加载中…</div>';
  try {
    const { likes } = await api('/stats/likes');
    if (!likes.length) {
      main.innerHTML = '<div class="view-title">我喜欢的</div><div class="empty">还没有标记喜欢的歌曲</div>';
      return;
    }
    const songs = likes.map((l) => ({ ...l, id: null }));
    renderLikesView(main, songs);
  } catch (e) { main.innerHTML = `<div class="empty">加载失败：${esc(e.message)}</div>`; }
}

function renderLikesView(main, songs, mode = 'list') {
  if (mode === 'singer') {
    // 按歌手分组
    const groups = {};
    for (const s of songs) {
      const key = s.singer || '未知歌手';
      if (!groups[key]) groups[key] = [];
      groups[key].push(s);
    }
    // 按歌曲数量排序
    const sorted = Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
    const renderSingerGroups = (filter = '') => {
      const filtered = filter ? sorted.filter(([singer]) => singer.toLowerCase().includes(filter.toLowerCase())) : sorted;
      if (filtered.length === 0 && filter) {
        document.getElementById('likesSingerList').innerHTML = '<div class="empty">没有匹配的歌手</div>';
        return;
      }
      const html = filtered.map(([singer, ss]) => `
        <div class="likes-singer-group" data-singer-name="${esc(singer).toLowerCase()}">
          <div class="likes-singer-head">
            <span class="likes-singer-name">${esc(singer)}</span>
            <span class="likes-singer-cnt">${ss.length} 首</span>
            <button class="btn sm green likes-singer-play" data-singer="${esc(singer)}">▶ 播放</button>
          </div>
          <div class="song-list"></div>
        </div>
      `).join('');
      document.getElementById('likesSingerList').innerHTML = html;
      filtered.forEach(([singer, ss]) => {
        const group = document.querySelector(`.likes-singer-group[data-singer-name="${esc(singer).toLowerCase()}"]`);
        if (group) renderSongList(group.querySelector('.song-list'), ss, { showAdd: true });
      });
      // 播放按钮
      document.querySelectorAll('.likes-singer-play').forEach((btn) => {
        btn.onclick = () => {
          const s = btn.dataset.singer;
          const sss = songs.filter((x) => x.singer === s);
          import('./player.js').then(({ playFromList }) => playFromList(sss, 0, 'likes', null));
        };
      });
    };

    main.innerHTML = `<div class="view-title">我喜欢的（${songs.length} 首）
      <span class="likes-toggle">
        <button class="likes-tab active" data-tab="singer">按歌手</button>
        <button class="likes-tab" data-tab="list">列表</button>
      </span></div>
      <input class="likes-filter" id="likesFilter" placeholder="筛选歌手…" />
      <div id="likesSingerList"></div>`;
    renderSingerGroups();
    $('likesFilter').addEventListener('input', (e) => renderSingerGroups(e.target.value));
    bindLikesToggle(main, songs);
  } else {
    const colHeader = `<div class="song-row-head">
      <span class="h-idx">#</span><span class="h-name">歌名</span><span class="h-singer">歌手</span><span class="h-album">专辑</span><span class="h-bookmark"></span><span class="h-dur">时长</span><span class="h-ops"></span>
    </div>`;
    main.innerHTML = `<div class="view-title">我喜欢的（${songs.length} 首）
      <span class="likes-toggle">
        <button class="likes-tab" data-tab="singer">按歌手</button>
        <button class="likes-tab active" data-tab="list">列表</button>
      </span></div>${listToolsHtml()}${colHeader}<div class="song-list" id="likesList"></div>`;
    const container = $('likesList');
    renderSongList(container, songs, { showAdd: true });
    bindListTools(main, songs, container, null, null);
    bindLikesToggle(main, songs);
  }
}

function bindLikesToggle(main, songs) {
  main.querySelectorAll('.likes-tab').forEach((btn) => {
    btn.onclick = () => { renderLikesView(main, songs, btn.dataset.tab); };
  });
}

export function initStats() {
  $('navStats').onclick = openStats;
  $('navLikes').onclick = openLikesPage;
  $('navDiscover').onclick = openDiscover;
}
