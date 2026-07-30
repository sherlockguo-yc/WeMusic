/**
 * 全量日志持久化基础设施（服务端）。
 *
 * 设计：不逐个文件替换 console.log/warn/error 调用点（改动量大、易漏改），
 * 而是在最早时机全局 monkey-patch console 方法——所有现有/未来的 console
 * 调用自动获得持久化能力，终端仍能看到原始输出（不影响开发调试）。
 *
 * 日志文件按天滚动写入 data/logs/server-YYYY-MM-DD.log（NDJSON），
 * data/ 目录受 N150 部署 rsync --exclude 保护，不会被自动更新覆盖。
 * 启动时清理超过 RETENTION_DAYS 的旧日志文件，避免磁盘无限增长。
 */
import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import { DATA_DIR } from './config.js';

const LOG_DIR = path.join(DATA_DIR, 'logs');
const RETENTION_DAYS = 14;
const FILE_RE = /^server-(\d{4}-\d{2}-\d{2})\.log$/;

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

function todayStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function logPath(day) {
  return path.join(LOG_DIR, `server-${day}.log`);
}

// 按日期滚动的可写目标：pino 只需要目标对象有 write(chunk) 方法即可
class RotatingDestination {
  constructor() {
    this._day = todayStr();
    this._stream = fs.createWriteStream(logPath(this._day), { flags: 'a' });
  }
  write(chunk) {
    const day = todayStr();
    if (day !== this._day) {
      this._day = day;
      try { this._stream.end(); } catch { /* 忽略关闭旧流失败 */ }
      this._stream = fs.createWriteStream(logPath(this._day), { flags: 'a' });
    }
    this._stream.write(chunk);
  }
}

export const logger = pino(
  { level: 'info', base: null, timestamp: pino.stdTimeFunctions.isoTime },
  new RotatingDestination(),
);

// ---- 清理超过 RETENTION_DAYS 的旧日志文件 ----
function cleanupOldLogs() {
  try {
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    for (const f of fs.readdirSync(LOG_DIR)) {
      if (!FILE_RE.test(f)) continue;
      const full = path.join(LOG_DIR, f);
      const stat = fs.statSync(full);
      if (stat.mtimeMs < cutoff) fs.unlinkSync(full);
    }
  } catch { /* 清理失败不影响启动 */ }
}
cleanupOldLogs();

// ---- 全局 monkey-patch：所有既有 console.log/warn/error 调用自动持久化 ----
function toMsg(args) {
  return args.map((a) => {
    if (typeof a === 'string') return a;
    if (a instanceof Error) return a.stack || a.message;
    try { return JSON.stringify(a); } catch { return String(a); }
  }).join(' ');
}

const _origLog = console.log.bind(console);
const _origWarn = console.warn.bind(console);
const _origError = console.error.bind(console);

console.log = (...args) => { _origLog(...args); try { logger.info(toMsg(args)); } catch { /* 落盘失败不影响主流程 */ } };
console.warn = (...args) => { _origWarn(...args); try { logger.warn(toMsg(args)); } catch { /* 落盘失败不影响主流程 */ } };
console.error = (...args) => { _origError(...args); try { logger.error(toMsg(args)); } catch { /* 落盘失败不影响主流程 */ } };

/** 供 /api/logs/client 路由调用：把前端上报的日志写入同一份日志文件，打上 source:"client" 标签 */
export function logClientEvent({ level = 'info', userId = null, message = '', ts = null }) {
  const payload = { source: 'client', userId, clientTs: ts || undefined };
  const line = `[client]${userId ? ' user=' + userId : ''} ${message}`;
  if (level === 'error') logger.error(payload, line);
  else if (level === 'warn') logger.warn(payload, line);
  else logger.info(payload, line);
}
