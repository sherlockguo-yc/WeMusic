// ============================================================
// 听歌报告分享海报模板（纯字符串模板，服务端 Puppeteer 渲染专用）
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

// ============================================================
// 精工版海报 —— 仅供服务端 Puppeteer 渲染。
// 用到：专辑封面模糊背景、封面拼贴墙、歌曲缩略图。
// 依赖远程图片正常显示（跨域不受限），发挥 Puppeteer 真实浏览器渲染的优势。
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
  // 拼贴墙：优先用 topAlbums（不同专辑），不够 4 张时用 topSongs 补充（去重）
  const topAlbums = data.topAlbums || [];
  const seen = new Set();
  const covers = [];
  // 先放 topAlbums 的封面（数量已 ≥ 4 时直接够用）
  for (const a of topAlbums) {
    if (a.albumMid && !seen.has(a.albumMid)) {
      seen.add(a.albumMid);
      covers.push(coverUrl(a.albumMid, 300));
    }
  }
  // 不足 4 张时，从 topSongs 补足
  for (const s of topSongs) {
    if (covers.length >= 4) break;
    if (s.albumMid && !seen.has(s.albumMid)) {
      seen.add(s.albumMid);
      covers.push(coverUrl(s.albumMid, 300));
    }
  }
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

// ============================================================
// 手机版海报 —— 5 页 Story 模式
// 每页 430×820，恰好占用一个手机屏幕（iPhone 14 Pro Max 比例）。
// 5 页共同讲述一个完整的周报故事：
//   1) 封面：品牌 + 标题 + 日期
//   2) 数据：播放大数字 + 时长 + 天数 + 统计卡
//   3) 人格：听歌人格 + 个性化洞察
//   4) 专辑：4 张最爱专辑封面拼贴
//   5) 排行：TOP 5 歌曲 + 最爱歌手标签
// ============================================================

const MOBILE_LIGHT = { ...PRO_LIGHT, insetBg: 'rgba(0,0,0,.03)', divider: 'rgba(0,0,0,.06)' };
const MOBILE_DARK  = { ...PRO_DARK,  insetBg: 'rgba(255,255,255,.04)', divider: 'rgba(255,255,255,.08)' };

export const MOBILE_PAGE_COUNT = 4;
export const MOBILE_PAGE_HEIGHT = 820;

export function posterCSSMobile(themeKey) {
  const accent = PRO_ACCENTS[themeKey] || PRO_ACCENTS.mint;
  const tint = PRO_TINTS[themeKey] || PRO_TINTS.mint;
  const palette = themeKey === 'mint' ? MOBILE_LIGHT : MOBILE_DARK;
  return `
.wm-poster-mobile {
  width: 430px; height: ${MOBILE_PAGE_HEIGHT}px; position: relative; overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
  color: ${palette.text}; box-sizing: border-box; background: ${palette.bg};
}
.wm-poster-mobile * { box-sizing: border-box; }

.wpm-accent-stripe {
  position: absolute; top: 0; left: 0; right: 0; height: 4px; z-index: 4;
  background: linear-gradient(90deg, ${accent}, ${accent}88);
}
.wpm-bg-cover {
  position: absolute; inset: -24px; background-size: cover; background-position: center;
  filter: blur(36px) saturate(1.4) brightness(.65); transform: scale(1.15); z-index: 0;
}
.wpm-bg-tint { position: absolute; inset: 0; z-index: 1; background: ${tint}; }
.wpm-content {
  position: relative; z-index: 2;
  height: 100%;
  padding: 30px 26px 36px;
  display: flex; flex-direction: column;
}

.wpm-page-tag {
  position: absolute; top: 22px; right: 26px; z-index: 5;
  font-size: 10.5px; font-weight: 700; letter-spacing: .14em;
  color: ${palette.textSub};
}
.wpm-page-tag b { color: ${accent}; font-weight: 800; }

/* 底部页码指示器（点状） */
.wpm-page-dots {
  display: flex; gap: 6px; justify-content: center; align-items: center;
  margin-top: auto; padding-top: 12px;
}
.wpm-page-dots span {
  width: 6px; height: 6px; border-radius: 50%;
  background: ${palette.divider};
}
.wpm-page-dots span.active { background: ${accent}; width: 18px; border-radius: 3px; }

/* 通用 */
.wpm-section { display: flex; flex-direction: column; gap: 12px; }
.wpm-section-label {
  font-size: 11px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase;
  color: ${palette.textSub};
}
.wpm-section-head { display: flex; align-items: baseline; gap: 10px; }
.wpm-card {
  background: ${palette.cardBg}; border: 1px solid ${palette.cardBorder};
  border-radius: 18px;
}

/* ===== 页面 1：封面（信息密集型）===== */
.wmp1-wrap { flex: 1; display: flex; flex-direction: column; gap: 22px; padding-top: 20px; }
.wmp1-head { text-align: center; }
.wmp1-badge {
  display: inline-block; font-size: 11px; font-weight: 800; letter-spacing: .12em;
  background: ${palette.badgeBg}; border: 1px solid ${palette.badgeBorder};
  padding: 5px 16px; border-radius: 22px; color: ${palette.badgeText};
  margin-bottom: 14px;
}
.wmp1-brand { font-size: 14px; font-weight: 700; letter-spacing: .06em; opacity: .8; display: inline-flex; align-items: center; gap: 6px; }
.wmp1-divider { width: 44px; height: 3px; background: ${accent}; border-radius: 2px; margin: 14px auto; }
.wmp1-title { font-size: 36px; font-weight: 800; line-height: 1.2; }
.wmp1-date { font-size: 15px; color: ${palette.textDim}; margin-top: 8px; }

/* 速览 3 个数字 */
.wmp1-stats {
  display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px;
  padding: 18px 14px;
  border-radius: 18px;
  background: ${palette.cardBg}; border: 1px solid ${palette.cardBorder};
}
.wmp1-stat-item { text-align: center; position: relative; }
.wmp1-stat-item + .wmp1-stat-item::before {
  content: ''; position: absolute; left: 0; top: 18%; bottom: 18%;
  width: 1px; background: ${palette.divider};
}
.wmp1-stat-num { font-size: 26px; font-weight: 800; color: ${accent}; line-height: 1.1; letter-spacing: -.01em; }
.wmp1-stat-unit { font-size: 11px; color: ${palette.textSub}; margin-top: 4px; font-weight: 600; }

/* TOP 1 速览 */
.wmp1-tops { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.wmp1-top-card {
  padding: 14px;
  border-radius: 16px;
  background: ${palette.cardBg}; border: 1px solid ${palette.cardBorder};
}
.wmp1-top-label { font-size: 10px; font-weight: 700; letter-spacing: .12em; color: ${palette.textSub}; text-transform: uppercase; }
.wmp1-top-name { font-size: 15px; font-weight: 700; color: ${palette.text}; margin-top: 6px; line-height: 1.3;
  overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
}
.wmp1-top-sub { font-size: 11px; color: ${palette.textDim}; margin-top: 4px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* 装饰：底部波形 */
.wmp1-wave {
  height: 50px; display: flex; align-items: flex-end; gap: 4px; justify-content: center; padding: 0 40px;
  opacity: .55;
}
.wmp1-wave i {
  display: block; width: 4px; background: ${accent}; border-radius: 2px;
}

/* ===== 页面 2：数据 + 人格（合并）===== */
.wmp2-wrap { flex: 1; display: flex; flex-direction: column; gap: 16px; padding-top: 8px; }
.wmp2-hero { text-align: center; padding: 4px 0 0; }
.wmp2-hero-label { font-size: 11px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: ${palette.textSub}; }
.wmp2-hero-num { font-size: 80px; font-weight: 800; color: ${accent}; line-height: 1; margin-top: 6px; letter-spacing: -.04em; }
.wmp2-hero-unit { font-size: 16px; font-weight: 700; color: ${palette.text}; margin-top: 4px; }
.wmp2-hero-meta { font-size: 12px; color: ${palette.textDim}; margin-top: 4px; }
.wmp2-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.wmp2-stat { text-align: center; padding: 14px 8px 12px; border-radius: 14px; background: ${palette.cardBg}; border: 1px solid ${palette.cardBorder}; }
.wmp2-stat-num { font-size: 26px; font-weight: 800; color: ${accent}; line-height: 1.1; }
.wmp2-stat-label { font-size: 11px; color: ${palette.textSub}; margin-top: 4px; font-weight: 600; }

/* 人格区块（紧凑版） */
.wmp2-persona {
  border-radius: 16px; background: ${palette.cardBg}; border: 1px solid ${palette.cardBorder};
  padding: 14px 16px; display: flex; flex-direction: column; gap: 10px;
}
.wmp2-persona-head { display: flex; align-items: center; gap: 12px; }
.wmp2-persona-icon { font-size: 38px; line-height: 1; flex: 0 0 auto; }
.wmp2-persona-meta { min-width: 0; flex: 1; }
.wmp2-persona-label { font-size: 16px; font-weight: 800; color: ${palette.text}; }
.wmp2-persona-desc { font-size: 11.5px; color: ${palette.textDim}; margin-top: 2px; line-height: 1.5; }
.wmp2-insight {
  font-size: 12.5px; line-height: 1.6; color: ${palette.text};
  padding: 10px 12px; border-radius: 10px;
  background: ${palette.insetBg};
  font-style: italic;
}

/* ===== 页面 3：人格 ===== */
.wmp3-wrap { flex: 1; display: flex; flex-direction: column; gap: 18px; padding-top: 10px; }
.wmp3-section-label { font-size: 11px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: ${palette.textSub}; margin-bottom: 10px; }
.wmp3-persona {
  text-align: center; padding: 26px 22px 22px;
  border-radius: 22px;
  background: ${palette.cardBg}; border: 1px solid ${palette.cardBorder};
}
.wmp3-persona-icon { font-size: 60px; line-height: 1; }
.wmp3-persona-label { font-size: 24px; font-weight: 800; color: ${palette.text}; margin-top: 10px; }
.wmp3-persona-desc { font-size: 13px; color: ${palette.textDim}; margin-top: 8px; line-height: 1.6; }
.wmp3-insight {
  text-align: center; font-size: 14px; line-height: 1.7; color: ${palette.text};
  padding: 14px 18px; border-radius: 14px;
  background: ${palette.insetBg};
}
.wmp3-related { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.wmp3-related-card { padding: 12px 14px; border-radius: 14px; background: ${palette.cardBg}; border: 1px solid ${palette.cardBorder}; }
.wmp3-related-label { font-size: 10px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: ${palette.textSub}; }
.wmp3-related-name { font-size: 14px; font-weight: 700; margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wmp3-related-sub { font-size: 11px; color: ${palette.textDim}; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ===== 页面 4：专辑（每张封面下方显示名称）===== */
.wmp4-wrap { flex: 1; display: flex; flex-direction: column; gap: 14px; padding-top: 8px; }
.wmp4-head { display: flex; align-items: baseline; justify-content: space-between; }
.wmp4-head .wpm-section-label { font-size: 12px; }
.wmp4-head-sub { font-size: 11px; color: ${palette.textDim}; }
.wmp4-grid {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  gap: 14px 12px;
}
.wmp4-cell {
  display: flex; flex-direction: column; gap: 6px;
  min-height: 0;
}
.wmp4-cover {
  position: relative; overflow: hidden;
  border-radius: 12px;
  flex: 1; min-height: 0;
}
.wmp4-cover img { width: 100%; height: 100%; object-fit: cover; }
.wmp4-cell-badge {
  position: absolute; bottom: 6px; left: 6px; z-index: 2;
  font-size: 10.5px; font-weight: 800; color: #fff;
  background: rgba(0,0,0,.55); padding: 3px 8px; border-radius: 10px;
  backdrop-filter: blur(4px);
}
.wmp4-cell-name { font-size: 13px; font-weight: 700; color: ${palette.text}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wmp4-cell-sub { font-size: 11px; color: ${palette.textDim}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ===== 页面 5：排行 ===== */
.wmp5-wrap { flex: 1; display: flex; flex-direction: column; gap: 14px; padding-top: 6px; overflow: hidden; }
.wmp5-songs { display: flex; flex-direction: column; gap: 6px; }
.wmp5-song-row {
  display: flex; align-items: center; gap: 10px;
  padding: 9px 12px;
  border-radius: 12px;
  background: ${palette.insetBg};
}
.wmp5-song-cover { width: 38px; height: 38px; border-radius: 8px; object-fit: cover; flex: 0 0 auto; background: ${palette.statBg}; }
.wmp5-song-cover.ph { display: flex; align-items: center; justify-content: center; font-size: 14px; color: ${palette.textSub}; }
.wmp5-rank { width: 18px; font-weight: 800; color: ${accent}; flex: 0 0 auto; font-size: 14px; text-align: center; }
.wmp5-song-name { flex: 1; font-weight: 600; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wmp5-song-meta { font-size: 11.5px; color: ${palette.textSub}; flex: 0 0 auto; max-width: 70px; text-align: right; font-weight: 600; }
.wmp5-song-singer { display: block; font-size: 10.5px; color: ${palette.textSub}; font-weight: 400; margin-top: 1px; }
.wmp5-artists-head { display: flex; align-items: baseline; justify-content: space-between; margin-top: 2px; }
.wmp5-artists { display: flex; flex-wrap: wrap; gap: 7px; }
.wmp5-chip {
  padding: 7px 14px; border-radius: 20px;
  background: ${palette.chipBg}; border: 1px solid ${palette.chipBorder};
  font-size: 12.5px; font-weight: 600; color: ${palette.text};
}
.wmp5-footer {
  text-align: center; font-size: 10.5px; color: ${palette.textSub};
  margin-top: auto; padding-top: 6px;
}
`;
}

/** 构造 4 张专辑封面（去重 + 从 topSongs 补足） */
function buildCollageCovers(data) {
  const topAlbums = data.topAlbums || [];
  const topSongs = data.topSongs || [];
  const seen = new Set();
  const covers = [];
  for (const a of topAlbums) {
    if (a.albumMid && !seen.has(a.albumMid)) {
      seen.add(a.albumMid);
      covers.push({ url: coverUrl(a.albumMid, 500), name: a.name || a.album || '', singer: a.singer || '', playCount: a.playCount || 0 });
    }
    if (covers.length >= 4) break;
  }
  for (const s of topSongs) {
    if (covers.length >= 4) break;
    if (s.albumMid && !seen.has(s.albumMid)) {
      seen.add(s.albumMid);
      covers.push({ url: coverUrl(s.albumMid, 500), name: s.name || '', singer: s.singer || '', playCount: s.playCount || 0 });
    }
  }
  while (covers.length < 4) covers.push({ url: '', name: '', singer: '', playCount: 0 });
  return covers;
}

/** 底部页码点（当前页高亮） */
function pageDots(activeNum) {
  return Array.from({ length: MOBILE_PAGE_COUNT }, (_, i) =>
    `<span class="${i + 1 === activeNum ? 'active' : ''}"></span>`
  ).join('');
}

/** 装饰性波形（页 1 底部） */
function waveBars() {
  const heights = [12, 20, 32, 24, 38, 28, 42, 30, 20, 28, 36, 22, 14, 24, 32, 20, 28, 36, 24, 16, 26, 18, 10, 18];
  return heights.map((h) => `<i style="height:${h}px"></i>`).join('');
}

/** 5 页 HTML 数组 */
export function posterHTMLMobile(data, themeKey) {
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
  const covers = buildCollageCovers(data);
  const bgCover = isMint ? '' : (covers[0]?.url || '');
  const palette = isMint ? MOBILE_LIGHT : MOBILE_DARK;

  // 计算日均播放
  const avgPlaysPerDay = days > 0 ? Math.round(plays / days) : 0;
  // TOP 1 速览
  const top1Song = topSongs[0] || { name: '—', singer: '' };
  const top1Artist = topArtists[0] || { name: '—' };
  const maxSongPlay = topSongs[0]?.playCount || 0;

  // 第 5 页：歌曲行（含播放次数）
  const songRows = topSongs.slice(0, 5).map((s, i) => {
    const cover = s.albumMid ? coverUrl(s.albumMid, 150) : '';
    return `
      <div class="wmp5-song-row">
        ${cover ? `<img class="wmp5-song-cover" src="${cover}" onerror="this.style.visibility='hidden'" />` : `<div class="wmp5-song-cover ph">🎵</div>`}
        <span class="wmp5-rank">${i + 1}</span>
        <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:0">
          <span class="wmp5-song-name">${esc(s.name)}</span>
          <span class="wmp5-song-singer">${esc(s.singer || '')}</span>
        </div>
        <span class="wmp5-song-meta">${s.playCount || 0}次</span>
      </div>`;
  }).join('');

  // 歌手 chip（带播放次数）
  const artistChips = topArtists.slice(0, 8).map((a) =>
    `<span class="wmp5-chip">${esc(a.name)} <span style="opacity:.7;font-weight:500;margin-left:2px">${a.playCount || 0}</span></span>`
  ).join('') || `<span class="wmp5-chip">暂无数据</span>`;

  // 第 3 页（专辑）：每张封面 + 名称直接组合
  const albumCells = covers.map((c) => {
    const coverInner = c.url
      ? `<img src="${c.url}" onerror="this.style.visibility='hidden'" />`
      : `<div style="background:${palette.cardBg};width:100%;height:100%"></div>`;
    const badge = c.playCount > 0 ? `<div class="wmp4-cell-badge">${c.playCount} 次</div>` : '';
    return `
      <div class="wmp4-cell">
        <div class="wmp4-cover">${coverInner}${badge}</div>
        <div class="wmp4-cell-name">${esc(c.name || '—')}</div>
        <div class="wmp4-cell-sub">${esc(c.singer || '')}</div>
      </div>
    `;
  }).join('');

  const bgLayer = bgCover
    ? `<div class="wpm-bg-cover" style="background-image:url('${bgCover}')"></div><div class="wpm-bg-tint"></div>`
    : '';

  const pageShell = (pageNum, content) => `
    <div class="wm-poster-mobile theme-${themeKey}">
      <div class="wpm-accent-stripe"></div>
      ${bgLayer}
      <div class="wpm-page-tag">WEEKLY <b>${String(pageNum).padStart(2, '0')}</b> / 04</div>
      <div class="wpm-content">${content}</div>
    </div>`;

  // === 第 1 页：封面（信息密集型）===
  const page1 = pageShell(1, `
    <div class="wmp1-wrap">
      <div class="wmp1-head">
        <div class="wmp1-badge">✨ PRO</div>
        <div class="wmp1-brand">🎵 ${esc(appName)}</div>
        <div class="wmp1-divider"></div>
        <div class="wmp1-title">${esc(title)}</div>
        <div class="wmp1-date">${esc(dateRange)}</div>
      </div>
      <div class="wmp1-stats">
        <div class="wmp1-stat-item">
          <div class="wmp1-stat-num">${plays}</div>
          <div class="wmp1-stat-unit">次播放</div>
        </div>
        <div class="wmp1-stat-item">
          <div class="wmp1-stat-num">${uniqueSongs}</div>
          <div class="wmp1-stat-unit">首歌</div>
        </div>
        <div class="wmp1-stat-item">
          <div class="wmp1-stat-num">${days}</div>
          <div class="wmp1-stat-unit">听歌天</div>
        </div>
      </div>
      <div class="wmp1-tops">
        <div class="wmp1-top-card">
          <div class="wmp1-top-label">TOP 1 歌曲</div>
          <div class="wmp1-top-name">${esc(top1Song.name)}</div>
          <div class="wmp1-top-sub">${esc(top1Song.singer || '')}</div>
        </div>
        <div class="wmp1-top-card">
          <div class="wmp1-top-label">TOP 1 歌手</div>
          <div class="wmp1-top-name">${esc(top1Artist.name)}</div>
          <div class="wmp1-top-sub">${top1Artist.playCount || maxSongPlay} 次播放</div>
        </div>
      </div>
      <div class="wmp1-wave">${waveBars()}</div>
      <div class="wpm-page-dots">${pageDots(1)}</div>
    </div>
  `);

  // === 第 2 页：数据 + 人格（合并）===
  const page2 = pageShell(2, `
    <div class="wmp2-wrap">
      <div class="wmp2-hero">
        <div class="wmp2-hero-label">本周播放</div>
        <div class="wmp2-hero-num">${plays}</div>
        <div class="wmp2-hero-unit">次</div>
        <div class="wmp2-hero-meta">${esc(duration)} · ${days} 天</div>
      </div>
      <div class="wmp2-stats">
        <div class="wmp2-stat">
          <div class="wmp2-stat-num">${uniqueSongs}</div>
          <div class="wmp2-stat-label">不重复歌曲</div>
        </div>
        <div class="wmp2-stat">
          <div class="wmp2-stat-num">${days}</div>
          <div class="wmp2-stat-label">听歌天数</div>
        </div>
        <div class="wmp2-stat">
          <div class="wmp2-stat-num">${avgPlaysPerDay}</div>
          <div class="wmp2-stat-label">日均播放</div>
        </div>
        <div class="wmp2-stat">
          <div class="wmp2-stat-num">${topArtists.length}</div>
          <div class="wmp2-stat-label">听歌歌手</div>
        </div>
      </div>
      <div class="wmp2-persona">
        <div class="wmp2-persona-head">
          <span class="wmp2-persona-icon">${persona.icon}</span>
          <div class="wmp2-persona-meta">
            <div class="wmp2-persona-label">${esc(persona.label)}</div>
            <div class="wmp2-persona-desc">${esc(persona.desc)}</div>
          </div>
        </div>
        ${insightText ? `<div class="wmp2-insight">"${esc(insightText)}"</div>` : ''}
      </div>
      <div class="wpm-page-dots">${pageDots(2)}</div>
    </div>
  `);

  // === 第 3 页：专辑（封面下方直接显示名称）===
  const page3 = pageShell(3, `
    <div class="wmp4-wrap">
      <div class="wmp4-head">
        <div class="wpm-section-label">本周最爱专辑</div>
        <div class="wmp4-head-sub">共 ${covers.filter((c) => c.url).length} 张</div>
      </div>
      <div class="wmp4-grid">${albumCells}</div>
      <div class="wpm-page-dots">${pageDots(3)}</div>
    </div>
  `);

  // === 第 4 页：排行 ===
  const page4 = pageShell(4, `
    <div class="wmp5-wrap">
      <div class="wpm-section-head">
        <div class="wpm-section-label">TOP 5 歌曲</div>
      </div>
      <div class="wmp5-songs">${songRows || '<div class="wmp5-song-row"><span class="wmp5-song-name">暂无播放记录</span></div>'}</div>
      <div class="wmp5-artists-head">
        <div class="wpm-section-label">最爱歌手</div>
        <div class="wpm-section-label" style="text-transform:none;letter-spacing:0">共 ${topArtists.length} 位</div>
      </div>
      <div class="wmp5-artists">${artistChips}</div>
      <div class="wmp5-footer">由 ${esc(appName)} 生成 · ${esc(generatedAt)}</div>
      <div class="wpm-page-dots">${pageDots(4)}</div>
    </div>
  `);

  return [page1, page2, page3, page4];
}
