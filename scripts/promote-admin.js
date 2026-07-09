#!/usr/bin/env node
/**
 * 管理员提升脚本
 * 用法: npm run admin:promote -- <username>
 * 或:   node scripts/promote-admin.js <username>
 *
 * 将指定用户直接提升为 super_admin，无需重启服务。
 * 每次请求都从数据库实时读取角色，所以立即生效。
 */

import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', 'data', 'wemusic.sqlite');

const username = process.argv[2]?.trim();

if (!username) {
  console.error('用法: npm run admin:promote -- <username>');
  console.error('示例: npm run admin:promote -- sherlockguo');
  process.exit(1);
}

const db = new Database(dbPath);

try {
  const row = db.prepare('SELECT id, role FROM users WHERE username = ?').get(username);

  if (!row) {
    console.error(`用户 "${username}" 不存在。请先在 Web 页面注册该用户。`);
    process.exit(1);
  }

  if (row.role === 'super_admin') {
    console.log(`用户 "${username}" 已经是超级管理员，无需操作。`);
    process.exit(0);
  }

  db.prepare("UPDATE users SET role = 'super_admin' WHERE id = ?").run(row.id);
  console.log(`已将 "${username}" 提升为超级管理员（原角色: ${row.role}）。`);
} finally {
  db.close();
}
