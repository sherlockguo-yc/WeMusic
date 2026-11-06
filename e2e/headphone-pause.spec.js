/**
 * E2E：拔耳机自动暂停（真实 player.js + 真实 <audio>，仅模拟浏览器设备信号）
 *
 * 物理拔耳机无法在 CI 中自动化，这里派发 devicechange / 让浏览器直接暂停 audio，
 * 验证两件事：① 自动暂停真的发生；② 暂停后 _tick() 的「意外暂停恢复」不会把声音放回来。
 * ②是本功能最容易回归的点（只调 bgAudio.pause() 而不置 timerPaused 会在 1 秒内失效）。
 *
 * 运行：npx playwright test e2e/headphone-pause.spec.js
 */
import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'block' }); // SW 会绕过 page.route，导致拦截失效

const TEST_USER = 'e2e_hp_' + Date.now();
const TEST_PASS = 'E2ePass123!';
const CDN = 'https://fake-cdn.test';

/** 静音 WAV：8kHz / 16bit / 单声道，60 秒足够长，避免测试期间自然播完触发 autoAdvance */
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

async function stubNoise(page) {
  await page.route('**/api/stats/lyrics*', (r) => r.fulfill({ json: { lines: [], candidates: [], sourceId: null, album_mid: '' } }));
  await page.route('**/api/music/**', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/play/gain*', (r) => r.fulfill({ json: { gain: null, status: null } }));
}

/** 用应用自带的快捷键入口起播，并 mock 音频直链为本地 WAV */
async function startPlaying(page, bvid) {
  await stubNoise(page);
  await page.route('**/api/play/direct-url*', (r) => r.fulfill({
    json: { url: `${CDN}/${bvid}.wav`, backup: [], cid: 1, mime: 'audio/wav', expiresAt: null },
  }));
  await page.route(`${CDN}/*.wav`, (r) => r.fulfill({
    status: 200, body: WAV, headers: { 'content-type': 'audio/wav', 'accept-ranges': 'bytes', 'access-control-allow-origin': '*' },
  }));
  await login(page);
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
  await expect.poll(async () => page.evaluate(() => document.getElementById('audio').currentTime), { timeout: 15_000, intervals: [250] }).toBeGreaterThan(0.5);
}

const audioState = (page) => page.evaluate(() => ({
  paused: document.getElementById('audio').paused,
  ct: document.getElementById('audio').currentTime,
  playTitle: document.getElementById('playPauseBtn').title,
}));

test.describe.configure({ mode: 'serial' });

test.describe('拔耳机自动暂停', () => {
  test.setTimeout(60_000);

  test('devicechange 触发自动暂停，且 _tick() 不会在随后把播放恢复', async ({ page }) => {
    const logs = [];
    const pageErrors = [];
    page.on('console', (m) => logs.push(m.text()));
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await startPlaying(page, 'BVHP0000001');
    expect((await audioState(page)).paused).toBe(false);

    await page.evaluate(() => navigator.mediaDevices.dispatchEvent(new Event('devicechange')));

    await expect.poll(async () => (await audioState(page)).paused, { timeout: 5000, intervals: [100] }).toBe(true);
    expect((await audioState(page)).playTitle).toBe('继续自动连播');

    // 关键回归点：_tick() 每秒巡检到 paused 会 play() 回来，这里等 2.5 秒确认被 timerPaused 拦住
    await page.waitForTimeout(2500);
    expect((await audioState(page)).paused).toBe(true);
    expect((await audioState(page)).playTitle).toBe('继续自动连播');

    // 控制台检查：两条 [audio-device] 诊断日志都在，且页面没有未捕获异常
    expect(logs.some((l) => l.includes('[audio-device] 收到信号: devicechange'))).toBe(true);
    expect(logs.some((l) => l.includes('[audio-device] devicechange → 自动暂停'))).toBe(true);
    expect(pageErrors).toEqual([]);
  });

  test('浏览器直接暂停 audio（Safari / iOS 路径）也会接管为暂停态', async ({ page }) => {
    await startPlaying(page, 'BVHP0000002');
    expect((await audioState(page)).playTitle).toBe('暂停自动连播');

    await page.evaluate(() => document.getElementById('audio').pause());

    await expect.poll(async () => (await audioState(page)).playTitle, { timeout: 5000, intervals: [100] }).toBe('继续自动连播');
    await page.waitForTimeout(2500);
    expect((await audioState(page)).paused).toBe(true);
  });

  test('用户点播放可从设备暂停中恢复', async ({ page }) => {
    await startPlaying(page, 'BVHP0000003');
    await page.evaluate(() => navigator.mediaDevices.dispatchEvent(new Event('devicechange')));
    await expect.poll(async () => (await audioState(page)).paused, { timeout: 5000, intervals: [100] }).toBe(true);

    await page.click('#playPauseBtn');
    await expect.poll(async () => (await audioState(page)).paused, { timeout: 5000, intervals: [100] }).toBe(false);
    expect((await audioState(page)).playTitle).toBe('暂停自动连播');
  });

  test('关闭设置开关后，设备变化不再暂停', async ({ page }) => {
    await startPlaying(page, 'BVHP0000004');
    await page.evaluate(() => {
      localStorage.setItem('wemusic_headphone_pause', '0');
      navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
      document.getElementById('audio').pause();
    });
    await page.waitForTimeout(1500);
    // 直接调 audio.pause() 是测试注入的强制暂停，_tick() 仍会按既有容错逻辑恢复播放
    expect((await audioState(page)).playTitle).toBe('暂停自动连播');
    await expect.poll(async () => (await audioState(page)).paused, { timeout: 5000, intervals: [100] }).toBe(false);
  });
});
