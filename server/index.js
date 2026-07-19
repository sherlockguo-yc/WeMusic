import fs from 'node:fs';

// ============================================================
// 崩溃诊断：用同步写入捕获进程死亡瞬间的信号/异常（uncaughtException /
// unhandledRejection 默认只在 stderr 打印，进程被杀时容易丢；这里落盘到
// 独立文件，方便下次排查类似"进程静默消失"问题时快速定位）。
// ============================================================
const CRASH_LOG = '/tmp/wemusic-crash.log';
function crashLog(msg) {
  try {
    fs.appendFileSync(CRASH_LOG, `[${new Date().toISOString()}] pid=${process.pid} ${msg}\n`);
  } catch {}
}
process.on('SIGTERM', () => { crashLog('SIGTERM received'); process.exit(0); });
process.on('uncaughtException', (err) => { crashLog(`uncaughtException: ${err?.stack || err}`); });
process.on('unhandledRejection', (err) => { crashLog(`unhandledRejection: ${err?.stack || err}`); });

import express from 'express';
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
// 数据迁移路由：需要在全局 json 解析之前挂载，因为导入操作
// 的请求体可能很大（含大量播放记录），需要 50mb 的 body limit。
// ============================================================
app.use('/api/migration', express.json({ limit: '50mb' }), migrationRouter);

// ============================================================
// 请求体解析（其他路由，限制大小防止超大 payload 攻击）
// ============================================================
app.use(express.json({ limit: '256kb' }));

// ============================================================
// API 路由
// ============================================================
app.use('/api/auth', authRouter);
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
  const coverURL = amid ? `https://y.qq.com/music/photo_new/T002R300x300M000${amid}.jpg` : null;

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
// SPA fallback：非 API / 非文件请求一律返回 index.html
// ============================================================
app.get(/^\/(?!api\/|dist\/|assets\/|sw\.js)/, (req, res) => {
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
