/**
 * 网易云音乐歌词 Provider
 */

import LyricsProvider from './base.js';
import { LyricsSource, Platform, encodeSourceId } from '../../../shared/constants.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Referer: 'https://music.163.com/' };

export default class NeteaseLyricsProvider extends LyricsProvider {
  constructor() {
    super(LyricsSource.NE, '网易云音乐');
  }

  /** @override */
  async search(keyword) {
    const url = `https://music.163.com/api/search/get?s=${encodeURIComponent(keyword)}&type=1&limit=15`;
    try {
      const j = await (await fetch(url, { headers: HEADERS })).json();
      return (j?.result?.songs || []).map((s) => ({
        id: encodeSourceId(Platform.NETEASE, s.id),
        rawId: s.id,
        name: s.name,
        artist: (s.artists || []).map((a) => a.name).join(' / '),
        artists: s.artists || [],
        _raw: s,
      }));
    } catch {
      return [];
    }
  }

  /** @override */
  async fetchLyric(id) {
    const url = `https://music.163.com/api/song/lyric?id=${id}&lv=1&tv=-1`;
    try {
      const j = await (await fetch(url, { headers: HEADERS })).json();
      return {
        lrc: j?.lrc?.lyric || '',
        tlyric: j?.tlyric?.lyric || '',
      };
    } catch {
      return { lrc: '', tlyric: '' };
    }
  }

  /** @override */
  scoreCandidate(song, { name, singerFirst }) {
    const nameLow = name.toLowerCase();
    const sName = song.name || '';
    const exactName = sName.toLowerCase() === nameLow;
    const artistNames = (song.artists || []).map((a) => a.name).join(' ');
    const hasSinger = singerFirst && singerFirst.length >= 2 &&
      artistNames.toLowerCase().includes(singerFirst.toLowerCase());

    let quality = 0;
    if (hasSinger) quality += 5;
    if (exactName) quality += 3;
    if (sName.toLowerCase().includes(nameLow)) quality += 1;
    return { quality };
  }
}
