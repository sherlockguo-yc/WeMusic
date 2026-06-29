import express from 'express';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import { config } from '../config.js';
import { signToken, authRequired } from '../middleware/auth.js';

const router = express.Router();

// 注册
router.post('/register', (req, res) => {
  if (!config.allowRegister) {
    return res.status(403).json({ error: '注册已关闭' });
  }
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }
  if (String(password).length < 4) {
    return res.status(400).json({ error: '密码至少 4 位' });
  }
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exists) {
    return res.status(409).json({ error: '用户名已存在' });
  }
  const hash = bcrypt.hashSync(String(password), 10);
  const info = db
    .prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)')
    .run(username, hash, Date.now());
  const userId = info.lastInsertRowid;
  // 创建默认歌单
  db.prepare('INSERT INTO playlists (user_id, name, created_at) VALUES (?, ?, ?)').run(
    userId,
    '我喜欢的音乐',
    Date.now()
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
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(String(password), user.password_hash)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  const token = signToken({ id: user.id, username: user.username });
  res.json({ token, user: { id: user.id, username: user.username } });
});

// 当前用户
router.get('/me', authRequired, (req, res) => {
  res.json({ user: req.user, allowRegister: config.allowRegister });
});

export default router;
