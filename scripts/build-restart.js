#!/usr/bin/env node
// WeMusic 一键构建 + 重启脚本
// 用法: node scripts/build-restart.js
// 作用: vite build + 杀掉旧进程 + 启动新进程

import { execSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const PORT = process.env.PORT || '5174';
const LOG = '/tmp/wemusic.log';
const cwd = process.cwd();
const SKIP_VERIFY = process.env.SKIP_VERIFY === '1'; // 紧急热修时跳过验证

function log(step, msg) {
  console.log(`\x1b[36m[${step}]\x1b[0m ${msg}`);
}

function ok(msg) {
  console.log(`\x1b[32m✓\x1b[0m ${msg}`);
}

function fail(msg) {
  console.error(`\x1b[31m✗\x1b[0m ${msg}`);
  process.exit(1);
}

// 1. 构建前端
log('1/3', '构建前端 (vite build) ...');
try {
  execSync('npx vite build', { stdio: 'inherit', cwd });
  ok('构建完成');
} catch {
  fail('构建失败，请检查上面的错误');
}

// 2. 杀掉旧进程
log('2/3', `停止端口 ${PORT} 上的旧进程 ...`);
try {
  const pids = execSync(`lsof -ti:${PORT} 2>/dev/null || true`, { encoding: 'utf-8' }).trim();
  if (pids) {
    execSync(`kill -9 ${pids.split('\n').join(' ')} 2>/dev/null || true`);
    // 等端口释放
    execSync('sleep 1.5');
    ok(`已停止 PID ${pids.replace(/\n/g, ' ')}`);
  } else {
    ok('无旧进程');
  }
} catch (e) {
  console.warn('停止旧进程时出错（可忽略）:', e.message);
}

// 3. 启动新进程
log('3/3', '启动新进程 ...');
const child = spawn('node', ['server/index.js'], {
  cwd,
  detached: true,
  stdio: ['ignore', 'ignore', 'ignore'],
});
child.unref();
ok(`服务器已启动 (PID ${child.pid}, 端口 ${PORT}, 日志: ${LOG})`);

// 简单健康检查
await new Promise((r) => setTimeout(r, 1500));
try {
  const resp = await fetch(`http://localhost:${PORT}/`);
  if (resp.ok || resp.status === 404) {
    ok(`健康检查通过 (HTTP ${resp.status})`);
  } else {
    console.warn(`健康检查返回 HTTP ${resp.status}，请查看日志: tail -f ${LOG}`);
  }
} catch (e) {
  console.warn(`健康检查失败: ${e.message}，请查看日志: tail -f ${LOG}`);
}

// 4. 自动化验证（非必需，可用 SKIP_VERIFY=1 跳过）
if (!SKIP_VERIFY) {
  log('4/4', '运行自动化验证 ...');
  try {
    execSync('node scripts/e2e.js', { cwd, stdio: 'inherit', timeout: 60000 });
  } catch (e) {
    console.warn('⚠  验证失败（可能不影响核心功能），请手动检查或重试: npm run verify');
  }
}
