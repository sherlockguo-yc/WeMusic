/**
 * E2E 测试：核心用户流程 + 回归检查
 *
 * 需要服务器运行（playwright.config.js 自动启动）
 * 运行：npx playwright test
 */
import { test, expect } from '@playwright/test';

const TEST_USER = 'e2e_test_' + Date.now();
const TEST_PASS = 'E2ePass123!';

// ===== 辅助：登录 =====
async function ensureLoggedIn(page) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // 如果能看到登录按钮，说明未登录
  const loginBtn = page.locator('#loginBtn, button:has-text("登录")').first();
  if (await loginBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await page.goto('/login.html');
    await page.waitForLoadState('networkidle');
    await page.fill('#username', TEST_USER);
    await page.fill('#password', TEST_PASS);
    await page.click('button[type="submit"]');
    // 等待跳转
    await page.waitForURL('**/', { timeout: 5000 }).catch(() => {});
  }
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
}

// ===== 基本页面测试 =====

test.describe('登录页', () => {
  test('应有用户名/密码输入框和提交按钮', async ({ page }) => {
    await page.goto('/login.html');
    await expect(page.locator('#username')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('空字段提交不崩溃', async ({ page }) => {
    await page.goto('/login.html');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(500);
    // 页面应仍然正常（未崩溃）
    await expect(page.locator('#username')).toBeVisible();
  });
});

test.describe('主页面', () => {
  test('页面标题含 WeMusic', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/WeMusic/i);
  });

  test('页面加载无 JS 错误', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    // 过滤 favicon 等无关错误
    const real = errors.filter((e) => !e.includes('favicon') && !e.includes('net::'));
    expect(real).toHaveLength(0);
  });
});

test.describe('API 健康检查', () => {
  test('fetch /api/health → {ok:true}', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async () => {
      const res = await fetch('/api/health');
      return res.json();
    });
    expect(result.ok).toBe(true);
  });
});

test.describe('核心流程：登录 → 浏览主页', () => {
  test('登录后主页正常加载', async ({ page }) => {
    await ensureLoggedIn(page);
    // 登录后至少应能看到搜索框或歌单区域
    const hasSearch = await page.locator('#searchInput, input[placeholder*="搜索"]').first().isVisible().catch(() => false);
    const hasNav = await page.locator('.nav, nav, #sidebar').first().isVisible().catch(() => false);
    expect(hasSearch || hasNav).toBe(true);
  });
});

test.describe('响应式布局', () => {
  test('移动端 390px 不溢出', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const box = await page.locator('body').boundingBox();
    expect(box).not.toBeNull();
    if (box) expect(box.width).toBeLessThanOrEqual(390);
  });

  test('桌面端 1280px 正常渲染', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const box = await page.locator('body').boundingBox();
    expect(box).not.toBeNull();
    if (box) expect(box.width).toBeGreaterThan(100);
  });
});

test.describe('截图留档', () => {
  test('登录页截图', async ({ page }) => {
    await page.goto('/login.html');
    await page.screenshot({ path: 'generated-images/e2e-login.png', fullPage: true });
  });

  test('主页截图（桌面端）', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'generated-images/e2e-desktop.png', fullPage: true });
  });

  test('主页截图（移动端）', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'generated-images/e2e-mobile.png', fullPage: true });
  });
});
