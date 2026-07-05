// 数据看板 - 概览 Tab

import { api } from '../api.js';
import { esc } from '../utils.js';

export async function renderOverview(container) {
  container.innerHTML = '<div class="loading">加载中...</div>';

  try {
    const [overview, trend, topSongs] = await Promise.all([
      api('/admin/overview'),
      api('/admin/play-trend'),
      api('/admin/top-songs'),
    ]);

    const fmtDur = (sec) => {
      if (!sec) return '0 小时';
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      if (h > 0) return `${h} 小时 ${m} 分`;
      return `${m} 分钟`;
    };

    container.innerHTML = `
      <div class="admin-section">
        <h2 class="admin-section-title">概览</h2>
        <div class="admin-cards">
          <div class="admin-card">
            <div class="admin-card-value">${overview.userCount}</div>
            <div class="admin-card-label">活跃用户</div>
          </div>
          <div class="admin-card">
            <div class="admin-card-value">${overview.archivedCount}</div>
            <div class="admin-card-label">已归档</div>
          </div>
          <div class="admin-card">
            <div class="admin-card-value">${overview.songCount}</div>
            <div class="admin-card-label">歌曲</div>
          </div>
          <div class="admin-card">
            <div class="admin-card-value">${overview.playlistCount}</div>
            <div class="admin-card-label">歌单</div>
          </div>
          <div class="admin-card">
            <div class="admin-card-value">${fmtDur(overview.totalSec)}</div>
            <div class="admin-card-label">总播放时长</div>
          </div>
          <div class="admin-card">
            <div class="admin-card-value">${fmtDur(overview.todaySec)}</div>
            <div class="admin-card-label">今日播放</div>
          </div>
        </div>
      </div>

      <div class="admin-section">
        <h2 class="admin-section-title">近 7 天播放趋势</h2>
        <div class="admin-trend">
          ${trend.map((d) => `
            <div class="admin-trend-item">
              <div class="admin-trend-bar" style="height:${Math.max(2, d.sec / Math.max(...trend.map(x => x.sec || 1)) * 100)}%"></div>
              <span class="admin-trend-date">${d.date}</span>
              <span class="admin-trend-val">${d.sec ? Math.round(d.sec / 60) + '分' : '0'}</span>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="admin-section">
        <h2 class="admin-section-title">热门歌曲 Top 20</h2>
        <div class="admin-table-wrap">
          <table class="admin-table">
            <thead><tr><th style="width:40px">#</th><th>歌名</th><th>歌手</th><th style="width:80px">播放次数</th></tr></thead>
            <tbody>
              ${topSongs.map((s, i) => `
                <tr><td>${i + 1}</td><td>${esc(s.name)}</td><td>${esc(s.singer || '-')}</td><td>${s.play_count}</td></tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (e) {
    container.innerHTML = `<div class="empty">加载失败：${esc(e.message)}</div>`;
  }
}
