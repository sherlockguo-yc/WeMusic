// ---------------- 主题、设置面板、Sleep Timer、侧边栏拖拽 ----------------
import { $, toast, debounce, esc } from './utils.js';
import { Auth, api } from './api.js';
import { state } from './state.js';

// ---- 智能切换（Phase 4）----
/** 智能切换是否启用（默认 true） */
let _smartEnabled = localStorage.getItem('wemusic_smart_theme') !== '0';
/** 手动切换后暂停智能切换的截止时间戳 */
let _smartPauseUntil = parseInt(localStorage.getItem('wemusic_smart_pause') || '0', 10) || 0;
/** 上次检测到的歌曲，避免重复触发 */
let _lastSongKey = '';
/** 智能切换检测定时器 */
let _smartTimer = null;

function _saveSmartState() {
  localStorage.setItem('wemusic_smart_theme', _smartEnabled ? '1' : '0');
  localStorage.setItem('wemusic_smart_pause', String(_smartPauseUntil));
}

/** 检查当前歌曲是否需要切换主题 */
async function _trySmartThemeSwitch(song) {
  if (!_smartEnabled) return;
  if (Date.now() < _smartPauseUntil) return;
  if (!song || !song.singer) return;

  await loadPresets();
  const allThemes = [...(_presetsCache || []), ...(_customThemes || [])];
  const singer = (song.singer || '').split('/')[0].trim(); // 取主歌手（多歌手用 / 分隔）
  if (!singer) return;

  // 匹配：主题的 artistNames 任一项与歌手名相符（双向包含匹配）
  const matched = allThemes.find((t) => {
    if (!t || t.id === 'classic-wemusic') return false;
    const names = t.artistNames && t.artistNames.length ? t.artistNames : (t.artist ? [t.artist] : []);
    return names.some((n) => {
      if (!n) return false;
      const n2 = n.split('/')[0].trim();
      return singer === n2 || singer.includes(n2) || n2.includes(singer);
    });
  });
  if (!matched) return;

  const currentId = localStorage.getItem('wemusic_activeTheme');
  if (currentId === matched.id) return; // 已是目标主题

  await activateTheme(matched.id);
  localStorage.setItem('wemusic_activeThemeName', matched.name);
  _updateThemeLabel();
  toast(`智能切换：「${matched.name}」`);
}

/** 启动智能切换定时检测 */
function _startSmartSwitchMonitor() {
  if (_smartTimer) return;
  _smartTimer = setInterval(() => {
    const cur = state.current;
    if (!cur) return;
    const key = `${cur.name || ''}__${cur.singer || ''}`;
    if (key === _lastSongKey) return;
    _lastSongKey = key;
    _trySmartThemeSwitch(cur);
  }, 2000);
}

/** 用户手动切换主题：暂停智能切换 24h */
export function pauseSmartTheme() {
  _smartPauseUntil = Date.now() + 24 * 60 * 60 * 1000;
  _saveSmartState();
}

export function setSmartThemeEnabled(enabled) {
  _smartEnabled = enabled;
  _saveSmartState();
}

export function getSmartThemeStatus() {
  return {
    enabled: _smartEnabled,
    pauseUntil: _smartPauseUntil,
    paused: Date.now() < _smartPauseUntil,
  };
}

/** 更新智能切换状态文本 */
function _updateSmartStatus() {
  const el = $('smartThemeStatus');
  if (!el) return;
  const status = getSmartThemeStatus();
  if (!status.enabled) {
    el.textContent = '已关闭';
  } else if (status.paused) {
    const hrs = Math.max(1, Math.round((status.pauseUntil - Date.now()) / 3600000));
    el.textContent = `已暂停（${hrs}h 后恢复）`;
  } else {
    el.textContent = '已启用';
  }
}

// ---- 偏好同步（localStorage + 服务端） ----
// 收集所有需要同步的偏好 -> 上传服务端
export function syncPrefsToServer() {
  const prefs = {
    theme: localStorage.getItem('wemusic_theme') || 'light',
    font: localStorage.getItem('wemusic_font') || 'default',
    fontSize: localStorage.getItem('wemusic_font_size') || '14',
    palette: localStorage.getItem('wemusic_palette') || 'green',
    vol: localStorage.getItem('wemusic_vol') || '0.8',
    activeTheme: localStorage.getItem('wemusic_activeTheme') || '',
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
      if (bg.overlay) {
        root.style.setProperty('--theme-bg-overlay', bg.overlay);
      } else {
        // 亮度自适应：未显式指定 overlay，自动采样图片亮度计算遮罩
        const isLight = document.body.classList.contains('light');
        _getImageBrightness(bg.value).then((brightness) => {
          root.style.setProperty('--theme-bg-overlay', _computeAutoOverlay(brightness, isLight));
        });
      }
    } else if (bg.type === 'gradient' && bg.value) {
      root.style.setProperty('--theme-bg-image', bg.value);
      root.style.setProperty('--theme-bg-overlay', bg.overlay || 'transparent');
    } else {
      root.style.setProperty('--theme-bg-image', 'none');
      root.style.setProperty('--theme-bg-overlay', bg.overlay || 'transparent');
    }
    // 渐变融合色
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

// ---- 亮度自适应检测 ----

/** Canvas 采样图片平均亮度（0-255） */
function _getImageBrightness(imageUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const scale = Math.min(1, 50 / Math.min(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;
      let sum = 0, count = 0;
      for (let i = 0; i < data.length; i += 4) {
        sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        count++;
      }
      resolve(sum / count);
    };
    img.onerror = () => resolve(128); // 加载失败 → 中等亮度兜底
    img.src = imageUrl;
  });
}

/** 根据图片亮度和当前深浅色模式自动计算遮罩透明度 */
function _computeAutoOverlay(brightness, isLightMode) {
  if (isLightMode) {
    if (brightness > 170) return 'rgba(255,255,255,0.05)';
    if (brightness >= 85) return 'rgba(255,255,255,0.1)';
    return 'rgba(255,255,255,0.2)';
  } else {
    // 深色模式
    if (brightness > 170) return 'rgba(0,0,0,0.7)';
    if (brightness >= 85) return 'rgba(0,0,0,0.5)';
    return 'rgba(0,0,0,0.3)';
  }
}

/** 激活主题：设置 data-theme 并应用 Slot */
export async function activateTheme(themeId) {
  if (!themeId) { deactivateTheme(); return; }
  document.body.setAttribute('data-theme', themeId);

  const isLight = document.body.classList.contains('light');
  let slots = null;

  // 自定义主题：从本地缓存加载
  if (themeId.startsWith('custom-')) {
    const ct = (_customThemes || []).find((t) => t.id === themeId);
    if (ct) {
      const variant = isLight ? (ct.dayVariant || ct.nightVariant) : (ct.nightVariant || ct.dayVariant);
      if (variant?.slots) slots = variant.slots;
    }
  } else {
    // 预设主题：从 API 加载
    try {
      const { theme } = await api(`/themes/presets/${themeId}`);
      if (theme) {
        const variant = isLight ? (theme.dayVariant || theme.nightVariant) : (theme.nightVariant || theme.dayVariant);
        if (variant?.slots) slots = variant.slots;
      }
    } catch (e) { /* 加载失败，回退到测试数据 */ }
  }

  if (!slots) slots = _getTestSlots();

  applyThemeSlots(slots);
  // 重播背景层淡入动画
  const layer = document.querySelector('.theme-bg-layer');
  if (layer) { layer.style.animation = 'none'; layer.offsetHeight; layer.style.animation = ''; }
  localStorage.setItem('wemusic_activeTheme', themeId);
  // 更新设置面板中的主题名称显示
  _updateThemeLabel();
}

/** 取消主题：移除 data-theme，恢复独立设置 */
export function deactivateTheme() {
  document.body.removeAttribute('data-theme');
  document.body.removeAttribute('data-decorations');
  localStorage.removeItem('wemusic_activeTheme');
  localStorage.removeItem('wemusic_activeThemeName');
  _updateThemeLabel();
  const root = document.documentElement;
  // 清除主题变量，回退到 :root 默认值
  [
    '--theme-bg-image', '--theme-bg-overlay', '--theme-bg-fade-color',
    '--theme-sidebar-bg', '--theme-card-backdrop', '--theme-card-bg',
    '--theme-card-shadow', '--theme-card-radius', '--theme-card-border',
    '--theme-player-cover-radius', '--theme-player-progress-height',
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
      // Phase 1：CSS 端尚无 stripe 规则，先只设占位变量（不修改 hover/playing，避免误改默认行为）
      root.style.setProperty('--theme-row-stripe-bg', 'rgba(255,255,255,0.02)');
      break;
    case 'highlight-hover':
      // Phase 1：CSS 端未启用，仅设占位
      root.style.setProperty('--theme-row-hover-bg', 'rgba(255,255,255,0.04)');
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
    sidebar:  { type: 'color', value: '#0f080a' },
    decorations: { type: 'preset', value: 'star-dust' },
    scrollbar:{ type: 'color', value: '#553344' },
    card:     { type: 'preset', value: 'default' },
    row:      { type: 'preset', value: 'default' },
  };
}

// ---- Phase 2：预设主题系统 ----

/** 预设主题元数据缓存（id → { name, artist, decorations, ... }） */
let _presetsCache = null;

/** 从服务端加载预设主题元数据 + 用户自定义主题 */
export async function loadPresets() {
  if (_presetsCache !== null) return; // 已缓存，快速返回
  try {
    const [presetRes, customRes] = await Promise.allSettled([
      api('/themes/presets'),
      api('/auth/themes'),
    ]);
    _presetsCache = (presetRes.status === 'fulfilled' ? presetRes.value.presets : []) || [];
    _customThemes = (customRes.status === 'fulfilled' ? customRes.value.themes : []) || [];
  } catch (e) {
    _presetsCache = [];
    _customThemes = [];
  }
}

/** 强制刷新预设缓存（创建/更新自定义主题后调用） */
export async function refreshPresets() {
  _presetsCache = null;
  _customThemes = [];
  await loadPresets();
}

// 自定义主题缓存
let _customThemes = [];

// 骨架屏 HTML 常量
const SKELETON_HTML = '<div class="theme-grid-loading">' +
  Array(4).fill('<div class="theme-skeleton"></div>').join('') + '</div>';

/** 高亮一组选项按钮并设置点击回调（仅首次绑定，后续只更新高亮） */
function _bindOptionGroup(selector, { getActive, getDataKey, onSelect }) {
  const els = document.querySelectorAll(selector);
  if (els.length === 0) return;
  // 检查是否已绑定（通过 data-bound 属性）
  const bound = els[0].dataset.bound === '1';
  const activeVal = getActive();
  els.forEach((el) => {
    el.classList.toggle('active', el.dataset[getDataKey] === activeVal);
    if (!bound) {
      el.dataset.bound = '1';
      el.addEventListener('click', () => {
        onSelect(el.dataset[getDataKey], el);
        els.forEach((x) => x.classList.toggle('active', x === el));
      });
    }
  });
}

/** 更新设置面板中的主题名称标签 */
function _updateThemeLabel() {
  const label = $('activeThemeName');
  const btn = $('chooseThemeBtn');
  if (!label || !btn) return;
  const id = localStorage.getItem('wemusic_activeTheme');
  const name = localStorage.getItem('wemusic_activeThemeName');
  if (id && name) {
    label.textContent = name;
    label.style.display = '';
    btn.textContent = '更换';
  } else {
    label.textContent = '未启用';
    label.style.display = '';
    btn.textContent = '选择主题';
  }
}

/** 渲染主题选择器弹窗 */
async function _renderThemeSelector() {
  if (!_presetsCache) await loadPresets();

  const grid = $('themeSelectorGrid');
  if (!grid) return;

  // 加载中状态：骨架屏
  const allThemes = [...(_presetsCache || []), ...((_customThemes || []).map((t) => ({ ...t, artist: t.artist || '' })))];
  if ((!_presetsCache || _presetsCache.length === 0) && _customThemes.length === 0) {
    grid.innerHTML = SKELETON_HTML;
    return;
  }

  const activeId = localStorage.getItem('wemusic_activeTheme') || '';
  const isLight = document.body.classList.contains('light');

  // 为自定义主题生成最小预览字段
  const _makePreview = (t) => {
    if (t.preview) return t.preview;
    const ds = t.dayVariant?.slots || {};
    return {
      dayBg: ds.bg?.value || '#f4f6f9', nightBg: '#0d0f12',
      dayAccent: ds.accent?.value || '#2ab758', nightAccent: ds.accent?.value || '#2ab758',
      daySidebar: ds.sidebar?.value || '#fafbfd', nightSidebar: '#0d0f12',
      dayText: '#1b1d22', nightText: '#e0e3e8',
      coverRadius: ds.player?.value === 'pill-cover' ? '50%' : '6px',
    };
  };

  grid.innerHTML = allThemes.map((p) => {
    const pv = _makePreview(p);
    const bg = isLight ? (pv.dayBgColor || pv.dayBg) : (pv.nightBgColor || pv.nightBg);
    const accent = isLight ? pv.dayAccent : pv.nightAccent;
    const sidebarBg = isLight ? pv.daySidebar : pv.nightSidebar;
    const textColor = isLight ? pv.dayText : pv.nightText;
    const rowBg = isLight ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.06)';
    const chromeBg = isLight ? 'rgba(0,0,0,0.06)' : 'rgba(0,0,0,0.18)';
    const playerBg = isLight ? 'rgba(0,0,0,0.05)' : 'rgba(0,0,0,0.15)';

    // 装饰图标映射
    const decoMap = { 'star-dust': '✦', 'music-notes-corner': '♪', 'vinyl-record': '◉', 'wave-bottom': '~' };
    const decoIcon = decoMap[p.decorations] || '';
    const isActive = p.id === activeId;

    const tip = `${p.name}${p.artist ? ' · ' + p.artist : ''}${decoIcon ? ' ' + decoIcon : ''}`;
    return `<div class="theme-card${isActive ? ' active' : ''}" data-theme-id="${escHtml(p.id)}" data-tip="${escHtml(tip)}"
        style="
          --tcard-accent: ${escHtml(accent)};
          --tcard-row-bg: ${rowBg};
          --tcard-cover-r: ${escHtml(pv.coverRadius || '3px')};">
      <div class="tcard-chrome" style="background:${chromeBg}">
        <span class="dot"></span><span class="dot"></span><span class="dot"></span>
      </div>
      <div class="tcard-body">
        <div class="tcard-sidebar" style="background:${escHtml(sidebarBg)}"></div>
        <div class="tcard-main" style="background:${typeof bg === 'string' && bg.startsWith('linear') ? bg : escHtml(bg)}">
          <div class="tcard-row" style="background:${rowBg}"></div>
          <div class="tcard-row short" style="background:${rowBg}"></div>
          <div class="tcard-row accent" style="background:${escHtml(accent)};opacity:0.5"></div>
        </div>
      </div>
      <div class="tcard-player" style="background:${playerBg}">
        <div class="tcard-cover" style="background:${escHtml(accent)};border-radius:${escHtml(pv.coverRadius || '3px')}"></div>
        <div class="tcard-progress"><div style="width:35%;height:100%;border-radius:1.5px;background:${escHtml(accent)}"></div></div>
      </div>
      <div class="tcard-footer" style="color:${escHtml(textColor)}">
        <span class="tcard-name">${escHtml(p.name)}</span>
        <span class="tcard-artist">${escHtml(p.artist || '通用主题')}</span>
        ${decoIcon ? `<span class="tcard-deco">${decoIcon}</span>` : ''}
        ${isActive ? '<span style="font-size:10px;background:var(--accent);color:#fff;padding:1px 5px;border-radius:3px;font-weight:600">使用中</span>' : ''}
      </div>
    </div>`;
  }).join('');

  // 绑定点击事件：选中卡片（缓存 NodeList 避免重复查询）
  const allCards = grid.querySelectorAll('.theme-card');
  allCards.forEach((card) => {
    card.addEventListener('click', () => {
      allCards.forEach((c) => c.classList.remove('active'));
      card.classList.add('active');
    });
    card.addEventListener('dblclick', () => {
      $('themeSelectorModal').classList.remove('show');
      _applySelectedTheme();
    });
  });
}

/** 打开主题选择器（预加载预设避免空网格） */
export function openThemeSelector() {
  // 加载中状态：骨架屏
  const grid = $('themeSelectorGrid');
  if (grid) grid.innerHTML = SKELETON_HTML;
  $('themeSelectorModal').classList.add('show');
  // 预加载并渲染
  _renderThemeSelector();
}

function escHtml(s) { return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ---- 主题编辑器（Phase 3）----

/** 当前变体 */
let _editorVariant = 'day';
/** 日间 / 夜间 Slot 缓存 */
let _daySlots = null;
let _nightSlots = null;
/** 编辑中的自定义主题 id（null = 新建） */
let _editingThemeId = null;

/** 打开主题编辑器 */
export async function openThemeEditor(themeId) {
  await loadPresets();
  _editingThemeId = null;
  _editorVariant = 'day';
  _daySlots = _emptySlots();
  _nightSlots = _emptySlots();

  // 从已有主题加载数据
  if (themeId && themeId.startsWith('custom-')) {
    const ct = (_customThemes || []).find((t) => t.id === themeId);
    if (ct) {
      _editingThemeId = themeId;
      $('editThemeName').value = ct.name || '';
      if (ct.dayVariant?.slots) _daySlots = { ..._daySlots, ...ct.dayVariant.slots };
      if (ct.nightVariant?.slots) _nightSlots = { ..._nightSlots, ...ct.nightVariant.slots };
      else _nightSlots = { ..._daySlots }; // 无夜间变体时复制日间
    }
  } else if (themeId && !themeId.startsWith('custom-')) {
    // 从预设主题复制
    try {
      const { theme } = await api(`/themes/presets/${themeId}`);
      if (theme?.dayVariant?.slots) _daySlots = { ..._daySlots, ...theme.dayVariant.slots };
      if (theme?.nightVariant?.slots) _nightSlots = { ..._nightSlots, ...theme.nightVariant.slots };
      else _nightSlots = { ..._daySlots };
      $('editThemeName').value = theme?.name ? `${theme.name} (我的)` : '';
    } catch (e) { /* fallthrough */ }
  } else {
    $('editThemeName').value = '';
  }

  _populateEditorVariant('day');
  _updatePreview();
  $('themeEditorModal').classList.add('show');
}

function _emptySlots() {
  return {
    bg: { type: 'color', value: '#0d0f12', overlay: 'transparent' },
    accent: { type: 'color', value: '#FF6B9D' },
    font: { type: 'font', value: 'serif' },
    player: { type: 'preset', value: 'rounded-cover' },
    card: { type: 'preset', value: 'default' },
    sidebar: { type: 'color', value: '#0f080a' },
    decorations: { type: 'preset', value: 'star-dust' },
    lyrics: { type: 'color', value: '#FF6B9D' },
    scrollbar: { type: 'color', value: '#553344' },
    row: { type: 'preset', value: 'default' },
  };
}

/** 将当前表单值写回当前变体存储，用目标变体的值填充表单 */
function _switchEditorVariant(target) {
  // 保存当前变体
  const curSlots = _readEditorSlots();
  if (_editorVariant === 'day') _daySlots = curSlots;
  else _nightSlots = curSlots;

  _editorVariant = target;
  _populateEditorVariant(target);
  document.querySelectorAll('.theme-variant-tab').forEach((t) => t.classList.toggle('active', t.dataset.variant === target));
  _updatePreview();
}

function _populateEditorVariant(variant) {
  const s = variant === 'day' ? _daySlots : _nightSlots;
  const setVal = (id, val) => { const el = $(id); if (el) el.value = val; };
  setVal('editBgType', s.bg?.type || 'color');
  setVal('editBgValue', s.bg?.value || '');
  setVal('editAccent', s.accent?.value || '#FF6B9D');
  setVal('editAccentText', s.accent?.value || '#FF6B9D');
  setVal('editFont', s.font?.value || 'default');
  setVal('editPlayer', s.player?.value || 'default');
  setVal('editCard', s.card?.value || 'default');
  setVal('editSidebar', s.sidebar?.value || '');
  setVal('editDecorations', s.decorations?.value || 'none');
  setVal('editLyrics', s.lyrics?.value || '');
  setVal('editScrollbar', s.scrollbar?.value || '');
  setVal('editRow', s.row?.value || 'default');
  document.querySelectorAll('.theme-variant-tab').forEach((t) => t.classList.toggle('active', t.dataset.variant === variant));
}

function _readEditorSlots() {
  const v = (id, fallback) => { const el = $(id); return el ? el.value.trim() : fallback; };
  return {
    bg: { type: v('editBgType', 'color'), value: v('editBgValue', '#0d0f12') },
    accent: { type: 'color', value: v('editAccentText', '') || v('editAccent', '#FF6B9D') },
    font: { type: 'font', value: v('editFont', 'default') },
    player: { type: 'preset', value: v('editPlayer', 'default') },
    card: { type: 'preset', value: v('editCard', 'default') },
    sidebar: { type: 'color', value: v('editSidebar', 'transparent') },
    decorations: { type: 'preset', value: v('editDecorations', 'none') },
    lyrics: { type: 'color', value: v('editLyrics', '') || v('editAccentText', '#FF6B9D') },
    scrollbar: { type: 'color', value: v('editScrollbar', '#553344') },
    row: { type: 'preset', value: v('editRow', 'default') },
  };
}

/** 更新预览窗口（使用当前变体 Slot + 表单即时值） */
function _updatePreview() {
  const contentEl = $('epContent');
  if (!contentEl) return; // 编辑器未打开时安全退出

  const slots = _readEditorSlots();
  const accent = slots.accent.value;
  const bgVal = slots.bg.value;
  const isGradient = slots.bg.type === 'gradient' && bgVal.startsWith('linear');
  const sidebarVal = slots.sidebar.value || 'transparent';
  const coverRadius = slots.player.value === 'pill-cover' ? '50%' : (slots.player.value === 'rounded-cover' ? '12px' : '3px');

  if (slots.bg.type === 'image') contentEl.style.background = `url(${bgVal}) center/cover`;
  else if (isGradient) contentEl.style.background = bgVal;
  else if (slots.bg.type === 'color') contentEl.style.background = bgVal;
  else contentEl.style.background = 'var(--bg)';

  const accentRow = $('epAccentRow'), cover = $('epCover'), progress = $('epProgress'), sidebar = $('epSidebar');
  if (accentRow) accentRow.style.background = accent;
  if (cover) { cover.style.background = accent; cover.style.borderRadius = coverRadius; }
  if (progress) progress.style.background = accent;
  if (sidebar) sidebar.style.background = sidebarVal;

  const fontMap = {
    serif: '"Noto Serif SC", Georgia, serif',
    hei: '"Hiragino Sans GB", "PingFang SC", sans-serif',
    mono: '"SF Mono", Consolas, monospace',
    rounded: '"SF Pro Rounded", system-ui, sans-serif',
    default: '-apple-system, sans-serif',
    kai: '"KaiTi", "STKaiti", serif',
  };
  const preview = $('editorPreview');
  if (preview) preview.style.fontFamily = fontMap[slots.font.value] || fontMap['default'];
}

/** 保存自定义主题（使用 _daySlots / _nightSlots） */
async function _saveTheme() {
  const name = $('editThemeName').value.trim();
  if (!name) return toast('请输入主题名称');

  // 将当前表单值写回当前变体
  const curSlots = _readEditorSlots();
  if (_editorVariant === 'day') _daySlots = curSlots;
  else _nightSlots = curSlots;

  const body = {
    id: _editingThemeId || undefined,
    name,
    dayVariant: { slots: _daySlots },
    nightVariant: { slots: _nightSlots },
  };

  try {
    await api('/auth/themes', { method: 'POST', body });
    $('themeEditorModal').classList.remove('show');
    await refreshPresets();
    toast(_editingThemeId ? '主题已更新' : '主题已创建');
    _updateThemeLabel();
  } catch (e) { toast('保存失败：' + e.message); }
}


/** 应用当前选中的主题 */
async function _applySelectedTheme() {
  const grid = $('themeSelectorGrid');
  const active = grid?.querySelector('.theme-card.active');
  if (!active) { toast('请选择一套主题'); return; }

  const themeId = active.dataset.themeId;
  const preset = _presetsCache?.find((p) => p.id === themeId) || (_customThemes || []).find((t) => t.id === themeId);
  const themeName = preset?.name || themeId;

  await activateTheme(themeId);
  localStorage.setItem('wemusic_activeThemeName', themeName);
  pauseSmartTheme(); // 手动切换后暂停智能切换 24h
  $('themeSelectorModal').classList.remove('show');
  _updateThemeLabel();
  toast(`已应用「${themeName}」`);
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
  // 主题激活时跳过独立字体设置（主题已接管 --font）
  if (document.body.hasAttribute('data-theme')) return;
  key = FONTS[key] ? key : 'default';
  document.documentElement.style.setProperty('--font', FONTS[key]);
  document.querySelectorAll('.font-opt').forEach((b) => {
    b.classList.toggle('active', b.dataset.font === key);
  });
}
applyFont(localStorage.getItem('wemusic_font') || 'default');

// 系统颜色默认折叠展示的数量，超出部分隐藏，点击「显示全部」展开
const PALETTE_FOLD_LIMIT = 8;

const PALETTES = {
  green:            '#2ab758',
  'mummy-brown':    '#8F4B28',
  'prussian-blue':  '#003153',
  'cream-oat':      '#F2E9E4',
  charcoal:         '#222222',
  'deep-gray':      '#444444',
  'page-gray':      '#F5F5F5',
  'deep-moss':      '#2D5546',
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
  // 主题激活时跳过独立配色设置（主题已接管 --accent）
  if (document.body.hasAttribute('data-theme')) return;
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
let sleepDuration = 0; // 用户选择的时长（分钟），0 = 未设置

export function clearSleep() {
  if (sleepTimeout) { clearTimeout(sleepTimeout); sleepTimeout = null; }
  if (sleepTick) { clearInterval(sleepTick); sleepTick = null; }
  sleepEndTime = 0;
  sleepDuration = 0;
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
    const finishSong = localStorage.getItem('wemusic_sleep_finish_song') === '1';
    const suffix = finishSong ? '（之后等当前歌曲播完）' : '';
    if (m > 0) {
      hint.textContent = `${m} 分 ${s} 秒后停止${suffix}`;
    } else {
      hint.textContent = `${s} 秒后停止${suffix}`;
    }
    return;
  }
  hint.textContent = '';
}

export function setSleep(v) {
  clearSleep();
  if (v === '0') { toast('已取消定时关闭'); updateSleepHint(); return; }
  const min = Number(v);
  sleepDuration = min;
  sleepEndTime = Date.now() + min * 60000;
  const toastFinishSong = localStorage.getItem('wemusic_sleep_finish_song') === '1';
  sleepTimeout = setTimeout(() => {
    if (sleepTick) { clearInterval(sleepTick); sleepTick = null; }
    // 回调内重新读取：用户可能在定时器运行期间切换开关
    const finishSong = localStorage.getItem('wemusic_sleep_finish_song') === '1';
    if (finishSong) {
      sleepAfterSong = true;
      sleepEndTime = 0;
      updateSleepHint();
      toast('定时已到，将在当前歌曲播完后停止');
    } else {
      import('./player.js').then(({ stopPlayback }) => stopPlayback());
      clearSleep();
      toast('定时已到，已停止播放');
    }
  }, min * 60000);
  sleepTick = setInterval(updateSleepHint, 1000);
  toast(`已设置 ${min} 分钟后${toastFinishSong ? '（播完当前曲后关闭）' : '停止'}`);
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

// 系统颜色折叠：默认只展示前 PALETTE_FOLD_LIMIT 种，其余隐藏，点击按钮展开/收起
function setupPaletteFold() {
  const wrap = $('systemPalettes');
  const btn = $('paletteFoldBtn');
  if (!wrap || !btn) return;
  const items = Array.from(wrap.querySelectorAll('.palette-item'));
  if (items.length <= PALETTE_FOLD_LIMIT) { btn.style.display = 'none'; return; }

  let expanded = false;
  const activeKey = localStorage.getItem('wemusic_palette') || 'green';

  function apply() {
    items.forEach((el, i) => {
      const isActive = el.dataset.palette === activeKey;
      const hidden = !expanded && i >= PALETTE_FOLD_LIMIT && !isActive;
      el.classList.toggle('palette-collapsed', hidden);
    });
  }
  apply();

  btn.onclick = () => {
    expanded = !expanded;
    btn.textContent = expanded ? '收起' : '显示全部';
    apply();
  };
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
  _updateThemeLabel();

  // 主题激活时灰掉独立配色/字体设置
  const themeActive = document.body.hasAttribute('data-theme');
  ['paletteSection', 'fontSection'].forEach((id) => {
    const el = $(id); if (el) el.classList.toggle('theme-controlled', themeActive);
  });

  $('settingsUser').textContent = Auth.user?.username || '';
  renderAvatar(Auth.user?.avatar || null);
  const avatarPreview = $('avatarPreview');
  const avatarFileInput = $('avatarFileInput');
  if (avatarPreview && avatarFileInput) {
    avatarPreview.onclick = () => avatarFileInput.click();
    avatarFileInput.onchange = (e) => { uploadAvatar(e.target.files[0]); avatarFileInput.value = ''; };
  }
  _bindOptionGroup('.theme-opt', {
    getActive: () => localStorage.getItem('wemusic_theme') || 'light',
    getDataKey: 'theme',
    onSelect: (val) => { localStorage.setItem('wemusic_theme', val); applyTheme(val); _dbSyncPrefs(); },
  });
  _bindOptionGroup('.font-opt', {
    getActive: () => localStorage.getItem('wemusic_font') || 'default',
    getDataKey: 'font',
    onSelect: (val) => { localStorage.setItem('wemusic_font', val); applyFont(val); _dbSyncPrefs(); },
  });
  _bindOptionGroup('.size-opt', {
    getActive: () => localStorage.getItem('wemusic_font_size') || '14',
    getDataKey: 'size',
    onSelect: (val) => { localStorage.setItem('wemusic_font_size', val); applyFontSize(val); _dbSyncPrefs(); },
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
  _bindOptionGroup('.crossfade-opt', {
    getActive: () => {
      const enabled = localStorage.getItem('wemusic_crossfade_enabled') === '1';
      return enabled ? (localStorage.getItem('wemusic_crossfade_duration') || '5') : '0';
    },
    getDataKey: 'sec',
    onSelect: (val) => {
      localStorage.setItem('wemusic_crossfade_duration', val);
      localStorage.setItem('wemusic_crossfade_enabled', val === '0' ? '0' : '1');
      window.dispatchEvent(new CustomEvent('crossfade_changed'));
    },
  });

  // EQ 预设选择
  _bindOptionGroup('.eq-opt', {
    getActive: () => localStorage.getItem('wemusic_eq') || 'flat',
    getDataKey: 'eq',
    onSelect: (val) => { localStorage.setItem('wemusic_eq', val); window.dispatchEvent(new CustomEvent('eq_changed')); },
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
  _bindOptionGroup('.spectrum-style-opt', {
    getActive: () => localStorage.getItem('wemusic_spectrum_style') || 'off',
    getDataKey: 'style',
    onSelect: (val) => {
      localStorage.setItem('wemusic_spectrum_style', val);
      window.dispatchEvent(new CustomEvent('spectrum_changed'));
    },
  });

  _bindOptionGroup('.palette-item', {
    getActive: () => localStorage.getItem('wemusic_palette') || 'green',
    getDataKey: 'palette',
    onSelect: (val) => { selectPalette(val); },
  });
  setupPaletteFold();

  // 渲染自定义色板（仅登录用户）
  if (Auth.user) {
    await loadCustomPalettes();
    renderCustomPalettesUI(localStorage.getItem('wemusic_palette') || 'green');
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

  // 定时停止：播完当前曲开关
  const finishSongToggle = $('sleepFinishSongToggle');
  if (finishSongToggle) {
    finishSongToggle.checked = localStorage.getItem('wemusic_sleep_finish_song') === '1';
    finishSongToggle.onchange = () => {
      localStorage.setItem('wemusic_sleep_finish_song', finishSongToggle.checked ? '1' : '0');
      updateSleepHint();
    };
  }

  // 定时停止按钮
  const customWrap = $('sleepCustomWrap');
  const customBtn = $('sleepCustomBtn');
  const customInput = $('sleepCustomInput');
  customWrap?.classList.remove('editing');

  const PRESET_DURATIONS = [15, 30, 60];
  const activeMin = sleepEndTime ? String(sleepDuration) : (sleepAfterSong ? null : '0');
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
    const isCustom = sleepEndTime && !PRESET_DURATIONS.includes(sleepDuration);
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
  // 主题选择器
  $('chooseThemeBtn')?.addEventListener('click', openThemeSelector);
  $('themeSelectorClose').onclick = () => $('themeSelectorModal').classList.remove('show');
  $('themeSelectorModal').onclick = (e) => { if (e.target.id === 'themeSelectorModal') $('themeSelectorModal').classList.remove('show'); };
  $('themeApplyBtn').onclick = _applySelectedTheme;
  $('themeCancelBtn').onclick = () => $('themeSelectorModal').classList.remove('show');
  $('themeNewCustomBtn')?.addEventListener('click', () => { $('themeSelectorModal').classList.remove('show'); openThemeEditor(); });

  // 智能切换 toggle
  const smartToggle = $('smartThemeToggle');
  if (smartToggle) {
    smartToggle.checked = _smartEnabled;
    smartToggle.onchange = () => {
      setSmartThemeEnabled(smartToggle.checked);
      _updateSmartStatus();
    };
  }
  _updateSmartStatus();
  _startSmartSwitchMonitor();
  $('themeDeactivateBtn').onclick = async () => {
    deactivateTheme();
    $('themeSelectorModal').classList.remove('show');
    toast('已取消主题，恢复默认外观');
  };
  // 编辑器
  $('themeEditorClose').onclick = () => $('themeEditorModal').classList.remove('show');
  $('themeEditorModal').onclick = (e) => { if (e.target.id === 'themeEditorModal') $('themeEditorModal').classList.remove('show'); };
  $('editorCancelBtn').onclick = () => $('themeEditorModal').classList.remove('show');
  $('editorResetBtn').onclick = () => { _daySlots = _emptySlots(); _nightSlots = _emptySlots(); _populateEditorVariant(_editorVariant); _updatePreview(); };
  $('editorSaveBtn').onclick = _saveTheme;
  // 导出主题 JSON
  $('editorExportBtn').onclick = () => {
    const curSlots = _readEditorSlots();
    if (_editorVariant === 'day') _daySlots = curSlots;
    else _nightSlots = curSlots;
    const data = {
      wemusic_theme_version: 1,
      name: $('editThemeName').value.trim() || '我的主题',
      dayVariant: { slots: _daySlots },
      nightVariant: { slots: _nightSlots },
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (data.name || 'theme') + '.wetheme.json';
    a.click();
    toast('主题已导出');
  };
  // 导入主题
  $('themeImportBtn').addEventListener('click', () => $('themeImportFile').click());
  $('themeImportFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.dayVariant?.slots) return toast('无效的主题文件');
      const body = {
        name: data.name || '导入主题',
        dayVariant: data.dayVariant,
        nightVariant: data.nightVariant || data.dayVariant,
      };
      await api('/auth/themes', { method: 'POST', body });
      await loadPresets();
      $('themeSelectorModal').classList.remove('show');
      $('themeSelectorModal').classList.add('show');
      _renderThemeSelector();
      toast('主题已导入');
    } catch (err) { toast('导入失败：' + err.message); }
    $('themeImportFile').value = '';
  });
  // 实时预览
  ['editBgType', 'editBgValue', 'editAccent', 'editAccentText', 'editFont', 'editPlayer', 'editCard',
   'editSidebar', 'editDecorations', 'editLyrics', 'editScrollbar', 'editRow'].forEach((id) => {
    const el = $(id);
    if (el) el.addEventListener('input', _updatePreview);
  });
  // 背景类型切换：显示/隐藏上传按钮
  $('editBgType').addEventListener('change', () => {
    const isImage = $('editBgType').value === 'image';
    $('editBgUploadBtn').style.display = isImage ? '' : 'none';
    $('editBgFile').style.display = 'none';
    _updatePreview();
  });
  $('editBgUploadBtn').addEventListener('click', () => $('editBgFile').click());
  $('editBgFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return toast('图片不能超过 10MB');
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await fetch('/api/upload/themes', { method: 'POST', body: fd, headers: { Authorization: `Bearer ${Auth.token}` } });
      if (!res.ok) { toast('上传失败'); return; }
      const { url } = await res.json();
      $('editBgValue').value = url;
      _updatePreview();
    } catch (e) { toast('上传失败：' + e.message); }
  });
  // 日/夜 tab 切换
  $('editorDayTab').onclick = () => _switchEditorVariant('day');
  $('editorNightTab').onclick = () => _switchEditorVariant('night');
  // 在主题选择器中添加「编辑主题」按钮（自定义主题出现时才有意义）
  // Phase 3：从选择器卡片进入编辑
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

// 启动时恢复已保存的主题
(async function () {
  const saved = localStorage.getItem('wemusic_activeTheme');
  if (saved) {
    await loadPresets();
    await activateTheme(saved);
  }
})();
