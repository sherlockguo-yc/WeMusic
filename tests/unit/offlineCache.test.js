import { describe, it, expect } from 'vitest';
import { chooseEvictions, cacheKey } from '../../src/offlineCache.js';

describe('cacheKey', () => {
  it('以 bvid 为键', () => {
    expect(cacheKey('BV1xx')).toBe('BV1xx');
  });
});

describe('chooseEvictions (LRU)', () => {
  const mk = (key, size, lastAccessed, pinned) => ({ key, size, lastAccessed, pinned });
  it('超限时只淘汰被动项，且从最旧开始', () => {
    const entries = [
      mk('a', 100, 10, false),
      mk('b', 100, 5, false),   // 最旧
      mk('c', 100, 20, true),   // 钉住，不可淘汰
    ];
    const del = chooseEvictions(entries, 150); // 仅容 150，需删 150
    expect(del).toEqual(['b', 'a']);           // 先删最旧 b，再删 a；c 保留
    expect(del).not.toContain('c');
  });
  it('钉住项永不被淘汰', () => {
    const entries = [ mk('x', 1000, 1, true) ];
    expect(chooseEvictions(entries, 1)).toEqual([]);
  });
  it('未超限不淘汰', () => {
    const entries = [ mk('a', 100, 1, false) ];
    expect(chooseEvictions(entries, 200)).toEqual([]);
  });
  it('仅一个被动项且未超限时不淘汰', () => {
    const entries = [ mk('a', 100, 1, false), mk('p', 900, 2, true) ];
    expect(chooseEvictions(entries, 1000)).toEqual([]);
  });
});
