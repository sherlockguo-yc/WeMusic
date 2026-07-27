import jwt from 'jsonwebtoken';
import db from '../db.js';
import { config } from '../config.js';

export function signToken(payload) {
  // 默认 7 天，可通过环境变量 JWT_EXPIRES 调整（如 '1d' '24h' '7d'）
  const expiresIn = process.env.JWT_EXPIRES || '7d';
  return jwt.sign(payload, config.jwtSecret, { expiresIn });
}

// 活跃时间更新节流（内存缓存，进程重启后重置）
const _activeThrottle = new Map(); // userId → lastWriteMs
const ACTIVE_THROTTLE_MS = 5 * 60 * 1000; // 5 分钟内不重复写库

export function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: '未登录' });
  }
  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    req.user = { id: decoded.id, username: decoded.username };

    // 更新用户活跃时间（5 分钟内节流，避免每次请求都写库）
    const now = Date.now();
    const lastWrite = _activeThrottle.get(decoded.id) || 0;
    if (now - lastWrite >= ACTIVE_THROTTLE_MS) {
      _activeThrottle.set(decoded.id, now);
      db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now, decoded.id);
    }

    next();
  } catch {
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }
}
