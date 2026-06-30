/**
 * 歌词服务：从网易云音乐搜索并拉取 LRC 格式歌词
 * 搜索策略（优先级递减）：
 *   1. 歌名 + 歌手（精确）
 *   2. 歌名去括号 + 歌手
 *   3. 纯歌名
 *   4. 歌名去括号（纯）
 * 每步都做：歌名完全匹配 + 歌手包含匹配 → 歌名匹配 → 第一条
 */

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const H  = { 'User-Agent': UA, Referer: 'https://music.163.com/' };

/** 去掉括号内的修饰词，如 (Live)、（粤语版）、[Demo] */
function stripBrackets(name) {
  return name
    .replace(/[\(（\[【][^)\）\]】]*[\)）\]】]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 解析 LRC 格式为 [{time, text}] 数组，time 单位：秒 */
export function parseLrc(lrc = '') {
  const lines = lrc.split('\n');
  const result = [];
  const timeRe = /\[(\d+):(\d+\.?\d*)\]/g;
  let hasTimestamp = false;
  for (const line of lines) {
    const text = line.replace(/\[.*?\]/g, '').trim();
    if (!text) continue;
    let m;
    timeRe.lastIndex = 0;
    let matched = false;
    while ((m = timeRe.exec(line)) !== null) {
      const time = Number(m[1]) * 60 + Number(m[2]);
      result.push({ time, text });
      matched = true;
      hasTimestamp = true;
    }
    if (!matched) result.push({ time: -1, text });
  }
  if (hasTimestamp) return result.sort((a, b) => a.time - b.time);
  return result;
}

/** 在搜索结果中挑选最佳匹配 */
function pickBest(songs, name, singerFirst) {
  const nl = name.toLowerCase();
  const sf = (singerFirst || '').toLowerCase();

  // 优先级1：歌名完全匹配 + 歌手匹配
  if (sf) {
    const exact = songs.find((s) => {
      const nameOk = s.name?.toLowerCase() === nl;
      const artistOk = (s.artists || []).some((a) => a.name?.toLowerCase().includes(sf));
      return nameOk && artistOk;
    });
    if (exact) return exact;
  }
  // 优先级2：歌名完全匹配
  const nameOnly = songs.find((s) => s.name?.toLowerCase() === nl);
  if (nameOnly) return nameOnly;
  // 优先级3：歌名包含
  const nameContains = songs.find((s) => s.name?.toLowerCase().includes(nl));
  if (nameContains) return nameContains;
  return songs[0];
}

/** 网易云搜索歌曲列表 */
async function neSearchSongs(keyword) {
  const url = `https://music.163.com/api/search/get?s=${encodeURIComponent(keyword)}&type=1&limit=15`;
  try {
    const j = await (await fetch(url, { headers: H })).json();
    return j?.result?.songs || [];
  } catch {
    return [];
  }
}

/** 拉取歌词正文 */
async function neFetchLyric(songId) {
  const url = `https://music.163.com/api/song/lyric?id=${songId}&lv=1&tv=-1`;
  try {
    const j = await (await fetch(url, { headers: H })).json();
    return j?.lrc?.lyric || '';
  } catch {
    return '';
  }
}

/** 搜索并返回歌词（已解析的 LRC 数组 + 原始字符串） */
export async function fetchLyrics(name, singer = '') {
  const singerFirst = singer.split(/[\/、,，&]/)[0].trim();
  const nameClean = stripBrackets(name);

  // 构建搜索候选序列（去重）
  const queries = [];
  const seen = new Set();
  const add = (q) => { if (!seen.has(q)) { seen.add(q); queries.push(q); } };

  if (singerFirst) {
    add(`${name} ${singerFirst}`);
    if (nameClean !== name) add(`${nameClean} ${singerFirst}`);
  }
  add(name);
  if (nameClean !== name) add(nameClean);

  let best = null;

  for (const q of queries) {
    const songs = await neSearchSongs(q);
    if (!songs.length) continue;

    // 先尝试精确歌名匹配
    const candidate = pickBest(songs, name, singerFirst);
    const isGood = candidate && candidate.name?.toLowerCase() === name.toLowerCase();
    if (isGood) { best = candidate; break; }

    // 若精确歌名未匹配，尝试去括号歌名
    if (nameClean !== name) {
      const alt = pickBest(songs, nameClean, singerFirst);
      if (alt && alt.name?.toLowerCase() === nameClean.toLowerCase()) { best = alt; break; }
    }
    // 兜底：接受第一个非精确匹配
    if (candidate) { best = candidate; break; }
  }

  if (!best) throw new Error('未找到匹配歌词');

  const raw = await neFetchLyric(best.id);
  if (!raw.trim()) throw new Error('该歌曲暂无歌词');

  return {
    song:   best.name,
    artist: (best.artists || []).map((a) => a.name).join(' / '),
    sourceId: best.id,
    raw,
    lines: parseLrc(raw),
  };
}

/** 按歌名+歌手搜索，返回候选列表（用于歌词换源），排好序 */
export async function searchLyricsCandidates(name, singer = '') {
  const singerFirst = singer.split(/[\/、,，&]/)[0].trim();
  const nameClean = stripBrackets(name);

  const queries = [];
  const seenQ = new Set();
  const addQ = (q) => { if (!seenQ.has(q)) { seenQ.add(q); queries.push(q); } };
  if (singerFirst) { addQ(`${name} ${singerFirst}`); if (nameClean !== name) addQ(`${nameClean} ${singerFirst}`); }
  addQ(name);
  if (nameClean !== name) addQ(nameClean);

  const idSeen = new Set();
  const candidates = [];

  for (const q of queries) {
    const songs = await neSearchSongs(q);
    for (const s of songs) {
      const sid = s.id;
      if (!sid || idSeen.has(sid)) continue;
      idSeen.add(sid);

      const artistText = (s.artists || []).map((a) => a.name).join(' / ');
      const exactName = s.name?.toLowerCase() === name.toLowerCase();
      const hasSinger = singerFirst && (s.artists || []).some((a) => a.name?.toLowerCase().includes(singerFirst.toLowerCase()));

      let quality = 0;
      if (exactName) quality += 3;
      if (hasSinger) quality += 2;
      if (s.name?.toLowerCase().includes(name.toLowerCase())) quality += 1;

      candidates.push({
        id: s.id,
        name: s.name,
        artist: artistText,
        quality,
      });
    }
  }

  // 按 quality 降序排列，取足够多的候选（后续过滤无歌词的再保留 12 个）
  candidates.sort((a, b) => b.quality - a.quality);
  const pool = candidates.slice(0, 30);

  // 并发拉取歌词，过滤掉歌词为空的候选
  const valid = [];
  const fetchTasks = pool.map(async (c) => {
    const raw = await neFetchLyric(c.id);
    if (raw.trim()) valid.push(c);
  });
  await Promise.allSettled(fetchTasks);

  // 按原始 quality 排序后返回前 12 个
  valid.sort((a, b) => b.quality - a.quality);
  return valid.slice(0, 12);
}

/** 按 网易云 songId 直接拉取歌词 */
export async function fetchLyricsById(songId) {
  const raw = await neFetchLyric(songId);
  if (!raw.trim()) throw new Error('该歌曲暂无歌词');
  return { raw, lines: parseLrc(raw) };
}
