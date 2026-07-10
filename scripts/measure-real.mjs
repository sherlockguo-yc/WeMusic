// 用真实流程验证歌词页按钮对齐
import { chromium } from 'playwright';

const TEST_USER = 'measure_test_' + Date.now();
const TEST_PASS = 'MeasurePass123!';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
page.on('pageerror', (err) => console.log('[pageerror]', err.message));

await page.goto('http://localhost:5174/login.html');
await page.waitForLoadState('networkidle');

// 切到注册模式
await page.click('#switchLink');
await page.waitForTimeout(300);
await page.fill('#username', TEST_USER);
await page.fill('#password', TEST_PASS);
const confirmVisible = await page.locator('#confirm').isVisible().catch(() => false);
if (confirmVisible) await page.fill('#confirm', TEST_PASS);
await page.click('#submitBtn');
await page.waitForTimeout(1500);
console.log('after register, url:', page.url());

if (page.url().includes('login')) {
  // 已注册过，切回登录模式重试
  const stillOnRegister = await page.locator('#confirmField.show').isVisible().catch(() => false);
  console.log('stillOnRegister:', stillOnRegister);
}

await page.goto('http://localhost:5174/');
await page.waitForLoadState('networkidle');
await page.waitForTimeout(1000);
console.log('main page url:', page.url());

// 搜索一首歌并播放
const searchInput = page.locator('#searchInput, input[placeholder*="搜索"]').first();
const searchVisible = await searchInput.isVisible({ timeout: 3000 }).catch(() => false);
console.log('search input visible:', searchVisible);
if (searchVisible) {
  await searchInput.click();
  await searchInput.fill('晴天');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2000);
}

const firstRow = page.locator('.song-row').first();
const rowVisible = await firstRow.isVisible({ timeout: 5000 }).catch(() => false);
console.log('first song row visible:', rowVisible);
if (rowVisible) {
  await firstRow.dblclick().catch(() => firstRow.click());
  await page.waitForTimeout(2500);
}

const npCover = page.locator('#npCover');
const coverVisible = await npCover.isVisible({ timeout: 5000 }).catch(() => false);
console.log('npCover visible:', coverVisible);
if (coverVisible) {
  await npCover.click();
  await page.waitForTimeout(1000);
}

const lyricsPanelShown = await page.locator('.lyrics-panel.show').isVisible({ timeout: 5000 }).catch(() => false);
console.log('lyrics panel shown:', lyricsPanelShown);

if (lyricsPanelShown) {
  await page.waitForTimeout(500);
  const data = await page.evaluate(() => {
    const add = document.getElementById('lpAddBtn');
    const bg = document.getElementById('lpBgBtn');
    if (!add || !bg) return { error: 'buttons not found', addExists: !!add, bgExists: !!bg };
    const ar = add.getBoundingClientRect();
    const br = bg.getBoundingClientRect();
    return {
      addCenterX: ar.left + ar.width / 2,
      bgCenterX: br.left + br.width / 2,
      addTop: ar.top, bgTop: br.top,
      bgTransform: getComputedStyle(bg).transform,
      bgInlineTransform: bg.style.transform,
      diff: (br.left + br.width/2) - (ar.left + ar.width/2),
    };
  });
  console.log('measurement:', JSON.stringify(data, null, 2));
  await page.screenshot({ path: '/tmp/lyrics-panel-real.png' });
  console.log('screenshot saved to /tmp/lyrics-panel-real.png');
} else {
  await page.screenshot({ path: '/tmp/lyrics-panel-fail.png' });
  console.log('failed, screenshot at /tmp/lyrics-panel-fail.png');
}

await browser.close();
