import express from 'express';
import { authRequired } from '../middleware/auth.js';
import {
  searchSongs,
  findSingerMid,
  getSingerSongs,
  getSingerAlbums,
  getAlbumSongs,
  extractDisstid,
  parsePlaylist,
  deduplicateByAlbum,
} from '../services/qqmusic.js';

const router = express.Router();
router.use(authRequired);

// 综合搜索：返回歌曲列表 + 命中歌手（命中歌手时返回该歌手前 100 首，含 total 以便前端判断是否还有更多）
router.get('/search', async (req, res) => {
  const { keyword } = req.query;
  if (!keyword) return res.status(400).json({ error: '请输入搜索关键字' });
  try {
    const result = await searchSongs(keyword);
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
    const [songsRes, albums] = await Promise.all([
      getSingerSongs(mid, 100, Number(begin)),
      isFirstPage ? getSingerAlbums(mid, 80, 0) : Promise.resolve(null),
    ]);
    // 歌手页：同歌手下按歌名去重（无论专辑，保留非精选集版本）
    const songs = deduplicateByAlbum(songsRes.songs, 'name');
    res.json({
      singer: { mid, name: singerName },
      total: songsRes.total,
      songs,
      albums: albums || [],
      begin: Number(begin),
      hasMore: Number(begin) + 100 < songsRes.total,
    });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// 专辑内歌曲
router.get('/album', async (req, res) => {
  const { mid } = req.query;
  if (!mid) return res.status(400).json({ error: '请提供专辑 mid' });
  try {
    const result = await getAlbumSongs(mid);
    res.json(result);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// 解析 QQ 音乐歌单链接
router.post('/parse-playlist', async (req, res) => {
  const { url } = req.body || {};
  const disstid = extractDisstid(url);
  if (!disstid) {
    return res.status(400).json({ error: '无法从链接中解析出歌单 ID' });
  }
  try {
    const result = await parsePlaylist(disstid);
    res.json({ disstid, ...result });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

export default router;
