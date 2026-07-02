// ---------------- 管理员面板 ----------------
import { $, esc, toast } from './utils.js';
import { api } from './api.js';

export async function openAdmin() {
  const main = $('main');
  main.innerHTML = '<div class="loading">加载管理面板…</div>';

  try {
    const [{ feedback }, { blocked }, { userCount, songCount, playlistCount, feedbackCount }] = await Promise.all([
      api('/auth/admin/feedback'),
      api('/auth/admin/blocked'),
      api('/auth/admin/stats'),
    ]);

    main.innerHTML = `
      <div class="view-title"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> 管理面板</div>

      <div class="admin-stats">
        <div class="admin-stat-item"><strong>${userCount}</strong> 用户</div>
        <div class="admin-stat-item"><strong>${songCount}</strong> 歌曲</div>
        <div class="admin-stat-item"><strong>${playlistCount}</strong> 歌单</div>
        <div class="admin-stat-item"><strong>${feedbackCount}</strong> 反馈</div>
      </div>

      <div class="admin-tabs">
        <button class="admin-tab active" data-tab="feedback">反馈 (${feedback.length})</button>
        <button class="admin-tab" data-tab="blocked">屏蔽源 (${blocked.length})</button>
      </div>

      <div class="admin-tab-body" id="adminFeedback">
        ${renderFeedback(feedback)}
      </div>
      <div class="admin-tab-body" id="adminBlocked" style="display:none">
        ${renderBlocked(blocked)}
      </div>
    `;

    // Tab 切换
    main.querySelectorAll('.admin-tab').forEach((btn) => {
      btn.onclick = () => {
        main.querySelectorAll('.admin-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        $('adminFeedback').style.display = btn.dataset.tab === 'feedback' ? '' : 'none';
        $('adminBlocked').style.display = btn.dataset.tab === 'blocked' ? '' : 'none';
      };
    });

    // 删除反馈
    main.querySelectorAll('.admin-del-fb').forEach(b => {
      b.onclick = async () => {
        const id = b.dataset.id;
        await api(`/auth/admin/feedback/${id}`, { method: 'DELETE' });
        b.closest('.admin-row').remove();
        toast('已删除');
      };
    });

    // 取消屏蔽
    main.querySelectorAll('.admin-unblock').forEach(b => {
      b.onclick = async () => {
        const row = b.closest('.admin-row');
        await api('/auth/admin/blocked', {
          method: 'DELETE',
          body: {
            userId: Number(b.dataset.userId),
            song: b.dataset.song,
            type: b.dataset.type,
            sourceId: b.dataset.sourceId,
          },
        });
        row.remove();
        toast('已取消屏蔽');
      };
    });
  } catch (e) {
    main.innerHTML = `<div class="empty">加载失败：${esc(e.message)}</div>`;
  }
}

function renderFeedback(list) {
  if (!list.length) return '<div class="empty">暂无反馈</div>';
  const types = { bug: '🐛 Bug', feature: '💡 需求', other: '💬 其他' };
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

function renderBlocked(list) {
  if (!list.length) return '<div class="empty">暂无屏蔽记录</div>';
  return list.map(b => `
    <div class="admin-row">
      <div class="admin-row-hd">
        <span class="admin-b-tag">${b.source_type}</span>
        <span class="admin-b-song">${esc(b.song_key)}</span>
        <span class="admin-b-sid">${esc(b.source_id)}</span>
        <span class="admin-b-user">${esc(b.username)}</span>
        <span class="admin-fb-time">${fmtTime(b.blocked_at)}</span>
        <button class="admin-del-fb admin-unblock" data-user-id="${b.user_id}" data-song="${esc(b.song_key)}" data-type="${b.source_type}" data-source-id="${esc(b.source_id)}" title="取消屏蔽"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="10"/></svg></button>
      </div>
    </div>
  `).join('');
}

function fmtTime(ts) {
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
