// ---------------- 工具函数 ----------------

export const $ = (id) => document.getElementById(id);

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
  return albumMid ? `https://y.qq.com/music/photo_new/T002R${size}x${size}M000${albumMid}.jpg` : '';
}

export function playlistCoverHtml(mids = []) {
  const cells = [];
  for (let i = 0; i < 4; i++) {
    const mid = mids[i];
    cells.push(
      mid
        ? `<img src="${albumCover(mid, 150)}" loading="lazy" onerror="this.style.visibility='hidden'" />`
        : '<div class="ph">♪</div>'
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

export function uiConfirm(message) {
  return new Promise((resolve) => {
    const mask = $('promptModal');
    const input = $('promptInput');
    $('promptTitle').textContent = message;
    input.style.display = 'none';
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
