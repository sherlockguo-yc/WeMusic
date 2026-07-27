import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = Router();

// GET /api/themes/presets — 返回所有预设主题（不含 dayVariant/nightVariant 完整细节，仅元数据）
router.get('/presets', (req, res) => {
  try {
    const presetsPath = path.join(__dirname, '../../data/themes/presets.json');
    const raw = fs.readFileSync(presetsPath, 'utf-8');
    const presets = JSON.parse(raw);

    // 只暴露元数据（不返回完整 slot 配置，减小响应体）
    const meta = presets.map((p) => ({
      id: p.id,
      name: p.name,
      artist: p.artist,
      artistNames: p.artistNames,
      dayAccent: p.dayVariant?.slots?.accent?.value || null,
      nightAccent: p.nightVariant?.slots?.accent?.value || null,
      decorations: p.dayVariant?.slots?.decorations?.value || 'none',
    }));

    res.json({ presets: meta });
  } catch (err) {
    console.error('[themes] presets 读取失败:', err.message);
    res.status(500).json({ error: '预设主题加载失败' });
  }
});

// GET /api/themes/presets/:id — 返回单个预设主题的全部 slot 配置
router.get('/presets/:id', (req, res) => {
  try {
    const presetsPath = path.join(__dirname, '../../data/themes/presets.json');
    const raw = fs.readFileSync(presetsPath, 'utf-8');
    const presets = JSON.parse(raw);
    const preset = presets.find((p) => p.id === req.params.id);

    if (!preset) {
      return res.status(404).json({ error: '预设主题不存在' });
    }

    res.json({ theme: preset });
  } catch (err) {
    console.error('[themes] preset 读取失败:', err.message);
    res.status(500).json({ error: '预设主题加载失败' });
  }
});

export default router;
