/**
 * Apple Music 数据服务
 * 通过解析歌单公开页面的内嵌数据获取曲目列表（无需 token / 登录），仅供本地个人学习使用。
 *   - 主数据源：<script id="serialized-server-data"> 内嵌 JSON（含歌手 / 专辑 / 时长）
 *   - 降级数据源：schema.org JSON-LD（MusicPlaylist，仅歌名 / 时长 / 歌曲 ID，无歌手）
 * 若 Apple 页面结构调整，集中在此模块维护即可。
 */

import { Platform } from '../../shared/constants.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'zh-CN,zh;q=0.9' };
const FETCH_TIMEOUT = 15_000;

/**
 * 从链接中提取 Apple Music 歌单 ID（pl.<hex>）
 *
 * 组合识别策略（实测：单一正则无法同时满足「拒绝非苹果域名」与「接受纯 ID 粘贴」）：
 *   1. 整体为纯 pl.<hex> ID（用户直接复制 ID）→ 接受
 *   2. 含 Apple 域名（music.apple.com / itunes.apple.com 及子域，如 geo.music.apple.com）
 *      且含 pl.<hex> → 提取
 *   3. 其余（含 example.com/pl.xxx 这类）→ null
 *
 * ⚠️ 本函数必须在 QQ / 网易云提取函数之前调用：extractDisstid /
 * extractNeteasePlaylistId 的兜底正则 /(\d{6,})/ 会误吞 pl ID 内的连续数字
 * （实测 pl.beb783da7712481... 被吞成 7712481、pl.d467987f... 被吞成 467987）。
 */
export function extractApplePlaylistId(input) {
  if (!input) return null;
  const str = String(input).trim();
  const pure = str.match(/^(pl\.[a-f0-9]{20,})$/i);
  if (pure) return pure[1].toLowerCase();
  if (!/(?:music|itunes)\.apple\.com\//i.test(str)) return null;
  const m = str.match(/pl\.[a-f0-9]{20,}/i);
  return m ? m[0].toLowerCase() : null;
}

/** 从 HTML 中提取指定 id 的 <script> 内嵌 JSON */
function extractScriptJson(html, scriptId) {
  const m = html.match(new RegExp(`<script[^>]*id="${scriptId}"[^>]*>([\\s\\S]*?)</script>`));
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

/** 解析 schema.org JSON-LD（页面可能有多块，取 MusicPlaylist 那一块） */
function parseJsonLd(html) {
  const re = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    try {
      const obj = JSON.parse(m[1]);
      if (obj && obj['@type'] === 'MusicPlaylist' && Array.isArray(obj.track)) return obj;
    } catch { /* 单个脚本块解析失败不影响其他块 */ }
  }
  return null;
}

/** ISO 8601 时长（如 PT4M30S）→ 秒 */
export function isoDurationToSec(iso) {
  const m = String(iso || '').match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return 0;
  return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
}

/** 从歌曲页 URL 末段提取数字 ID（JSON-LD 降级路径用） */
function extractIdFromUrl(url) {
  const last = String(url || '').split(/[?#]/)[0].split('/').filter(Boolean).pop() || '';
  return /^\d{5,}$/.test(last) ? last : '';
}

/** 从 <title> 兜底提取歌单名（清理 U+200E 等不可见字符与固定后缀） */
function titleTagName(html) {
  const m = html.match(/<title>([^<]*)<\/title>/);
  if (!m) return '';
  return m[1]
    .replace(/[\u200b\u200e\u200f]/g, '')
    .replace(/\s*-\s*(歌单|Playlist)\s*-\s*Apple Music\s*$/i, '')
    .trim();
}

/** SSR track item → 标准歌曲对象（字段集与 QQ / 网易云归一化输出保持一致） */
function normalizeTrackItem(item) {
  const cd = item.contentDescriptor || {};
  const id = (cd.identifiers && cd.identifiers.storeAdamID) || '';
  const albumLink = (item.tertiaryLinks || []).find(
    (l) => l && l.segue && l.segue.destination && l.segue.destination.contentDescriptor
      && l.segue.destination.contentDescriptor.kind === 'album'
  );
  return {
    song_mid: id ? `am_${id}` : '',
    song_id: id || 0,
    name: item.title || '',
    singer: item.artistName || ((item.subtitleLinks || [])[0] || {}).title || '',
    singer_mid: '',
    album: (albumLink && albumLink.title) || '',
    album_mid: '',
    // ms → 秒，向下取整：与 Apple 页面 ISO 时长口径一致（270677ms → 4:30，非 4:31）
    duration: Math.floor((item.duration || 0) / 1000),
    hires: false,
    lossless: false,
    source: Platform.APPLE_MUSIC,
  };
}

/** JSON-LD track → 标准歌曲对象（降级路径：无歌手 / 专辑） */
function normalizeJsonLdTrack(t) {
  const id = extractIdFromUrl(t.url);
  return {
    song_mid: id ? `am_${id}` : '',
    song_id: id || 0,
    name: t.name || '',
    singer: '',
    singer_mid: '',
    album: '',
    album_mid: '',
    duration: isoDurationToSec(t.duration),
    hires: false,
    lossless: false,
    source: Platform.APPLE_MUSIC,
  };
}

/**
 * 解析歌单页面 HTML（纯函数，便于单测）
 * @returns {{ name: string, total: number, songs: Array, degraded: boolean } | null}
 *   null 表示页面结构完全无法识别（SSR 与 JSON-LD 均解析失败）
 */
export function parseApplePageHtml(html) {
  const sd = extractScriptJson(html, 'serialized-server-data');
  const page = sd && sd.data && sd.data[0] && sd.data[0].data;
  if (page && Array.isArray(page.sections)) {
    // 曲目定位：优先 itemKind === 'trackLockup' 的 section（实测锚点，恒为曲目列表），
    // 兜底遍历全部 sections 过滤 contentDescriptor.kind === 'song'
    const trackSection = page.sections.find((s) => s && s.itemKind === 'trackLockup');
    const items = [];
    if (trackSection) {
      for (const x of trackSection.items || []) {
        if (x && x.contentDescriptor && x.contentDescriptor.kind === 'song') items.push(x);
      }
    } else {
      for (const s of page.sections) {
        for (const x of s.items || []) {
          if (x && x.contentDescriptor && x.contentDescriptor.kind === 'song') items.push(x);
        }
      }
    }
    const songs = items.map(normalizeTrackItem).filter((s) => s.name);
    const ld = parseJsonLd(html);
    const headerTitle = page.sections[0] && page.sections[0].items
      && page.sections[0].items[0] && page.sections[0].items[0].title;
    return {
      name: headerTitle || (ld && ld.name) || titleTagName(html),
      total: songs.length,
      songs,
      degraded: false,
    };
  }

  // 降级：schema.org JSON-LD（无歌手 / 专辑）
  const ld = parseJsonLd(html);
  if (ld) {
    const songs = ld.track.map(normalizeJsonLdTrack).filter((s) => s.name);
    return { name: ld.name || titleTagName(html), total: songs.length, songs, degraded: true };
  }
  return null;
}

/**
 * 解析 Apple Music 歌单
 * @param {string} playlistId - pl.<hex>
 * @returns {{ name: string, total: number, songs: Array }}
 */
export async function parseApplePlaylist(playlistId) {
  const url = `https://music.apple.com/cn/playlist/${playlistId}`;
  let res;
  try {
    res = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(FETCH_TIMEOUT) });
  } catch (e) {
    const timeout = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    throw new Error(timeout ? 'Apple Music 访问超时，请稍后重试' : `Apple Music 访问失败：${e.message}`);
  }
  if (res.status === 404) throw new Error('歌单不存在或未公开');
  if (!res.ok) throw new Error(`Apple Music 返回异常（HTTP ${res.status}）`);

  const html = await res.text();
  const result = parseApplePageHtml(html);
  if (!result) throw new Error('解析失败，Apple Music 页面结构可能已变更');

  // 曲目数校验（不阻断，仅诊断）：与页面内 JSON-LD 声明的 numTracks 对比
  if (!result.degraded) {
    const numTracks = Number((html.match(/"numTracks":(\d+)/) || [])[1]) || 0;
    if (numTracks && result.songs.length !== numTracks) {
      console.warn(`[apple] 曲目数不一致：解析 ${result.songs.length} vs 页面声明 ${numTracks}（${playlistId}）`);
    }
  } else {
    console.warn(`[apple] 已降级为 JSON-LD 解析（无歌手/专辑）：${playlistId}`);
  }

  return { name: result.name || `歌单 ${playlistId}`, total: result.songs.length, songs: result.songs };
}
