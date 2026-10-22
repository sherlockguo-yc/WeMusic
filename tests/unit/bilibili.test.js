/**
 * Bilibili 服务纯函数单元测试 — 直接 import 源码
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { durationToSeconds, stripHtml, getVideoPages, checkVideoPlayable } from '../../server/services/bilibili.js';

// getMixinKey 未被导出（内部用），复制其逻辑测试
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
  it('"4:13" → 253', () => expect(durationToSeconds('4:13')).toBe(253));
  it('"1:02:33" → 3753', () => expect(durationToSeconds('1:02:33')).toBe(3753));
  it('"0:30" → 30', () => expect(durationToSeconds('0:30')).toBe(30));
  it('数字直接返回', () => expect(durationToSeconds(180)).toBe(180));
  it('空字符串 → 0', () => expect(durationToSeconds('')).toBe(0));
  it('"3" → 3', () => expect(durationToSeconds('3')).toBe(3));
  it('"2:00" → 120', () => expect(durationToSeconds('2:00')).toBe(120));
});

describe('stripHtml — 去除 HTML 标签', () => {
  it('纯文本不变', () => expect(stripHtml('hello')).toBe('hello'));
  it('<em>标签</em> → "标签"', () => expect(stripHtml('<em>标签</em>')).toBe('标签'));
  it('嵌套标签', () => expect(stripHtml('<b><i>text</i></b>')).toBe('text'));
  it('空字符串', () => expect(stripHtml('')).toBe(''));
  it('undefined → 空', () => expect(stripHtml()).toBe(''));
  it('多个标签', () => expect(stripHtml('<a>1</a><b>2</b>')).toBe('12'));
});

describe('getMixinKey — WBI 签名 mixin key', () => {
  it('应返回 32 字符', () => expect(getMixinKey('a'.repeat(100))).toHaveLength(32));
  it('确定性：相同输入相同输出', () => {
    const input = 'test'.repeat(16);
    expect(getMixinKey(input)).toBe(getMixinKey(input));
  });
  it('空字符串返回空', () => expect(getMixinKey('')).toBe(''));
});

// view 接口错误码分类：这段逻辑决定前端「换源」还是「重试」，回归代价很高。
// 背景见 2026-10-22 线上问题：坏稿件被静默转成空数组，最终只剩「未获取到视频 cid」，
// 前端误判为网络问题，强制切歌。
describe('getVideoPages — view 接口错误码分类', () => {
  const stubFetchJson = (payload) => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => payload })));
  };
  afterEach(() => vi.unstubAllGlobals());

  it('code=0 且有 pages → 返回 pages', async () => {
    stubFetchJson({ code: 0, data: { pages: [{ cid: 111 }] } });
    const pages = await getVideoPages('BVcode0xxx');
    expect(pages).toHaveLength(1);
    expect(pages[0].cid).toBe(111);
  });

  it('62002 稿件不可见 → 永久不可播，不可被当成空数组吞掉', async () => {
    stubFetchJson({ code: 62002, message: '稿件不可见' });
    await expect(getVideoPages('BVcode62002')).rejects.toMatchObject({
      name: 'VideoUnavailableError',
      permanent: true,
      biliCode: 62002,
    });
  });

  it('-404 稿件不存在 → 永久不可播', async () => {
    stubFetchJson({ code: -404, message: '啥都木有' });
    await expect(getVideoPages('BVcode404')).rejects.toMatchObject({
      name: 'VideoUnavailableError',
      permanent: true,
    });
  });

  it('62012 需特殊权限（付费/充电）→ 永久不可播', async () => {
    stubFetchJson({ code: 62012, message: '62012' });
    await expect(getVideoPages('BVcode62012')).rejects.toMatchObject({
      name: 'VideoUnavailableError',
      permanent: true,
    });
  });

  it('其他错误码（如风控 -412）→ 普通错误，不能误判为永久不可播', async () => {
    stubFetchJson({ code: -412, message: '请求被拦截' });
    let caught = null;
    try { await getVideoPages('BVcode412xx'); } catch (e) { caught = e; }
    expect(caught).toBeTruthy();
    expect(caught.name).not.toBe('VideoUnavailableError');
    expect(caught.permanent).toBeUndefined();
  });
});

describe('checkVideoPlayable — 三态探测', () => {
  const stubFetchJson = (payload) => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => payload })));
  };
  afterEach(() => vi.unstubAllGlobals());

  it('可播放稿件 → ok', async () => {
    stubFetchJson({ code: 0, data: { pages: [{ cid: 222 }] } });
    expect(await checkVideoPlayable('BVok000001')).toBe('ok');
  });

  it('永久不可播 → unavailable', async () => {
    stubFetchJson({ code: 62002, message: '稿件不可见' });
    expect(await checkVideoPlayable('BVbad00001')).toBe('unavailable');
  });

  // 关键回归：临时失败绝不能当成可播放，否则坏源会被选成 best 写进 bvid_cache
  it('临时失败（风控限流）→ unknown，而非 ok', async () => {
    stubFetchJson({ code: -412, message: '请求被拦截' });
    expect(await checkVideoPlayable('BVtemp0001')).toBe('unknown');
  });

  it('临时失败会重试：第二次成功则返回 ok', async () => {
    let call = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      call++;
      return { json: async () => (call === 1 ? { code: -412 } : { code: 0, data: { pages: [{ cid: 9 }] } }) };
    }));
    expect(await checkVideoPlayable('BVretry001')).toBe('ok');
  });
});
