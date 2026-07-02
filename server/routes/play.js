import express from 'express';
import { Readable } from 'node:stream';
import { authRequired } from '../middleware/auth.js';
import { searchVideos, getAudioStream, fetchAudio } from '../services/bilibili.js';
import db from '../db.js';

const router = express.Router();

// 查询某首歌 + 类型被拉黑的源 ID 集合
function getBlockedSet(userId, songKey, type) {
  const rows = db.prepare(`
    SELECT source_id FROM blocked_sources WHERE user_id=? AND song_key=? AND source_type=?
  `).all(userId, songKey, type);
  return new Set(rows.map((r) => r.source_id));
}
// songKey = name__singer，与 play_logs 和 blocked_sources 保持一致
function songKey(name, singer) { return `${name || ''}__${singer || ''}`; }

// 现场版关键字（直接排除，满足「非现场版」要求）
const LIVE_KW = [
  '现场', '演唱会', '音乐节', 'live', 'concert', '开演', '演奏会',
  '巡演', 'tour', '现场版', 'livehouse', '路演', '快闪',
];
// 直接过滤掉的关键词（伴奏等，剔除而非降权）
const EXCLUDE_KW = ['伴奏', '純音樂', '纯音乐', 'instrumental', 'karaoke', '消音', '人声消除'];
// 高音质加分词（权重高）
const HQ_KW = [
  '无损', '無損', 'flac', 'hi-res', 'hires', 'hi res', '母带', '高音质',
  '高品质', 'lossless', 'hifi', 'hi-fi', '24bit', 'dolby', '杜比', 'sq', '臻品',
];
// 一般优质词（权重中上）— MV/官版需要高优先级
const GOOD_KW = [
  '官方', 'mv', '完整版', 'audio', '原版', '正式版', '官方音频',
];
// 其它降权词（翻唱/二创等）
const BAD_KW = [
  '翻唱', 'cover', '教学', '钢琴版', '吉他教学', '鬼畜', '剪辑',
  '合集', 'remix', 'dj', '变速', '加速', '慢速', '八音盒', 'ai',
  '空耳', '玩具', '电子琴',
];

function isLive(title = '') {
  const t = title.toLowerCase();
  return LIVE_KW.some((k) => t.includes(k.toLowerCase()));
}

// 是否应被直接过滤（含「伴奏」等）
function isExcluded(title = '') {
  const t = title.toLowerCase();
  return EXCLUDE_KW.some((k) => t.includes(k.toLowerCase()));
}

// 拆分歌手名为有效片段（用于匹配）
function singerParts(singer = '') {
  return singer
    .split(/[\/、,&\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length >= 2);
}

// 视频是否属于目标歌手（标题或 UP 名包含歌手名）
function matchSinger(v, parts) {
  if (!parts.length) return true; // 未提供歌手则不过滤
  const hay = `${v.title || ''} ${v.author || ''}`.toLowerCase();
  return parts.some((p) => hay.includes(p));
}

function scoreVideo(v, name, singer, expectDur) {
  const title = v.title || '';
  const t = title.toLowerCase();
  let score = 0;

  // — 歌名匹配 —
  if (name && title.includes(name)) score += 50;
  else if (name) {
    const hit = [...name].filter((c) => title.includes(c)).length;
    score += Math.round((hit / Math.max(1, name.length)) * 30);
  }

  // — 歌手匹配：标题或 UP 主名包含歌手名 —
  if (singer) {
    const s = singer.split(/[\/、,&]/)[0].trim();
    if (s) {
      if (title.includes(s)) score += 30;
      else if ((v.author || '').includes(s)) score += 20;
    }
  }

  // — 时长匹配 —
  if (expectDur > 0 && v.duration > 0) {
    const diff = Math.abs(v.duration - expectDur);
    if (diff <= 10) score += 40;
    else if (diff <= 25) score += 22;
    else if (diff <= 60) score += 6;
    else score -= 25;
  }

  // — 播放量加权（对数尺度，播放越多权重越大，分支更清晰） —
  const pl = v.play || 1;
  if (pl >= 1e7) score += 55;
  else if (pl >= 1e6) score += 40;
  else if (pl >= 1e5) score += 25;
  else if (pl >= 1e4) score += 12;
  else score += Math.min(6, Math.log10(pl) * 2.5);

  // — 品质信号 —
  // 高音质关键词：大幅加分（无损/母带等）
  if (HQ_KW.some((k) => t.includes(k))) score += 30;
  // 官方 MV 是最高优先级信号（单独判断，比通用 GOOD_KW 更重）
  const isOfficial = t.includes('官方');
  const isMV = t.includes('mv');
  if (isOfficial && isMV) score += 42;  // 官方 MV 最高
  else if (isOfficial) score += 28;       // 官方（非 MV）
  else if (isMV) score += 20;             // MV（非官方标注）
  // 其它优质信号
  for (const k of GOOD_KW) {
    if (k === '官方' || k === 'mv') continue; // 已单独处理
    if (t.includes(k)) score += 10;
  }
  // UP 主名完全匹配歌手名 → 可能是官方频道
  if (singer && v.author && v.author.toLowerCase() === singer.toLowerCase()) score += 18;

  // — 降权 —
  for (const k of BAD_KW) if (t.includes(k)) score -= 14;

  return Math.round(score);
}

// 从歌名中提取「长度 ≥ 2 的片段」（中文按 2 字切，拉丁按单词）
// 用于过滤完全不相关的视频候选
function nameSegments(name) {
  if (!name) return [];
  // 把字符串切成 中文段（连续汉字）/ 拉丁词（连续字母数字），括号作为分隔符不保留
  const segs = [];
  let buf = '';
  for (const c of name) {
    // 括号字符：结束当前 buffer，不并入任何 segment
    if (/[()（）]/.test(c)) {
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

function rank(videos, name, singer, expectDur) {
  const parts = singerParts(singer);
  const segs = nameSegments(name);
  let scored = videos
    .filter((v) => !isExcluded(v.title))
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
      score: scoreVideo(v, name, singer, expectDur),
    }));

  // 歌手准确性优先级最高：只要有该歌手的版本，就只保留该歌手的，过滤掉原唱/他人翻唱
  if (parts.length) {
    const matched = scored.filter((v) => v.singerOk);
    if (matched.length) scored = matched;
  }

  // 其次：非现场优先，再按综合分（高音质 + 高播放量 + 时长接近）
  scored.sort((a, b) => {
    if (a.live !== b.live) return a.live ? 1 : -1;
    return b.score - a.score;
  });
  return scored;
}

/**
 * 为一首歌匹配最佳 Bilibili 视频
 * body: { name, singer, duration }
 */
router.post('/resolve', authRequired, async (req, res) => {
  const { name, singer = '', duration = 0 } = req.body || {};
  if (!name) return res.status(400).json({ error: '缺少歌曲名' });
  try {
    const singerFirst = singer.split(/[\/、,&]/)[0].trim();
    // 提取括号内的中文名（如 "El Hombre (笑面人)" → "笑面人"），作为额外搜索词
    const bracketCN = (name.match(/[（(]([^)）]+)[）)]/) || [])[1] || '';
    // 分层并行查询：Wave 1 — 全部 query 首页并行打出；Wave 2 — 不够时再补第二页
    const queries = [];
    if (singerFirst) {
      queries.push(`${name} ${singerFirst}`);
      queries.push(`${name} ${singerFirst} MV`);
      queries.push(`${name} ${singerFirst} 官方`);
    }
    queries.push(name);
    if (singerFirst) queries.push(`${singerFirst} ${name}`);
    // 括号内中文名 + 歌手作为兜底（如 "笑面人 G.E.M. 邓紫棋"）
    if (bracketCN && singerFirst) queries.push(`${bracketCN} ${singerFirst}`);
    if (bracketCN) queries.push(bracketCN);

    const seen = new Set();
    let all = [];

    // Wave 1：所有 query × page 1 并行请求
    const w1 = await Promise.allSettled(queries.map((q) => searchVideos(q, 1, 20)));
    for (const r of w1) {
      if (r.status !== 'fulfilled') continue;
      for (const v of r.value) {
        if (seen.has(v.bvid)) continue;
        seen.add(v.bvid);
        all.push(v);
      }
    }

    // Wave 2：如果还不够 80 条，所有 query × page 2 并行请求
    if (all.length < 80) {
      const w2 = await Promise.allSettled(queries.map((q) => searchVideos(q, 2, 20)));
      for (const r of w2) {
        if (r.status !== 'fulfilled') continue;
        for (const v of r.value) {
          if (seen.has(v.bvid)) continue;
          seen.add(v.bvid);
          all.push(v);
        }
      }
    }

    if (all.length === 0) {
      const allFailed = w1.every((r) => r.status === 'rejected');
      if (allFailed) return res.status(502).json({ error: 'Bilibili 暂时被风控，请稍后重试（点播放或换源重试）' });
      return res.status(404).json({ error: '未在 Bilibili 找到该歌曲的视频' });
    }

    console.log(`[video:resolve] "${name}" / "${singerFirst}" — ${all.length} raw results (W1:${w1.filter(r=>r.status==='fulfilled').length}q), segs:${nameSegments(name).join('|')}`);

    const ranked = rank(all, name, singer, duration);
    console.log(`[video:resolve] after rank: ${ranked.length} scored, blocked:${getBlockedSet(req.user.id, songKey(name, singer), 'video').size}`);

    // 过滤掉用户已拉黑的视频源
    const blocked = getBlockedSet(req.user.id, songKey(name, singer), 'video');
    const clean = ranked.filter((v) => !blocked.has(v.bvid));
    if (clean.length === 0) {
      return res.status(404).json({ error: '所有候选视频均已被屏蔽，如需解除请刷新页面后重新搜索' });
    }
    // best 也应该从干净列表里选，避免自动播放到已拉黑的源
    const best = clean.find((v) => !v.live) || clean[0];
    const top5 = clean.slice(0, 5).map((v) => `[${v.score}] ${v.title.slice(0,40)} live:${v.live}`).join(' | ');
    console.log(`[video:resolve] top5 after clean: ${top5}`);
    res.json({ best, candidates: clean.slice(0, 25) });
  } catch (e) {
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
    const [r1, r2] = await Promise.allSettled([
      searchVideos(searchKw, 1, 20),
      searchVideos(searchKw, 2, 20),
    ]);
    const seen = new Set();
    const all = [];
    for (const r of [r1, r2]) {
      if (r.status !== 'fulfilled') continue;
      for (const v of r.value) {
        if (seen.has(v.bvid)) continue;
        seen.add(v.bvid);
        all.push(v);
      }
    }
    // 关键：rank 时只对【歌名】做片段过滤，避免歌手名片段绕过过滤
    const ranked = rank(all, songName, songSinger, 0);
    // 过滤被拉黑的视频源
    const blocked = getBlockedSet(req.user.id, songKey(songName, songSinger), 'video');
    const clean = ranked.filter((v) => !blocked.has(v.bvid));
    res.json({ candidates: clean });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

/**
 * 音频流代理：<audio> 标签据此播放，由后端带 Referer 拉取 B 站音频。
 * 注意：<audio> 无法携带 Authorization 头，故此端点不强制鉴权（仅代理公开内容，本地单用户场景）。
 * GET /api/play/stream?bvid=BVxxx[&cid=xxx]
 */
router.get('/stream', async (req, res) => {
  const { bvid, cid } = req.query;
  if (!bvid) return res.status(400).send('缺少 bvid');
  console.log(`[bg:stream] request bvid=${bvid} range=${req.headers.range || 'none'}`);
  try {
    const stream = await getAudioStream(bvid, cid ? Number(cid) : undefined);
    const range = req.headers.range;
    const upstream = await fetchAudio(stream.url, bvid, range);

    if (!upstream.ok && upstream.status !== 206 && upstream.status !== 200) {
      // 主地址失败则尝试备用地址
      const backup = stream.backup && stream.backup[0];
      if (backup) {
        console.log(`[bg:stream] primary failed (${upstream.status}), trying backup`);
        const up2 = await fetchAudio(backup, bvid, range);
        return pipeAudio(up2, res, stream.mime);
      }
      console.warn(`[bg:stream] FAILED bvid=${bvid} status=${upstream.status}`);
      return res.status(502).send('音频拉取失败');
    }
    console.log(`[bg:stream] piping bvid=${bvid} status=${upstream.status} size=${upstream.headers.get('content-length') || '?'}`);
    pipeAudio(upstream, res, stream.mime);
  } catch (e) {
    console.warn(`[bg:stream] ERROR bvid=${bvid}: ${e.message}`);
    res.status(502).send(e.message);
  }
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
