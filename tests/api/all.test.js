/**
 * API 集成测试
 * 仅 mock config.js，让 db.js 自动创建内存数据库。
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
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

  it('收藏切换（独立于红心）', async () => {
    // 收藏 → 应返回 faved: true，且收藏列表含该歌
    const fav = await request(app).post('/api/stats/favorites/mid02')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ name: 's2', singer: 'a2' });
    expect(fav.status).toBe(200);
    expect(fav.body.faved).toBe(true);

    const get = await request(app).get('/api/stats/favorites')
      .set('Authorization', `Bearer ${userToken}`);
    expect(get.status).toBe(200);
    expect(get.body.favorites.some((f) => f.song_mid === 'mid02')).toBe(true);

    // 收藏不影响红心状态（独立开关）
    const check = await request(app).post('/api/stats/likes/check')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ mids: ['mid02'] });
    expect(check.body.liked['mid02']).toBeUndefined();

    // 周报应包含本周期收藏的歌曲
    const weekly = await request(app).get('/api/stats/weekly')
      .set('Authorization', `Bearer ${userToken}`);
    expect(weekly.status).toBe(200);
    expect(Array.isArray(weekly.body.favSongs)).toBe(true);
    expect(weekly.body.favSongs.some((f) => f.name === 's2')).toBe(true);

    // 取消收藏
    const unfav = await request(app).post('/api/stats/favorites/mid02')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ name: 's2', singer: 'a2' });
    expect(unfav.body.faved).toBe(false);
    const after = await request(app).get('/api/stats/favorites')
      .set('Authorization', `Bearer ${userToken}`);
    expect(after.body.favorites.some((f) => f.song_mid === 'mid02')).toBe(false);
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

describe('歌单解析 parse-playlist（Apple Music 分支）', () => {
  // 该 pl ID 内的连续数字（7712481）会被 QQ/网易云提取函数的兜底正则误吞，
  // 用它验证「Apple 分支必须最先判断」的分支顺序回归
  const APPLE_LINK = 'https://music.apple.com/cn/playlist/a-list/pl.beb783da7712481fbeed35be144bd48c';

  afterEach(() => vi.unstubAllGlobals());

  it('缺少 url → 400', async () => {
    await ensureUser();
    const res = await request(app).post('/api/music/parse-playlist')
      .set('Authorization', `Bearer ${userToken}`).send({});
    expect(res.status).toBe(400);
  });

  it('Apple 链接 → 走 Apple 分支并返回标准化歌曲', async () => {
    await ensureUser();
    const html = `<script id="serialized-server-data">${JSON.stringify({
      data: [{ data: { sections: [
        { itemKind: 'containerDetailHeaderLockup', items: [{ title: '测试 Apple 歌单' }] },
        { itemKind: 'trackLockup', items: [{
          contentDescriptor: { kind: 'song', identifiers: { storeAdamID: '123456' } },
          title: '测试歌', artistName: '测试歌手', album: '', duration: 200000,
        }] },
      ] } }],
    })}</script>`;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(html, { status: 200 })));
    const res = await request(app).post('/api/music/parse-playlist')
      .set('Authorization', `Bearer ${userToken}`).send({ url: APPLE_LINK });
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('apple');
    expect(res.body.playlistId).toBe('pl.beb783da7712481fbeed35be144bd48c');
    expect(res.body.name).toBe('测试 Apple 歌单');
    expect(res.body.songs).toHaveLength(1);
    expect(res.body.songs[0]).toMatchObject({
      song_mid: 'am_123456', name: '测试歌', singer: '测试歌手', duration: 200, source: 'apple',
    });
  });

  it('Apple 歌单不存在（404）→ 502 且提示明确', async () => {
    await ensureUser();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })));
    const res = await request(app).post('/api/music/parse-playlist')
      .set('Authorization', `Bearer ${userToken}`).send({ url: APPLE_LINK });
    expect(res.status).toBe(502);
    expect(res.body.error).toContain('不存在');
  });

  it('无法识别的链接 → 400', async () => {
    await ensureUser();
    const res = await request(app).post('/api/music/parse-playlist')
      .set('Authorization', `Bearer ${userToken}`).send({ url: 'https://example.com/nothing' });
    expect(res.status).toBe(400);
  });
});

describe('歌单封面补齐 fill-album-mids', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('缺有效 album_mid 的歌被反查并写回 DB；重复调用被防重拦截', async () => {
    await ensureUser();
    // 建歌单 + 加 2 首歌：album_mid 空（Apple 场景）/ 纯数字（网易云场景）
    const pl = await request(app).post('/api/playlists')
      .set('Authorization', `Bearer ${userToken}`).send({ name: '封面补齐测试' });
    const pid = pl.body.id;
    await request(app).post(`/api/playlists/${pid}/songs`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ songs: [
        { name: '测试歌', singer: '测试歌手', album_mid: '', source: 'apple' },
        { name: '数字歌', singer: '测试歌手', album_mid: '178396523', source: 'netease' },
      ] });
    // mock QQ 搜索接口：返回含两首歌的候选列表（歌名精确匹配各自取值）
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      code: 0,
      data: { song: { list: [
        { songname: '测试歌', singer: [{ name: '测试歌手' }], albummid: 'MOCK_MID_001', albumname: 'A', songmid: 'm1', songid: 1, interval: 200 },
        { songname: '数字歌', singer: [{ name: '测试歌手' }], albummid: 'MOCK_MID_002', albumname: 'B', songmid: 'm2', songid: 2, interval: 200 },
      ] } },
    }), { status: 200 })));

    const res = await request(app).post(`/api/playlists/${pid}/fill-album-mids`)
      .set('Authorization', `Bearer ${userToken}`).send({});
    expect(res.status).toBe(200);
    expect(res.body.filled).toBe(2);

    // DB 已被写回有效 mid
    const rows = db.prepare('SELECT name, album_mid FROM songs WHERE playlist_id = ? ORDER BY id').all(pid);
    expect(rows[0]).toMatchObject({ name: '测试歌', album_mid: 'MOCK_MID_001' });
    expect(rows[1]).toMatchObject({ name: '数字歌', album_mid: 'MOCK_MID_002' });

    // 同一歌单短时间内重复调用 → 防重（cooldown）
    const res2 = await request(app).post(`/api/playlists/${pid}/fill-album-mids`)
      .set('Authorization', `Bearer ${userToken}`).send({});
    expect(res2.status).toBe(200);
    expect(res2.body.skipped).toBe('cooldown');
  });
});
