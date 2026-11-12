import jwt from 'jsonwebtoken';
import db from '../db.js';
import { config } from '../config.js';

export function signToken(payload) {
  // 默认 30 天，可通过环境变量 JWT_EXPIRES 调整（如 '1d' '24h' '30d'）
  // 兜底：测试或精简配置（mock config）未提供 jwtExpires 时不能让签发直接 500
  const expiresIn = config.jwtExpires || '30d';
  return jwt.sign(payload, config.jwtSecret, { expiresIn });
}

// 滑动续期：剩余有效期不足一半时换发新 token
export function shouldRefreshToken(decoded, nowMs = Date.now()) {
  if (!decoded || !decoded.exp || !decoded.iat) return false;
  const ttlSec = decoded.exp - decoded.iat;
  if (ttlSec <= 0) return false;
  return decoded.exp - Math.floor(nowMs / 1000) < ttlSec / 2;
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
  let decoded;
  try {
    decoded = jwt.verify(token, config.jwtSecret);
  } catch {
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }

  req.user = { id: decoded.id, username: decoded.username };

  // 更新用户活跃时间（5 分钟内节流，避免每次请求都写库）
  const now = Date.now();
  const lastWrite = _activeThrottle.get(decoded.id) || 0;
  if (now - lastWrite >= ACTIVE_THROTTLE_MS) {
    _activeThrottle.set(decoded.id, now);
    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now, decoded.id);
  }

  // 滑动续期：新 token 通过响应头下发，前端替换本地 token。
  // 签发失败不影响本次请求，前端继续用旧 token 直到过期。
  if (shouldRefreshToken(decoded, now)) {
    try {
      res.setHeader('X-New-Token', signToken({ id: decoded.id, username: decoded.username }));
    } catch { /* 忽略：下次请求还会尝试 */ }
  }

  next();
}
