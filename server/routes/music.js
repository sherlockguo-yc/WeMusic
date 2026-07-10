import express from 'express';
import { authRequired } from '../middleware/auth.js';
import {
  searchSongs,
  findSingerMid,
  getSingerSongs,
  getSingerAlbums,
  getAlbumDetail,
  getSongAlbumBg,
  extractDisstid,
  parsePlaylist,
  deduplicateByAlbum,
} from '../services/qqmusic.js';
import { extractNeteasePlaylistId, parseNeteasePlaylist } from '../services/netease.js';

const router = express.Router();
router.use(authRequired);

// 综合搜索：返回歌曲列表 + 命中歌手（命中歌手时返回该歌手前 100 首，含 total 和 album_count 以便前端展示）
router.get('/search', async (req, res) => {
  const keyword = String(req.query.keyword || '').slice(0, 200);
  if (!keyword) return res.status(400).json({ error: '请输入搜索关键字' });
  try {
    const result = await searchSongs(keyword);
    if (result.singer?.mid) {
      try {
        const albRes = await getSingerAlbums(result.singer.mid, 1, 0);
        result.album_count = albRes.total;
      } catch { result.album_count = 0; }
    }
    res.json(result);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// 歌手详情：全部歌曲 + 专辑（支持传 mid 或 name；支持分页 begin 参数）
router.get('/artist', async (req, res) => {
  let { mid, name, begin = 0 } = req.query;
  try {
    let singerName = name || '';
    if (!mid) {
      if (!name) return res.status(400).json({ error: '请提供歌手 mid 或 name' });
      const singer = await findSingerMid(name);
      if (!singer) return res.status(404).json({ error: '未找到该歌手' });
      mid = singer.mid;
      singerName = singer.name || name;
    }
    const isFirstPage = Number(begin) === 0;
    const [songsRes, albumRes] = await Promise.all([
      getSingerSongs(mid, 100, Number(begin)),
      isFirstPage ? getSingerAlbums(mid, 80, 0) : Promise.resolve(null),
    ]);
    // 歌手页：同歌手下按歌名去重（无论专辑，保留非精选集版本）
    const songs = deduplicateByAlbum(songsRes.songs, 'name');
    res.json({
      singer: { mid, name: singerName },
      total: songsRes.total,
      songs,
      albums: albumRes?.albums || [],
      begin: Number(begin),
      hasMore: Number(begin) + 100 < songsRes.total,
    });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// 专辑详情（歌曲 + 元数据）
router.get('/album', async (req, res) => {
  const { mid } = req.query;
  if (!mid) return res.status(400).json({ error: '请提供专辑 mid' });
  try {
    const result = await getAlbumDetail(mid);
    res.json(result);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// 歌曲背景（当前播放歌曲的专辑简介 / 来源信息）
router.get('/song-background', async (req, res) => {
  const { name, singer, album_mid } = req.query;
  if (!name) return res.status(400).json({ error: '请提供歌曲名' });
  try {
    const bg = await getSongAlbumBg(name, singer, album_mid);
    res.json(bg || {});
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// 解析歌单链接（自动识别 QQ 音乐 / 网易云音乐）
router.post('/parse-playlist', async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: '请提供歌单链接' });

  // 网易云音乐
  const neId = extractNeteasePlaylistId(url);
  if (neId) {
    try {
      const result = await parseNeteasePlaylist(neId);
      res.json({ source: 'netease', playlistId: neId, ...result });
    } catch (e) {
      res.status(502).json({ error: e.message });
    }
    return;
  }

  // QQ 音乐
  const disstid = extractDisstid(url);
  if (!disstid) {
    return res.status(400).json({ error: '无法从链接中解析出歌单 ID，请检查链接格式' });
  }
  try {
    const result = await parsePlaylist(disstid);
    res.json({ source: 'qqmusic', disstid, ...result });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

export default router;
