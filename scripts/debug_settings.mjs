import { chromium } from 'playwright';
const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MTksInVzZXJuYW1lIjoidGVzdF9zZXR0aW5nc18wMSIsImlhdCI6MTc4NDI5NjMzMywiZXhwIjoxNzg0OTAxMTMzfQ.Xxp0zHClnMXE_zRE5cUbbRM3wYqAyvt4mT0U77HQiu0';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
await ctx.addInitScript((t) => {
  localStorage.setItem('wemusic_token', t);
  localStorage.setItem('wemusic_user', JSON.stringify({ id: 19, username: 'test' }));
}, TOKEN);
const page = await ctx.newPage();
await page.goto('http://localhost:8443/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1000);
await page.evaluate(() => document.getElementById('settingsModal').classList.add('show'));
await page.waitForTimeout(300);

await page.evaluate(() => {
  const m = document.querySelector('#settingsModal .modal');
  const hint = m.querySelectorAll('.settings-hint');
  const lastHint = hint[hint.length - 1];
  const r = lastHint.getBoundingClientRect();
  const modr = m.getBoundingClientRect();
  m.scrollTop = m.scrollTop + (r.bottom - modr.bottom) + 10;
});
await page.waitForTimeout(200);

// 截 modal 圆角底部精确特写：modal bottom 900, 看 y=850-910
await page.screenshot({ path: '/tmp/edge-1000-precise.png', clip: { x: 380, y: 850, width: 520, height: 80 } });
await browser.close();
