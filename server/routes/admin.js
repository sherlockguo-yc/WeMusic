import express from 'express';
import db from '../db.js';
import { authRequired } from '../middleware/auth.js';
import { requireRole } from '../middleware/admin.js';

const router = express.Router();

// 预热常用 prepared statements
const stmt = {
  me:    db.prepare('SELECT role, status, archived_at FROM users WHERE id = ?'),
  overviewUser:  db.prepare('SELECT COUNT(*) AS cnt FROM users WHERE archived_at IS NULL'),
  overviewArchived: db.prepare('SELECT COUNT(*) AS cnt FROM users WHERE archived_at IS NOT NULL'),
  overviewFeedback: db.prepare('SELECT COUNT(*) AS cnt FROM feedback'),
  overviewTotalSec: db.prepare('SELECT SUM(played_sec) AS sec FROM play_logs'),
  overviewSongs: db.prepare('SELECT COUNT(*) AS cnt FROM songs'),
  overviewPlaylists: db.prepare('SELECT COUNT(*) AS cnt FROM playlists'),
  overviewToday: db.prepare('SELECT SUM(played_sec) AS sec FROM play_logs WHERE played_at >= ?'),
  trend: db.prepare('SELECT SUM(played_sec) AS sec FROM play_logs WHERE played_at >= ? AND played_at < ?'),
  topSongs: db.prepare('SELECT name, singer, COUNT(*) AS play_count, SUM(played_sec) AS total_sec FROM play_logs GROUP BY name, singer ORDER BY play_count DESC LIMIT 20'),
  roleLookup: db.prepare('SELECT role FROM users WHERE id = ?'),
  userById: db.prepare('SELECT * FROM users WHERE id = ?'),
  userByUsername: db.prepare('SELECT id, username, role, archived_at FROM users WHERE username = ?'),
  archiveUser: db.prepare("UPDATE users SET archived_at = ?, status = 'banned' WHERE id = ?"),
  restoreUser: db.prepare("UPDATE users SET archived_at = NULL, status = 'active' WHERE id = ?"),
  updateRole: db.prepare('UPDATE users SET role = ? WHERE id = ?'),
  updateStatus: db.prepare('UPDATE users SET status = ? WHERE id = ?'),
  deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),
  archivedUsers: db.prepare('SELECT id, username, status, archived_at, created_at FROM users WHERE archived_at IS NOT NULL ORDER BY archived_at DESC'),
  feedbackTotal: db.prepare('SELECT COUNT(*) AS cnt FROM feedback'),
  feedbackDelete: db.prepare('DELETE FROM feedback WHERE id = ?'),
  blockedTotal: db.prepare('SELECT COUNT(*) AS cnt FROM blocked_sources'),
  auditInsert: db.prepare('INSERT INTO audit_logs (operator, target, action, detail, ip, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
  sensitiveInsert: db.prepare('INSERT INTO sensitive_words (word, category, added_by, created_at) VALUES (?, ?, ?, ?)'),
  sensitiveDelete: db.prepare('DELETE FROM sensitive_words WHERE id = ?'),
  configGetAll: db.prepare('SELECT key, value, updated_by, updated_at FROM system_config'),
  configSet: db.prepare('INSERT OR REPLACE INTO system_config (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?)'),
  healthMeta: db.prepare('SELECT page_count * page_size AS size FROM pragma_page_count(), pragma_page_size()'),
  healthUsers: db.prepare('SELECT COUNT(*) AS cnt FROM users'),
  healthPlay: db.prepare('SELECT COUNT(*) AS cnt FROM play_logs'),
};

// 所有管理接口都要登录
router.use(authRequired);

// ============ 当前用户角色查询 ============
router.get('/me', (req, res) => {
  const row = stmt.me.get(req.user.id);
  res.json({ role: row?.role || 'user' });
});

// ============ 数据看板 ============
router.get('/overview', requireRole('viewer'), (req, res) => {
  res.json({
    userCount:      stmt.overviewUser.get().cnt,
    archivedCount:  stmt.overviewArchived.get().cnt,
    feedbackCount:  stmt.overviewFeedback.get().cnt,
    totalSec:       stmt.overviewTotalSec.get().sec || 0,
    songCount:      stmt.overviewSongs.get().cnt,
    playlistCount:  stmt.overviewPlaylists.get().cnt,
    todaySec:       stmt.overviewToday.get(Date.now() - 86400000).sec || 0,
  });
});

// 播放趋势（近 7 天每天播放秒数）
router.get('/play-trend', requireRole('viewer'), (req, res) => {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const start = Date.now() - (i + 1) * 86400000;
    const end = Date.now() - i * 86400000;
    const sec = stmt.trend.get(start, end).sec || 0;
    days.push({ date: new Date(end).toISOString().slice(5, 10), sec });
  }
  res.json(days);
});

// 热门歌曲 Top 20
router.get('/top-songs', requireRole('viewer'), (req, res) => {
  res.json(stmt.topSongs.all());
});

// ============ 用户管理 ============
router.get('/users', requireRole('moderator'), (req, res) => {
  const { page = 1, limit = 50, search = '', status = '', role = '' } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  let where = 'WHERE archived_at IS NULL';
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
  const user = stmt.userById.get(req.params.id);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  const playCount = db.prepare('SELECT COUNT(*) AS cnt FROM play_logs WHERE user_id = ?').get(user.id).cnt;
  const totalSec = db.prepare('SELECT SUM(played_sec) AS sec FROM play_logs WHERE user_id = ?').get(user.id).sec || 0;
  const songCount = db.prepare('SELECT COUNT(*) AS cnt FROM songs s JOIN playlists pl ON s.playlist_id = pl.id WHERE pl.user_id = ?').get(user.id).cnt;
  const playlistCount = db.prepare('SELECT COUNT(*) AS cnt FROM playlists WHERE user_id = ?').get(user.id).cnt;
  res.json({ id: user.id, username: user.username, role: user.role, status: user.status, archived_at: user.archived_at, created_at: user.created_at, last_login_at: user.last_login_at, playCount, totalSec, songCount, playlistCount });
});

// 修改用户角色（已归档用户不可修改）
router.put('/users/:id/role', requireRole('super_admin'), (req, res) => {
  const { role } = req.body;
  if (!['super_admin', 'admin', 'moderator', 'viewer', 'user'].includes(role)) return res.status(400).json({ error: '无效角色' });
  const target = stmt.userById.get(req.params.id);
  if (!target) return res.status(404).json({ error: '用户不存在' });
  if (target.username === req.user.username) return res.status(400).json({ error: '不能修改自己的角色' });
  if (target.archived_at) return res.status(400).json({ error: '已归档用户不可修改角色' });
  stmt.updateRole.run(role, req.params.id);
  audit('role_change', req.user.username, target.username, JSON.stringify({ role }), req.ip);
  res.json({ ok: true });
});

// 归档用户
router.post('/users/:id/archive', requireRole('super_admin'), (req, res) => {
  const target = stmt.userById.get(req.params.id);
  if (!target) return res.status(404).json({ error: '用户不存在' });
  if (target.username === req.user.username) return res.status(400).json({ error: '不能归档自己' });
  stmt.archiveUser.run(Date.now(), req.params.id);
  audit('archive_user', req.user.username, target.username, '', req.ip);
  res.json({ ok: true });
});

// 恢复归档用户
router.post('/users/:id/restore', requireRole('super_admin'), (req, res) => {
  const target = stmt.userById.get(req.params.id);
  if (!target) return res.status(404).json({ error: '用户不存在' });
  stmt.restoreUser.run(req.params.id);
  audit('restore_user', req.user.username, target.username, '', req.ip);
  res.json({ ok: true });
});

// 更新用户状态
router.put('/users/:id/status', requireRole('admin'), (req, res) => {
  const { status } = req.body;
  if (!['active', 'warned', 'banned'].includes(status)) return res.status(400).json({ error: '无效状态' });
  const target = stmt.userById.get(req.params.id);
  if (!target) return res.status(404).json({ error: '用户不存在' });
  stmt.updateStatus.run(status, req.params.id);
  audit('change_status', req.user.username, target.username, JSON.stringify({ status }), req.ip);
  res.json({ ok: true });
});

// 获取归档用户列表
router.get('/archived-users', requireRole('super_admin'), (req, res) => {
  res.json({ users: stmt.archivedUsers.all() });
});

// 删除用户（须已归档 + 双重确认）
router.delete('/users/:id', requireRole('super_admin'), (req, res) => {
  const { confirmUsername } = req.body || {};
  const target = db.prepare('SELECT id, username, archived_at FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: '用户不存在' });
  if (target.username === req.user.username) return res.status(400).json({ error: '不能删除自己' });
  if (!target.archived_at) return res.status(400).json({ error: '请先将用户归档，再执行删除' });
  if (confirmUsername !== target.username) return res.status(400).json({ error: '请确认用户名后再删除（输入目标用户名）' });
  stmt.deleteUser.run(target.id);
  audit('delete_user', req.user.username, target.username, '', req.ip);
  res.json({ ok: true });
});

// ============ 内容审核 ============

// 反馈列表
router.get('/feedback', requireRole('moderator'), (req, res) => {
  const { page = 1, limit = 50 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);
  const total = stmt.feedbackTotal.get().cnt;
  const rows = db.prepare(`
    SELECT f.*, u.username FROM feedback f
    JOIN users u ON u.id = f.user_id
    ORDER BY f.created_at DESC LIMIT ? OFFSET ?
  `).all(Number(limit), offset);
  res.json({ feedback: rows, total, page: Number(page), limit: Number(limit) });
});

router.delete('/feedback/:id', requireRole('moderator'), (req, res) => {
  const exists = db.prepare('SELECT id FROM feedback WHERE id = ?').get(req.params.id);
  if (!exists) return res.status(404).json({ error: '反馈不存在' });
  stmt.feedbackDelete.run(req.params.id);
  audit('delete_feedback', req.user.username, `#${req.params.id}`, '', req.ip);
  res.json({ ok: true });
});

// 屏蔽源管理
router.get('/blocked-sources', requireRole('moderator'), (req, res) => {
  const { page = 1, limit = 50 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);
  const total = stmt.blockedTotal.get().cnt;
  const rows = db.prepare(`
    SELECT bs.*, u.username FROM blocked_sources bs
    JOIN users u ON u.id = bs.user_id
    ORDER BY bs.blocked_at DESC LIMIT ? OFFSET ?
  `).all(Number(limit), offset);
  res.json({ blocked: rows, total, page: Number(page), limit: Number(limit) });
});

// ============ 敏感词库 ============
router.get('/sensitive-words', requireRole('moderator'), (req, res) => {
  const { category = '', page = 1, limit = 200 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);
  let where = '';
  const params = [];
  if (category) { where = 'WHERE category = ?'; params.push(category); }
  const total = db.prepare(`SELECT COUNT(*) AS cnt FROM sensitive_words ${where}`).get(...params).cnt;
  const words = db.prepare(`SELECT * FROM sensitive_words ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, Number(limit), offset);
  res.json({ words, total, page: Number(page), limit: Number(limit) });
});

router.post('/sensitive-words', requireRole('moderator'), (req, res) => {
  const { word, category = 'other' } = req.body;
  if (!word || typeof word !== 'string') return res.status(400).json({ error: '请输入词汇' });
  try {
    stmt.sensitiveInsert.run(word.trim(), category, req.user.username, Date.now());
    audit('word_add', req.user.username, word.trim(), JSON.stringify({ category }), req.ip);
    res.json({ ok: true });
  } catch (e) {
    if (e.message?.includes('UNIQUE')) return res.status(409).json({ error: '该词汇已存在' });
    throw e;
  }
});

router.delete('/sensitive-words/:id', requireRole('admin'), (req, res) => {
  const row = db.prepare('SELECT word FROM sensitive_words WHERE id = ?').get(req.params.id);
  stmt.sensitiveDelete.run(req.params.id);
  if (row) audit('word_delete', req.user.username, row.word, '', req.ip);
  res.json({ ok: true });
});

// ============ 系统配置 ============
const ALLOWED_CONFIG_KEYS = ['allowRegister', 'discoverEnabled', 'searchEnabled', 'statsEnabled', 'likesEnabled'];

router.get('/config', requireRole('admin'), (req, res) => {
  const rows = stmt.configGetAll.all();
  const config = {};
  rows.forEach((r) => { try { config[r.key] = JSON.parse(r.value); } catch { config[r.key] = r.value; } });
  res.json(config);
});

router.put('/config/:key', requireRole('admin'), (req, res) => {
  if (!ALLOWED_CONFIG_KEYS.includes(req.params.key)) {
    return res.status(400).json({ error: '无效的配置项' });
  }
  const { value } = req.body;
  if (value === undefined) return res.status(400).json({ error: '缺少 value' });
  stmt.configSet.run(req.params.key, JSON.stringify(value), req.user.username, Date.now());
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
  const rows = db.prepare(`SELECT * FROM audit_logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, Number(limit), offset);
  res.json({ logs: rows, total, page: Number(page), limit: Number(limit) });
});

// ============ 系统监控 ============
router.get('/health', requireRole('viewer'), (req, res) => {
  const mem = process.memoryUsage();
  const uptime = process.uptime();
  res.json({
    memory: {
      heapUsed: Math.round(mem.heapUsed / 1048576 * 100) / 100 + ' MB',
      heapTotal: Math.round(mem.heapTotal / 1048576 * 100) / 100 + ' MB',
      rss: Math.round(mem.rss / 1048576 * 100) / 100 + ' MB',
    },
    uptime: Math.round(uptime),
    dbSize: Math.round((stmt.healthMeta.get().size || 0) / 1048576 * 100) / 100 + ' MB',
    userCount: stmt.healthUsers.get().cnt,
    playCount: stmt.healthPlay.get().cnt,
    nodeVersion: process.version,
  });
});

// ============ 工具函数 ============
function audit(action, operator, target, detail, ip) {
  try {
    stmt.auditInsert.run(operator, target, action, detail, ip || '', Date.now());
  } catch (e) {
    console.error('[audit] 写入审计日志失败:', e.message);
  }
}

export default router;
