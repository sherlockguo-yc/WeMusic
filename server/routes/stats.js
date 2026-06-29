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

  // 2. 红心 + 加入歌单的歌曲（单次查询合并，减少 DB 往返）
  const likedMids = new Set(
    db.prepare(`SELECT song_mid FROM likes WHERE user_id = ?`).all(uid).map((r) => r.song_mid)
  );
  const likedKeys = new Set(
    db.prepare(`SELECT name, singer FROM likes WHERE user_id = ?`).all(uid)
      .map((r) => `${r.name}__${r.singer}`)
  );
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

  // 补充：纯红心或纯歌单收藏（无播放记录）
  for (const row of db.prepare(`SELECT * FROM likes WHERE user_id = ?`).all(uid)) {
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
      return res.json({ songs, artists: [], reason: 'cold_start' });
    } catch {
      return res.json({ songs: [], artists: [], reason: 'cold_start' });
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

  // ---- Step 4: 并行拉取 ----
  const tasks = [];

  for (const artist of topArtists) {
    tasks.push({ type: 'artist', label: artist, promise: searchSongs(artist) });
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

  // ---- Step 6: 分桶排序 ----
  const candidates = [...candidateMap.values()];

  // 只保留正分候选（不推荐低分内容）
  const high = shuffle(candidates.filter((s) => s._candidateScore >= 1.5));
  const mid  = shuffle(candidates.filter((s) => s._candidateScore >= 0 && s._candidateScore < 1.5));

  const final = [...high.slice(0, 30), ...mid.slice(0, 20)]
    .slice(0, 50)
    .map(({ _candidateScore, _source, ...s }) => s);

  res.json({
    songs: final,
    artists: topArtists,
    reason: topArtists.length ? 'interest_model' : 'cold_start',
    _stats: {
      song_signals: songScores.size,
      top_artists: artistWeights.slice(0, 6).map(([n, s]) => ({ name: n, score: Math.round(s * 10) / 10 })),
    },
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
