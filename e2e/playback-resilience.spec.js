/**
 * E2E：播放容错主链路回归（真实 player.js + 真实 <audio>，仅拦截网络）
 *
 * 作用：保证「直连失败 / 无响应 / 代理首字节很慢 / 重复播放命中本地缓存」这几条主链路
 * 在真实浏览器里始终可用，且不会被误跳歌。
 *
 * 注意（如实说明覆盖范围）：本文件在 5ad056e 与当前版本上都能通过，它是端到端回归保护，
 * 并不单独证明某个具体缺陷已修复。具体的时序缺陷（canplay 超时后监听被摘除、恢复闸门过早放开、
 * 旧任务回收新歌 Blob URL 等）由 tests/unit/playback-guard.test.js 的假时钟用例覆盖。
 *
 * 需要服务器运行（playwright.config.js 自动启动）。运行：npx playwright test e2e/playback-resilience.spec.js
 */
import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'block' }); // SW 会绕过 page.route，导致拦截失效

const TEST_USER = 'e2e_play_' + Date.now();
const TEST_PASS = 'E2ePass123!';
const CDN = 'https://fake-cdn.test';

/** 生成静音 WAV：8kHz / 16bit / 单声道。足够长，避免测试期间自然播完触发 autoAdvance */
function makeWav(seconds) {
  const rate = 8000;
  const dataLen = rate * 2 * seconds;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataLen, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataLen, 40);
  return buf;
}
const WAV = makeWav(60);

/**
 * 通过应用自带的快捷键入口起播：队列 [占位, 目标, 后续]，当前为占位曲 → 按 → 即 playNext → 播放目标。
 * 目标之后留一首「后续」曲，用于检测播放容错是否误跳歌：全程 queueIndex 必须停在 1。
 * （一次按键必须只触发一次 playNext，由 e2e/entry-once.spec.js 单独保证。）
 */
async function playViaQueue(page, bvid) {
  await page.evaluate((target) => {
    const mk = (b) => ({ name: `测试歌曲${b}`, singer: '测试歌手', bvid: b, duration: 60, _biliTitle: `测试稿件${b}`, _biliDur: 60 });
    const st = window.__state;
    st.queue = [mk('BVDUMMY0000'), mk(target), mk('BVNEXT00002')];
    st.queueIndex = 0;
    st.current = st.queue[0];
    st.playMode = 'loop';
  }, bvid);
  await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.keyboard.press('ArrowRight');
}

async function login(page) {
  await page.request.post('/api/auth/register', { data: { username: TEST_USER, password: TEST_PASS } }).catch(() => {});
  await page.goto('/login.html');
  await page.waitForLoadState('networkidle');
  await page.fill('#username', TEST_USER);
  await page.fill('#password', TEST_PASS);
  await page.click('#submitBtn');
  await page.waitForURL('**/', { timeout: 8000 }).catch(() => {});
  await page.waitForLoadState('networkidle');
}

/** 拦截与播放无关、可能走外网的接口，避免干扰计时 */
async function stubNoise(page) {
  await page.route('**/api/stats/lyrics*', (r) => r.fulfill({ json: { lines: [], candidates: [], sourceId: null, album_mid: '' } }));
  await page.route('**/api/music/**', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/play/gain*', (r) => r.fulfill({ json: { gain: null, status: null } }));
}

const audioState = (page) => page.evaluate(() => {
  const a = document.getElementById('audio');
  return { ct: a.currentTime, ready: a.readyState, paused: a.paused, src: a.src, bvid: window.__state.current?.bvid, qi: window.__state.queueIndex };
});

test.describe.configure({ mode: 'serial' });

test.describe('播放容错（真实 player + 真实 audio）', () => {
  test.setTimeout(60_000);

  test('直连 CDN 长时间无响应：自动切代理继续播放，不跳歌', async ({ page }) => {
    let directCalls = 0, proxyCalls = 0;
    await stubNoise(page);
    await page.route('**/api/play/direct-url*', (r) => { directCalls++; r.fulfill({ json: { url: `${CDN}/hang.wav`, backup: [], cid: 1, mime: 'audio/wav', expiresAt: null } }); });
    await page.route(`${CDN}/hang.wav`, () => { /* 故意不响应：模拟既不 403 也不给数据的节点 */ });
    await page.route('**/api/play/stream*', (r) => { proxyCalls++; r.fulfill({ status: 200, body: WAV, headers: { 'content-type': 'audio/wav', 'accept-ranges': 'bytes' } }); });

    await login(page);
    await playViaQueue(page, 'BVHANG00001');

    // 探活阈值 4s，留足余量；期间不能出现跳歌
    await expect.poll(async () => (await audioState(page)).ct, { timeout: 20_000, intervals: [500] }).toBeGreaterThan(1);
    const s = await audioState(page);
    expect(s.bvid).toBe('BVHANG00001');
    expect(s.qi).toBe(1); // 仍停在目标曲，没有被误跳到后续曲（索引 2）
    expect(s.src).toContain('/api/play/stream');
    expect(directCalls).toBeGreaterThanOrEqual(1);
    expect(proxyCalls).toBeGreaterThanOrEqual(1);
  });

  test('直连 CDN 返回 403：立即切代理，不跳歌', async ({ page }) => {
    await stubNoise(page);
    await page.route('**/api/play/direct-url*', (r) => r.fulfill({ json: { url: `${CDN}/forbidden.wav`, backup: [], cid: 1, mime: 'audio/wav', expiresAt: null } }));
    await page.route(`${CDN}/forbidden.wav`, (r) => r.fulfill({ status: 403, body: '', headers: { 'access-control-allow-origin': '*' } }));
    await page.route('**/api/play/stream*', (r) => r.fulfill({ status: 200, body: WAV, headers: { 'content-type': 'audio/wav', 'accept-ranges': 'bytes' } }));

    await login(page);
    await playViaQueue(page, 'BV403000001');

    await expect.poll(async () => (await audioState(page)).ct, { timeout: 15_000, intervals: [250] }).toBeGreaterThan(1);
    const s = await audioState(page);
    expect(s.bvid).toBe('BV403000001');
    expect(s.qi).toBe(1); // 仍停在目标曲，没有被误跳到后续曲（索引 2）
    expect(s.src).toContain('/api/play/stream');
  });

  test('代理线路首字节很慢（10 秒）：看门狗超时后同源重试恢复播放，不跳歌', async ({ page }) => {
    // 线上症状：经 Cloudflare 隧道的代理线路首字节 1.2~5s，尾部可达 10s+。
    // 期望：8s 看门狗处先同源重试，且全程停在原曲、不跳到后续曲。
    let streamCalls = 0;
    await stubNoise(page);
    await page.route('**/api/play/direct-url*', (r) => r.fulfill({ json: { url: `${CDN}/forbidden.wav`, backup: [], cid: 1, mime: 'audio/wav', expiresAt: null } }));
    await page.route(`${CDN}/forbidden.wav`, (r) => r.fulfill({ status: 403, body: '', headers: { 'access-control-allow-origin': '*' } }));
    await page.route('**/api/play/stream*', async (r) => {
      const n = ++streamCalls;
      if (n === 1) await new Promise((res) => setTimeout(res, 10_000)); // 第一次请求：10 秒后才有数据
      await r.fulfill({ status: 200, body: WAV, headers: { 'content-type': 'audio/wav', 'accept-ranges': 'bytes' } }).catch(() => { /* 页面已放弃该请求（重试重载） */ });
    });

    await login(page);
    await playViaQueue(page, 'BVSLOW00001');

    await expect.poll(async () => (await audioState(page)).ct, { timeout: 30_000, intervals: [500] }).toBeGreaterThan(1);
    const s = await audioState(page);
    expect(s.bvid).toBe('BVSLOW00001');
    expect(s.qi).toBe(1); // 没有被误跳到后续曲（索引 2）
    expect(streamCalls).toBeGreaterThanOrEqual(2); // 第一次迟迟不来，看门狗触发后同源重试了一次
  });

  test('直连正常：播满数秒后被动落盘；再次播放命中本地缓存且不再请求 direct-url', async ({ page }) => {
    let directCalls = 0;
    await stubNoise(page);
    await page.route('**/api/play/direct-url*', (r) => { directCalls++; r.fulfill({ json: { url: `${CDN}/ok.wav`, backup: [], cid: 1, mime: 'audio/wav', expiresAt: null } }); });
    await page.route(`${CDN}/ok.wav`, (r) => r.fulfill({ status: 200, body: WAV, headers: { 'content-type': 'audio/wav', 'access-control-allow-origin': '*', 'accept-ranges': 'bytes' } }));
    await page.route('**/api/play/stream*', (r) => r.fulfill({ status: 200, body: WAV, headers: { 'content-type': 'audio/wav', 'accept-ranges': 'bytes' } }));

    await login(page);
    const cached = page.evaluate(() => new Promise((res) => window.addEventListener('offline_cache_changed', res, { once: true })));
    await playViaQueue(page, 'BVCACHE0001');

    // 第一次：走直连；播放满 5 秒后调度器放行，落盘完成会广播 offline_cache_changed
    await expect.poll(async () => (await audioState(page)).ct, { timeout: 15_000, intervals: [500] }).toBeGreaterThan(1);
    expect((await audioState(page)).src).toContain('fake-cdn.test');
    await Promise.race([cached, page.waitForTimeout(25_000).then(() => { throw new Error('被动缓存未在预期时间内完成'); })]);
    const directBefore = directCalls;
    expect(directBefore).toBeGreaterThanOrEqual(1);

    // 第二次：同一首歌应直接命中 IndexedDB，blob 播放，不再解析直链
    await playViaQueue(page, 'BVCACHE0001');
    await expect.poll(async () => (await audioState(page)).ct, { timeout: 10_000, intervals: [250] }).toBeGreaterThan(0.5);
    const s = await audioState(page);
    expect(s.src.startsWith('blob:')).toBe(true);
    expect(directCalls).toBe(directBefore); // 第二次播放没有再解析直链
  });
});
