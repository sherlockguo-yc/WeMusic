/**
 * 网易云音乐数据服务
 * 使用网易云音乐公开 Web 接口，仅供本地个人学习使用。
 *   - /api/playlist/detail           歌单详情（含歌曲列表）
 * 若官方调整接口，集中在此模块维护即可。
 */

import { Platform } from '../../shared/constants.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Referer: 'https://music.163.com/' };

/**
 * 从网易云歌单链接中提取歌单 ID
 * 支持格式：
 *   - https://music.163.com/playlist?id=123456789
 *   - https://music.163.com/#/playlist?id=123456789
 *   - https://music.163.com/playlist/123456789
 *   - 纯数字 ID
 */
export function extractNeteasePlaylistId(input) {
  if (!input) return null;
  const str = String(input).trim();
  if (/^\d{4,}$/.test(str)) return str;
  let m = str.match(/playlist[/?].*[?&]id=(\d+)/);
  if (m) return m[1];
  m = str.match(/playlist\/(\d+)/);
  if (m) return m[1];
  m = str.match(/[?&]id=(\d+)/);
  if (m) return m[1];
  m = str.match(/(\d{6,})/);
  return m ? m[1] : null;
}

/**
 * 将网易云歌曲对象归一化为与 QQ 音乐相同的格式
 */
function normalizeNeteaseSong(track) {
  const artists = (track.ar || track.artists || []).map((a) => a.name || '').filter(Boolean);
  const album = track.al || track.album || {};
  const albumName = album.name || '';
  const albumId = album.id ? String(album.id) : '';
  const id = track.id;
  return {
    song_mid: `ne_${id}`,
    song_id: id,
    name: track.name || '',
    singer: artists.join(' / '),
    singer_mid: '',
    album: albumName,
    album_mid: albumId,
    duration: Math.round((track.dt || track.duration || 0) / 1000), // ms → 秒
    hires: false,
    lossless: false,
    source: Platform.NETEASE,
  };
}

/**
 * 解析网易云歌单
 * @param {string} playlistId - 歌单 ID
 * @returns {{ name: string, total: number, songs: Array }}
 */
export async function parseNeteasePlaylist(playlistId) {
  const url = `https://music.163.com/api/playlist/detail?id=${playlistId}`;
  const res = await fetch(url, { headers: HEADERS });
  const json = await res.json();
  if (json.code !== 200) {
    throw new Error(`网易云接口错误：${json.message || json.msg || `code=${json.code}`}`);
  }
  const result = json.result || {};
  const tracks = result.tracks || [];
  return {
    name: result.name || `歌单 ${playlistId}`,
    total: result.trackCount || tracks.length,
    songs: tracks.map(normalizeNeteaseSong),
  };
}
