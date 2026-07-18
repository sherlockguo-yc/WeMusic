/**
 * 歌词服务：使用 LyricsProvider 模式（参考 naisev/WeMusic 的 IApi 接口抽象）
 *
 * 每个歌词来源实现统一的 LyricsProvider 接口：
 *   - search(keyword)       → 搜索候选列表
 *   - fetchLyric(id)        → 拉取歌词原文
 *   - scoreCandidate(s,ctx) → 候选评分
 *
 * 调度策略：网易云优先 → QQ音乐兜底
 */

import { getCrowdCompletions, crowdBonus } from './crowd.js';
import NeteaseLyricsProvider from './lyrics-providers/netease.js';
import QQLyricsProvider from './lyrics-providers/qq.js';
import {
  LyricsSource, Platform,
  encodeSourceId,
} from '../../shared/constants.js';

// ---- Provider 懒加载 ----

let _providers = null;
function providers() {
  if (!_providers) {
    _providers = [
      new NeteaseLyricsProvider(),
      new QQLyricsProvider(),
    ];
  }
  return _providers;
}

function providerFor(source) {
  return providers().find((p) => p.source === source);
}

// ---- 辅助函数 ----

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

/** 合并原文和翻译：按时间戳匹配 → 无时间戳则按顺序逐行匹配 */
export function parseLrcWithTrans(lrc, tlyric) {
  if (!tlyric || !tlyric.trim()) return parseLrc(lrc);

  const original = parseLrc(lrc);
  const trans = parseLrc(tlyric);

  // 翻译有时间戳 → 按时间匹配
  if (trans.length && trans[0].time >= 0) {
    const transMap = new Map();
    for (const t of trans) {
      // 同一时间戳多条翻译 → 用第一行之后的时间寻找不同文本
      const key = t.time;
      if (!transMap.has(key)) transMap.set(key, t.text);
    }
    for (const o of original) {
      if (transMap.has(o.time)) o.transText = transMap.get(o.time);
    }
    return original;
  }

  // 翻译无时间戳 → 按顺序逐行匹配
  for (let i = 0; i < original.length && i < trans.length; i++) {
    original[i].transText = trans[i].text;
  }
  return original;
}

// ---- 内存歌词缓存 ----

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
  if (_lyricCache.size > 200) {
    const entries = [..._lyricCache.entries()].sort((a, b) => a[1].ts - b[1].ts);
    for (let i = 0; i < 100; i++) _lyricCache.delete(entries[i][0]);
  }
}

// ---- 候选搜索 ----

/** 在搜索结果中挑选最佳匹配 */
function pickBest(songs, name, singerFirst) {
  const nl = name.toLowerCase();
  const sf = (singerFirst || '').toLowerCase();
  const sfRegex = sf.length >= 2
    ? new RegExp(`(^|[^\\w])${sf.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\w])`, 'i')
    : null;

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
  const nameOnly = songs.find((s) => s.name?.toLowerCase() === nl);
  if (nameOnly) return nameOnly;
  const nameContains = songs.find((s) => s.name?.toLowerCase().includes(nl));
  if (nameContains) return nameContains;
  return songs[0];
}

/**
 * 从单个 Provider 搜索最佳匹配
 */
async function searchWithProvider(provider, name, singerFirst, nameClean) {
  const queries = [], seen = new Set();
  const add = (q) => { if (!seen.has(q)) { seen.add(q); queries.push(q); } };

  if (singerFirst) {
    add(`${name} ${singerFirst}`);
    if (nameClean !== name) add(`${nameClean} ${singerFirst}`);
  }
  add(name);
  if (nameClean !== name) add(nameClean);

  const results = await Promise.allSettled(queries.map((q) => provider.search(q)));

  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    const songs = r.value.filter((s) => s._raw);
    if (!songs.length) continue;

    const candidate = pickBest(songs, name, singerFirst);
    if (candidate && candidate.name?.toLowerCase() === name.toLowerCase()) return candidate;

    if (nameClean !== name) {
      const alt = pickBest(songs, nameClean, singerFirst);
      if (alt && alt.name?.toLowerCase() === nameClean.toLowerCase()) return alt;
    }
    if (candidate) return candidate;
  }
  return null;
}

// ---- QQ 音乐候选搜索（内部） ----

async function searchQQCandidates(name, singer = '') {
  const qqProvider = providerFor(LyricsSource.QQ);
  if (!qqProvider) return [];

  const singerFirst = singer.split(/[\/、,，&]/)[0].trim();
  const nameClean = stripBrackets(name);
  const bracketCN = (name.match(/[（(]([^)）]+)[）)]/) || [])[1] || '';

  const queries = [], seen = new Set();
  const add = (q) => { if (!seen.has(q)) { seen.add(q); queries.push(q); } };
  if (singerFirst) {
    add(`${name} ${singerFirst}`);
    if (nameClean !== name) add(`${nameClean} ${singerFirst}`);
    if (bracketCN) add(`${bracketCN} ${singerFirst}`);
  }
  add(name);
  if (nameClean !== name) add(nameClean);
  if (bracketCN) add(bracketCN);

  const results = await Promise.allSettled(queries.map((q) => qqProvider.search(q)));
  const seenMid = new Set();
  const candidates = [];

  const crowd = getCrowdCompletions('lyrics', `${name}__${singerFirst || ''}`);

  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    for (const s of r.value) {
      const mid = s.rawId;
      if (!mid || seenMid.has(mid)) continue;
      seenMid.add(mid);
      const { quality } = qqProvider.scoreCandidate(s, { name, singerFirst });
      const bonus = crowdBonus(crowd.get(encodeSourceId(Platform.QQ_MUSIC, mid)), 0.5);
      candidates.push({
        id: encodeSourceId(Platform.QQ_MUSIC, mid),
        rawId: mid, mid,
        name: s.name,
        artist: s.artist,
        album_mid: s.album_mid || s._raw?.albummid || '',
        quality: quality + bonus,
        source: LyricsSource.QQ,
      });
    }
  }
  candidates.sort((a, b) => b.quality - a.quality);

  const topCandidates = candidates.filter((c) => c.quality >= 2).slice(0, 5);
  if (!topCandidates.length) return [];

  const lyricResults = await Promise.allSettled(
    topCandidates.map((c) => qqProvider.fetchLyric(c.mid))
  );
  const verified = [];
  for (let i = 0; i < topCandidates.length; i++) {
    if (lyricResults[i].status !== 'fulfilled') continue;
    const raw = lyricResults[i].value;
    if (!raw.trim()) continue;
    verified.push({ ...topCandidates[i] });
  }
  return verified;
}

// ---- 纯音乐检测 ----

/** 纯音乐关键词（高精度、低误判） */
const INSTRUMENTAL_PATTERNS = [
  /纯音乐/,
  /伴奏/,
  /无人声/,
  /器乐(?!团|队)/,
  /\bBGM\b/i,
  /背景音乐/,
  /\binstrumental\b/i,
  /\bkaraoke\b/i,
  /\boff[- ]?vocal\b/i,
  /\borchestral\b/i,
  /\bsymphony\b/i,
];

/**
 * 根据歌名判断是否可能是纯音乐。
 * 命中关键词则直接返回 true，跳过后续的歌词源搜索。
 */
export function isInstrumental(name) {
  if (!name) return false;
  return INSTRUMENTAL_PATTERNS.some((p) => p.test(name));
}

// ---- 公开 API ----

/**
 * 搜索并返回歌词（已解析的 LRC 数组）
 * 策略：网易云优先 → QQ音乐兜底
 */
export async function fetchLyrics(name, singer = '') {
  const singerFirst = singer.split(/[\/、,，&]/)[0].trim();
  const nameClean = stripBrackets(name);
  const [neProvider, qqProvider] = providers();

  // 网易云优先
  const neResult = await searchWithProvider(neProvider, name, singerFirst, nameClean);
  if (neResult) {
    const { lrc, tlyric } = await neProvider.fetchLyric(neResult.rawId);
    if (lrc.trim()) {
      return {
        song: neResult.name,
        artist: (neResult.artists || []).map((a) => a.name).join(' / '),
        sourceId: neResult.id,
        raw: lrc,
        tlyric,
        lines: parseLrcWithTrans(lrc, tlyric),
      };
    }
  }

  // QQ 音乐兜底
  const qqCandidates = await searchQQCandidates(name, singer);
  const bestQQ = qqCandidates[0];
  if (!bestQQ) throw new Error('未找到匹配歌词');

  const { lrc, tlyric } = await qqProvider.fetchLyric(bestQQ.rawId || bestQQ.mid);
  if (!lrc.trim()) throw new Error('该歌曲暂无歌词');
  return {
    song: bestQQ.name,
    artist: bestQQ.artist,
    sourceId: bestQQ.id,
    raw: lrc,
    tlyric,
    lines: parseLrcWithTrans(lrc, tlyric),
  };
}

/**
 * 按歌名+歌手搜索，返回候选列表（用于歌词换源 UI）
 */
export async function searchLyricsCandidates(name, singer = '') {
  const singerFirst = singer.split(/[\/、,，&]/)[0].trim();
  const nameClean = stripBrackets(name);
  const bracketCN = (name.match(/[（(]([^)）]+)[）)]/) || [])[1] || '';
  const [neProvider, qqProvider] = providers();

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

  console.log(`[lyrics:candidates] "${name}" / "${singerFirst}" — queries: [${queries.join(' | ')}]`);

  const [neResults, qqResults] = await Promise.allSettled([
    Promise.allSettled(queries.map((q) => neProvider.search(q))),
    searchQQCandidates(name, singer),
  ]);

  const idSeen = new Set();
  const candidates = [];

  const crowd = getCrowdCompletions('lyrics', `${name}__${singerFirst || ''}`);

  // 网易云候选
  if (neResults.status === 'fulfilled') {
    for (const r of neResults.value) {
      if (r.status !== 'fulfilled') continue;
      for (const s of r.value) {
        const rawId = s.rawId;
        if (!rawId || idSeen.has(`ne:${rawId}`)) continue;
        idSeen.add(`ne:${rawId}`);
        const artistText = (s.artists || []).map((a) => a.name).join(' / ');
        const { quality } = neProvider.scoreCandidate(s, { name, singerFirst });
        const bonus = crowdBonus(crowd.get(String(rawId)), 0.5);
        candidates.push({
          id: s.id,
          name: s.name,
          artist: artistText,
          quality: quality + bonus,
          source: LyricsSource.NE,
        });
      }
    }
  }

  // QQ 音乐候选
  if (qqResults.status === 'fulfilled') {
    for (const c of qqResults.value) {
      const dedupKey = `qq:${c.name?.toLowerCase()}__${c.artist?.toLowerCase()}`;
      if (idSeen.has(dedupKey)) continue;
      idSeen.add(dedupKey);
      if (c.quality >= 4) candidates.push(c);
    }
  }

  console.log(`[lyrics:candidates] raw candidates: ${candidates.length}, hasSinger(≥5):${candidates.filter(c => c.quality >= 5).length}, exactName(≥4):${candidates.filter(c => c.quality >= 4).length}, ≥2:${candidates.filter(c => c.quality >= 2).length}, ≥1:${candidates.filter(c => c.quality >= 1).length}`);

  candidates.sort((a, b) => b.quality - a.quality);

  // 动态阈值：优先高质量，但至少保留 8 个候选
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
  console.log(`[lyrics:candidates] after tier filter: tier1:${tier1} → top:${topCandidates.length}`);
  topCandidates = topCandidates.slice(0, 10);

  // 验证：拉取歌词原文
  const lyricResults = await Promise.allSettled(topCandidates.map((c) => {
    if (c.source === LyricsSource.QQ) {
      return qqProvider.fetchLyric(c.rawId || c.mid);
    }
    return neProvider.fetchLyric(c.rawId || c.id);
  }));

  const verified = [];
  let emptyCount = 0;
  for (let i = 0; i < topCandidates.length; i++) {
    const c = topCandidates[i];
    const lr = lyricResults[i];
    if (lr.status !== 'fulfilled') continue;
    const { lrc, tlyric } = lr.value;
    if (!lrc.trim()) { emptyCount++; continue; }
    verified.push({ ...c, raw: lrc, tlyric });
  }
  console.log(`[lyrics:candidates] verified: ${verified.length} valid, ${emptyCount} empty, failed:${lyricResults.filter(r => r.status === 'rejected').length}`);
  return verified.slice(0, 12).map((c) => ({ id: c.id, name: c.name, artist: c.artist, quality: c.quality, source: c.source, album_mid: c.album_mid || '' }));
}

/**
 * 按网易云 songId 直接拉取歌词
 */
export async function fetchLyricsById(songId) {
  const neProvider = providerFor(LyricsSource.NE);
  if (!neProvider) throw new Error('网易云 Provider 不可用');
  const { lrc, tlyric } = await neProvider.fetchLyric(songId);
  if (!lrc.trim()) throw new Error('该歌曲暂无歌词');
  return { raw: lrc, tlyric, lines: parseLrcWithTrans(lrc, tlyric) };
}

/**
 * 按 QQ 音乐 songmid 直接拉取歌词
 */
export async function qqFetchLyric(songmid) {
  const qqProvider = providerFor(LyricsSource.QQ);
  if (!qqProvider) throw new Error('QQ 音乐 Provider 不可用');
  const { lrc, tlyric } = await qqProvider.fetchLyric(songmid);
  return { raw: lrc, tlyric };
}
