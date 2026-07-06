// 系统监控 Tab — 每 30 秒自动刷新
import { api } from '../api.js';
import { esc } from '../utils.js';

let refreshTimer = null;

// 返回一个 cleanup 函数供 admin-panel 在 Tab 切换时调用
export async function renderMonitor(container) {
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  await loadMonitor(container);
  refreshTimer = setInterval(() => loadMonitor(container), 30000);
  return () => {
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  };
}

async function loadMonitor(container) {
  // 首次全量渲染，后续只更新数值
  const isFirst = !container.querySelector('.admin-cards');

  try {
    const health = await api('/admin/health');
    if (isFirst) {
      container.innerHTML = `
        <div class="admin-section">
          <h2 class="admin-section-title">系统监控 <span style="font-size:calc(var(--font-size)*0.75);color:var(--text-dim);font-weight:400">每 30 秒自动刷新</span></h2>
          <div class="admin-cards">
            <div class="admin-card"><div class="admin-card-value" id="monUptime">${health.uptime}s</div><div class="admin-card-label">运行时间</div></div>
            <div class="admin-card"><div class="admin-card-value" id="monUsers">${health.userCount}</div><div class="admin-card-label">用户数</div></div>
            <div class="admin-card"><div class="admin-card-value" id="monPlays">${health.playCount}</div><div class="admin-card-label">播放记录</div></div>
            <div class="admin-card"><div class="admin-card-value" id="monDbSize">${health.dbSize}</div><div class="admin-card-label">数据库大小</div></div>
            <div class="admin-card"><div class="admin-card-value">${health.nodeVersion}</div><div class="admin-card-label">Node.js</div></div>
          </div>
          <div class="admin-config-group" style="margin-top:20px">
            <h3>内存使用</h3>
            <div class="admin-mem-bars">
              <div class="admin-mem-item">
                <span>堆使用</span>
                <div class="admin-mem-bar-bg"><div class="admin-mem-bar" id="monHeapBar" style="width:${parseFloat(health.memory.heapUsed) / parseFloat(health.memory.heapTotal) * 100}%"></div></div>
                <span id="monHeap">${health.memory.heapUsed} / ${health.memory.heapTotal}</span>
              </div>
              <div class="admin-mem-item">
                <span>物理内存</span>
                <div class="admin-mem-bar-bg"><div class="admin-mem-bar mem-rss"></div></div>
                <span id="monRss">${health.memory.rss}</span>
              </div>
            </div>
          </div>
        </div>
      `;
    } else {
      // 增量更新
      const u = document.getElementById('monUptime'); if (u) u.textContent = health.uptime + 's';
      const us = document.getElementById('monUsers'); if (us) us.textContent = health.userCount;
      const pl = document.getElementById('monPlays'); if (pl) pl.textContent = health.playCount;
      const db = document.getElementById('monDbSize'); if (db) db.textContent = health.dbSize;
      const hb = document.getElementById('monHeapBar'); if (hb) hb.style.width = parseFloat(health.memory.heapUsed) / parseFloat(health.memory.heapTotal) * 100 + '%';
      const h = document.getElementById('monHeap'); if (h) h.textContent = health.memory.heapUsed + ' / ' + health.memory.heapTotal;
      const r = document.getElementById('monRss'); if (r) r.textContent = health.memory.rss;
    }
  } catch (e) {
    if (isFirst) container.innerHTML = `<div class="empty">加载失败：${esc(e.message)}</div>`;
  }
}
