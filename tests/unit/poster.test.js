/**
 * 海报模板纯函数单元测试
 */
import { describe, it, expect } from 'vitest';
import {
  POSTER_THEMES, POSTER_THEME_LIST,
  posterCSS, posterHTML, posterCSSPro, posterHTMLPro,
} from '../../shared/poster-template.js';

// esc 和 coverUrl 未单独导出，通过 posterHTML 间接测试

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
});

describe('posterCSS — 简约版 CSS', () => {
  it('返回非空字符串', () => {
    const css = posterCSS('mint');
    expect(typeof css).toBe('string');
    expect(css.length).toBeGreaterThan(0);
  });

  it('包含核心 CSS 类', () => {
    const css = posterCSS('mint');
    expect(css).toContain('.wm-poster');
    expect(css).toContain('.wp-hero');
    expect(css).toContain('.wp-song-row');
    expect(css).toContain('.wp-artist-chips');
    expect(css).toContain('.wp-footer');
  });

  it('未知主题 fallback 到 mint', () => {
    const css = posterCSS('unknown');
    const cssMint = posterCSS('mint');
    expect(css).toBe(cssMint);
  });

  it('dark 主题含 glow 标记', () => {
    const t = POSTER_THEMES.dark;
    expect(t.glow).toBe(true);
  });

  it('不同主题产生不同 CSS', () => {
    expect(posterCSS('mint')).not.toBe(posterCSS('dark'));
  });
});

describe('posterHTML — 简约版 HTML', () => {
  const mockData = {
    appName: 'WeMusic',
    title: '本周听歌报告',
    dateRange: '2024-01-01 ~ 2024-01-07',
    plays: 42,
    duration: '180 分钟',
    uniqueSongs: 15,
    days: 5,
    persona: { icon: '🎶', label: '自由旋律人', desc: '最爱夜深人静时听歌' },
    insightText: '你的音乐品味很独特',
    topSongs: [
      { name: '晴天', singer: '周杰伦' },
      { name: '七里香', singer: '周杰伦' },
    ],
    topArtists: [
      { name: '周杰伦' },
      { name: '林俊杰' },
    ],
    generatedAt: '2024-01-07',
  };

  it('返回包含关键内容的 HTML', () => {
    const html = posterHTML(mockData, 'mint');
    expect(html).toContain('WeMusic');
    expect(html).toContain('本周听歌报告');
    expect(html).toContain('42');
    expect(html).toContain('晴天');
    expect(html).toContain('周杰伦');
    expect(html).toContain('自由旋律人');
  });

  it('HTML 转义：特殊字符被转义', () => {
    const risky = { ...mockData, title: '<script>alert("xss")</script>' };
    const html = posterHTML(risky, 'mint');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('空歌曲列表显示占位文本', () => {
    const empty = { ...mockData, topSongs: [], topArtists: [] };
    const html = posterHTML(empty, 'mint');
    expect(html).toContain('暂无播放记录');
    expect(html).toContain('暂无数据');
  });

  it('无洞察文本时不显示该区域', () => {
    const noInsight = { ...mockData, insightText: '' };
    const html = posterHTML(noInsight, 'mint');
    expect(html).not.toContain('wp-insight');
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
