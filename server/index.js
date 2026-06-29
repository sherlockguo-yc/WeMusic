import express from 'express';
import { config, PUBLIC_DIR } from './config.js';
import './db.js'; // 初始化数据库

import authRouter from './routes/auth.js';
import musicRouter from './routes/music.js';
import playlistRouter from './routes/playlist.js';
import playRouter from './routes/play.js';

const app = express();

app.use(express.json({ limit: '2mb' }));

// API 路由
app.use('/api/auth', authRouter);
app.use('/api/music', musicRouter);
app.use('/api/playlists', playlistRouter);
app.use('/api/play', playRouter);

// 健康检查
app.get('/api/health', (req, res) => res.json({ ok: true }));

// 静态前端
app.use(express.static(PUBLIC_DIR));

// 统一错误处理
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || '服务器内部错误' });
});

app.listen(config.port, '0.0.0.0', async () => {
  const { networkInterfaces } = await import('node:os');
  const nets = networkInterfaces();
  const lan = Object.values(nets).flat().find(
    (n) => n.family === 'IPv4' && !n.internal
  );
  console.log(`\n  WeMusic 已启动 ✅`);
  console.log(`  本机访问:   http://localhost:${config.port}`);
  if (lan) console.log(`  局域网访问: http://${lan.address}:${config.port}（供同局域网的朋友使用）`);
  console.log();
  if (config.jwtSecret.includes('change')) {
    console.log('  提示: 请在 .env 中设置更安全的 JWT_SECRET\n');
  }
});
