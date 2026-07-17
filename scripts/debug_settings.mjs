import { chromium } from 'playwright';
const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MTksInVzZXJuYW1lIjoidGVzdF9zZXR0aW5nc18wMSIsImlhdCI6MTc4NDI5NjMzMywiZXhwIjoxNzg0OTAxMTMzfQ.Xxp0zHClnMXE_zRE5cUbbRM3wYqAyvt4mT0U77HQiu0';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript((t) => {
  localStorage.setItem('wemusic_token', t);
  localStorage.setItem('wemusic_user', JSON.stringify({ id: 'u1', name: 'test' }));
}, TOKEN);

const page = await ctx.newPage();
page.on('pageerror', err => console.log('[pageerror]', err.message));

await page.goto('http://localhost:8443/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
console.log('url:', page.url());
console.log('settingsModal exists:', await page.evaluate(() => !!document.getElementById('settingsModal')));

// 强制打开 modal
await page.evaluate(() => {
  document.getElementById('settingsModal').classList.add('show');
});
await page.waitForTimeout(400);

const data = await page.evaluate(() => {
  const mask = document.querySelector('#settingsModal');
  const modal = document.querySelector('#settingsModal .modal');
  if (!mask || !modal) return { error: 'no modal' };
  const mr = mask.getBoundingClientRect();
  const modr = modal.getBoundingClientRect();
  const scrollInfo = {
    scrollTop: modal.scrollTop, scrollHeight: modal.scrollHeight, clientHeight: modal.clientHeight,
    canScroll: modal.scrollHeight > modal.clientHeight + 5
  };
  const overflowEls = Array.from(modal.querySelectorAll('*')).filter(el => {
    const r = el.getBoundingClientRect();
    return r.bottom > modr.bottom + 1;
  }).map(el => {
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName,
      cls: (el.className || '').toString().slice(0, 50),
      text: el.textContent.trim().slice(0, 30),
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      overflowBy: Math.round(r.bottom - modr.bottom)
    };
  });
  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    modal: {
      top: Math.round(modr.top), bottom: Math.round(modr.bottom),
      height: Math.round(modr.height), width: Math.round(modr.width),
      maxHeight: getComputedStyle(modal).maxHeight,
      overflowY: getComputedStyle(modal).overflowY
    },
    scrollInfo,
    overflowCount: overflowEls.length,
    overflowSample: overflowEls.slice(0, 15)
  };
});
console.log(JSON.stringify(data, null, 2));
await page.screenshot({ path: '/tmp/settings-debug.png' });
await browser.close();
