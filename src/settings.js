// ---------------- 主题、设置面板、Sleep Timer、侧边栏拖拽 ----------------
import { $, toast, debounce } from './utils.js';
import { Auth, api } from './api.js';
import { state } from './state.js';

// ---- 偏好同步（localStorage + 服务端） ----
// 收集所有需要同步的偏好 -> 上传服务端
export function syncPrefsToServer() {
  const prefs = {
    theme: localStorage.getItem('wemusic_theme') || 'light',
    font: localStorage.getItem('wemusic_font') || 'default',
    fontSize: localStorage.getItem('wemusic_font_size') || '14',
    palette: localStorage.getItem('wemusic_palette') || 'green',
    vol: localStorage.getItem('wemusic_vol') || '0.8',
  };
  api('/auth/preferences', { method: 'PUT', body: { data: prefs } }).catch(() => {});
}

// 从服务端加载偏好并应用
export async function loadPrefsFromServer() {
  try {
    const { data } = await api('/auth/preferences');
    const serverEmpty = !data || Object.keys(data).length === 0;
    if (serverEmpty) {
      // 服务端没数据：清理本地所有偏好键（防止之前的脏数据），用默认重置
      ['wemusic_theme', 'wemusic_font', 'wemusic_font_size', 'wemusic_palette', 'wemusic_vol']
        .forEach(k => localStorage.removeItem(k));
      // 重新应用默认值（applyTheme 等会回退到默认）
      applyTheme('light');
      applyFont('default');
      applyFontSize('14');
      applyPalette('green');
      // 把当前（默认）状态推上去建立基线
      syncPrefsToServer();
      return;
    }
    if (data.theme) { localStorage.setItem('wemusic_theme', data.theme); applyTheme(data.theme); }
    if (data.font) { localStorage.setItem('wemusic_font', data.font); applyFont(data.font); }
    if (data.fontSize) { localStorage.setItem('wemusic_font_size', data.fontSize); applyFontSize(data.fontSize); }
    if (data.palette) { localStorage.setItem('wemusic_palette', data.palette); applyPalette(data.palette); }
    if (data.vol) { localStorage.setItem('wemusic_vol', data.vol); }
  } catch {}
}
// 延迟同步（200ms 防抖）
const _dbSyncPrefs = debounce(syncPrefsToServer, 200);

// ---- 主题 ----
const mq = window.matchMedia('(prefers-color-scheme: light)');
const FONTS = {
  default: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
  serif:   '"Noto Serif SC", "Songti SC", "STSong", Georgia, "Times New Roman", serif',
  mono:    '"SF Mono", "JetBrains Mono", "Fira Code", Consolas, "Courier New", monospace',
  rounded: '"SF Pro Rounded", "PingFang SC", -apple-system, system-ui, sans-serif',
  hei:     '"Hiragino Sans GB", "PingFang SC", "Microsoft YaHei", "STHeiti", sans-serif',
  kai:     '"KaiTi", "STKaiti", "TW-Kai", "BiauKai", serif',
};

export function applyFont(key) {
  key = FONTS[key] ? key : 'default';
  document.documentElement.style.setProperty('--font', FONTS[key]);
  document.querySelectorAll('.font-opt').forEach((b) => {
    b.classList.toggle('active', b.dataset.font === key);
  });
}
applyFont(localStorage.getItem('wemusic_font') || 'default');

const PALETTES = {
  green:  '#2ab758',
  blue:   '#298bbc',
  red:    '#bc2929',
  orange: '#bc6729',
  yellow: '#bc9729',
  pink:   '#bc294e',
  purple: '#5a29bc',
  teal:   '#29bca4',
  indigo: '#295abc',
  gray:   '#7a8590',
};
export function applyPalette(key) {
  key = PALETTES[key] ? key : 'green';
  const color = PALETTES[key];
  document.documentElement.style.setProperty('--accent', color);
  document.querySelectorAll('.palette-opt').forEach((b) => {
    b.classList.toggle('active', b.dataset.palette === key);
  });
}
applyPalette(localStorage.getItem('wemusic_palette') || 'green');

// 赞赏码 — base64 编码嵌入代码，避免开源分发后用户轻易替换二维码

export function applyFontSize(size) {
  size = ['13','14','16','18'].includes(size) ? size : '14';
  document.documentElement.style.setProperty('--font-size', size + 'px');
  document.querySelectorAll('.size-opt').forEach((b) => {
    b.classList.toggle('active', b.dataset.size === size);
  });
}
applyFontSize(localStorage.getItem('wemusic_font_size') || '14');

export function applyTheme(theme) {
  const effective = theme === 'system' ? (mq.matches ? 'light' : 'dark') : theme;
  document.body.classList.toggle('light', effective === 'light');
  document.querySelectorAll('.theme-opt').forEach((b) => {
    b.classList.toggle('active', b.dataset.theme === theme);
  });
  // 切换配色方案后重新应用色板强调色
  applyPalette(localStorage.getItem('wemusic_palette') || 'green');
}
mq.addEventListener('change', () => {
  if ((localStorage.getItem('wemusic_theme') || 'light') === 'system') applyTheme('system');
});
applyTheme(localStorage.getItem('wemusic_theme') || 'light');

// ---- Sleep Timer ----
export let sleepTimeout = null;
export let sleepAfterSong = false;

export function clearSleep() {
  if (sleepTimeout) { clearTimeout(sleepTimeout); sleepTimeout = null; }
  sleepAfterSong = false;
}

export function updateSleepHint() {
  const hint = $('sleepHint');
  if (!hint) return;
  if (sleepAfterSong) { hint.textContent = '将在当前歌曲播完后停止'; return; }
  if (sleepTimeout) { hint.textContent = '定时已设置，播放中…'; return; }
  hint.textContent = '';
}

export function setSleep(v) {
  clearSleep();
  if (v === '0') { toast('已取消定时关闭'); updateSleepHint(); return; }
  if (v === 'song') {
    sleepAfterSong = true;
    toast('将在当前歌曲播完后停止');
    updateSleepHint();
    return;
  }
  const min = Number(v);
  sleepTimeout = setTimeout(() => {
    // stopPlayback 在 player.js，通过动态导入避免循环依赖
    import('./player.js').then(({ stopPlayback }) => stopPlayback());
    clearSleep();
    toast('定时已到，已停止播放');
  }, min * 60000);
  toast(`已设置 ${min} 分钟后停止`);
  updateSleepHint();
}

// ---- 头像 ----
export function renderAvatar(dataUrl) {
  const username = Auth.user?.username || '';
  const initial = username.charAt(0) || '?';
  const img = $('userAvatar');
  const fallback = $('userAvatarFallback');
  if (dataUrl) {
    img.src = dataUrl; img.style.display = 'block';
    fallback.textContent = ''; fallback.style.display = 'none';
  } else {
    img.style.display = 'none';
    fallback.textContent = initial; fallback.style.display = '';
  }
  const previewImg = $('avatarPreviewImg');
  const previewFallback = $('avatarPreviewFallback');
  if (previewImg && previewFallback) {
    if (dataUrl) {
      previewImg.src = dataUrl; previewImg.style.display = 'block';
      previewFallback.textContent = ''; previewFallback.style.display = 'none';
    } else {
      previewImg.style.display = 'none';
      previewFallback.textContent = initial; previewFallback.style.display = '';
    }
  }
}

export async function loadAvatar() {
  try {
    const resp = await api('/auth/me');
    const user = resp.user;
    renderAvatar(user.avatar || null);
    if (Auth.user) Auth.user.avatar = user.avatar || null;
    // 设置全局管理员标记 + 用户名
    const { state } = await import('./state.js');
    state.isAdmin = resp.isAdmin || false;
    state.user = { id: user.id, username: user.username, avatar: user.avatar };
  } catch { renderAvatar(null); }
}

function compressImage(dataUrl, maxSize) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let w = img.width, h = img.height;
      if (w > maxSize || h > maxSize) {
        if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
        else { w = Math.round(w * maxSize / h); h = maxSize; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.src = dataUrl;
  });
}

export async function uploadAvatar(file) {
  if (!file) return;
  if (file.size > 3 * 1024 * 1024) { toast('图片过大，请选择小于 3MB 的图片'); return; }
  const reader = new FileReader();
  reader.onload = async (e) => {
    const compressed = await compressImage(e.target.result, 300);
    try {
      await api('/auth/avatar', { method: 'PUT', body: { avatar: compressed } });
      if (Auth.user) Auth.user.avatar = compressed;
      renderAvatar(compressed);
      toast('头像已更新');
    } catch (err) {
      toast('上传失败：' + err.message);
    }
  };
  reader.readAsDataURL(file);
}

// ---- 设置面板 ----
export function openSettings() {
  $('settingsUser').textContent = Auth.user?.username || '';
  renderAvatar(Auth.user?.avatar || null);
  const avatarPreview = $('avatarPreview');
  const avatarFileInput = $('avatarFileInput');
  if (avatarPreview && avatarFileInput) {
    avatarPreview.onclick = () => avatarFileInput.click();
    avatarFileInput.onchange = (e) => { uploadAvatar(e.target.files[0]); avatarFileInput.value = ''; };
  }
  const curTheme = localStorage.getItem('wemusic_theme') || 'light';
  document.querySelectorAll('.theme-opt').forEach((b) => {
    b.classList.toggle('active', b.dataset.theme === curTheme);
    b.onclick = () => {
      localStorage.setItem('wemusic_theme', b.dataset.theme);
      applyTheme(b.dataset.theme);
      _dbSyncPrefs();
    };
  });
  const curFont = localStorage.getItem('wemusic_font') || 'default';
  document.querySelectorAll('.font-opt').forEach((b) => {
    b.classList.toggle('active', b.dataset.font === curFont);
    b.onclick = () => { localStorage.setItem('wemusic_font', b.dataset.font); applyFont(b.dataset.font); _dbSyncPrefs(); };
  });
  const curFontSize = localStorage.getItem('wemusic_font_size') || '14';
  document.querySelectorAll('.size-opt').forEach((b) => {
    b.classList.toggle('active', b.dataset.size === curFontSize);
    b.onclick = () => { localStorage.setItem('wemusic_font_size', b.dataset.size); applyFontSize(b.dataset.size); _dbSyncPrefs(); };
  });
  const curPalette = localStorage.getItem('wemusic_palette') || 'green';
  document.querySelectorAll('.palette-opt').forEach((b) => {
    b.classList.toggle('active', b.dataset.palette === curPalette);
    b.onclick = () => { localStorage.setItem('wemusic_palette', b.dataset.palette); applyPalette(b.dataset.palette); _dbSyncPrefs(); };
  });
  updateSleepHint();

  // 定时停止按钮
  const customWrap = $('sleepCustomWrap');
  const customBtn = $('sleepCustomBtn');
  const customInput = $('sleepCustomInput');
  customWrap?.classList.remove('editing');

  const activeMin = sleepTimeout ? null : (sleepAfterSong ? 'song' : '0');
  document.querySelectorAll('.sleep-opt').forEach((b) => {
    const isActive = (activeMin != null) ? (b.dataset.min === activeMin) : false;
    b.classList.toggle('active', isActive);
    b.onclick = () => {
      setSleep(b.dataset.min);
      document.querySelectorAll('.sleep-opt').forEach((x) => x.classList.toggle('active', x === b));
      customBtn?.classList.remove('active');
    };
  });
  // 自定义定时：点击按钮 → 变成输入框 → 回车确认
  if (customBtn && customInput && customWrap) {
    const isCustom = sleepTimeout && !sleepAfterSong;
    customBtn.classList.toggle('active', isCustom);
    customBtn.onclick = () => {
      customWrap.classList.add('editing');
      customInput.value = '';
      customInput.focus();
    };
    const commitCustom = () => {
      const val = customInput.value.trim();
      customWrap.classList.remove('editing');
      if (!val) return;
      const min = parseInt(val, 10);
      if (!min || min < 1 || min > 480) { toast('请输入 1-480 分钟'); return; }
      setSleep(String(min));
      document.querySelectorAll('.sleep-opt').forEach((x) => x.classList.remove('active'));
      customBtn.classList.add('active');
    };
    customInput.onkeydown = (e) => {
      if (e.key === 'Enter') commitCustom();
      else if (e.key === 'Escape') { customWrap.classList.remove('editing'); customInput.value = ''; }
    };
    customInput.onblur = () => { customWrap.classList.remove('editing'); customInput.value = ''; };
  }
  $('settingsModal').classList.add('show');
  // 内容溢出时显示底部滚动提示
  import('./utils.js').then(({ setupScrollHint }) => {
    setupScrollHint($('settingsModal').querySelector('.modal'));
  });
}

export function initSettings() {
  $('userAvatarWrap').onclick = openSettings;
  $('settingsClose').onclick = () => $('settingsModal').classList.remove('show');
  $('settingsModal').onclick = (e) => { if (e.target.id === 'settingsModal') $('settingsModal').classList.remove('show'); };
  $('settingsLogout').onclick = () => { Auth.clear(); location.href = '/login.html'; };

  // 移动端扫码弹窗
  $('showMobileQRBtn').onclick = async () => {
    try {
      const { url } = await api('/lan-url');
      $('mobileQRUrl').textContent = url;
      $('mobileQRImg').src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}`;
      $('mobileQRLan').textContent = url.replace(/^https?:\/\//, '');
      $('mobileQRModal').classList.add('show');
    } catch (e) {
      toast('获取局域网地址失败：' + e.message);
    }
  };
  $('mobileQRClose').onclick = () => $('mobileQRModal').classList.remove('show');
  $('mobileQRModal').onclick = (e) => { if (e.target.id === 'mobileQRModal') $('mobileQRModal').classList.remove('show'); };

  // 打赏弹窗：使用 public/icons/donate-qr-cropped.png 静态资源
  $('donateBtn').onclick = () => { $('donateModal').classList.add('show'); };
  $('donateClose').onclick = () => $('donateModal').classList.remove('show');
  $('donateModal').onclick = (e) => { if (e.target.id === 'donateModal') $('donateModal').classList.remove('show'); };

  // 反馈弹窗（顶栏按钮入口）
  $('feedbackTopBtn').onclick = () => {
    $('feedbackModal').classList.add('show');
    $('feedbackContent').value = '';
    document.querySelectorAll('.feedback-type-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
    feedbackType = 'bug';
  };
  $('feedbackCancel').onclick = () => $('feedbackModal').classList.remove('show');
  $('feedbackModal').onclick = (e) => { if (e.target.id === 'feedbackModal') $('feedbackModal').classList.remove('show'); };
  let feedbackType = 'bug';
  document.querySelectorAll('.feedback-type-btn').forEach((b) => {
    b.onclick = () => {
      feedbackType = b.dataset.type;
      document.querySelectorAll('.feedback-type-btn').forEach((x) => x.classList.toggle('active', x === b));
    };
  });
  $('feedbackSubmit').onclick = async () => {
    const content = $('feedbackContent').value.trim();
    if (!content) return toast('请输入反馈内容');
    try {
      await api('/stats/feedback', { method: 'POST', body: { type: feedbackType, content } });
      $('feedbackModal').classList.remove('show');
      toast('感谢你的反馈！');
    } catch (e) { toast('提交失败：' + e.message); }
  };

  // 侧边栏宽度拖拽
  const app = document.querySelector('.app');
  const resizer = $('sidebarResizer');
  if (resizer) {
    const MIN = 180, MAX = 440;
    const applyW = (w) => {
      app.style.setProperty('--side-w', w + 'px');
      resizer.style.left = w + 'px';
    };
    const saved = parseInt(localStorage.getItem('wemusic_sidebar') || '', 10);
    if (saved >= MIN && saved <= MAX) applyW(saved);
    let dragging = false;
    resizer.addEventListener('mousedown', (e) => {
      if (window.innerWidth <= 720) return;
      dragging = true; resizer.classList.add('active');
      document.body.style.userSelect = 'none'; e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      applyW(Math.max(MIN, Math.min(MAX, e.clientX)));
    });
    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false; resizer.classList.remove('active');
      document.body.style.userSelect = '';
      const w = parseInt(getComputedStyle(app).getPropertyValue('--side-w')) || 240;
      localStorage.setItem('wemusic_sidebar', String(w));
    });
  }
}
