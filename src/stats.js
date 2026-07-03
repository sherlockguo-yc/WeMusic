// ---------------- 统计页、发现页、喜欢页 ----------------
import { $, esc, fmtSec, albumCover, toast } from './utils.js';
import { api, Auth } from './api.js';
import { state } from './state.js';
import { renderSongList, listToolsHtml, bindListTools, setActiveNav } from './playlist-ui.js';
import html2canvas from 'html2canvas';
import { posterHTML, posterCSS, POSTER_THEME_LIST } from '../shared/poster-template.js';

const CHART_TABS = [
  { id: 26,  label: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg> 热歌榜` },
  { id: 27,  label: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> 新歌榜` },
  { id: 4,   label: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg> 流行指数` },
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

function getTip() {
  let el = document.getElementById(TIP_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = TIP_ID;
    el.style.cssText = 'display:none;position:fixed;z-index:9999;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;padding:5px 10px;font-size:12px;color:var(--text);pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,.15);white-space:nowrap';
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

// ============================================================
// 本周 / 本月听歌报告：共用渲染逻辑（后端 /stats/weekly 和 /stats/monthly 返回相同结构）
// ============================================================

function timeLabel(h) {
  if (h == null) return null;
  if (h >= 5 && h < 9)  return { label: '清晨', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 10V2"/><path d="m4.93 10.93 1.41 1.41"/><path d="M2 18h2"/><path d="M20 18h2"/><path d="m19.07 10.93-1.41 1.41"/><path d="M22 22H2"/><path d="m8 6 4-4 4 4"/><path d="M16 18a4 4 0 0 0-8 0"/></svg>' };
  if (h >= 9 && h < 12) return { label: '上午', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>' };
  if (h >= 12 && h < 14) return { label: '午间', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="M20 12h2"/><path d="m19.07 4.93-1.41 1.41"/><path d="M12 7a5 5 0 0 0-4.546 2.914A5 5 0 1 0 12 17a5 5 0 0 0 4.546-2.086A5 5 0 0 0 12 7Z"/></svg>' };
  if (h >= 14 && h < 18) return { label: '午后', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 10V2"/><path d="m4.93 10.93 1.41 1.41"/><path d="M2 18h2"/><path d="M20 18h2"/><path d="m19.07 10.93-1.41 1.41"/><path d="M22 22H2"/><path d="m8 6 4-4 4 4"/><path d="M16 18a4 4 0 0 0-8 0"/></svg>' };
  if (h >= 18 && h < 22) return { label: '晚间', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 10V2"/><path d="m4.93 10.93 1.41 1.41"/><path d="M2 18h2"/><path d="M20 18h2"/><path d="m19.07 10.93-1.41 1.41"/><path d="M22 22H2"/><path d="m8 6 4-4 4 4"/><path d="M16 18a4 4 0 0 0-8 0"/></svg>' };
  return { label: '深夜', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>' };
}

// 音乐人设标签（正向、音乐品味导向），week/month 复用同一套规则，仅阈值按周期缩放
function computePersona(data, avgSec, compHighPct, periodWord) {
  const scale = periodWord === '本月' ? 3 : 1; // 月度数据量级更大，阈值等比放宽
  const topArtist = data.topArtists[0];
  const topArtistShare = topArtist && data.period.plays ? topArtist.play_count / data.period.plays : 0;
  const artistName = topArtist?.singer || '';
  if (topArtistShare > 0.4) return { icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`, label: `${artistName} 铁粉`, desc: `${periodWord}最爱 ${artistName}，占了超四成播放` };
  if (data.uniqueArtists > 30 * scale) return { icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21 3 6"/><line x1="9" x2="9" y1="3" y2="18"/><line x1="15" x2="15" y1="3" y2="18"/></svg>', label: '音乐探险家', desc: `${periodWord}邂逅了 ${data.uniqueArtists} 位歌手` };
  if (data.newSongs > 15 * scale) return { icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m10 6 6 6"/><path d="M17 3a4 4 0 0 1 0 8h-3.5"/><path d="M3 18v-2a4 4 0 0 1 4-4h2.5"/><circle cx="13" cy="13" r="2.5"/></svg>', label: '新曲猎人', desc: `${periodWord}新发现了 ${data.newSongs} 首歌` };
  if (avgSec > 240) return { icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>', label: '深度聆听者', desc: '平均每首歌聆听超过 4 分钟' };
  if (compHighPct > 55) return { icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21V5a2 2 0 0 1 2-2h6.5L20 6.5a2 2 0 0 1 0 2.83L12 17H10a2 2 0 0 0-2 2v2"/><circle cx="14" cy="18" r="2"/></svg>', label: '沉浸鉴赏家', desc: '超过半数的歌都完整听完' };
  if (data.uniqueArtists > 15 * scale) return { icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.5 0 2.5 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.5 0 2.5 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.5 0 2.5 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/></svg>', label: '多元品味家', desc: '风格广泛，不设边界' };
  return { icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>', label: '自由旋律人', desc: '按自己的节奏享受音乐' };
}

// 个性化听歌小结（时段 + 最爱歌手），同时返回 html（应用内展示）和 plain（海报纯文本）
function computeInsight(peakHour, topArtistName, periodWord) {
  const peak = timeLabel(peakHour);
  if (peak && topArtistName) {
    return {
      html: `${peak.icon} ${periodWord}你最常在<b>${peak.label}</b>（${peakHour}:00 左右）听歌，最爱的旋律来自 <b>${esc(topArtistName)}</b>`,
      plain: `${periodWord}你最常在${peak.label}时段听歌，最爱的旋律来自 ${topArtistName}`,
    };
  }
  if (peak) {
    return {
      html: `${peak.icon} ${periodWord}你最常在<b>${peak.label}</b>（${peakHour}:00 左右）听歌`,
      plain: `${periodWord}你最常在${peak.label}时段听歌`,
    };
  }
  if (topArtistName) {
    return { html: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3v5Z"/><path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3v5Z"/></svg> ${periodWord}你最爱的旋律来自 <b>${esc(topArtistName)}</b>`, plain: `${periodWord}你最爱的旋律来自 ${topArtistName}` };
  }
  return { html: '', plain: '' };
}

function buildTrendHtml(trend) {
  const trendMax = Math.max(...trend.map((w) => w.plays), 1);
  return trend.map((w, i) => `
    <div class="tr-col${i === trend.length - 1 ? ' current' : ''}">
      <div class="tr-bar-wrap"><div class="tr-bar" style="height:${Math.round(w.plays / trendMax * 100)}%"></div></div>
      <div class="tr-val">${w.plays}</div>
      <div class="tr-label">${esc(w.label)}</div>
    </div>
  `).join('');
}

const rankBadge = (i) => `<span class="wr-rank r${i + 1 <= 3 ? i + 1 : 0}">${i + 1}</span>`;

/** 构建周报/月报卡片 HTML + 分享海报所需数据 */
function buildReportHtml(data, periodType) {
  const isWeek = periodType === 'week';
  const periodWord = isWeek ? '本周' : '本月';
  const title = isWeek ? '本周听歌报告' : '本月听歌报告';
  const trendTitle = isWeek ? '近 4 周趋势' : '近 6 月趋势';

  const skipPct = data.skip.total ? Math.round(data.skip.skipped / data.skip.total * 100) : 0;
  const compTotal = data.completion.low + data.completion.mid + data.completion.high || 1;
  const compLowPct  = Math.round(data.completion.low / compTotal * 100);
  const compMidPct  = Math.round(data.completion.mid / compTotal * 100);
  const compHighPct = 100 - compLowPct - compMidPct;

  const vsPlays = data.period.plays - data.lastPeriod.plays;
  const vsPlaysStr = vsPlays >= 0 ? `↑${vsPlays}` : `↓${Math.abs(vsPlays)}`;
  const vsSecStr = data.period.sec > data.lastPeriod.sec ? '↑' : (data.period.sec < data.lastPeriod.sec ? '↓' : '→');

  const avgSec = data.period.plays ? Math.round(data.period.sec / data.period.plays) : 0;
  const persona = computePersona(data, avgSec, compHighPct, periodWord);
  const topArtistName = data.topArtists[0]?.singer;
  const insight = computeInsight(data.peakHour, topArtistName, periodWord);
  const trendHtml = buildTrendHtml(data.trend);

  const html = `
    <div class="weekly-report">
      <div class="wr-head">
        <div class="wr-head-title">
          <span class="wr-head-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg></span>
          <div>
            <div class="wr-title">${title}</div>
            <div class="wr-date">${esc(data.label)}</div>
          </div>
        </div>
        ${insight.html ? `<div class="wr-insight">${insight.html}</div>` : ''}
      </div>

      <div class="wr-overview">
        <div class="wr-stat">
          <div class="wr-stat-icon c1"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3v5Z"/><path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3v5Z"/></svg></div>
          <div class="wr-stat-body"><div class="wr-val">${data.period.plays}</div><div class="wr-label">播放次数</div></div>
          <div class="wr-trend ${vsPlays >= 0 ? 'up' : 'down'}">${vsPlaysStr}</div>
        </div>
        <div class="wr-stat">
          <div class="wr-stat-icon c2"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>
          <div class="wr-stat-body"><div class="wr-val">${fmtMin(data.period.sec)}</div><div class="wr-label">播放时长</div></div>
          <div class="wr-trend ${data.period.sec >= data.lastPeriod.sec ? 'up' : 'down'}">${vsSecStr}</div>
        </div>
        <div class="wr-stat">
          <div class="wr-stat-icon c3"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>
          <div class="wr-stat-body"><div class="wr-val">${data.period.uniqueSongs}</div><div class="wr-label">不重复歌曲</div></div>
        </div>
        <div class="wr-stat">
          <div class="wr-stat-icon c4"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg></div>
          <div class="wr-stat-body"><div class="wr-val">${data.period.days}</div><div class="wr-label">听歌天数</div></div>
        </div>
      </div>

      <div class="wr-grid">
        <div class="wr-card songs">
          <div class="wr-card-hd"><span class="wr-card-icon i-song"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></span>Top 歌曲</div>
          <ol class="wr-list wr-top-songs">${data.topSongs.slice(0, 5).map((s, i) => {
            const coverUrl = s.album_mid ? albumCover(s.album_mid, 80) : '';
            return `<li>
              ${coverUrl ? `<img class="wr-song-cover" src="${coverUrl}" loading="lazy" onerror="this.style.display='none'" />` : ''}
              ${rankBadge(i)}
              <div class="wr-li-info">
                <div class="wr-li-name">${esc(s.name)}</div>
                <div class="wr-li-sub">${esc(s.singer)}${s.album ? ` · ${esc(s.album)}` : ''}</div>
              </div>
              <span>${s.play_count}次</span>
            </li>`;
          }).join('') || '<li class="wr-empty">暂无</li>'}</ol>
        </div>
        <div class="wr-card artists">
          <div class="wr-card-hd"><span class="wr-card-icon i-artist"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg></span>Top 歌手</div>
          <ol class="wr-list">${data.topArtists.map((a, i) => `<li>${rankBadge(i)}<div class="wr-li-info"><div class="wr-li-name">${esc(a.singer)}</div><div class="wr-li-sub">${fmtMin(a.total_sec || 0)}</div></div><span>${a.play_count}次</span></li>`).join('') || '<li class="wr-empty">暂无</li>'}</ol>
        </div>
        <div class="wr-card albums">
          <div class="wr-card-hd"><span class="wr-card-icon i-album"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg></span>最爱专辑</div>
          <div class="wr-album-grid">${data.topAlbums.length ? data.topAlbums.map((a, i) => `<div class="wr-album-item"><img src="${albumCover(a.album_mid, 300)}" onerror="this.style.display='none'" /><div class="wr-album-info"><div class="wr-album-name">${esc(a.album)}</div><div class="wr-album-singer">${esc(a.singer || '')}</div><span>${a.play_count}次</span></div></div>`).join('') : '<div class="wr-empty">暂无数据</div>'}</div>
        </div>
        <div class="wr-card habit">
          <div class="wr-card-hd"><span class="wr-card-icon i-habit"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></span>播放习惯<span class="wr-persona"><span class="wr-persona-icon">${persona.icon}</span>${esc(persona.label)}</span></div>
          <div class="wr-habit">
            <div class="wr-h-row"><span>跳过率</span><span><b>${skipPct}%</b><small>&lt;30s / ${data.skip.total}次</small></span></div>
            <div class="wr-h-row"><span>重复播放率</span><span><b>${data.repeatRate}%</b><small>（同一首歌反复听的比例）</small></span></div>
            <div class="wr-h-row"><span>新歌发现</span><span><b>${data.newSongs}</b> 首</span></div>
            <div class="wr-h-row"><span>歌手多样性</span><span><b>${data.uniqueArtists}</b> 位</span></div>
            <div class="wr-h-row"><span>场均时长</span><span><b>${fmtSec(avgSec)}</b></span></div>
            <div class="wr-h-row"><span>最爱时段</span><span><b>${data.peakLabel || '无数据'}</b></span></div>
          </div>
        </div>
        <div class="wr-card comp">
          <div class="wr-card-hd"><span class="wr-card-icon i-comp"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></span>完播率分布</div>
          <div class="wr-stack-bar">
            <div class="seg low" style="width:${compLowPct}%"></div>
            <div class="seg mid" style="width:${compMidPct}%"></div>
            <div class="seg high" style="width:${compHighPct}%"></div>
          </div>
          <div class="wr-stack-legend">
            <div class="wr-sl-row"><span class="dot low"></span>浅尝 &lt;20%<b>${compLowPct}%</b></div>
            <div class="wr-sl-row"><span class="dot mid"></span>一般 20–80%<b>${compMidPct}%</b></div>
            <div class="wr-sl-row"><span class="dot high"></span>沉浸 ≥80%<b>${compHighPct}%</b></div>
          </div>
        </div>
        <div class="wr-card trend">
          <div class="wr-card-hd"><span class="wr-card-icon i-trend"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg></span>${trendTitle}</div>
          <div class="wr-trend-chart">${trendHtml}</div>
        </div>
      </div>
      <div class="wr-persona-desc" style="margin-top:10px;padding:8px 12px;border-radius:8px;background:var(--bg-soft);font-size:13px;color:var(--text-dim);text-align:center">${persona.icon} ${esc(persona.desc)}</div>
    </div>`;

  const posterData = {
    title,
    dateRange: data.label,
    plays: data.period.plays,
    duration: fmtMin(data.period.sec),
    uniqueSongs: data.period.uniqueSongs,
    days: data.period.days,
    persona: { icon: persona.icon, label: persona.label, desc: persona.desc },
    insightText: insight.plain,
    topSongs: data.topSongs.slice(0, 5).map((s) => ({ name: s.name, singer: s.singer, albumMid: s.album_mid || '' })),
    topArtists: data.topArtists.slice(0, 6).map((a) => ({ name: a.singer })),
    topAlbums: (data.topAlbums || []).map((a) => ({ name: a.album, singer: a.singer || '', albumMid: a.album_mid || '' })),
    generatedAt: new Date().toLocaleDateString('zh-CN'),
  };

  return { html, posterData };
}

// ============================================================
// 分享海报生成（方案 A：本地 html2canvas / 方案 B：服务端 Puppeteer）
// ============================================================

let _posterData = null;
let _posterTheme = 'mint';
let _posterModalBound = false;

function renderPosterThemeGrid() {
  const grid = $('posterThemeGrid');
  grid.innerHTML = POSTER_THEME_LIST.map((t) => `
    <div class="poster-theme-swatch${t.key === _posterTheme ? ' selected' : ''}" data-theme="${t.key}" style="background:${t.bg}">
      <span class="pts-name" style="color:${t.text}">${esc(t.name)}</span>
    </div>`).join('');
  grid.querySelectorAll('.poster-theme-swatch').forEach((el) => {
    el.onclick = () => { _posterTheme = el.dataset.theme; renderPosterThemeGrid(); };
  });
}

function openPosterModal(posterData) {
  if (!posterData) return;
  _posterData = posterData;
  renderPosterThemeGrid();
  $('posterModal').classList.add('show');
}

function downloadUrl(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// 方案 A：前端 html2canvas 截图（快，无需等待服务端）
async function generatePosterLocal() {
  if (!_posterData) return;
  toast('正在本地生成海报…');
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-9999px;top:0;z-index:-1;';
  holder.innerHTML = `<style>${posterCSS(_posterTheme)}</style>${posterHTML(_posterData, _posterTheme)}`;
  document.body.appendChild(holder);
  try {
    const node = holder.querySelector('.wm-poster');
    const canvas = await html2canvas(node, { scale: 2, backgroundColor: null, useCORS: true });
    downloadUrl(canvas.toDataURL('image/png'), `wemusic-report-${Date.now()}.png`);
    toast('海报已生成，开始下载 🎉');
    $('posterModal').classList.remove('show');
  } catch (e) {
    toast('本地生成失败：' + e.message);
  } finally {
    document.body.removeChild(holder);
  }
}

// 方案 B：服务端 Puppeteer 渲染（效果更精细，需等待网络请求）
async function generatePosterServer() {
  if (!_posterData) return;
  toast('正在请求服务端生成…');
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (Auth.token) headers.Authorization = `Bearer ${Auth.token}`;
    const resp = await fetch('/api/stats/poster', {
      method: 'POST',
      headers,
      body: JSON.stringify({ theme: _posterTheme, data: _posterData }),
    });
    if (!resp.ok) {
      let msg = `请求失败 (${resp.status})`;
      try { msg = (await resp.json()).error || msg; } catch { /* ignore */ }
      throw new Error(msg);
    }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    downloadUrl(url, `wemusic-report-${Date.now()}.png`);
    URL.revokeObjectURL(url);
    toast('海报已生成，开始下载 🎉');
    $('posterModal').classList.remove('show');
  } catch (e) {
    toast('服务端生成失败：' + e.message);
  }
}

function bindPosterModalOnce() {
  if (_posterModalBound) return;
  _posterModalBound = true;
  $('posterModalClose').onclick = () => $('posterModal').classList.remove('show');
  $('posterModal').onclick = (e) => { if (e.target.id === 'posterModal') $('posterModal').classList.remove('show'); };
  $('posterLocalBtn').onclick = generatePosterLocal;
  $('posterServerBtn').onclick = generatePosterServer;
}

// ============================================================
// 统计主页
// ============================================================

export async function openStats() {
  state.view = 'stats';
  setActiveNav('navStats');
  import('./main.js').then(({ navPush }) => navPush('stats'));
  const main = $('main');
  main.innerHTML = '<div class="loading">加载统计数据…</div>';
  try {
    const [ov, topSongs, topArtists, daily, hourly, weekly] = await Promise.all([
      api('/stats/overview'),
      api('/stats/top-songs?limit=50'),
      api('/stats/top-artists?limit=8'),
      api('/stats/daily?days=30'),
      api('/stats/hourly'),
      api('/stats/weekly'),
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

    // 渲染柱状图（mode: 'count' | 'duration'）—— 百分比高度适应动态容器
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
      // 线性等比例，百分比
      const bars = days30.map((d, i) => {
        const val = vals[i];
        const pct = val > 0 ? ((val / maxVal) * 100) : 0;
        const showLabel = val > 0;
        const valLabel = showLabel
          ? (mode === 'count' ? val : (d.total_sec >= 3600 ? Math.round(d.total_sec / 3600) + 'h' : Math.round(d.total_sec / 60) + 'm'))
          : '';
        return `<div class="bar-item" data-idx="${i}">
          <div class="bar-fill" style="height:${pct.toFixed(1)}%">${valLabel ? `<span class="bar-val-label">${valLabel}</span>` : ''}</div>
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
        style="${cnt > 0 ? `background:rgba(42,183,88,${opacity.toFixed(2)});color:#fff` : ''}">${i}</div>`;
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

    // —— 本周 / 本月报告：预取本周，本月懒加载并缓存 ——
    const reportCache = { week: weekly, month: null };

    main.innerHTML = `
      <div class="view-title">我的数据</div>
      <div class="stats-overview">
        <div class="stat-ov-card accent"><div class="soc-val">${ov.plays}</div><div class="soc-label">总播放次数</div></div>
        <div class="stat-ov-card accent2"><div class="soc-val">${fmtSec(ov.total_sec)}</div><div class="soc-label">总播放时长</div></div>
        <div class="stat-ov-card"><div class="soc-val">${ov.unique_songs}</div><div class="soc-label">不重复歌曲</div></div>
        <div class="stat-ov-card"><div class="soc-val">${ov.active_days}</div><div class="soc-label">听歌天数</div></div>
      </div>
      <div class="wr-toolbar">
        <div class="wr-tabs">
          <button class="wr-tab active" data-period="week"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg> 本周</button>
          <button class="wr-tab" data-period="month"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/><path d="M8 18h.01"/><path d="M12 18h.01"/><path d="M16 18h.01"/></svg> 本月</button>
        </div>
        <div class="wr-toolbar-right">
          <button class="wr-share-btn" id="wrShareBtn"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg> 生成分享海报</button>
        <div class="wr-nav-arrows">
          <button class="wr-nav-btn" id="wrPrevBtn" title="上一周期"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg></button>
          <button class="wr-nav-btn" id="wrNextBtn" title="下一周期"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></button>
        </div>
        </div>
      </div>
      <div id="reportSection"></div>
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
          <div class="stats-panel-title">最常播放 Top ${topSongs.songs.length}</div>
          <div class="top-songs-list" id="statsTopSongs"></div>
        </div>
      </div>`;

    // —— 本周/本月报告渲染 + 分享海报绑定 + 前后周月导航 ——
    let currentPosterData = null;
    let weeklyOffset = 0, monthlyOffset = 0;

    function cacheKey(periodType, offset) { return `${periodType}$${offset}`; }

    async function renderReport(type, offset = 0) {
      const key = cacheKey(type, offset);
      if (!reportCache[key]) {
        $('reportSection').innerHTML = '<div class="loading">加载中…</div>';
        try {
          const endpoint = type === 'week' ? `/stats/weekly?weekOffset=${offset}` : `/stats/monthly?monthOffset=${offset}`;
          reportCache[key] = await api(endpoint);
        } catch (e) {
          $('reportSection').innerHTML = `<div class="empty">加载失败：${esc(e.message)}</div>`;
          return;
        }
      }
      const data = reportCache[key];
      const { html, posterData } = buildReportHtml(data, type);
      $('reportSection').innerHTML = html;
      currentPosterData = posterData;
      updatePeriodNav(type, offset);
    }

    function updatePeriodNav(type, offset) {
      const prevBtn = $('wrPrevBtn'), nextBtn = $('wrNextBtn');
      if (prevBtn) prevBtn.style.visibility = 'visible';
      if (nextBtn) nextBtn.style.visibility = offset > 0 ? 'visible' : 'hidden';
    }
    updatePeriodNav('week', 0);

    renderReport('week');
    bindPosterModalOnce();
    $('wrShareBtn').onclick = () => openPosterModal(currentPosterData);

    $('wrPrevBtn').onclick = async () => {
      const type = document.querySelector('.wr-tab.active')?.dataset?.period || 'week';
      const next = (type === 'week' ? ++weeklyOffset : ++monthlyOffset);
      await renderReport(type, next);
    };
    $('wrNextBtn').onclick = async () => {
      const type = document.querySelector('.wr-tab.active')?.dataset?.period || 'week';
      const next = (type === 'week' ? Math.max(0, --weeklyOffset) : Math.max(0, --monthlyOffset));
      await renderReport(type, next);
    };

    main.querySelectorAll('.wr-tab').forEach((btn) => {
      btn.onclick = async () => {
        const type = btn.dataset.period;
        main.querySelectorAll('.wr-tab').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        // 切换周期类型时重置 offset
        weeklyOffset = 0; monthlyOffset = 0;
        await renderReport(type);
      };
    });

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

    const INITIAL_SHOW = 10;
    const hasMore = topSongs.songs.length > INITIAL_SHOW;

    function renderTopSongs(expanded) {
      const show = expanded ? topSongs.songs : topSongs.songs.slice(0, INITIAL_SHOW);
      let html = show.length
        ? show.map((s, i) => `
          <div class="top-song-row" data-i="${i}">
            <span class="ts-rank">${i + 1}</span>
            <div class="ts-info"><div class="ts-name">${esc(s.name)}</div><div class="ts-singer">${esc(s.singer || '')}</div></div>
            <div class="ts-meta">
              <span class="ts-cnt">${s.play_count}次</span>
              <span class="ts-dur">${fmtMin(s.total_sec || 0)}</span>
              <button class="icon-btn play ts-play" title="播放" data-i="${i}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg></button>
            </div>
          </div>`).join('')
        : '<div class="stats-empty">还没有播放记录</div>';
      if (hasMore && !expanded) {
        html += `<button class="top-more-btn" id="topMoreBtn">展开全部（共 ${topSongs.songs.length} 首）</button>`;
      }
      $('statsTopSongs').innerHTML = html;

      $('statsTopSongs').querySelectorAll('.ts-play').forEach((btn) => {
        btn.onclick = (e) => {
          e.stopPropagation();
          const j = Number(btn.dataset.i);
          import('./player.js').then(({ playFromList }) => playFromList(topSongs.songs, j, 'stats', null));
        };
      });
      if (hasMore && !expanded) {
        $('topMoreBtn').onclick = () => renderTopSongs(true);
      }
    }
    renderTopSongs(false);
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

      container.innerHTML = `${headerHtml}<div class="song-row-head">
        <span class="h-idx">#</span><span class="h-name">歌名</span><span class="h-singer">歌手</span><span class="h-album">专辑</span><span class="h-bookmark"></span><span class="h-dur">时长</span><span class="h-ops">操作</span>
      </div><div class="song-list" id="discoverList"></div>`;
      // 推荐说明 tooltip（立即出现，不走 title 属性延迟）
      const recHelp = container.querySelector('.rec-help');
      if (recHelp) attachTip(recHelp);
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
      ${cover ? `<img class="chart-cover" src="${cover}" loading="lazy" onerror="this.style.display='none'" />` : '<div class="chart-cover-ph"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>'}
      <div class="chart-info"><div class="chart-name">${esc(s.name)}</div><div class="chart-singer">${esc(s.singer || '')}</div></div>
      <div class="chart-ops"><button class="icon-btn play" title="播放" data-act="play"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg></button><button class="icon-btn" title="添加到歌单" data-act="add"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg></button></div>
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
            <button class="btn sm green likes-singer-play" data-singer="${esc(singer)}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg> 播放</button>
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
      <span class="h-idx">#</span><span class="h-name">歌名</span><span class="h-singer">歌手</span><span class="h-album">专辑</span><span class="h-bookmark"></span><span class="h-dur">时长</span><span class="h-ops">操作</span>
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

// ============================================================
// 收藏的专辑页
// ============================================================
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

export function initStats() {
  $('navStats').onclick = openStats;
  $('navLikes').onclick = openLikesPage;
  $('navDiscover').onclick = openDiscover;
  $('navSavedAlbums')?.addEventListener('click', openSavedAlbums);
}
