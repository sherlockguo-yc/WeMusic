import express from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { logClientEvent } from '../logger.js';

const router = express.Router();

/**
 * 前端批量日志上报：不强制登录（未登录页面报错也要能记录），
 * 但若带了合法 token 则解析出 userId 一并记录，方便按用户排查。
 * POST /api/logs/client  body: { events: [{ level, message, ts }] }
 */
router.post('/client', (req, res) => {
  const { events } = req.body || {};
  if (!Array.isArray(events) || events.length === 0) return res.json({ ok: true });

  let userId = null;
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    try { userId = jwt.verify(token, config.jwtSecret).id; } catch { /* 忽略无效/过期 token，仍记录日志 */ }
  }

  // 防止单次请求体过大：最多处理 200 条，多余的丢弃（客户端已做节流，正常不会触发）
  for (const ev of events.slice(0, 200)) {
    if (!ev || typeof ev.message !== 'string') continue;
    logClientEvent({ level: ev.level, userId, message: ev.message, ts: ev.ts });
  }
  res.json({ ok: true });
});

export default router;
