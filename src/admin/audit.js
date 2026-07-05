// 操作审计 Tab
import { api } from '../api.js';
import { esc } from '../utils.js';

export async function renderAudit(container) {
  container.innerHTML = '<div class="loading">加载中...</div>';

  try {
    const data = await api('/admin/audit-logs?limit=100');
    container.innerHTML = `
      <div class="admin-section">
        <h2 class="admin-section-title">操作审计</h2>
        <div class="admin-table-wrap">
          <table class="admin-table">
            <thead><tr>
              <th style="width:160px">时间</th><th>操作人</th><th>操作</th><th>目标</th><th>详情</th><th style="width:120px">IP</th>
            </tr></thead>
            <tbody>
              ${data.logs.map((l) => `
                <tr>
                  <td>${fmtTime(l.created_at)}</td>
                  <td><strong>${esc(l.operator)}</strong></td>
                  <td><span class="admin-badge badge-${l.action}">${actionLabel(l.action)}</span></td>
                  <td>${esc(l.target || '-')}</td>
                  <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(l.detail || '')}</td>
                  <td><code>${esc(l.ip || '')}</code></td>
                </tr>
              `).join('') || '<tr><td colspan="6" class="empty">暂无审计记录</td></tr>'}
            </tbody>
          </table>
          <div style="margin-top:8px;color:var(--text-dim);font-size:12px">共 ${data.total} 条记录</div>
        </div>
      </div>
    `;
  } catch (e) {
    container.innerHTML = `<div class="empty">加载失败：${esc(e.message)}</div>`;
  }
}

function actionLabel(a) {
  const map = {
    role_change: '修改角色', archive_user: '归档用户', restore_user: '恢复用户',
    delete_user: '删除用户', change_status: '修改状态', delete_feedback: '删除反馈',
    batch_unblock: '批量取消屏蔽', update_config: '修改配置', word_add: '添加敏感词',
    word_delete: '删除敏感词',
  };
  return map[a] || a;
}
function fmtTime(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
