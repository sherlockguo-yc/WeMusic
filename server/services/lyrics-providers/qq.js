/**
 * QQ 音乐歌词 Provider
 */

import LyricsProvider from './base.js';
import { LyricsSource, Platform, encodeSourceId } from '../../../shared/constants.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Referer: 'https://y.qq.com/portal/player.html' };

export default class QQLyricsProvider extends LyricsProvider {
  constructor() {
    super(LyricsSource.QQ, 'QQ音乐');
  }

  /** @override */
  async search(keyword) {
    const url = `https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg?key=${encodeURIComponent(keyword)}&format=json`;
    try {
      const j = await (await fetch(url, { headers: HEADERS })).json();
      return (j?.data?.song?.itemlist || []).map((s) => ({
        id: encodeSourceId(Platform.QQ_MUSIC, s.mid),
        rawId: s.mid,
        name: s.name,
        artist: s.singer || '',
        _raw: s,
      }));
    } catch {
      return [];
    }
  }

  /** @override */
  async fetchLyric(mid) {
    const url = `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${encodeURIComponent(mid)}&format=json`;
    try {
      const text = await (await fetch(url, { headers: HEADERS })).text();
      const m = text.match(/\{.*\}/s);
      if (!m) return '';
      const d = JSON.parse(m[0]);
      const b64 = d?.lyric || d?.Lyric || '';
      if (!b64) return '';
      return Buffer.from(b64, 'base64').toString('utf-8');
    } catch {
      return '';
    }
  }

  /** @override */
  scoreCandidate(song, { name, singerFirst }) {
    const nameLow = name.toLowerCase();
    const sName = song.name || '';
    const exactName = sName.toLowerCase() === nameLow;
    const artistNames = song.artist || '';
    const hasSinger = singerFirst && singerFirst.length >= 2 &&
      artistNames.toLowerCase().includes(singerFirst.toLowerCase());

    let quality = 0;
    if (hasSinger) quality += 5;
    if (exactName) quality += 3;
    if (sName.toLowerCase().includes(nameLow)) quality += 1;
    return { quality };
  }
}
