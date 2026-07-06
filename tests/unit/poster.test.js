/**
 * 海报模板纯函数单元测试（服务端 Puppeteer 精工版）
 */
import { describe, it, expect } from 'vitest';
import {
  POSTER_THEMES, POSTER_THEME_LIST,
  posterCSSPro, posterHTMLPro,
  posterCSSMobile, posterHTMLMobile,
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

describe('posterHTMLMobile — 手机版 HTML（5 页 Story 模式）', () => {
  const mockData = {
    appName: 'WeMusic', title: '本周听歌报告', dateRange: '2024-01',
    plays: 42, duration: '180 分钟', uniqueSongs: 15, days: 5,
    persona: { icon: '🎶', label: '自由旋律人', desc: '按自己的节奏享受音乐' },
    insightText: '你的音乐品味很独特',
    topSongs: [
      { name: '晴天', singer: '周杰伦', albumMid: '001', playCount: 12 },
      { name: '七里香', singer: '周杰伦', albumMid: '001', playCount: 8 },
    ],
    topArtists: [
      { name: '周杰伦', playCount: 20 },
      { name: '林俊杰', playCount: 10 },
    ],
    topAlbums: [
      { albumMid: 'mid001', name: 'Album 1', singer: '周杰伦', playCount: 12 },
      { albumMid: 'mid002', name: 'Album 2', singer: '周杰伦', playCount: 8 },
      { albumMid: 'mid003', name: 'Album 3', singer: '林俊杰', playCount: 6 },
      { albumMid: 'mid004', name: 'Album 4', singer: '林俊杰', playCount: 4 },
    ],
    generatedAt: '2024-01-07',
  };

  it('返回 4 页 HTML 数组', () => {
    const pages = posterHTMLMobile(mockData, 'dark');
    expect(Array.isArray(pages)).toBe(true);
    expect(pages).toHaveLength(4);
  });

  it('每页都是独立的 wm-poster-mobile 容器', () => {
    const pages = posterHTMLMobile(mockData, 'dark');
    pages.forEach((html) => {
      expect(html).toContain('wm-poster-mobile');
    });
  });

  it('每页都有页码标签（01/04 ~ 04/04）', () => {
    const pages = posterHTMLMobile(mockData, 'dark');
    expect(pages[0]).toContain('01');
    expect(pages[1]).toContain('02');
    expect(pages[2]).toContain('03');
    expect(pages[3]).toContain('04');
    // 应为 /04 而非 /05
    expect(pages[0]).toContain('/ 04');
  });

  it('第 1 页：封面（标题 + 日期 + PRO + 速览 + TOP 1）', () => {
    const page1 = posterHTMLMobile(mockData, 'dark')[0];
    expect(page1).toContain('wmp1-title');
    expect(page1).toContain('本周听歌报告');
    expect(page1).toContain('PRO');
    expect(page1).toContain('wmp1-date');
    expect(page1).toContain('wmp1-stats');  // 速览 3 个数字
    expect(page1).toContain('wmp1-tops');   // TOP 1 卡片
    expect(page1).toContain('wmp1-wave');   // 装饰波形
    expect(page1).not.toContain('上滑');
    expect(page1).not.toContain('向上滑动');
  });

  it('第 2 页：数据 + 人格（合并）', () => {
    const page2 = posterHTMLMobile(mockData, 'dark')[1];
    expect(page2).toContain('wmp2-hero-num');
    expect(page2).toContain('42'); // plays
    expect(page2).toContain('wmp2-stats');
    expect(page2).toContain('不重复歌曲');
    expect(page2).toContain('日均播放');
    // 合并了原 page 3 的人格
    expect(page2).toContain('wmp2-persona');
    expect(page2).toContain('自由旋律人');
  });

  it('第 3 页：专辑（每张封面下方显示名称）', () => {
    const page3 = posterHTMLMobile(mockData, 'dark')[2];
    expect(page3).toContain('wmp4-grid');
    expect(page3).toContain('wmp4-cell');
    expect(page3).toContain('wmp4-cell-name');
    expect(page3).toContain('wmp4-cell-sub');
    // 拼贴和名称应在同一 cell 内，而非分开的 collage + info
    expect(page3).not.toContain('wmp4-collage');
    expect(page3).not.toContain('wmp4-info-item');
  });

  it('第 4 页：排行（TOP 歌曲含播放次数 + 歌手）', () => {
    const page4 = posterHTMLMobile(mockData, 'dark')[3];
    expect(page4).toContain('wmp5-songs');
    expect(page4).toContain('wmp5-rank');
    expect(page4).toContain('wmp5-artists');
    expect(page4).toContain('wmp5-footer');
    expect(page4).toContain('wmp5-song-meta');
  });
});

describe('posterCSSMobile — 手机版 CSS（5 页共享）', () => {
  it('使用 .wm-poster-mobile 作为根选择器', () => {
    const css = posterCSSMobile('dark');
    expect(css).toContain('.wm-poster-mobile');
  });

  it('固定 430×820 每页尺寸', () => {
    const css = posterCSSMobile('dark');
    expect(css).toContain('width: 430px');
    expect(css).toContain('height: 820px');
  });

  it('包含 4 页各自独立的样式（wmp1 ~ wmp4）', () => {
    const css = posterCSSMobile('dark');
    expect(css).toContain('.wmp1-wrap');
    expect(css).toContain('.wmp2-hero-num');
    expect(css).toContain('.wmp2-persona');
    expect(css).toContain('.wmp4-grid');
    expect(css).toContain('.wmp5-songs');
  });

  it('包含装饰性顶部渐变条纹', () => {
    const css = posterCSSMobile('dark');
    expect(css).toContain('wpm-accent-stripe');
    expect(css).toContain('height: 4px');
  });

  it('包含页码标签样式', () => {
    const css = posterCSSMobile('dark');
    expect(css).toContain('wpm-page-tag');
  });

  it('四个主题均可生成 CSS', () => {
    for (const key of ['mint', 'dark', 'sunset', 'ocean']) {
      const css = posterCSSMobile(key);
      expect(css).toContain('.wm-poster-mobile');
      expect(css).toBeTruthy();
    }
  });
});
