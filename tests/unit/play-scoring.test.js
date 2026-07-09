/**
 * 视频候选评分 / 排序逻辑单元测试
 * 直接 import 源码纯函数。
 */
import { describe, it, expect } from 'vitest';
import {
  songKey, isLive, isExcluded, singerParts, matchSinger,
  scoreVideo, nameSegments, rank, songNameSuggestsLive,
} from '../../server/routes/play.js';

// helper
const mkVideo = (title, author = '', play = 1000, duration = 200) => ({
  bvid: 'BV' + Math.random().toString(36).slice(2, 10),
  title, author, play, duration,
});

describe('songKey', () => {
  it('生成 name__singer', () => { expect(songKey('晴天', '周杰伦')).toBe('晴天__周杰伦'); });
  it('空歌手', () => { expect(songKey('test', '')).toBe('test__'); });
});

describe('isLive — 现场版检测', () => {
  it('"现场版" → true', () => { expect(isLive('晴天 现场版')).toBe(true); });
  it('"Live" → true', () => { expect(isLive('晴天 Live')).toBe(true); });
  it('"演唱会" → true', () => { expect(isLive('演唱会录音')).toBe(true); });
  it('普通标题 → false', () => { expect(isLive('晴天 - 周杰伦')).toBe(false); });
  it('空标题 → false', () => { expect(isLive('')).toBe(false); });
});

describe('songNameSuggestsLive — 歌名是否暗示现场版', () => {
  it('歌名含 Live → true', () => { expect(songNameSuggestsLive('晴天 (Live)')).toBe(true); });
  it('歌名含 现场版 → true', () => { expect(songNameSuggestsLive('小美满 现场版')).toBe(true); });
  it('歌名含 演唱会 → true', () => { expect(songNameSuggestsLive('十年 演唱会')).toBe(true); });
  it('普通歌名 → false', () => { expect(songNameSuggestsLive('晴天')).toBe(false); });
  it('空歌名 → false', () => { expect(songNameSuggestsLive('')).toBe(false); });
});

describe('isExcluded — 黑名单过滤', () => {
  it('伴奏 → true', () => { expect(isExcluded('晴天 伴奏')).toBe(true); });
  it('纯音乐 → true', () => { expect(isExcluded('纯音乐')).toBe(true); });
  it('正常视频 → false', () => { expect(isExcluded('晴天 MV')).toBe(false); });
});

describe('singerParts — 歌手名拆分', () => {
  it('单个歌手', () => { expect(singerParts('周杰伦')).toEqual(['周杰伦']); });
  it('多歌手 / 分隔', () => { expect(singerParts('周杰伦/蔡依林')).toEqual(['周杰伦', '蔡依林']); });
  it('空格分隔', () => { expect(singerParts('Jay Chou')).toEqual(['jay', 'chou']); });
  it('过滤长度 < 2 的片段', () => { expect(singerParts('A B CD')).toEqual(['cd']); });
  it('空字符串', () => { expect(singerParts('')).toEqual([]); });
});

describe('matchSinger — 歌手匹配', () => {
  it('标题含歌手名 → true', () => {
    expect(matchSinger({ title: '周杰伦 - 晴天', author: 'xxx' }, ['周杰伦'])).toBe(true);
  });
  it('UP 主含歌手名 → true', () => {
    expect(matchSinger({ title: '晴天', author: '周杰伦官方频道' }, ['周杰伦'])).toBe(true);
  });
  it('都不含 → false', () => {
    expect(matchSinger({ title: '晴天', author: '路人甲' }, ['周杰伦'])).toBe(false);
  });
  it('无歌手 → true', () => {
    expect(matchSinger({ title: '晴天' }, [])).toBe(true);
  });
});

describe('scoreVideo — 视频评分', () => {
  it('歌名完全匹配 + 标题含歌手 + 时长接近 → 高分', () => {
    const v = mkVideo('周杰伦 - 晴天 官方 MV', '周杰伦VEVO', 1e6, 200);
    const s = scoreVideo(v, '晴天', '周杰伦', 200);
    expect(s).toBeGreaterThan(170);
  });

  it('完全不匹配 → 低分', () => {
    const v = mkVideo('随便什么视频', '张三', 100, 9999);
    expect(scoreVideo(v, '晴天', '周杰伦', 200)).toBeLessThan(20);
  });

  it('翻唱应被降权', () => {
    const good = scoreVideo(mkVideo('周杰伦 - 晴天', 'Jay Chou', 1e5, 200), '晴天', '周杰伦', 200);
    const bad = scoreVideo(mkVideo('翻唱 晴天', '路人', 1e5, 200), '晴天', '周杰伦', 200);
    expect(good).toBeGreaterThan(bad);
  });

  it('播放量越高分越高', () => {
    expect(scoreVideo(mkVideo('晴天', '', 1e7, 200), '晴天', '', 200))
      .toBeGreaterThan(scoreVideo(mkVideo('晴天', '', 100, 200), '晴天', '', 200));
  });

  it('时长差异大 → 扣分', () => {
    expect(scoreVideo(mkVideo('晴天', '', 1000, 200), '晴天', '', 200))
      .toBeGreaterThan(scoreVideo(mkVideo('晴天', '', 1000, 400), '晴天', '', 200));
  });

  it('高音质关键词加分', () => {
    expect(scoreVideo(mkVideo('晴天 无损 Hi-Res', '', 1000, 200), '晴天', '', 200))
      .toBeGreaterThan(scoreVideo(mkVideo('晴天', '', 1000, 200), '晴天', '', 200));
  });

  it('UP 主名完全匹配歌手 → 加分', () => {
    expect(scoreVideo(mkVideo('晴天', '周杰伦', 1000, 200), '晴天', '周杰伦', 200))
      .toBeGreaterThan(scoreVideo(mkVideo('晴天', '路人', 1000, 200), '晴天', '周杰伦', 200));
  });
});

describe('nameSegments — 歌名片段', () => {
  it('中文歌名 → 2-gram', () => {
    expect(nameSegments('晴天')).toEqual(['晴天']);
  });
  it('三字中文 → 2-gram', () => {
    const segs = nameSegments('七里香');
    expect(segs).toContain('七里');
    expect(segs).toContain('里香');
  });
  it('英文单词整段', () => {
    expect(nameSegments('Hello')).toEqual(['hello']);
  });
  it('括号内内容被提取为独立片段', () => {
    const segs = nameSegments('晴天 (Live)');
    expect(segs).toContain('晴天');
    expect(segs).toContain('live');
  });
  it('空 → []', () => { expect(nameSegments('')).toEqual([]); });
  it('混合中英 → 以空格为整体单词', () => {
    const segs = nameSegments('Love Story');
    expect(segs).toContain('love story');
  });
});

describe('rank — 综合排序', () => {
  it('过滤伴奏', () => {
    const r = rank([mkVideo('晴天 伴奏'), mkVideo('晴天 MV')], '晴天', '周杰伦', 200);
    expect(r).toHaveLength(1);
    expect(r[0].title).toBe('晴天 MV');
  });

  it('有该歌手版本时过滤其他歌手', () => {
    const videos = [
      mkVideo('晴天', '路人甲'),
      mkVideo('周杰伦 晴天', 'Jay'),
      mkVideo('晴天 翻唱', '周杰伦VEVO'),
    ];
    const r = rank(videos, '晴天', '周杰伦', 200);
    expect(r.every((v) => v.singerOk)).toBe(true);
  });

  it('现场版排后面', () => {
    const r = rank([mkVideo('晴天 现场版'), mkVideo('晴天 MV')], '晴天', '', 200);
    expect(r[0].live).toBe(false);
    expect(r[1].live).toBe(true);
  });

  it('歌名片段过滤：无关联视频直接排除', () => {
    const r = rank([mkVideo('完全无关'), mkVideo('晴天 MV')], '晴天', '', 200);
    expect(r).toHaveLength(1);
    expect(r[0].title).toBe('晴天 MV');
  });

  it('高分排前面', () => {
    const v1 = mkVideo('晴天 翻唱', '', 100, 200);
    const v2 = mkVideo('晴天 官方 MV', '官方频道', 1e6, 200);
    const r = rank([v1, v2], '晴天', '', 200);
    expect(r[0].score).toBeGreaterThan(r[1].score);
  });

  it('歌名含 Live 时现场版获 +30 提权：同条件下碾压 studio 版', () => {
    // 这首歌就叫 "晴天 (Live)"，现场版就是正确答案
    // 两个视频基础条件相同（同歌手、同播放、同时长），仅 live 标记不同
    // 现场版应获得 +30 提权，排到最前
    const live = mkVideo('晴天 Live', '周杰伦', 1e5, 200);
    const studio = mkVideo('晴天', '周杰伦', 1e5, 200);
    const r = rank([studio, live], '晴天 (Live)', '周杰伦', 200);
    expect(r[0].live).toBe(true);
    expect(r[0].score).toBeGreaterThan(r[1].score);
  });

  it('普通歌名仍然非现场优先（原有行为不变）', () => {
    const live = mkVideo('晴天 现场版', '', 1e6, 200);
    const studio = mkVideo('晴天 MV', '', 1e5, 200);
    const r = rank([live, studio], '晴天', '', 200);
    expect(r[0].live).toBe(false);
    expect(r[1].live).toBe(true);
  });
});
