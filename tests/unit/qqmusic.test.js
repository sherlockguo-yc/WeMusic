/**
 * QQ 音乐服务纯函数单元测试
 */
import { describe, it, expect } from 'vitest';
import { extractDisstid, deduplicateByAlbum } from '../../server/services/qqmusic.js';

describe('extractDisstid — 提取歌单 ID', () => {
  it('纯数字字符串 → 返回数字', () => {
    expect(extractDisstid('123456')).toBe('123456');
  });
  it('null → null', () => {
    expect(extractDisstid(null)).toBe(null);
  });
  it('空字符串 → null', () => {
    expect(extractDisstid('')).toBe(null);
  });
  it('playlist/ 格式', () => {
    expect(extractDisstid('https://y.qq.com/n/ryqq/playlist/123456789')).toBe('123456789');
  });
  it('?id= 参数格式', () => {
    expect(extractDisstid('https://y.qq.com/n/ryqq/playlist?id=987654321')).toBe('987654321');
  });
  it('disstid= 参数格式', () => {
    expect(extractDisstid('https://y.qq.com/n/ryqq/playlist?disstid=111222333')).toBe('111222333');
  });
  it('URL 中含 6 位以上数字 → 提取最长', () => {
    expect(extractDisstid('/path/1234567/info')).toBe('1234567');
  });
  it('不同 format 的 URL', () => {
    expect(extractDisstid('https://i.y.qq.com/n2/m/share/details/taoge.html?id=7522300512')).toBe('7522300512');
  });
  it('短数字（< 4位）→ null', () => {
    expect(extractDisstid('123')).toBe(null);
  });
});

describe('deduplicateByAlbum — 按专辑去重', () => {
  // 构建测试歌曲
  const mkSong = (name, singer, album) => ({ name, singer, album });

  it('空数组 → 空数组', () => {
    expect(deduplicateByAlbum([])).toEqual([]);
  });

  it('无重复 → 保持原样', () => {
    const songs = [
      mkSong('晴天', '周杰伦', '叶惠美'),
      mkSong('七里香', '周杰伦', '七里香'),
    ];
    const result = deduplicateByAlbum(songs, 'name+singer');
    expect(result).toHaveLength(2);
  });

  it('同名同歌手 → 去重保留非精选集', () => {
    const songs = [
      mkSong('晴天', '周杰伦', '叶惠美'),
      mkSong('晴天', '周杰伦', '周杰伦精选集'),
    ];
    const result = deduplicateByAlbum(songs, 'name+singer');
    expect(result).toHaveLength(1);
    expect(result[0].album).toBe('叶惠美');
  });

  it('同名同歌手全是精选集 → 保留第一个', () => {
    const songs = [
      mkSong('晴天', '周杰伦', '周杰伦精选集'),
      mkSong('晴天', '周杰伦', '周杰伦金曲全集'),
    ];
    const result = deduplicateByAlbum(songs, 'name+singer');
    expect(result).toHaveLength(1);
    expect(result[0].album).toBe('周杰伦精选集');
  });

  it('mode="name" 同歌手下按歌名去重', () => {
    const songs = [
      mkSong('晴天', '周杰伦', '叶惠美'),
      mkSong('晴天', '周杰伦', '我是歌手 第3期'),
    ];
    const result = deduplicateByAlbum(songs, 'name');
    expect(result).toHaveLength(1);
    expect(result[0].album).toBe('叶惠美');
  });

  it('不同歌手同名歌 → 不合并', () => {
    const songs = [
      mkSong('晴天', '周杰伦', '叶惠美'),
      mkSong('晴天', '刘瑞琦', '翻唱集'),
    ];
    const result = deduplicateByAlbum(songs, 'name+singer');
    expect(result).toHaveLength(2);
  });

  it('常见精选集关键词', () => {
    const songs = [
      mkSong('七里香', '周杰伦', 'Greatest Hits'),
      mkSong('七里香', '周杰伦', '七里香'),
    ];
    const result = deduplicateByAlbum(songs, 'name+singer');
    expect(result).toHaveLength(1);
    expect(result[0].album).toBe('七里香');
  });

  // normalizeSong 无法直接测试（依赖外部数据结构），
  // 但可以间接验证其输出字段
});
