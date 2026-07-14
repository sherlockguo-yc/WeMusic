// E2E 自动化验证：打开浏览器 → 登录 → 检查关键 UI 元素
// 用法: npm run e2e
// 由 npm run deploy 自动调用（可用 SKIP_VERIFY=1 跳过）

import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';

const PCLI = 'playwright-cli';
const PORT = '5174';

let ok = 0, fail = 0;
function check(name, pass, detail = '') {
  if (pass) { ok++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} · ${detail || '失败'}`); }
}

function shell(cmd) { try { return execSync(cmd, { encoding: 'utf-8', stdio: 'pipe' }); } catch { return ''; } }
function pcli(cmd) { shell(PCLI + ' ' + cmd); }

// —— 1. 获取 token ——
const TOKEN = shell(`cd /Users/sherlockguo/code/WeMusic && node -e "import('./server/middleware/auth.js').then(m=>{import('./server/db.js').then(({default:d})=>{const u=d.prepare('SELECT id,username FROM users WHERE username = ?').get('sherlockguo');console.log(m.signToken({id:u.id,username:u.username}));process.exit(0)})})" `).trim();
console.log('\n📋 E2E 验证\n');

// —— 2. API 验证 ——
function testAPI(path, desc) {
  try {
    const r = shell(`curl -s --connect-timeout 5 http://localhost:${PORT}${path} -H "Authorization: Bearer ${TOKEN}"`);
    const json = JSON.parse(r);
    check(desc, !json.error, json.error || 'OK');
    return json;
  } catch (e) { check(desc, false, e.message.slice(0, 80)); return null; }
}

testAPI('/api/auth/admin/stats', 'GET /auth/admin/stats');
testAPI('/api/auth/session', 'GET /auth/session');
testAPI('/api/stats/weekly', 'GET /stats/weekly');
testAPI('/api/stats/history', 'GET /stats/history');

// —— 3. UI 验证 ——
pcli('close');
shell('sleep 1');
shell(`${PCLI} open http://localhost:${PORT}/login.html --browser=chromium`);
pcli('resize 1280 800');
shell('sleep 1');
shell(`${PCLI} run-code "async page => { await page.evaluate(t => { localStorage.setItem('wemusic_token', t); localStorage.setItem('wemusic_user', JSON.stringify({id:1,username:'sherlockguo'})); }, '${TOKEN}'); }"`);
shell(`${PCLI} goto http://localhost:${PORT}/`);
shell('sleep 4');

// 检查页面是否成功渲染（无 WeMusic 自身的 JS 错误）
// 注意：playwright-cli 的 console 日志会混入浏览器扩展 / 第三方 CDN 的噪音，
// 且与历史日志混杂。这里只检查「本次会话」(脚本启动后) 新生成的日志，并过滤与项目无关的报错。
const since = Date.now();
let consoleLogs = '';
try {
  for (const f of readdirSync('.playwright-cli')) {
    if (!f.startsWith('console-') || !f.endsWith('.log')) continue;
    const fp = `.playwright-cli/${f}`;
    if (statSync(fp).mtimeMs >= since) consoleLogs += readFileSync(fp, 'utf-8') + '\n';
  }
} catch { /* 目录不存在时忽略 */ }

// 与 WeMusic 无关的噪音来源（浏览器扩展、第三方 CDN、登录态）
const NOISE = [
  /favicon/i,
  /net::/i,
  /alicdn\.com/i,
  /aliyun/i,
  /zol\.com\.cn/i,
  /127\.0\.0\.1:\d+/i,                  // 浏览器扩展本地脚本（如 dayTimezone.js）
  /401|Unauthorized|登录已过期/i,        // E2E 打开 login.html 时未带 token
  /y\.qq\.com/i,                        // 外站资源 404/503
  /Permissions policy violation/i,
  /MessageChannel没有初始化/i,
  /Error fetching common config/i,
];
const realErrors = consoleLogs
  .split('\n')
  .filter((l) => l.includes('[ERROR]'))
  .filter((l) => !NOISE.some((re) => re.test(l)));
check('页面无 JS 错误', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

// 检查关键元素
const peval = (expr) => {
  const raw = shell(`${PCLI} eval "() => ${expr}"`);
  const lines = raw.split('\n').filter(l => l.trim() && !l.startsWith('#') && !l.startsWith('`') && !l.startsWith('-'));
  return lines[0] || '';
};

check('页面标题', peval("document.title.includes('WeMusic')").includes('true'));
check('播放按钮存在', peval("!!document.getElementById('playPauseBtn')").includes('true'));
check('歌单列表存在', peval("!!document.getElementById('playlistList')").includes('true'));

pcli('close');
console.log(`\n  ${ok + fail} 项：${ok} ✅ ${fail} ❌`);
process.exit(fail > 0 ? 1 : 0);
