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

let swObserver = null;

async function renderSensitiveWords(wrap) {
  if (swObserver) { swObserver.disconnect(); swObserver = null; }

  const LIMIT = 50;
  const catColors = { political: '#e0556a', adult: '#e08050', spam: '#d4a017', other: '#6b7280' };
  const catLabels = { political: '政治', adult: '涉黄', spam: '垃圾', other: '其他' };
  const canEdit = currentRole !== 'moderator';
  let page = 1, total = 0, loading = false, done = false;

  const wordRow = (w) => {
    const cat = w.category || 'other';
    const color = catColors[cat] || catColors.other;
    return `
      <tr data-word-id="${w.id}">
        <td class="sw-word-cell"><code>${esc(w.word)}</code></td>
        <td><span class="sw-cat-badge" style="--cat-color:${color}">${esc(catLabels[cat] || cat)}</span></td>
        <td class="sw-meta">${esc(w.added_by || '-')}</td>
        <td class="sw-meta">${fmtTime(w.created_at)}</td>
        ${canEdit ? `<td>
          <button class="sw-del-btn" data-action="del-word" data-id="${w.id}" title="删除此词">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
            删除
          </button>
        </td>` : '<td></td>'}
      </tr>`;
  };

  wrap.innerHTML = `
    ${canEdit ? `
      <div class="sw-add-bar">
        <div class="sw-add-inner">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="sw-add-icon"><path d="M12 5v14M5 12h14"/></svg>
          <input id="adminNewWord" type="text" placeholder="输入敏感词，回车或点击添加..." class="sw-input" />
        </div>
        <button class="btn sm green sw-add-btn" id="adminAddWordBtn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
          添加
        </button>
      </div>
    ` : ''}
    <div class="sw-table-wrap" id="swScroll">
      <table class="admin-table sw-table">
        <thead><tr>
          <th>词汇</th><th>分类</th><th>添加人</th><th>时间</th>
          ${canEdit ? '<th>操作</th>' : ''}
        </tr></thead>
        <tbody id="swTbody"></tbody>
      </table>
      <div id="swSentinel" class="sw-sentinel" hidden></div>
    </div>
    <div class="sw-footer" id="swFooter">加载中…</div>
  `;

  const tbody = wrap.querySelector('#swTbody');
  const scroll = wrap.querySelector('#swScroll');
  const sentinel = wrap.querySelector('#swSentinel');
  const footer = wrap.querySelector('#swFooter');

  const updateFooter = () => { footer.innerHTML = `共 <strong>${total}</strong> 个敏感词`; };

  const loadPage = async () => {
    if (loading || done) return;
    loading = true;
    sentinel.hidden = false;
    sentinel.classList.add('loading');
    try {
      const data = await api(`/admin/sensitive-words?page=${page}&limit=${LIMIT}`);
      total = data.total;
      if (tbody.children.length === 0 && data.words.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${canEdit ? 5 : 4}" class="sw-empty">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <p>暂无敏感词</p></td></tr>`;
        return;
      }
      tbody.insertAdjacentHTML('beforeend', data.words.map(wordRow).join(''));
      bindDelete();
      page++;
      if (data.words.length < LIMIT) {
        done = true;
        sentinel.classList.remove('loading');
        sentinel.classList.add('done');
        sentinel.hidden = false;
        sentinel.innerHTML = '已加载全部';
      }
      updateFooter();
    } catch (e) {
      sentinel.classList.remove('loading');
      sentinel.innerHTML = `加载失败：${esc(e.message)}`;
      sentinel.hidden = false;
    } finally {
      loading = false;
    }
  };

  const bindDelete = () => {
    tbody.querySelectorAll('[data-action="del-word"]').forEach((btn) => {
      btn.onclick = async () => {
        const ok = await uiConfirm('确认删除此敏感词？\n\n匹配该词的内容将不再被过滤。');
        if (!ok) return;
        await api(`/admin/sensitive-words/${btn.dataset.id}`, { method: 'DELETE' });
        toast('已删除');
        loadSubTab();
      };
    });
  };

  // 无限滚动：sentinel 进入滚动容器视口时加载下一页
  swObserver = new IntersectionObserver((entries) => {
    if (entries.some((en) => en.isIntersecting)) loadPage();
  }, { root: scroll, rootMargin: '120px' });
  swObserver.observe(sentinel);

  // 初始加载第一页
  await loadPage();

  const inputEl = wrap.querySelector('#adminNewWord');
  const addBtn = wrap.querySelector('#adminAddWordBtn');
  const doAdd = async () => {
    const word = inputEl.value.trim();
    if (!word) return toast('请输入词汇');
    try {
      await api('/admin/sensitive-words', { method: 'POST', body: { word, category: 'other' } });
      toast('已添加');
      loadSubTab();
    } catch (e) { toast(e.message || '添加失败'); }
  };
  if (addBtn) {
    addBtn.onclick = doAdd;
    inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAdd(); });
  }
}

function typeLabel(t) {
  const map = { bug: 'Bug', feature: '需求', other: '其他' };
  return map[t] || t;
}
