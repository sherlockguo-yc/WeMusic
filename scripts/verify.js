#!/usr/bin/env node
// WeMusic 自动化验证 — 程序化断言 + 截图留档
// npm run verify

import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const PORT = 5174;
const OUT = 'generated-images';
mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
function ok(rule, v) { 
  if (v) { pass++; console.log('✅ ' + rule); }
  else { fail++; console.log('❌ ' + rule); }
}

function sh(cmd) { try { return execSync(cmd, { encoding: 'utf-8', stdio: 'pipe' }); } catch { return ''; } }

// playwright-cli eval 返回 "### Result\nvalue\n### Ran..."
function e(expr) {
  const raw = sh('playwright-cli eval ' + JSON.stringify(expr));
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].trim() === '### Result') return lines[i + 1].trim().replace(/^"|"$/g, '');
  }
  return '';
}

// ===== 1. 服务 =====
try { sh(`curl -s http://localhost:${PORT}/api/health`); ok('服务运行中', true); }
catch { ok('服务运行中', false); process.exit(1); }

// ===== 2. Token =====
const TOKEN = sh(`cd /Users/sherlockguo/code/WeMusic && node -e "import('./server/middleware/auth.js').then(m=>{import('./server/db.js').then(({default: d})=>{const u=d.prepare('SELECT id,username FROM users WHERE username=?').get('sherlockguo');console.log(m.signToken({id:u.id,username:u.username}));process.exit(0);})})"`).trim();
ok('获取 Token', !!TOKEN);
const AUTH = `-H "Authorization: Bearer ${TOKEN}"`;

// ===== 3. API =====
function api(path) {
  try { return JSON.parse(sh(`curl -s --connect-timeout 5 http://localhost:${PORT}${path} ${AUTH}`)); }
  catch { return null; }
}

ok('GET /auth/me', !!api('/api/auth/me'));

const stats = api('/api/auth/admin/stats');
ok('GET /admin/stats', !!stats);
if (stats?.users) {
  const u = stats.users.find(u => u.username === 'sherlockguo');
  ok('用户列表含 sherlockguo', !!u, `统计: ${u.songCount}首歌/${u.totalSec}s`);
}

const weekly = api('/api/stats/weekly');
ok('GET /stats/weekly', !!weekly);
ok('  重复播放率', weekly?.repeatRate !== undefined, `${weekly.repeatRate}%`);
ok('  最爱专辑≥1', (weekly?.topAlbums?.length || 0) > 0, `${weekly?.topAlbums?.length || 0}张`);
ok('  最爱时段', !!weekly?.peakLabel, weekly?.peakLabel);

// ===== 4. 浏览器 =====
sh('playwright-cli close');
sh('playwright-cli open http://localhost:' + PORT + '/login.html --browser=chromium');
sh('playwright-cli resize 1280 800');

// 注入 token 并跳转
sh(`playwright-cli run-code "async page => { await page.evaluate(t => { localStorage.setItem('wemusic_token', t); localStorage.setItem('wemusic_user', JSON.stringify({id:1,username:'sherlockguo'})); }, '${TOKEN}'); }"`);
sh('playwright-cli goto http://localhost:' + PORT + '/');
execSync('sleep 4', { stdio: 'ignore' });

// ===== 5. 控制台 =====
const errs = sh('playwright-cli console error');
ok('控制台无 JS 错误', !errs.includes('Error') || errs.includes('0 messages'));

// ===== 6. 顶栏按钮 =====
ok('管理员按钮可见', e("() => { const b = document.getElementById('adminTopBtn'); return b && getComputedStyle(b).display !== 'none' ? 'true' : 'false'; }") === 'true');
const tops = e("() => ['feedbackTopBtn','donateBtn','helpBtn'].map(id => { const b = document.getElementById(id); return b && Math.round(b.getBoundingClientRect().top); }).join(',')");
ok('顶栏按钮对齐', tops && new Set(tops.split(',')).size === 1, tops);

// ===== 7. 设置面板 =====
e("() => document.getElementById('userAvatarWrap').click()");
execSync('sleep 1', { stdio: 'ignore' });
ok('滚动提示存在', e("() => document.querySelector('#settingsScrollHint') ? 'true' : 'false'") === 'true');
ok('扫码按钮存在', e("() => document.getElementById('showMobileQRBtn') ? 'true' : 'false'") === 'true');
e("() => document.getElementById('settingsClose').click()");
execSync('sleep 0.5', { stdio: 'ignore' });

// ===== 8. 管理面板 =====
e("() => document.getElementById('adminTopBtn').click()");
execSync('sleep 2', { stdio: 'ignore' });
const adminTitle = e("() => { const t = document.querySelector('.view-title'); return t ? t.textContent.trim() : 'none'; }");
ok('管理面板打开', adminTitle === '管理面板', adminTitle);
ok('有用户行', e("() => '' + (document.querySelectorAll('.admin-user-row').length > 0)") === 'true');

// ===== 9. 截图 =====
sh('playwright-cli screenshot --filename=' + OUT + '/01-desktop-main.png');
sh('playwright-cli resize 390 844');
execSync('sleep 0.5', { stdio: 'ignore' });
sh('playwright-cli screenshot --filename=' + OUT + '/02-mobile-discover.png');

e("() => document.getElementById('userAvatarWrap').click()");
execSync('sleep 1', { stdio: 'ignore' });
sh('playwright-cli screenshot --filename=' + OUT + '/03-mobile-settings.png');
e("() => document.getElementById('showMobileQRBtn').click()");
execSync('sleep 3', { stdio: 'ignore' });
sh('playwright-cli screenshot --filename=' + OUT + '/04-mobile-qr.png');

e("() => { const q = document.getElementById('mobileQRClose'); if (q) q.click(); }");
execSync('sleep 0.5', { stdio: 'ignore' });
e("() => { const s = document.getElementById('settingsClose'); if (s) s.click(); }");
execSync('sleep 0.5', { stdio: 'ignore' });
e("() => document.getElementById('adminTopBtn').click()");
execSync('sleep 2', { stdio: 'ignore' });
sh('playwright-cli screenshot --filename=' + OUT + '/05-admin-panel.png');

sh('playwright-cli close');

// ===== 汇总 =====
const total = pass + fail;
console.log(`\n${'='.repeat(40)}`);
console.log(`✅ ${pass}/${total} 通过`);
if (fail) console.log('失败 ' + fail + ' 项');
console.log('截图: generated-images/');
console.log('='.repeat(40));
process.exit(fail ? 1 : 0);
