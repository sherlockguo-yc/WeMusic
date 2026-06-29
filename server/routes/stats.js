/**
 * 播放统计、红心、bvid 全局缓存 路由
 */
import express from 'express';
import db from '../db.js';
import { authRequired } from '../middleware/auth.js';
import { fetchLyrics } from '../services/lyrics.js';
import { getTopList, searchSongs } from '../services/qqmusic.js';

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
  const { song_mid, name, singer, album, album_mid, duration, played_sec, bvid } = req.body || {};
  if (!name) return res.status(400).json({ error: '缺少歌曲名' });
  db.prepare(`
    INSERT INTO play_logs (user_id, song_mid, name, singer, album, album_mid, duration, played_sec, bvid, played_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.user.id, song_mid || '', name, singer || '', album || '', album_mid || '',
    duration || 0, played_sec || 0, bvid || '', Date.now()
  );
  res.json({ ok: true });
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

// 最常听歌手 Top N
router.get('/top-artists', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 10, 50);
  const days  = req.query.days ? Number(req.query.days) : null;
  const uid   = req.user.id;
  const since = days ? Date.now() - days * 86400000 : 0;
  const rows  = db.prepare(`
    SELECT singer, COUNT(*) AS play_count, SUM(played_sec) AS total_sec,
           COUNT(DISTINCT name) AS unique_songs
    FROM play_logs WHERE user_id=? AND played_at>=? AND singer!=''
    GROUP BY singer
    ORDER BY play_count DESC
    LIMIT ?
  `).all(uid, since, limit);
  res.json({ artists: rows });
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
  const mids = Array.isArray(req.body?.mids) ? req.body.mids : [];
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
// 个性化推荐
// 策略：
//   1. 从播放历史 + 喜欢列表中提取「种子歌手」
//   2. 对每个种子歌手搜索代表歌曲（限20首）
//   3. 同时从热歌榜里拉取当前热门（扩展发现广度）
//   4. 过滤掉已听过的歌曲（近30天有播放记录的）
//   5. 随机打散后返回
// ============================================================
router.get('/recommend', async (req, res) => {
  const uid = req.user.id;
  const since30 = Date.now() - 30 * 86400000;

  // 种子歌手：喜欢 > 高频播放（分别取前3）
  const likedArtists = db.prepare(
    `SELECT DISTINCT singer FROM likes WHERE user_id=? AND singer != '' LIMIT 3`
  ).all(uid).map((r) => r.singer);

  const topArtists = db.prepare(`
    SELECT singer, COUNT(*) AS cnt FROM play_logs
    WHERE user_id=? AND played_at >= ? AND singer != ''
    GROUP BY singer ORDER BY cnt DESC LIMIT 5
  `).all(uid, since30).map((r) => r.singer);

  // 合并，优先喜欢的歌手，去重展开（"A / B" → ["A","B"]）
  const artistSet = new Set();
  for (const s of [...likedArtists, ...topArtists]) {
    s.split(/[\/、,，&]/).forEach((p) => { const t = p.trim(); if (t) artistSet.add(t); });
  }
  const seedArtists = [...artistSet].slice(0, 5);

  // 已听过的歌曲 key（近30天，用于过滤）
  const heardKeys = new Set(
    db.prepare(`SELECT name, singer FROM play_logs WHERE user_id=? AND played_at >= ?`)
      .all(uid, since30)
      .map((r) => `${r.name}__${r.singer}`)
  );

  const fetchTasks = [];

  if (seedArtists.length) {
    // 每个种子歌手搜代表歌曲
    fetchTasks.push(...seedArtists.map((name) => searchSongs(name)));
  }
  // 始终混入当前热歌榜前20首（增加新鲜度和广度）
  fetchTasks.push(getTopList(26, 20));

  const results = await Promise.allSettled(fetchTasks);
  const seen = new Set();
  const songs = [];

  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    const list = Array.isArray(r.value) ? r.value : (r.value.songs || []);
    for (const s of list) {
      const key = `${s.name}__${s.singer}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // 已听过的放到后面（不完全过滤，避免推荐列表太少）
      songs.push({ ...s, _heard: heardKeys.has(key) });
    }
  }

  // 未听过的优先，听过的放后面，各自内部随机打散
  const unheard = songs.filter((s) => !s._heard);
  const heard   = songs.filter((s) => s._heard);
  const shuffle = (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
  const final = [...shuffle(unheard), ...shuffle(heard)].slice(0, 50).map(({ _heard, ...s }) => s);

  res.json({
    songs: final,
    artists: seedArtists,
    reason: seedArtists.length ? 'history' : 'no_history',
  });
});

// ============================================================
// 歌词查询（网易云音乐，按需拉取，不缓存）
// ============================================================
router.get('/lyrics', async (req, res) => {
  const { name, singer } = req.query;
  if (!name) return res.status(400).json({ error: '缺少歌曲名' });
  try {
    const result = await fetchLyrics(name, singer || '');
    res.json(result);
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

export default router;
