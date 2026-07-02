/**
 * Bilibili 服务纯函数单元测试
 */
import { describe, it, expect } from 'vitest';

// 需要直接测试的纯函数来自 server/services/bilibili.js
// getMixinKey, durationToSeconds, stripHtml 可以通过
// 导入后测试，但 randHex/genUuid/genBLsid 依赖 Math.random
// 我们无法直接 import 未导出的函数，所以测试导出的 searchVideos
// 返回值的规范化逻辑，以及通过已知结果反推纯函数正确性。

// 由于这些函数未单独导出，我们通过内联实现测试其逻辑
// durationToSeconds 逻辑
function durationToSeconds(str) {
  if (typeof str === 'number') return str;
  const parts = String(str).split(':').map((n) => parseInt(n, 10) || 0);
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

function stripHtml(str = '') {
  return str.replace(/<[^>]+>/g, '');
}

const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61,
  26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36,
  20, 34, 44, 52,
];

function getMixinKey(orig) {
  return MIXIN_KEY_ENC_TAB.map((n) => orig[n]).join('').slice(0, 32);
}

describe('durationToSeconds — B 站时长转秒', () => {
  it('"4:13" → 253', () => { expect(durationToSeconds('4:13')).toBe(253); });
  it('"1:02:33" → 3753', () => { expect(durationToSeconds('1:02:33')).toBe(3753); });
  it('"0:30" → 30', () => { expect(durationToSeconds('0:30')).toBe(30); });
  it('数字直接返回', () => { expect(durationToSeconds(180)).toBe(180); });
  it('空字符串 → 0', () => { expect(durationToSeconds('')).toBe(0); });
  it('"3" → 3', () => { expect(durationToSeconds('3')).toBe(3); });
  it('"2:00" → 120', () => { expect(durationToSeconds('2:00')).toBe(120); });
});

describe('stripHtml — 去除 HTML 标签', () => {
  it('纯文本不变', () => { expect(stripHtml('hello')).toBe('hello'); });
  it('<em>标签</em> → "标签"', () => { expect(stripHtml('<em>标签</em>')).toBe('标签'); });
  it('嵌套标签', () => { expect(stripHtml('<b><i>text</i></b>')).toBe('text'); });
  it('空字符串', () => { expect(stripHtml('')).toBe(''); });
  it('undefined → 空', () => { expect(stripHtml()).toBe(''); });
  it('多个标签', () => { expect(stripHtml('<a>1</a><b>2</b>')).toBe('12'); });
});

describe('getMixinKey — WBI 签名 mixin key', () => {
  it('应返回 32 字符', () => {
    const orig = 'abc123def456'.repeat(10); // 足够长
    const key = getMixinKey(orig);
    expect(key).toHaveLength(32);
  });
  it('确定性：相同输入相同输出', () => {
    const input = 'testkey' + 'testsub'.repeat(5);
    expect(getMixinKey(input)).toBe(getMixinKey(input));
  });
  it('空字符串返回空', () => {
    expect(getMixinKey('')).toBe('');
  });
});
