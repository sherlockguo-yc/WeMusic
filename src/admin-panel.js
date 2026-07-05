// 管理面板主入口
// 渲染管理面板的框架（侧边导航 + 内容区），各 Tab 模块按需动态加载

import { $, esc, toast } from './utils.js';
import { api } from './api.js';

const TABS = [
  { id: 'overview', label: '概览', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>' },
  { id: 'users', label: '用户', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>' },
  { id: 'moderate', label: '审核', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>' },
  { id: 'config', label: '配置', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>' },
  { id: 'audit', label: '审计', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>' },
  { id: 'monitor', label: '监控', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>' },
];

let currentTab = 'overview';

export function openAdminPanel(initialTab = 'overview') {
  currentTab = initialTab;

  const main = $('main');
  // 隐藏侧边栏和顶栏的部分元素，管理面板有独立布局
  document.body.classList.add('admin-view');

  main.innerHTML = `
    <div class="admin-layout">
      <nav class="admin-sidebar">
        <div class="admin-sidebar-header">
          <span class="admin-logo">WeMusic 管理</span>
        </div>
        <div class="admin-nav">
          ${TABS.map((t) => `
            <div class="admin-nav-item ${t.id === currentTab ? 'active' : ''}" data-tab="${t.id}">
              <span class="admin-nav-icon">${t.icon}</span>
              <span>${t.label}</span>
            </div>
          `).join('')}
        </div>
        <div class="admin-sidebar-footer">
          <button class="admin-back-btn" id="adminBackBtn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            返回主站
          </button>
        </div>
      </nav>
      <div class="admin-content" id="adminContent">
        <div class="loading">加载中...</div>
      </div>
    </div>
  `;

  // Tab 切换
  main.querySelectorAll('.admin-nav-item').forEach((item) => {
    item.onclick = () => {
      currentTab = item.dataset.tab;
      main.querySelectorAll('.admin-nav-item').forEach((el) => el.classList.remove('active'));
      item.classList.add('active');
      loadTab(currentTab);
    };
  });

  // 返回主站
  $('adminBackBtn').onclick = () => {
    document.body.classList.remove('admin-view');
    history.pushState({ view: 'discover' }, '', '/');
    import('./stats.js').then(({ openDiscover }) => openDiscover());
  };

  // 加载当前 tab
  loadTab(currentTab);
}

async function loadTab(tab) {
  const content = document.getElementById('adminContent');
  if (!content) return;
  content.innerHTML = '<div class="loading">加载中...</div>';

  try {
    // 先验证当前角色有权限访问该 tab
    const me = await api('/admin/me');
    const role = me.role;

    switch (tab) {
      case 'overview':
        if (['viewer', 'moderator', 'admin', 'super_admin'].includes(role)) {
          const { renderOverview } = await import('./admin/overview.js');
          renderOverview(content);
        } else { showForbidden(content); }
        break;
      case 'users':
        if (['moderator', 'admin', 'super_admin'].includes(role)) {
          const { renderUsers } = await import('./admin/users.js');
          renderUsers(content, role);
        } else { showForbidden(content); }
        break;
      case 'moderate':
        if (['moderator', 'admin', 'super_admin'].includes(role)) {
          const { renderModerate } = await import('./admin/moderate.js');
          renderModerate(content, role);
        } else { showForbidden(content); }
        break;
      case 'config':
        if (['admin', 'super_admin'].includes(role)) {
          const { renderConfig } = await import('./admin/config.js');
          renderConfig(content, role);
        } else { showForbidden(content); }
        break;
      case 'audit':
        if (['viewer', 'moderator', 'admin', 'super_admin'].includes(role)) {
          const { renderAudit } = await import('./admin/audit.js');
          renderAudit(content);
        } else { showForbidden(content); }
        break;
      case 'monitor':
        if (['viewer', 'moderator', 'admin', 'super_admin'].includes(role)) {
          const { renderMonitor } = await import('./admin/monitor.js');
          renderMonitor(content);
        } else { showForbidden(content); }
        break;
      default:
        content.innerHTML = '<div class="empty">未知页面</div>';
    }
  } catch (e) {
    content.innerHTML = `<div class="empty">加载失败：${esc(e.message)}</div>`;
  }
}

function showForbidden(container) {
  container.innerHTML = '<div class="empty">权限不足</div>';
}
