import express from 'express';
import db from '../db.js';
import { authRequired } from '../middleware/auth.js';

const router = express.Router();
router.use(authRequired);

// 校验歌单归属
function ownPlaylist(userId, playlistId) {
  return db
    .prepare('SELECT * FROM playlists WHERE id = ? AND user_id = ?')
    .get(playlistId, userId);
}

// 获取当前用户全部歌单（含歌曲数 + 前 4 张专辑封面 mid 用于拼图封面）
router.get('/', (req, res) => {
  const rows = db
    .prepare(
      `SELECT p.*, (SELECT COUNT(*) FROM songs s WHERE s.playlist_id = p.id) AS count
       FROM playlists p WHERE p.user_id = ? ORDER BY p.created_at ASC`
    )
    .all(req.user.id);
  const coverStmt = db.prepare(
    `SELECT DISTINCT album_mid FROM songs
     WHERE playlist_id = ? AND album_mid IS NOT NULL AND album_mid != ''
     ORDER BY sort_order ASC, added_at ASC LIMIT 4`
  );
  for (const p of rows) {
    p.cover_mids = coverStmt.all(p.id).map((r) => r.album_mid);
  }
  res.json({ playlists: rows });
});

// 新建歌单
router.post('/', (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: '歌单名不能为空' });
  const info = db
    .prepare('INSERT INTO playlists (user_id, name, created_at) VALUES (?, ?, ?)')
    .run(req.user.id, name, Date.now());
  res.json({ id: info.lastInsertRowid, name });
});

// 重命名歌单
router.put('/:id', (req, res) => {
  const pl = ownPlaylist(req.user.id, req.params.id);
  if (!pl) return res.status(404).json({ error: '歌单不存在' });
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: '歌单名不能为空' });
  db.prepare('UPDATE playlists SET name = ? WHERE id = ?').run(name, pl.id);
  res.json({ ok: true });
});

// 删除歌单
router.delete('/:id', (req, res) => {
  const pl = ownPlaylist(req.user.id, req.params.id);
  if (!pl) return res.status(404).json({ error: '歌单不存在' });
  db.prepare('DELETE FROM playlists WHERE id = ?').run(pl.id);
  res.json({ ok: true });
});

// 获取歌单内歌曲
router.get('/:id/songs', (req, res) => {
  const pl = ownPlaylist(req.user.id, req.params.id);
  if (!pl) return res.status(404).json({ error: '歌单不存在' });
  const songs = db
    .prepare('SELECT * FROM songs WHERE playlist_id = ? ORDER BY sort_order ASC, added_at ASC, id ASC')
    .all(pl.id);
  res.json({ playlist: pl, songs });
});

// 批量添加歌曲到歌单（自动去重：同名+歌手）
router.post('/:id/songs', (req, res) => {
  const pl = ownPlaylist(req.user.id, req.params.id);
  if (!pl) return res.status(404).json({ error: '歌单不存在' });
  const list = Array.isArray(req.body?.songs) ? req.body.songs : [];
  if (list.length === 0) return res.status(400).json({ error: '没有要添加的歌曲' });

  const existing = db
    .prepare('SELECT name, singer FROM songs WHERE playlist_id = ?')
    .all(pl.id);
  const seen = new Set(existing.map((s) => `${s.name}__${s.singer}`));

  const insert = db.prepare(
    `INSERT INTO songs (playlist_id, song_mid, name, singer, album, album_mid, duration, source, sort_order, added_at)
     VALUES (@playlist_id, @song_mid, @name, @singer, @album, @album_mid, @duration, @source, @sort_order, @added_at)`
  );
  let added = 0;
  const now = Date.now();
  const tx = db.transaction((songs) => {
    for (const s of songs) {
      if (!s.name) continue;
      const key = `${s.name}__${s.singer || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      insert.run({
        playlist_id: pl.id,
        song_mid: s.song_mid || '',
        name: s.name,
        singer: s.singer || '',
        album: s.album || '',
        album_mid: s.album_mid || '',
        duration: s.duration || 0,
        source: s.source || 'qqmusic',
        sort_order: now + added, // 追加到末尾
        added_at: now + added,
      });
      added++;
    }
  });
  tx(list);
  res.json({ added, skipped: list.length - added });
});

// 重新排序歌单（拖拽排序）：body { orderedIds: [songId, ...] }
router.put('/:id/reorder', (req, res) => {
  const pl = ownPlaylist(req.user.id, req.params.id);
  if (!pl) return res.status(404).json({ error: '歌单不存在' });
  const ids = Array.isArray(req.body?.orderedIds) ? req.body.orderedIds : [];
  if (ids.length === 0) return res.status(400).json({ error: '缺少排序数据' });
  const upd = db.prepare('UPDATE songs SET sort_order = ? WHERE id = ? AND playlist_id = ?');
  const tx = db.transaction((arr) => {
    arr.forEach((songId, idx) => upd.run(idx, Number(songId), pl.id));
  });
  tx(ids);
  res.json({ ok: true });
});

// 导出单个歌单（JSON 备份）
router.get('/:id/export', (req, res) => {
  const pl = ownPlaylist(req.user.id, req.params.id);
  if (!pl) return res.status(404).json({ error: '歌单不存在' });
  const songs = db
    .prepare('SELECT * FROM songs WHERE playlist_id = ? ORDER BY sort_order ASC, added_at ASC, id ASC')
    .all(pl.id);
  res.json({
    wemusic_export: true,
    version: 1,
    exported_at: Date.now(),
    name: pl.name,
    songs: songs.map((s) => ({
      song_mid: s.song_mid, name: s.name, singer: s.singer,
      album: s.album, album_mid: s.album_mid, duration: s.duration,
      source: s.source, bvid: s.bvid || '',
    })),
  });
});

// 导入歌单：新建歌单并写入歌曲。body { name, songs: [...] }
router.post('/import', (req, res) => {
  const { name, songs } = req.body || {};
  const list = Array.isArray(songs) ? songs : [];
  const plName = (name || '导入的歌单').toString().slice(0, 80);
  if (list.length === 0) return res.status(400).json({ error: '没有可导入的歌曲' });

  const now = Date.now();
  const info = db
    .prepare('INSERT INTO playlists (user_id, name, created_at) VALUES (?, ?, ?)')
    .run(req.user.id, plName, now);
  const playlistId = info.lastInsertRowid;

  const insert = db.prepare(
    `INSERT INTO songs (playlist_id, song_mid, name, singer, album, album_mid, duration, source, bvid, sort_order, added_at)
     VALUES (@playlist_id, @song_mid, @name, @singer, @album, @album_mid, @duration, @source, @bvid, @sort_order, @added_at)`
  );
  const seen = new Set();
  let added = 0;
  const tx = db.transaction((arr) => {
    for (const s of arr) {
      if (!s || !s.name) continue;
      const key = `${s.name}__${s.singer || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      insert.run({
        playlist_id: playlistId,
        song_mid: s.song_mid || '',
        name: s.name,
        singer: s.singer || '',
        album: s.album || '',
        album_mid: s.album_mid || '',
        duration: s.duration || 0,
        source: s.source || 'qqmusic',
        bvid: s.bvid || null,
        sort_order: now + added,
        added_at: now + added,
      });
      added++;
    }
  });
  tx(list);
  res.json({ id: playlistId, name: plName, added });
});

// 从歌单删除歌曲
router.delete('/:id/songs/:songId', (req, res) => {
  const pl = ownPlaylist(req.user.id, req.params.id);
  if (!pl) return res.status(404).json({ error: '歌单不存在' });
  db.prepare('DELETE FROM songs WHERE id = ? AND playlist_id = ?').run(
    req.params.songId,
    pl.id
  );
  res.json({ ok: true });
});

// 缓存歌曲匹配到的 Bilibili 视频
router.put('/:id/songs/:songId/bvid', (req, res) => {
  const pl = ownPlaylist(req.user.id, req.params.id);
  if (!pl) return res.status(404).json({ error: '歌单不存在' });
  const { bvid, cid } = req.body || {};
  db.prepare('UPDATE songs SET bvid = ?, cid = ? WHERE id = ? AND playlist_id = ?').run(
    bvid || null,
    cid || null,
    req.params.songId,
    pl.id
  );
  res.json({ ok: true });
});

export default router;
