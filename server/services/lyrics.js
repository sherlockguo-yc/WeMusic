/**
 * 歌词服务：从网易云音乐搜索并拉取 LRC 格式歌词
 * 搜索时拼接歌名+歌手提高精准度
 */

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const H  = { 'User-Agent': UA, Referer: 'https://music.163.com/' };

/** 解析 LRC 格式为 [{time, text}] 数组，time 单位：秒
 *  若无时间戳（纯文本歌词），每行 time 设为 -1（不参与自动滚动） */
export function parseLrc(lrc = '') {
  const lines = lrc.split('\n');
  const result = [];
  const timeRe = /\[(\d+):(\d+\.?\d*)\]/g;
  let hasTimestamp = false;
  for (const line of lines) {
    const text = line.replace(/\[.*?\]/g, '').trim();
    if (!text) continue;
    let m;
    timeRe.lastIndex = 0;
    let matched = false;
    while ((m = timeRe.exec(line)) !== null) {
      const time = Number(m[1]) * 60 + Number(m[2]);
      result.push({ time, text });
      matched = true;
      hasTimestamp = true;
    }
    if (!matched) result.push({ time: -1, text });
  }
  if (hasTimestamp) return result.sort((a, b) => a.time - b.time);
  return result; // 纯文本，保持原顺序
}

/** 搜索并返回歌词（已解析的 LRC 数组 + 原始字符串） */
export async function fetchLyrics(name, singer = '') {
  const keyword = singer ? `${name} ${singer.split('/')[0].trim()}` : name;
  // 1. 搜索
  const sUrl = `https://music.163.com/api/search/get?s=${encodeURIComponent(keyword)}&type=1&limit=10`;
  let songs;
  try {
    const sj = await (await fetch(sUrl, { headers: H })).json();
    songs = sj?.result?.songs || [];
  } catch {
    throw new Error('搜索歌词失败');
  }
  // 若带歌手搜索无结果，回退到纯歌名搜索
  if (!songs.length && singer) {
    try {
      const sj2 = await (await fetch(
        `https://music.163.com/api/search/get?s=${encodeURIComponent(name)}&type=1&limit=10`,
        { headers: H }
      )).json();
      songs = sj2?.result?.songs || [];
    } catch { /* ignore */ }
  }
  if (!songs.length) throw new Error('未找到匹配歌词');

  // 2. 优先匹配：歌名完全相同 + 歌手名包含目标歌手
  const singerFirst = singer.split(/[\/、,&]/)[0].trim().toLowerCase();
  let best = songs.find((s) => {
    const nameMatch = s.name === name || s.name.toLowerCase() === name.toLowerCase();
    const artistMatch = !singerFirst || (s.artists || []).some(
      (a) => a.name.toLowerCase().includes(singerFirst)
    );
    return nameMatch && artistMatch;
  }) || songs.find((s) => s.name.toLowerCase() === name.toLowerCase()) || songs[0];

  // 3. 拉取歌词
  const lUrl = `https://music.163.com/api/song/lyric?id=${best.id}&lv=1&tv=-1`;
  let lj;
  try {
    lj = await (await fetch(lUrl, { headers: H })).json();
  } catch {
    throw new Error('获取歌词内容失败');
  }
  const raw = lj?.lrc?.lyric || '';
  if (!raw.trim()) throw new Error('该歌曲暂无歌词');

  return {
    song:   best.name,
    artist: (best.artists || []).map((a) => a.name).join(' / '),
    raw,
    lines: parseLrc(raw),
  };
}
