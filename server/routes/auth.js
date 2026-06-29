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
  res.json({ user: { ...req.user, avatar: u?.avatar || null }, allowRegister: config.allowRegister });
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

export default router;
