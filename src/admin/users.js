// 用户管理 Tab（含归档用户）
import { api } from '../api.js';
import { esc, toast, uiConfirm, uiPrompt, uiChoice, fmtTime } from '../utils.js';
import { refreshCachedRole } from '../admin-panel.js';
import { state } from '../state.js';

let currentRole = 'viewer';
let activeView = 'active'; // 'active' | 'archived'
let currentPage = 1;

export async function renderUsers(container, role) {
  currentRole = role;
  activeView = 'active';
  currentPage = 1;
  ensureNotesModal();
  container.innerHTML = `
    <div class="admin-section">
      <h2 class="admin-section-title">用户管理</h2>
      <div class="admin-tabs">
        <button class="admin-tab-btn active" data-view="active">活跃用户</button>
        ${currentRole === 'super_admin' ? '<button class="admin-tab-btn" data-view="archived">归档用户</button>' : ''}
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
      currentPage = 1;
      loadPage(1);
    };
  });

  loadPage(1);
}

// 确保备注编辑弹窗已存在于 DOM
let notesModalEl = null;
function ensureNotesModal() {
  if (notesModalEl) return;
  notesModalEl = document.createElement('div');
  notesModalEl.id = 'notesModal';
  notesModalEl.className = 'modal-mask notes-modal-mask';
  notesModalEl.style.cssText = 'display:none; z-index: 150;';
  notesModalEl.innerHTML = `
    <div class="modal-box notes-modal-box">
      <div class="notes-modal-header">
        <h3 id="notesModalTitle">备注</h3>
        <span class="notes-char-hint" id="notesCharCount">0 / 500</span>
      </div>
      <textarea id="notesInput" class="notes-textarea" maxlength="500" placeholder="输入备注信息，例如：这是张三的朋友、XX 部门同事"></textarea>
      <div class="notes-modal-footer">
        <button class="btn btn-clear" id="notesClear">清空</button>
        <div class="notes-modal-actions">
          <button class="btn" id="notesCancel">取消</button>
          <button class="btn green" id="notesSave">保存</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(notesModalEl);

  const cancel = () => { notesModalEl.style.display = 'none'; };
  notesModalEl.querySelector('#notesCancel').onclick = cancel;
  notesModalEl.addEventListener('click', (e) => {
    if (e.target === notesModalEl) cancel();
  });

  // 字数统计
  const input = notesModalEl.querySelector('#notesInput');
  const charCount = notesModalEl.querySelector('#notesCharCount');
  input.addEventListener('input', () => {
    charCount.textContent = `${input.value.length} / 500`;
  });
}

async function loadPage(page) {
  try {
    if (activeView === 'archived') {
      const { users } = await api('/admin/archived-users');
      renderArchivedUsers(users);
    } else {
      const data = await api(`/admin/users?page=${page}&limit=30`);
      currentPage = page;
      renderActiveUsers(data);
      renderPagination(data);
    }
  } catch (e) {
    document.getElementById('adminUserList').innerHTML = `<div class="empty">加载失败：${esc(e.message)}</div>`;
  }
}

function renderActiveUsers(data) {
  const list = document.getElementById('adminUserList');
  const canEdit = ['admin', 'super_admin'].includes(currentRole);
  list.innerHTML = `
    <table class="admin-table">
      <thead><tr>
        <th>用户名</th><th>角色</th><th>状态</th><th>注册时间</th><th>最近登录</th><th>备注</th><th>操作</th>
      </tr></thead>
      <tbody>
        ${data.users.map((u) => `
          <tr>
            <td><strong>${esc(u.username)}</strong></td>
            <td><span class="admin-badge badge-${u.role}">${roleLabel(u.role)}</span></td>
            <td><span class="admin-badge badge-${u.status}">${statusLabel(u.status)}</span></td>
            <td>${fmtTime(u.created_at)}</td>
            <td>${fmtTime(u.last_login_at)}</td>
            <td class="admin-notes-cell${canEdit ? ' clickable' : ''}"${u.notes ? ` title="${esc(u.notes)}"` : ''}${canEdit ? ` data-action="notes" data-id="${u.id}" data-username="${esc(u.username)}" data-notes="${esc(u.notes || '')}"` : ''}>
              ${u.notes ? `<span class="admin-notes-text">${esc(u.notes)}</span>` : '<span class="admin-notes-empty">-</span>'}
            </td>
            <td class="admin-actions">
              ${currentRole !== 'moderator' ? `
                <button class="admin-action-btn" data-action="role" data-id="${u.id}" data-username="${esc(u.username)}">角色</button>
              ` : ''}
              ${canEdit ? `
                <button class="admin-action-btn" data-action="status" data-id="${u.id}" data-username="${esc(u.username)}" data-status="${u.status}">状态</button>
                <button class="admin-action-btn notes${u.notes ? ' has-notes' : ''}" data-action="notes" data-id="${u.id}" data-username="${esc(u.username)}" data-notes="${esc(u.notes || '')}" title="${u.notes ? esc(u.notes) : '添加备注'}">备注</button>
                <button class="admin-action-btn" data-action="archive" data-id="${u.id}" data-username="${esc(u.username)}">归档</button>
              ` : ''}
            </td>
          </tr>
        `).join('') || '<tr><td colspan="7" class="empty">暂无用户</td></tr>'}
      </tbody>
    </table>
  `;

  bindActions(list);
  // 备注列可点击（admin+）
  if (canEdit) {
    list.querySelectorAll('.admin-notes-cell.clickable').forEach((cell) => {
      cell.style.cursor = 'pointer';
      cell.onclick = () => {
        openNotesModal(cell.dataset.id, cell.dataset.username, cell.dataset.notes || '');
      };
    });
  }
}

function renderArchivedUsers(users) {
  const list = document.getElementById('adminUserList');
  list.innerHTML = `
    <table class="admin-table">
      <thead><tr>
        <th>用户名</th><th>状态</th><th>归档时间</th><th>注册时间</th><th>操作</th>
      </tr></thead>
      <tbody>
        ${users.map((u) => `
          <tr>
            <td><strong>${esc(u.username)}</strong></td>
            <td><span class="admin-badge badge-${u.status}">${statusLabel(u.status)}</span></td>
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
        const ok = await uiConfirm(`确认归档用户「${username}」？\n\n归档后该用户将无法登录，但数据保留。`);
        if (!ok) return;
        await api(`/admin/users/${id}/archive`, { method: 'POST' });
        toast(`已归档 ${username}`);
        loadPage(currentPage);
      } else if (action === 'notes') {
        openNotesModal(id, username, btn.dataset.notes || '');
      } else if (action === 'restore') {
        const ok = await uiConfirm(`确认恢复用户「${username}」？`);
        if (!ok) return;
        await api(`/admin/users/${id}/restore`, { method: 'POST' });
        toast(`已恢复 ${username}`);
        loadPage(currentPage);
      } else if (action === 'delete') {
        const ok = await uiConfirm(`确认彻底删除用户「${username}」？\n\n此操作不可恢复。`);
        if (!ok) return;
        const confirmName = await uiPrompt('二次验证', `请输入用户名「${username}」以确认删除：`);
        if (confirmName !== username) { toast('用户名不匹配，已取消'); return; }
        try {
          await api(`/admin/users/${id}`, { method: 'DELETE', body: { confirmUsername: username } });
          toast(`已删除 ${username}`);
          loadPage(currentPage);
        } catch (e) { toast(e.message || '删除失败'); }
      } else if (action === 'status') {
        const statusDefs = [
          { value: 'active', label: '正常',   desc: '恢复正常状态' },
          { value: 'warned', label: '已警告', desc: '标记该用户已被警告' },
          { value: 'banned', label: '已封禁', desc: '封禁该用户，禁止其使用' },
        ];
        const newStatus = await uiChoice(
          `修改「${username}」的状态`,
          '请选择该用户的新状态：',
          statusDefs,
          btn.dataset.status,
        );
        if (!newStatus) return;
        await api(`/admin/users/${id}/status`, { method: 'PUT', body: { status: newStatus } });
        toast(`已更新 ${username} 状态为 ${statusLabel(newStatus)}`);
        loadPage(currentPage);
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
        // 如果修改的是自己的角色，同步更新缓存和导航
        if (state.user && state.user.username === username) refreshCachedRole(newRole);
        toast(`已更新 ${username} 角色为 ${roleLabel(newRole)}`);
        loadPage(currentPage);
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

function openNotesModal(userId, username, currentNotes) {
  const title = document.getElementById('notesModalTitle');
  const input = document.getElementById('notesInput');
  const saveBtn = document.getElementById('notesSave');
  const clearBtn = document.getElementById('notesClear');
  const charCount = document.getElementById('notesCharCount');

  title.textContent = `备注 - ${username}`;
  input.value = currentNotes;
  charCount.textContent = `${currentNotes.length} / 500`;
  notesModalEl.style.display = 'flex';
  input.focus();

  const doSave = async () => {
    const notes = input.value.trim().slice(0, 500);
    try {
      await api(`/admin/users/${userId}/notes`, { method: 'PUT', body: { notes } });
      notesModalEl.style.display = 'none';
      toast(notes ? `已保存「${username}」的备注` : `已清除「${username}」的备注`);
      loadPage(currentPage);
    } catch (e) {
      toast(e.message || '保存失败');
    }
  };

  saveBtn.onclick = doSave;
  clearBtn.onclick = () => {
    input.value = '';
    charCount.textContent = '0 / 500';
    input.focus();
  };

  // Enter 保存（Ctrl+Enter 换行）
  input.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      doSave();
    }
  };
}
