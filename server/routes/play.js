import express from 'express';
import jwt from 'jsonwebtoken';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { execFile } from 'node:child_process';
import { authRequired } from '../middleware/auth.js';
import { searchVideos, getAudioStream, fetchAudio, getVideoPages, getVideoTitle, getVideoInfo, stripHtml, evictAudioStream } from '../services/bilibili.js';
import { config } from '../config.js';
import db from '../db.js';
import { getCrowdCompletions, crowdBonus } from '../services/crowd.js';

const router = express.Router();

// ---- resolve 结果内存缓存（LRU + TTL，减少重复 B 站搜索） ----
const RESOLVE_CACHE_MAX = 500;         // 最多缓存 500 首歌
const RESOLVE_CACHE_TTL = 5 * 60_000; // 5 分钟过期
const _resolveCache = new Map();       // key → { best, candidates, ts }

function resolveCacheKey(name, singer) {
  return `${(name || '').toLowerCase().trim()}__${(singer || '').toLowerCase().trim()}`;
}

function resolveCacheGet(key) {
  const entry = _resolveCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > RESOLVE_CACHE_TTL) {
    _resolveCache.delete(key);
    return null;
  }
  // LRU：访问时移到末尾
  _resolveCache.delete(key);
  _resolveCache.set(key, entry);
  return entry;
}

function resolveCacheSet(key, best, candidates) {
  // 防止 OOM：超过上限时淘汰最老的条目
  if (_resolveCache.size >= RESOLVE_CACHE_MAX) {
    const oldest = _resolveCache.keys().next().value;
    _resolveCache.delete(oldest);
  }
  _resolveCache.set(key, { best, candidates, ts: Date.now() });
}

// ffmpeg 路径：优先环境变量 FFMPEG_PATH（生产用系统 ffmpeg），回退到 @ffmpeg-installer（本地开发）
let ffmpegPath = process.env.FFMPEG_PATH || '';
if (!ffmpegPath) {
  try {
    const ffmpegInstaller = (await import('@ffmpeg-installer/ffmpeg')).default;
    ffmpegPath = ffmpegInstaller.path;
  } catch {
    ffmpegPath = 'ffmpeg'; // 最后回退到 PATH 中的 ffmpeg
  }
}

// 启动时检查 ffmpeg 是否可用
try {
  if (ffmpegPath !== 'ffmpeg') fs.accessSync(ffmpegPath, fs.constants.X_OK);
  console.log(`[gain] ffmpeg ready: ${ffmpegPath}`);
} catch {
  console.warn('[gain] ⚠️  ffmpeg 不可用！音量归一化分析将无法运行。');
}

// ---- 音量归一化：串行分析队列 ----
const GAIN_TARGET = -18; // LUFS（消费端标准，Apple/SoundCloud 常用）
const GAIN_MIN = 0.05;  // 最多压到 5%
const GAIN_MAX = 10.0;  // 最多放大 10 倍（安全阀在客户端再限一次）

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

function calcGain(lufs) {
  return clamp(10 ** ((GAIN_TARGET - lufs) / 20), GAIN_MIN, GAIN_MAX);
}

let _gainQueue = Promise.resolve();

// 启动时清理残留临时文件
try {
  const tmpFiles = fs.readdirSync('/tmp').filter((f) => f.startsWith('wemusic_gain_'));
  for (const f of tmpFiles) {
    try { fs.unlinkSync(`/tmp/${f}`); } catch {}
  }
  if (tmpFiles.length) console.log(`[gain] cleaned ${tmpFiles.length} leftover temp file(s)`);
} catch {}

function enqueueAnalysis(bvid, cid, streamUrl) {
  _gainQueue = _gainQueue.then(() => runAnalysis(bvid, cid, streamUrl));
}

async function runAnalysis(bvid, cid, streamUrl) {
  const tempPath = `/tmp/wemusic_gain_${bvid}_${cid}_${Date.now()}.mp4`;
  try {
    console.log(`[gain] downloading bvid=${bvid} cid=${cid}`);
    const resp = await fetch(streamUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        Referer: `https://www.bilibili.com/video/${bvid}`,
      },
    });
    if (!resp.ok) throw new Error(`download status ${resp.status}`);
    if (!resp.body) throw new Error('empty body');

    const writer = fs.createWriteStream(tempPath);
    const body = Readable.fromWeb(resp.body);
    await new Promise((resolve, reject) => {
      body.pipe(writer);
      writer.on('finish', resolve);
      writer.on('error', reject);
      body.on('error', reject);
    });
    console.log(`[gain] downloaded ${(fs.statSync(tempPath).size / 1024 / 1024).toFixed(1)}MB bvid=${bvid}`);

    // ffmpeg EBU R128 integrated loudness（ebur128 分析完成后 exit code≠0，但 stderr 中有结果）
    const stderr = await new Promise((resolve, reject) => {
      execFile(ffmpegPath, [
        '-i', tempPath,
        '-af', 'ebur128=video=0',
        '-f', 'null', '-',
      ], { timeout: 120000 }, (err, stdout, stderr) => {
        // ebur128 滤镜完成后 ffmpeg 会以非零码退出，这是正常的——不 reject
        if (err && !stderr) reject(new Error(`ffmpeg: ${err.message}`));
        else resolve(stderr || '');
      });
    });

    // 从 Summary 部分匹配 Integrated loudness 的 I: 值（不是逐帧的实时值）
    const match = stderr.match(/Integrated loudness:\s*\n\s*I:\s*(-?[\d.]+)\s*LUFS/);
    if (!match) throw new Error(`could not parse LUFS (stderr len=${stderr.length})`);

    const lufs = parseFloat(match[1]);
    if (isNaN(lufs)) throw new Error(`invalid LUFS: ${match[1]}`);

    const gain = calcGain(lufs);

    // 尝试获取视频标题
    let title = '';
    try { title = await getVideoTitle(bvid); } catch {}

    db.prepare('UPDATE gain_cache SET gain_lufs=?, gain_mult=?, title=?, status=?, updated_at=? WHERE bvid=? AND cid=?')
      .run(Math.round(lufs * 100) / 100, Math.round(gain * 10000) / 10000, title, 'complete', Date.now(), bvid, cid);
    console.log(`[gain] done bvid=${bvid} cid=${cid} title="${title.slice(0,40)}" lufs=${lufs} gain=${gain.toFixed(4)}`);
  } catch (e) {
    console.warn(`[gain] FAILED bvid=${bvid} cid=${cid}: ${e.message}`);
    db.prepare('UPDATE gain_cache SET status=?, updated_at=? WHERE bvid=? AND cid=?')
      .run('failed', Date.now(), bvid, cid);
  } finally {
    try { fs.unlinkSync(tempPath); } catch {}
  }
}

// 查询某首歌 + 类型被拉黑的源 ID 集合
function getBlockedSet(userId, songKey, type) {
  const rows = db.prepare(`
    SELECT source_id FROM blocked_sources WHERE user_id=? AND song_key=? AND source_type=?
  `).all(userId, songKey, type);
  return new Set(rows.map((r) => r.source_id));
}
// songKey = name__singer，与 play_logs 和 blocked_sources 保持一致
export function songKey(name, singer) { return `${name || ''}__${singer || ''}`; }

// 现场版关键字（直接排除，满足「非现场版」要求）
export const LIVE_KW = [
  '现场', '演唱会', '音乐节', 'live', 'concert', '开演', '演奏会',
  '巡演', 'tour', '现场版', 'livehouse', '路演', '快闪',
];
// 高音质加分词（权重高）
export const HQ_KW = [
  '无损', '無損', 'flac', 'hi-res', 'hires', 'hi res', '母带', '高音质',
  '高品质', 'lossless', 'hifi', 'hi-fi', '24bit', 'dolby', '杜比', 'sq', '臻品',
];
// 一般优质词（权重中上）— MV/官版需要高优先级
export const GOOD_KW = [
  '官方', 'mv', '完整版', 'audio', '原版', '正式版', '官方音频',
];
// 其它降权词（翻唱/二创等）
export const BAD_KW = [
  '翻唱', 'cover', '教学', '钢琴版', '吉他教学', '鬼畜', '剪辑',
  '合集', 'remix', 'dj', '变速', '加速', '慢速', '八音盒', 'ai',
  '空耳', '玩具', '电子琴',
];

// 纯音乐/伴奏/和声版本关键词 — 仅当歌名不含这些词时对视频降权
// 若歌名本身已含这些词（如"xx 伴奏"），则不应用此惩罚（歌名与视频一致，正确匹配）
export const INSTRUMENTAL_VERSION_KW = [
  '纯音乐', '伴奏', '和声', '无人声', 'instrumental', 'karaoke', 'off-vocal',
];

export function isLive(title = '') {
  const t = title.toLowerCase();
  return LIVE_KW.some((k) => t.includes(k.toLowerCase()));
}

/** 歌名是否暗示用户想要现场版（如 "XXX (Live)"、"XXX 现场版"） */
export function songNameSuggestsLive(name = '') {
  if (!name) return false;
  // 只保留最可能出现在歌名中的现场版关键词，避免假匹配
  const SONG_LIVE_KW = ['live', '现场', '演唱会', '现场版'];
  const t = name.toLowerCase();
  return SONG_LIVE_KW.some((k) => t.includes(k.toLowerCase()));
}

// 拆分歌手名为有效片段（用于匹配）
export function singerParts(singer = '') {
  return singer
    .split(/[\/、,&\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length >= 2);
}

// 视频是否属于目标歌手（标题或 UP 名包含歌手名）
export function matchSinger(v, parts) {
  if (!parts.length) return true; // 未提供歌手则不过滤
  const hay = `${v.title || ''} ${v.author || ''}`.toLowerCase();
  return parts.some((p) => hay.includes(p));
}

export function scoreVideo(v, name, singer, expectDur) {
  return Math.round(scoreBreakdown(v, name, singer, expectDur).total);
}

/** 返回评分明细（debug 用），scoreVideo 内部复用此函数 */
function scoreBreakdown(v, name, singer, expectDur) {
  const title = v.title || '';
  const t = title.toLowerCase();
  const bd = {
    nameMatch: 0,
    singerInTitle: 0,
    singerInAuthor: 0,
    durMatch: 0, durDiff: 0,
    playWeight: 0, playCount: v.play || 0,
    hqBonus: 0, hqKw: [],
    officialMV: 0,
    goodKw: 0, goodKwList: [],
    authorMatch: 0,
    badKw: 0, badKwList: [],
    total: 0,
  };

  // — 歌名匹配 —
  if (name && title.includes(name)) bd.nameMatch = 50;
  else if (name) {
    const hit = [...name].filter((c) => title.includes(c)).length;
    bd.nameMatch = Math.round((hit / Math.max(1, name.length)) * 30);
  }

  // — 歌手匹配：标题或 UP 主名包含歌手名 —
  if (singer) {
    const s = singer.split(/[\/、,&]/)[0].trim();
    if (s) {
      if (title.includes(s)) bd.singerInTitle = 30;
      else if ((v.author || '').includes(s)) bd.singerInAuthor = 20;
    }
  }

  // — 时长匹配 —
  if (expectDur > 0 && v.duration > 0) {
    const diff = Math.abs(v.duration - expectDur);
    bd.durDiff = diff;
    if (diff <= 10) bd.durMatch = 40;
    else if (diff <= 25) bd.durMatch = 22;
    else if (diff <= 60) bd.durMatch = 6;
    else bd.durMatch = -25;
  }

  // — 播放量加权（对数尺度，播放越多权重越大，分支更清晰） —
  const pl = v.play || 1;
  if (pl >= 1e7) bd.playWeight = 55;
  else if (pl >= 1e6) bd.playWeight = 40;
  else if (pl >= 1e5) bd.playWeight = 25;
  else if (pl >= 1e4) bd.playWeight = 12;
  else bd.playWeight = Math.round(Math.min(6, Math.log10(pl) * 2.5) * 100) / 100;

  // — 品质信号 —
  for (const k of HQ_KW) {
    if (t.includes(k)) bd.hqKw.push(k);
  }
  if (bd.hqKw.length) bd.hqBonus = 30;

  const isOfficial = t.includes('官方');
  const isMV = t.includes('mv');
  if (isOfficial && isMV) bd.officialMV = 42;
  else if (isOfficial) bd.officialMV = 28;
  else if (isMV) bd.officialMV = 20;

  for (const k of GOOD_KW) {
    if (k === '官方' || k === 'mv') continue;
    if (t.includes(k)) { bd.goodKwList.push(k); bd.goodKw += 10; }
  }

  if (singer && v.author && v.author.toLowerCase() === singer.toLowerCase()) bd.authorMatch = 18;

  // — 降权 —
  for (const k of BAD_KW) {
    if (t.includes(k)) { bd.badKwList.push(k); bd.badKw -= 14; }
  }

  // — 歌名不含纯音乐/伴奏关键词但视频标题含有时降权 —
  // 歌名本身是纯音乐/伴奏时（如"xx 伴奏"），视频标题含同类词是正确匹配，不惩罚
  if (name) {
    const nameLower = name.toLowerCase();
    const songIsInstrumental = INSTRUMENTAL_VERSION_KW.some((k) => nameLower.includes(k.toLowerCase()));
    if (!songIsInstrumental) {
      for (const k of INSTRUMENTAL_VERSION_KW) {
        if (t.includes(k.toLowerCase())) { bd.badKwList.push(k); bd.badKw -= 14; }
      }
    }
  }

  bd.total = bd.nameMatch + bd.singerInTitle + bd.singerInAuthor + bd.durMatch + bd.playWeight + bd.hqBonus + bd.officialMV + bd.goodKw + bd.authorMatch + bd.badKw;
  return bd;
}

// 从歌名中提取「长度 ≥ 2 的片段」（中文按 2 字切，拉丁按单词）
// 用于过滤完全不相关的视频候选
export function nameSegments(name) {
  if (!name) return [];
  // 把字符串切成 中文段（连续汉字）/ 拉丁词（连续字母数字），括号作为分隔符不保留
  const segs = [];
  let buf = '';
  for (const c of name) {
    // 括号字符：结束当前 buffer，不并入任何 segment
    if (/[()（）+]/.test(c)) {
      if (buf.trim()) segs.push(buf.trim());
      buf = '';
      continue;
    }
    if (/[一-龥]/.test(c)) {
      if (/[a-zA-Z0-9]/.test(buf[buf.length - 1] || '')) { segs.push(buf.trim()); buf = ''; }
      buf += c;
    } else {
      if (/[一-龥]/.test(buf[buf.length - 1] || '')) { segs.push(buf.trim()); buf = ''; }
      buf += c;
    }
  }
  if (buf.trim()) segs.push(buf.trim());
  // 中文段 → 拆成 2-gram；拉丁/数字段 → 整段（剔除过短的）
  const out = [];
  for (const s of segs) {
    if (/[一-龥]/.test(s[0])) {
      if (s.length >= 2) {
        for (let i = 0; i <= s.length - 2; i++) out.push(s.slice(i, i + 2));
      } else {
        out.push(s);
      }
    } else {
      if (s.length >= 2) out.push(s.toLowerCase());
    }
  }
  return out;
}

export function rank(videos, name, singer, expectDur, crowdCompletions = null) {
  const parts = singerParts(singer);
  const segs = nameSegments(name);
  // 默认空 Map 兼容单元测试、手动搜索等无众包数据的场景
  const crowd = crowdCompletions || new Map();
  let scored = videos
    // 歌名相关度过滤：歌名中至少一个 ≥2 字符片段必须出现在标题里
    .filter((v) => {
      if (!segs.length) return true;
      const t = (v.title || '').toLowerCase();
      return segs.some((s) => t.includes(s.toLowerCase()));
    })
    .map((v) => ({
      ...v,
      live: isLive(v.title),
      hq: HQ_KW.some((k) => (v.title || '').toLowerCase().includes(k.toLowerCase())),
      singerOk: matchSinger(v, parts),
      score: scoreVideo(v, name, singer, expectDur) + crowdBonus(crowd.get(v.bvid), 5),
    }));

  // 歌手准确性优先级最高：只要有该歌手的版本，就只保留该歌手的，过滤掉原唱/他人翻唱
  if (parts.length) {
    const matched = scored.filter((v) => v.singerOk);
    if (matched.length) scored = matched;
  }

  // 歌名暗示现场版：现场版不但不受惩罚，反而获得提权加分（+30）
  // 因为这类歌曲（如 "XXX (Live)"）的现场版就是正确答案
  const nameSuggestsLive = songNameSuggestsLive(name);
  if (nameSuggestsLive) {
    scored = scored.map((v) => ({
      ...v,
      score: v.live ? v.score + 30 : v.score,
    }));
  }

  // 其次：非现场优先，再按综合分（高音质 + 高播放量 + 时长接近）
  scored.sort((a, b) => {
    if (!nameSuggestsLive && a.live !== b.live) return a.live ? 1 : -1;
    return b.score - a.score;
  });
  return scored;
}

/**
 * 为一首歌匹配最佳 Bilibili 视频（含 debug 信息）
 * body: { name, singer, duration }
 */
router.post('/resolve', authRequired, async (req, res) => {
  const { name, singer = '', duration = 0 } = req.body || {};
  if (!name) return res.status(400).json({ error: '缺少歌曲名' });
  const t0 = Date.now();

  // — 内存缓存检查（同首歌 5 分钟内再次 resolve 直接返回） —
  const cacheKey = resolveCacheKey(name, singer);
  const cached = resolveCacheGet(cacheKey);
  if (cached) {
    console.log(`[resolve:cache] HIT "${name}" / "${singer}" → ${cached.candidates.length} candidates (${Date.now() - t0}ms)`);
    return res.json({ best: cached.best, candidates: cached.candidates.slice(0, 25), _debug: { cached: true, cacheAge: Date.now() - cached.ts } });
  }

  try {
    const singerPartsVal = singerParts(singer);  // 小写，用于匹配（debug + singer filter）
    // singerFirst/singerRest 用于搜索 query，需要保留原始大小写。
    // 歌手名可能是"英文名 中文名"组合（如 "G.E.M. 邓紫棋"），B 站视频标题/UP 名对哪个片段
    // 索引权重更高因人而异（小众翻唱视频常只写中文名），因此每个片段都要单独生成一组 query，
    // 不能只取第一段——这是本项目一次真实漏召 bug 的根因（"邓紫棋翻唱王菲【我愿意】"只搜 "G.E.M." 系列词永远搜不到）。
    const singerQueryParts = (singer || '').split(/[\/、,&\s]+/).map(s => s.trim()).filter(s => s.length >= 2);
    const singerFirstForQuery = singerQueryParts[0] || '';
    const singerExtraForQuery = singerQueryParts.slice(1).filter(
      (p) => p.toLowerCase() !== singerFirstForQuery.toLowerCase()
    );
    // 提取括号内的中文名（如 "El Hombre (笑面人)" → "笑面人"），作为额外搜索词
    const bracketCN = (name.match(/[（(]([^)）]+)[）)]/) || [])[1] || '';

    const debug = {
      input: { name, singer: singer || '', duration: duration || 0, singerFirst: singerFirstForQuery, singerExtra: singerExtraForQuery, bracketCN },
      queries: [],
      wave1: null,
      wave2: null,
      totalRaw: 0,
      rankDebug: null,
      topSamples: [],
      blockedCount: 0,
      cleanCount: 0,
    };

    // 分层并行查询：Wave 1 — 全部 query 首页并行打出；Wave 2 — 不够时再补第二页
    // 方案 A 优化：去掉反序 query（`singerFirst name`），保留 4 条核心 query + 歌手片段补查
    const queries = [];
    if (singerFirstForQuery) {
      queries.push(`${name} ${singerFirstForQuery}`);
      queries.push(`${name} ${singerFirstForQuery} MV`);
      queries.push(`${name} ${singerFirstForQuery} 官方`);
    }
    queries.push(name);
    // 歌手名其余片段（如中英文名并存时的中文名）各补一条纯查询，覆盖只索引到该片段的小众视频
    for (const extra of singerExtraForQuery) queries.push(`${name} ${extra}`);
    if (bracketCN && singerFirstForQuery) queries.push(`${bracketCN} ${singerFirstForQuery}`);
    if (bracketCN) queries.push(bracketCN);
    debug.queries = [...queries];

    const seen = new Set();
    let all = [];

    // Wave 1：所有 query × page 1 并行请求
    const tW1 = Date.now();
    const w1 = await Promise.allSettled(queries.map((q) => searchVideos(q, 1, 20)));
    const w1Counts = [];
    let w1TotalBeforeDedup = 0;
    for (let i = 0; i < w1.length; i++) {
      const r = w1[i];
      const cnt = r.status === 'fulfilled' ? r.value.length : 0;
      w1TotalBeforeDedup += cnt;
      w1Counts.push({ query: queries[i], status: r.status === 'fulfilled' ? 'ok' : 'rejected', resultCount: cnt });
      if (r.status !== 'fulfilled') continue;
      for (const v of r.value) {
        if (seen.has(v.bvid)) continue;
        seen.add(v.bvid);
        all.push(v);
      }
    }
    debug.wave1 = { queries: w1Counts, totalBeforeDedup: w1TotalBeforeDedup, totalAfterDedup: all.length };
    const w1Ms = Date.now() - tW1;

    // Wave 2：如果还不够 80 条，所有 query × page 2 并行请求
    let w2Ms = 0;
    if (all.length < 80) {
      const tW2 = Date.now();
      const w2 = await Promise.allSettled(queries.map((q) => searchVideos(q, 2, 20)));
      const w2Counts = [];
      let w2TotalBeforeDedup = 0;
      for (let i = 0; i < w2.length; i++) {
        const r = w2[i];
        const cnt = r.status === 'fulfilled' ? r.value.length : 0;
        w2TotalBeforeDedup += cnt;
        w2Counts.push({ query: queries[i], status: r.status === 'fulfilled' ? 'ok' : 'rejected', resultCount: cnt });
        if (r.status !== 'fulfilled') continue;
        for (const v of r.value) {
          if (seen.has(v.bvid)) continue;
          seen.add(v.bvid);
          all.push(v);
        }
      }
      debug.wave2 = { queries: w2Counts, totalBeforeDedup: w2TotalBeforeDedup, totalAfterDedup: all.length };
      w2Ms = Date.now() - tW2;
    }

    debug.totalRaw = all.length;

    if (all.length === 0) {
      const allFailed = w1.every((r) => r.status === 'rejected');
      if (allFailed) return res.status(502).json({ error: 'Bilibili 暂时被风控，请稍后重试（点播放或换源重试）' });
      return res.status(404).json({ error: '未在 Bilibili 找到该歌曲的视频' });
    }

    console.log(`[resolve:search] "${name}" / "${singerFirstForQuery}" — ${all.length} raw (W1:${w1Ms}ms${w2Ms ? ', W2:' + w2Ms + 'ms' : ''}, ${queries.length}q)`);

    const sk = songKey(name, singer);
    const videoCompletions = getCrowdCompletions('video', sk);
    const tRank = Date.now();
    const ranked = rank(all, name, singer, duration, videoCompletions);
    const rankMs = Date.now() - tRank;

    // 收集 rank 内部的 debug 信息
    const segs = nameSegments(name);
    const crowd = videoCompletions || new Map();

    // 重放 segment 过滤（计算过滤前后数量 + 收集被过滤掉的视频样例）
    const afterSegFilter = [];
    const filteredOut = [];
    if (segs.length) {
      for (const v of all) {
        const t = (v.title || '').toLowerCase();
        if (segs.some(s => t.includes(s.toLowerCase()))) afterSegFilter.push(v);
        else filteredOut.push(v);
      }
    } else {
      afterSegFilter.push(...all);
    }

    // 重放 singer 过滤
    let singerFilterCount = afterSegFilter.length;
    let singerOkSamples = [], singerNotOkSamples = [];
    if (singerPartsVal.length) {
      const singerOk = [], singerNotOk = [];
      for (const v of afterSegFilter) {
        if (matchSinger(v, singerPartsVal)) singerOk.push(v);
        else singerNotOk.push(v);
      }
      if (singerOk.length) {
        singerFilterCount = singerOk.length;
        singerOkSamples = singerOk.map(v => ({ title: v.title, author: v.author || '' }));
        singerNotOkSamples = singerNotOk.map(v => ({ title: v.title, author: v.author || '' }));
      }
    }

    const nameSuggestsLive = songNameSuggestsLive(name);

    debug.rankDebug = {
      segs: [...segs],
      beforeSegFilter: all.length,
      afterSegFilter: afterSegFilter.length,
      afterSegSamples: afterSegFilter.map(v => ({ title: v.title, author: v.author || '' })),
      filteredOutSamples: filteredOut.map(v => ({ title: v.title, author: v.author || '' })),
      singerParts: [...singerPartsVal],
      singerFiltered: singerPartsVal.length > 0 && singerFilterCount !== afterSegFilter.length,
      afterSingerFilter: singerFilterCount,
      singerOkSamples,
      singerNotOkSamples,
      nameSuggestsLive,
      scoredCount: ranked.length,
    };

    // 取 top 5 的评分明细
    debug.topSamples = ranked.slice(0, 5).map(v => {
      const bd = scoreBreakdown(v, name, singer, duration);
      return {
        bvid: v.bvid,
        title: v.title.slice(0, 60),
        author: v.author || '',
        play: v.play || 0,
        duration: v.duration,
        score: v.score,
        live: v.live,
        singerOk: v.singerOk,
        breakdown: bd,
      };
    });

    console.log(`[resolve:rank] ${ranked.length} scored (rank:${rankMs}ms, crowd:${videoCompletions.size}sources), blocked:${getBlockedSet(req.user.id, sk, 'video').size}`);

    // 过滤掉用户已拉黑的视频源
    const blocked = getBlockedSet(req.user.id, songKey(name, singer), 'video');
    debug.blockedCount = blocked.size;
    const clean = ranked.filter((v) => !blocked.has(v.bvid));
    debug.cleanCount = clean.length;

    if (clean.length === 0) {
      return res.status(404).json({ error: '所有候选视频均已被屏蔽，如需解除请刷新页面后重新搜索' });
    }
    const nameImpliesLive = songNameSuggestsLive(name);
    const best = nameImpliesLive ? clean[0] : (clean.find((v) => !v.live) || clean[0]);

    // — 写入内存缓存 —
    resolveCacheSet(cacheKey, best, clean.slice(0, 25));

    const totalMs = Date.now() - t0;
    console.log(`[resolve:done] "${name}" / "${singerFirstForQuery}" → ${clean.length} candidates, best="${(best.title || '').slice(0, 40)}", total=${totalMs}ms (search:${w1Ms + w2Ms}ms rank:${rankMs}ms cache:0ms)`);
    res.json({ best, candidates: clean.slice(0, 25), _debug: debug });
  } catch (e) {
    console.log(`[resolve:fail] "${name}" / "${singer || ''}" — ${Date.now() - t0}ms: ${e.message}`);
    res.status(502).json({ error: e.message });
  }
});

/**
 * 自由关键字搜索 Bilibili（手动换源用）
 */
router.get('/search', authRequired, async (req, res) => {
  const keyword = req.query.keyword || '';
  const songName = req.query.name || '';
  const songSinger = req.query.singer || '';
  if (!keyword && !songName) return res.status(400).json({ error: '请输入关键字' });
  try {
    const searchKw = keyword || `${songName} ${songSinger}`;
    // 搜索 2 页并行（共 40 条），增加候选丰富度
    const searches = [
      searchVideos(searchKw, 1, 20),
      searchVideos(searchKw, 2, 20),
    ];
    // 追加纯歌名搜索：覆盖标题只含歌名不含歌手的翻唱视频（如「邓紫棋翻唱王菲【我愿意】」）
    if (songName && songName !== searchKw) {
      searches.push(searchVideos(songName, 1, 20));
      searches.push(searchVideos(songName, 2, 20));
    }
    // 歌手名逐片段补查："英文名 中文名"组合歌手（如 "G.E.M. 邓紫棋"）拼成一个词搜索会被稀释，
    // B 站对小众翻唱视频常只索引到其中一个片段，因此每个 ≥2 字符片段都单独配歌名搜一次。
    if (songName && songSinger) {
      const singerFrags = songSinger.split(/[\/、,&\s]+/).map(s => s.trim()).filter(s => s.length >= 2);
      for (const frag of singerFrags) {
        const fragKw = `${songName} ${frag}`;
        if (fragKw === searchKw) continue;
        searches.push(searchVideos(fragKw, 1, 20));
      }
    }
    const results = await Promise.allSettled(searches);
    const seen = new Set();
    const all = [];
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      for (const v of r.value) {
        if (seen.has(v.bvid)) continue;
        seen.add(v.bvid);
        all.push(v);
      }
    }
    // 关键：rank 时只对【歌名】做片段过滤，避免歌手名片段绕过过滤
    const sk = songKey(songName, songSinger);
    const videoCompletions = getCrowdCompletions('video', sk);
    const ranked = rank(all, songName, songSinger, 0, videoCompletions);
    // 过滤被拉黑的视频源
    const blocked = getBlockedSet(req.user.id, sk, 'video');
    const clean = ranked.filter((v) => !blocked.has(v.bvid));

    // 手动搜索的 debug（精简版）
    const segs = nameSegments(songName);
    const afterSegFilter = [];
    const filteredOut = [];
    if (segs.length) {
      for (const v of all) {
        const t = (v.title || '').toLowerCase();
        if (segs.some(s => t.includes(s.toLowerCase()))) afterSegFilter.push(v);
        else filteredOut.push(v);
      }
    } else { afterSegFilter.push(...all); }
    const parts = singerParts(songSinger);
    let singerFilterCount = afterSegFilter.length;
    const singerOkSamples = [], singerNotOkSamples = [];
    if (parts.length) {
      const so = [], sno = [];
      for (const v of afterSegFilter) {
        if (matchSinger(v, parts)) so.push(v); else sno.push(v);
      }
      if (so.length) {
        singerFilterCount = so.length;
        singerOkSamples.push(...so.map(v => ({ title: v.title, author: v.author || '' })));
        singerNotOkSamples.push(...sno.map(v => ({ title: v.title, author: v.author || '' })));
      }
    }
    const debug = {
      input: { searchKw, name: songName, singer: songSinger },
      totalRaw: all.length,
      rankDebug: {
        segs: [...segs],
        beforeSegFilter: all.length,
        afterSegFilter: afterSegFilter.length,
        afterSegSamples: afterSegFilter.map(v => ({ title: v.title, author: v.author || '' })),
        filteredOutSamples: filteredOut.map(v => ({ title: v.title, author: v.author || '' })),
        singerParts: [...parts],
        singerFiltered: parts.length > 0 && singerFilterCount !== afterSegFilter.length,
        afterSingerFilter: singerFilterCount,
        singerOkSamples,
        singerNotOkSamples,
        scoredCount: ranked.length,
      },
      topSamples: ranked.slice(0, 5).map(v => {
        const bd = scoreBreakdown(v, songName, songSinger, 0);
        return { bvid: v.bvid, title: v.title.slice(0, 60), author: v.author || '', play: v.play || 0, duration: v.duration, score: v.score, live: v.live, singerOk: v.singerOk, breakdown: bd };
      }),
      blockedCount: blocked.size,
      cleanCount: clean.length,
    };
    res.json({ candidates: clean, _debug: debug });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

/**
 * 查询单个视频元数据（换源弹窗补查当前播放 bvid 用）
 * GET /api/play/video?bvid=BVxxx
 */
router.get('/video', authRequired, async (req, res) => {
  const { bvid } = req.query;
  if (!bvid) return res.status(400).json({ error: '缺少 bvid' });
  try {
    const info = await getVideoInfo(bvid);
    if (!info) return res.status(404).json({ error: '视频不存在' });
    res.json(info);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

/**
 * 音频流代理：<audio> 标签据此播放，由后端带 Referer 拉取 B 站音频。
 * <audio> 标签无法携带 Authorization 头，故通过查询参数传递 token。
 * 未传 token 时允许访问（兼容直接访问），但建议前端传参以防滥用。
 * GET /api/play/stream?bvid=BVxxx[&cid=xxx][&token=xxx]
 *
 * 同时触发音量归一化分析：DB 中无此 bvid+cid 的 gain → 后台异步下载完整文件 → ffprobe 分析
 */
router.get('/stream', async (req, res) => {
  const { bvid, cid, token } = req.query;
  if (!bvid) return res.status(400).send('缺少 bvid');

  // token 可选认证：验证通过则记录 user_id 用于日志
  let userId = null;
  if (token) {
    try {
      const decoded = jwt.verify(token, config.jwtSecret);
      userId = decoded.id;
    } catch { /* token 无效，不拒绝，仅不记录用户 */ }
  }

  console.log(`[bg:stream] request bvid=${bvid} range=${req.headers.range || 'none'} user=${userId || 'anon'}`);
  try {
    const stream = await getAudioStream(bvid, cid ? Number(cid) : undefined);
    const resolvedCid = stream.cid;
    const range = req.headers.range;
    const upstream = await fetchAudio(stream.url, bvid, range);

    if (!upstream.ok && upstream.status !== 206 && upstream.status !== 200) {
      // 主地址失败：缓存的直链可能已失效，清掉避免在 TTL 内反复返回死链接
      evictAudioStream(bvid, resolvedCid);
      // 尝试备用地址
      const backup = stream.backup && stream.backup[0];
      if (backup) {
        console.log(`[bg:stream] primary failed (${upstream.status}), trying backup`);
        const up2 = await fetchAudio(backup, bvid, range);
        return pipeAudio(up2, res, stream.mime);
      }
      console.warn(`[bg:stream] FAILED bvid=${bvid} status=${upstream.status}`);
      return res.status(502).send('音频拉取失败');
    }

    // 音量归一化：DB 中无此 bvid+cid 的 gain → 触发后台异步分析
    const row = db.prepare('SELECT status FROM gain_cache WHERE bvid = ? AND cid = ?').get(bvid, resolvedCid);
    if (!row || row.status === 'failed') {
      const now = Date.now();
      db.prepare('INSERT OR REPLACE INTO gain_cache (bvid, cid, gain_mult, status, created_at, updated_at) VALUES (?, ?, 1.0, ?, ?, ?)')
        .run(bvid, resolvedCid, 'pending', now, now);
      // 异步分析，不阻塞客户端播放。注意：分析使用独立的 B站 fetch（无 Range），与客户端 stream 互不影响
      enqueueAnalysis(bvid, resolvedCid, stream.url);
    }

    console.log(`[bg:stream] piping bvid=${bvid} status=${upstream.status} size=${upstream.headers.get('content-length') || '?'}`);
    pipeAudio(upstream, res, stream.mime);
  } catch (e) {
    console.warn(`[bg:stream] ERROR bvid=${bvid}: ${e.message}`);
    res.status(502).send(e.message);
  }
});

/**
 * 直连播放地址：只返回 B 站 CDN 真实直链，不做服务端代理转发。
 * 客户端（bgAudio）优先尝试直接播放此地址；若播放失败（CORS/风控节点差异），
 * 前端会自动 fallback 到 /api/play/stream 代理地址。
 * GET /api/play/direct-url?bvid=BVxxx[&cid=xxx]
 * → { url, backup, cid, mime, expiresAt }
 *
 * 与 /stream 一样触发音量归一化分析（因为客户端直连时不会经过 /stream）。
 */
router.get('/direct-url', authRequired, async (req, res) => {
  const { bvid, cid } = req.query;
  if (!bvid) return res.status(400).json({ error: '缺少 bvid' });
  try {
    const stream = await getAudioStream(bvid, cid ? Number(cid) : undefined);
    const resolvedCid = stream.cid;

    // 音量归一化：DB 中无此 bvid+cid 的 gain → 触发后台异步分析（逻辑与 /stream 一致）
    const row = db.prepare('SELECT status FROM gain_cache WHERE bvid = ? AND cid = ?').get(bvid, resolvedCid);
    if (!row || row.status === 'failed') {
      const now = Date.now();
      db.prepare('INSERT OR REPLACE INTO gain_cache (bvid, cid, gain_mult, status, created_at, updated_at) VALUES (?, ?, 1.0, ?, ?, ?)')
        .run(bvid, resolvedCid, 'pending', now, now);
      enqueueAnalysis(bvid, resolvedCid, stream.url);
    }

    // deadline 参数（若存在）解析为过期时间，供前端判断直链是否临近过期
    let expiresAt = null;
    try {
      const m = stream.url.match(/deadline=(\d+)/);
      if (m) expiresAt = Number(m[1]) * 1000;
    } catch { /* 忽略解析失败 */ }

    console.log(`[play:direct-url] bvid=${bvid} cid=${resolvedCid}`);
    res.json({ url: stream.url, backup: stream.backup || [], cid: resolvedCid, mime: stream.mime, expiresAt });
  } catch (e) {
    console.warn(`[play:direct-url] ERROR bvid=${bvid}: ${e.message}`);
    res.status(502).json({ error: e.message });
  }
});

/**
 * 查询音量归一化 gain。
 * GET /api/gain?bvid=BVxxx
 * → { gain: 0.47, status: "complete" }  // 已有分析结果
 * → { gain: null, status: "pending" }     // 分析中
 * → { gain: null, status: null }          // 无记录
 */
router.get('/gain', async (req, res) => {
  const { bvid } = req.query;
  if (!bvid) return res.json({ gain: null, status: null });

  // 从 bvid 解析 cid（服务端自动取第一 P）
  let cid = 0;
  try {
    const pages = await getVideoPages(bvid);
    cid = pages[0]?.cid || 0;
  } catch { /* 不阻塞：cid 为 0 也能查 */ }

  const row = db.prepare('SELECT gain_mult, status FROM gain_cache WHERE bvid = ? AND cid = ?').get(bvid, cid);
  if (!row) return res.json({ gain: null, status: null });
  if (row.status === 'complete') return res.json({ gain: row.gain_mult, status: row.status });
  return res.json({ gain: null, status: row.status });
});

/**
 * 列出所有已分析的 gain 记录。
 * GET /api/play/gains
 */
router.get('/gains', (req, res) => {
  const rows = db.prepare(`
    SELECT bvid, cid, title, gain_lufs, gain_mult, status, created_at, updated_at
    FROM gain_cache ORDER BY updated_at DESC
  `).all();
  const now = Date.now();
  const latest = rows[0]; // 最新一条
  const counts = { complete: 0, pending: 0, failed: 0 };
  for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1;
  const fmtTime = (ts) => new Date(ts).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  res.json({
    total: rows.length,
    counts,
    latest: latest
      ? { bvid: latest.bvid, cid: latest.cid, title: latest.title, lufs: latest.gain_lufs, gain: latest.gain_mult, status: latest.status, updated: fmtTime(latest.updated_at) }
      : null,
    items: rows.map((r) => ({
      bvid: r.bvid, cid: r.cid, title: r.title,
      lufs: r.gain_lufs, gain: r.gain_mult, status: r.status,
      updated: fmtTime(r.updated_at),
    })),
  });
});

function pipeAudio(upstream, res, mime) {
  res.status(upstream.status);
  const passHeaders = ['content-length', 'content-range', 'accept-ranges', 'content-type'];
  for (const h of passHeaders) {
    const v = upstream.headers.get(h);
    if (v) res.setHeader(h, v);
  }
  if (!upstream.headers.get('content-type')) {
    res.setHeader('Content-Type', mime || 'audio/mp4');
  }
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'no-store');
  if (upstream.body) {
    const stream = Readable.fromWeb(upstream.body);
    stream.on('error', () => { if (!res.headersSent) res.status(502).end('流中断'); });
    res.on('error', () => stream.destroy());
    stream.pipe(res);
  } else {
    res.end();
  }
}

export default router;
