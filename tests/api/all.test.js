/**
 * API 集成测试
 * 仅 mock config.js，让 db.js 自动创建内存数据库。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// ===== Mock config：用 process.cwd() 作为项目根目录（全局可用） =====
vi.mock('../../server/config.js', () => ({
  config: {
    port: 0, jwtSecret: 'test-secret',
    allowRegister: true, adminUsers: ['admin'],
    dbPath: ':memory:',
  },
  ROOT_DIR: process.cwd(),
  DATA_DIR: process.cwd() + '/data',
  PUBLIC_DIR: process.cwd() + '/public',
}));

// 避免 puppeteer 被导入
vi.mock('../../server/services/poster.js', () => ({}));

// ===== 引入真实路由和数据库 =====
import authRouter from '../../server/routes/auth.js';
import musicRouter from '../../server/routes/music.js';
import playlistRouter from '../../server/routes/playlist.js';
import playRouter from '../../server/routes/play.js';
import statsRouter from '../../server/routes/stats.js';
import db from '../../server/db.js';

// ===== 构建 App =====
let app;
beforeAll(() => {
  app = express();
  app.use(express.json({ limit: '256kb' }));
  app.use('/api/auth', authRouter);
  app.use('/api/music', musicRouter);
  app.use('/api/playlists', playlistRouter);
  app.use('/api/play', playRouter);
  app.use('/api/stats', statsRouter);
  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.use((err, req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    res.status(status).json({ error: err.message });
  });
});

afterAll(() => {
  db.close();
});

// ===== 辅助 =====
let userToken;

async function ensureUser() {
  if (userToken) return;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username: 'testuser', password: 'testpass123' });
  if (res.body.token) userToken = res.body.token;
}

// ===== 测试 =====

describe('Health', () => {
  it('GET /api/health → 200', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe('Auth', () => {
  it('注册 → 200', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ username: 'testuser', password: 'testpass123' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    userToken = res.body.token;
  });

  it('重复注册 → 409', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ username: 'testuser', password: 'testpass123' });
    expect(res.status).toBe(409);
  });

  it('缺少字段 → 400', async () => {
    const r1 = await request(app).post('/api/auth/register').send({});
    expect(r1.status).toBe(400);
    const r2 = await request(app).post('/api/auth/register').send({ username: 'a1', password: '12' });
    expect(r2.status).toBe(400);
    const r3 = await request(app).post('/api/auth/register').send({ username: '<<bad>>', password: '12345678' });
    expect(r3.status).toBe(400);
  });

  it('登录正确 → 200', async () => {
    const res = await request(app).post('/api/auth/login')
      .send({ username: 'testuser', password: 'testpass123' });
    expect(res.status).toBe(200);
    userToken = res.body.token;
  });

  it('登录错误密码 → 401', async () => {
    const res = await request(app).post('/api/auth/login')
      .send({ username: 'testuser', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('不存在的用户 → 401', async () => {
    const res = await request(app).post('/api/auth/login')
      .send({ username: 'nobody', password: 'x'.repeat(8) });
    expect(res.status).toBe(401);
  });

  it('GET /me → 200', async () => {
    const res = await request(app).get('/api/auth/me')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('testuser');
  });

  it('无 token → 401', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('无效 token → 401', async () => {
    const res = await request(app).get('/api/auth/me')
      .set('Authorization', 'Bearer garbage.token');
    expect(res.status).toBe(401);
  });

  it('偏好设置 PUT+GET', async () => {
    await request(app).put('/api/auth/preferences')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ data: { theme: 'dark' } });
    const res = await request(app).get('/api/auth/preferences')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.theme).toBe('dark');
  });

  it('非管理员访问 admin → 403', async () => {
    const res = await request(app).get('/api/auth/admin/stats')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(403);
  });
});

describe('Playlist', () => {
  let plId;

  it('GET → 200 含默认歌单', async () => {
    const res = await request(app).get('/api/playlists')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(200);
    expect(res.body.playlists.length).toBeGreaterThan(0);
    plId = res.body.playlists[0].id;
  });

  it('POST → 200 新建歌单（实际返回 200）', async () => {
    const res = await request(app).post('/api/playlists')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ name: 'test list' });
    expect(res.status).toBe(200);
  });

  it('歌曲 CRUD', async () => {
    const add = await request(app).post(`/api/playlists/${plId}/songs`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ songs: [{ song_mid: 'mid01', name: 'song1', singer: 's1', duration: 200 }] });
    expect(add.status).toBe(200);

    const dup = await request(app).post(`/api/playlists/${plId}/songs`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ songs: [{ song_mid: 'mid01', name: 'song1' }] });
    expect(dup.status).toBe(200); // 去重不会报错

    const list = await request(app).get(`/api/playlists/${plId}/songs`)
      .set('Authorization', `Bearer ${userToken}`);
    expect(list.body.songs.length).toBeGreaterThanOrEqual(1);

    const del = await request(app).delete(`/api/playlists/${plId}/songs/${list.body.songs[0].id}`)
      .set('Authorization', `Bearer ${userToken}`);
    expect(del.status).toBe(200);
  });

  it('无 token → 401', async () => {
    const res = await request(app).get('/api/playlists');
    expect(res.status).toBe(401);
  });
});

describe('Stats', () => {
  it('POST /log → 200', async () => {
    const res = await request(app).post('/api/stats/log')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ song_mid: 'mid01', name: 's1', singer: 'a1', duration: 200, played_sec: 150 });
    expect(res.status).toBe(200);
  });

  it('overview / weekly / top-songs → 200', async () => {
    const auth = { Authorization: `Bearer ${userToken}` };
    for (const path of ['/overview', '/weekly', '/top-songs']) {
      const res = await request(app).get(`/api/stats${path}`).set(auth);
      expect(res.status).toBe(200);
    }
  });

  it('红心切换', async () => {
    const like = await request(app).post('/api/stats/likes/mid01')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ name: 's1', singer: 'a1' });
    expect(like.status).toBe(200);

    const get = await request(app).get('/api/stats/likes')
      .set('Authorization', `Bearer ${userToken}`);
    expect(get.status).toBe(200);
  });

  it('POST feedback → 200', async () => {
    const res = await request(app).post('/api/stats/feedback')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ type: 'bug', content: 'test feedback' });
    expect(res.status).toBe(200);
  });
});

describe('鉴权守卫', () => {
  it('未登录访问 music/play → 401', async () => {
    expect((await request(app).get('/api/music/search?q=test')).status).toBe(401);
    expect((await request(app).post('/api/play/resolve').send({ name: 'test' })).status).toBe(401);
    expect((await request(app).get('/api/stats/overview')).status).toBe(401);
  });
});

describe('参数校验', () => {
  it('play resolve 缺歌名 → 400', async () => {
    const res = await request(app).post('/api/play/resolve')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ singer: 'x' });
    expect(res.status).toBe(400);
  });

  it('play search 缺关键词 → 400', async () => {
    const res = await request(app).get('/api/play/search')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(400);
  });
});
