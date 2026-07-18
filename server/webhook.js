import http from 'node:http';
import crypto from 'node:crypto';
import { exec } from 'node:child_process';
import { homedir } from 'node:os';
import dotenv from 'dotenv';
dotenv.config();

const PORT = Number(process.env.WEBHOOK_PORT) || 9001;
const SECRET = process.env.WEBHOOK_SECRET || '';
const DEPLOY_AGENT = `${homedir()}/deploy-agent.sh`;

if (!SECRET) {
  console.error('[webhook] 未配置 WEBHOOK_SECRET 环境变量，webhook 服务将拒绝所有请求');
}

function verifyToken(token) {
  return SECRET && token === SECRET;
}

function verifyGitHubSignature(payload, signature) {
  if (!signature || !SECRET) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

function runDeploy(project, version) {
  console.log(`[${new Date().toISOString()}] 部署 ${project} v${version} ...`);
  const cmd = `bash "${DEPLOY_AGENT}" --deploy ${project} ${version}`;
  exec(cmd, { timeout: 180_000 }, (err, stdout, stderr) => {
    if (err) {
      console.error(`[${new Date().toISOString()}] ${project} 部署失败:`, err.message);
      if (stderr) console.error('stderr:', stderr);
      return;
    }
    console.log(`[${new Date().toISOString()}] ${project} 部署完成`);
    if (stdout) console.log(stdout.trim());
  });
}

function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

// ── HTTP Server ──

const server = http.createServer(async (req, res) => {
  // POST /deploy — CI workflow 主动通知部署
  if (req.method === 'POST' && req.url === '/deploy') {
    try {
      const body = await readBody(req);
      let data;
      try { data = JSON.parse(body); } catch { data = {}; }

      // 认证：优先 Header token，其次 body token
      const headerToken = (req.headers['x-deploy-token'] || '').trim();
      const bodyToken = (data.token || '').trim();
      const token = headerToken || bodyToken;

      if (!verifyToken(token)) {
        console.warn(`[${new Date().toISOString()}] 认证失败`);
        return sendJSON(res, 403, { error: 'Unauthorized' });
      }

      const project = data.project;
      const version = data.version;
      if (!project || !version) {
        return sendJSON(res, 400, { error: 'Missing project or version' });
      }

      // 支持的项目白名单
      const validProjects = ['wemusic', 'wemonitor'];
      if (!validProjects.includes(project)) {
        return sendJSON(res, 400, { error: `Unknown project: ${project}` });
      }

      console.log(`[${new Date().toISOString()}] 收到部署请求: ${project} v${version}`);
      sendJSON(res, 202, { message: 'Deploy triggered', project, version });
      runDeploy(project, version);
    } catch (err) {
      console.error(`[${new Date().toISOString()}] 处理异常:`, err.message);
      sendJSON(res, 500, { error: 'Internal server error' });
    }
    return;
  }

  // POST /webhook — 兼容 GitHub 原生 webhook（GitHub 推送到 master 时触发）
  if (req.method === 'POST' && req.url === '/webhook') {
    try {
      const signature = req.headers['x-hub-signature-256'];
      const event = req.headers['x-github-event'];
      const body = await readBody(req);

      if (event === 'ping') {
        return sendJSON(res, 200, { message: 'pong' });
      }

      if (!verifyGitHubSignature(body, signature)) {
        console.warn(`[${new Date().toISOString()}] GitHub 签名验证失败`);
        return sendJSON(res, 403, { error: 'Invalid signature' });
      }

      if (event !== 'push') {
        return sendJSON(res, 200, { message: `Ignored: ${event}` });
      }

      // 从 payload 推断项目名
      let payload;
      try { payload = JSON.parse(body); } catch { payload = {}; }
      const repoName = (payload.repository?.full_name || '').toLowerCase();
      let project;
      if (repoName.includes('wemusic')) project = 'wemusic';
      else if (repoName.includes('wemonitor')) project = 'wemonitor';
      else return sendJSON(res, 400, { error: 'Unknown repo' });

      console.log(`[${new Date().toISOString()}] GitHub push → ${project}`);
      sendJSON(res, 202, { message: 'Deploy triggered', project });
      // GitHub webhook 模式：传空版本，让 deploy-agent 自己查最新版
      runDeploy(project, '');
    } catch (err) {
      console.error(`[${new Date().toISOString()}] Webhook 异常:`, err.message);
      sendJSON(res, 500, { error: 'Internal server error' });
    }
    return;
  }

  // GET /health
  if (req.method === 'GET' && req.url === '/health') {
    return sendJSON(res, 200, { status: 'ok', projects: ['wemusic', 'wemonitor'] });
  }

  sendJSON(res, 404, { error: 'Not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[webhook] 服务已启动 ✅`);
  console.log(`[webhook] 端口: ${PORT}`);
  console.log(`[webhook] 端点: POST /deploy, POST /webhook, GET /health`);
});
