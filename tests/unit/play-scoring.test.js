/**
 * 视频候选评分 / 排序逻辑单元测试
 * 这是项目核心业务逻辑，必须严格覆盖。
 */
import { describe, it, expect } from 'vitest';

// 复制 server/routes/play.js 中的核心纯函数逻辑
function songKey(name, singer) { return `${name || ''}__${singer || ''}`; }

const LIVE_KW = ['现场', '演唱会', '音乐节', 'live', 'concert', '开演', '演奏会', '巡演', 'tour', '现场版', 'livehouse', '路演', '快闪'];
const EXCLUDE_KW = ['伴奏', '純音樂', '纯音乐', 'instrumental', 'karaoke', '消音', '人声消除'];
const HQ_KW = ['无损', '無損', 'flac', 'hi-res', 'hires', 'hi res', '母带', '高音质', '高品质', 'lossless', 'hifi', 'hi-fi', '24bit', 'dolby', '杜比', 'sq', '臻品'];
const GOOD_KW = ['官方', 'mv', '完整版', 'audio', '原版', '正式版', '官方音频'];
const BAD_KW = ['翻唱', 'cover', '教学', '钢琴版', '吉他教学', '鬼畜', '剪辑', '合集', 'remix', 'dj', '变速', '加速', '慢速', '八音盒', 'ai', '空耳', '玩具', '电子琴'];

function isLive(title = '') {
  const t = title.toLowerCase();
  return LIVE_KW.some((k) => t.includes(k.toLowerCase()));
}
function isExcluded(title = '') {
  const t = title.toLowerCase();
  return EXCLUDE_KW.some((k) => t.includes(k.toLowerCase()));
}
function singerParts(singer = '') {
  return singer.split(/[\/、,&\s]+/).map((s) => s.trim().toLowerCase()).filter((s) => s.length >= 2);
}
function matchSinger(v, parts) {
  if (!parts.length) return true;
  const hay = `${v.title || ''} ${v.author || ''}`.toLowerCase();
  return parts.some((p) => hay.includes(p));
}
function scoreVideo(v, name, singer, expectDur) {
  const title = v.title || '';
  const t = title.toLowerCase();
  let score = 0;
  if (name && title.includes(name)) score += 50;
  else if (name) {
    const hit = [...name].filter((c) => title.includes(c)).length;
    score += Math.round((hit / Math.max(1, name.length)) * 30);
  }
  if (singer) {
    const s = singer.split(/[\/、,&]/)[0].trim();
    if (s) {
      if (title.includes(s)) score += 30;
      else if ((v.author || '').includes(s)) score += 20;
    }
  }
  if (expectDur > 0 && v.duration > 0) {
    const diff = Math.abs(v.duration - expectDur);
    if (diff <= 10) score += 40;
    else if (diff <= 25) score += 22;
    else if (diff <= 60) score += 6;
    else score -= 25;
  }
  const pl = v.play || 1;
  if (pl >= 1e7) score += 55;
  else if (pl >= 1e6) score += 40;
  else if (pl >= 1e5) score += 25;
  else if (pl >= 1e4) score += 12;
  else score += Math.min(6, Math.log10(pl) * 2.5);
  if (HQ_KW.some((k) => t.includes(k))) score += 30;
  const isOfficial = t.includes('官方');
  const isMV = t.includes('mv');
  if (isOfficial && isMV) score += 42;
  else if (isOfficial) score += 28;
  else if (isMV) score += 20;
  for (const k of GOOD_KW) {
    if (k === '官方' || k === 'mv') continue;
    if (t.includes(k)) score += 10;
  }
  if (singer && v.author && v.author.toLowerCase() === singer.toLowerCase()) score += 18;
  for (const k of BAD_KW) if (t.includes(k)) score -= 14;
  return Math.round(score);
}
function nameSegments(name) {
  if (!name) return [];
  const segs = [];
  let buf = '';
  for (const c of name) {
    if (/[()（）]/.test(c)) {
      if (buf.trim()) segs.push(buf.trim());
      buf = '';
      continue;
    }
    if (/[一-龥]/.test(c)) {
      if (/[a-zA-Z0-9]/.test(buf[buf.length - 1] || '')) { segs.push(buf.trim()); buf = ''; }
      buf += c;
    } else {
      if (/[一-龥]/.test(buf[buf.length - 1] || '')) { segs.push(buf.trim()); buf = ''; }
      buf += c;
    }
  }
  if (buf.trim()) segs.push(buf.trim());
  const out = [];
  for (const s of segs) {
    if (/[一-龥]/.test(s[0])) {
      if (s.length >= 2) {
        for (let i = 0; i <= s.length - 2; i++) out.push(s.slice(i, i + 2));
      } else out.push(s);
    } else {
      if (s.length >= 2) out.push(s.toLowerCase());
    }
  }
  return out;
}
function rank(videos, name, singer, expectDur) {
  const parts = singerParts(singer);
  const segs = nameSegments(name);
  let scored = videos
    .filter((v) => !isExcluded(v.title))
    .filter((v) => {
      if (!segs.length) return true;
      const t = (v.title || '').toLowerCase();
      return segs.some((s) => t.includes(s.toLowerCase()));
    })
    .map((v) => ({
      ...v, live: isLive(v.title),
      hq: HQ_KW.some((k) => (v.title || '').toLowerCase().includes(k.toLowerCase())),
      singerOk: matchSinger(v, parts),
      score: scoreVideo(v, name, singer, expectDur),
    }));
  if (parts.length) {
    const matched = scored.filter((v) => v.singerOk);
    if (matched.length) scored = matched;
  }
  scored.sort((a, b) => { if (a.live !== b.live) return a.live ? 1 : -1; return b.score - a.score; });
  return scored;
}

// helper
const mkVideo = (title, author = '', play = 1000, duration = 200) => ({
  bvid: 'BV' + Math.random().toString(36).slice(2, 10),
  title, author, play, duration,
});

// ===== Tests =====

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
    const score = scoreVideo(v, '晴天', '周杰伦', 200);
    expect(score).toBeGreaterThan(170); // 50(title) + 30(singer in title) + 40(dur) + 40(play) + 42(官方MV)
  });

  it('完全不匹配 → 低分', () => {
    const v = mkVideo('随便什么视频', '张三', 100, 9999);
    expect(scoreVideo(v, '晴天', '周杰伦', 200)).toBeLessThan(20);
  });

  it('翻唱应被降权', () => {
    const good = mkVideo('周杰伦 - 晴天', 'Jay Chou', 1e5, 200);
    const bad = mkVideo('翻唱 晴天', '路人', 1e5, 200);
    expect(scoreVideo(good, '晴天', '周杰伦', 200)).toBeGreaterThan(scoreVideo(bad, '晴天', '周杰伦', 200));
  });

  it('播放量越高分越高', () => {
    const low = scoreVideo(mkVideo('晴天', '', 100, 200), '晴天', '', 200);
    const high = scoreVideo(mkVideo('晴天', '', 1e7, 200), '晴天', '', 200);
    expect(high).toBeGreaterThan(low);
  });

  it('时长差异大 → 扣分', () => {
    const close = scoreVideo(mkVideo('晴天', '', 1000, 200), '晴天', '', 200);
    const far = scoreVideo(mkVideo('晴天', '', 1000, 400), '晴天', '', 200);
    expect(close).toBeGreaterThan(far);
  });

  it('高音质关键词加分', () => {
    const normal = scoreVideo(mkVideo('晴天', '', 1000, 200), '晴天', '', 200);
    const hq = scoreVideo(mkVideo('晴天 无损 Hi-Res', '', 1000, 200), '晴天', '', 200);
    expect(hq).toBeGreaterThan(normal);
  });

  it('UP 主名完全匹配歌手 → 加分', () => {
    const match = scoreVideo(mkVideo('晴天', '周杰伦', 1000, 200), '晴天', '周杰伦', 200);
    const noMatch = scoreVideo(mkVideo('晴天', '路人', 1000, 200), '晴天', '周杰伦', 200);
    expect(match).toBeGreaterThan(noMatch);
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
  it('英文歌名', () => {
    expect(nameSegments('Hello')).toEqual(['hello']);
  });
  it('括号作为分隔符，括号内内容被提取', () => {
    const segs = nameSegments('晴天 (Live)');
    expect(segs).toContain('晴天');
    expect(segs).toContain('live'); // 括号作为分隔符，内容被提取
  });
  it('空 → []', () => { expect(nameSegments('')).toEqual([]); });
  it('混合中英 → 以空格为整体单词', () => {
    const segs = nameSegments('Love Story');
    expect(segs).toContain('love story');
  });
});

describe('rank — 综合排序', () => {
  it('过滤伴奏', () => {
    const videos = [
      mkVideo('晴天 伴奏'),
      mkVideo('晴天 MV'),
    ];
    const r = rank(videos, '晴天', '周杰伦', 200);
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
    const videos = [
      mkVideo('晴天 现场版'),
      mkVideo('晴天 MV'),
    ];
    const r = rank(videos, '晴天', '', 200);
    expect(r[0].live).toBe(false);
    expect(r[1].live).toBe(true);
  });

  it('歌名片段过滤：无关联视频直接排除', () => {
    const videos = [
      mkVideo('完全无关'),
      mkVideo('晴天 MV'),
    ];
    const r = rank(videos, '晴天', '', 200);
    expect(r).toHaveLength(1);
    expect(r[0].title).toBe('晴天 MV');
  });

  it('高分排前面', () => {
    const videos = [
      mkVideo('晴天 翻唱', '', 100, 200),
      mkVideo('晴天 官方 MV', '官方频道', 1e6, 200),
    ];
    const r = rank(videos, '晴天', '', 200);
    expect(r[0].score).toBeGreaterThan(r[1].score);
  });
});
