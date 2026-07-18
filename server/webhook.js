import http from 'node:http';
import { exec } from 'node:child_process';
import { homedir } from 'node:os';
import dotenv from 'dotenv';
dotenv.config();

const PORT = Number(process.env.WEBHOOK_PORT) || 9001;
const DEPLOY_AGENT = `${homedir()}/deploy-agent.sh`;

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

      const project = data.project;
      const version = data.version;
      if (!project || !version) {
        return sendJSON(res, 400, { error: 'Missing project or version' });
      }

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
