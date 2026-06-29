// ---------------- 主题、设置面板、Sleep Timer、侧边栏拖拽 ----------------
import { $, toast } from './utils.js';
import { Auth, api } from './api.js';
import { state } from './state.js';

// ---- 主题 ----
const mq = window.matchMedia('(prefers-color-scheme: light)');
export function applyTheme(theme) {
  const effective = theme === 'system' ? (mq.matches ? 'light' : 'dark') : theme;
  document.body.classList.toggle('light', effective === 'light');
  document.querySelectorAll('.theme-opt').forEach((b) => {
    b.classList.toggle('active', b.dataset.theme === theme);
  });
}
mq.addEventListener('change', () => {
  if ((localStorage.getItem('wemusic_theme') || 'dark') === 'system') applyTheme('system');
});
applyTheme(localStorage.getItem('wemusic_theme') || 'dark');

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
    const { user } = await api('/auth/me');
    renderAvatar(user.avatar || null);
    if (Auth.user) Auth.user.avatar = user.avatar || null;
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
  const avatarUploadBtn = $('avatarUploadBtn');
  const avatarFileInput = $('avatarFileInput');
  const avatarPreview = $('avatarPreview');
  if (avatarUploadBtn) {
    avatarUploadBtn.onclick = () => avatarFileInput.click();
    avatarPreview.onclick = () => avatarFileInput.click();
    avatarFileInput.onchange = (e) => { uploadAvatar(e.target.files[0]); avatarFileInput.value = ''; };
  }
  const curTheme = localStorage.getItem('wemusic_theme') || 'dark';
  document.querySelectorAll('.theme-opt').forEach((b) => {
    b.classList.toggle('active', b.dataset.theme === curTheme);
    b.onclick = () => {
      localStorage.setItem('wemusic_theme', b.dataset.theme);
      applyTheme(b.dataset.theme);
      document.querySelectorAll('.theme-opt').forEach((x) => x.classList.toggle('active', x === b));
    };
  });
  updateSleepHint();
  document.querySelectorAll('.sleep-opt').forEach((b) => {
    b.classList.toggle('active', false);
    b.onclick = () => {
      setSleep(b.dataset.min);
      document.querySelectorAll('.sleep-opt').forEach((x) => x.classList.toggle('active', x === b));
    };
  });
  $('settingsModal').classList.add('show');
}

export function initSettings() {
  $('userAvatarWrap').onclick = openSettings;
  $('settingsBtn').onclick = openSettings;
  $('settingsClose').onclick = () => $('settingsModal').classList.remove('show');
  $('settingsModal').onclick = (e) => { if (e.target.id === 'settingsModal') $('settingsModal').classList.remove('show'); };
  $('settingsLogout').onclick = () => { Auth.clear(); location.href = '/login.html'; };

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
