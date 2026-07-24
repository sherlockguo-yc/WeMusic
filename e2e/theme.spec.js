import { test, expect } from '@playwright/test';

// 注册测试用户并登录，写入 token 后进入主应用（主题模块仅在已登录时加载）
async function loginAndEnter(page, request) {
  const uname = 'e2e_theme_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
  const pwd = 'TestPass123!';
  const reg = await request.post('/api/auth/register', { data: { username: uname, password: pwd } });
  expect(reg.ok(), `注册失败: ${(await reg.text()).slice(0, 200)}`).toBeTruthy();
  const { token } = await reg.json();
  expect(token, '注册响应缺少 token').toBeTruthy();

  await page.goto('/login.html');
  await page.evaluate((t) => localStorage.setItem('wemusic_token', t), token);
  await page.goto('/');
  // 等待主题模块挂载到 window.__theme
  await page.waitForFunction(
    () => window.__theme && typeof window.__theme.activateTheme === 'function',
    null,
    { timeout: 20000 }
  );
}

// ---- WCAG 对比度工具 ----
function _chan(v) {
  v /= 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
function relLum(rgb) {
  const m = (rgb.match(/[\d.]+/g) || []).map(Number);
  const [r, g, b] = [m[0], m[1], m[2]].map(_chan);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(rgb1, rgb2) {
  const L1 = relLum(rgb1), L2 = relLum(rgb2);
  const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1];
  return (hi + 0.05) / (lo + 0.05);
}

test.describe('主题系统（Phase 1 冒烟测试）', () => {
  test('激活测试主题：data-theme / 强调色 / 字体 / 背景层 生效', async ({ page, request }) => {
    await loginAndEnter(page, request);
    await page.evaluate(() => window.__theme.activateTheme('test'));

    const dt = await page.getAttribute('body', 'data-theme');
    expect(dt, 'body[data-theme] 应为 test').toBe('test');

    const accent = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
    );
    expect(accent.toLowerCase(), '强调色应变为测试粉 #FF6B9D').toBe('#ff6b9d');

    const font = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--font').trim().toLowerCase()
    );
    expect(font, '字体应切换为 serif').toContain('serif');

    const bgDisplay = await page.evaluate(() =>
      getComputedStyle(document.querySelector('.theme-bg-layer')).display
    );
    expect(bgDisplay, '背景层 .theme-bg-layer 应显示').toBe('block');
  });

  test('激活主题后悬浮歌曲行：文字与背景对比度可读（防止黑色遮挡回归）', async ({ page, request }) => {
    await loginAndEnter(page, request);
    await page.evaluate(() => window.__theme.activateTheme('test'));

    // 注入一个受 .song-row:hover 规则控制的元素（不依赖真实列表数据）
    await page.evaluate(() => {
      const row = document.createElement('div');
      row.className = 'song-row';
      row.id = 'themeContrastRow';
      row.innerHTML = '<span class="song-name">测试歌曲</span>';
      document.body.appendChild(row);
    });
    await page.hover('#themeContrastRow');

    const res = await page.evaluate(() => {
      const row = document.getElementById('themeContrastRow');
      const name = row.querySelector('.song-name');
      const cs = getComputedStyle(row);
      return {
        bg: cs.backgroundColor,
        text: getComputedStyle(name || row).color,
      };
    });

    const ratio = contrast(res.bg, res.text);
    expect(ratio, `悬浮行 背景=${res.bg} 文字=${res.text} 对比度=${ratio.toFixed(2)} 过低，文字可能不可见`).toBeGreaterThan(3);
  });

  test('取消主题：data-theme 移除，强调色恢复默认绿', async ({ page, request }) => {
    await loginAndEnter(page, request);
    await page.evaluate(() => window.__theme.activateTheme('test'));
    await page.evaluate(() => window.__theme.deactivateTheme());

    const dt = await page.getAttribute('body', 'data-theme');
    expect(dt, '取消主题后 body[data-theme] 应为 null').toBeNull();

    const accent = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
    );
    expect(accent.toLowerCase(), '强调色应恢复默认绿 #2ab758').toBe('#2ab758');
  });
});
