import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(__dirname, '..');
export const DATA_DIR = path.join(ROOT_DIR, 'data');
export const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

// 超级管理员：优先用 SUPER_ADMIN，兼容旧的 ADMIN_USERNAME（打印弃用警告）
const superAdminRaw = process.env.SUPER_ADMIN || process.env.ADMIN_USERNAME || '';
if (process.env.ADMIN_USERNAME && !process.env.SUPER_ADMIN) {
  console.warn('[config] ADMIN_USERNAME 已弃用，请改用 SUPER_ADMIN 环境变量');
}

export const config = {
  port: Number(process.env.PORT) || 5174,
  jwtSecret: process.env.JWT_SECRET || 'wemusic-dev-secret-change-me',
  allowRegister: String(process.env.ALLOW_REGISTER ?? 'true') === 'true',
  superAdmin: superAdminRaw.split(',').map(s => s.trim()).filter(Boolean)[0] || '',
  dbPath: path.join(DATA_DIR, 'wemusic.sqlite'),
};
