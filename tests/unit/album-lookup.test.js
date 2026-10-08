/**
 * 专辑 mid 反查纯函数单元测试（Apple / 网易云导入歌曲补封面）
 * 网络层（lookupAlbumMid / fillAlbumMids）不在此测试，用真实数据端到端验证。
 */
import { describe, it, expect } from 'vitest';
import { pickAlbumMid, needsAlbumMidFill } from '../../server/services/qqmusic.js';

describe('needsAlbumMidFill — 判定专辑 mid 是否需要反查补齐', () => {
  it('空值（Apple 导入）→ 需要补', () => {
    expect(needsAlbumMidFill('')).toBe(true);
    expect(needsAlbumMidFill(null)).toBe(true);
    expect(needsAlbumMidFill(undefined)).toBe(true);
  });

  it('纯数字（网易云的数字专辑 ID）→ 需要补', () => {
    expect(needsAlbumMidFill('178396523')).toBe(true);
    expect(needsAlbumMidFill(12345)).toBe(true);
  });

  it('有效 QQ mid（14 位 base62）→ 不需要补', () => {
    expect(needsAlbumMidFill('0049MVh824D7bM')).toBe(false);
    expect(needsAlbumMidFill('000MkMni19ClKG')).toBe(false);
  });
});

describe('pickAlbumMid — 从 QQ 搜索结果挑选 album_mid', () => {
  it('歌名精确匹配 + 歌手命中优先（跳过先出现的其他歌手版本）', () => {
    const songs = [
      { name: '摩天动物园', singer: '张三翻唱', album_mid: 'WRONG' },
      { name: '摩天动物园', singer: 'G.E.M.邓紫棋', album_mid: 'RIGHT' },
    ];
    expect(pickAlbumMid(songs, '摩天动物园', '邓紫棋')).toBe('RIGHT');
  });

  it('歌手都不命中 → 取第一个歌名精确匹配项', () => {
    const songs = [
      { name: '摩天动物园', singer: '张三翻唱', album_mid: 'FIRST' },
      { name: '摩天动物园', singer: 'G.E.M.邓紫棋', album_mid: 'SECOND' },
    ];
    expect(pickAlbumMid(songs, '摩天动物园', '李四')).toBe('FIRST');
  });

  it('歌名非精确匹配（如 Live 版）→ 返回空，不张冠李戴', () => {
    const songs = [{ name: '摩天动物园 (Live)', singer: '邓紫棋', album_mid: 'LIVE' }];
    expect(pickAlbumMid(songs, '摩天动物园', '邓紫棋')).toBe('');
  });

  it('忽略大小写与前后空白', () => {
    const songs = [{ name: 'Hello', singer: 'Adele', album_mid: 'X1' }];
    expect(pickAlbumMid(songs, '  hello  ', ' adele ')).toBe('X1');
  });

  it('多歌手只取第一段参与匹配', () => {
    const songs = [{ name: '光年之外', singer: 'G.E.M.邓紫棋', album_mid: 'GG' }];
    expect(pickAlbumMid(songs, '光年之外', '邓紫棋 / 某某')).toBe('GG');
  });

  it('空歌名 / 空结果 / 命中项无 mid → 均返回空', () => {
    expect(pickAlbumMid([{ name: 'x', album_mid: 'A' }], '')).toBe('');
    expect(pickAlbumMid([], '晴天', '周杰伦')).toBe('');
    expect(pickAlbumMid(null, '晴天', '周杰伦')).toBe('');
    expect(pickAlbumMid([{ name: '晴天', singer: '周杰伦' }], '晴天', '周杰伦')).toBe('');
  });
});
