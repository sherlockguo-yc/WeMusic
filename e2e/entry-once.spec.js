/**
 * E2E：页面入口脚本只能被执行一次
 *
 * 背景（2026-11-04）：业务 chunk 里有 import('./main.js')，构建后是 import("../app.js")，
 * 解析成不带参数的 /dist/app.js；而页面如果引用 /dist/app.js?v=…，浏览器按完整 URL 区分模块，
 * 入口会被当成两个模块各执行一遍 —— 全局监听器重复注册，一次方向键触发两次 playNext（跳两首），
 * 首页接口也被重复请求。
 *
 * 需要服务器运行（playwright.config.js 自动启动）。运行：npx playwright test e2e/entry-once.spec.js
 */
import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

const TEST_USER = 'e2e_once_' + Date.now();
const TEST_PASS = 'E2ePass123!';

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

test.describe('入口脚本只执行一次', () => {
  test('首页加载后，/dist/app.js 只以同一个 URL 出现', async ({ page }) => {
    await login(page);
    const urls = [];
    page.on('request', (r) => { if (r.resourceType() === 'script' && /\/dist\/app\.js/.test(r.url())) urls.push(new URL(r.url()).pathname + new URL(r.url()).search); });
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);

    expect([...new Set(urls)], `入口被以多个 URL 加载：${JSON.stringify(urls)}`).toHaveLength(1);
    expect(urls[0]).toBe('/dist/app.js'); // 不带查询参数，才能与 chunk 里的 import("../app.js") 是同一个模块
  });

  test('一次方向键只触发一次 playNext，首页接口不重复请求', async ({ page }) => {
    await login(page);
    await page.route('**/api/play/**', (r) => r.abort()); // 不关心播放本身，只数调用次数
    const apiHits = {};
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (u.pathname === '/api/playlists') apiHits[u.pathname] = (apiHits[u.pathname] || 0) + 1;
    });
    const logs = [];
    page.on('console', (m) => { if (m.text().includes('[player] playNext')) logs.push(m.text()); });

    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);

    await page.evaluate(() => {
      const st = window.__state;
      const mk = (b) => ({ name: b, singer: 's', bvid: b, duration: 60 });
      st.queue = [mk('BVONCE00001'), mk('BVONCE00002'), mk('BVONCE00003'), mk('BVONCE00004')];
      st.queueIndex = 0;
      st.current = st.queue[0];
      st.playMode = 'loop';
    });
    logs.length = 0;
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(1000);

    expect(logs, `一次按键触发了 ${logs.length} 次 playNext`).toHaveLength(1);
    expect(await page.evaluate(() => window.__state.queueIndex)).toBe(1);
    expect(apiHits['/api/playlists'], '首页 /api/playlists 被重复请求').toBe(1);
  });
});
