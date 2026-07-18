/**
 * 播放统计、红心、bvid 全局缓存 路由
 */
import express from 'express';
import db from '../db.js';
import { authRequired } from '../middleware/auth.js';
import { fetchLyrics, searchLyricsCandidates, fetchLyricsById, getLyricCache, setLyricCache, qqFetchLyric, parseLrc, parseLrcWithTrans, isInstrumental } from '../services/lyrics.js';
import { getTopList, searchSongs, searchSongsForRecommend, findSingerMid } from '../services/qqmusic.js';
import { renderPosterPNG } from '../services/poster.js';
import { POSTER_THEMES } from '../../shared/poster-template.js';
import { decodeSourceId, Platform } from '../../shared/constants.js';

const router = express.Router();
router.use(authRequired);

// ============================================================
// bvid 全局缓存（按 song_mid 存取，任意播放场景均可复用）
// ============================================================

// 查询缓存
router.get('/bvid/:songMid', (req, res) => {
  const row = db.prepare('SELECT * FROM bvid_cache WHERE song_mid = ?').get(req.params.songMid);
  if (!row) return res.status(404).json({ cached: false });
  res.json({ cached: true, ...row });
});

// 写入 / 更新缓存
router.put('/bvid/:songMid', (req, res) => {
  const { name, singer, bvid, bili_title, bili_dur } = req.body || {};
  if (!bvid) return res.status(400).json({ error: '缺少 bvid' });
  db.prepare(`
    INSERT INTO bvid_cache (song_mid, name, singer, bvid, bili_title, bili_dur, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(song_mid) DO UPDATE SET
      bvid=excluded.bvid, bili_title=excluded.bili_title,
      bili_dur=excluded.bili_dur, updated_at=excluded.updated_at
  `).run(req.params.songMid, name || '', singer || '', bvid, bili_title || '', bili_dur || 0, Date.now());
  res.json({ ok: true });
});

// ============================================================
// 播放日志上报（前端每次播放时调用）
// ============================================================
router.post('/log', (req, res) => {
  const { song_mid, name, singer, album, album_mid, duration, played_sec, bvid, lyrics_source_id } = req.body || {};
  if (!name) return res.status(400).json({ error: '缺少歌曲名' });
  const dur = Math.min(Math.max(Number(duration) || 0, 0), 86400);   // 0~24h
  const sec = Math.min(Math.max(Number(played_sec) || 0, 0), dur);  // 不超过歌曲时长
  db.prepare(`
    INSERT INTO play_logs (user_id, song_mid, name, singer, album, album_mid, duration, played_sec, bvid, played_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.user.id, song_mid || '', name, singer || '', album || '', album_mid || '',
    dur, sec, bvid || '', Date.now()
  );

  // 众包完播统计：播放时长 ≥ 歌曲时长的 90% 视为完整播放
  if (dur > 0 && sec >= dur * 0.9) {
    const songKey = `${name}__${singer || ''}`;
    const now = Date.now();
    const upsert = db.prepare(`
      INSERT INTO source_completions (source_type, source_id, song_key, completions, last_updated)
      VALUES (?, ?, ?, 1, ?)
      ON CONFLICT(source_type, source_id, song_key) DO UPDATE SET
        completions = completions + 1, last_updated = excluded.last_updated
    `);
    if (bvid) upsert.run('video', bvid, songKey, now);
    if (lyrics_source_id) upsert.run('lyrics', String(lyrics_source_id), songKey, now);
  }

  res.json({ ok: true });
});

export { getCrowdCompletions } from '../services/crowd.js';

// 最近播放历史（从 play_logs 查最近 100 首不重复歌曲，跨设备共享）
router.get('/history', (req, res) => {
  const rows = db.prepare(`
    SELECT song_mid, name, singer, album, album_mid, duration, bvid, MAX(played_at) AS last_at
    FROM play_logs WHERE user_id=? GROUP BY name, COALESCE(singer,'')
    ORDER BY last_at DESC LIMIT 100
  `).all(req.user.id);
  res.json({ history: rows });
});

// ============================================================
// 统计数据查询
// ============================================================

// 概览：总播放次数、总时长、不重复歌曲数
router.get('/overview', (req, res) => {
  const uid = req.user.id;
  const total = db.prepare('SELECT COUNT(*) AS cnt, SUM(played_sec) AS sec FROM play_logs WHERE user_id=?').get(uid);
  const unique = db.prepare('SELECT COUNT(DISTINCT name||singer) AS cnt FROM play_logs WHERE user_id=?').get(uid);
  const days  = db.prepare("SELECT COUNT(DISTINCT date(played_at/1000,'unixepoch','localtime')) AS cnt FROM play_logs WHERE user_id=?").get(uid);
  res.json({ plays: total.cnt, total_sec: total.sec || 0, unique_songs: unique.cnt, active_days: days.cnt });
});

// ============================================================
// 本周 / 本月听歌报告（含跳过率、新歌数、完播率分布、听歌趋势）
// 统一响应结构：period / lastPeriod / trend / label，供周报月报共用前端渲染逻辑
// ============================================================

// —— 有效播放判断（SQL 表达式片段） ——
// 有效播放：播了 ≥ 30 秒，或播了 ≥ 40% 总时长（短歌也能公平计入）
// 用于：跳过率分母、新歌发现门槛、平均每首播放时长计算
// 表达式引用列名 played_sec、duration，用在 WHERE / CASE 中直接拼接
const MEANINGFUL_COND = "played_sec >= 30 OR (duration > 0 AND CAST(played_sec AS REAL)/duration >= 0.4)";
// 跳过判断：播了 < 25% 总时长（duration 未知时回退 30s 绝对阈值）
const SKIP_COND = "(duration > 0 AND CAST(played_sec AS REAL)/duration < 0.25) OR ((duration IS NULL OR duration = 0) AND played_sec < 30)";

// 歌手名分隔符：拆分合唱/组合（与 computeArtistWeights 保持一致）
const ARTIST_SPLIT_RE = /[\/、,，&]/;

// 把 "A / B" 这类组合歌手名拆分为单独歌手名数组
function splitArtistNames(singer) {
  return (singer || '').split(ARTIST_SPLIT_RE).map((p) => p.trim()).filter(Boolean);
}

// 从 play_logs 聚合歌手播放数据，拆分合唱/组合歌手并各自计 full 权重
// 返回按 play_count 降序排列的完整数组（调用方自行 slice）
function aggregateArtists(uid, since, until) {
  const rows = db.prepare(`
    SELECT singer, COUNT(*) AS play_count, SUM(played_sec) AS total_sec,
           COUNT(DISTINCT name) AS unique_songs
    FROM play_logs WHERE user_id=? AND played_at>=? AND played_at<? AND singer != ''
    GROUP BY singer
  `).all(uid, since, until);
  const map = new Map();
  for (const r of rows) {
    const parts = splitArtistNames(r.singer);
    if (parts.length === 0) continue;
    for (const name of parts) {
      const cur = map.get(name) || { singer: name, play_count: 0, total_sec: 0, unique_songs: 0 };
      cur.play_count += r.play_count;
      cur.total_sec += (r.total_sec || 0);
      cur.unique_songs += r.unique_songs; // 近似累加（合唱曲会同时计入多位歌手）
      map.set(name, cur);
    }
  }
  return [...map.values()].sort((a, b) => b.play_count - a.play_count || (b.total_sec || 0) - (a.total_sec || 0));
}

// 并行解析歌手 mid（用于头像展示），单条失败不影响整体
async function attachSingerMids(artists) {
  await Promise.allSettled(artists.map(async (a) => {
    try {
      const s = await findSingerMid(a.singer);
      a.singer_mid = s ? s.mid : '';
    } catch {
      a.singer_mid = '';
    }
  }));
  return artists;
}

// 公共函数：构建听歌报告数据
async function buildReport(uid, since, until, compareSince, compareUntil, label) {
  // —— 概览（含有效播放次数） ——
  const periodT = db.prepare(`
    SELECT COUNT(*) AS plays, SUM(played_sec) AS sec,
           COUNT(DISTINCT name||singer) AS unique_songs,
           COUNT(DISTINCT date(played_at/1000,'unixepoch','localtime')) AS days,
           SUM(CASE WHEN ${MEANINGFUL_COND} THEN 1 ELSE 0 END) AS meaningful_plays,
           SUM(CASE WHEN ${MEANINGFUL_COND} THEN played_sec ELSE 0 END) AS meaningful_sec
    FROM play_logs WHERE user_id=? AND played_at>=? AND played_at<?
  `).get(uid, since, until);

  // —— 对比周期概览 ——
  const lastPeriodT = db.prepare(`
    SELECT COUNT(*) AS plays, SUM(played_sec) AS sec
    FROM play_logs WHERE user_id=? AND played_at>=? AND played_at<?
  `).get(uid, compareSince, compareUntil);

  // —— Top 歌曲 / 歌手 ——
  const topSongs = db.prepare(`
    SELECT name, singer, MAX(album) AS album, MAX(album_mid) AS album_mid, COUNT(*) AS play_count, SUM(played_sec) AS total_sec
    FROM play_logs WHERE user_id=? AND played_at>=? AND played_at<?
    GROUP BY name, singer ORDER BY play_count DESC LIMIT 10
  `).all(uid, since, until);

  // —— Top 歌手（拆分合唱/组合，各自计 full 权重） ——
  const _allArtists = aggregateArtists(uid, since, until);
  const topArtists = _allArtists.slice(0, 5);
  await attachSingerMids(topArtists);

  // —— 跳过率（相对阈值：播放时长 < 歌曲时长的 25%；无 duration 时回退 30s 绝对阈值） ——
  const skipRow = db.prepare(`
    SELECT COUNT(*) AS total, SUM(CASE WHEN ${SKIP_COND} THEN 1 ELSE 0 END) AS skipped
    FROM play_logs WHERE user_id=? AND played_at>=? AND played_at<?
  `).get(uid, since, until);

  // —— 新歌发现数（仅统计有效播放中首次出现的歌曲；注意使用 DISTINCT 避免重复计数） ——
  const newSongs = db.prepare(`
    SELECT COUNT(DISTINCT name||'__'||COALESCE(singer,'')) AS cnt
    FROM play_logs WHERE user_id=? AND played_at>=? AND played_at<?
    AND ${MEANINGFUL_COND}
    AND (name||'__'||COALESCE(singer,'')) NOT IN (
      SELECT name||'__'||COALESCE(singer,'') FROM play_logs WHERE user_id=? AND played_at < ?
    )
  `).get(uid, since, until, uid, since);

  // —— 完播率分布 ——
  const comp0    = db.prepare(`SELECT COUNT(*) AS cnt FROM play_logs WHERE user_id=? AND played_at>=? AND played_at<? AND CAST(played_sec AS REAL)/NULLIF(duration,0) < 0.2`).get(uid, since, until).cnt;
  const comp20   = db.prepare(`SELECT COUNT(*) AS cnt FROM play_logs WHERE user_id=? AND played_at>=? AND played_at<? AND CAST(played_sec AS REAL)/NULLIF(duration,0) >= 0.2 AND CAST(played_sec AS REAL)/NULLIF(duration,0) < 0.8`).get(uid, since, until).cnt;
  const comp80   = db.prepare(`SELECT COUNT(*) AS cnt FROM play_logs WHERE user_id=? AND played_at>=? AND played_at<? AND CAST(played_sec AS REAL)/NULLIF(duration,0) >= 0.8`).get(uid, since, until).cnt;
  const compNone = db.prepare(`SELECT COUNT(*) AS cnt FROM play_logs WHERE user_id=? AND played_at>=? AND played_at<? AND (duration IS NULL OR duration=0)`).get(uid, since, until).cnt;

  // —— 峰值时段 ——
  const peakHourRow = db.prepare(`
    SELECT CAST(strftime('%H',played_at/1000,'unixepoch','localtime') AS INTEGER) AS hour, COUNT(*) AS cnt
    FROM play_logs WHERE user_id=? AND played_at>=? AND played_at<?
    GROUP BY hour ORDER BY cnt DESC LIMIT 1
  `).get(uid, since, until);

  // —— 最爱专辑（按播放次数排序，取封面缩略图）——
  const topAlbums = db.prepare(`
    SELECT album, album_mid, singer, COUNT(*) AS play_count
    FROM play_logs WHERE user_id=? AND played_at>=? AND played_at<? AND album != ''
    GROUP BY album ORDER BY play_count DESC LIMIT 2
  `).all(uid, since, until);

  // —— 歌手多样性（同样拆分合唱/组合，统计不重复个人歌手数） ——
  const uniqueArtists = _allArtists.length || 0;

  // —— 重复播放率：播放超过 1 次的歌曲占不重复歌曲的比例 ——
  const repeatRow = db.prepare(`
    SELECT COUNT(*) AS cnt FROM (
      SELECT name, singer FROM play_logs
      WHERE user_id=? AND played_at>=? AND played_at<?
      GROUP BY name, singer HAVING COUNT(*) > 1
    )
  `).get(uid, since, until);
  const uniqueSongs = periodT.unique_songs || 1;
  const repeatRate = Math.round((repeatRow?.cnt || 0) / uniqueSongs * 100);

  // —— 时段文字标签 ——
  const hourLabels = ['凌晨','凌晨','凌晨','凌晨','凌晨','清晨','清晨','上午','上午','上午','午间','午间','午后','午后','午后','午后','傍晚','傍晚','晚间','晚间','深夜','深夜','深夜','深夜'];
  const peakLabel = peakHourRow ? hourLabels[peakHourRow.hour] : null;

  return {
    period: {
      plays: periodT.plays || 0,
      sec: periodT.sec || 0,
      uniqueSongs: periodT.unique_songs || 0,
      days: periodT.days || 0,
      meaningfulPlays: periodT.meaningful_plays || 0,
      meaningfulSec: periodT.meaningful_sec || 0,
    },
    lastPeriod: {
      plays: lastPeriodT?.plays || 0,
      sec: lastPeriodT?.sec || 0,
    },
    topSongs,
    topArtists,
    topAlbums,
    skip: { total: skipRow?.total || 0, skipped: skipRow?.skipped || 0 },
    newSongs: newSongs?.cnt || 0,
    completion: { low: comp0, mid: comp20, high: comp80, noDur: compNone },
    peakHour: peakHourRow ? peakHourRow.hour : null,
    peakLabel: peakLabel,
    repeatRate,
    uniqueArtists: uniqueArtists || 0,
    label,
  };
}

router.get('/weekly', async (req, res) => {
  const uid = req.user.id;
  const now = new Date();
  const off = Number(req.query.weekOffset) || 0;
  const offset = Math.max(0, Math.min(off, 52));

  const dayOfWeek = now.getDay();
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const thisMonday = new Date(now); thisMonday.setDate(now.getDate() - daysSinceMonday); thisMonday.setHours(0,0,0,0);
  const targetMonday = new Date(thisMonday); targetMonday.setDate(thisMonday.getDate() - offset * 7);
  const targetStart = targetMonday.getTime();
  const targetEnd = offset === 0 ? now.getTime() : new Date(targetMonday.getFullYear(), targetMonday.getMonth(), targetMonday.getDate() + 7).getTime();
  const actualEnd = Math.min(now.getTime(), targetEnd);
  const lastMonday = new Date(targetMonday); lastMonday.setDate(targetMonday.getDate() - 7);
  const lastSince = lastMonday.getTime();
  const lastUntil = targetStart;

  const fmtDate = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
  const label = offset === 0
    ? `${fmtDate(targetMonday)} — ${fmtDate(now)}`
    : `${fmtDate(targetMonday)} — ${fmtDate(new Date(targetMonday.getFullYear(), targetMonday.getMonth(), targetMonday.getDate() + 6))}`;

  const report = await buildReport(uid, targetStart, actualEnd, lastSince, lastUntil, label);

  // —— 近 4 周趋势 ——
  const trend = [];
  for (let w = 0; w < 4; w++) {
    const mon = new Date(targetMonday); mon.setDate(targetMonday.getDate() - w * 7);
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6); sun.setHours(23,59,59,999);
    const end = w === 0 ? actualEnd : sun.getTime();
    const row = db.prepare(`SELECT COUNT(*) AS plays FROM play_logs WHERE user_id=? AND played_at>=? AND played_at<?`).get(uid, mon.getTime(), end);
    trend.push({ label: `${fmtDate(mon)}-${fmtDate(sun)}`, plays: row?.plays || 0 });
  }
  trend.reverse();
  res.json({ ...report, trend });
});

// —— 本月听歌报告（自然月，支持 monthOffset 查看历史月） ——
router.get('/monthly', async (req, res) => {
  const uid = req.user.id;
  const now = new Date();
  const off = Number(req.query.monthOffset) || 0;
  const offset = Math.max(0, Math.min(off, 24));

  const targetStart = new Date(now.getFullYear(), now.getMonth() - offset, 1, 0, 0, 0, 0);
  const targetSince = targetStart.getTime();
  const targetEnd = offset === 0
    ? now.getTime()
    : new Date(now.getFullYear(), now.getMonth() - offset + 1, 1, 0, 0, 0, 0).getTime();
  const lastMonthStart = new Date(targetStart.getFullYear(), targetStart.getMonth() - 1, 1, 0, 0, 0, 0);
  const lastSince = lastMonthStart.getTime();
  const lastUntil = targetSince;
  const label = `${targetStart.getFullYear()}年${targetStart.getMonth() + 1}月`;

  const report = await buildReport(uid, targetSince, targetEnd, lastSince, lastUntil, label);

  // —— 近 6 个月趋势 ——
  const trend = [];
  for (let m = 0; m < 6; m++) {
    const mStart = new Date(targetStart.getFullYear(), targetStart.getMonth() - m, 1, 0, 0, 0, 0);
    const mEnd = m === 0 ? targetEnd : new Date(targetStart.getFullYear(), targetStart.getMonth() - m + 1, 1, 0, 0, 0, 0).getTime();
    const row = db.prepare(`SELECT COUNT(*) AS plays FROM play_logs WHERE user_id=? AND played_at>=? AND played_at<?`).get(uid, mStart.getTime(), mEnd);
    trend.push({ label: `${mStart.getMonth() + 1}月`, plays: row?.plays || 0 });
  }
  trend.reverse();
  res.json({ ...report, trend });
});

// 最常播放歌曲 Top N（默认 20）
router.get('/top-songs', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const days  = req.query.days ? Number(req.query.days) : null;
  const uid   = req.user.id;
  const since = days ? Date.now() - days * 86400000 : 0;
  const rows  = db.prepare(`
    SELECT name, singer, album, album_mid, song_mid,
           COUNT(*) AS play_count, SUM(played_sec) AS total_sec
    FROM play_logs WHERE user_id=? AND played_at>=?
    GROUP BY name, singer
    ORDER BY play_count DESC, total_sec DESC
    LIMIT ?
  `).all(uid, since, limit);
  res.json({ songs: rows });
});

// 最常听歌手 Top N（拆分合唱/组合，各自计 full 权重，并附带歌手 mid 用于头像）
router.get('/top-artists', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 10, 50);
  const days  = req.query.days ? Number(req.query.days) : null;
  const uid   = req.user.id;
  const since = days ? Date.now() - days * 86400000 : 0;
  const artists = aggregateArtists(uid, since, Date.now()).slice(0, limit);
  await attachSingerMids(artists);
  res.json({ artists });
});

// 每日播放趋势（最近 N 天，默认 30）
router.get('/daily', (req, res) => {
  const days = Math.min(Number(req.query.days) || 30, 365);
  const uid  = req.user.id;
  const since = Date.now() - days * 86400000;
  const rows  = db.prepare(
    "SELECT date(played_at/1000,'unixepoch','localtime') AS day," +
    "COUNT(*) AS play_count, SUM(played_sec) AS total_sec " +
    "FROM play_logs WHERE user_id=? AND played_at>=? " +
    "GROUP BY day ORDER BY day"
  ).all(uid, since);
  res.json({ daily: rows });
});

// 时段分布（0-23 小时）
router.get('/hourly', (req, res) => {
  const uid = req.user.id;
  const rows = db.prepare(
    "SELECT CAST(strftime('%H',played_at/1000,'unixepoch','localtime') AS INTEGER) AS hour," +
    "COUNT(*) AS play_count FROM play_logs WHERE user_id=? GROUP BY hour ORDER BY hour"
  ).all(uid);
  res.json({ hourly: rows });
});

// ============================================================
// 红心（喜欢）
// ============================================================

// 查询用户所有红心歌曲
router.get('/likes', (req, res) => {
  const rows = db.prepare('SELECT * FROM likes WHERE user_id=? ORDER BY liked_at DESC').all(req.user.id);
  res.json({ likes: rows });
});

// 切换红心（点一下加，再点取消）
router.post('/likes/:songMid', (req, res) => {
  const uid = req.user.id;
  const mid = req.params.songMid;
  const existing = db.prepare('SELECT 1 FROM likes WHERE user_id=? AND song_mid=?').get(uid, mid);
  if (existing) {
    db.prepare('DELETE FROM likes WHERE user_id=? AND song_mid=?').run(uid, mid);
    res.json({ liked: false });
  } else {
    const { name, singer, album, album_mid, duration } = req.body || {};
    if (!name) return res.status(400).json({ error: '缺少歌曲名' });
    db.prepare(`INSERT OR IGNORE INTO likes (user_id, song_mid, name, singer, album, album_mid, duration, liked_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(uid, mid, name, singer||'', album||'', album_mid||'', duration||0, Date.now());
    res.json({ liked: true });
  }
});

// 批量查询红心状态（body: { mids: [...] }）
router.post('/likes/check', (req, res) => {
  const mids = (Array.isArray(req.body?.mids) ? req.body.mids : []).slice(0, 500);
  if (!mids.length) return res.json({ liked: {} });
  const placeholders = mids.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT song_mid FROM likes WHERE user_id=? AND song_mid IN (${placeholders})`
  ).all(req.user.id, ...mids);
  const liked = {};
  for (const r of rows) liked[r.song_mid] = true;
  res.json({ liked });
});

// ============================================================
// 榜单（热歌榜 / 新歌榜 / 飙升榜）
// ============================================================
const CHART_CACHE = new Map(); // topId -> { data, ts }
const CHART_TTL = 60 * 60 * 1000; // 1 小时缓存（榜单数据每天更新一次）

router.get('/chart/:topId', async (req, res) => {
  const topId = Number(req.params.topId) || 62;
  const cached = CHART_CACHE.get(topId);
  if (cached && Date.now() - cached.ts < CHART_TTL) {
    return res.json({ songs: cached.data, cached: true });
  }
  try {
    const songs = await getTopList(topId, 50);
    CHART_CACHE.set(topId, { data: songs, ts: Date.now() });
    res.json({ songs, cached: false });
  } catch (e) {
    res.status(502).json({ error: '榜单获取失败：' + e.message });
  }
});

// ============================================================
// 个性化推荐（多维度兴趣建模）
//
// 信号权重体系（参考 Spotify 隐式反馈）：
//   红心            : 3.0  最强主动信号
//   加入歌单        : 2.5  主动收藏
//   完播率 ≥ 80%   : 1.5  真正喜欢
//   重复播放 +1次   : 0.5  越听越喜欢（累加）
//   完播率 20-80%  : 0.3  一般兴趣
//   完播率 < 20%   : -0.3 不感兴趣（跳过）
//
// 歌手权重修正：
//   - 对 "A / B" 合唱形式，仅当 B 作为主唱有独立高权重记录时，B 才算喜欢的歌手
//   - 合唱中的非主唱歌手权重 × 0.4
//
// 推荐维度：
//   1. 深度挖掘（高权重种子歌手的更多歌曲）
//   2. 风格扩散（取高权重歌曲名搜索，发现同风格不同歌手版本）
//   3. 热门发现（当前热歌榜混入，保持新鲜度）
// ============================================================

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** 计算每首歌的兴趣分数（基于多维信号） */
function computeSongScores(uid) {
  const since90 = Date.now() - 90 * 86400000;

  // 1. 播放记录聚合
  const playRows = db.prepare(`
    SELECT name, singer, album, album_mid, song_mid, duration,
           COUNT(*) AS play_count,
           SUM(played_sec) AS total_played,
           MAX(played_at) AS last_played
    FROM play_logs
    WHERE user_id = ? AND played_at >= ?
    GROUP BY name, singer
  `).all(uid, since90);

  // 2. 红心 + 加入歌单的歌曲（合并为一次查询，避免重复扫表）
  const likesRows = db.prepare(`SELECT song_mid, name, singer FROM likes WHERE user_id = ?`).all(uid);
  const likedMids = new Set(likesRows.map((r) => r.song_mid));
  const likedKeys = new Set(likesRows.map((r) => `${r.name}__${r.singer}`));
  // 3. 歌单收录歌曲 key（包含非红心但加到歌单的）
  const inPlaylistKeys = new Set(
    db.prepare(`
      SELECT DISTINCT s.name, s.singer FROM songs s
      JOIN playlists p ON s.playlist_id = p.id WHERE p.user_id = ?
    `).all(uid).map((r) => `${r.name}__${r.singer}`)
  );

  const songScores = new Map();

  for (const row of playRows) {
    const key = `${row.name}__${row.singer}`;
    const dur = row.duration || 1;
    const avgPlayed = row.total_played / row.play_count;
    const completionRate = Math.min(avgPlayed / dur, 1.0);

    let score = 0;

    // 完播率信号
    if (completionRate >= 0.8)      score += 1.5;
    else if (completionRate >= 0.2) score += 0.3;
    else                            score -= 0.3;

    // 重复播放（每次 +0.5，上限 3）
    score += Math.min((row.play_count - 1) * 0.5, 3.0);

    // 红心
    if (likedMids.has(row.song_mid) || likedKeys.has(key)) score += 3.0;

    // 加入歌单
    if (inPlaylistKeys.has(key)) score += 2.5;

    // 时间衰减
    const ageRatio = (Date.now() - row.last_played) / (90 * 86400000);
    score *= (1.0 - ageRatio * 0.5);

    if (score > 0) songScores.set(key, { score, ...row });
  }

  // 补充：纯红心或纯歌单收藏（无播放记录，复用 likesRows）
  for (const row of likesRows) {
    const key = `${row.name}__${row.singer}`;
    if (!songScores.has(key)) songScores.set(key, { score: 3.0, ...row, play_count: 0 });
  }
  for (const row of db.prepare(`
    SELECT DISTINCT s.name, s.singer, s.album, s.album_mid, s.song_mid, s.duration
    FROM songs s JOIN playlists p ON s.playlist_id = p.id WHERE p.user_id = ?
  `).all(uid)) {
    const key = `${row.name}__${row.singer}`;
    if (!songScores.has(key)) songScores.set(key, { score: 2.5, ...row, play_count: 0 });
  }

  return songScores;
}

/** 从歌曲分数图谱里提取歌手权重（修正合唱误判） */
function computeArtistWeights(songScores) {
  // 先统计每个「单独歌手名」的独立得分（非合唱情况）
  const soloScores = new Map(); // artistName -> totalScore

  for (const [, song] of songScores) {
    const parts = (song.singer || '').split(/[\/、,，&]/).map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) continue;

    const isFeat = parts.length > 1;
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      // 合唱中非第一位歌手（非主唱）权重打折
      const factor = (isFeat && i > 0) ? 0.4 : 1.0;
      soloScores.set(name, (soloScores.get(name) || 0) + song.score * factor);
    }
  }

  // 修正：如果一个歌手的得分主要来自合唱中的客串（score < 1.5），降权
  // 只保留有独立主唱贡献 OR 总权重明显（≥ 2.0）的歌手
  const result = new Map();
  for (const [name, score] of soloScores) {
    if (score >= 2.0) result.set(name, score);
  }

  // 按权重降序排列
  return [...result.entries()].sort((a, b) => b[1] - a[1]);
}

router.get('/recommend', async (req, res) => {
  const uid = req.user.id;

  // ---- Step 1: 计算兴趣分数 ----
  const songScores = computeSongScores(uid);

  if (songScores.size === 0) {
    try {
      const songs = await getTopList(26, 40);
      return res.json({ songs, total: songs.length, hasMore: false, artists: [], reason: 'cold_start' });
    } catch {
      return res.json({ songs: [], total: 0, hasMore: false, artists: [], reason: 'cold_start' });
    }
  }

  // ---- Step 2: 歌手权重 ----
  const artistWeights = computeArtistWeights(songScores);
  const topArtists = artistWeights.slice(0, 3).map(([name]) => name);

  // ---- Step 3: 风格扩散种子 — 选真正喜欢且歌名有辨识度的（短/常见的跳过） ----
  const highScoreSongs = [...songScores.values()]
    .filter((s) => s.score >= 2.0 && s.name && s.name.length > 1)
    .sort((a, b) => b.score - a.score);
  shuffle(highScoreSongs);
  // 过滤掉太短的歌名（"无题"、"忘记" 等搜不出有意义结果），取最多 3 首
  const styleSeeds = highScoreSongs
    .filter((s) => s.name.length >= 2 && !/^[a-z0-9\s\-_\.]+$/i.test(s.name))
    .slice(0, 3);

  const heardKeys = new Set([...songScores.keys()]);

  // 加载用户不喜欢（disliked）的歌曲键，推荐时跳过
  const dislikedRows = db.prepare(
    'SELECT song_key FROM blocked_sources WHERE user_id=? AND source_type=?'
  ).all(uid, 'song');
  const dislikedKeys = new Set(dislikedRows.map(r => r.song_key));

  // ---- Step 4: 并行拉取 ----
  const tasks = [];

  for (const artist of topArtists) {
    tasks.push({ type: 'artist', label: artist, promise: searchSongsForRecommend(artist) });
  }
  for (const song of styleSeeds) {
    // 风格扩散：歌名 + "翻唱" 关键词，提高命中风格相似曲目的概率
    const kw = song.name.replace(/[\(（\[【].*?[\)）\]】]/g, '').trim() + ' 翻唱';
    tasks.push({ type: 'style', label: song.name, promise: searchSongs(kw) });
  }
  tasks.push({ type: 'chart', label: 'hot', promise: getTopList(26, 20) });

  const results = await Promise.allSettled(tasks.map((t) => t.promise));

  // ---- Step 5: 合并评分 ----
  const candidateMap = new Map();

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const task = tasks[i];
    if (r.status !== 'fulfilled') continue;
    const list = Array.isArray(r.value) ? r.value : (r.value.songs || []);

    for (const s of list) {
      const key = `${s.name}__${s.singer}`;
      if (candidateMap.has(key)) continue;

      // 已有负分信号（不喜欢的歌）：跳过
      const prevSignal = songScores.get(key);
      if (prevSignal && prevSignal.score < 0) continue;

      // 用户标记为「不喜欢」的歌：跳过
      if (dislikedKeys.has(key)) continue;

      let candidateScore = 0;
      if (task.type === 'artist') candidateScore += 2.0;
      else if (task.type === 'style') candidateScore += 1.5;
      else if (task.type === 'chart') candidateScore += 1.0;

      // 已听过的歌降低优先级但不排除
      if (heardKeys.has(key)) candidateScore -= 1.5;

      // 风格扩散中过滤掉种子歌手的结果（避免和深度挖掘重复）
      if (task.type === 'style') {
        const songSingers = (s.singer || '').split(/[\/、,，&]/).map((p) => p.trim());
        if (songSingers.some((sg) => topArtists.includes(sg))) candidateScore -= 0.8;
      }

      candidateMap.set(key, { ...s, _candidateScore: candidateScore, _source: task.type });
    }
  }

  // ---- Step 5.5: 同歌名去重 — 每首歌名最多保留 2 个版本（按评分降序取前 2） ----
  const nameGroups = new Map();
  for (const c of candidateMap.values()) {
    // 去掉括号内容（如 "晴天 (Live)" → "晴天"）做归一化，避免同名变体各占一行
    const norm = c.name.replace(/[\(（\[【].*?[\)）\]】]/g, '').trim().toLowerCase();
    if (!nameGroups.has(norm)) nameGroups.set(norm, []);
    nameGroups.get(norm).push(c);
  }
  const dedupedCandidates = [];
  for (const group of nameGroups.values()) {
    group.sort((a, b) => b._candidateScore - a._candidateScore);
    dedupedCandidates.push(...group.slice(0, 2));
  }
  const multiVersionCount = [...nameGroups.values()].filter(g => g.length > 2).length;
  if (multiVersionCount > 0) {
    console.log(`[recommend] name-dedup: ${candidateMap.size} candidates → ${dedupedCandidates.length} (${multiVersionCount} songs had >2 versions)`);
  }

  // ---- Step 6: 分桶排序 ----
  const candidates = dedupedCandidates;

  // 只保留正分候选（不推荐低分内容）
  const high = shuffle(candidates.filter((s) => s._candidateScore >= 1.5));
  const mid  = shuffle(candidates.filter((s) => s._candidateScore >= 0 && s._candidateScore < 1.5));

  const full = [...high, ...mid]
    .map(({ _candidateScore, _source, ...s }) => s);

  // 分页：默认每页 20 首
  const offset = Math.max(0, parseInt(req.query.offset) || 0);
  const limit  = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
  const page   = full.slice(offset, offset + limit);

  res.json({
    songs: page,
    total: full.length,
    hasMore: offset + limit < full.length,
    artists: topArtists,
    reason: topArtists.length ? 'interest_model' : 'cold_start',
    _stats: {
      song_signals: songScores.size,
      top_artists: artistWeights.slice(0, 6).map(([n, s]) => ({ name: n, score: Math.round(s * 10) / 10 })),
    },
  });
});

// ============================================================
// 歌词查询（网易云音乐，支持 candidates + 换源 + 按 sourceId 精确拉取）
// ============================================================

/**
 * 按候选对象（来自 searchLyricsCandidates）拉取歌词原文 + LRC 行
 * 用于「主 sourceId 被屏蔽时」从候选中选替代源
 * @returns {Promise<{lines: Array, raw: string} | null>}
 */
async function fetchLyricsForCandidate(c) {
  try {
    const { platform, id } = decodeSourceId(String(c.id));
    if (platform === Platform.QQ_MUSIC) {
      const { raw, tlyric } = await qqFetchLyric(id);
      if (!raw.trim()) return null;
      return { raw, tlyric, lines: parseLrcWithTrans(raw, tlyric) };
    }
    const r = await fetchLyricsById(Number(id));
    return { raw: r.raw, tlyric: r.tlyric, lines: r.lines };
  } catch {
    return null;
  }
}

router.get('/lyrics', async (req, res) => {
  const { name, singer, sourceId } = req.query;
  if (!name) return res.status(400).json({ error: '缺少歌曲名' });
  const cacheKey = `${name}__${singer || ''}`;
  const getBlockedIds = () => db.prepare(
    'SELECT source_id FROM blocked_sources WHERE user_id=? AND song_key=? AND source_type=?'
  ).all(req.user.id, cacheKey, 'lyrics').map((r) => String(r.source_id));

  try {
    // 1. 若指定了 sourceId，直接按该 id 拉取（不缓存，换源操作）
    //    用户显式选择歌词源，跳过纯音乐检测
    //    但若该 sourceId 已被屏蔽，fall through 到正常流程（让系统选最优非屏蔽源）
    if (sourceId) {
      const blockedIds = getBlockedIds();
      if (!blockedIds.includes(String(sourceId))) {
        const { platform, id } = decodeSourceId(sourceId);
        if (platform === Platform.QQ_MUSIC) {
          const { raw, tlyric } = await qqFetchLyric(id);
          if (!raw.trim()) return res.json({ lines: [], sourceId, error: '该歌曲暂无歌词' });
          return res.json({ lines: parseLrcWithTrans(raw, tlyric), sourceId, song: name, artist: singer });
        }
        const result = await fetchLyricsById(Number(id));
        return res.json({ lines: result.lines, sourceId });
      }
      console.log(`[lyrics:route] sourceId=${sourceId} is blocked, falling through to auto-pick`);
    }

    // 2. 纯音乐检测：歌名命中关键词 → 跳过搜索，避免无意义的 API 调用
    if (isInstrumental(name)) {
      console.log(`[lyrics:route] instrumental detected for "${name}" — skipping search`);
      const result = { instrumental: true, lines: [], candidates: [] };
      setLyricCache(cacheKey, result);
      return res.json(result);
    }

    // 3. 检查缓存（同名同歌手 24h 内复用）
    const blockedIds = getBlockedIds();
    const cached = getLyricCache(cacheKey);
    if (cached) {
      console.log(`[lyrics:route] cache HIT for "${cacheKey}", candidates:${cached.candidates?.length || 0}`);
      const resp = { ...cached };
      // 过滤掉被拉黑的歌词源
      if (resp.candidates) resp.candidates = resp.candidates.filter((c) => !blockedIds.includes(String(c.id)));
      // 旧缓存可能没有 album_mid，从候选人中补全
      if (!resp.album_mid && resp.sourceId && resp.candidates?.length) {
        resp.album_mid = (resp.candidates.find(c => String(c.id) === String(resp.sourceId)) || {}).album_mid || '';
      }
      // 若主 sourceId 被屏蔽，从 cleanCandidates 中取最优替代并重新拉取歌词
      if (resp.sourceId && blockedIds.includes(String(resp.sourceId))) {
        const replacement = resp.candidates?.[0];
        if (replacement) {
          const replaced = await fetchLyricsForCandidate(replacement);
          if (replaced) {
            resp.sourceId = String(replacement.id);
            resp.song = replacement.name;
            resp.artist = replacement.artist;
            resp.lines = replaced.lines;
            if (replaced.raw !== undefined) resp.raw = replaced.raw;
          } else {
            resp.sourceId = null; resp.lines = []; resp.error = '当前源已屏蔽，请选择其他版本';
          }
        } else {
          resp.sourceId = null; resp.lines = []; resp.error = '当前源已屏蔽，请选择其他版本';
        }
      }
      return res.json(resp);
    }
    console.log(`[lyrics:route] cache MISS for "${cacheKey}" — fetching fresh`);

    // 4. 拉取主结果 + 候选列表
    const [main, candidates] = await Promise.all([
      fetchLyrics(name, singer || '').catch(() => null),
      searchLyricsCandidates(name, singer || ''),
    ]);

    // 过滤掉被拉黑的歌词源
    const cleanCandidates = candidates.filter((c) => !blockedIds.includes(String(c.id)));

    // 若主结果被屏蔽，从 cleanCandidates 中取最优替代并重新拉取歌词
    let finalMain = main;
    if (main && blockedIds.includes(String(main.sourceId))) {
      const replacement = cleanCandidates[0];
      if (replacement) {
        const replaced = await fetchLyricsForCandidate(replacement);
        if (replaced) {
          finalMain = {
            song: replacement.name,
            artist: replacement.artist,
            sourceId: String(replacement.id),
            raw: replaced.raw || '',
            tlyric: replaced.tlyric || '',
            lines: replaced.lines,
          };
        } else {
          finalMain = null;
        }
      } else {
        finalMain = null;
      }
    }

    const result = finalMain
      ? { ...finalMain, candidates: cleanCandidates, album_mid: (cleanCandidates.find(c => String(c.id) === String(finalMain.sourceId)) || {}).album_mid || '' }
      : {
          lines: [],
          candidates: cleanCandidates,
          error: cleanCandidates.length ? '当前源已屏蔽，请选择其他版本' : '未找到匹配歌词',
        };
    setLyricCache(cacheKey, result);
    res.json(result);
  } catch (e) {
    res.status(404).json({ error: e.message, candidates: [] });
  }
});

// ============================================================
// 专辑收藏（保存 / 取消 / 列出）
// ============================================================
router.get('/albums', (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM saved_albums WHERE user_id=? ORDER BY saved_at DESC'
  ).all(req.user.id);
  res.json({ albums: rows });
});

router.get('/albums/:albumMid/check', (req, res) => {
  const row = db.prepare(
    'SELECT 1 FROM saved_albums WHERE user_id=? AND album_mid=?'
  ).get(req.user.id, req.params.albumMid);
  res.json({ saved: !!row });
});

router.post('/albums/:albumMid', (req, res) => {
  const { name, singer, desc, company, genre, lan, aDate } = req.body || {};
  db.prepare(`
    INSERT OR REPLACE INTO saved_albums (user_id, album_mid, name, singer, desc, company, genre, lan, aDate, saved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.user.id, req.params.albumMid, name || '', singer || '', desc || '', company || '', genre || '', lan || '', aDate || '', Date.now());
  res.json({ ok: true });
});

router.delete('/albums/:albumMid', (req, res) => {
  db.prepare('DELETE FROM saved_albums WHERE user_id=? AND album_mid=?').run(req.user.id, req.params.albumMid);
  res.json({ ok: true });
});

// ---- 用户反馈 ----
router.post('/feedback', (req, res) => {
  const { type, content } = req.body || {};
  if (!content || !content.trim()) return res.status(400).json({ error: '请输入反馈内容' });
  if (!['bug', 'feature', 'other'].includes(type)) return res.status(400).json({ error: '无效的反馈类型' });
  db.prepare('INSERT INTO feedback (user_id, type, content, created_at) VALUES (?, ?, ?, ?)')
    .run(req.user.id, type, content.trim(), Date.now());
  res.json({ ok: true });
});

router.get('/feedback', (req, res) => {
  const rows = db.prepare('SELECT f.*, u.username FROM feedback f JOIN users u ON u.id=f.user_id ORDER BY f.created_at DESC LIMIT 50').all();
  res.json({ feedback: rows });
});

// ============================================================
// 歌词源 / 视频源黑名单（用户可手动屏蔽不想要的候选）
// ============================================================
// 获取某首歌的黑名单
router.get('/blocked', (req, res) => {
  const { song, type } = req.query; // type='video'|'lyrics'
  if (!song) return res.json({ blocked: [] });
  const rows = db.prepare(`
    SELECT source_id FROM blocked_sources
    WHERE user_id=? AND song_key=? AND source_type=?
  `).all(req.user.id, song, type || 'video');
  res.json({ blocked: rows.map((r) => r.source_id) });
});

// 获取某首歌的完整屏蔽记录（含 metadata 便于展示）
router.get('/blocked/full', async (req, res) => {
  const { song, type, name, singer } = req.query;
  if (!song) return res.json({ list: [] });
  const sourceType = type || 'video';
  const rows = db.prepare(`
    SELECT source_id, source_type, blocked_at, name, artist, source_label FROM blocked_sources
    WHERE user_id=? AND song_key=? AND source_type=?
    ORDER BY blocked_at DESC
  `).all(req.user.id, song, sourceType);

  // 旧数据回填：歌词类屏蔽若 DB 里没有 name/artist，每次拉取时尝试从搜索候选中补全
  // （一次性 cost，对用户透明的迁移；找到后写回 DB，下次直接命中）
  if (sourceType === 'lyrics' && name && rows.some((r) => !r.name)) {
    try {
      const candidates = await searchLyricsCandidates(name, singer || '');
      const byId = new Map(candidates.map((c) => [String(c.id), c]));
      const upd = db.prepare(
        'UPDATE blocked_sources SET name=?, artist=?, source_label=? WHERE user_id=? AND song_key=? AND source_type=? AND source_id=?'
      );
      for (const r of rows) {
        if (r.name) continue;
        const c = byId.get(String(r.source_id));
        if (!c) continue;
        const label = String(c.id).startsWith('qq:') ? 'QQ音乐' : '网易云';
        upd.run(c.name || null, c.artist || null, label, req.user.id, song, sourceType, r.source_id);
        r.name = c.name; r.artist = c.artist; r.source_label = label;
      }
    } catch (e) { console.warn('[blocked/full] lyrics backfill failed:', e.message); }
  }

  res.json({ list: rows });
});

// ============================================================
// 不喜欢歌曲（歌曲级 dislike，非源屏蔽）
// ============================================================
// 查询用户所有不喜欢的歌曲键
router.get('/disliked-songs', (req, res) => {
  const rows = db.prepare(
    'SELECT song_key FROM blocked_sources WHERE user_id=? AND source_type=?'
  ).all(req.user.id, 'song');
  res.json({ disliked: rows.map((r) => r.song_key) });
});

// 切换不喜欢（复用 blocked_sources 表，source_type='song'）
router.post('/disliked-songs', (req, res) => {
  const { song_key } = req.body || {};
  if (!song_key) return res.status(400).json({ error: '缺少 song_key' });
  const uid = req.user.id;
  const existing = db.prepare(
    'SELECT 1 FROM blocked_sources WHERE user_id=? AND song_key=? AND source_type=?'
  ).get(uid, song_key, 'song');
  if (existing) {
    db.prepare(
      'DELETE FROM blocked_sources WHERE user_id=? AND song_key=? AND source_type=?'
    ).run(uid, song_key, 'song');
    res.json({ disliked: false });
  } else {
    db.prepare(
      'INSERT OR IGNORE INTO blocked_sources (user_id, song_key, source_type, source_id, blocked_at) VALUES (?, ?, ?, ?, ?)'
    ).run(uid, song_key, 'song', 'disliked', Date.now());
    res.json({ disliked: true });
  }
});

// 新增黑名单
router.post('/blocked', (req, res) => {
  const { song, type, sourceId, name, artist, sourceLabel } = req.body || {};
  if (!song || !sourceId) return res.status(400).json({ error: '缺少参数' });
  db.prepare(`
    INSERT OR IGNORE INTO blocked_sources (user_id, song_key, source_type, source_id, blocked_at, name, artist, source_label)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.user.id, song, type || 'video', String(sourceId), Date.now(), name || null, artist || null, sourceLabel || null);
  res.json({ ok: true });
});

// 移除黑名单
router.delete('/blocked', (req, res) => {
  const { song, type, sourceId } = req.body || {};
  if (!song || !sourceId) return res.status(400).json({ error: '缺少参数' });
  db.prepare(`
    DELETE FROM blocked_sources WHERE user_id=? AND song_key=? AND source_type=? AND source_id=?
  `).run(req.user.id, song, type || 'video', String(sourceId));
  res.json({ ok: true });
});

// ============================================================
// 听歌报告海报生成（方案 B：服务端 Puppeteer 渲染，效果更精细）
// body: { theme: 'mint'|'dark'|'sunset'|'ocean', data: {...posterData} }
// ============================================================
router.get('/poster/themes', (req, res) => {
  res.json({ themes: Object.values(POSTER_THEMES).map(({ key, name }) => ({ key, name })) });
});

router.post('/poster', async (req, res) => {
  const { theme, format, data } = req.body || {};
  if (!data) return res.status(400).json({ error: '缺少海报数据' });
  const themeKey = POSTER_THEMES[theme] ? theme : 'mint';
  const fmt = format === 'mobile' ? 'mobile' : 'desktop';
  try {
    const result = await renderPosterPNG(data, themeKey, fmt);
    if (fmt === 'mobile') {
      // 手机版：返回 4 张图（base64）+ 元信息
      const pageNames = ['cover', 'stats', 'albums', 'rankings'];
      res.json({
        format: 'mobile',
        pages: result.map((buf, i) => ({
          name: pageNames[i] || `page-${i + 1}`,
          dataUrl: `data:image/png;base64,${buf.toString('base64')}`,
        })),
      });
    } else {
      // 桌面版：单张 PNG
      res.set('Content-Type', 'image/png');
      res.send(result);
    }
  } catch (e) {
    res.status(500).json({ error: '海报生成失败：' + e.message });
  }
});

export default router;
