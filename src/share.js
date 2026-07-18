// ---------------- 分享歌曲（三元组分享） ----------------
import { $, esc, fmtDur, toast } from './utils.js';
import { state } from './state.js';
import { lyricsCurrentSourceId } from './lyrics.js';
import { Auth } from './api.js';
import { Platform, isQQSource } from './platform.js';

/**
 * 读取 localStorage 缓存的 song_mid → lyrics sourceId
 * 解决竞态：切歌/加载歌词间隙点分享时，lyricsCurrentSourceId 可能尚未更新到目标歌曲
 */
function getSourceCache() {
  try { return JSON.parse(localStorage.getItem('wemusic_lyrics_src') || '{}'); }
  catch { return {}; }
}

/**
 * 取出指定歌曲的 lyrics sourceId：优先用 cache（精确到 song_mid），
 * 再用 lyricsCurrentSourceId 作为兜底
 */
function getLyricsSourceIdForSong(songMid) {
  if (songMid) {
    const cache = getSourceCache();
    if (cache[songMid]) return cache[songMid];
  }
  return lyricsCurrentSourceId;
}

/**
 * 从 sourceId 推断歌词来源类型
 * sourceId 格式：数字（netease）或 "qq:xxx"（qqmusic）
 */
function sourceTypeOf(sourceId) {
  if (!sourceId) return null;
  if (isQQSource(sourceId)) return Platform.QQ_MUSIC;
  return Platform.NETEASE;
}

/**
 * 构建封面 URL（从 album_mid）
 */
function coverURL(albumMid) {
  if (!albumMid) return null;
  return `https://y.qq.com/music/photo_new/T002R300x300M000${albumMid}.jpg`;
}

/**
 * 从当前播放状态构建分享 URL（只保留 ID，精简 QR 码）
 */
export function buildShareURL(song) {
  if (!song || !song.song_mid) return null;
  // 用 cache + fallback 拿到这首歌的歌词 sourceId（避免切歌/加载间隙的竞态）
  const sourceId = getLyricsSourceIdForSong(song.song_mid);
  const lsrc = sourceTypeOf(sourceId);
  const d = {
    s: song.song_mid,
    amid: song.album_mid || '',
    d: song.duration || 0,   // duration → d（精简 key）
    l: lsrc && sourceId ? `${lsrc}:${sourceId}` : '',
    v: song.bvid || '',
    f: Auth.user?.username || '',  // 分享者用户名
  };
  for (const k of Object.keys(d)) { if (!d[k]) delete d[k]; }
  return `${location.origin}/?v=share&d=${encodeURIComponent(JSON.stringify(d))}`;
}

/**
 * 解析分享数据（从 URL query params）
 */
export function parseShareData(data) {
  if (!data) return null;
  const t = {
    song_mid: data.s || '',
    album_mid: data.amid || '',
    duration: data.d || data.dur || 0,
    lyricsSource: null,
    lyricsSourceId: null,
    bvid: data.v || '',
    from: data.f || '',  // 分享者用户名
  };
  if (data.l && data.l.includes(':')) {
    const [src, ...rest] = data.l.split(':');
    t.lyricsSource = src;
    t.lyricsSourceId = rest.join(':');
  }
  return t;
}

/**
 * 渲染分享落地页
 */
export async function renderSharePage(data) {
  state.view = 'share';
  import('./main.js').then(({ navPush }) => navPush('share', data));

  const t = parseShareData(data);
  if (!t || !t.song_mid) {
    $('main').innerHTML = `<div class="empty">分享链接无效或已过期</div>`;
    return;
  }

  // 调用公开元数据 API 获取歌名/歌手/专辑
  let meta = null;
  try {
    const params = new URLSearchParams();
    params.set('s', t.song_mid);
    if (t.album_mid) params.set('amid', t.album_mid);
    const resp = await fetch(`/api/share/meta?${params.toString()}`);
    if (resp.ok) meta = await resp.json();
  } catch { /* 忽略，用 URL 中的信息兜底 */ }

  const name = (meta && meta.name) || '未知歌曲';
  const singer = (meta && meta.singer) || '';
  const album = (meta && meta.album) || '';
  const dur = (meta && meta.duration) || t.duration;
  const albumImg = coverURL(t.album_mid || (meta && meta.album_mid));

  const lyricsLabel = t.lyricsSource
    ? (t.lyricsSource === Platform.NETEASE ? '网易云音乐' : 'QQ 音乐')
    : '';
  const byline = t.from ? `由 ${esc(t.from)} 分享` : '来自好友的分享';
  const shareCoverPh = '<div class="share-page-cover-fb"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>';

  $('main').innerHTML = `
    <div class="share-page">
      ${albumImg ? `<div class="share-page-bg" style="background-image:url('${esc(albumImg)}')"></div>` : ''}
      <div class="share-page-bg-tint"></div>

      <div class="share-page-card">
        <div class="share-page-byline">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          <span>${esc(byline)}</span>
        </div>

        <div class="share-page-cover">
          ${albumImg
            ? `<img src="${esc(albumImg)}" alt="" data-fb="${esc(shareCoverPh)}" onerror="this.outerHTML=this.dataset.fb" />`
            : shareCoverPh}
        </div>

        <div class="share-page-info">
          <div class="share-page-title">${esc(name)}</div>
          <div class="share-page-artist">${esc(singer || '未知歌手')}</div>
          <div class="share-page-album">${album ? `${esc(album)} · ${fmtDur(dur)}` : fmtDur(dur)}</div>
        </div>

        ${(lyricsLabel || t.bvid) ? `<div class="share-page-meta">
          ${lyricsLabel
            ? `<span class="share-page-chip">
                 <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>
                 歌词 · ${esc(lyricsLabel)}
               </span>`
            : ''}
          ${t.bvid
            ? `<span class="share-page-chip">
                 <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
                 视频 · B站 ${esc(t.bvid)}
               </span>`
            : ''}
        </div>` : ''}

        <div class="share-page-actions">
          <button class="share-page-play" id="sharePlayBtn">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            立即播放
          </button>
          <button class="share-page-add" id="shareAddBtn">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
            添加到歌单
          </button>
        </div>
      </div>
    </div>
  `;

  // 标记 share view 状态：隐藏主区域滚动条，确保单页完整显示
  document.body.classList.add('share-view');

  const songObj = {
    song_mid: t.song_mid,
    name, singer, album,
    album_mid: t.album_mid || (meta && meta.album_mid) || '',
    duration: dur,
    bvid: t.bvid || undefined,
  };

  $('sharePlayBtn').onclick = async () => {
    const player = await import('./player.js');
    player.playFromList([songObj], 0, 'share');
  };

  $('shareAddBtn').onclick = async () => {
    const { addSongs } = await import('./playlist-ui.js');
    addSongs([songObj]);
  };
}

/**
 * 预取歌词源：如果这首歌还没 sourceId，主动调公开 API 拉取默认版本
 * 解决"未打开歌词详情页就分享"拿不到歌词源的问题
 * 成功后会写入 localStorage 缓存，下次直接命中
 */
async function ensureLyricsSourceFor(song) {
  if (!song || !song.song_mid || !song.name) return;
  if (getLyricsSourceIdForSong(song.song_mid)) return; // 已有
  try {
    const params = new URLSearchParams();
    params.set('n', song.name);
    if (song.singer) params.set('a', song.singer);
    const resp = await fetch(`/api/share/lyrics?${params.toString()}`);
    if (!resp.ok) return;
    const data = await resp.json();
    if (data && data.sourceId) {
      const cache = getSourceCache();
      cache[song.song_mid] = data.sourceId;
      localStorage.setItem('wemusic_lyrics_src', JSON.stringify(cache));
    }
  } catch { /* 静默失败，弹窗照常显示 */ }
}

/**
 * 打开分享弹窗（从播放器/右键菜单触发）
 */
export async function openShareModal(song) {
  if (!song || !song.song_mid) {
    toast('该歌曲不支持分享');
    return;
  }

  // 预取歌词源（拿不到就静默跳过，正常显示弹窗）
  await ensureLyricsSourceFor(song);

  const url = buildShareURL(song);
  if (!url) { toast('无法生成分享链接'); return; }

  // 歌词源：cache 优先 + 预取 fallback
  const sourceId = getLyricsSourceIdForSong(song.song_mid);
  const lsrc = sourceTypeOf(sourceId);
  const lyricsLabel = lsrc
    ? (lsrc === Platform.NETEASE ? '网易云音乐' : 'QQ 音乐')
    : '无';

  const albumImg = coverURL(song.album_mid);

  const modalHTML = `
    <div class="modal-mask" id="shareModal" style="z-index:150">
      <div class="modal share-modal">
        <div class="share-header">
          <h3>分享这首歌</h3>
        </div>
        <div class="share-main">
          <div class="share-info">
            <div class="share-cover">
              ${albumImg
                ? `<img src="${esc(albumImg)}" alt="" onerror="this.parentElement.innerHTML='<div class=&quot;share-cover-fb&quot;>🎵</div>'" />`
                : `<div class="share-cover-fb">🎵</div>`}
            </div>
            <div class="share-info-text">
              <div class="share-name" title="${esc(song.name)}">${esc(song.name)}</div>
              <div class="share-singer" title="${esc((song.singer || '').split('/')[0])}">${esc((song.singer || '').split('/')[0])}</div>
              <div class="share-tags">
                <span class="share-tag">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
                  ${esc(lyricsLabel)}
                </span>
                ${song.bvid ? `<span class="share-tag" title="${esc(song._biliTitle || '')}">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
                  ${esc(song.bvid)}
                </span>` : ''}
              </div>
            </div>
          </div>
          <div class="share-qr-wrap">
            <img class="share-qr-img" src="https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(url)}" alt="QR Code" />
            <div class="share-qr-tip">扫码打开</div>
          </div>
        </div>
        <div class="share-url-bar">
          <span class="share-url-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
          </span>
          <input type="text" class="share-url-input" id="shareUrlInput" value="${esc(url)}" readonly />
          <button class="share-copy-btn" id="shareCopyBtn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            复制链接
          </button>
        </div>
        <div class="prompt-actions">
          <button class="btn sm" id="shareModalClose">关闭</button>
        </div>
      </div>
    </div>
  `;

  const old = document.getElementById('shareModal');
  if (old) old.remove();

  document.body.insertAdjacentHTML('beforeend', modalHTML);
  const mo = document.getElementById('shareModal');
  mo.classList.add('show');

  document.getElementById('shareModalClose').onclick = () => mo.remove();
  mo.onclick = (e) => { if (e.target === mo) mo.remove(); };

  document.getElementById('shareCopyBtn').onclick = () => {
    copyToClipboard(url);
    toast('链接已复制');
  };
}

function copyToClipboard(text) {
  navigator.clipboard?.writeText(text)?.catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove();
  });
}
