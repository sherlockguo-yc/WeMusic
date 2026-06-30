/**
 * Bilibili 数据服务
 * 实现 WBI 签名 + 视频搜索，用于为歌曲匹配可嵌入播放的视频资源。
 */
import { createHash } from 'node:crypto';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61,
  26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36,
  20, 34, 44, 52,
];

// 简单缓存
let _cookie = null;
let _cookieTime = 0;
let _wbiKeys = null;
let _wbiKeysTime = 0;
const ONE_DAY = 24 * 60 * 60 * 1000;

/** 清空鉴权缓存（遇风控时重新激活） */
function resetAuth() {
  _cookie = null;
  _cookieTime = 0;
  _wbiKeys = null;
  _wbiKeysTime = 0;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function randHex(len, upper = true) {
  let s = '';
  for (let i = 0; i < len; i++) s += Math.floor(Math.random() * 16).toString(16);
  return upper ? s.toUpperCase() : s;
}

/** 生成 _uuid（Bilibili 风控所需） */
function genUuid() {
  const seg = (l) => randHex(l);
  const t = String(Date.now() % 100000).padStart(5, '0');
  return [seg(8), seg(4), seg(4), seg(4), seg(12)].join('-') + t + 'infoc';
}

/** 生成 b_lsid */
function genBLsid() {
  return randHex(8) + '_' + Date.now().toString(16).toUpperCase();
}

/**
 * 获取并缓存 Bilibili 访客 Cookie。
 * 关键：需走 buvid 激活流程（finger/spi 取号 + ExClimbWuzhi 激活），
 * 否则搜索接口会被风控，返回仅含 v_voucher 的空结果。
 */
async function getCookie() {
  if (_cookie && Date.now() - _cookieTime < ONE_DAY) return _cookie;
  try {
    // 1. 取 buvid3 / buvid4
    const spi = await fetch('https://api.bilibili.com/x/frontend/finger/spi', {
      headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/' },
    });
    const sj = await spi.json();
    const b3 = sj?.data?.b_3 || randHex(32) + 'infoc';
    const b4 = sj?.data?.b_4 || randHex(32) + 'infoc';

    const uuid = genUuid();
    const blsid = genBLsid();
    const fp = randHex(32, false);
    const bNut = Math.floor(Date.now() / 1000);
    const cookie = `buvid3=${b3}; buvid4=${b4}; _uuid=${uuid}; b_lsid=${blsid}; buvid_fp=${fp}; b_nut=${bNut}`;

    // 2. 激活 buvid（ExClimbWuzhi）
    const payload = {
      '3064': 1,
      '5062': String(Date.now()),
      '03bf': 'https://www.bilibili.com/',
      '39c8': '333.1007.fp.risk',
      '34f1': '',
      d402: '',
      '654a': '',
      '6e7c': '1920x1080',
      '3c43': {
        '2673': 0, '5766': 24, '6527': 0, '7003': 1, '807e': 1,
        b8ce: UA, '641c': 0, '07a4': 'zh-CN', '1c57': 'not available',
        '0bd0': 16, '748e': [1920, 1080], d61f: [1920, 1040],
        fc9d: -480, '6aa9': 'Asia/Shanghai', '75b8': 1, '3b21': 1,
        '8a1c': 0, d52f: 'not available', b8b0: 'webgl',
      },
    };
    await fetch('https://api.bilibili.com/x/internal/gaia-gateway/ExClimbWuzhi', {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        Referer: 'https://www.bilibili.com/',
        Origin: 'https://www.bilibili.com',
        'Content-Type': 'application/json',
        Cookie: cookie,
      },
      body: JSON.stringify({ payload: JSON.stringify(payload) }),
    }).catch(() => {});

    _cookie = cookie;
    _cookieTime = Date.now();
  } catch {
    _cookie = `buvid3=${randHex(32)}infoc`;
    _cookieTime = Date.now();
  }
  return _cookie;
}

/** 获取 WBI 签名所需的 img_key / sub_key */
async function getWbiKeys() {
  if (_wbiKeys && Date.now() - _wbiKeysTime < ONE_DAY) return _wbiKeys;
  const cookie = await getCookie();
  const res = await fetch('https://api.bilibili.com/x/web-interface/nav', {
    headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/', Cookie: cookie },
  });
  const json = await res.json();
  const imgUrl = json?.data?.wbi_img?.img_url || '';
  const subUrl = json?.data?.wbi_img?.sub_url || '';
  const imgKey = imgUrl.slice(imgUrl.lastIndexOf('/') + 1).split('.')[0];
  const subKey = subUrl.slice(subUrl.lastIndexOf('/') + 1).split('.')[0];
  _wbiKeys = { imgKey, subKey };
  _wbiKeysTime = Date.now();
  return _wbiKeys;
}

function getMixinKey(orig) {
  return MIXIN_KEY_ENC_TAB.map((n) => orig[n]).join('').slice(0, 32);
}

/** 对参数进行 WBI 签名，返回带 wts/w_rid 的查询串 */
async function encWbi(params) {
  const { imgKey, subKey } = await getWbiKeys();
  const mixinKey = getMixinKey(imgKey + subKey);
  const wts = Math.round(Date.now() / 1000);
  const query = { ...params, wts };
  const search = Object.keys(query)
    .sort()
    .map((k) => {
      const v = String(query[k]).replace(/[!'()*]/g, '');
      return `${encodeURIComponent(k)}=${encodeURIComponent(v)}`;
    })
    .join('&');
  const wRid = createHash('md5').update(search + mixinKey).digest('hex');
  return `${search}&w_rid=${wRid}`;
}

function stripHtml(str = '') {
  return str.replace(/<[^>]+>/g, '');
}

/** "4:13" / "1:02:33" -> 秒 */
function durationToSeconds(str = '') {
  if (typeof str === 'number') return str;
  const parts = String(str).split(':').map((n) => parseInt(n, 10) || 0);
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

/**
 * 搜索 Bilibili 视频
 * @returns 归一化的视频数组
 */
export async function searchVideos(keyword, page = 1, pageSize = 20) {
  let lastErr;
  // 搜索接口偶发风控：code!=0 或 data 仅含 v_voucher（无 result）时刷新鉴权重试
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const cookie = await getCookie();
      const signed = await encWbi({
        search_type: 'video',
        keyword,
        page,
        page_size: pageSize,
        order: 'totalrank',
      });
      const url = `https://api.bilibili.com/x/web-interface/wbi/search/type?${signed}`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': UA,
          Referer: 'https://www.bilibili.com/',
          Cookie: cookie,
        },
      });
      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error('RISK_CONTROL'); // 返回了 HTML 风控页
      }
      if (json.code !== 0) {
        throw new Error(`code ${json.code} ${json.message || ''}`);
      }
      const result = json?.data?.result;
      // 命中风控：data 只有 v_voucher、没有 result
      if (!Array.isArray(result)) {
        if (json?.data?.v_voucher) throw new Error('RISK_CONTROL');
        return []; // 确实无结果
      }
      return result
        .filter((v) => v.bvid)
        .map((v) => ({
          bvid: v.bvid,
          aid: v.aid,
          title: stripHtml(v.title || ''),
          author: v.author || '',
          mid: v.mid,
          duration: durationToSeconds(v.duration),
          play: v.play || 0,
          danmaku: v.video_review || 0,
          pic: v.pic ? (v.pic.startsWith('http') ? v.pic : `https:${v.pic}`) : '',
          arcurl: v.arcurl || `https://www.bilibili.com/video/${v.bvid}`,
          pubdate: v.pubdate || 0,
        }));
    } catch (e) {
      lastErr = e;
      resetAuth(); // 刷新 buvid 与 wbi 密钥后重试
      await sleep(400);
    }
  }
  throw new Error('Bilibili 搜索失败（风控）：' + (lastErr && lastErr.message));
}

/** 获取视频分 P 信息（用于取 cid） */
export async function getVideoPages(bvid) {
  const res = await fetch(
    `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`,
    { headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/' } }
  );
  const json = await res.json();
  return json?.data?.pages || [];
}

/**
 * 通过 WBI 签名接口获取 DASH 纯音频流（高音质、体积小，但对游客易被 412 风控）。
 */
async function getDashAudio(bvid, cid) {
  const cookie = await getCookie();
  const signed = await encWbi({ bvid, cid, fnval: 16, fnver: 0, fourk: 1 });
  const url = `https://api.bilibili.com/x/player/wbi/playurl?${signed}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Cookie: cookie, Referer: `https://www.bilibili.com/video/${bvid}` },
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error('RISK_CONTROL'); }
  if (json.code !== 0) throw new Error(`playurl code ${json.code} ${json.message || ''}`);
  const audios = json?.data?.dash?.audio || [];
  if (!audios.length) throw new Error('NO_DASH_AUDIO');
  const best = [...audios].sort((a, b) => b.bandwidth - a.bandwidth)[0];
  return {
    cid,
    url: best.baseUrl || best.base_url,
    backup: best.backupUrl || best.backup_url || [],
    bandwidth: best.bandwidth,
    mime: best.mimeType || best.mime_type || 'audio/mp4',
  };
}

/**
 * 通过 H5 老接口获取 durl 流（音视频合一 mp4，<audio> 可直接播放）。
 * platform=html5 风控宽松、无需 cookie，作为 DASH 被风控时的可靠兜底。
 */
async function getHtml5Durl(bvid, cid) {
  const url = `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&fnval=16&fnver=0&fourk=1&platform=html5&high_quality=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Referer: `https://www.bilibili.com/video/${bvid}` },
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error('RISK_CONTROL'); }
  if (json.code !== 0) throw new Error(`playurl(html5) code ${json.code} ${json.message || ''}`);
  const durl = json?.data?.durl || [];
  if (!durl.length || !durl[0].url) throw new Error('NO_DURL');
  return {
    cid,
    url: durl[0].url,
    backup: durl[0].backup_url || durl[0].backupUrl || [],
    bandwidth: 0,
    mime: 'video/mp4', // durl 为音视频合一的 mp4，<audio> 能播其中音轨
  };
}

/**
 * 获取视频最佳音频流地址。
 * 优先 DASH 纯音频；被风控（412/RISK_CONTROL）时回退 H5 durl。
 * 返回 { cid, url, backup, bandwidth, mime }，url 需经后端代理（带 Referer）后才能播放。
 */
export async function getAudioStream(bvid, cid) {
  if (!cid) {
    const pages = await getVideoPages(bvid);
    cid = pages[0]?.cid;
  }
  if (!cid) throw new Error('未获取到视频 cid');

  // 1) 优先 DASH（纯音频高音质），失败重试一次刷新鉴权
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await getDashAudio(bvid, cid);
    } catch (e) {
      if (e.message === 'NO_DASH_AUDIO') break; // 无 dash 音频，直接走 html5
      resetAuth();
      await sleep(300);
    }
  }

  // 2) 回退 H5 durl（platform=html5，风控宽松）
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await getHtml5Durl(bvid, cid);
    } catch (e) {
      lastErr = e;
      await sleep(300);
    }
  }
  throw new Error('获取音频流失败（可能被风控）：' + (lastErr && lastErr.message));
}

/**
 * 代理音频流：带 Referer 从 B 站拉取并透传给客户端（支持 Range）。
 * @returns 上游 fetch 的 Response
 */
export async function fetchAudio(streamUrl, bvid, range) {
  const headers = {
    'User-Agent': UA,
    Referer: `https://www.bilibili.com/video/${bvid || ''}`,
    Accept: '*/*',
  };
  if (range) headers.Range = range;
  return fetch(streamUrl, { headers });
}
