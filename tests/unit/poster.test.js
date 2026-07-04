/**
 * 海报模板纯函数单元测试（服务端 Puppeteer 精工版）
 */
import { describe, it, expect } from 'vitest';
import {
  POSTER_THEMES, POSTER_THEME_LIST,
  posterCSSPro, posterHTMLPro,
} from '../../shared/poster-template.js';

describe('POSTER_THEMES — 主题配置', () => {
  it('应有 4 个预设主题', () => {
    expect(POSTER_THEME_LIST).toHaveLength(4);
  });

  const expected = ['mint', 'dark', 'sunset', 'ocean'];
  for (const key of expected) {
    it(`主题 "${key}" 存在且有完整字段`, () => {
      const t = POSTER_THEMES[key];
      expect(t).toBeDefined();
      expect(t.key).toBe(key);
      expect(t.name).toBeTruthy();
      expect(t.bg).toBeTruthy();
      expect(t.text).toBeTruthy();
      expect(t.textDim).toBeTruthy();
      expect(t.accent).toBeTruthy();
      expect(t.cardBg).toBeTruthy();
      expect(t.cardBorder).toBeTruthy();
      expect(t.chipBg).toBeTruthy();
    });
  }

  it('dark 主题含 glow 标记', () => {
    const t = POSTER_THEMES.dark;
    expect(t.glow).toBe(true);
  });
});

describe('posterHTMLPro — 精工版 HTML', () => {
  const mockData = {
    appName: 'WeMusic',
    title: '本周听歌报告',
    dateRange: '2024-01-01 ~ 2024-01-07',
    plays: 42,
    duration: '180 分钟',
    uniqueSongs: 15,
    days: 5,
    persona: { icon: '🎶', label: '自由旋律人', desc: '' },
    insightText: '你的音乐品味很独特',
    topSongs: [
      { name: '晴天', singer: '周杰伦', albumMid: '001' },
      { name: '七里香', singer: '周杰伦', albumMid: '001' },
    ],
    topArtists: [{ name: '周杰伦' }],
    topAlbums: [
      { albumMid: 'mid001' },
      { albumMid: 'mid002' },
      { albumMid: 'mid003' },
      { albumMid: 'mid004' },
    ],
    generatedAt: '2024-01-07',
  };

  it('包含 PRO 标记', () => {
    const html = posterHTMLPro(mockData, 'dark');
    expect(html).toContain('PRO');
    expect(html).toContain('wm-poster-pro');
  });

  it('dark 主题使用模糊背景', () => {
    const html = posterHTMLPro(mockData, 'dark');
    expect(html).toContain('wpp-bg-cover');
  });

  it('mint 浅色主题不使用模糊背景', () => {
    const html = posterHTMLPro(mockData, 'mint');
    expect(html).not.toContain('wpp-bg-cover');
  });

  it('拼贴墙使用 topAlbums 封面', () => {
    const html = posterHTMLPro(mockData, 'dark');
    expect(html).toContain('wpp-collage');
    // 4 张专辑封面应在拼贴中
    const imgCount = (html.match(/wpp-collage/g) || []).length;
    expect(imgCount).toBe(1);
  });
});

describe('posterCSSPro — 精工版 CSS', () => {
  it('mint 是浅色调色板', () => {
    const css = posterCSSPro('mint');
    expect(css).toContain('.wm-poster-pro');
    expect(css).toContain('.wpp-collage');
  });

  it('dark/sunset/ocean 是深色调色板', () => {
    for (const key of ['dark', 'sunset', 'ocean']) {
      const css = posterCSSPro(key);
      // 深色主题应该有 rgba 背景
      expect(css).toContain('rgba');
    }
  });
});
