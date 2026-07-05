import express from 'express';
import db from '../db.js';
import { authRequired } from '../middleware/auth.js';
import { requireRole } from '../middleware/admin.js';

const router = express.Router();

// 所有管理接口都要登录
router.use(authRequired);

// ============ 当前用户角色查询 ============
router.get('/me', (req, res) => {
  const row = db.prepare('SELECT role, status, archived_at FROM users WHERE id = ?').get(req.user.id);
  res.json({ role: row?.role || 'user' });
});

// ============ 数据看板 ============
router.get('/overview', requireRole('viewer'), (req, res) => {
  const userCount = db.prepare('SELECT COUNT(*) AS cnt FROM users WHERE archived_at IS NULL').get().cnt;
  const archivedCount = db.prepare('SELECT COUNT(*) AS cnt FROM users WHERE archived_at IS NOT NULL').get().cnt;
  const feedbackCount = db.prepare('SELECT COUNT(*) AS cnt FROM feedback').get().cnt;
  const totalSec = db.prepare('SELECT SUM(played_sec) AS sec FROM play_logs').get().sec || 0;
  const songCount = db.prepare('SELECT COUNT(*) AS cnt FROM songs').get().cnt;
  const playlistCount = db.prepare('SELECT COUNT(*) AS cnt FROM playlists').get().cnt;
  const todaySec = db.prepare(
    'SELECT SUM(played_sec) AS sec FROM play_logs WHERE played_at >= ?',
  ).get(Date.now() - 86400000).sec || 0;

  res.json({
    userCount,
    archivedCount,
    feedbackCount,
    totalSec,
    todaySec,
    songCount,
    playlistCount,
  });
});

// 播放趋势（近 7 天每天播放秒数）
router.get('/play-trend', requireRole('viewer'), (req, res) => {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const start = Date.now() - (i + 1) * 86400000;
    const end = Date.now() - i * 86400000;
    const sec = db.prepare(
      'SELECT SUM(played_sec) AS sec FROM play_logs WHERE played_at >= ? AND played_at < ?',
    ).get(start, end).sec || 0;
    const date = new Date(end).toISOString().slice(5, 10);
    days.push({ date, sec });
  }
  res.json(days);
});

// 热门歌曲 Top 20
router.get('/top-songs', requireRole('viewer'), (req, res) => {
  const rows = db.prepare(`
    SELECT name, singer, COUNT(*) AS play_count, SUM(played_sec) AS total_sec
    FROM play_logs GROUP BY name, singer ORDER BY play_count DESC LIMIT 20
  `).all();
  res.json(rows);
});

// ============ 用户管理 ============
router.get('/users', requireRole('moderator'), (req, res) => {
  const { page = 1, limit = 50, search = '', status = '', role = '' } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  let where = 'WHERE 1=1';
  const params = [];
  if (search) { where += ' AND username LIKE ?'; params.push(`%${search}%`); }
  if (status) { where += ' AND status = ?'; params.push(status); }
  if (role) { where += ' AND role = ?'; params.push(role); }

  const total = db.prepare(`SELECT COUNT(*) AS cnt FROM users ${where}`).get(...params).cnt;
  const rows = db.prepare(`
    SELECT id, username, role, status, archived_at, created_at, last_login_at, avatar
    FROM users ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(...params, Number(limit), offset);

  res.json({ users: rows, total, page: Number(page), limit: Number(limit) });
});

// 用户详情
router.get('/users/:id', requireRole('moderator'), (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: '用户不存在' });

  // 播放数量、时长
  const playCount = db.prepare('SELECT COUNT(*) AS cnt FROM play_logs WHERE user_id = ?').get(user.id).cnt;
  const totalSec = db.prepare('SELECT SUM(played_sec) AS sec FROM play_logs WHERE user_id = ?').get(user.id).sec || 0;
  const songCount = db.prepare(
    'SELECT COUNT(*) AS cnt FROM songs s JOIN playlists pl ON s.playlist_id = pl.id WHERE pl.user_id = ?',
  ).get(user.id).cnt;
  const playlistCount = db.prepare('SELECT COUNT(*) AS cnt FROM playlists WHERE user_id = ?').get(user.id).cnt;

  res.json({
    id: user.id,
    username: user.username,
    role: user.role,
    status: user.status,
    archived_at: user.archived_at,
    created_at: user.created_at,
    last_login_at: user.last_login_at,
    playCount,
    totalSec,
    songCount,
    playlistCount,
  });
});

// 修改用户角色
router.put('/users/:id/role', requireRole('super_admin'), (req, res) => {
  const { role } = req.body;
  if (!['super_admin', 'admin', 'moderator', 'viewer', 'user'].includes(role)) {
    return res.status(400).json({ error: '无效角色' });
  }
  // 不能降级自己
  const target = db.prepare('SELECT id, username FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: '用户不存在' });
  if (target.username === req.user.username) {
    return res.status(400).json({ error: '不能修改自己的角色' });
  }

  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.id);
  audit('role_change', req.user.username, target.username, JSON.stringify({ role }), req.ip);
  res.json({ ok: true });
});

// 归档用户
router.post('/users/:id/archive', requireRole('super_admin'), (req, res) => {
  const target = db.prepare('SELECT id, username FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: '用户不存在' });
  if (target.username === req.user.username) {
    return res.status(400).json({ error: '不能归档自己' });
  }
  db.prepare('UPDATE users SET archived_at = ? WHERE id = ?').run(Date.now(), req.params.id);
  audit('archive_user', req.user.username, target.username, '', req.ip);
  res.json({ ok: true });
});

// 恢复归档用户
router.post('/users/:id/restore', requireRole('super_admin'), (req, res) => {
  const target = db.prepare('SELECT id, username FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: '用户不存在' });
  db.prepare('UPDATE users SET archived_at = NULL WHERE id = ?').run(req.params.id);
  audit('restore_user', req.user.username, target.username, '', req.ip);
  res.json({ ok: true });
});

// 更新用户状态
router.put('/users/:id/status', requireRole('admin'), (req, res) => {
  const { status } = req.body;
  if (!['active', 'warned', 'banned'].includes(status)) {
    return res.status(400).json({ error: '无效状态' });
  }
  const target = db.prepare('SELECT id, username FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: '用户不存在' });
  db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, req.params.id);
  audit('change_status', req.user.username, target.username, JSON.stringify({ status }), req.ip);
  res.json({ ok: true });
});

// 获取归档用户列表
router.get('/archived-users', requireRole('super_admin'), (req, res) => {
  const users = db.prepare(
    'SELECT id, username, archived_at, created_at FROM users WHERE archived_at IS NOT NULL ORDER BY archived_at DESC',
  ).all();
  res.json({ users });
});

// 删除用户及所有数据（须超级管理员，双重确认通过 body.confirmUsername）
router.delete('/users/:id', requireRole('super_admin'), (req, res) => {
  const { confirmUsername } = req.body || {};
  const target = db.prepare('SELECT id, username, archived_at FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: '用户不存在' });
  if (target.username === req.user.username) {
    return res.status(400).json({ error: '不能删除自己' });
  }
  if (!target.archived_at) {
    return res.status(400).json({ error: '请先将用户归档，再执行删除' });
  }
  if (confirmUsername !== target.username) {
    return res.status(400).json({ error: '请确认用户名后再删除（输入目标用户名）' });
  }

  // 级联删除（SQLite foreign key ON DELETE CASCADE 会处理关联数据）
  db.prepare('DELETE FROM users WHERE id = ?').run(target.id);
  audit('delete_user', req.user.username, target.username, '', req.ip);
  res.json({ ok: true });
});

// ============ 内容审核 ============

// 反馈列表
router.get('/feedback', requireRole('moderator'), (req, res) => {
  const { page = 1, limit = 50 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);
  const total = db.prepare('SELECT COUNT(*) AS cnt FROM feedback').get().cnt;
  const rows = db.prepare(`
    SELECT f.*, u.username FROM feedback f
    JOIN users u ON u.id = f.user_id
    ORDER BY f.created_at DESC LIMIT ? OFFSET ?
  `).all(Number(limit), offset);
  res.json({ feedback: rows, total, page: Number(page), limit: Number(limit) });
});

router.delete('/feedback/:id', requireRole('moderator'), (req, res) => {
  db.prepare('DELETE FROM feedback WHERE id = ?').run(req.params.id);
  audit('delete_feedback', req.user.username, `#${req.params.id}`, '', req.ip);
  res.json({ ok: true });
});

// 屏蔽源管理（从 blocked_sources 全局查询）
router.get('/blocked-sources', requireRole('moderator'), (req, res) => {
  const { page = 1, limit = 50 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);
  const total = db.prepare('SELECT COUNT(*) AS cnt FROM blocked_sources').get().cnt;
  const rows = db.prepare(`
    SELECT bs.*, u.username FROM blocked_sources bs
    JOIN users u ON u.id = bs.user_id
    ORDER BY bs.blocked_at DESC LIMIT ? OFFSET ?
  `).all(Number(limit), offset);
  res.json({ blocked: rows, total, page: Number(page), limit: Number(limit) });
});

// 批量取消屏蔽
router.post('/blocked-sources/batch-delete', requireRole('moderator'), (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: '请提供要取消屏蔽的 ID 列表' });
  }
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`DELETE FROM blocked_sources WHERE rowid IN (${placeholders})`).run(...ids);
  audit('batch_unblock', req.user.username, '', JSON.stringify({ count: ids.length }), req.ip);
  res.json({ ok: true, count: ids.length });
});

// ============ 敏感词库 ============
router.get('/sensitive-words', requireRole('moderator'), (req, res) => {
  const { category = '', page = 1, limit = 200 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);
  let where = '';
  const params = [];
  if (category) { where = 'WHERE category = ?'; params.push(category); }
  const total = db.prepare(`SELECT COUNT(*) AS cnt FROM sensitive_words ${where}`).get(...params).cnt;
  const words = db.prepare(
    `SELECT * FROM sensitive_words ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  ).all(...params, Number(limit), offset);
  res.json({ words, total, page: Number(page), limit: Number(limit) });
});

router.post('/sensitive-words', requireRole('moderator'), (req, res) => {
  const { word, category = 'other' } = req.body;
  if (!word || typeof word !== 'string') return res.status(400).json({ error: '请输入词汇' });
  try {
    db.prepare('INSERT INTO sensitive_words (word, category, added_by, created_at) VALUES (?, ?, ?, ?)')
      .run(word.trim(), category, req.user.username, Date.now());
    res.json({ ok: true });
  } catch (e) {
    if (e.message?.includes('UNIQUE')) return res.status(409).json({ error: '该词汇已存在' });
    throw e;
  }
});

router.delete('/sensitive-words/:id', requireRole('admin'), (req, res) => {
  db.prepare('DELETE FROM sensitive_words WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ============ 系统配置 ============
router.get('/config', requireRole('admin'), (req, res) => {
  const rows = db.prepare('SELECT key, value, updated_by, updated_at FROM system_config').all();
  const config = {};
  rows.forEach((r) => {
    try { config[r.key] = JSON.parse(r.value); } catch { config[r.key] = r.value; }
  });
  res.json(config);
});

router.put('/config/:key', requireRole('admin'), (req, res) => {
  const { value } = req.body;
  if (value === undefined) return res.status(400).json({ error: '缺少 value' });
  db.prepare(
    'INSERT OR REPLACE INTO system_config (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?)',
  ).run(req.params.key, JSON.stringify(value), req.user.username, Date.now());
  audit('update_config', req.user.username, req.params.key, JSON.stringify(value), req.ip);
  res.json({ ok: true });
});

// ============ 审计日志 ============
router.get('/audit-logs', requireRole('viewer'), (req, res) => {
  const { page = 1, limit = 100, action = '', operator = '' } = req.query;
  const offset = (Number(page) - 1) * Number(limit);
  let where = 'WHERE 1=1';
  const params = [];
  if (action) { where += ' AND action = ?'; params.push(action); }
  if (operator) { where += ' AND operator LIKE ?'; params.push(`%${operator}%`); }
  const total = db.prepare(`SELECT COUNT(*) AS cnt FROM audit_logs ${where}`).get(...params).cnt;
  const rows = db.prepare(
    `SELECT * FROM audit_logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  ).all(...params, Number(limit), offset);
  res.json({ logs: rows, total, page: Number(page), limit: Number(limit) });
});

// ============ 系统监控 ============
router.get('/health', requireRole('viewer'), (req, res) => {
  const mem = process.memoryUsage();
  const uptime = process.uptime();
  const dbSize = db.prepare('SELECT page_count * page_size AS size FROM pragma_page_count(), pragma_page_size()').get().size || 0;
  const userCount = db.prepare('SELECT COUNT(*) AS cnt FROM users').get().cnt;
  const playCount = db.prepare('SELECT COUNT(*) AS cnt FROM play_logs').get().cnt;

  res.json({
    memory: {
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024 * 100) / 100 + ' MB',
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024 * 100) / 100 + ' MB',
      rss: Math.round(mem.rss / 1024 / 1024 * 100) / 100 + ' MB',
    },
    uptime: Math.round(uptime),
    dbSize: Math.round(dbSize / 1024 / 1024 * 100) / 100 + ' MB',
    userCount,
    playCount,
    nodeVersion: process.version,
  });
});

// ============ 工具函数 ============
function audit(action, operator, target, detail, ip) {
  try {
    db.prepare(
      'INSERT INTO audit_logs (operator, target, action, detail, ip, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(operator, target, action, detail, ip || '', Date.now());
  } catch (e) {
    console.error('[audit] 写入审计日志失败:', e.message);
  }
}

export default router;
