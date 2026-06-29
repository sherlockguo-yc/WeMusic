import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export function signToken(payload) {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: '30d' });
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
