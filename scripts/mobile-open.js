#!/usr/bin/env node
// WeMusic 手机端一键打开
// 用法: node scripts/mobile-open.js
// 功能: 检测局域网 IP → 打印二维码链接 → 如果有 adb + USB 连接的手机，自动打开浏览器

import { execSync } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { existsSync } from 'node:fs';

const ADB_PATH = process.env.HOME + '/Library/Android/sdk/platform-tools/adb';
const PORT = process.env.PORT || 5174;

function getLanIP() {
  const nets = networkInterfaces();
  for (const iface of Object.values(nets)) {
    const v4 = iface.find((n) => n.family === 'IPv4' && !n.internal);
    if (v4) return v4.address;
  }
  return 'localhost';
}

const lanIP = getLanIP();
const url = `http://${lanIP}:${PORT}`;

console.log('📱 WeMusic 移动端快速打开');
console.log(`   局域网地址: ${url}`);
console.log(`   二维码页面: http://localhost:${PORT}/qr\n`);

// 检查 adb
const hasADB = existsSync(ADB_PATH);
if (!hasADB) {
  console.log('💡 未安装 adb，无法自动操作手机。');
  console.log('   请打开电脑浏览器访问:\x1b[36m', `http://localhost:${PORT}/qr`, '\x1b[0m');
  console.log('   用手机相机扫描页面上的二维码即可打开 WeMusic。\n');
  process.exit(0);
}

// 检查设备
let devices = '';
try {
  devices = execSync(`${ADB_PATH} devices`, { encoding: 'utf-8' });
} catch {
  console.log('💡 adb 可用但执行失败，请检查 Android SDK 安装。\n');
  process.exit(0);
}

const lines = devices.trim().split('\n').slice(1).filter((l) => l.trim());
if (lines.length === 0) {
  console.log('💡 未检测到 USB 连接的手机。');
  console.log('   请确保：');
  console.log('   1. 手机通过 USB 连接到电脑');
  console.log('   2. 手机已开启「开发者选项」→「USB 调试」');
  console.log('   3. 手机屏幕解锁后同意了调试授权\n');
  console.log('   临时方案：打开http://localhost:' + PORT + '/qr 扫描二维码访问\n');
  process.exit(0);
}

console.log(`✓ 检测到 ${lines.length} 台设备:`);
lines.forEach((l) => console.log('  ', l));

// 在手机上打开 URL
for (const line of lines) {
  const serial = line.split('\t')[0];
  try {
    execSync(`${ADB_PATH} -s ${serial} shell am start -a android.intent.action.VIEW -d "${url}"`, {
      stdio: 'pipe',
      timeout: 5000,
    });
    console.log(`✓ 已在 ${serial} 上打开浏览器`);
  } catch (e) {
    // 如果默认浏览器不可用，尝试 Chrome
    try {
      execSync(
        `${ADB_PATH} -s ${serial} shell am start -n com.android.chrome/com.google.android.apps.chrome.Main -d "${url}"`,
        { stdio: 'pipe', timeout: 5000 },
      );
      console.log(`✓ 已在 ${serial} 上使用 Chrome 打开`);
    } catch {
      console.log(`✗ 无法在 ${serial} 上打开浏览器，请手动输入: ${url}`);
    }
  }
}
console.log('');
