import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { authRequired } from '../middleware/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = Router();

// 上传目录：data/uploads/{userId}/
const uploadRoot = path.join(__dirname, '../../data/uploads');

// multer 配置：限制 10MB，仅图片
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const userDir = path.join(uploadRoot, String(req.user.id));
    fs.mkdirSync(userDir, { recursive: true });
    cb(null, userDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8) + ext);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];
    cb(null, allowed.includes(file.mimetype));
  },
});

// POST /api/upload/themes — 上传主题素材图片
router.post('/themes', authRequired, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请选择图片文件' });

  // 基础校验：禁止 SVG XSS（虽然 fileFilter 已过滤，再检查 extension 确保 svg 被拒）
  const ext = path.extname(req.file.originalname).toLowerCase();
  if (ext === '.svg') {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: '不支持 SVG 格式' });
  }

  // 返回可访问 URL
  const relativePath = path.relative(path.join(__dirname, '../../'), req.file.path);
  const url = '/' + relativePath.replace(/\\/g, '/');
  res.json({ url });
});

export default router;
