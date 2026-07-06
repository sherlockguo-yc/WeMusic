// 内容审核 Tab（反馈 + 屏蔽源 + 敏感词库）
import { api } from '../api.js';
import { esc, toast, uiConfirm, fmtTime } from '../utils.js';

let currentRole = 'moderator';
let activeSubTab = 'feedback';

export async function renderModerate(container, role) {
  currentRole = role;
  container.innerHTML = `
    <div class="admin-section">
      <h2 class="admin-section-title">内容审核</h2>
      <div class="admin-tabs">
        <button class="admin-tab-btn active" data-sub="feedback">用户反馈</button>
        <button class="admin-tab-btn" data-sub="blocked">屏蔽源</button>
        <button class="admin-tab-btn" data-sub="words">敏感词库</button>
      </div>
      <div id="adminModerateContent"></div>
    </div>
  `;

  container.querySelectorAll('.admin-tab-btn').forEach((btn) => {
    btn.onclick = () => {
      container.querySelectorAll('.admin-tab-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      activeSubTab = btn.dataset.sub;
      loadSubTab();
    };
  });

  loadSubTab();
}

async function loadSubTab() {
  const wrap = document.getElementById('adminModerateContent');
  if (!wrap) return;

  switch (activeSubTab) {
    case 'feedback': await renderFeedback(wrap); break;
    case 'blocked': await renderBlocked(wrap); break;
    case 'words': await renderSensitiveWords(wrap); break;
  }
}

async function renderFeedback(wrap) {
  try {
    const data = await api('/admin/feedback?limit=100');
    wrap.innerHTML = `<table class="admin-table">
      <thead><tr><th>用户</th><th>类型</th><th>内容</th><th>时间</th><th>操作</th></tr></thead>
      <tbody>
        ${data.feedback.map((f) => `
          <tr>
            <td>${esc(f.username)}</td>
            <td><span class="admin-badge">${typeLabel(f.type)}</span></td>
            <td>${esc(f.content || '')}</td>
            <td>${fmtTime(f.created_at)}</td>
            <td><button class="admin-action-btn danger" data-action="del-fb" data-id="${f.id}">删除</button></td>
          </tr>
        `).join('') || '<tr><td colspan="5" class="empty">暂无反馈</td></tr>'}
      </tbody>
    </table>`;

    wrap.querySelectorAll('[data-action="del-fb"]').forEach((btn) => {
      btn.onclick = async () => {
        const ok = await uiConfirm('确认删除此反馈？\n\n此操作不可恢复。');
        if (!ok) return;
        await api(`/admin/feedback/${btn.dataset.id}`, { method: 'DELETE' });
        toast('已删除');
        loadSubTab();
      };
    });
  } catch (e) { wrap.innerHTML = `<div class="empty">加载失败：${esc(e.message)}</div>`; }
}

async function renderBlocked(wrap) {
  try {
    const data = await api('/admin/blocked-sources?limit=100');
    wrap.innerHTML = `<table class="admin-table">
      <thead><tr><th>用户</th><th>歌曲</th><th>类型</th><th>来源 ID</th><th>时间</th></tr></thead>
      <tbody>
        ${data.blocked.map((b) => `
          <tr>
            <td>${esc(b.username)}</td>
            <td>${esc(b.song_key)}</td>
            <td><span class="admin-badge">${b.source_type}</span></td>
            <td><code>${esc(b.source_id)}</code></td>
            <td>${fmtTime(b.blocked_at)}</td>
          </tr>
        `).join('') || '<tr><td colspan="5" class="empty">暂无屏蔽记录</td></tr>'}
      </tbody>
    </table>`;
  } catch (e) { wrap.innerHTML = `<div class="empty">加载失败：${esc(e.message)}</div>`; }
}

async function renderSensitiveWords(wrap) {
  try {
    const data = await api('/admin/sensitive-words?limit=500');
    wrap.innerHTML = `
      ${currentRole !== 'moderator' ? `
        <div style="margin-bottom:12px;display:flex;gap:8px">
          <input id="adminNewWord" type="text" placeholder="新增敏感词" style="flex:1" class="prompt-input" />
          <button class="btn sm green" id="adminAddWordBtn">添加</button>
        </div>
      ` : ''}
      <table class="admin-table">
        <thead><tr><th>词汇</th><th>分类</th><th>添加人</th><th>时间</th>${currentRole !== 'moderator' ? '<th>操作</th>' : ''}</tr></thead>
        <tbody>
          ${data.words.map((w) => `
            <tr>
              <td><code>${esc(w.word)}</code></td>
              <td><span class="admin-badge">${esc(w.category)}</span></td>
              <td>${esc(w.added_by || '-')}</td>
              <td>${fmtTime(w.created_at)}</td>
              ${currentRole !== 'moderator' ? `<td><button class="admin-action-btn danger" data-action="del-word" data-id="${w.id}">删除</button></td>` : '<td></td>'}
            </tr>
          `).join('') || '<tr><td colspan="5" class="empty">暂无敏感词</td></tr>'}
        </tbody>
      </table>
      <div style="margin-top:8px;color:var(--text-dim);font-size:12px">共 ${data.total} 词</div>
    `;

    const addBtn = wrap.querySelector('#adminAddWordBtn');
    if (addBtn) {
      addBtn.onclick = async () => {
        const word = wrap.querySelector('#adminNewWord').value.trim();
        if (!word) return toast('请输入词汇');
        try {
          await api('/admin/sensitive-words', { method: 'POST', body: { word, category: 'other' } });
          toast('已添加');
          loadSubTab();
        } catch (e) { toast(e.message || '添加失败'); }
      };
    }
    wrap.querySelectorAll('[data-action="del-word"]').forEach((btn) => {
      btn.onclick = async () => {
        await api(`/admin/sensitive-words/${btn.dataset.id}`, { method: 'DELETE' });
        toast('已删除');
        loadSubTab();
      };
    });
  } catch (e) { wrap.innerHTML = `<div class="empty">加载失败：${esc(e.message)}</div>`; }
}

function typeLabel(t) {
  const map = { bug: 'Bug', feature: '需求', other: '其他' };
  return map[t] || t;
}
