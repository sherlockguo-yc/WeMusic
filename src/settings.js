// ---------------- 主题、设置面板、Sleep Timer、侧边栏拖拽 ----------------
import { $, toast, debounce, esc } from './utils.js';
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
    // 先加载自定义色板列表，再应用色板（因为可能是自定义颜色）
    await loadCustomPalettes();
    if (data.palette) { localStorage.setItem('wemusic_palette', data.palette); applyPalette(data.palette); }
    if (data.vol) { localStorage.setItem('wemusic_vol', data.vol); }
  } catch { console.warn('偏好同步失败') }
}
// 延迟同步（200ms 防抖）
const _dbSyncPrefs = debounce(syncPrefsToServer, 200);

// ---- 主题系统：Slot 配置 → CSS 变量映射 ----

/** 将 Slot 配置映射为 CSS 变量 */
export function applyThemeSlots(slots) {
  if (!slots) return;
  const root = document.documentElement;

  // bg Slot
  if (slots.bg) {
    const bg = slots.bg;
    if (bg.type === 'image' && bg.value) {
      root.style.setProperty('--theme-bg-image', `url(${bg.value})`);
    } else if (bg.type === 'gradient' && bg.value) {
      root.style.setProperty('--theme-bg-image', bg.value);
    } else {
      root.style.setProperty('--theme-bg-image', 'none');
    }
    root.style.setProperty('--theme-bg-overlay', bg.overlay || 'transparent');
    // 渐变融合色：取强调色或底色
    const fadeColor = bg.fadeColor || getComputedStyle(root).getPropertyValue('--bg').trim();
    root.style.setProperty('--theme-bg-fade-color', fadeColor);
  }

  // accent Slot
  if (slots.accent && slots.accent.value) {
    root.style.setProperty('--accent', slots.accent.value);
    root.style.setProperty('--theme-dust-color', slots.accent.value);
  }

  // font Slot
  if (slots.font && slots.font.value) {
    const fontKey = slots.font.value;
    const fontVal = FONTS[fontKey] || FONTS['default'];
    root.style.setProperty('--font', fontVal);
  }

  // player Slot
  if (slots.player && slots.player.value) {
    applyPlayerPreset(slots.player.value);
  }

  // card Slot
  if (slots.card && slots.card.value) {
    applyCardPreset(slots.card.value);
  }

  // sidebar Slot
  if (slots.sidebar) {
    const sb = slots.sidebar;
    if (sb.type === 'image' && sb.value) {
      root.style.setProperty('--theme-sidebar-bg', `url(${sb.value}) center/cover`);
    } else if (sb.type === 'color' && sb.value) {
      root.style.setProperty('--theme-sidebar-bg', sb.value);
    }
  }

  // decorations Slot — 仅记录值，CSS 侧通过 body[data-decorations] 处理
  if (slots.decorations && slots.decorations.value) {
    document.body.setAttribute('data-decorations', slots.decorations.value);
  } else {
    document.body.removeAttribute('data-decorations');
  }

  // lyrics Slot
  if (slots.lyrics && slots.lyrics.value) {
    if (slots.lyrics.type === 'color') {
      root.style.setProperty('--theme-lyrics-highlight', slots.lyrics.value);
    }
  }

  // scrollbar Slot
  if (slots.scrollbar && slots.scrollbar.value) {
    root.style.setProperty('--theme-scrollbar-thumb', slots.scrollbar.value);
  }

  // row Slot
  if (slots.row && slots.row.value) {
    applyRowPreset(slots.row.value);
  }

  // dust-color may differ from accent (e.g., gold dust on purple accent)
  if (slots.accent && slots.accent.dustColor) {
    root.style.setProperty('--theme-dust-color', slots.accent.dustColor);
  }
}

/** 激活主题：设置 data-theme 并应用 Slot */
export function activateTheme(themeId) {
  if (!themeId) { deactivateTheme(); return; }
  document.body.setAttribute('data-theme', themeId);
  // Phase 1：从 localStorage 读取硬编码测试数据
  // Phase 2 后改为从 API / 预设数据加载
  const testSlots = _getTestSlots();
  applyThemeSlots(testSlots);
}

/** 取消主题：移除 data-theme，恢复独立设置 */
export function deactivateTheme() {
  document.body.removeAttribute('data-theme');
  document.body.removeAttribute('data-decorations');
  const root = document.documentElement;
  // 清除主题变量，回退到 :root 默认值
  [
    '--theme-bg-image', '--theme-bg-overlay', '--theme-bg-fade-color',
    '--theme-sidebar-bg', '--theme-card-backdrop',
    '--theme-lyrics-highlight', '--theme-scrollbar-thumb',
    '--theme-row-playing-bg', '--theme-row-hover-bg',
    '--theme-dust-color',
  ].forEach((v) => root.style.removeProperty(v));
  // 恢复独立设置
  applyPalette(localStorage.getItem('wemusic_palette') || 'green');
  applyFont(localStorage.getItem('wemusic_font') || 'default');
  applyTheme(localStorage.getItem('wemusic_theme') || 'light');
}

// ---- 预设应用器 ----

function applyPlayerPreset(key) {
  const root = document.documentElement;
  switch (key) {
    case 'rounded-cover':
      root.style.setProperty('--theme-player-cover-radius', '12px'); break;
    case 'pill-cover':
      root.style.setProperty('--theme-player-cover-radius', '50%'); break;
    case 'borderless':
      root.style.setProperty('--theme-player-cover-radius', '0px'); break;
    default:
      root.style.setProperty('--theme-player-cover-radius', '6px');
  }
}

function applyCardPreset(key) {
  const root = document.documentElement;
  switch (key) {
    case 'glass-morphism':
      root.style.setProperty('--theme-card-backdrop', 'blur(12px)');
      root.style.setProperty('--theme-card-bg', 'rgba(255,255,255,0.06)');
      break;
    case 'flat':
      root.style.setProperty('--theme-card-shadow', 'none');
      root.style.setProperty('--theme-card-radius', '4px');
      root.style.setProperty('--theme-card-backdrop', 'none');
      break;
    case 'outlined':
      root.style.setProperty('--theme-card-bg', 'transparent');
      root.style.setProperty('--theme-card-border', 'var(--accent)');
      root.style.setProperty('--theme-card-backdrop', 'none');
      break;
    default:
      root.style.setProperty('--theme-card-bg', 'var(--bg-card)');
      root.style.setProperty('--theme-card-shadow', 'var(--shadow)');
      root.style.setProperty('--theme-card-radius', 'var(--radius)');
      root.style.setProperty('--theme-card-border', 'var(--border)');
      root.style.setProperty('--theme-card-backdrop', 'none');
  }
}

function applyRowPreset(key) {
  const root = document.documentElement;
  switch (key) {
    case 'subtle-stripe':
      root.style.setProperty('--theme-row-stripe-bg', 'rgba(255,255,255,0.02)');
      root.style.setProperty('--theme-row-hover-bg', 'rgba(255,255,255,0.06)');
      break;
    case 'highlight-hover':
      root.style.setProperty('--theme-row-hover-bg', 'rgba(255,255,255,0.08)');
      root.style.setProperty('--theme-row-playing-bg', 'rgba(255,255,255,0.12)');
      break;
    default:
      root.style.removeProperty('--theme-row-stripe-bg');
      root.style.removeProperty('--theme-row-hover-bg');
      root.style.removeProperty('--theme-row-playing-bg');
  }
}

// ---- Phase 1 测试数据 ----
function _getTestSlots() {
  return {
    bg:       { type: 'color', value: '#1a0a0f', overlay: 'transparent', fadeColor: '#0d0f12' },
    accent:   { type: 'color', value: '#FF6B9D', dustColor: 'rgba(255,107,157,0.5)' },
    font:     { type: 'font',  value: 'serif' },
    player:   { type: 'preset', value: 'rounded-cover' },
    card:     { type: 'preset', value: 'glass-morphism' },
    sidebar:  { type: 'color', value: '#0f080a' },
    decorations: { type: 'preset', value: 'none' },
    lyrics:   { type: 'color', value: '#FF6B9D' },
    scrollbar:{ type: 'color', value: '#553344' },
    row:      { type: 'preset', value: 'subtle-stripe' },
  };
}

// ---- 主题 ----
const mq = window.matchMedia('(prefers-color-scheme: light)');
const FONTS = {
  default: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
  serif:   '"Noto Serif SC", "Songti SC", "STSong", Georgia, "Times New Roman", serif',
  mono:    '"SF Mono", "JetBrains Mono", "Fira Code", Consolas, "Courier New", monospace',
  rounded: '"SF Pro Rounded", "PingFang SC", -apple-system, system-ui, sans-serif',
  hei:     '"Hiragino Sans GB", "PingFang SC", "Microsoft YaHei", "STHeiti", sans-serif',
  kai:     '"KaiTi", "STKaiti", "TW-Kai", "BiauKai", serif',
  'zcool-kuaile':  '"ZCOOL KuaiLe", "PingFang SC", "Microsoft YaHei", sans-serif',
  'zcool-qingke':  '"ZCOOL QingKe HuangYou", "KaiTi", "STKaiti", serif',
  'ma-shan-zheng': '"Ma Shan Zheng", "KaiTi", "STKaiti", serif',
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
  green:            '#2ab758',
  burgundy:         '#800020',
  'mummy-brown':    '#8F4B28',
  'prussian-blue':  '#003153',
  'titian-red':     '#B05923',
  'cream-oat':      '#F2E9E4',
  'matte-gold':     '#D4AF37',
  charcoal:         '#222222',
  'deep-gray':      '#444444',
  'page-gray':      '#F5F5F5',
  'deep-moss':      '#2D5546',
  'wine-red':       '#660033',
  'lake-gray-blue': '#7E8D98',
  'bean-green':     '#9CAF88',
  'dusty-rose':     '#D4B0B5',
  'camel-gray':     '#B5A89C',
  'cream-base':     '#F2EFE4',
  'caramel-brown':  '#B67162',
  taupe:            '#C89F94',
  'deep-purple-gray':'#4B4453',
};

// ---- 自定义主题色 ----
let customPalettes = []; // [{id, name, color, createdAt}, ...]

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = n => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)))
      .toString(16).padStart(2, '0');
  };
  return '#' + f(0) + f(8) + f(4);
}

function hexToHsl(hex) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) / 6
      : max === g ? ((b - r) / d + 2) / 6
      : ((r - g) / d + 4) / 6;
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function getColorByKey(key) {
  if (PALETTES[key]) return PALETTES[key];
  if (key && key.startsWith('custom_')) {
    const cp = customPalettes.find(p => p.id === key.replace('custom_', ''));
    if (cp) return cp.color;
  }
  return PALETTES.green;
}

export async function loadCustomPalettes() {
  try {
    const { customPalettes: list } = await api('/auth/custom-palettes');
    customPalettes = Array.isArray(list) ? list : [];
  } catch { customPalettes = []; }
}

async function saveCustomPaletteToServer(name, color) {
  const { palette } = await api('/auth/custom-palettes', {
    method: 'POST', body: { name, color }
  });
  customPalettes.push(palette);
  return palette;
}

async function deleteCustomPaletteFromServer(id) {
  await api('/auth/custom-palettes/' + id, { method: 'DELETE' });
  customPalettes = customPalettes.filter(p => p.id !== id);
}

export function applyPalette(key) {
  const color = getColorByKey(key);
  document.documentElement.style.setProperty('--accent', color);
  // 高亮系统预设色块
  document.querySelectorAll('.palette-item').forEach((b) => {
    b.classList.toggle('active', b.dataset.palette === key);
  });
  // 高亮自定义色块
  document.querySelectorAll('.custom-palette-swatch').forEach((b) => {
    b.classList.toggle('active', b.dataset.id === key);
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
let sleepEndTime = 0;
let sleepTick = null;

export function clearSleep() {
  if (sleepTimeout) { clearTimeout(sleepTimeout); sleepTimeout = null; }
  if (sleepTick) { clearInterval(sleepTick); sleepTick = null; }
  sleepEndTime = 0;
  sleepAfterSong = false;
}

export function updateSleepHint() {
  const hint = $('sleepHint');
  if (!hint) return;
  if (sleepAfterSong) { hint.textContent = '将在当前歌曲播完后停止'; return; }
  if (sleepEndTime) {
    const remain = Math.max(0, sleepEndTime - Date.now());
    const m = Math.floor(remain / 60000);
    const s = Math.floor((remain % 60000) / 1000);
    if (m > 0) {
      hint.textContent = `${m} 分 ${s} 秒后停止`;
    } else {
      hint.textContent = `${s} 秒后停止`;
    }
    return;
  }
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
  sleepEndTime = Date.now() + min * 60000;
  sleepTimeout = setTimeout(() => {
    // stopPlayback 在 player.js，通过动态导入避免循环依赖
    import('./player.js').then(({ stopPlayback }) => stopPlayback());
    clearSleep();
    toast('定时已到，已停止播放');
  }, min * 60000);
  sleepTick = setInterval(updateSleepHint, 1000);
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

// ---- 自定义主题色 UI ----
function selectPalette(key) {
  localStorage.setItem('wemusic_palette', key);
  applyPalette(key);
  _dbSyncPrefs();
  hideColorEditor();
}

function renderCustomPalettesUI(curPalette) {
  const container = $('customPalettes');
  const section = $('customPalettesSection');
  const btn = $('addCustomPaletteBtn');
  if (!container || !btn) return;
  container.innerHTML = '';
  const hasItems = customPalettes.length > 0;
  if (section) section.style.display = hasItems ? '' : 'none';
  if (!hasItems) { updateAddBtnState(); return; }
  customPalettes.forEach(cp => {
    const swatch = document.createElement('button');
    swatch.className = 'custom-palette-swatch';
    swatch.style.background = cp.color;
    swatch.dataset.id = 'custom_' + cp.id;
    swatch.title = cp.name || cp.color;
    swatch.classList.toggle('active', 'custom_' + cp.id === curPalette);
    swatch.onclick = () => selectPalette('custom_' + cp.id);

    const del = document.createElement('span');
    del.className = 'cp-delete';
    del.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    del.onclick = async (e) => {
      e.stopPropagation();
      console.log('[delete] 点击删除 ×，id=', cp.id, 'color=', cp.color);
      try {
        const { uiConfirm } = await import('./utils.js');
        const ok = await uiConfirm('删除自定义颜色「' + (cp.name || cp.color) + '」？');
        console.log('[delete] uiConfirm 结果=', ok);
        if (!ok) return;
        console.log('[delete] 调用 deleteCustomPaletteFromServer...');
        await deleteCustomPaletteFromServer(cp.id);
        console.log('[delete] 删除成功，剩余=', customPalettes.length, '个');
        const cur = localStorage.getItem('wemusic_palette');
        if (cur === 'custom_' + cp.id) {
          console.log('[delete] 当前使用的颜色被删除，回退到 green');
          localStorage.setItem('wemusic_palette', 'green');
          applyPalette('green');
          _dbSyncPrefs();
        }
        renderCustomPalettesUI(localStorage.getItem('wemusic_palette') || 'green');
        updateAddBtnState();
        console.log('[delete] UI 重新渲染完成');
      } catch (err) {
        console.error('[delete] 删除失败:', err);
        toast('删除失败：' + err.message);
      }
    };
    swatch.appendChild(del);
    container.appendChild(swatch);
  });
  updateAddBtnState();
}

function updateAddBtnState() {
  const btn = $('addCustomPaletteBtn');
  if (!btn) return;
  const full = customPalettes.length >= 8;
  btn.disabled = full;
  btn.title = full ? '已达上限（8个）' : '';
  // 移除旧 hint 再追加
  const old = btn.parentElement?.querySelector('.cp-disabled-hint');
  old?.remove();
  if (full) {
    const hint = document.createElement('span');
    hint.className = 'cp-disabled-hint';
    hint.textContent = '已达上限';
    btn.parentElement?.appendChild(hint);
  }
}

function hideColorEditor() {
  const editor = $('customColorEditor');
  if (editor) editor.style.display = 'none';
}

function setupCustomColorEditor() {
  const editor = $('customColorEditor');
  const hue = $('hueSlider');
  const sat = $('satSlider');
  const light = $('lightSlider');
  const hueNum = $('hueNum');
  const satNum = $('satNum');
  const lightNum = $('lightNum');
  const hex = $('hexInput');
  const native = $('nativeColorPicker');
  const preview = $('colorPreview');
  const name = $('colorNameInput');
  const saveBtn = $('saveColorBtn');
  const cancelBtn = $('cancelColorBtn');
  const addBtn = $('addCustomPaletteBtn');
  if (!editor || !hue || !sat || !light || !hex || !native || !preview) return;

  let updatingFromSliders = false;
  let updatingFromHex = false;

  function syncNums() {
    if (hueNum) hueNum.value = hue.value;
    if (satNum) satNum.value = sat.value;
    if (lightNum) lightNum.value = light.value;
  }

  function syncPreview() {
    const h = Number(hue.value), s = Number(sat.value), l = Number(light.value);
    const color = hslToHex(h, s, l);
    preview.style.background = color;
    if (!updatingFromSliders) {
      updatingFromSliders = true;
      hex.value = color;
      native.value = color;
      syncNums();
      updatingFromSliders = false;
    }
    // 动态更新 sat/light 滑块的渐变背景
    const satColor = hslToHex(h, 100, 50);
    sat.style.background = 'linear-gradient(to right, hsl(' + h + ',0%,' + l + '%), ' + satColor + ')';
    light.style.background = 'linear-gradient(to right, #000, ' + hslToHex(h, s, 50) + ', #fff)';
    // 实时预览主题色
    document.documentElement.style.setProperty('--accent', color);
  }

  function syncSliders(hexColor) {
    if (updatingFromHex) return;
    const hsl = hexToHsl(hexColor);
    updatingFromHex = true;
    hue.value = hsl.h; sat.value = hsl.s; light.value = hsl.l;
    syncNums();
    updatingFromHex = false;
    syncPreview();
  }

  hue.oninput = syncPreview;
  sat.oninput = syncPreview;
  light.oninput = syncPreview;

  // 数值输入框同步
  const updateFromNum = (slider, num, min, max) => {
    let val = parseInt(num.value, 10);
    if (isNaN(val)) return;
    val = Math.max(min, Math.min(max, val));
    if (val !== Number(num.value)) num.value = val;
    slider.value = val;
    syncPreview();
  };
  if (hueNum) hueNum.oninput = () => updateFromNum(hue, hueNum, 0, 360);
  if (satNum) satNum.oninput = () => updateFromNum(sat, satNum, 0, 100);
  if (lightNum) lightNum.oninput = () => updateFromNum(light, lightNum, 0, 100);

  // HEX 输入
  hex.oninput = () => {
    const val = hex.value.trim();
    if (/^#[0-9a-fA-F]{3,6}$/.test(val)) {
      // 展开 #abc → #aabbcc
      let c = val.replace('#', '');
      if (c.length === 3) c = c.split('').map(ch => ch + ch).join('');
      syncSliders('#' + c);
    }
  };
  hex.onblur = () => {
    const val = hex.value.trim();
    if (/^#[0-9a-fA-F]{3,6}$/.test(val)) {
      let c = val.replace('#', '');
      if (c.length === 3) c = c.split('').map(ch => ch + ch).join('');
      hex.value = '#' + c;
    }
  };

  // 原生取色器
  native.oninput = () => { syncSliders(native.value); hex.value = native.value; };

  // 打开编辑器
  if (addBtn) {
    addBtn.onclick = () => {
      if (customPalettes.length >= 8) return;
      editor.style.display = 'block';
      const cur = localStorage.getItem('wemusic_palette') || 'green';
      const color = getColorByKey(cur);
      const hsl = hexToHsl(color);
      hue.value = hsl.h; sat.value = hsl.s; light.value = hsl.l;
      syncNums();
      hex.value = color; native.value = color;
      syncPreview();
      name.value = '';
    };
  }

  // 保存
  if (saveBtn) {
    saveBtn.onclick = async () => {
      const color = hex.value.trim();
      if (!/^#[0-9a-fA-F]{6}$/.test(color)) { toast('请输入有效的颜色值'); return; }
      try {
        const palette = await saveCustomPaletteToServer(name.value.trim(), color);
        selectPalette('custom_' + palette.id);
        hideColorEditor();
        renderCustomPalettesUI(localStorage.getItem('wemusic_palette') || 'green');
      } catch (e) { toast('保存失败：' + e.message); }
    };
  }

  // 取消
  if (cancelBtn) {
    cancelBtn.onclick = () => {
      hideColorEditor();
      // 恢复原来的主题色
      const cur = localStorage.getItem('wemusic_palette') || 'green';
      applyPalette(cur);
    };
  }
}
export async function openSettings() {
  hideColorEditor();
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

  // 音量标准化开关
  const normToggle = $('volNormToggle');
  if (normToggle) {
    normToggle.checked = localStorage.getItem('wemusic_volume_normalize') === '1';
    normToggle.onchange = () => {
      localStorage.setItem('wemusic_volume_normalize', normToggle.checked ? '1' : '0');
      // 立即生效：通知 player.js 重新应用归一化
      window.dispatchEvent(new CustomEvent('volume_normalize_changed'));
    };
  }

  // 淡入淡出：直接选时长（含"关闭"）
  const curCrossfadeDur = localStorage.getItem('wemusic_crossfade_duration') || '5';
  const crossfadeEnabled = localStorage.getItem('wemusic_crossfade_enabled') === '1';
  document.querySelectorAll('.crossfade-opt').forEach((b) => {
    b.classList.toggle('active', crossfadeEnabled ? b.dataset.sec === curCrossfadeDur : b.dataset.sec === '0');
    b.onclick = () => {
      localStorage.setItem('wemusic_crossfade_duration', b.dataset.sec);
      localStorage.setItem('wemusic_crossfade_enabled', b.dataset.sec === '0' ? '0' : '1');
      document.querySelectorAll('.crossfade-opt').forEach((x) => x.classList.toggle('active', x === b));
      window.dispatchEvent(new CustomEvent('crossfade_changed'));
    };
  });

  // EQ 预设选择
  const curEQ = localStorage.getItem('wemusic_eq') || 'flat';
  document.querySelectorAll('.eq-opt').forEach((b) => {
    b.classList.toggle('active', b.dataset.eq === curEQ);
    b.onclick = () => {
      localStorage.setItem('wemusic_eq', b.dataset.eq);
      document.querySelectorAll('.eq-opt').forEach((x) => x.classList.toggle('active', x === b));
      window.dispatchEvent(new CustomEvent('eq_changed'));
    };
  });

  // 音频可视化：按钮组（含"关闭"）
  // 迁移：旧开关系统关闭 → "off" 状态
  if (localStorage.getItem('wemusic_spectrum') === '0') {
    localStorage.setItem('wemusic_spectrum_style', 'off');
  }
  // 从未设置过的用户默认关闭
  if (localStorage.getItem('wemusic_spectrum_style') === null) {
    localStorage.setItem('wemusic_spectrum_style', 'off');
  }
  const curSpectrumStyle = localStorage.getItem('wemusic_spectrum_style') || 'off';
  document.querySelectorAll('.spectrum-style-opt').forEach((b) => {
    b.classList.toggle('active', b.dataset.style === curSpectrumStyle);
    b.onclick = () => {
      localStorage.setItem('wemusic_spectrum_style', b.dataset.style);
      document.querySelectorAll('.spectrum-style-opt').forEach((x) => x.classList.toggle('active', x === b));
      window.dispatchEvent(new CustomEvent('spectrum_changed'));
    };
  });

  const curPalette = localStorage.getItem('wemusic_palette') || 'green';
  document.querySelectorAll('.palette-item').forEach((b) => {
    b.classList.toggle('active', b.dataset.palette === curPalette);
    b.onclick = () => { selectPalette(b.dataset.palette); };
  });

  // 渲染自定义色板（仅登录用户）
  if (Auth.user) {
    await loadCustomPalettes();
    renderCustomPalettesUI(curPalette);
    setupCustomColorEditor();
  } else {
    const container = $('customPalettes');
    const section = $('customPalettesSection');
    const btn = $('addCustomPaletteBtn');
    if (container) container.innerHTML = '';
    if (section) section.style.display = 'none';
    if (btn) btn.style.display = 'none';
  }

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
    setupScrollHint($('settingsModal').querySelector('.modal-content'));
  });
}

export function initSettings() {
  $('userAvatarWrap').onclick = openSettings;
  $('settingsClose').onclick = () => $('settingsModal').classList.remove('show');
  $('settingsModal').onclick = (e) => { if (e.target.id === 'settingsModal') $('settingsModal').classList.remove('show'); };
  $('settingsLogout').onclick = () => { Auth.clear(); location.href = '/login.html'; };

  // 移动端扫码弹窗
  $('showMobileQRBtn').onclick = () => {
    const url = 'https://wemusic.sherlockguo.com';
    $('mobileQRUrl').textContent = url;
    $('mobileQRImg').src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}`;
    $('mobileQRLan').textContent = url.replace(/^https?:\/\//, '');
    $('mobileQRModal').classList.add('show');
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

// Phase 1：控制台测试接口（Phase 2 后移除）
window.__theme = { activateTheme, deactivateTheme, applyThemeSlots };
