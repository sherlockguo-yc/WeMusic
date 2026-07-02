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
  const token = signToken({ id: user.id, username: user.username });
  res.json({ token, user: { id: user.id, username: user.username } });
});

// 当前用户
router.get('/me', authRequired, (req, res) => {
  const u = db.prepare('SELECT id, username, avatar FROM users WHERE id = ?').get(req.user.id);
  const isAdmin = config.adminUsers.length > 0 && config.adminUsers.includes(u?.username || '');
  res.json({ user: { ...req.user, avatar: u?.avatar || null }, allowRegister: config.allowRegister, isAdmin });
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
  db.prepare('INSERT OR REPLACE INTO user_preferences (user_id, data, updated_at) VALUES (?, ?, ?)')
    .run(req.user.id, JSON.stringify(data), Date.now());
  res.json({ ok: true });
});

// ---- 管理员端点 ----
function adminOnly(req, res, next) {
  if (!config.adminUsers.includes(req.user.username)) {
    return res.status(403).json({ error: '需要管理员权限' });
  }
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

// 管理员-全局屏蔽列表
router.get('/admin/blocked', authRequired, adminOnly, (req, res) => {
  const rows = db.prepare(`
    SELECT b.*, u.username FROM blocked_sources b
    JOIN users u ON u.id = b.user_id
    ORDER BY b.blocked_at DESC LIMIT 200
  `).all();
  res.json({ blocked: rows });
});

// 管理员-取消某条屏蔽（按 user_id + song_key + source_type + source_id）
router.delete('/admin/blocked', authRequired, adminOnly, (req, res) => {
  const { userId, song, type, sourceId } = req.body || {};
  if (!userId || !song || !sourceId) return res.status(400).json({ error: '缺少参数' });
  const r = db.prepare(`
    DELETE FROM blocked_sources
    WHERE user_id=? AND song_key=? AND source_type=? AND source_id=?
  `).run(userId, song, type || 'video', String(sourceId));
  res.json({ ok: true, removed: r.changes });
});

// 管理员-系统概况
router.get('/admin/stats', authRequired, adminOnly, (req, res) => {
  const userCount = db.prepare('SELECT COUNT(*) AS cnt FROM users').get().cnt;
  const songCount = db.prepare('SELECT COUNT(*) AS cnt FROM songs').get().cnt;
  const playlistCount = db.prepare('SELECT COUNT(*) AS cnt FROM playlists').get().cnt;
  const feedbackCount = db.prepare('SELECT COUNT(*) AS cnt FROM feedback').get().cnt;
  res.json({ userCount, songCount, playlistCount, feedbackCount });
});

export default router;
