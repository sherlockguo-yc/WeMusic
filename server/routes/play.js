import express from 'express';
import { Readable } from 'node:stream';
import { authRequired } from '../middleware/auth.js';
import { searchVideos, getAudioStream, fetchAudio } from '../services/bilibili.js';

const router = express.Router();

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
// 一般优质词（权重中）
const GOOD_KW = ['官方', 'mv', '完整版', 'audio', '原版', '正式版', '官方音频'];
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

  if (name && title.includes(name)) score += 50;
  else if (name) {
    const hit = [...name].filter((c) => title.includes(c)).length;
    score += Math.round((hit / Math.max(1, name.length)) * 30);
  }

  if (singer) {
    const s = singer.split(/[\/、,&]/)[0].trim();
    if (s && (title.includes(s) || (v.author || '').includes(s))) score += 30;
  }

  if (expectDur > 0 && v.duration > 0) {
    const diff = Math.abs(v.duration - expectDur);
    if (diff <= 10) score += 40;
    else if (diff <= 25) score += 22;
    else if (diff <= 60) score += 6;
    else score -= 25;
  }

  // 播放量加权（加大权重，让高播放量更靠前）
  score += Math.min(60, Math.log10((v.play || 0) + 1) * 11);

  // 高音质词大幅加分
  if (HQ_KW.some((k) => t.includes(k))) score += 30;
  if (GOOD_KW.some((k) => t.includes(k))) score += 10;
  for (const k of BAD_KW) if (t.includes(k)) score -= 14;

  return Math.round(score);
}

function rank(videos, name, singer, expectDur) {
  const parts = singerParts(singer);
  let scored = videos
    .filter((v) => !isExcluded(v.title)) // 过滤掉「伴奏」「纯音乐」等
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
    // 多组查询提升命中率
    const queries = [];
    if (singer) queries.push(`${name} ${singer.split(/[\/、,&]/)[0].trim()}`);
    queries.push(name);
    if (singer) queries.push(`${singer.split(/[\/、,&]/)[0].trim()} ${name}`);

    const seen = new Set();
    let all = [];
    let lastErr = null;
    for (const q of queries) {
      try {
        const vids = await searchVideos(q, 1, 20);
        for (const v of vids) {
          if (seen.has(v.bvid)) continue;
          seen.add(v.bvid);
          all.push(v);
        }
      } catch (e) {
        lastErr = e; // 记录错误（多为风控）
      }
      if (all.length >= 25) break;
    }

    if (all.length === 0) {
      if (lastErr) {
        return res.status(502).json({ error: 'Bilibili 暂时被风控，请稍后重试（点播放或换源重试）' });
      }
      return res.status(404).json({ error: '未在 Bilibili 找到该歌曲的视频' });
    }

    const ranked = rank(all, name, singer, duration);
    const best = ranked.find((v) => !v.live) || ranked[0];
    res.json({ best, candidates: ranked.slice(0, 10) });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

/**
 * 自由关键字搜索 Bilibili（手动换源用）
 */
router.get('/search', authRequired, async (req, res) => {
  const { keyword } = req.query;
  if (!keyword) return res.status(400).json({ error: '请输入关键字' });
  try {
    const vids = await searchVideos(keyword, 1, 20);
    const ranked = rank(vids, keyword, '', 0);
    res.json({ candidates: ranked });
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
  try {
    const stream = await getAudioStream(bvid, cid ? Number(cid) : undefined);
    const range = req.headers.range;
    const upstream = await fetchAudio(stream.url, bvid, range);

    if (!upstream.ok && upstream.status !== 206 && upstream.status !== 200) {
      // 主地址失败则尝试备用地址
      const backup = stream.backup && stream.backup[0];
      if (backup) {
        const up2 = await fetchAudio(backup, bvid, range);
        return pipeAudio(up2, res, stream.mime);
      }
      return res.status(502).send('音频拉取失败');
    }
    pipeAudio(upstream, res, stream.mime);
  } catch (e) {
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
    Readable.fromWeb(upstream.body).pipe(res);
  } else {
    res.end();
  }
}

export default router;
