/**
 * Apple Music 服务纯函数单元测试
 */
import { describe, it, expect } from 'vitest';
import { extractApplePlaylistId, isoDurationToSec, parseApplePageHtml } from '../../server/services/apple.js';

describe('extractApplePlaylistId — 提取歌单 ID', () => {
  const ID = 'pl.324d5804f46e41fbadeba455c4227e6b';

  it('null / 空串 → null', () => {
    expect(extractApplePlaylistId(null)).toBe(null);
    expect(extractApplePlaylistId('')).toBe(null);
  });
  it('标准链接（带 slug）', () => {
    expect(extractApplePlaylistId(`https://music.apple.com/cn/playlist/%E6%BC%94%E5%87%BA%E6%9B%B2%E7%9B%AE/pl.324d5804f46e41fbadeba455c4227e6b`)).toBe(ID);
  });
  it('无 slug 链接', () => {
    expect(extractApplePlaylistId(`https://music.apple.com/cn/playlist/${ID}`)).toBe(ID);
  });
  it('带查询参数', () => {
    expect(extractApplePlaylistId(`https://music.apple.com/cn/playlist/${ID}?l=zh-Hans&at=1000l`)).toBe(ID);
  });
  it('纯 ID 直接粘贴', () => {
    expect(extractApplePlaylistId(ID)).toBe(ID);
  });
  it('geo 子域', () => {
    expect(extractApplePlaylistId(`https://geo.music.apple.com/cn/playlist/foo/${ID}`)).toBe(ID);
  });
  it('不同区域（us）', () => {
    expect(extractApplePlaylistId(`https://music.apple.com/us/playlist/top-100/${ID}`)).toBe(ID);
  });
  it('大写 hex → 归一化为小写', () => {
    expect(extractApplePlaylistId('https://music.apple.com/cn/playlist/pl.324D5804F46E41FBADEBA455C4227E6B')).toBe(ID);
  });

  // 负例：不能被误判（extractDisstid 的兜底正则会吞出 7712481，Apple 判定必须先行且严格）
  it('非苹果域名的 pl. 链接 → null', () => {
    expect(extractApplePlaylistId(`https://example.com/pl.324d5804f46e41fbadeba455c4227e6b`)).toBe(null);
  });
  it('QQ 音乐链接 → null', () => {
    expect(extractApplePlaylistId('https://y.qq.com/n/ryqq/playlist/7219231818')).toBe(null);
  });
  it('网易云链接 → null', () => {
    expect(extractApplePlaylistId('https://music.163.com/playlist?id=123456789')).toBe(null);
  });
  it('Apple 专辑链接（无 pl.）→ null', () => {
    expect(extractApplePlaylistId('https://music.apple.com/cn/album/%E5%A4%AA%E9%98%B3%E4%B9%8B%E5%AD%90/6771326786')).toBe(null);
  });
  it('真实 A-List 链接提取正确（防止被数字兜底正则吞成 7712481）', () => {
    expect(extractApplePlaylistId('https://music.apple.com/cn/playlist/a-list/pl.beb783da7712481fbeed35be144bd48c'))
      .toBe('pl.beb783da7712481fbeed35be144bd48c');
  });
});

describe('isoDurationToSec — ISO 8601 时长解析', () => {
  it('PT4M30S → 270', () => expect(isoDurationToSec('PT4M30S')).toBe(270));
  it('PT3M23S → 203', () => expect(isoDurationToSec('PT3M23S')).toBe(203));
  it('PT45S → 45', () => expect(isoDurationToSec('PT45S')).toBe(45));
  it('PT1H2M3S → 3723', () => expect(isoDurationToSec('PT1H2M3S')).toBe(3723));
  it('PT1H → 3600', () => expect(isoDurationToSec('PT1H')).toBe(3600));
  it('空 / null / 非法格式 → 0', () => {
    expect(isoDurationToSec('')).toBe(0);
    expect(isoDurationToSec(null)).toBe(0);
    expect(isoDurationToSec('P1DT2H')).toBe(0);
  });
});

// ---- parseApplePageHtml fixture 构造 ----

const trackItem = (id, title, artistName, album, durationMs) => ({
  contentDescriptor: { kind: 'song', identifiers: { storeAdamID: id } },
  title,
  artistName,
  duration: durationMs,
  layoutStyle: { kind: 'playlistTrackList' },
  tertiaryLinks: [{ title: album, segue: { destination: { contentDescriptor: { kind: 'album' } } } }],
});

const ssrHtml = (sections, body = '') => `<html><head><title>\u200e测试后缀清理 - 歌单 - Apple Music</title></head><body>
<script id="serialized-server-data">${JSON.stringify({ data: [{ data: { sections } }] })}</script>
${body}</body></html>`;

const ldScript = (obj) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;

describe('parseApplePageHtml — SSR 主路径', () => {
  const sections = [
    { itemKind: 'containerDetailHeaderLockup', items: [{ title: '演出曲目单：测试巡演' }] },
    { itemKind: 'trackLockup', items: [trackItem('1491477495', '摩天动物园', '邓紫棋', '摩天动物园', 270677)] },
    { itemKind: 'containerDetailTracklistFooterLockup', items: [{ contentDescriptor: { kind: 'playlist' } }] },
  ];

  it('解析歌曲字段（song_mid / 歌手 / 专辑 / 时长取整 / source）', () => {
    const r = parseApplePageHtml(ssrHtml(sections));
    expect(r.degraded).toBe(false);
    expect(r.total).toBe(1);
    expect(r.songs[0]).toMatchObject({
      song_mid: 'am_1491477495',
      song_id: '1491477495',
      name: '摩天动物园',
      singer: '邓紫棋',
      album: '摩天动物园',
      duration: 270,
      source: 'apple',
    });
  });

  it('歌单名取 header 标题（而非 <title>）', () => {
    expect(parseApplePageHtml(ssrHtml(sections)).name).toBe('演出曲目单：测试巡演');
  });

  it('推荐位含 song 项时，优先 trackLockup 不混入', () => {
    const withReco = [
      ...sections,
      { itemKind: 'bubbleLockup', items: [trackItem('999', '推荐曲目', '某人', '某专辑', 100000)] },
    ];
    const r = parseApplePageHtml(ssrHtml(withReco));
    expect(r.songs.map((s) => s.name)).toEqual(['摩天动物园']);
  });

  it('无 trackLockup 时全局兜底过滤歌曲', () => {
    const noAnchor = [
      { itemKind: 'containerDetailHeaderLockup', items: [{ title: '测试' }] },
      { itemKind: 'unknownKind', items: [trackItem('111', '兜底歌曲', '歌手A', '专辑A', 60000)] },
    ];
    const r = parseApplePageHtml(ssrHtml(noAnchor));
    expect(r.songs.map((s) => s.name)).toEqual(['兜底歌曲']);
  });

  it('空歌单（有 sections 但无曲目）→ songs: [] 而非 null', () => {
    const empty = [{ itemKind: 'containerDetailHeaderLockup', items: [{ title: '空歌单' }] }];
    const r = parseApplePageHtml(ssrHtml(empty));
    expect(r).not.toBeNull();
    expect(r.songs).toEqual([]);
    expect(r.name).toBe('空歌单');
  });

  it('header 无 title 时歌单名回退 JSON-LD', () => {
    const ld = { '@type': 'MusicPlaylist', name: 'JSON-LD 名', track: [] };
    const noHeaderTitle = [{ itemKind: 'containerDetailHeaderLockup', items: [{}] }];
    const r = parseApplePageHtml(ssrHtml(noHeaderTitle, ldScript(ld)));
    expect(r.name).toBe('JSON-LD 名');
  });

  it('歌手缺失时回退 subtitleLinks', () => {
    const item = trackItem('222', '无名歌手歌', undefined, '专辑B', 90000);
    item.subtitleLinks = [{ title: '替补歌手' }];
    const r = parseApplePageHtml(ssrHtml([
      { itemKind: 'containerDetailHeaderLockup', items: [{ title: 't' }] },
      { itemKind: 'trackLockup', items: [item] },
    ]));
    expect(r.songs[0].singer).toBe('替补歌手');
  });
});

describe('parseApplePageHtml — JSON-LD 降级路径', () => {
  const ld = {
    '@type': 'MusicPlaylist',
    name: '降级歌单',
    track: [
      { '@type': 'MusicRecording', name: '歌曲A', url: 'https://music.apple.com/cn/song/a/1491477495', duration: 'PT4M30S' },
      { '@type': 'MusicRecording', name: '歌曲B', url: 'https://music.apple.com/cn/song/b/1491477502', duration: 'PT3M23S' },
    ],
  };

  it('无 SSR 时降级解析（degraded=true，无歌手）', () => {
    const r = parseApplePageHtml(`<html><body>${ldScript(ld)}</body></html>`);
    expect(r.degraded).toBe(true);
    expect(r.name).toBe('降级歌单');
    expect(r.total).toBe(2);
    expect(r.songs[0]).toMatchObject({ song_mid: 'am_1491477495', name: '歌曲A', singer: '', duration: 270 });
  });

  it('跳过非 MusicPlaylist 的 ld+json 块', () => {
    const other = { '@type': 'WebPage', name: 'x' };
    const r = parseApplePageHtml(`<html><body>${ldScript(other)}${ldScript(ld)}</body></html>`);
    expect(r.name).toBe('降级歌单');
  });

  it('降级且无 name 时回退 <title>（清理 U+200E 与后缀）', () => {
    const noName = { ...ld, name: undefined };
    const r = parseApplePageHtml(`<html><head><title>\u200e标题回退 - 歌单 - Apple Music</title></head><body>${ldScript(noName)}</body></html>`);
    expect(r.name).toBe('标题回退');
  });

  it('SSR 与 JSON-LD 均无 → null（页面结构变更场景）', () => {
    expect(parseApplePageHtml('<html><body>nothing</body></html>')).toBe(null);
  });

  it('SSR 解析出非法 JSON → 回退 JSON-LD', () => {
    const html = `<html><body><script id="serialized-server-data">{invalid json</script>${ldScript(ld)}</body></html>`;
    const r = parseApplePageHtml(html);
    expect(r.degraded).toBe(true);
    expect(r.total).toBe(2);
  });
});
