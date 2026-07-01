/**
 * 服务端海报生成（方案 B：精工版）：Puppeteer 无头浏览器渲染海报 HTML 并截图。
 * 相比前端 html2canvas 方案（方案 A：简约版），这里利用 Puppeteer 是真实浏览器、
 * 可稳定加载远程专辑封面图（无跨域限制）的优势，做出封面模糊背景 + 封面拼贴墙的差异化设计。
 *
 * 健壮性：
 *   - 浏览器实例懒加载并全局复用，避免每次请求都启动 Chromium
 *   - 截图失败时自动关闭当前页并重建浏览器，下次请求时拿到全新实例（应对连接断开、崩溃等场景）
 *   - 使用 networkidle2 + 显式图片等待，避免 networkidle0 在慢网络下超时
 *   - 所有异常都会冒泡到调用方，由路由层转为 500
 */
import puppeteer from 'puppeteer';
import { posterHTMLPro, posterCSSPro } from '../../shared/poster-template.js';

let browserPromise = null;
let browserFailed = false;

function launchBrowser() {
  return puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage', // /dev/shm 空间小，避免浏览器 OOM 崩溃
      '--disable-gpu',
    ],
  });
}

async function getBrowser() {
  if (browserFailed) {
    browserFailed = false;
    browserPromise = null;
  }
  if (!browserPromise) {
    browserPromise = launchBrowser().catch((e) => {
      browserPromise = null;
      throw e;
    });
  }
  return browserPromise;
}

// 标记当前浏览器实例不可用，下次请求时重建
function markBrowserBroken() {
  browserFailed = true;
  if (browserPromise) {
    browserPromise.then((b) => b.close().catch(() => {})).catch(() => {});
    browserPromise = null;
  }
}

/**
 * 渲染海报为 PNG Buffer
 * @param {object} data 已格式化好的海报数据（见 shared/poster-template.js）
 * @param {string} themeKey 主题 key（mint/dark/sunset/ocean）
 * @returns {Promise<Buffer>}
 */
export async function renderPosterPNG(data, themeKey) {
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  * { margin:0; padding:0; }
  html, body { background: transparent; }
  ${posterCSSPro(themeKey)}
</style></head>
<body>${posterHTMLPro(data, themeKey)}</body></html>`;

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 690, height: 1500, deviceScaleFactor: 2 });
    // setContent 走的是 setTimeout 注入 HTML，DOM 已构造但远程图片（封面）需额外等待
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // 显式等待所有图片（包括 CSS 背景图）解码完成
    await page.evaluate(async () => {
      const imgs = Array.from(document.images);
      await Promise.all(imgs.map((img) =>
        img.complete ? Promise.resolve() : new Promise((resolve) => {
          img.onload = img.onerror = resolve;
          setTimeout(resolve, 8000); // 单张图最多等 8s
        })
      ));
    });
    const el = await page.$('.wm-poster-pro');
    if (!el) throw new Error('海报渲染节点未找到');
    const buffer = await el.screenshot({ type: 'png' });
    return buffer;
  } catch (e) {
    // 连接断开 / 协议错误 / 浏览器崩溃 → 重建实例，避免污染下次请求
    if (/Connection closed|Protocol error|Browser has been|Target closed|detached/i.test(e.message || '')) {
      markBrowserBroken();
    }
    throw e;
  } finally {
    await page.close().catch(() => {});
  }
}

// 进程退出时关闭浏览器实例
process.on('exit', () => { browserPromise?.then((b) => b.close()).catch(() => {}); });
