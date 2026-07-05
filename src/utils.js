// ---------------- 工具函数 ----------------

export const $ = (id) => document.getElementById(id);

// Lucide SVG 图标（放在 utils.js 避免被 manualChunks 拆分到独立 chunk 时出现 TDZ 错误）
// 注意：这里的"播放/暂停"图标用于"自动连播"开关，不是控制音乐播放
export const PLAY_ICON  = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg>';  // 自动连播已暂停 → 点击恢复
export const PAUSE_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>'; // 自动连播进行中 → 点击暂停

// 不喜欢图标：空心（默认） / 实心（已不喜欢）
// 实心态：心形用 currentColor 填充成灰色，斜线用固定深灰 #666 确保在填充上仍可见
export const BROKEN_HEART_OUTLINE = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/><line x1="3" y1="3" x2="21" y2="21"/></svg>';
export const BROKEN_HEART_FILLED  = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/><line x1="3" y1="3" x2="21" y2="21" stroke="#6b6b6b"/></svg>';

// 统一歌曲列表列头（避免 search.js / playlist-ui.js 重复定义）
export const songColHeader = `<div class="song-row-head">
  <span class="h-idx">#</span>
  <span class="h-name">歌名</span>
  <span class="h-singer">歌手</span>
  <span class="h-album">专辑</span>
  <span class="h-bookmark"></span>
  <span class="h-dur">时长</span>
  <span class="h-ops">操作</span>
</div>`;

export function fmtDur(sec) {
  sec = Number(sec) || 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function fmtTotal(sec) {
  sec = Number(sec) || 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h} 小时 ${m} 分`;
  return `${m} 分`;
}

export function fmtMin(sec) {
  sec = Number(sec) || 0;
  if (sec < 60) return '0m';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h${m}m`;
  return `${m}m`;
}

/** 四舍五入到分钟的中文格式：90 → "2 分钟" */
export function fmtFullMin(sec) {
  if (!sec) return '0 分钟';
  const m = Math.round(Number(sec) / 60);
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60), rm = m % 60;
  return `${h} 小时${rm ? ` ${rm} 分钟` : ''}`;
}

export function fmtSec(sec) {
  sec = Number(sec) || 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}小时${m}分`;
  return `${m}分钟`;
}

export function fmtPlay(n) {
  n = Number(n) || 0;
  if (n >= 1e8) return (n / 1e8).toFixed(1) + '亿';
  if (n >= 1e4) return (n / 1e4).toFixed(1) + '万';
  return String(n);
}

export function esc(str) {
  return String(str || '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])
  );
}

/** 周报/月报排名徽章 HTML */
export const rankBadge = (i) => `<span class="wr-rank r${i + 1 <= 3 ? i + 1 : 0}">${i + 1}</span>`;

export function debounce(fn, delay) {
  let t;
  return function (...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), delay); };
}

let toastTimer;
export function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

export function biliEmbed(bvid, startSec = 0) {
  // danmaku=1 默认开启，用户可通过 B 站播放器内置按钮开关
  //
  // B 站嵌入播放器会记住同一 bvid 的历史进度并自动恢复。
  // 解决方案：
  //   1. 加随机 _ts 参数使每次 URL 唯一 → B 站无法匹配历史记录 → 不恢复进度
  //   2. 从头播时传 t=1（t=0 被 B 站忽略）；回前台对齐进度时传实际秒数
  const ts = Date.now(); // 每次唯一，破坏 B 站的历史进度缓存
  const t = startSec > 1 ? Math.floor(startSec) : 1;
  return `https://player.bilibili.com/player.html?bvid=${bvid}&autoplay=1&high_quality=1&danmaku=1&as_wide=1&muted=0&t=${t}&_ts=${ts}`;
}

export function albumCover(albumMid, size = 300) {
  if (!albumMid) return '';
  // 用 + 'https:' + '//y.qq.com' 拼接，避免 Vite minifier 误把 https:// 识别为协议相对 URL 而被去除
  return 'https:' + '//' + 'y.qq.com/music/photo_new/T002R' + size + 'x' + size + 'M000' + albumMid + '.jpg';
}

export function singerAvatar(mid, size = 150) {
  if (!mid) return '';
  return 'https://y.gtimg.cn/music/photo_new/T001R' + size + 'x' + size + 'M000' + mid + '.jpg';
}

export function playlistCoverHtml(mids = []) {
  const cells = [];
  for (let i = 0; i < 4; i++) {
    const mid = mids[i];
    cells.push(
      mid
        ? `<img src="${albumCover(mid, 150)}" loading="lazy" onerror="this.style.visibility='hidden'" />`
        : '<div class="ph"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>'
    );
  }
  return `<div class="pl-grid-cover">${cells.join('')}</div>`;
}

export function uiPrompt(title, defaultVal = '') {
  return new Promise((resolve) => {
    const mask = $('promptModal');
    const input = $('promptInput');
    $('promptTitle').textContent = title;
    input.value = defaultVal;
    // 隐藏双输入弹窗可能残留的 label
    $('promptLabel1').style.display = 'none';
    $('promptLabel2').style.display = 'none';
    $('promptInput2').style.display = 'none';
    mask.classList.add('show');
    setTimeout(() => { input.focus(); input.select(); }, 30);
    const done = (val) => {
      mask.classList.remove('show');
      $('promptOk').onclick = null;
      $('promptCancel').onclick = null;
      input.onkeydown = null;
      mask.onclick = null;
      resolve(val);
    };
    $('promptOk').onclick = () => done(input.value.trim() || null);
    $('promptCancel').onclick = () => done(null);
    mask.onclick = (e) => { if (e.target === mask) done(null); };
    input.onkeydown = (e) => {
      if (e.key === 'Enter') done(input.value.trim() || null);
      else if (e.key === 'Escape') done(null);
    };
  });
}

/** 双输入弹窗：一个弹窗里同时编辑两个字段（如歌单名 + 简介）
 * @param title 弹窗标题
 * @param label1 第一个输入框的 label 文字（必传，会一直显示在 input 上方）
 * @param val1 第一个输入框的值
 * @param label2 第二个输入框的 label 文字（必传）
 * @param val2 第二个输入框的值 */
export function uiPromptDual(title = '', label1 = '', val1 = '', label2 = '', val2 = '') {
  return new Promise((resolve) => {
    const mask = $('promptModal');
    const input1 = $('promptInput');
    const input2 = $('promptInput2');
    const labelEl1 = $('promptLabel1');
    const labelEl2 = $('promptLabel2');
    $('promptTitle').textContent = title || '';
    labelEl1.textContent = label1;
    labelEl1.style.display = '';
    input1.placeholder = '';
    input1.value = val1;
    input1.style.display = '';
    labelEl2.textContent = label2;
    labelEl2.style.display = '';
    input2.placeholder = '';
    input2.value = val2;
    input2.style.display = '';
    mask.classList.add('show');
    setTimeout(() => { input1.focus(); input1.select(); }, 30);
    const done = (cancel) => {
      mask.classList.remove('show');
      $('promptOk').onclick = null;
      $('promptCancel').onclick = null;
      input1.onkeydown = null;
      input2.onkeydown = null;
      mask.onclick = null;
      input2.style.display = 'none';
      labelEl2.style.display = 'none';
      if (cancel) return resolve(null);
      resolve({ val1: input1.value.trim() || null, val2: input2.value.trim() || null });
    };
    $('promptOk').onclick = () => done(false);
    $('promptCancel').onclick = () => done(true);
    mask.onclick = (e) => { if (e.target === mask) done(true); };
    const onKey = (e) => {
      if (e.key === 'Enter') { if (e.target === input1) input2.focus(); else done(false); }
      else if (e.key === 'Escape') done(true);
    };
    input1.onkeydown = onKey;
    input2.onkeydown = onKey;
  });
}

export function uiConfirm(message) {
  return new Promise((resolve) => {
    const mask = $('promptModal');
    const input = $('promptInput');
    $('promptTitle').textContent = message;
    input.style.display = 'none';
    // 隐藏双输入弹窗可能残留的 label / input2
    $('promptLabel1').style.display = 'none';
    $('promptLabel2').style.display = 'none';
    $('promptInput2').style.display = 'none';
    mask.classList.add('show');
    const done = (val) => {
      mask.classList.remove('show');
      input.style.display = '';
      $('promptOk').onclick = null;
      $('promptCancel').onclick = null;
      mask.onclick = null;
      document.removeEventListener('keydown', onKey);
      resolve(val);
    };
    const onKey = (e) => { if (e.key === 'Escape') done(false); };
    document.addEventListener('keydown', onKey);
    $('promptOk').onclick = () => done(true);
    $('promptCancel').onclick = () => done(false);
    mask.onclick = (e) => { if (e.target === mask) done(false); };
  });
}

// ---- 全局 tooltip：统一 stats.js / playlist-ui.js 两套实现 ----
let _tipEl = null;

/** 初始化全局 tooltip（模块导入后调用一次即可） */
export function initGlobalTooltip() {
  if (_tipEl) return;
  _tipEl = document.createElement('div');
  _tipEl.style.cssText = 'display:none;position:fixed;z-index:9999;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;padding:5px 10px;font-size:12px;color:var(--text);pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,.15);white-space:nowrap';
  document.body.appendChild(_tipEl);
  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest('[data-tip]');
    if (!el) return;
    _tipEl.innerHTML = el.dataset.tip;
    _tipEl.style.display = 'block';
    const onMove = (ev) => { _tipEl.style.left = (ev.clientX + 12) + 'px'; _tipEl.style.top = (ev.clientY - 28) + 'px'; };
    onMove(e); el.addEventListener('mousemove', onMove, { once: true });
    const hide = () => { _tipEl.style.display = 'none'; el.removeEventListener('mouseleave', hide); };
    el.addEventListener('mouseleave', hide);
  });
}

/** 给元素设置 tooltip 内容（配合 initGlobalTooltip 使用） */
export function setTooltip(el, html) {
  el.removeAttribute('title');
  el.dataset.tip = html;
}

// ---- 候选弹窗共享逻辑（ui.js / lyrics.js 共用） ----

/** 拉取已屏蔽源列表 */
export async function fetchBlockedList(api, songKey, type) {
  try {
    const r = await api(`/stats/blocked/full?song=${encodeURIComponent(songKey)}&type=${type}`);
    return r.list || [];
  } catch { console.warn('获取屏蔽列表失败'); return []; }
}

/** 已屏蔽源 HTML 片段（typePrefix: 'cand' 或 'candLyrics'） */
export function blockedSectionHtml(blockedList, typePrefix = 'cand') {
  if (!blockedList.length) return '';
  const idKey = typePrefix === 'cand' ? 'bvid' : 'source_id';
  return `
    <div class="cand-blocked-section">
      <button class="cand-blocked-toggle" id="${typePrefix}BlockedToggle">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        已屏蔽的源（${blockedList.length}）
      </button>
      <div class="cand-blocked-list" id="${typePrefix}BlockedList" style="display:none">
        ${blockedList.map(b => `
          <div class="cand-blocked-row" data-${idKey}="${esc(b.source_id)}">
            <span class="cand-blocked-id">${esc(b.source_id)}</span>
            <span class="cand-blocked-time">${new Date(b.blocked_at).toLocaleDateString()}</span>
            <button class="cand-unblock-btn" title="取消屏蔽"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9"/><polyline points="3 4 3 9 8 9"/></svg> 恢复</button>
          </div>
        `).join('')}
      </div>
    </div>`;
}

/** 绑定已屏蔽区域的折叠/恢复按钮事件 */
export function bindBlockedSection(listEl, api, songKey, type, typePrefix = 'cand') {
  const idKey = typePrefix === 'cand' ? 'bvid' : 'source_id';
  const toggle = listEl.querySelector(`#${typePrefix}BlockedToggle`);
  if (toggle) {
    toggle.onclick = () => {
      const bl = listEl.querySelector(`#${typePrefix}BlockedList`);
      if (bl) bl.style.display = bl.style.display === 'none' ? '' : 'none';
    };
  }
  listEl.querySelectorAll('.cand-unblock-btn').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const row = btn.closest('.cand-blocked-row');
      const sourceId = row.dataset[idKey];
      try {
        await api('/stats/blocked', { method: 'DELETE', body: { song: songKey, type, sourceId } });
        row.remove();
        toast('已取消屏蔽');
      } catch (err) { toast('恢复失败：' + err.message); }
    };
  });
}

/** 给模态弹窗添加滚动提示遮罩：内容溢出时显示底部渐变箭头，滚到底部自动隐藏 */
export function setupScrollHint(modal) {
  const hint = modal.querySelector('.modal-scroll-hint');
  if (!hint) return;

  function check() {
    const canScroll = modal.scrollHeight > modal.clientHeight + 5;
    const atBottom = modal.scrollTop + modal.clientHeight >= modal.scrollHeight - 20;
    hint.classList.toggle('hidden', !canScroll || atBottom);
  }

  modal.addEventListener('scroll', check, { passive: true });
  // 首次打开时检查（给渲染留时间）
  requestAnimationFrame(() => requestAnimationFrame(check));
}
