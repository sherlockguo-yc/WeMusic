import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = Router();

// GET /api/themes/presets — 返回所有预设主题（元数据 + 预览字段）
router.get('/presets', (req, res) => {
  try {
    const presetsPath = path.join(__dirname, '../presets.json');
    const raw = fs.readFileSync(presetsPath, 'utf-8');
    const presets = JSON.parse(raw);

    const meta = presets.map((p) => {
      const ds = p.dayVariant?.slots || {};
      const ns = p.nightVariant?.slots || {};
      return {
        id: p.id,
        name: p.name,
        artist: p.artist,
        artistNames: p.artistNames,
        decorations: ds.decorations?.value || 'none',
        // 预览字段：足够渲染微型 UI 预览卡片
        preview: {
          dayBg: ds.bg?.type === 'gradient' ? ds.bg.value : (ds.bg?.value || '#f4f6f9'),
          nightBg: ns.bg?.type === 'gradient' ? ns.bg.value : (ns.bg?.value || '#0d0f12'),
          dayBgColor: ds.bg?.type === 'color' ? ds.bg.value : null,
          nightBgColor: ns.bg?.type === 'color' ? ns.bg.value : null,
          dayAccent: ds.accent?.value || '#2ab758',
          nightAccent: ns.accent?.value || '#2ab758',
          daySidebar: (ds.sidebar?.value || '#fafbfd'),
          nightSidebar: (ns.sidebar?.value || '#0d0f12'),
          dayText: '#1b1d22',
          nightText: '#e0e3e8',
          coverRadius: ds.player?.value === 'pill-cover' ? '50%' : (ds.player?.value === 'rounded-cover' ? '12px' : '6px'),
          cardPreset: ds.card?.value || 'default',
        },
      };
    });

    res.json({ presets: meta });
  } catch (err) {
    console.error('[themes] presets 读取失败:', err.message);
    res.status(500).json({ error: '预设主题加载失败' });
  }
});

// GET /api/themes/presets/:id — 返回单个预设主题的全部 slot 配置
router.get('/presets/:id', (req, res) => {
  try {
    const presetsPath = path.join(__dirname, '../presets.json');
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
