/**
 * 数据迁移路由：管理员导出/导入用户数据
 */
import express from 'express';
import db from '../db.js';
import { authRequired } from '../middleware/auth.js';
import { requireRole } from '../middleware/admin.js';

const router = express.Router();

// 所有接口需要登录 + admin 权限
router.use(authRequired);
router.use(requireRole('admin'));

// ============================================================
// 获取可导出用户列表（不含归档用户）
// ============================================================
router.get('/users', (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.username, u.role, u.status, u.created_at,
      (SELECT COUNT(*) FROM playlists WHERE user_id = u.id) AS playlist_count,
      (SELECT COUNT(*) FROM play_logs WHERE user_id = u.id) AS log_count
    FROM users u
    WHERE u.archived_at IS NULL
    ORDER BY u.id
  `).all();
  res.json({ users });
});

// ============================================================
// 导出单个用户全部数据
// ============================================================
router.get('/export/:userId', (req, res) => {
  const userId = Number(req.params.userId);
  if (!userId || userId < 1) return res.status(400).json({ error: '无效的用户 ID' });

  // 查询用户
  const user = db.prepare(`
    SELECT username, password_hash, role, status, created_at
    FROM users WHERE id = ?
  `).get(userId);
  if (!user) return res.status(404).json({ error: '用户不存在' });

  // 查询歌单（含歌曲）
  const playlists = db.prepare(`
    SELECT id, name, sort_order, created_at, "desc"
    FROM playlists WHERE user_id = ? ORDER BY sort_order, id
  `).all(userId);

  const stmtSongs = db.prepare(`
    SELECT song_mid, name, singer, album, album_mid, duration,
           source, bvid, cid, sort_order, added_at
    FROM songs WHERE playlist_id = ? ORDER BY sort_order, id
  `);
  for (const pl of playlists) {
    pl.songs = stmtSongs.all(pl.id);
    delete pl.id; // 不导出内部 ID
  }

  // 查询红心
  const likes = db.prepare(`
    SELECT song_mid, name, singer, album, album_mid, duration, liked_at
    FROM likes WHERE user_id = ? ORDER BY liked_at
  `).all(userId);

  // 查询播放日志
  const play_logs = db.prepare(`
    SELECT song_mid, name, singer, album, album_mid, duration,
           played_sec, bvid, played_at
    FROM play_logs WHERE user_id = ? ORDER BY played_at
  `).all(userId);

  // 查询偏好设置
  const prefRow = db.prepare(`
    SELECT data FROM user_preferences WHERE user_id = ?
  `).get(userId);
  let preferences = {};
  if (prefRow) {
    try { preferences = JSON.parse(prefRow.data); } catch { preferences = {}; }
  }

  // 查询收藏专辑
  const saved_albums = db.prepare(`
    SELECT album_mid, name, singer, "desc", company, genre, lan, aDate, saved_at
    FROM saved_albums WHERE user_id = ? ORDER BY saved_at
  `).all(userId);

  // 查询屏蔽源
  const blocked_sources = db.prepare(`
    SELECT song_key, source_type, source_id, name, artist, source_label, blocked_at
    FROM blocked_sources WHERE user_id = ? ORDER BY blocked_at
  `).all(userId);

  // 查询反馈
  const feedback = db.prepare(`
    SELECT type, content, created_at
    FROM feedback WHERE user_id = ? ORDER BY created_at
  `).all(userId);

  const exportData = {
    version: 1,
    exported_at: new Date().toISOString(),
    source: 'wemusic-data-export',
    user,
    playlists,
    likes,
    play_logs,
    preferences,
    saved_albums,
    blocked_sources,
    feedback,
  };

  // RFC 5987：filename 必须是 ASCII，含中文/非 Latin1 字符会导致 Node setHeader 抛
  // "Invalid character in header content" → 500。用 ASCII fallback + UTF-8 编码的中文名。
  const asciiName = `wemusic-user${userId}-export.json`;
  const utf8Name = `wemusic-${user.username}-export.json`;
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(utf8Name)}`,
  );
  res.json(exportData);
});

// ============================================================
// 导出 system_config（排除 webhook_url）
// ============================================================
router.get('/export-config', (req, res) => {
  const rows = db.prepare(`
    SELECT key, value, updated_by, updated_at
    FROM system_config WHERE key != 'webhook_url'
  `).all();
  const config = {};
  for (const r of rows) {
    try { config[r.key] = JSON.parse(r.value); } catch { config[r.key] = r.value; }
  }
  res.setHeader('Content-Disposition', 'attachment; filename="wemusic-config-export.json"');
  res.json({
    version: 1,
    exported_at: new Date().toISOString(),
    type: 'system_config',
    config,
  });
});

// ============================================================
// 导入用户数据（事务性导入）
// ============================================================
router.post('/import', (req, res) => {
  const data = req.body;
  if (!data || data.version !== 1) {
    return res.status(400).json({ error: '无效的导出文件格式' });
  }
  if (!data.user || !data.user.username) {
    return res.status(400).json({ error: '缺少用户信息' });
  }

  const { user, playlists, likes, play_logs, preferences,
          saved_albums, blocked_sources, feedback } = data;

  // 检查用户名冲突
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(user.username);
  if (exists) {
    return res.status(400).json({ error: `用户名 "${user.username}" 已存在` });
  }

  // 预览摘要
  const summary = {
    username: user.username,
    playlists: (playlists || []).length,
    songs: (playlists || []).reduce((s, pl) => s + (pl.songs || []).length, 0),
    likes: (likes || []).length,
    play_logs: (play_logs || []).length,
    saved_albums: (saved_albums || []).length,
    blocked_sources: (blocked_sources || []).length,
    feedback: (feedback || []).length,
  };

  // 开启事务
  const txn = db.transaction(() => {
    // 1. 创建用户
    const userResult = db.prepare(`
      INSERT INTO users (username, password_hash, role, status, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      user.username,
      user.password_hash,
      user.role || 'user',
      user.status || 'active',
      user.created_at || Date.now(),
    );
    const newUserId = userResult.lastInsertRowid;

    // 2. 创建歌单及歌曲
    const insertPlaylist = db.prepare(`
      INSERT INTO playlists (user_id, name, sort_order, "desc", created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    const insertSong = db.prepare(`
      INSERT INTO songs (playlist_id, song_mid, name, singer, album, album_mid,
        duration, source, bvid, cid, sort_order, added_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    if (playlists && playlists.length > 0) {
      for (const pl of playlists) {
        const plResult = insertPlaylist.run(
          newUserId, pl.name, pl.sort_order || 0, pl.desc || '', pl.created_at || Date.now(),
        );
        const newPlId = plResult.lastInsertRowid;
        if (pl.songs && pl.songs.length > 0) {
          for (const s of pl.songs) {
            insertSong.run(
              newPlId, s.song_mid || null, s.name, s.singer || null,
              s.album || null, s.album_mid || null, s.duration || 0,
              s.source || 'qqmusic', s.bvid || null, s.cid || null,
              s.sort_order || 0, s.added_at || Date.now(),
            );
          }
        }
      }
    }

    // 3. 导入红心
    const insertLike = db.prepare(`
      INSERT OR IGNORE INTO likes (user_id, song_mid, name, singer, album, album_mid, duration, liked_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    if (likes && likes.length > 0) {
      for (const l of likes) {
        insertLike.run(
          newUserId, l.song_mid || '', l.name, l.singer || null,
          l.album || null, l.album_mid || null, l.duration || 0,
          l.liked_at || Date.now(),
        );
      }
    }

    // 4. 导入播放日志
    const insertLog = db.prepare(`
      INSERT INTO play_logs (user_id, song_mid, name, singer, album, album_mid,
        duration, played_sec, bvid, played_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    if (play_logs && play_logs.length > 0) {
      for (const log of play_logs) {
        insertLog.run(
          newUserId, log.song_mid || null, log.name, log.singer || null,
          log.album || null, log.album_mid || null, log.duration || 0,
          log.played_sec || 0, log.bvid || null, log.played_at || Date.now(),
        );
      }
    }

    // 5. 导入偏好设置
    if (preferences && Object.keys(preferences).length > 0) {
      db.prepare(`
        INSERT INTO user_preferences (user_id, data, updated_at)
        VALUES (?, ?, ?)
      `).run(newUserId, JSON.stringify(preferences), Date.now());
    }

    // 6. 导入收藏专辑
    const insertAlbum = db.prepare(`
      INSERT OR IGNORE INTO saved_albums (user_id, album_mid, name, singer,
        "desc", company, genre, lan, aDate, saved_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    if (saved_albums && saved_albums.length > 0) {
      for (const a of saved_albums) {
        insertAlbum.run(
          newUserId, a.album_mid, a.name, a.singer || null,
          a.desc || '', a.company || '', a.genre || '', a.lan || '',
          a.aDate || '', a.saved_at || Date.now(),
        );
      }
    }

    // 7. 导入屏蔽源
    const insertBlocked = db.prepare(`
      INSERT OR IGNORE INTO blocked_sources (user_id, song_key, source_type, source_id,
        name, artist, source_label, blocked_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    if (blocked_sources && blocked_sources.length > 0) {
      for (const b of blocked_sources) {
        insertBlocked.run(
          newUserId, b.song_key || '', b.source_type || '', b.source_id || '',
          b.name || null, b.artist || null, b.source_label || null,
          b.blocked_at || Date.now(),
        );
      }
    }

    // 8. 导入反馈
    const insertFeedback = db.prepare(`
      INSERT INTO feedback (user_id, type, content, created_at)
      VALUES (?, ?, ?, ?)
    `);
    if (feedback && feedback.length > 0) {
      for (const f of feedback) {
        insertFeedback.run(
          newUserId, f.type || 'other', f.content || '', f.created_at || Date.now(),
        );
      }
    }

    return { userId: newUserId, summary };
  });

  try {
    const result = txn();
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error('[migration] 导入失败:', e.message);
    res.status(500).json({ error: `导入失败：${e.message}` });
  }
});

// ============================================================
// 导入 system_config
// ============================================================
router.post('/import-config', (req, res) => {
  const data = req.body;
  if (!data || data.type !== 'system_config' || !data.config) {
    return res.status(400).json({ error: '无效的配置文件格式' });
  }

  const cfg = data.config;
  const keys = Object.keys(cfg);
  if (keys.length === 0) {
    return res.status(400).json({ error: '配置为空' });
  }

  const txn = db.transaction(() => {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO system_config (key, value, updated_by, updated_at)
      VALUES (?, ?, ?, ?)
    `);
    for (const key of keys) {
      stmt.run(key, JSON.stringify(cfg[key]), req.user.username, Date.now());
    }
  });

  try {
    txn();
    res.json({ ok: true, count: keys.length });
  } catch (e) {
    console.error('[migration] 导入配置失败:', e.message);
    res.status(500).json({ error: `导入配置失败：${e.message}` });
  }
});

export default router;
