import express from 'express';
import rateLimit from 'express-rate-limit';
import { config, PUBLIC_DIR } from './config.js';
import './db.js'; // 初始化数据库

import authRouter from './routes/auth.js';
import musicRouter from './routes/music.js';
import playlistRouter from './routes/playlist.js';
import playRouter from './routes/play.js';
import statsRouter from './routes/stats.js';

const app = express();

// ============================================================
// 安全响应头（防点击劫持、MIME 嗅探、XSS 等）
// ============================================================
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // autoplay=* 允许页面内 iframe（Bilibili 播放器）自动有声播放
  res.setHeader('Permissions-Policy', 'autoplay=*, fullscreen=*, camera=(), microphone=(), geolocation=()');
  // 内网穿透场景下不强制 HSTS（避免本地 http 访问被锁死）
  next();
});

// ============================================================
// 全局频率限制：防止扫描、暴力请求（每 IP 每分钟最多 120 次）
// ============================================================
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '请求过于频繁，请稍后再试' },
  skip: (req) => req.ip === '127.0.0.1' || req.ip === '::1', // 本机不限流
});
app.use('/api', globalLimiter);

// ============================================================
// 登录 / 注册：严格限流，防暴力破解
// 每 IP 15 分钟内最多尝试 10 次
// ============================================================
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '登录尝试过于频繁，请 15 分钟后再试' },
  skip: (req) => req.ip === '127.0.0.1' || req.ip === '::1',
});

// ============================================================
// 请求体解析（限制大小，防止超大 payload 攻击）
// ============================================================
app.use(express.json({ limit: '256kb' }));

// ============================================================
// API 路由
// ============================================================
app.use('/api/auth', authLimiter, authRouter); // 登录注册额外限流
app.use('/api/music', musicRouter);
app.use('/api/playlists', playlistRouter);
app.use('/api/play', playRouter);
app.use('/api/stats', statsRouter);

// 健康检查：只返回 ok，不暴露版本/环境等信息
app.get('/api/health', (req, res) => res.json({ ok: true }));

// ============================================================
// 静态前端
// ============================================================
app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile('sw.js', { root: PUBLIC_DIR });
});

app.use(express.static(PUBLIC_DIR, {
  setHeaders(res, filePath) {
    if (filePath.endsWith('manifest.json')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));

// ============================================================
// 统一错误处理：生产环境不暴露内部错误详情
// ============================================================
app.use((err, req, res, _next) => {
  // 记录完整错误到服务器日志（只有你能看到）
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.path}`, err.message);
  // 返回给客户端的错误信息：不泄露内部路径/堆栈
  const status = err.status || err.statusCode || 500;
  const message = status < 500 ? err.message : '服务器内部错误';
  res.status(status).json({ error: message });
});

// ============================================================
// 启动
// ============================================================
app.listen(config.port, '0.0.0.0', async () => {
  const { networkInterfaces } = await import('node:os');
  const nets = networkInterfaces();
  const lan = Object.values(nets).flat().find(
    (n) => n.family === 'IPv4' && !n.internal
  );
  console.log(`\n  WeMusic 已启动 ✅`);
  console.log(`  本机访问:   http://localhost:${config.port}`);
  if (lan) console.log(`  局域网访问: http://${lan.address}:${config.port}`);
  console.log();
  if (config.jwtSecret.includes('change')) {
    console.warn('  ⚠️  警告: JWT_SECRET 使用了默认值，公网暴露时请立即修改 .env！\n');
  }
});
