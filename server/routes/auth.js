import express from 'express';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import { config } from '../config.js';
import { signToken, authRequired } from '../middleware/auth.js';

const router = express.Router();

// 用户名合法字符（防注入/XSS）
const USERNAME_RE = /^[a-zA-Z0-9_\u4e00-\u9fa5]{2,32}$/;

// 注册
router.post('/register', (req, res) => {
  if (!config.allowRegister) {
    return res.status(403).json({ error: '注册已关闭' });
  }
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }
  if (!USERNAME_RE.test(String(username))) {
    return res.status(400).json({ error: '用户名 2-32 位，只允许字母、数字、下划线、中文' });
  }
  if (String(password).length < 8) {
    return res.status(400).json({ error: '密码至少 8 位' });
  }
  if (String(password).length > 128) {
    return res.status(400).json({ error: '密码过长' });
  }
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exists) {
    return res.status(409).json({ error: '用户名已存在' });
  }
  const hash = bcrypt.hashSync(String(password), 12); // cost=12，比 10 更安全
  const info = db
    .prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)')
    .run(username, hash, Date.now());
  const userId = info.lastInsertRowid;
  db.prepare('INSERT INTO playlists (user_id, name, created_at) VALUES (?, ?, ?)').run(
    userId, '我喜欢的音乐', Date.now()
  );
  const token = signToken({ id: userId, username });
  res.json({ token, user: { id: userId, username } });
});

// 登录
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }
  // 用户名长度合理性检查（避免超长字符串拖慢查询）
  if (String(username).length > 64 || String(password).length > 256) {
    return res.status(401).json({ error: '用户名或密码错误' }); // 统一错误，防枚举
  }
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  // 无论用户是否存在，都执行 bcrypt 比较（防止通过响应时间枚举用户名）
  const dummyHash = '$2a$12$invalidhashforlengthpadding000000000000000000000000000000';
  const valid = user
    ? bcrypt.compareSync(String(password), user.password_hash)
    : (bcrypt.compareSync(String(password), dummyHash), false);
  if (!valid) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  // 检查是否被归档
  if (user.archived_at) {
    return res.status(403).json({ error: '该账号已被归档，无法登录' });
  }
  // 记录登录时间
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(Date.now(), user.id);
  const token = signToken({ id: user.id, username: user.username });
  res.json({ token, user: { id: user.id, username: user.username } });
});

// 当前用户
router.get('/me', authRequired, (req, res) => {
  const u = db.prepare('SELECT id, username, avatar, role FROM users WHERE id = ?').get(req.user.id);
  const isAdmin = (u?.role && u.role !== 'user') || false;
  res.json({ user: { ...req.user, avatar: u?.avatar || null, role: u?.role || 'user' }, allowRegister: config.allowRegister, isAdmin });
});

// 更新头像（base64 DataURL，限 300KB）
router.put('/avatar', authRequired, (req, res) => {
  const { avatar } = req.body || {};
  if (!avatar) return res.status(400).json({ error: '缺少 avatar' });
  if (typeof avatar !== 'string' || !avatar.startsWith('data:image/')) {
    return res.status(400).json({ error: '格式错误，须为图片 DataURL' });
  }
  // base64 部分字节数估算
  const b64 = avatar.split(',')[1] || '';
  if (b64.length > 400 * 1024) return res.status(413).json({ error: '图片过大，请压缩后上传（≤300KB）' });
  db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(avatar, req.user.id);
  res.json({ ok: true, avatar });
});

// ---- 用户偏好（服务端持久化，跨设备同步） ----
router.get('/preferences', authRequired, (req, res) => {
  const row = db.prepare('SELECT data FROM user_preferences WHERE user_id = ?').get(req.user.id);
  res.json({ data: row ? JSON.parse(row.data) : {} });
});

router.put('/preferences', authRequired, (req, res) => {
  const { data } = req.body || {};
  if (!data || typeof data !== 'object') return res.status(400).json({ error: '无效数据' });
  // merge 现有数据，防止 syncPrefsToServer 全量覆盖时抹掉 customPalettes 等字段
  const row = db.prepare('SELECT data FROM user_preferences WHERE user_id = ?').get(req.user.id);
  const existing = row ? JSON.parse(row.data) : {};
  const merged = { ...existing, ...data };
  db.prepare('INSERT OR REPLACE INTO user_preferences (user_id, data, updated_at) VALUES (?, ?, ?)')
    .run(req.user.id, JSON.stringify(merged), Date.now());
  res.json({ ok: true });
});

// ---- 自定义主题色 ----
router.get('/custom-palettes', authRequired, (req, res) => {
  const row = db.prepare('SELECT data FROM user_preferences WHERE user_id = ?').get(req.user.id);
  const prefs = row ? JSON.parse(row.data) : {};
  res.json({ customPalettes: prefs.customPalettes || [] });
});

router.post('/custom-palettes', authRequired, (req, res) => {
  const { name, color } = req.body || {};
  if (!color || typeof color !== 'string' || !/^#[0-9a-fA-F]{3,6}$/.test(color)) {
    return res.status(400).json({ error: '无效颜色' });
  }
  const row = db.prepare('SELECT data FROM user_preferences WHERE user_id = ?').get(req.user.id);
  const prefs = row ? JSON.parse(row.data) : {};
  const list = prefs.customPalettes || [];
  if (list.length >= 8) return res.status(400).json({ error: '已达上限（8个）' });
  const id = Math.random().toString(36).slice(2, 10);
  const entry = { id, name: String(name || '').slice(0, 20), color: color.toLowerCase(), createdAt: Date.now() };
  list.push(entry);
  prefs.customPalettes = list;
  db.prepare('INSERT OR REPLACE INTO user_preferences (user_id, data, updated_at) VALUES (?, ?, ?)')
    .run(req.user.id, JSON.stringify(prefs), Date.now());
  res.json({ palette: entry });
});

router.delete('/custom-palettes/:id', authRequired, (req, res) => {
  const row = db.prepare('SELECT data FROM user_preferences WHERE user_id = ?').get(req.user.id);
  const prefs = row ? JSON.parse(row.data) : {};
  const list = prefs.customPalettes || [];
  const idx = list.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '未找到' });
  list.splice(idx, 1);
  prefs.customPalettes = list;
  db.prepare('INSERT OR REPLACE INTO user_preferences (user_id, data, updated_at) VALUES (?, ?, ?)')
    .run(req.user.id, JSON.stringify(prefs), Date.now());
  res.json({ ok: true });
});

// ---- 播放会话跨设备同步 ----
router.get('/session', authRequired, (req, res) => {
  const row = db.prepare('SELECT data FROM user_preferences WHERE user_id = ?').get(req.user.id);
  const prefs = row ? JSON.parse(row.data) : {};
  res.json({ queue: prefs._sessionQueue || [], queueIndex: prefs._sessionIndex ?? -1 });
});

router.put('/session', authRequired, (req, res) => {
  const { queue, queueIndex } = req.body || {};
  if (!Array.isArray(queue)) return res.status(400).json({ error: '无效队列' });
  // 合并到现有 preferences（不覆盖主题等偏好）
  const row = db.prepare('SELECT data FROM user_preferences WHERE user_id = ?').get(req.user.id);
  const prefs = row ? JSON.parse(row.data) : {};
  prefs._sessionQueue = queue.slice(0, 500);
  prefs._sessionIndex = Number(queueIndex) || 0;
  db.prepare('INSERT OR REPLACE INTO user_preferences (user_id, data, updated_at) VALUES (?, ?, ?)')
    .run(req.user.id, JSON.stringify(prefs), Date.now());
  res.json({ ok: true });
});

// ---- 管理员端点（向后兼容，实际权限由 /api/admin 接管） ----
function adminOnly(req, res, next) {
  const row = db.prepare('SELECT role FROM users WHERE id = ?').get(req.user.id);
  if (!row || row.role === 'user') {
    return res.status(403).json({ error: '需要管理员权限' });
  }
  req.user.role = row.role;
  next();
}

// 管理员-反馈列表
router.get('/admin/feedback', authRequired, adminOnly, (req, res) => {
  const rows = db.prepare(`
    SELECT f.*, u.username FROM feedback f
    JOIN users u ON u.id = f.user_id
    ORDER BY f.created_at DESC LIMIT 100
  `).all();
  res.json({ feedback: rows });
});

// 管理员-删除单条反馈
router.delete('/admin/feedback/:id', authRequired, adminOnly, (req, res) => {
  db.prepare('DELETE FROM feedback WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// 管理员-用户列表（含统计数据）
router.get('/admin/stats', authRequired, adminOnly, (req, res) => {
  const now = Date.now();
  const weekAgo = now - 7 * 86400000;
  const monthAgo = now - 30 * 86400000;

  const users = db.prepare('SELECT id, username, created_at, last_login_at FROM users ORDER BY created_at DESC').all();

  // 预计算每个用户的统计数据
  const stmtSongs   = db.prepare('SELECT COUNT(*) AS cnt FROM songs s JOIN playlists pl ON s.playlist_id=pl.id WHERE pl.user_id=?');
  const stmtPls     = db.prepare('SELECT COUNT(*) AS cnt FROM playlists WHERE user_id=?');
  const stmtWeek    = db.prepare('SELECT SUM(played_sec) AS sec FROM play_logs WHERE user_id=? AND played_at>=?');
  const stmtMonth   = db.prepare('SELECT SUM(played_sec) AS sec FROM play_logs WHERE user_id=? AND played_at>=?');
  const stmtTotal   = db.prepare('SELECT SUM(played_sec) AS sec FROM play_logs WHERE user_id=?');

  const feedbackCount = db.prepare('SELECT COUNT(*) AS cnt FROM feedback').get().cnt;

  const list = users.map(u => ({
    username: u.username,
    createdAt: u.created_at,
    lastLogin: u.last_login_at || null,
    songCount: stmtSongs.get(u.id).cnt,
    playlistCount: stmtPls.get(u.id).cnt,
    totalSec: stmtTotal.get(u.id).sec || 0,
    weekSec: stmtWeek.get(u.id, weekAgo).sec || 0,
    monthSec: stmtMonth.get(u.id, monthAgo).sec || 0,
  }));

  const totalSec = list.reduce((s, u) => s + u.totalSec, 0);

  res.json({
    userCount: users.length,
    feedbackCount,
    totalSec,
    users: list,
  });
});

export default router;
