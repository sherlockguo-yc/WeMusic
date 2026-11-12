// 年度听歌总结（独立多屏叙事页）
// 与周报/月报的区别：不复用卡片墙，而是一屏一个主题的滚动叙事。
// 数据由 /api/stats/yearly 一次性返回，翻年份只重新请求，不重新挂载页面。
import { $, esc, fmtFullMin, albumCover, singerAvatar } from './utils.js';
import { api } from './api.js';
import { state } from './state.js';
import { setActiveNav } from './playlist-ui.js';

const SCREEN_COUNT = 8;
let _observer = null;   // 进出页面时重建，避免对已卸载的 DOM 持续观察
let _seq = 0;           // 年份切换的请求代次，丢弃陈旧响应
let _yearOffset = 0;

/** 年度听歌人格：阈值按「一年」的量级设定，与月报的 scale 不同 */
function yearlyPersona(data) {
  const top = data.topArtists[0];
  const share = top && data.overview.plays ? top.play_count / data.overview.plays : 0;
  if (share > 0.3) return { icon: 'star', label: `${top.singer} 年度铁粉`, desc: `${top.singer} 占了全年 ${Math.round(share * 100)}% 的播放` };
  if (data.overview.uniqueArtists > 120) return { icon: 'compass', label: '音乐探险家', desc: `这一年你听遍 ${data.overview.uniqueArtists} 位歌手` };
  if (data.overview.newSongs > 300) return { icon: 'sparkle', label: '新曲猎人', desc: `全年新收了 ${data.overview.newSongs} 首歌` };
  if (data.overview.days > 200) return { icon: 'moon', label: '长情陪伴者', desc: `一年里有 ${data.overview.days} 天打开了音乐` };
  return { icon: 'music', label: '自由旋律人', desc: '按自己的节奏享受音乐' };
}

const PERSONA_ICONS = {
  star: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
  compass: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21 3 6"/><line x1="9" x2="9" y1="3" y2="18"/><line x1="15" x2="15" y1="3" y2="18"/></svg>',
  sparkle: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z"/></svg>',
  moon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
  music: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
};

const fmtDay = (s) => {
  if (!s) return '';
  const [, m, d] = String(s).split('-');
  return m ? `${Number(m)}月${Number(d)}日` : s;
};

/** 12 个月柱状趋势（纯 DOM，高度用百分比；无数据月份留空槽） */
function monthlyChartHtml(monthly) {
  const max = Math.max(...monthly.map((m) => m.plays), 1);
  return monthly.map((m) => {
    const pct = m.plays ? Math.max(4, Math.round((m.plays / max) * 100)) : 0;
    return `<div class="yy-month">
      <div class="yy-month-bar-wrap">
        <span class="yy-month-val">${m.plays || ''}</span>
        <div class="yy-month-bar" style="height:${pct}%"></div>
      </div>
      <div class="yy-month-label">${m.month}月</div>
    </div>`;
  }).join('');
}

function screenHtml(data) {
  const { overview, highlights: hl, topSongs, topArtists, topAlbums, monthly } = data;
  const persona = yearlyPersona(data);
  const heroArtist = topArtists[0];
  const heroSong = topSongs[0];
  const maxArtistPlays = Math.max(...topArtists.map((a) => a.play_count), 1);
  const comp = hl.completion || { low: 0, mid: 0, high: 0 };
  const compTotal = comp.low + comp.mid + comp.high || 1;
  const compHigh = Math.round((comp.high / compTotal) * 100);

  return `
    <!-- 1 封面 -->
    <section class="yearly-screen ys-cover">
      <div class="yy-eyebrow">YEAR IN MUSIC</div>
      <div class="yy-year">${data.year}</div>
      <div class="yy-cover-title">年度听歌总结</div>
      <div class="yy-cover-sub">这一年，你按下播放 <b>${overview.plays}</b> 次<br />音乐陪伴了你 <b>${fmtFullMin(overview.sec)}</b></div>
      <div class="yy-scroll-hint">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>
        向下滚动
      </div>
    </section>

    <!-- 2 年度数字 -->
    <section class="yearly-screen ys-numbers">
      <div class="yy-screen-title">这一年，你的音乐足迹</div>
      <div class="yy-num-grid">
        <div class="yy-num-item"><div class="yy-num">${overview.plays}</div><div class="yy-num-label">次播放</div></div>
        <div class="yy-num-item"><div class="yy-num">${fmtFullMin(overview.sec)}</div><div class="yy-num-label">累计时长</div></div>
        <div class="yy-num-item"><div class="yy-num">${overview.uniqueSongs}</div><div class="yy-num-label">首不同的歌</div></div>
        <div class="yy-num-item"><div class="yy-num">${overview.days}</div><div class="yy-num-label">天有音乐</div></div>
      </div>
      <div class="yy-aside">${overview.uniqueArtists} 位歌手 · 新收了 ${overview.newSongs} 首歌</div>
    </section>

    <!-- 3 年度歌手 -->
    <section class="yearly-screen ys-artists">
      <div class="yy-screen-title">听得最多的人</div>
      ${heroArtist ? `<div class="yy-hero">${heroArtist.singer_mid ? `<img class="yy-hero-avatar" src="${singerAvatar(heroArtist.singer_mid, 300)}" loading="lazy" alt="" onerror="this.remove()" />` : ''}
        <div class="yy-hero-name">${esc(heroArtist.singer)}</div>
        <div class="yy-hero-sub">全年被播放 ${heroArtist.play_count} 次 · ${fmtFullMin(heroArtist.total_sec || 0)}</div></div>` : ''}
      <ol class="yy-rank-list">
        ${topArtists.map((a, i) => `
          <li class="yy-rank-row">
            <span class="yy-rank-no">${i + 1}</span>
            <span class="yy-rank-name">${esc(a.singer)}</span>
            <span class="yy-rank-bar"><i style="width:${Math.round((a.play_count / maxArtistPlays) * 100)}%"></i></span>
            <span class="yy-rank-val">${a.play_count} 次</span>
          </li>`).join('')}
      </ol>
    </section>

    <!-- 4 年度歌曲 -->
    <section class="yearly-screen ys-songs">
      <div class="yy-screen-title">循环最多的旋律</div>
      ${heroSong ? `<div class="yy-hero-song">
        ${heroSong.album_mid ? `<img class="yy-hero-cover" src="${albumCover(heroSong.album_mid, 300)}" loading="lazy" alt="" />` : '<div class="yy-hero-cover yy-cover-ph"></div>'}
        <div class="yy-hero-song-info">
          <div class="yy-hero-song-name">${esc(heroSong.name)}</div>
          <div class="yy-hero-song-singer">${esc(heroSong.singer || '')}</div>
          <div class="yy-hero-song-sub">播放 ${heroSong.play_count} 次 · ${fmtFullMin(heroSong.total_sec || 0)}</div>
        </div>
      </div>` : ''}
      <ol class="yy-song-list">
        ${topSongs.slice(1, 6).map((s, i) => `
          <li class="yy-song-row">
            <span class="yy-rank-no">${i + 2}</span>
            ${s.album_mid ? `<img class="yy-song-thumb" src="${albumCover(s.album_mid, 150)}" loading="lazy" alt="" onerror="this.style.visibility='hidden'" />` : '<span class="yy-song-thumb yy-cover-ph"></span>'}
            <span class="yy-song-meta"><span class="yy-song-name">${esc(s.name)}</span><span class="yy-song-singer">${esc(s.singer || '')}</span></span>
            <span class="yy-rank-val">${s.play_count} 次</span>
          </li>`).join('')}
      </ol>
    </section>

    <!-- 5 年度专辑 -->
    <section class="yearly-screen ys-albums">
      <div class="yy-screen-title">反复播放的专辑</div>
      <div class="yy-album-grid">
        ${topAlbums.map((a) => `
          <div class="yy-album">
            ${a.album_mid ? `<img class="yy-album-cover" src="${albumCover(a.album_mid, 300)}" loading="lazy" alt="" onerror="this.style.visibility='hidden'" />` : '<div class="yy-album-cover yy-cover-ph"></div>'}
            <div class="yy-album-name">${esc(a.album)}</div>
            <div class="yy-album-sub">${esc(a.singer || '')} · ${a.play_count} 次</div>
          </div>`).join('')}
      </div>
    </section>

    <!-- 6 年度之最 -->
    <section class="yearly-screen ys-highlights">
      <div class="yy-screen-title">这一年的「最」</div>
      <div class="yy-hl-grid">
        ${hl.bestDay ? `<div class="yy-hl"><div class="yy-hl-label">单日最高播放</div><div class="yy-hl-val">${hl.bestDay.plays}<small>次</small></div><div class="yy-hl-sub">${fmtDay(hl.bestDay.day)}</div></div>` : ''}
        ${hl.streak && hl.streak.days > 1 ? `<div class="yy-hl"><div class="yy-hl-label">最长连续听歌</div><div class="yy-hl-val">${hl.streak.days}<small>天</small></div><div class="yy-hl-sub">${fmtDay(hl.streak.start)} — ${fmtDay(hl.streak.end)}</div></div>` : ''}
        ${hl.peakMonth ? `<div class="yy-hl"><div class="yy-hl-label">最常听的月份</div><div class="yy-hl-val">${hl.peakMonth.month}<small>月</small></div><div class="yy-hl-sub">${hl.peakMonth.plays} 次播放</div></div>` : ''}
        ${hl.lateNight ? `<div class="yy-hl"><div class="yy-hl-label">深夜仍在听</div><div class="yy-hl-val">${hl.lateNight.hour}<small>点</small></div><div class="yy-hl-sub">凌晨时段 ${hl.lateNight.plays} 次</div></div>` : ''}
      </div>
      <div class="yy-aside">跳过率 ${hl.skipRate}% · 重复播放率 ${hl.repeatRate}% · 完播率 ${compHigh}%</div>
    </section>

    <!-- 7 月度趋势 -->
    <section class="yearly-screen ys-months">
      <div class="yy-screen-title">每个月的播放量</div>
      <div class="yy-months">${monthlyChartHtml(monthly)}</div>
      <div class="yy-aside">${hl.peakMonth ? `${hl.peakMonth.month} 月最热闹，播放了 ${hl.peakMonth.plays} 次` : ''}</div>
    </section>

    <!-- 8 人格收尾 -->
    <section class="yearly-screen ys-finale">
      <div class="yy-persona-icon">${PERSONA_ICONS[persona.icon] || PERSONA_ICONS.music}</div>
      <div class="yy-persona-label">${esc(persona.label)}</div>
      <div class="yy-persona-desc">${esc(persona.desc)}</div>
      <div class="yy-finale-line">${data.year} 年的音乐旅程到这里</div>
      <button class="yy-again-btn" id="yyAgain">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>
        再看一遍
      </button>
    </section>
  `;
}

/** 空态：该年份没有任何播放记录 */
function emptyHtml(year) {
  return `<section class="yearly-screen ys-cover">
    <div class="yy-eyebrow">NO DATA</div>
    <div class="yy-year">${year}</div>
    <div class="yy-cover-title">这一年还没有音乐记录</div>
    <div class="yy-cover-sub">换一年看看，或者去听几首歌</div>
  </section>`;
}

function bindScreens(root, scrollEl) {
  if (_observer) { _observer.disconnect(); _observer = null; }
  const screens = [...scrollEl.querySelectorAll('.yearly-screen')];
  const dots = [...root.querySelectorAll('.yy-dot')];

  _observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const idx = screens.indexOf(e.target);
      if (idx < 0) continue;
      e.target.classList.add('in');               // 入场动画只播放一次
      dots.forEach((d, i) => d.classList.toggle('active', i === idx));
    }
  }, { root: scrollEl, threshold: 0.55 });

  screens.forEach((s) => _observer.observe(s));
  dots.forEach((d, i) => {
    d.onclick = () => {
      const top = screens[i]?.offsetTop || 0;
      scrollEl.scrollTo({ top, behavior: 'smooth' });
    };
  });
  const again = root.querySelector('#yyAgain');
  if (again) again.onclick = () => scrollEl.scrollTo({ top: 0, behavior: 'smooth' });
}

export async function openYearly() {
  state.view = 'yearly';
  setActiveNav('navYearly');
  import('./main.js').then(({ navPush }) => navPush('yearly')).catch(() => {});
  document.body.classList.add('yearly-mode');

  const main = $('main');
  _yearOffset = 0;

  async function load() {
    const seq = ++_seq;
    main.innerHTML = '<div class="loading">正在整理你的音乐记忆…</div>';
    let data;
    try {
      data = await api(`/stats/yearly?yearOffset=${_yearOffset}`);
    } catch (e) {
      if (seq !== _seq) return;
      main.innerHTML = `<div class="empty">加载失败：${esc(e.message)}
        <div style="margin-top:12px"><button class="btn sm" id="yyRetry">重试</button></div></div>`;
      const retry = $('yyRetry');
      if (retry) retry.onclick = load;
      return;
    }
    if (seq !== _seq) return; // 年份已再次切换，丢弃陈旧响应

    const body = data.hasData ? screenHtml(data) : emptyHtml(data.year);
    main.innerHTML = `
      <div class="yearly-view">
        <div class="yearly-topbar">
          <button class="yy-year-btn" id="yyPrevYear" title="上一年">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <span class="yy-year-label">${data.year} 年</span>
          <button class="yy-year-btn" id="yyNextYear" title="下一年"${_yearOffset === 0 ? ' disabled' : ''}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
        <div class="yearly-dots">${Array.from({ length: data.hasData ? SCREEN_COUNT : 1 }, (_, i) => `<span class="yy-dot${i === 0 ? ' active' : ''}"></span>`).join('')}</div>
        <div class="yearly-scroll" id="yyScroll">${body}</div>
      </div>`;

    const scrollEl = $('yyScroll');
    bindScreens(main, scrollEl);
    scrollEl.querySelector('.yearly-screen')?.classList.add('in');

    $('yyPrevYear').onclick = () => { if (_yearOffset < 10) { _yearOffset++; load(); } };
    const nextBtn = $('yyNextYear');
    if (nextBtn) nextBtn.onclick = () => { if (_yearOffset > 0) { _yearOffset--; load(); } };
  }

  await load();
}
