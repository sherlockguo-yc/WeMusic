// 系统监控 Tab
import { api } from '../api.js';
import { esc } from '../utils.js';

export async function renderMonitor(container) {
  container.innerHTML = '<div class="loading">加载中...</div>';

  try {
    const health = await api('/admin/health');
    container.innerHTML = `
      <div class="admin-section">
        <h2 class="admin-section-title">系统监控</h2>

        <div class="admin-cards">
          <div class="admin-card">
            <div class="admin-card-value">${health.uptime}s</div>
            <div class="admin-card-label">运行时间</div>
          </div>
          <div class="admin-card">
            <div class="admin-card-value">${health.userCount}</div>
            <div class="admin-card-label">用户数</div>
          </div>
          <div class="admin-card">
            <div class="admin-card-value">${health.playCount}</div>
            <div class="admin-card-label">播放记录</div>
          </div>
          <div class="admin-card">
            <div class="admin-card-value">${health.dbSize}</div>
            <div class="admin-card-label">数据库大小</div>
          </div>
          <div class="admin-card">
            <div class="admin-card-value">${health.nodeVersion}</div>
            <div class="admin-card-label">Node.js</div>
          </div>
        </div>

        <div class="admin-config-group" style="margin-top:20px">
          <h3>内存使用</h3>
          <div class="admin-mem-bars">
            <div class="admin-mem-item">
              <span>堆使用</span>
              <div class="admin-mem-bar-bg"><div class="admin-mem-bar" style="width:${parseFloat(health.memory.heapUsed) / parseFloat(health.memory.heapTotal) * 100}%"></div></div>
              <span>${health.memory.heapUsed} / ${health.memory.heapTotal}</span>
            </div>
            <div class="admin-mem-item">
              <span>物理内存</span>
              <div class="admin-mem-bar-bg"><div class="admin-mem-bar mem-rss"></div></div>
              <span>${health.memory.rss}</span>
            </div>
          </div>
        </div>
      </div>
    `;
  } catch (e) {
    container.innerHTML = `<div class="empty">加载失败：${esc(e.message)}</div>`;
  }
}
