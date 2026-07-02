import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(__dirname, '..');
export const DATA_DIR = path.join(ROOT_DIR, 'data');
export const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

export const config = {
  port: Number(process.env.PORT) || 5174,
  jwtSecret: process.env.JWT_SECRET || 'wemusic-dev-secret-change-me',
  allowRegister: String(process.env.ALLOW_REGISTER ?? 'true') === 'true',
  adminUsers: (process.env.ADMIN_USERNAME || '').split(',').map(s => s.trim()).filter(Boolean),
  dbPath: path.join(DATA_DIR, 'wemusic.sqlite'),
};
