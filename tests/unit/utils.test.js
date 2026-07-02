/**
 * 前端 utils.js 纯函数单元测试
 */
import { describe, it, expect } from 'vitest';
import {
  fmtDur, fmtTotal, fmtMin, fmtSec, fmtPlay, esc, albumCover,
} from '../../src/utils.js';

describe('fmtDur — 秒转时长', () => {
  it('0 秒 → "0:00"', () => { expect(fmtDur(0)).toBe('0:00'); });
  it('61 秒 → "1:01"', () => { expect(fmtDur(61)).toBe('1:01'); });
  it('187 秒 → "3:07"', () => { expect(fmtDur(187)).toBe('3:07'); });
  it('3661 秒 → "1:01:01"', () => { expect(fmtDur(3661)).toBe('1:01:01'); });
  it('负数保留符号（|| 0 只处理 falsy）', () => { expect(fmtDur(-5)).toBe('-1:-5'); });
  it('null/undefined → "0:00"', () => { expect(fmtDur(null)).toBe('0:00'); });
  it('字符串数字', () => { expect(fmtDur('180')).toBe('3:00'); });
  it('补零：60 秒', () => { expect(fmtDur(60)).toBe('1:00'); });
});

describe('fmtTotal — 中文时长总计', () => {
  it('0 秒 → "0 分"', () => { expect(fmtTotal(0)).toBe('0 分'); });
  it('180 秒 → "3 分"', () => { expect(fmtTotal(180)).toBe('3 分'); });
  it('3600 秒 → "1 小时 0 分"', () => { expect(fmtTotal(3600)).toBe('1 小时 0 分'); });
  it('7200 秒 → "2 小时 0 分"', () => { expect(fmtTotal(7200)).toBe('2 小时 0 分'); });
  it('7500 秒 → "2 小时 5 分"', () => { expect(fmtTotal(7500)).toBe('2 小时 5 分'); });
});

describe('fmtMin — 简写时长', () => {
  it('< 60 秒 → "0m"', () => { expect(fmtMin(30)).toBe('0m'); });
  it('180 秒 → "3m"', () => { expect(fmtMin(180)).toBe('3m'); });
  it('3660 秒 → "1h1m"', () => { expect(fmtMin(3660)).toBe('1h1m'); });
});

describe('fmtSec — 中文分秒', () => {
  it('30 秒 → "0分钟"', () => { expect(fmtSec(30)).toBe('0分钟'); });
  it('180 秒 → "3分钟"', () => { expect(fmtSec(180)).toBe('3分钟'); });
  it('3660 秒 → "1小时1分"', () => { expect(fmtSec(3660)).toBe('1小时1分'); });
});

describe('fmtPlay — 播放量格式化', () => {
  it('0 → "0"', () => { expect(fmtPlay(0)).toBe('0'); });
  it('500 → "500"', () => { expect(fmtPlay(500)).toBe('500'); });
  it('10000 → "1.0万"', () => { expect(fmtPlay(10000)).toBe('1.0万'); });
  it('50000 → "5.0万"', () => { expect(fmtPlay(50000)).toBe('5.0万'); });
  it('12345678 → "1234.6万"', () => { expect(fmtPlay(12345678)).toBe('1234.6万'); });
  it('100000000 → "1.0亿"', () => { expect(fmtPlay(100000000)).toBe('1.0亿'); });
  it('500000000 → "5.0亿"', () => { expect(fmtPlay(500000000)).toBe('5.0亿'); });
  it('null → "0"', () => { expect(fmtPlay(null)).toBe('0'); });
});

describe('esc — HTML 转义', () => {
  it('普通文本不变', () => { expect(esc('hello')).toBe('hello'); });
  it('& → &amp;', () => { expect(esc('A & B')).toBe('A &amp; B'); });
  it('< → &lt;', () => { expect(esc('<script>')).toBe('&lt;script&gt;'); });
  it('> → &gt;', () => { expect(esc('</div>')).toBe('&lt;/div&gt;'); });
  it('" → &quot;', () => { expect(esc('"hello"')).toBe('&quot;hello&quot;'); });
  it('null/undefined → 空字符串', () => { expect(esc(null)).toBe(''); });
  it('复合转义', () => { expect(esc('<a href="x">link</a>')).toBe('&lt;a href=&quot;x&quot;&gt;link&lt;/a&gt;'); });
});

describe('albumCover — 封面 URL', () => {
  it('正常 mid 返回完整 URL', () => {
    const url = albumCover('003RMaRI1iFoYd', 300);
    expect(url).toContain('y.qq.com');
    expect(url).toContain('003RMaRI1iFoYd');
    expect(url).toContain('T002R300x300M000');
  });
  it('空 mid 返回空字符串', () => { expect(albumCover('')).toBe(''); });
  it('null mid 返回空字符串', () => { expect(albumCover(null)).toBe(''); });
  it('默认尺寸 300', () => {
    const url = albumCover('abc');
    expect(url).toContain('300x300');
  });
  it('指定尺寸 150', () => {
    const url = albumCover('abc', 150);
    expect(url).toContain('150x150');
  });
});
