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

// 内存歌词缓存：key = name__singer → { lines, candidates, sourceId, ts }
const _lyricCache = new Map();
const LYRIC_TTL = 24 * 3600_000; // 24h
export function getLyricCache(key) {
  const v = _lyricCache.get(key);
  if (v && Date.now() - v.ts < LYRIC_TTL) return v;
  _lyricCache.delete(key);
  return null;
}
export function setLyricCache(key, data) {
  _lyricCache.set(key, { ...data, ts: Date.now() });
  // 最多缓存 200 首，超过清掉一半
  if (_lyricCache.size > 200) {
    const entries = [..._lyricCache.entries()].sort((a, b) => a[1].ts - b[1].ts);
    for (let i = 0; i < 100; i++) _lyricCache.delete(entries[i][0]);
  }
}

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
  const sfRegex = sf.length >= 2 ? new RegExp(`(^|[^\\w])${sf.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\w])`, 'i') : null;

  // 优先级1：歌名完全匹配 + 歌手匹配
  if (sf) {
    const exact = songs.find((s) => {
      const nameOk = s.name?.toLowerCase() === nl;
      const artistOk = (s.artists || []).some((a) => {
        const an = a.name?.toLowerCase() || '';
        return an.includes(sf) || (sfRegex ? sfRegex.test(an) : false);
      });
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

  // 并行发起所有搜索，按优先级顺序取第一个有效结果
  const results = await Promise.allSettled(queries.map((q) => neSearchSongs(q)));
  let best = null;

  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    const songs = r.value;
    if (!songs.length) continue;

    const candidate = pickBest(songs, name, singerFirst);
    if (candidate && candidate.name?.toLowerCase() === name.toLowerCase()) { best = candidate; break; }

    if (nameClean !== name) {
      const alt = pickBest(songs, nameClean, singerFirst);
      if (alt && alt.name?.toLowerCase() === nameClean.toLowerCase()) { best = alt; break; }
    }
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

  // 并行发起所有搜索
  console.log(`[lyrics:candidates] "${name}" / "${singerFirst}" — queries: [${queries.join(' | ')}]`);
  const results = await Promise.allSettled(queries.map((q) => neSearchSongs(q)));

  const idSeen = new Set();
  const candidates = [];

  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    for (const s of r.value) {
      const sid = s.id;
      if (!sid || idSeen.has(sid)) continue;
      idSeen.add(sid);

      const artistText = (s.artists || []).map((a) => a.name).join(' / ');
      const exactName = s.name?.toLowerCase() === name.toLowerCase();
      // 歌手匹配改为「歌手名至少 2 字符且在 artist 名中以完整词形式出现」
      const hasSinger = singerFirst && singerFirst.length >= 2 &&
        (s.artists || []).some((a) => {
          const an = a.name?.toLowerCase() || '';
          const sf = singerFirst.toLowerCase();
          // 直接包含或作为词边界匹配（前后是空格/分隔符/边界）
          return an.includes(sf) || new RegExp(`(^|[^\\w])${sf.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\w])`, 'i').test(an);
        });

      let quality = 0;
      if (exactName) quality += 4;
      if (hasSinger) quality += 3;
      if (s.name?.toLowerCase().includes(name.toLowerCase())) quality += 1;

      candidates.push({ id: s.id, name: s.name, artist: artistText, quality });
    }
  }

  console.log(`[lyrics:candidates] raw candidates: ${candidates.length}, quality≥4:${candidates.filter(c=>c.quality>=4).length}, ≥3:${candidates.filter(c=>c.quality>=3).length}, ≥2:${candidates.filter(c=>c.quality>=2).length}, ≥1:${candidates.filter(c=>c.quality>=1).length}`);

  candidates.sort((a, b) => b.quality - a.quality);

  // 动态阈值：优先取质量高的，但至少保留 8 个候选（即使质量低），避免冷门歌曲零候选
  let topCandidates = candidates.filter((c) => c.quality >= 2);
  const tier1 = topCandidates.length;
  if (topCandidates.length < 8) {
    const supplement = candidates.filter((c) => c.quality >= 1 && !topCandidates.includes(c));
    topCandidates = topCandidates.concat(supplement).slice(0, 8);
  }
  if (topCandidates.length < 5) {
    const fallback = candidates.filter((c) => c.quality < 1 && !topCandidates.includes(c));
    topCandidates = topCandidates.concat(fallback).slice(0, Math.min(8, candidates.length));
  }
  console.log(`[lyrics:candidates] after tier filter: tier1:${tier1} → top:${topCandidates.length} (${topCandidates.length > 12 ? 'capped 12' : String(topCandidates.length)})`);
  // 限制最多取 20 个候选，避免过多无效请求
  topCandidates = topCandidates.slice(0, 20);

  const lyricResults = await Promise.allSettled(topCandidates.map((c) => neFetchLyric(c.id)));
  const verified = [];
  let emptyCount = 0;
  for (let i = 0; i < topCandidates.length; i++) {
    const c = topCandidates[i];
    const lr = lyricResults[i];
    if (lr.status !== 'fulfilled') continue;
    const raw = lr.value;
    if (!raw.trim()) { emptyCount++; continue; }
    verified.push({ ...c, raw });
  }
  console.log(`[lyrics:candidates] verified: ${verified.length} valid, ${emptyCount} empty, failed:${lyricResults.filter(r=>r.status==='rejected').length}`);
  return verified.slice(0, 12).map((c) => ({ id: c.id, name: c.name, artist: c.artist, quality: c.quality }));
}

/** 按 网易云 songId 直接拉取歌词 */
export async function fetchLyricsById(songId) {
  const raw = await neFetchLyric(songId);
  if (!raw.trim()) throw new Error('该歌曲暂无歌词');
  return { raw, lines: parseLrc(raw) };
}
