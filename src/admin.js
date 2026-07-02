// ---------------- 管理员面板 ----------------
import { $, esc, toast, fmtTotal, fmtMin } from './utils.js';
import { api } from './api.js';

export async function openAdmin() {
  const main = $('main');
  main.innerHTML = '<div class="loading">加载管理面板…</div>';

  try {
    const [{ feedback }, { userCount, feedbackCount, totalSec, users }] = await Promise.all([
      api('/auth/admin/feedback'),
      api('/auth/admin/stats'),
    ]);

    main.innerHTML = `
      <div class="view-title"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> 管理面板</div>

      <div class="admin-stats">
        <div class="admin-stat-item"><strong>${userCount}</strong> 用户</div>
        <div class="admin-stat-item"><strong>${feedbackCount}</strong> 反馈</div>
        <div class="admin-stat-item"><strong>${fmtTotal(totalSec)}</strong> 总时长</div>
      </div>

      <div class="admin-section-label" style="display:flex;align-items:center;justify-content:space-between;margin:18px 0 10px">
        <span>用户列表</span>
        <span style="font-size:11px;color:var(--text-dim)">7天 / 30天 / 总计</span>
      </div>
      ${renderUserList(users)}

      <div class="admin-section-label" style="margin:18px 0 10px">反馈列表</div>
      ${renderFeedback(feedback)}
    `;

    // 删除反馈
    main.querySelectorAll('.admin-del-fb').forEach(b => {
      b.onclick = async () => {
        const id = b.dataset.id;
        await api(`/auth/admin/feedback/${id}`, { method: 'DELETE' });
        b.closest('.admin-row').remove();
        toast('已删除');
      };
    });
  } catch (e) {
    main.innerHTML = `<div class="empty">加载失败：${esc(e.message)}</div>`;
  }
}

function renderUserList(users) {
  if (!users.length) return '<div class="empty">暂无用户</div>';
  return users.map(u => `
    <div class="admin-user-row">
      <div class="admin-user-hd">
        <span class="admin-user-avatar">${esc(u.username[0].toUpperCase())}</span>
        <div style="flex:1;min-width:0">
          <div class="admin-user-name">${esc(u.username)}</div>
          <div class="admin-user-meta">
            ${u.lastLogin ? `最近登录 ${fmtTime(u.lastLogin)}` : '从未登录'}
            · 注册于 ${fmtDate(u.createdAt)}
          </div>
        </div>
        <div class="admin-user-stats">
          <span title="近 7 天">${fmtMin(u.weekSec)}</span>
          <span title="近 30 天">${fmtMin(u.monthSec)}</span>
          <span title="总计">${fmtMin(u.totalSec)}</span>
        </div>
      </div>
      <div class="admin-user-sub">
        <span>${u.playlistCount} 歌单 · ${u.songCount} 歌曲</span>
      </div>
    </div>
  `).join('');
}

function renderFeedback(list) {
  if (!list.length) return '<div class="empty">暂无反馈</div>';
  const types = { bug: 'Bug', feature: '需求', other: '其他' };
  return list.map(f => `
    <div class="admin-row">
      <div class="admin-row-hd">
        <span class="admin-fb-type">${types[f.type] || f.type}</span>
        <span class="admin-fb-user">${esc(f.username)}</span>
        <span class="admin-fb-time">${fmtTime(f.created_at)}</span>
        <button class="admin-del-fb" data-id="${f.id}" title="删除"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>
      <div class="admin-fb-content">${esc(f.content)}</div>
    </div>
  `).join('');
}

function fmtTime(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtDate(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

