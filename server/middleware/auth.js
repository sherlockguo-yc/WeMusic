import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export function signToken(payload) {
  // 默认 7 天，可通过环境变量 JWT_EXPIRES 调整（如 '1d' '24h' '7d'）
  const expiresIn = process.env.JWT_EXPIRES || '7d';
  return jwt.sign(payload, config.jwtSecret, { expiresIn });
}

export function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: '未登录' });
  }
  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    req.user = decoded; // { id, username }
    next();
  } catch {
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }
}
