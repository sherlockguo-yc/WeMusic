import http from 'node:http';
import { homedir } from 'node:os';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import dotenv from 'dotenv';

dotenv.config();

const PORT = Number(process.env.WEBHOOK_PORT) || 9001;
const CONF = `${homedir()}/.deploy-projects.conf`;
const QUEUE_ROOT = `${homedir()}/.deploy-queue`;
const JOB_DIR = join(QUEUE_ROOT, 'jobs');
const STATE_DIR = join(QUEUE_ROOT, 'states');
const VERSION_RE = /^[a-f0-9]{7,40}$/;

function readJson(filePath, fallback) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch (_) {
    return fallback;
  }
}

function writeJsonAtomic(filePath, data) {
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(data)}\n`, { encoding: 'utf-8', mode: 0o600 });
  renameSync(tempPath, filePath);
}

function loadProjects() {
  if (!existsSync(CONF)) return [];
  return readFileSync(CONF, 'utf-8')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map(line => line.split('|')[0])
    .filter(Boolean);
}

function enqueue(project, version) {
  const now = Math.floor(Date.now() / 1000);
  const job = { project, version, trigger: 'webhook', queuedAt: now, attempt: 0 };
  const jobPath = join(JOB_DIR, `${project}.json`);
  const statePath = join(STATE_DIR, `${project}.json`);
  const state = readJson(statePath, { project, active: null, pending: null, last: null });

  writeJsonAtomic(jobPath, job);
  state.project = project;
  state.pending = {
    ...job,
    phase: 'queued',
    status: 'queued',
    message: `等待部署 ${version}`,
    updatedAt: now,
  };
  state.updatedAt = now;
  writeJsonAtomic(statePath, state);
  return job;
}

let validProjects = loadProjects();
setInterval(() => { validProjects = loadProjects(); }, 300_000);

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

const server = http.createServer(async (req, res) => {
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
      if (!VERSION_RE.test(version)) {
        return sendJSON(res, 400, { error: 'Invalid version' });
      }

      const job = enqueue(project, version);
      console.log(`[${new Date().toISOString()}] 已入队: ${project} v${version}`);
      return sendJSON(res, 202, { message: 'Deploy queued', project, version, queuedAt: job.queuedAt });
    } catch (err) {
      console.error(`[${new Date().toISOString()}] 入队失败:`, err.message);
      return sendJSON(res, 500, { error: 'Unable to queue deployment' });
    }
  }

  if (req.method === 'GET' && req.url === '/health') {
    return sendJSON(res, 200, { status: 'ok', projects: validProjects });
  }

  return sendJSON(res, 404, { error: 'Not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('[webhook] 服务已启动');
  console.log(`[webhook] 端口: ${PORT}`);
  console.log('[webhook] 端点: POST /deploy, GET /health');
});
