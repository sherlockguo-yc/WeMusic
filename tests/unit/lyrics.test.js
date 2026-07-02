/**
 * 歌词服务纯函数单元测试
 */
import { describe, it, expect } from 'vitest';
import { parseLrc } from '../../server/services/lyrics.js';

describe('parseLrc — LRC 歌词解析', () => {
  it('空字符串 → []', () => {
    expect(parseLrc('')).toEqual([]);
  });

  it('标准 LRC 格式', () => {
    const lrc = `[00:12.50]第一句
[00:25.00]第二句
[01:03.80]第三句`;
    const result = parseLrc(lrc);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ time: 12.5, text: '第一句' });
    expect(result[1]).toEqual({ time: 25, text: '第二句' });
    expect(result[2]).toEqual({ time: 63.8, text: '第三句' });
  });

  it('多时间戳行（重复歌词）', () => {
    const lrc = `[00:10.00][00:20.00]副歌`;
    const result = parseLrc(lrc);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ time: 10, text: '副歌' });
    expect(result[1]).toEqual({ time: 20, text: '副歌' });
  });

  it('无时间戳行 time=-1', () => {
    const lrc = `[00:05.00]有时间的
纯文本行`;
    const result = parseLrc(lrc);
    expect(result).toHaveLength(2);
    // parseLrc 在有 timestamp 时会排序：time=-1 排在最前面
    expect(result[0]).toEqual({ time: -1, text: '纯文本行' });
    expect(result[1]).toEqual({ time: 5, text: '有时间的' });
  });

  it('混有时间戳和无时间戳，排序后无时间戳的在前', () => {
    const lrc = `[00:20.00]后面
纯文本
[00:05.00]前面`;
    const result = parseLrc(lrc);
    // 有 timestamp 时按时间排序，-1 < 5 < 20
    expect(result[0].time).toBe(-1);
    expect(result[1].time).toBe(5);
    expect(result[2].time).toBe(20);
  });

  it('忽略元信息标签行 [ti:xx] [ar:xx]', () => {
    const lrc = `[ti:歌名]
[ar:歌手]
[00:01.00]第一句`;
    const result = parseLrc(lrc);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ time: 1, text: '第一句' });
  });

  it('整数秒', () => {
    const lrc = `[01:30]一句`;
    const result = parseLrc(lrc);
    expect(result[0].time).toBe(90);
  });

  it('中文歌词', () => {
    const lrc = `[00:15.20]故事的小黄花 从出生那年就飘着`;
    const result = parseLrc(lrc);
    expect(result).toHaveLength(1);
    expect(result[0].time).toBe(15.2);
    expect(result[0].text).toBe('故事的小黄花 从出生那年就飘着');
  });

  it('解析后排序', () => {
    const lrc = `[01:00.00]第三
[00:30.00]第二
[00:10.00]第一`;
    const result = parseLrc(lrc);
    expect(result.map((l) => l.time)).toEqual([10, 30, 60]);
  });
});
