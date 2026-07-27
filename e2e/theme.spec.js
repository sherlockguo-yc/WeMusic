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

  test('默认模式（无主题）悬浮歌曲行：文字可见，不被深色背景遮挡', async ({ page, request }) => {
    await loginAndEnter(page, request);
    // 不激活任何主题 —— 验证默认 light/dark 模式下的 hover 行为

    await page.evaluate(() => {
      const row = document.createElement('div');
      row.className = 'song-row';
      row.id = 'defaultContrastRow';
      row.innerHTML = '<span class="song-name">默认模式测试歌曲</span>';
      document.body.appendChild(row);
    });
    await page.hover('#defaultContrastRow');

    const res = await page.evaluate(() => {
      const row = document.getElementById('defaultContrastRow');
      const name = row.querySelector('.song-name');
      const cs = getComputedStyle(row);
      return {
        bg: cs.backgroundColor,
        text: getComputedStyle(name || row).color,
        bodyClass: document.body.className,
        dataTheme: document.body.getAttribute('data-theme'),
      };
    });

    // 确认处于无主题状态
    expect(res.dataTheme, '不应有 data-theme 属性').toBeNull();

    const ratio = contrast(res.bg, res.text);
    expect(ratio,
      `默认模式悬浮行 body=${res.bodyClass} 背景=${res.bg} 文字=${res.text} 对比度=${ratio.toFixed(2)} 过低，文字可能不可见`
    ).toBeGreaterThan(3);
  });

  test('截图验证：主题激活前后悬浮行视觉效果', async ({ page, request }) => {
    await loginAndEnter(page, request);

    // 注入一个固定在页面顶部的测试行，方便截图对比
    await page.evaluate(() => {
      const row = document.createElement('div');
      row.className = 'song-row';
      row.id = 'visualContrastRow';
      row.style.cssText = 'position:fixed; top:200px; left:20px; width:400px; z-index:9999';
      row.innerHTML = '<span class="song-name">视觉验证-测试歌曲名</span><span class="song-artist">歌手名</span>';
      document.body.appendChild(row);
    });
    await page.waitForTimeout(200);

    // 1) 默认模式 hover 截图
    await page.hover('#visualContrastRow');
    await page.waitForTimeout(100);
    await page.screenshot({ path: 'generated-images/e2e-theme-default-hover.png', clip: { x: 20, y: 200, width: 400, height: 44 } });

    // 2) 激活主题后 hover 截图
    await page.evaluate(() => window.__theme.activateTheme('test'));
    await page.waitForTimeout(100);
    await page.hover('#visualContrastRow');
    await page.waitForTimeout(100);
    await page.screenshot({ path: 'generated-images/e2e-theme-active-hover.png', clip: { x: 20, y: 200, width: 400, height: 44 } });
  });

  test('activeTheme 持久化：激活后 reload，主题仍生效', async ({ page, request }) => {
    await loginAndEnter(page, request);
    // 先确保之前没有残留的主题
    await page.evaluate(() => { localStorage.removeItem('wemusic_activeTheme'); });

    // 激活主题（此时会写入 localStorage）
    await page.evaluate(() => window.__theme.activateTheme('test'));
    await page.waitForTimeout(200);

    // 确认 localStorage 已写入
    const saved = await page.evaluate(() => localStorage.getItem('wemusic_activeTheme'));
    expect(saved, 'localStorage 应保存 activeTheme').toBe('test');

    // 重新加载页面（模拟关闭浏览器再打开）
    await page.reload();
    await page.waitForFunction(
      () => window.__theme && typeof window.__theme.activateTheme === 'function',
      null,
      { timeout: 20000 }
    );
    await page.waitForTimeout(300);

    // 启动自激活应恢复主题
    const dt = await page.getAttribute('body', 'data-theme');
    expect(dt, 'reload 后 body[data-theme] 应为 test').toBe('test');

    const accent = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
    );
    expect(accent.toLowerCase(), 'reload 后强调色应仍为测试粉 #FF6B9D').toBe('#ff6b9d');
  });

  test('Decorations：激活主题后 star-dust 装饰生效', async ({ page, request }) => {
    await loginAndEnter(page, request);
    await page.evaluate(() => window.__theme.activateTheme('test'));

    // 验证 data-decorations 属性已设置
    const deco = await page.getAttribute('body', 'data-decorations');
    expect(deco, 'body[data-decorations] 应为 star-dust').toBe('star-dust');

    // 验证 ::before 伪元素有 twinkle 动画（通过 getComputedStyle 检查 animation 属性）
    const hasAnim = await page.evaluate(() => {
      const style = getComputedStyle(document.body, '::before');
      return style.animationName !== 'none' && style.animationName.includes('twinkle');
    });
    expect(hasAnim, '::before 伪元素应应用 twinkle 动画').toBe(true);

    // 验证 dust-color CSS 变量已设置
    const dustColor = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--theme-dust-color').trim()
    );
    expect(dustColor, '--theme-dust-color 应不为空').toBeTruthy();
  });

  test('Decorations 清除：取消主题后 data-decorations 移除', async ({ page, request }) => {
    await loginAndEnter(page, request);
    await page.evaluate(() => window.__theme.activateTheme('test'));
    await page.waitForTimeout(100);

    // 确认存在
    let hasDeco = await page.evaluate(() => document.body.hasAttribute('data-decorations'));
    expect(hasDeco, '激活后应有 data-decorations').toBe(true);

    // 取消主题
    await page.evaluate(() => window.__theme.deactivateTheme());
    await page.waitForTimeout(100);

    hasDeco = await page.evaluate(() => document.body.hasAttribute('data-decorations'));
    expect(hasDeco, '取消后不应有 data-decorations').toBe(false);

    // activeTheme 也应清除
    const saved = await page.evaluate(() => localStorage.getItem('wemusic_activeTheme'));
    expect(saved, '取消后 localStorage 应无 activeTheme').toBeNull();
  });

  test('Decorations 截图：star-dust / music-notes-corner / vinyl-record / wave-bottom', async ({ page, request }) => {
    await loginAndEnter(page, request);

    const decorations = ['star-dust', 'music-notes-corner', 'vinyl-record', 'wave-bottom'];
    for (const deco of decorations) {
      await page.evaluate((d) => window.__theme.activateTheme('test'), deco);
      await page.evaluate((d) => {
        document.body.setAttribute('data-decorations', d);
      }, deco);
      await page.waitForTimeout(300);
      await page.screenshot({ path: `generated-images/e2e-deco-${deco}.png`, fullPage: true });
    }
  });
});

// Phase 2：预设主题 + 选择器 UI
test.describe('主题系统（Phase 2 预设主题）', () => {
  test('API GET /api/themes/presets 返回 7 套预设', async ({ request }) => {
    const { presets } = await (await request.get('/api/themes/presets')).json();
    expect(Array.isArray(presets), 'presets 应为数组').toBe(true);
    expect(presets.length, '应有 7 套预设').toBe(7);

    // 验证元数据结构
    const jay = presets.find((p) => p.id === 'jay-warm-photo');
    expect(jay, '应有 jay-warm-photo').toBeTruthy();
    expect(jay.name).toBe('暖粉写真');
    expect(jay.artist).toBe('周杰伦');
    expect(jay.preview?.dayAccent).toBe('#FF8FAB');
  });

  test('API GET /api/themes/presets/:id 返回完整 Slot 配置', async ({ request }) => {
    const { theme } = await (await request.get('/api/themes/presets/jay-warm-photo')).json();
    expect(theme, 'theme 对象应存在').toBeTruthy();
    expect(theme.id).toBe('jay-warm-photo');

    const daySlots = theme.dayVariant?.slots;
    expect(daySlots, 'dayVariant.slots 应存在').toBeTruthy();
    expect(daySlots.accent?.value).toBe('#FF8FAB');
    expect(daySlots.font?.value).toBe('serif');
    expect(daySlots.decorations?.value).toBe('music-notes-corner');

    const nightSlots = theme.nightVariant?.slots;
    expect(nightSlots, 'nightVariant.slots 应存在').toBeTruthy();
    expect(nightSlots.accent?.value).toBe('#FF6B9D');
  });

  test('激活真实预设主题（jay-warm-photo）：强调色 / 字体 / 装饰生效', async ({ page, request }) => {
    await loginAndEnter(page, request);
    await page.evaluate(() => window.__theme.activateTheme('jay-warm-photo'));
    await page.waitForTimeout(300);

    const dt = await page.getAttribute('body', 'data-theme');
    expect(dt, 'body[data-theme] 应为 jay-warm-photo').toBe('jay-warm-photo');

    const accent = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
    );
    // 默认浅色模式 → dayVariant accent = #FF8FAB
    expect(accent.toLowerCase(), '强调色应为粉色（日变体）').toBe('#ff8fab');

    const font = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--font').trim().toLowerCase()
    );
    expect(font, '字体应为 serif').toContain('serif');

    // 该预设的 decorations 是 music-notes-corner
    const deco = await page.getAttribute('body', 'data-decorations');
    expect(deco, '装饰应为 music-notes-corner').toBe('music-notes-corner');
  });

  test('主题选择器 UI：打开弹窗 → 显示卡片 → 选中 → 应用', async ({ page, request }) => {
    await loginAndEnter(page, request);

    // 打开设置面板
    await page.evaluate(() => window.__theme.openThemeSelector());
    await page.waitForTimeout(500);

    // 验证弹窗可见
    const modal = page.locator('#themeSelectorModal');
    await expect(modal).toBeVisible();

    // 验证卡片已渲染
    const cards = page.locator('.theme-card');
    const count = await cards.count();
    expect(count, '应显示 7 张主题卡片').toBe(7);

    // 点击第一个卡片 → 变为 active
    await cards.first().click();
    await expect(cards.first()).toHaveClass(/active/);

    // 点击应用按钮
    await page.click('#themeApplyBtn');
    await page.waitForTimeout(500);

    // 弹窗应关闭，主题应已激活
    await expect(modal).toBeHidden();
    const dt = await page.getAttribute('body', 'data-theme');
    expect(dt, '应用后应有 data-theme').toBeTruthy();
  });

  test('取消主题：通过 UI 按钮取消后恢复默认', async ({ page, request }) => {
    await loginAndEnter(page, request);

    // 先激活一个主题
    await page.evaluate(() => window.__theme.activateTheme('jay-vintage'));
    await page.waitForTimeout(300);

    // 打开选择器 → 点击取消主题
    await page.evaluate(() => window.__theme.openThemeSelector());
    await page.waitForTimeout(300);

    await page.click('#themeDeactivateBtn');
    await page.waitForTimeout(300);

    // 应恢复到默认状态
    const dt = await page.getAttribute('body', 'data-theme');
    expect(dt, '取消后不应有 data-theme').toBeNull();

    const saved = await page.evaluate(() => localStorage.getItem('wemusic_activeTheme'));
    expect(saved, '取消后 localStorage 应无 activeTheme').toBeNull();
  });

  test('激活 GEM 预设：金色强调色 + hei 字体 + 星尘装饰', async ({ page, request }) => {
    await loginAndEnter(page, request);
    await page.evaluate(() => window.__theme.activateTheme('gem-dark-purple'));
    await page.waitForTimeout(300);

    const accent = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
    );
    // gem-dark-purple accent 是 #D4AF37（金色）
    expect(accent.toLowerCase(), '强调色应为金色').toBe('#d4af37');

    const font = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--font').trim().toLowerCase()
    );
    expect(font, '字体应为 hei 黑体').toContain('hei');

    const deco = await page.getAttribute('body', 'data-decorations');
    expect(deco, '装饰应为 star-dust').toBe('star-dust');
  });
});
