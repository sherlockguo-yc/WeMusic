import express from 'express';
import db from '../db.js';
import { authRequired } from '../middleware/auth.js';

const router = express.Router();
router.use(authRequired);

// ---- 统一歌单归属校验（router.param 中间件，复用） ----
router.param('id', (req, res, next, id) => {
  const pl = db.prepare('SELECT * FROM playlists WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!pl) return res.status(404).json({ error: '歌单不存在' });
  req.playlist = pl;
  next();
});

// ---- 通用批量添加歌曲（自动去重） ----
function insertSongsBulk(playlistId, songs, extraFields = {}) {
  const existing = db.prepare('SELECT name, singer FROM songs WHERE playlist_id = ?').all(playlistId);
  const seen = new Set(existing.map((s) => `${s.name}__${s.singer}`));

  const insert = db.prepare(`
    INSERT INTO songs (playlist_id, song_mid, name, singer, album, album_mid, duration, source, bvid, sort_order, added_at)
    VALUES (@playlist_id, @song_mid, @name, @singer, @album, @album_mid, @duration, @source, @bvid, @sort_order, @added_at)
  `);
  let added = 0;
  const now = Date.now();
  const tx = db.transaction((arr) => {
    for (const s of arr) {
      if (!s || !s.name) continue;
      const key = `${s.name}__${s.singer || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      insert.run({
        playlist_id: playlistId,
        song_mid: s.song_mid || '',
        name: s.name, singer: s.singer || '', album: s.album || '', album_mid: s.album_mid || '',
        duration: s.duration || 0, source: s.source || 'qqmusic', bvid: s.bvid || null,
        sort_order: now + added, added_at: now + added,
        ...extraFields,
      });
      added++;
    }
  });
  tx(songs);
  return added;
}

// ---- 歌单列表 ----
router.get('/', (req, res) => {
  const rows = db.prepare(
    `SELECT p.*, (SELECT COUNT(*) FROM songs s WHERE s.playlist_id = p.id) AS count
     FROM playlists p WHERE p.user_id = ? ORDER BY p.sort_order ASC, p.created_at ASC`
  ).all(req.user.id);
  const coverStmt = db.prepare(
    `SELECT DISTINCT album_mid FROM songs WHERE playlist_id = ? AND album_mid IS NOT NULL AND album_mid != ''
     ORDER BY sort_order ASC, added_at ASC LIMIT 4`
  );
  for (const p of rows) p.cover_mids = coverStmt.all(p.id).map((r) => r.album_mid);
  res.json({ playlists: rows });
});

// ---- 歌单排序 ----
router.put('/reorder', (req, res) => {
  const ids = Array.isArray(req.body?.orderedIds) ? req.body.orderedIds : [];
  if (ids.length === 0) return res.status(400).json({ error: '缺少排序数据' });
  const upd = db.prepare('UPDATE playlists SET sort_order = ? WHERE id = ? AND user_id = ?');
  db.transaction((arr) => { arr.forEach((id, idx) => upd.run(idx, Number(id), req.user.id)); })(ids);
  res.json({ ok: true });
});

// ---- 新建歌单 ----
router.post('/', (req, res) => {
  const { name, desc } = req.body || {};
  if (!name) return res.status(400).json({ error: '歌单名不能为空' });
  const safeName = String(name).slice(0, 100);
  const safeDesc = String(desc || '').slice(0, 500);
  const info = db.prepare('INSERT INTO playlists (user_id, name, desc, created_at) VALUES (?, ?, ?, ?)').run(req.user.id, safeName, safeDesc, Date.now());
  res.json({ id: info.lastInsertRowid, name });
});

// ---- 编辑（名称/简介） / 删除 ----
router.put('/:id', (req, res) => {
  const { name, desc } = req.body || {};
  if (name !== undefined && !String(name).trim()) return res.status(400).json({ error: '歌单名不能为空' });
  const updates = [];
  const params = [];
  if (name !== undefined) { updates.push('name = ?'); params.push(String(name).trimStart().slice(0, 100)); }
  if (desc !== undefined) { updates.push('desc = ?'); params.push(String(desc).slice(0, 500)); }
  if (!updates.length) return res.status(400).json({ error: '请提供 name 或 desc' });
  params.push(req.playlist.id);
  db.prepare(`UPDATE playlists SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM playlists WHERE id = ?').run(req.playlist.id);
  res.json({ ok: true });
});

// ---- 获取歌单歌曲 ----
router.get('/:id/songs', (req, res) => {
  const songs = db.prepare('SELECT * FROM songs WHERE playlist_id = ? ORDER BY sort_order ASC, added_at ASC, id ASC').all(req.playlist.id);
  res.json({ playlist: req.playlist, songs });
});

// ---- 添加歌曲（复用的 insertSongsBulk） ----
router.post('/:id/songs', (req, res) => {
  const list = Array.isArray(req.body?.songs) ? req.body.songs : [];
  if (list.length === 0) return res.status(400).json({ error: '没有要添加的歌曲' });
  // 校验每首歌曲至少有歌名
  const invalid = list.filter(s => !s || !s.name);
  if (invalid.length === list.length) return res.status(400).json({ error: '所有歌曲缺少歌名' });
  const valid = list.filter(s => s && s.name);
  const added = insertSongsBulk(req.playlist.id, valid);
  res.json({ added, skipped: list.length - added });
});

// ---- 拖拽排序 ----
router.put('/:id/reorder', (req, res) => {
  const ids = Array.isArray(req.body?.orderedIds) ? req.body.orderedIds : [];
  if (ids.length === 0) return res.status(400).json({ error: '缺少排序数据' });
  const upd = db.prepare('UPDATE songs SET sort_order = ? WHERE id = ? AND playlist_id = ?');
  db.transaction((arr) => { arr.forEach((songId, idx) => upd.run(idx, Number(songId), req.playlist.id)); })(ids);
  res.json({ ok: true });
});

// ---- 导出 ----
router.get('/:id/export', (req, res) => {
  const songs = db.prepare('SELECT * FROM songs WHERE playlist_id = ? ORDER BY sort_order ASC, added_at ASC, id ASC').all(req.playlist.id);
  res.json({
    wemusic_export: true, version: 1, exported_at: Date.now(), name: req.playlist.name,
    songs: songs.map((s) => ({ song_mid: s.song_mid, name: s.name, singer: s.singer, album: s.album, album_mid: s.album_mid, duration: s.duration, source: s.source, bvid: s.bvid || '' })),
  });
});

// ---- 导入（新建歌单 + 插入歌曲） ----
router.post('/import', (req, res) => {
  const { name, songs } = req.body || {};
  const list = Array.isArray(songs) ? songs : [];
  if (list.length === 0) return res.status(400).json({ error: '没有可导入的歌曲' });
  const plName = String(name || '导入的歌单').slice(0, 80);
  const info = db.prepare('INSERT INTO playlists (user_id, name, created_at) VALUES (?, ?, ?)').run(req.user.id, plName, Date.now());
  const added = insertSongsBulk(info.lastInsertRowid, list);
  res.json({ id: info.lastInsertRowid, name: plName, added });
});

// ---- 删除单曲 / 缓存 bvid ----
router.delete('/:id/songs/:songId', (req, res) => {
  db.prepare('DELETE FROM songs WHERE id = ? AND playlist_id = ?').run(req.params.songId, req.playlist.id);
  res.json({ ok: true });
});

router.put('/:id/songs/:songId/bvid', (req, res) => {
  const { bvid, cid } = req.body || {};
  db.prepare('UPDATE songs SET bvid = ?, cid = ? WHERE id = ? AND playlist_id = ?').run(bvid || null, cid || null, req.params.songId, req.playlist.id);
  res.json({ ok: true });
});

export default router;
