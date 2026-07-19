import http from 'node:http';
import { exec } from 'node:child_process';
import { homedir } from 'node:os';
import { readFileSync, existsSync } from 'node:fs';
import dotenv from 'dotenv';
dotenv.config();

const PORT = Number(process.env.WEBHOOK_PORT) || 9001;
const DEPLOY_AGENT = `${homedir()}/deploy-agent.sh`;
const CONF = `${homedir()}/.deploy-projects.conf`;

// 频率限制：同一项目 60 秒内最多触发一次部署
const lastDeploy = new Map();

// 从配置文件读取支持的项目列表
function loadProjects() {
  if (!existsSync(CONF)) return [];
  const lines = readFileSync(CONF, 'utf-8').split('\n');
  return lines
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map(line => line.split('|')[0])
    .filter(Boolean);
}

let validProjects = loadProjects();

// 每 5 分钟刷新一次项目列表（配置文件可能被更新）
setInterval(() => { validProjects = loadProjects(); }, 300_000);

function runDeploy(project, version) {
  console.log(`[${new Date().toISOString()}] 部署 ${project} v${version} ...`);
  const cmd = `bash "${DEPLOY_AGENT}" --deploy ${project} ${version}`;
  exec(cmd, { timeout: 300_000 }, (err, stdout, stderr) => {
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

      const project = data.project;
      const version = data.version;
      if (!project || !version) {
        return sendJSON(res, 400, { error: 'Missing project or version' });
      }

      if (!validProjects.includes(project)) {
        return sendJSON(res, 400, { error: `Unknown project: ${project}` });
      }

      // 频率限制：同一项目 60 秒内只接受一次部署
      const now = Date.now();
      const last = lastDeploy.get(project) || 0;
      if (now - last < 60_000) {
        return sendJSON(res, 429, { error: 'Rate limited', retryAfter: Math.ceil((60_000 - (now - last)) / 1000) });
      }
      lastDeploy.set(project, now);

      console.log(`[${new Date().toISOString()}] 收到部署请求: ${project} v${version}`);
      sendJSON(res, 202, { message: 'Deploy triggered', project, version });
      runDeploy(project, version);
    } catch (err) {
      console.error(`[${new Date().toISOString()}] 处理异常:`, err.message);
      sendJSON(res, 500, { error: 'Internal server error' });
    }
    return;
  }

  // GET /health
  if (req.method === 'GET' && req.url === '/health') {
    return sendJSON(res, 200, { status: 'ok', projects: validProjects });
  }

  sendJSON(res, 404, { error: 'Not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[webhook] 服务已启动 ✅`);
  console.log(`[webhook] 端口: ${PORT}`);
  console.log(`[webhook] 端点: POST /deploy, POST /webhook, GET /health`);
});
