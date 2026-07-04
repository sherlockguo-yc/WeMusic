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
const HQQ = { 'User-Agent': UA, Referer: 'https://y.qq.com/portal/player.html' };
const H   = { 'User-Agent': UA, Referer: 'https://music.163.com/' };

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

// ---- QQ 音乐歌词源 ----

async function qqSearchSongs(keyword) {
  const url = `https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg?key=${encodeURIComponent(keyword)}&format=json`;
  try { const j = await (await fetch(url, { headers: HQQ })).json();
    return (j?.data?.song?.itemlist || []).map((s) => ({ mid: s.mid, name: s.name, singer: s.singer }));
  } catch { return []; }
}

export async function qqFetchLyric(songmid) {
  const url = `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${encodeURIComponent(songmid)}&format=json`;
  try { const text = await (await fetch(url, { headers: HQQ })).text();
    const m = text.match(/\{.*\}/s); if (!m) return '';
    const d = JSON.parse(m[0]); const b64 = d?.lyric || d?.Lyric || '';
    if (!b64) return ''; return Buffer.from(b64, 'base64').toString('utf-8');
  } catch { return ''; }
}

function scoreCandidate(song, { name, singerFirst }) {
  const nameLow = name.toLowerCase(); const sName = song.name || '';
  const exactName = sName.toLowerCase() === nameLow;
  const artistNames = song.singer || (song.artists || []).map((a) => a.name).join(' ');
  const hasSinger = singerFirst && singerFirst.length >= 2 &&
    artistNames.toLowerCase().includes(singerFirst.toLowerCase());
  let quality = 0;
  if (hasSinger) quality += 5;
  if (exactName) quality += 3;
  if (sName.toLowerCase().includes(nameLow)) quality += 1;
  return { quality };
}

async function searchQQCandidates(name, singer = '') {
  const singerFirst = singer.split(/[\/、,，&]/)[0].trim();
  const nameClean = stripBrackets(name);
  const bracketCN = (name.match(/[（(]([^)）]+)[）)]/) || [])[1] || '';
  const queries = [], seen = new Set();
  const add = (q) => { if (!seen.has(q)) { seen.add(q); queries.push(q); } };
  if (singerFirst) { add(`${name} ${singerFirst}`); if (nameClean !== name) add(`${nameClean} ${singerFirst}`); if (bracketCN) add(`${bracketCN} ${singerFirst}`); }
  add(name); if (nameClean !== name) add(nameClean); if (bracketCN) add(bracketCN);
  const results = await Promise.allSettled(queries.map((q) => qqSearchSongs(q)));
  const seenMid = new Set(); const candidates = [];
  for (const r of results) { if (r.status !== 'fulfilled') continue;
    for (const s of r.value) { if (!s.mid || seenMid.has(s.mid)) continue; seenMid.add(s.mid);
      const { quality } = scoreCandidate(s, { name, singerFirst });
      candidates.push({ id: `qq:${s.mid}`, mid: s.mid, name: s.name, artist: s.singer, quality, source: 'qq' }); }
  }
  candidates.sort((a, b) => b.quality - a.quality);
  const topCandidates = candidates.filter((c) => c.quality >= 2).slice(0, 5);
  if (!topCandidates.length) return [];
  const lyricResults = await Promise.allSettled(topCandidates.map((c) => qqFetchLyric(c.mid)));
  const verified = [];
  for (let i = 0; i < topCandidates.length; i++) {
    if (lyricResults[i].status !== 'fulfilled') continue;
    const raw = lyricResults[i].value; if (!raw.trim()) continue;
    verified.push({ ...topCandidates[i], raw });
  }
  return verified.map((c) => ({ id: c.id, mid: c.mid, name: c.name, artist: c.artist, quality: c.quality, source: 'qq' }));
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

  if (!best) {
    const qq = await searchQQCandidates(name, singer);
    const bestQQ = qq[0];
    if (!bestQQ) throw new Error('未找到匹配歌词');
    const raw = await qqFetchLyric(bestQQ.mid);
    if (!raw.trim()) throw new Error('该歌曲暂无歌词');
    return { song: bestQQ.name, artist: bestQQ.artist, sourceId: bestQQ.id, raw, lines: parseLrc(raw) };
  }

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
  // 提取括号内的中文名作为额外搜索词
  const bracketCN = (name.match(/[（(]([^)）]+)[）)]/) || [])[1] || '';

  const queries = [];
  const seenQ = new Set();
  const addQ = (q) => { if (!seenQ.has(q)) { seenQ.add(q); queries.push(q); } };
  if (singerFirst) {
    addQ(`${name} ${singerFirst}`);
    if (nameClean !== name) addQ(`${nameClean} ${singerFirst}`);
    if (bracketCN) addQ(`${bracketCN} ${singerFirst}`);
  }
  addQ(name);
  if (nameClean !== name) addQ(nameClean);
  if (bracketCN) addQ(bracketCN);

  // 并行发起所有搜索
  console.log(`[lyrics:candidates] "${name}" / "${singerFirst}" — queries: [${queries.join(' | ')}]`);
  const [neResults, qqResults] = await Promise.allSettled([
    Promise.allSettled(queries.map((q) => neSearchSongs(q))),
    searchQQCandidates(name, singer),
  ]);

  const idSeen = new Set();
  const candidates = [];

  if (neResults.status === 'fulfilled') {
    for (const r of neResults.value) {
      if (r.status !== 'fulfilled') continue;
      for (const s of r.value) {
        const sid = s.id;
        if (!sid || idSeen.has(`ne:${sid}`)) continue;
        idSeen.add(`ne:${sid}`);
        const artistText = (s.artists || []).map((a) => a.name).join(' / ');
        const { quality } = scoreCandidate(s, { name, singerFirst });
        candidates.push({ id: s.id, name: s.name, artist: artistText, quality, source: 'ne' });
      }
    }
  }

  if (qqResults.status === 'fulfilled') {
    for (const c of qqResults.value) {
      const dedupKey = `qq:${c.name?.toLowerCase()}__${c.artist?.toLowerCase()}`;
      if (idSeen.has(dedupKey)) continue;
      idSeen.add(dedupKey);
      if (c.quality >= 4) candidates.push(c);
    }
  }

  console.log(`[lyrics:candidates] raw candidates: ${candidates.length}, hasSinger(≥5):${candidates.filter(c=>c.quality>=5).length}, exactName(≥4):${candidates.filter(c=>c.quality>=4).length}, ≥2:${candidates.filter(c=>c.quality>=2).length}, ≥1:${candidates.filter(c=>c.quality>=1).length}`);

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
  // 只验证 top 10 候选（最终返回 12 个，留裕量），大幅减少 HTTP 请求
  topCandidates = topCandidates.slice(0, 10);

  const lyricResults = await Promise.allSettled(topCandidates.map((c) =>
    c.source === 'qq' ? qqFetchLyric(c.mid) : neFetchLyric(c.id)
  ));
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
  return verified.slice(0, 12).map((c) => ({ id: c.id, name: c.name, artist: c.artist, quality: c.quality, source: c.source }));
}

/** 按 网易云 songId 直接拉取歌词 */
export async function fetchLyricsById(songId) {
  const raw = await neFetchLyric(songId);
  if (!raw.trim()) throw new Error('该歌曲暂无歌词');
  return { raw, lines: parseLrc(raw) };
}
