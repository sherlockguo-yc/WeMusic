import http from 'node:http';
import crypto from 'node:crypto';
import { exec } from 'node:child_process';
import dotenv from 'dotenv';
dotenv.config();

const PORT = Number(process.env.WEBHOOK_PORT) || 9001;
const SECRET = process.env.WEBHOOK_SECRET || '';
const ROOT_DIR = new URL('..', import.meta.url).pathname;

if (!SECRET) {
  console.error('[webhook] 未配置 WEBHOOK_SECRET 环境变量，webhook 服务将拒绝所有请求');
}

/**
 * 验证 GitHub Webhook 签名 (HMAC-SHA256)
 */
function verifySignature(payload, signature) {
  if (!signature) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

/**
 * 执行部署脚本
 */
function runDeploy() {
  console.log(`[${new Date().toISOString()}] 开始部署...`);

  const commands = [
    `cd ${ROOT_DIR}`,
    'git pull origin master 2>&1',
    'npm install 2>&1',
    'npm run build 2>&1',
  ];
  const script = commands.join(' && ');

  console.log(`[${new Date().toISOString()}] 执行: ${commands.map((c, i) => (i > 0 ? c : Object.fromEntries([['cd', '']])[c] || c)).join(' && ')} 的实际命令`);

  exec(script, { cwd: ROOT_DIR, timeout: 120_000 }, (err, stdout, stderr) => {
    if (err) {
      console.error(`[${new Date().toISOString()}] 部署失败:`, err.message);
      if (stderr) console.error('stderr:', stderr);
      return;
    }
    console.log(`[${new Date().toISOString()}] 部署成功!`);
    if (stdout) console.log(stdout.trim());
    if (stderr) console.warn(stderr.trim());

    // 重启主服务：优先用 pm2，否则用 build-restart 脚本
    exec('pm2 reload wemusic 2>&1 || pm2 restart wemusic 2>&1 || node scripts/build-restart.js 2>&1', { cwd: ROOT_DIR });
  });
}

function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/**
 * 收集请求 body
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

// === 创建 HTTP Server ===

const server = http.createServer(async (req, res) => {
  // 只处理 POST /webhook
  if (req.method === 'POST' && req.url === '/webhook') {
    try {
      const signature = req.headers['x-hub-signature-256'];
      const event = req.headers['x-github-event'];
      const body = await readBody(req);

      // 验证签名
      if (!verifySignature(body, signature)) {
        console.warn(`[${new Date().toISOString()}] 签名验证失败`);
        return sendJSON(res, 403, { error: 'Invalid signature' });
      }

      // 只处理 push 事件
      if (event !== 'push') {
        return sendJSON(res, 200, { message: `Ignored event: ${event}` });
      }

      // 推送事件：触发部署
      console.log(`[${new Date().toISOString()}] 收到 push 事件`);

      // 立即返回 202，不等待部署完成（避免 GitHub webhook 超时）
      sendJSON(res, 202, { message: 'Deploy triggered' });

      // 异步执行部署
      runDeploy();
    } catch (err) {
      console.error(`[${new Date().toISOString()}] Webhook 处理异常:`, err.message);
      sendJSON(res, 500, { error: 'Internal server error' });
    }
    return;
  }

  // 其他请求：404
  sendJSON(res, 404, { error: 'Not found' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Webhook 服务已启动 ✅`);
  console.log(`  监听端口: http://0.0.0.0:${PORT}/webhook`);
  console.log();
});
