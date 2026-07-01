// ============================================================
// 听歌报告分享海报模板（纯字符串模板，前端 html2canvas / 后端 puppeteer 共用）
// 不依赖 DOM / Node 任何 API，可在浏览器和 Node ESM 中同时 import。
// ============================================================

function esc(str) {
  return String(str == null ? '' : str).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])
  );
}

// QQ 音乐专辑封面 URL（纯字符串拼接，无 DOM 依赖，可在浏览器/Node 通用）
function coverUrl(albumMid, size = 300) {
  return albumMid ? `https://y.qq.com/music/photo_new/T002R${size}x${size}M000${albumMid}.jpg` : '';
}

// ---- 主题预设：每个主题定义背景、文字色、强调色 ----
export const POSTER_THEMES = {
  mint: {
    key: 'mint',
    name: '清新简约',
    bg: 'linear-gradient(160deg, #f4fbf6 0%, #ffffff 55%, #eefbf2 100%)',
    text: '#1b1d22',
    textDim: '#6b7280',
    accent: '#2ab758',
    cardBg: 'rgba(42,183,88,.06)',
    cardBorder: 'rgba(42,183,88,.18)',
    chipBg: 'rgba(42,183,88,.1)',
  },
  dark: {
    key: 'dark',
    name: '暗夜律动',
    bg: 'linear-gradient(160deg, #0e0f13 0%, #171a22 55%, #10151a 100%)',
    text: '#f3f5f8',
    textDim: '#9aa0ad',
    accent: '#2de37a',
    cardBg: 'rgba(46,227,122,.08)',
    cardBorder: 'rgba(46,227,122,.22)',
    chipBg: 'rgba(46,227,122,.14)',
    glow: true,
  },
  sunset: {
    key: 'sunset',
    name: '日落橙粉',
    bg: 'linear-gradient(165deg, #ff9a6c 0%, #ff5f8f 45%, #a95cf0 100%)',
    text: '#ffffff',
    textDim: 'rgba(255,255,255,.78)',
    accent: '#ffffff',
    cardBg: 'rgba(255,255,255,.14)',
    cardBorder: 'rgba(255,255,255,.28)',
    chipBg: 'rgba(255,255,255,.18)',
  },
  ocean: {
    key: 'ocean',
    name: '深海蓝调',
    bg: 'linear-gradient(165deg, #1a2a6c 0%, #2352a8 45%, #5b3ba8 100%)',
    text: '#ffffff',
    textDim: 'rgba(255,255,255,.75)',
    accent: '#7ee6d8',
    cardBg: 'rgba(255,255,255,.1)',
    cardBorder: 'rgba(255,255,255,.22)',
    chipBg: 'rgba(126,230,216,.18)',
  },
};

export const POSTER_THEME_LIST = Object.values(POSTER_THEMES);

// ---- CSS：结构样式统一，主题变量按 key 生成 ----
export function posterCSS(themeKey) {
  const t = POSTER_THEMES[themeKey] || POSTER_THEMES.mint;
  return `
.wm-poster {
  width: 690px;
  padding: 48px 40px 36px;
  background: ${t.bg};
  color: ${t.text};
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
  box-sizing: border-box;
  position: relative;
  overflow: hidden;
  border-radius: 0;
}
.wm-poster * { box-sizing: border-box; }
.wp-brand { font-size: 15px; font-weight: 700; letter-spacing: .04em; opacity: .85; display: flex; align-items: center; gap: 6px; }
.wp-title { font-size: 30px; font-weight: 800; margin-top: 18px; line-height: 1.3; }
.wp-date { font-size: 14px; color: ${t.textDim}; margin-top: 6px; }

.wp-hero { display: flex; align-items: baseline; gap: 10px; margin-top: 34px; }
.wp-hero-num { font-size: 68px; font-weight: 800; color: ${t.accent}; line-height: 1; }
.wp-hero-label { font-size: 15px; color: ${t.textDim}; }

.wp-persona {
  margin-top: 26px; padding: 20px 22px; border-radius: 20px;
  background: ${t.cardBg}; border: 1px solid ${t.cardBorder};
  display: flex; align-items: center; gap: 16px;
}
.wp-persona-icon { font-size: 40px; flex: 0 0 auto; }
.wp-persona-label { font-size: 19px; font-weight: 800; }
.wp-persona-desc { font-size: 13px; color: ${t.textDim}; margin-top: 3px; }

.wp-insight {
  margin-top: 18px; font-size: 14px; line-height: 1.6; color: ${t.textDim};
  font-style: italic;
}

.wp-section { margin-top: 30px; }
.wp-section-title {
  font-size: 13px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase;
  color: ${t.textDim}; margin-bottom: 14px;
}
.wp-song-row {
  display: flex; align-items: center; gap: 14px; padding: 9px 0;
  border-bottom: 1px solid ${t.cardBorder};
  font-size: 15px;
}
.wp-song-row:last-child { border-bottom: none; }
.wp-rank { width: 22px; font-weight: 800; color: ${t.accent}; flex: 0 0 auto; font-size: 15px; }
.wp-song-name { flex: 1; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wp-song-singer { font-size: 12.5px; color: ${t.textDim}; flex: 0 0 auto; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.wp-artist-chips { display: flex; flex-wrap: wrap; gap: 10px; }
.wp-chip {
  padding: 8px 16px; border-radius: 20px; background: ${t.chipBg};
  font-size: 14px; font-weight: 600;
}

.wp-stats-row { display: flex; gap: 14px; margin-top: 30px; }
.wp-mini-stat {
  flex: 1; text-align: center; padding: 16px 8px; border-radius: 16px;
  background: ${t.cardBg}; border: 1px solid ${t.cardBorder};
}
.wp-mini-stat b { display: block; font-size: 22px; font-weight: 800; }
.wp-mini-stat span { display: block; font-size: 11.5px; color: ${t.textDim}; margin-top: 4px; }

.wp-footer {
  margin-top: 34px; text-align: center; font-size: 11.5px; color: ${t.textDim};
  padding-top: 18px; border-top: 1px solid ${t.cardBorder};
}
`;
}

// ---- HTML：接收已格式化好的数据，生成海报卡片 outerHTML ----
export function posterHTML(data, themeKey) {
  const {
    appName = 'WeMusic',
    title = '本周听歌报告',
    dateRange = '',
    plays = 0,
    duration = '0 分钟',
    uniqueSongs = 0,
    days = 0,
    persona = { icon: '🎶', label: '自由旋律人', desc: '' },
    insightText = '',
    topSongs = [],
    topArtists = [],
    generatedAt = '',
  } = data || {};

  const songRows = topSongs.slice(0, 5).map((s, i) => `
    <div class="wp-song-row">
      <span class="wp-rank">${i + 1}</span>
      <span class="wp-song-name">${esc(s.name)}</span>
      <span class="wp-song-singer">${esc(s.singer || '')}</span>
    </div>`).join('') || `<div class="wp-song-row"><span class="wp-song-name">暂无播放记录</span></div>`;

  const artistChips = topArtists.slice(0, 6).map((a) => `<span class="wp-chip">${esc(a.name)}</span>`).join('')
    || `<span class="wp-chip">暂无数据</span>`;

  return `<div class="wm-poster theme-${themeKey}">
    <div class="wp-brand">🎵 ${esc(appName)}</div>
    <div class="wp-title">${esc(title)}</div>
    <div class="wp-date">${esc(dateRange)}</div>

    <div class="wp-hero">
      <div class="wp-hero-num">${plays}</div>
      <div class="wp-hero-label">次播放 · ${esc(duration)}</div>
    </div>

    <div class="wp-persona">
      <div class="wp-persona-icon">${persona.icon}</div>
      <div>
        <div class="wp-persona-label">${esc(persona.label)}</div>
        <div class="wp-persona-desc">${esc(persona.desc)}</div>
      </div>
    </div>

    ${insightText ? `<div class="wp-insight">"${esc(insightText)}"</div>` : ''}

    <div class="wp-section">
      <div class="wp-section-title">Top 歌曲</div>
      ${songRows}
    </div>

    <div class="wp-section">
      <div class="wp-section-title">Top 歌手</div>
      <div class="wp-artist-chips">${artistChips}</div>
    </div>

    <div class="wp-stats-row">
      <div class="wp-mini-stat"><b>${uniqueSongs}</b><span>不重复歌曲</span></div>
      <div class="wp-mini-stat"><b>${days}</b><span>听歌天数</span></div>
    </div>

    <div class="wp-footer">由 ${esc(appName)} 生成 · ${esc(generatedAt)}</div>
  </div>`;
}

// ============================================================
// 精工版海报（方案 B 专用）——仅供服务端 Puppeteer 渲染。
// 用到：专辑封面模糊背景、封面拼贴墙、歌曲缩略图。
// 依赖远程图片正常显示（跨域不受限），html2canvas 方案无法可靠支持，
// 因此刻意保持与「方案 A 简约版」视觉差异化，发挥 Puppeteer 真实浏览器渲染的优势。
// ============================================================

const PRO_ACCENTS = {
  mint: '#1a8c3e',
  dark: '#2de37a',
  sunset: '#ffb37e',
  ocean: '#7ee6d8',
};
// 浅色主题：清新简约（白底）— 不使用模糊背景和深色叠加
// 深色主题：沉浸感（封面模糊 + 暗化叠加）
const PRO_TINTS = {
  mint:   'transparent', // 浅色主题不叠加
  dark:   'linear-gradient(165deg, rgba(10,12,18,.55) 0%, rgba(4,5,7,.88) 100%)',
  sunset: 'linear-gradient(165deg, rgba(120,40,60,.45) 0%, rgba(50,15,55,.82) 100%)',
  ocean:  'linear-gradient(165deg, rgba(15,25,65,.5) 0%, rgba(25,12,55,.85) 100%)',
};
// 浅色主题基色：白底深字；深色主题：黑底浅字
const PRO_LIGHT = {
  bg: 'linear-gradient(165deg, #f6fbf7 0%, #ffffff 50%, #eefaf2 100%)',
  text: '#1b1d22',
  textDim: '#6b7280',
  textSub: '#9aa0ad',
  cardBg: 'rgba(42,183,88,.07)',
  cardBorder: 'rgba(42,183,88,.22)',
  chipBg: 'rgba(42,183,88,.1)',
  chipBorder: 'rgba(42,183,88,.28)',
  rowBorder: 'rgba(0,0,0,.08)',
  statBg: 'rgba(42,183,88,.05)',
  statBorder: 'rgba(42,183,88,.18)',
  badgeBg: 'rgba(42,183,88,.12)',
  badgeBorder: 'rgba(42,183,88,.4)',
  badgeText: '#1a8c3e',
  hasBlurBg: false,
};
const PRO_DARK = {
  bg: '#0b0d10',
  text: '#fff',
  textDim: 'rgba(255,255,255,.78)',
  textSub: 'rgba(255,255,255,.62)',
  cardBg: 'rgba(255,255,255,.1)',
  cardBorder: 'rgba(255,255,255,.2)',
  chipBg: 'rgba(255,255,255,.1)',
  chipBorder: 'rgba(255,255,255,.18)',
  rowBorder: 'rgba(255,255,255,.12)',
  statBg: 'rgba(255,255,255,.1)',
  statBorder: 'rgba(255,255,255,.18)',
  badgeBg: 'rgba(255,255,255,.16)',
  badgeBorder: 'rgba(255,255,255,.32)',
  badgeText: 'rgba(255,255,255,.9)',
  hasBlurBg: true,
};

export function posterCSSPro(themeKey) {
  const accent = PRO_ACCENTS[themeKey] || PRO_ACCENTS.mint;
  const tint = PRO_TINTS[themeKey] || PRO_TINTS.mint;
  const palette = themeKey === 'mint' ? PRO_LIGHT : PRO_DARK;
  const shadow = palette === PRO_DARK ? '0 2px 12px rgba(0,0,0,.3)' : '0 2px 8px rgba(0,0,0,.05)';
  return `
.wm-poster-pro {
  width: 690px; position: relative; overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
  color: ${palette.text}; box-sizing: border-box; background: ${palette.bg};
}
.wm-poster-pro * { box-sizing: border-box; }
.wpp-bg-cover {
  position: absolute; inset: -30px; background-size: cover; background-position: center;
  filter: blur(38px) saturate(1.3) brightness(.75); transform: scale(1.15); z-index: 0;
}
.wpp-bg-tint { position: absolute; inset: 0; z-index: 1; background: ${tint}; }
.wpp-badge-pro {
  position: absolute; top: 22px; right: 22px; z-index: 3;
  font-size: 10.5px; font-weight: 800; letter-spacing: .06em;
  background: ${palette.badgeBg}; border: 1px solid ${palette.badgeBorder};
  padding: 5px 12px; border-radius: 12px; color: ${palette.badgeText};
}
.wpp-content { position: relative; z-index: 2; padding: 48px 40px 36px; }

.wpp-brand { font-size: 15px; font-weight: 700; letter-spacing: .04em; opacity: .85; display: flex; align-items: center; gap: 6px; }
.wpp-title { font-size: 30px; font-weight: 800; margin-top: 18px; line-height: 1.3; text-shadow: ${shadow}; }
.wpp-date { font-size: 14px; color: ${palette.textDim}; margin-top: 6px; }

.wpp-hero { display: flex; align-items: baseline; gap: 10px; margin-top: 28px; }
.wpp-hero-num { font-size: 62px; font-weight: 800; color: ${accent}; line-height: 1; text-shadow: ${shadow}; }
.wpp-hero-label { font-size: 15px; color: ${palette.textDim}; }

.wpp-collage { display: flex; gap: 8px; margin-top: 22px; }
.wpp-collage img {
  flex: 1; width: 100%; height: 84px; object-fit: cover; border-radius: 12px;
  box-shadow: 0 6px 16px rgba(0,0,0,.2); border: 1px solid ${palette.cardBorder};
}

.wpp-persona {
  margin-top: 22px; padding: 18px 20px; border-radius: 20px;
  background: ${palette.cardBg}; border: 1px solid ${palette.cardBorder};
  display: flex; align-items: center; gap: 16px;
}
.wpp-persona-icon { font-size: 38px; flex: 0 0 auto; }
.wpp-persona-label { font-size: 18px; font-weight: 800; color: ${palette.text}; }
.wpp-persona-desc { font-size: 12.5px; color: ${palette.textDim}; margin-top: 3px; }

.wpp-insight { margin-top: 16px; font-size: 13.5px; line-height: 1.6; color: ${palette.textDim}; font-style: italic; }

.wpp-section { margin-top: 26px; }
.wpp-section-title {
  font-size: 12.5px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase;
  color: ${palette.textSub}; margin-bottom: 12px;
}
.wpp-song-row { display: flex; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 1px solid ${palette.rowBorder}; font-size: 14.5px; }
.wpp-song-row:last-child { border-bottom: none; }
.wpp-song-cover { width: 38px; height: 38px; border-radius: 8px; object-fit: cover; flex: 0 0 auto; background: ${palette.statBg}; }
.wpp-song-cover.ph { display: flex; align-items: center; justify-content: center; font-size: 15px; color: ${palette.textSub}; }
.wpp-rank { width: 18px; font-weight: 800; color: ${accent}; flex: 0 0 auto; font-size: 14px; }
.wpp-song-name { flex: 1; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wpp-song-singer { font-size: 12px; color: ${palette.textSub}; flex: 0 0 auto; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.wpp-artist-chips { display: flex; flex-wrap: wrap; gap: 10px; }
.wpp-chip { padding: 8px 16px; border-radius: 20px; background: ${palette.chipBg}; border: 1px solid ${palette.chipBorder}; font-size: 13.5px; font-weight: 600; }

.wpp-stats-row { display: flex; gap: 14px; margin-top: 26px; }
.wpp-mini-stat { flex: 1; text-align: center; padding: 15px 8px; border-radius: 16px; background: ${palette.statBg}; border: 1px solid ${palette.statBorder}; }
.wpp-mini-stat b { display: block; font-size: 21px; font-weight: 800; color: ${palette.text}; }
.wpp-mini-stat span { display: block; font-size: 11px; color: ${palette.textSub}; margin-top: 4px; }

.wpp-footer { margin-top: 30px; text-align: center; font-size: 11px; color: ${palette.textSub}; padding-top: 16px; border-top: 1px solid ${palette.rowBorder}; }
`;
}

export function posterHTMLPro(data, themeKey) {
  const {
    appName = 'WeMusic',
    title = '本周听歌报告',
    dateRange = '',
    plays = 0,
    duration = '0 分钟',
    uniqueSongs = 0,
    days = 0,
    persona = { icon: '🎶', label: '自由旋律人', desc: '' },
    insightText = '',
    topSongs = [],
    topArtists = [],
    generatedAt = '',
  } = data || {};

  const isMint = themeKey === 'mint';
  // 尺寸用 300（与全站 albumCover() 默认尺寸一致，命中率更稳定；400 在部分老专辑上会 404）
  const covers = topSongs.map((s) => (s.albumMid ? coverUrl(s.albumMid, 300) : '')).filter(Boolean);
  // 浅色主题不用模糊背景作为底图（避免白底看不清）；深色主题用 Top1 封面做模糊沉浸
  const bgCover = isMint ? '' : (covers[0] || '');
  const collageCovers = covers.slice(0, 4);

  const songRows = topSongs.slice(0, 5).map((s, i) => {
    const cover = s.albumMid ? coverUrl(s.albumMid, 120) : '';
    return `
    <div class="wpp-song-row">
      ${cover ? `<img class="wpp-song-cover" src="${cover}" onerror="this.style.visibility='hidden'" />` : `<div class="wpp-song-cover ph">🎵</div>`}
      <span class="wpp-rank">${i + 1}</span>
      <span class="wpp-song-name">${esc(s.name)}</span>
      <span class="wpp-song-singer">${esc(s.singer || '')}</span>
    </div>`;
  }).join('') || `<div class="wpp-song-row"><span class="wpp-song-name">暂无播放记录</span></div>`;

  const artistChips = topArtists.slice(0, 6).map((a) => `<span class="wpp-chip">${esc(a.name)}</span>`).join('')
    || `<span class="wpp-chip">暂无数据</span>`;

  const collageHtml = collageCovers.length
    ? `<div class="wpp-collage">${collageCovers.map((c) => `<img src="${c}" onerror="this.style.visibility='hidden'" />`).join('')}</div>`
    : '';

  return `<div class="wm-poster-pro theme-${themeKey}">
    ${bgCover ? `<div class="wpp-bg-cover" style="background-image:url('${bgCover}')"></div>` : ''}
    <div class="wpp-bg-tint"></div>
    <div class="wpp-badge-pro">✨ PRO</div>
    <div class="wpp-content">
      <div class="wpp-brand">🎵 ${esc(appName)}</div>
      <div class="wpp-title">${esc(title)}</div>
      <div class="wpp-date">${esc(dateRange)}</div>

      <div class="wpp-hero">
        <div class="wpp-hero-num">${plays}</div>
        <div class="wpp-hero-label">次播放 · ${esc(duration)}</div>
      </div>

      ${collageHtml}

      <div class="wpp-persona">
        <div class="wpp-persona-icon">${persona.icon}</div>
        <div>
          <div class="wpp-persona-label">${esc(persona.label)}</div>
          <div class="wpp-persona-desc">${esc(persona.desc)}</div>
        </div>
      </div>

      ${insightText ? `<div class="wpp-insight">"${esc(insightText)}"</div>` : ''}

      <div class="wpp-section">
        <div class="wpp-section-title">Top 歌曲</div>
        ${songRows}
      </div>

      <div class="wpp-section">
        <div class="wpp-section-title">Top 歌手</div>
        <div class="wpp-artist-chips">${artistChips}</div>
      </div>

      <div class="wpp-stats-row">
        <div class="wpp-mini-stat"><b>${uniqueSongs}</b><span>不重复歌曲</span></div>
        <div class="wpp-mini-stat"><b>${days}</b><span>听歌天数</span></div>
      </div>

      <div class="wpp-footer">由 ${esc(appName)} 生成 · 精工版 · ${esc(generatedAt)}</div>
    </div>
  </div>`;
}
