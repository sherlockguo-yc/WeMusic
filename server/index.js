import express from 'express';
import rateLimit from 'express-rate-limit';
import { config, PUBLIC_DIR } from './config.js';
import db from './db.js'; // 初始化数据库

import authRouter from './routes/auth.js';
import musicRouter from './routes/music.js';
import playlistRouter from './routes/playlist.js';
import playRouter from './routes/play.js';
import statsRouter from './routes/stats.js';
import adminRouter from './routes/admin.js';
import migrationRouter from './routes/migration.js';
import { searchLyricsCandidates } from './services/lyrics.js';
import { shortNameToSourceType } from '../shared/constants.js';

const app = express();

// 信任反代（NPM），使用 X-Forwarded-For 获取真实客户端 IP
app.set('trust proxy', 1);

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
// 数据迁移路由：需要在全局 json 解析之前挂载，因为导入操作
// 的请求体可能很大（含大量播放记录），需要 50mb 的 body limit。
// 该路由自己消费请求并响应，不会传递到后续中间件。
// ============================================================
app.use('/api/migration', express.json({ limit: '50mb' }), migrationRouter);

// ============================================================
// 请求体解析（其他路由，限制大小防止超大 payload 攻击）
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
app.use('/api/admin', adminRouter);

// 健康检查：只返回 ok，不暴露版本/环境等信息
app.get('/api/health', (req, res) => res.json({ ok: true }));

// ============================================================
// 分享元数据（无须登录，根据 song_mid / album_mid 返回歌名/歌手/封面）
// ============================================================
app.get('/api/share/meta', (req, res) => {
  const { s: songMid, amid: albumMid } = req.query;
  if (!songMid && !albumMid) return res.status(400).json({ error: '缺少参数' });

  // 从本地数据库查找元数据（跨用户）
  let row = null;
  if (songMid) {
    row = db.prepare('SELECT DISTINCT name, singer, album, album_mid, duration FROM songs WHERE song_mid = ? LIMIT 1').get(songMid)
      || db.prepare('SELECT DISTINCT name, singer, album, album_mid, duration FROM play_logs WHERE song_mid = ? LIMIT 1').get(songMid);
  }
  if (!row && albumMid) {
    row = db.prepare('SELECT DISTINCT name, singer, album, album_mid, duration FROM songs WHERE album_mid = ? LIMIT 1').get(albumMid)
      || db.prepare('SELECT DISTINCT name, singer, album, album_mid, duration FROM play_logs WHERE album_mid = ? LIMIT 1').get(albumMid);
  }

  const amid = row?.album_mid || albumMid || '';
  const coverURL = amid ? 'https:' + '//' + 'y.qq.com/music/photo_new/T002R300x300M000' + amid + '.jpg' : null;

  res.json({
    name: row?.name || '',
    singer: row?.singer || '',
    album: row?.album || '',
    duration: row?.duration || 0,
    album_mid: amid,
    coverURL,
  });
});

// ============================================================
// 分享歌词预取（无须登录，根据歌名+歌手返回默认 sourceId）
// 解决"未打开歌词详情页就分享"拿不到歌词源的问题
// ============================================================
app.get('/api/share/lyrics', async (req, res) => {
  const { n: name, a: singer } = req.query;
  if (!name) return res.json({ sourceId: null, sourceType: null });
  try {
    const candidates = await searchLyricsCandidates(name, singer || '');
    if (candidates && candidates.length > 0) {
      const c = candidates[0];
      return res.json({
        sourceId: String(c.id),
        // 根据 candidate.source 判断实际来源
        sourceType: shortNameToSourceType(c.source),
        name: c.name || '',
        artist: c.artist || '',
      });
    }
  } catch (e) {
    console.error('[share/lyrics]', e.message);
  }
  res.json({ sourceId: null, sourceType: null });
});

// ============================================================
// 静态前端
// ============================================================
app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile('sw.js', { root: PUBLIC_DIR });
});

// 管理面板：独立路由 /admin，由前端 SPA 检测 pathname 渲染管理视图
app.get('/admin', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  res.sendFile('index.html', { root: PUBLIC_DIR });
});

app.use(express.static(PUBLIC_DIR, {
  setHeaders(res, filePath) {
    // HTML / JS / CSS 禁止缓存，确保刷新后拿到最新前端
    if (/\.(html|js|css)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
    // manifest 也禁用缓存
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
// 手机扫码打开页面（局域网地址）
// ============================================================

// 获取当前局域网访问 URL（供前端和 /qr 页面共用）
async function getLanUrl() {
  const { networkInterfaces } = await import('node:os');
  const nets = networkInterfaces();
  const lan = Object.values(nets).flat().find(
    (n) => n.family === 'IPv4' && !n.internal
  );
  return lan ? `http://${lan.address}:${config.port}` : `http://localhost:${config.port}`;
}

// 给前端调用的 API，返回当前局域网 URL
app.get('/api/lan-url', async (req, res) => {
  const url = await getLanUrl();
  res.json({ url });
});

app.get('/qr', async (req, res) => {
  const url = await getLanUrl();
  const ipDisplay = url.replace(/^https?:\/\//, '');
  res.send(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>WeMusic - 移动端访问</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    min-height: 100dvh; background: linear-gradient(135deg, #0d1b2a 0%, #1b2838 50%, #162447 100%);
    color: #e0e6ed; padding: 20px; }
  .card { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1);
    border-radius: 20px; padding: 40px 30px; text-align: center; max-width: 400px; width: 100%;
    backdrop-filter: blur(12px); }
  h1 { font-size: 28px; margin-bottom: 8px; color: #1db954; letter-spacing: -0.5px; }
  .sub { font-size: 14px; color: #8899aa; margin-bottom: 28px; }
  .qr-wrap { display: inline-block; background: #fff; border-radius: 16px;
    padding: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.3); }
  .qr-wrap img { display: block; width: 200px; height: 200px; }
  .url { margin-top: 20px; font-size: 16px; background: rgba(0,0,0,0.25);
    padding: 12px 18px; border-radius: 12px; word-break: break-all;
    color: #7ec8e3; border: 1px solid rgba(255,255,255,0.08); }
  .tip { margin-top: 16px; font-size: 13px; color: #667788; line-height: 1.6; }
</style>
</head>
<body>
  <div class="card">
    <h1><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#1db954" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:6px"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>WeMusic</h1>
    <div class="sub">手机扫一扫，即刻使用</div>
    <div class="qr-wrap">
      <img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}" alt="QR Code" />
    </div>
    <div class="url">${ipDisplay}</div>
    <div class="tip">确保手机和电脑连接在同一 Wi-Fi / 局域网</div>
  </div>
</body>
</html>`);
});

// ============================================================
// SPA fallback：非 API / 非文件请求一律返回 index.html
// ============================================================
app.get(/^\/(?!api\/|dist\/|assets\/|sw\.js|qr)/, (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  res.sendFile('index.html', { root: PUBLIC_DIR });
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
