/**
 * QQ 音乐数据服务
 * 使用 QQ 音乐公开 Web 接口，仅供本地个人学习使用。
 * 已选用当前可用的端点：
 *   - smartbox_new.fcg                         关键字搜索（歌手/歌曲联想）
 *   - musicu CgiGetTrackInfo                    批量歌曲详情（补全专辑/时长）
 *   - musicu GetSingerSongList                  歌手全部歌曲
 *   - fcg_v8_singer_album.fcg                   歌手专辑列表
 *   - musicu GetAlbumSongList                   专辑内歌曲
 *   - musicu uniform_get_Dissinfo              歌单解析
 * 若官方调整接口，集中在此模块维护即可。
 */

const COMMON_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Referer: 'https://y.qq.com/',
};

const MUSICU = 'https://u.y.qq.com/cgi-bin/musicu.fcg';

async function getJSON(url, options = {}) {
  const res = await fetch(url, {
    headers: { ...COMMON_HEADERS, ...(options.headers || {}) },
    method: options.method || 'GET',
    body: options.body,
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    // JSONP/非标准 JSON：去掉回调包裹再试一次
    const cleaned = text
      .replace(/^[^({]*\(/, (m) => (m.endsWith('(') && m.length > 1 ? '' : m))
      .replace(/\);?\s*$/, '');
    try {
      return JSON.parse(cleaned);
    } catch {
      throw new Error('QQ音乐接口返回解析失败');
    }
  }
}

/** 调用 musicu 统一接口 */
async function musicu(module, method, param) {
  const data = { comm: { ct: 24, cv: 0 }, req: { module, method, param } };
  const url = `${MUSICU}?format=json&data=${encodeURIComponent(JSON.stringify(data))}`;
  const json = await getJSON(url);
  return json?.req?.data || {};
}

/** 将各种来源的原始歌曲对象归一化 */
function normalizeSong(raw = {}) {
  const singerArr = raw.singer || raw.singers || [];
  const singerNames = Array.isArray(singerArr)
    ? singerArr.map((s) => s.name || s.title).filter(Boolean).join(' / ')
    : typeof singerArr === 'string'
    ? singerArr
    : '';
  const singerMid =
    Array.isArray(singerArr) && singerArr[0] ? singerArr[0].mid || '' : '';
  const album = raw.album || {};
  const albumName =
    (album && typeof album === 'object' ? album.name || album.albumname : album) ||
    raw.albumname ||
    '';
  const albumMid =
    (album && typeof album === 'object' ? album.mid || album.albummid : '') ||
    raw.albummid ||
    '';
  const file = raw.file || {};
  const hires = Number(file.size_hires || file.hires || 0) > 0;
  const lossless = Number(file.size_flac || file.flac || 0) > 0;
  return {
    song_mid: raw.mid || raw.songmid || raw.songMID || '',
    song_id: raw.id || raw.songid || 0,
    name: raw.name || raw.songname || raw.title || '',
    singer: singerNames,
    singer_mid: singerMid,
    album: albumName,
    album_mid: albumMid,
    duration: raw.interval || raw.duration || 0,
    hires,
    lossless,
    source: 'qqmusic',
  };
}

// 低质量 / 非原唱版本关键词（排到后面）
const DEMOTE_KW = [
  '纯音乐', '伴奏', '演奏版', '演奏', '旋律', 'remix', 'dj', '钢琴版', '钢琴',
  '八音盒', 'live', '现场', '翻自', 'cover', '和声', '吉他', '口琴', '纯享',
  'instrumental', 'karaoke', '清唱', '童声', '慢摇',
];

/** 综合音质排序：高音质优先，纯音乐/伴奏/现场等靠后（稳定排序保留原相关度顺序） */
function rankByQuality(songs) {
  const score = (s) => {
    let sc = 0;
    if (s.hires) sc += 4;
    else if (s.lossless) sc += 2;
    const t = `${s.name} ${s.album}`.toLowerCase();
    if (DEMOTE_KW.some((k) => t.includes(k.toLowerCase()))) sc -= 10;
    return sc;
  };
  return songs
    .map((s, i) => ({ s, i, sc: score(s) }))
    .sort((a, b) => (b.sc - a.sc) || (a.i - b.i))
    .map((x) => x.s);
}

/** 批量获取歌曲详情（补全专辑/时长） */
async function getTrackInfoByIds(ids = []) {
  const numIds = ids.map((x) => Number(x)).filter((x) => x > 0);
  if (numIds.length === 0) return {};
  const data = await musicu('music.trackInfo.UniformRuleCtrl', 'CgiGetTrackInfo', {
    ids: numIds,
    types: numIds.map(() => 0),
  });
  const map = {};
  for (const t of data.tracks || []) {
    map[t.id] = normalizeSong(t);
  }
  return map;
}

/** smartbox 联想搜索（命中歌手 + 少量歌曲，作为兜底） */
async function smartbox(keyword) {
  const url =
    'https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg?format=json&utf8=1&key=' +
    encodeURIComponent(keyword);
  const json = await getJSON(url);
  const d = json?.data || {};
  const songItems = d.song?.itemlist || [];
  const singerItems = d.singer?.itemlist || [];

  let detailMap = {};
  try {
    detailMap = await getTrackInfoByIds(songItems.map((s) => s.id));
  } catch {
    /* 补全失败则使用基础信息 */
  }
  const songs = songItems.map((s) => {
    const detail = detailMap[s.id];
    if (detail && detail.name) return { ...detail, song_mid: detail.song_mid || s.mid };
    return normalizeSong({ mid: s.mid, id: s.id, name: s.name, singer: s.singer });
  });
  const singer = singerItems[0]
    ? { mid: singerItems[0].mid, name: singerItems[0].name }
    : null;
  return { songs, singer };
}

// 精选集 / 合辑 / 节目版关键词——同名歌曲中优先过滤这类版本
const COMPILATION_KW = [
  // 精选集 / 合辑
  '精选', '精选集', 'best of', 'greatest hits', 'collection', 'anthology',
  '合辑', '金曲', '全集', '全纪录', '音乐全集', 'i am gloria', 'the best',
  // 节目版
  '我是歌手', '歌手', '中国新说唱', '说唱', '好声音', '超级女声', '快乐男声',
  '明日之子', '创造营', '青春有你', '浪姐', '披荆斩棘', '乘风破浪',
  '王牌对王牌', '王牌', '综艺', '节目', '晚会', '春晚', '演唱会录音',
  '第1期', '第2期', '第3期', '第4期', '第5期', '第6期', '第7期', '第8期',
  '第9期', '第10期', '第11期', '第12期', '半决赛', '总决赛',
];

/**
 * 歌曲去重。
 * mode='name'（歌手页默认）：同歌手下按歌名去重，精选集/节目版版本靠后则被覆盖掉，
 *   保留第一个非精选集版本，若全是精选集则保留第一个。
 * mode='name+singer'（搜索页）：按歌名+歌手去重，保留非精选集版本。
 */
function deduplicateByAlbum(songs, mode = 'name+singer') {
  const isCompilation = (s) => {
    const a = (s.album || '').toLowerCase();
    return COMPILATION_KW.some((kw) => a.includes(kw));
  };
  const key = (s) => mode === 'name' ? s.name : `${s.name}__${s.singer}`;

  const groups = new Map();
  const order = [];
  for (const s of songs) {
    const k = key(s);
    if (!groups.has(k)) { groups.set(k, []); order.push(k); }
    groups.get(k).push(s);
  }
  const result = [];
  for (const k of order) {
    const group = groups.get(k);
    if (group.length === 1) { result.push(group[0]); continue; }
    const nonComp = group.filter((s) => !isCompilation(s));
    result.push(nonComp.length > 0 ? nonComp[0] : group[0]);
  }
  return result;
}

/** 完整搜索（仅用于识别歌手，不再作为主要歌曲来源） */
async function fullSearch(keyword, num = 50) {
  const data = await musicu('music.search.SearchCgiService', 'DoSearchForQQMusicDesktop', {
    num_per_page: num,
    page_num: 1,
    query: keyword,
    search_type: 0,
  });
  const list = data?.body?.song?.list || [];
  const sList = data?.body?.singer?.list || [];
  const singer = sList[0]
    ? { mid: sList[0].singerMID || sList[0].mid || '', name: sList[0].singerName || sList[0].name || '' }
    : null;
  return { songs: list.map(normalizeSong), singer };
}

/**
 * 关键字搜索：返回歌曲列表 + 命中歌手
 * 策略：
 *   1. 同时跑 fullSearch + smartbox，优先从中识别命中歌手
 *   2. 命中歌手 → 直接用 GetSingerSongList 返回该歌手完整歌曲（第一批 100 首）
 *      这样不会丢歌，且数量准确；前端可继续"加载更多"
 *   3. 未命中歌手 → 用 fullSearch 结果（歌曲关键字搜索）
 *   4. 兜底退化到 smartbox 联想结果
 *   最终对结果做精选集去重 + 音质排序
 */
export async function searchSongs(keyword) {
  const [full, sb] = await Promise.all([
    fullSearch(keyword).catch(() => ({ songs: [], singer: null })),
    smartbox(keyword).catch(() => ({ songs: [], singer: null })),
  ]);

  const singer = (full.singer?.mid ? full.singer : null) || (sb.singer?.mid ? sb.singer : null);
  let songs;

  let total;
  let hasMore;

  if (singer && singer.mid) {
    try {
      const ss = await getSingerSongs(singer.mid, 100, 0);
      songs = ss.songs;
      total = ss.total;
      hasMore = total > 100;
    } catch {
      songs = full.songs.length > 0 ? full.songs : sb.songs;
      total = songs.length; hasMore = false;
    }
  } else {
    songs = full.songs.length > 0 ? full.songs : sb.songs;
  }

  // 非歌手命中时用实际歌曲数，不支持分页
  if (total === undefined) { total = songs.length; hasMore = false; }

  // 精选集软去重 + 高音质优先
  songs = deduplicateByAlbum(songs);
  songs = rankByQuality(songs);
  return { songs, singer, total, hasMore };
}

/** 导出 deduplicateByAlbum 供歌手页使用 */
export { deduplicateByAlbum };

/**
 * 根据歌手名查找歌手 mid
 */
export async function findSingerMid(name) {
  const { singer } = await searchSongs(name);
  return singer && singer.mid ? singer : null;
}

/**
 * 获取歌手全部歌曲（支持分页）
 */
export async function getSingerSongs(singerMid, num = 100, begin = 0) {
  const data = await musicu('musichall.song_list_server', 'GetSingerSongList', {
    singerMid,
    order: 1,
    begin,
    num,
  });
  const songList = data.songList || [];
  return {
    total: data.totalNum || songList.length,
    songs: songList.map((it) => normalizeSong(it.songInfo || it)),
  };
}

/**
 * 分批拉取歌手所有歌曲（最多拉取 maxSongs 首，跨多页）
 */
export async function getSingerAllSongs(singerMid, maxSongs = 500) {
  const BATCH = 100;
  let begin = 0;
  let total = Infinity;
  const all = [];
  while (begin < total && all.length < maxSongs) {
    const res = await getSingerSongs(singerMid, BATCH, begin);
    if (res.total) total = Math.min(res.total, maxSongs);
    if (res.songs.length === 0) break;
    all.push(...res.songs);
    begin += BATCH;
  }
  return { total, songs: all };
}

/**
 * 获取歌手专辑列表
 * 返回 { albums: Array, total: number }
 */
export async function getSingerAlbums(singerMid, num = 80, begin = 0) {
  const url =
    'https://c.y.qq.com/v8/fcg-bin/fcg_v8_singer_album.fcg?' +
    new URLSearchParams({
      singermid: singerMid,
      order: 'time',
      begin: String(begin),
      num: String(num),
      exclude_japan: '0',
      format: 'json',
      platform: 'yqq',
      needNewCode: '0',
    }).toString();
  const json = await getJSON(url);
  const list = json?.data?.list || [];
  const total = json?.data?.total ?? list.length;
  return {
    albums: list.map((a) => ({
      album_mid: a.albumMID || a.album_mid || a.mid || a.Fmid || '',
      name: a.albumName || a.album_name || a.albumname || '',
      pub_time: a.pubTime || a.pub_time || '',
      singer: a.singerName || a.singer_name || '',
    })),
    total,
  };
}

/**
 * 搜索专辑（t=8 为专辑搜索）
 */
export async function searchAlbums(keyword) {
  const url = `https://c.y.qq.com/soso/fcgi-bin/client_search_cp.fcg?format=json&w=${encodeURIComponent(keyword)}&t=8&n=6`;
  const json = await getJSON(url);
  const list = json?.data?.album?.list || [];
  return list.map((a) => ({
    mid:      a.albumMID || a.album_mid || '',
    name:     a.albumName || a.album_name || a.name || '',
    singer:   a.singerName || a.singer_name || '',
    songCount: a.song_count || 0,
    pubDate:  a.publicTime || '',
  }));
}

/**
 * 获取专辑内全部歌曲 + 完整元数据（简介、公司、风格等）
 */
export async function getAlbumDetail(albumMid) {
  const url =
    'https://c.y.qq.com/v8/fcg-bin/fcg_v8_album_info_cp.fcg?' +
    new URLSearchParams({
      albummid: albumMid,
      newsong: '1',
      format: 'json',
      platform: 'yqq',
      needNewCode: '0',
    }).toString();
  const json = await getJSON(url);
  const data = json?.data || {};
  const list = data.list || [];
  const albumName = data.name || '';
  return {
    name: albumName,
    desc: data.desc || '',
    company: data.company || '',
    company_new: data.company_new || '',
    genre: data.genre || '',
    lan: data.lan || '',
    aDate: data.aDate || '',
    cur_song_num: data.cur_song_num || list.length,
    songs: list.map((s) => normalizeSong({ ...s, albumname: s.albumname || albumName })),
  };
}

/**
 * 通过歌曲的 album_mid 获取专辑简介（用于播放时展示歌曲背景）
 * 如果歌曲没有 album_mid，尝试用歌名+歌手搜索匹配
 */
export async function getSongAlbumBg(songName, singer, albumMid) {
  if (albumMid) {
    try {
      const detail = await getAlbumDetail(albumMid);
      return { source: 'album', album_name: detail.name, desc: detail.desc, company: detail.company, genre: detail.genre, lan: detail.lan, aDate: detail.aDate };
    } catch {}
  }
  // 没有 album_mid 或获取失败：返回空
  return null;
}

/**
 * 从歌单链接中提取 disstid
 */
export function extractDisstid(input) {
  if (!input) return null;
  const str = String(input).trim();
  if (/^\d{4,}$/.test(str)) return str;
  let m = str.match(/playlist\/(\d+)/);
  if (m) return m[1];
  m = str.match(/[?&]id=(\d+)/);
  if (m) return m[1];
  m = str.match(/disstid=(\d+)/);
  if (m) return m[1];
  m = str.match(/(\d{6,})/);
  return m ? m[1] : null;
}

/**
 * 解析歌单
 */
export async function parsePlaylist(disstid) {
  const data = await musicu('music.srfDissInfo.aiDissInfo', 'uniform_get_Dissinfo', {
    disstid: Number(disstid),
    onlysong: 0,
    song_begin: 0,
    song_num: 1000,
    enc_host_uin: '',
    tag: 1,
    userinfo: 1,
    orderlist: 1,
  });
  const songlist = data.songlist || [];
  return {
    name: data.dirinfo?.title || `歌单 ${disstid}`,
    total: data.total_song_num || songlist.length,
    songs: songlist.map(normalizeSong),
  };
}

/**
 * QQ 音乐排行榜（走 fcg_v8_toplist_cp 接口，稳定可用）
 * topId 对应：
 *   26  - 巅峰榜·热歌
 *   27  - 巅峰榜·新歌
 *   4   - 巅峰榜·流行指数
 *   67  - 听歌识曲榜
 *   62  - 热歌榜（备用）
 */
export async function getTopList(topId = 26, num = 50) {
  const url = `https://c.y.qq.com/v8/fcg-bin/fcg_v8_toplist_cp.fcg?` +
    new URLSearchParams({ topid: String(topId), num: String(num), format: 'json', tpl: '3', page: 'detail', type: 'top' });
  const json = await getJSON(url);
  const songs = (json?.songlist || []).map((item) => normalizeSong(item.data || item));
  return songs.filter((s) => s.name);
}
