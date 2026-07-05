// 用户管理 Tab（含归档用户）
import { api } from '../api.js';
import { esc, toast, uiConfirm, uiPrompt, uiChoice } from '../utils.js';

let currentRole = 'viewer';
let activeView = 'active'; // 'active' | 'archived'

export async function renderUsers(container, role) {
  currentRole = role;
  activeView = 'active';
  container.innerHTML = `
    <div class="admin-section">
      <h2 class="admin-section-title">用户管理</h2>
      <div class="admin-tabs">
        <button class="admin-tab-btn active" data-view="active">活跃用户</button>
        <button class="admin-tab-btn" data-view="archived">归档用户</button>
      </div>
      <div id="adminUserList" class="admin-table-wrap"></div>
      <div class="admin-pagination" id="adminUserPagination"></div>
    </div>
  `;

  container.querySelectorAll('.admin-tab-btn').forEach((btn) => {
    btn.onclick = () => {
      container.querySelectorAll('.admin-tab-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      activeView = btn.dataset.view;
      loadPage(1);
    };
  });

  loadPage(1);
}

async function loadPage(page) {
  try {
    if (activeView === 'archived') {
      const { users } = await api('/admin/archived-users');
      renderArchivedUsers(users);
    } else {
      const data = await api(`/admin/users?page=${page}&limit=30`);
      renderActiveUsers(data);
      renderPagination(data);
    }
  } catch (e) {
    document.getElementById('adminUserList').innerHTML = `<div class="empty">加载失败：${esc(e.message)}</div>`;
  }
}

function renderActiveUsers(data) {
  const list = document.getElementById('adminUserList');
  list.innerHTML = `
    <table class="admin-table">
      <thead><tr>
        <th>用户名</th><th>角色</th><th>状态</th><th>注册时间</th><th>最近登录</th><th>操作</th>
      </tr></thead>
      <tbody>
        ${data.users.map((u) => `
          <tr>
            <td><strong>${esc(u.username)}</strong></td>
            <td><span class="admin-badge badge-${u.role}">${roleLabel(u.role)}</span></td>
            <td><span class="admin-badge badge-${u.status}">${statusLabel(u.status)}</span></td>
            <td>${fmtTime(u.created_at)}</td>
            <td>${fmtTime(u.last_login_at)}</td>
            <td class="admin-actions">
              ${currentRole !== 'moderator' ? `
                <button class="admin-action-btn" data-action="role" data-id="${u.id}" data-username="${esc(u.username)}">角色</button>
              ` : ''}
              ${['admin', 'super_admin'].includes(currentRole) ? `
                <button class="admin-action-btn" data-action="archive" data-id="${u.id}" data-username="${esc(u.username)}">归档</button>
              ` : ''}
            </td>
          </tr>
        `).join('') || '<tr><td colspan="6" class="empty">暂无用户</td></tr>'}
      </tbody>
    </table>
  `;

  bindActions(list);
}

function renderArchivedUsers(users) {
  const list = document.getElementById('adminUserList');
  list.innerHTML = `
    <table class="admin-table">
      <thead><tr>
        <th>用户名</th><th>归档时间</th><th>注册时间</th><th>操作</th>
      </tr></thead>
      <tbody>
        ${users.map((u) => `
          <tr>
            <td><strong>${esc(u.username)}</strong></td>
            <td>${fmtTime(u.archived_at)}</td>
            <td>${fmtTime(u.created_at)}</td>
            <td class="admin-actions">
              <button class="admin-action-btn restore" data-action="restore" data-id="${u.id}" data-username="${esc(u.username)}">恢复</button>
              <button class="admin-action-btn danger" data-action="delete" data-id="${u.id}" data-username="${esc(u.username)}">删除</button>
            </td>
          </tr>
        `).join('') || '<tr><td colspan="4" class="empty">暂无归档用户</td></tr>'}
      </tbody>
    </table>
  `;

  bindActions(list);
}

function renderPagination(data) {
  const pg = document.getElementById('adminUserPagination');
  if (data.total <= data.limit) { pg.innerHTML = ''; return; }
  const totalPages = Math.ceil(data.total / data.limit);
  let html = `<span>共 ${data.total} 用户</span>`;
  for (let i = 1; i <= totalPages; i++) {
    html += `<button class="admin-page-btn ${i === data.page ? 'active' : ''}" data-page="${i}">${i}</button>`;
  }
  pg.innerHTML = html;
  pg.querySelectorAll('.admin-page-btn').forEach((b) => {
    b.onclick = () => loadPage(Number(b.dataset.page));
  });
}

function bindActions(container) {
  container.querySelectorAll('.admin-action-btn').forEach((btn) => {
    btn.onclick = async () => {
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      const username = btn.dataset.username;

      if (action === 'archive') {
        const ok = await uiConfirm(`确认归档用户「${username}」？\n\n归档后该用户将无法登录，但数据保留。可在「归档用户」页面恢复或彻底删除。`);
        if (!ok) return;
        await api(`/admin/users/${id}/archive`, { method: 'POST' });
        toast(`已归档 ${username}`);
        loadPage(1);
      } else if (action === 'restore') {
        const ok = await uiConfirm(`确认恢复用户「${username}」？`);
        if (!ok) return;
        await api(`/admin/users/${id}/restore`, { method: 'POST' });
        toast(`已恢复 ${username}`);
        loadPage(1);
      } else if (action === 'delete') {
        const ok = await uiConfirm(`确认彻底删除用户「${username}」？\n\n此操作不可恢复。`);
        if (!ok) return;
        const confirmName = await uiPrompt('二次验证', `请输入用户名「${username}」以确认删除：`);
        if (confirmName !== username) { toast('用户名不匹配，已取消'); return; }
        try {
          await api(`/admin/users/${id}`, { method: 'DELETE', body: { confirmUsername: username } });
          toast(`已删除 ${username}`);
          loadPage(1);
        } catch (e) { toast(e.message || '删除失败'); }
      } else if (action === 'role') {
        const roleDefs = [
          { value: 'user',       label: '用户',     desc: '普通用户，无管理权限' },
          { value: 'viewer',     label: '观察员',   desc: '只读访问看板、用户列表、审计日志' },
          { value: 'moderator',  label: '审核员',   desc: '内容审核、用户列表查看' },
          { value: 'admin',      label: '管理员',   desc: '除权限/备份/功能开关外的全部模块' },
        ];
        if (currentRole === 'super_admin') {
          roleDefs.push({ value: 'super_admin', label: '超级管理员', desc: '全部权限 + 管理其他管理员' });
        }
        const newRole = await uiChoice(
          `修改「${username}」的角色`,
          '请选择该用户的新角色：',
          roleDefs,
        );
        if (!newRole) return;
        await api(`/admin/users/${id}/role`, { method: 'PUT', body: { role: newRole } });
        toast(`已更新 ${username} 角色为 ${roleLabel(newRole)}`);
        loadPage(1);
      }
    };
  });
}

function roleLabel(r) {
  const map = { super_admin: '超级管理员', admin: '管理员', moderator: '审核员', viewer: '观察员', user: '用户' };
  return map[r] || r;
}
function statusLabel(s) {
  const map = { active: '正常', warned: '已警告', banned: '已封禁' };
  return map[s] || s;
}
function fmtTime(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
