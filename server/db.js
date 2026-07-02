import Database from 'better-sqlite3';
import fs from 'node:fs';
import { config, DATA_DIR } from './config.js';

// 确保数据目录存在
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS playlists (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    name       TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS songs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    playlist_id INTEGER NOT NULL,
    song_mid    TEXT,
    name        TEXT NOT NULL,
    singer      TEXT,
    album       TEXT,
    album_mid   TEXT,
    duration    INTEGER DEFAULT 0,
    source      TEXT DEFAULT 'qqmusic',
    bvid        TEXT,
    cid         INTEGER,
    sort_order  INTEGER DEFAULT 0,
    added_at    INTEGER NOT NULL,
    FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
  );

  /* bvid 全局缓存：不依赖歌单，任意来源播放均可复用 */
  CREATE TABLE IF NOT EXISTS bvid_cache (
    song_mid    TEXT PRIMARY KEY,   -- QQ 音乐曲目 mid 作为 key
    name        TEXT NOT NULL,
    singer      TEXT,
    bvid        TEXT NOT NULL,
    bili_title  TEXT,
    bili_dur    INTEGER DEFAULT 0,
    updated_at  INTEGER NOT NULL
  );

  /* 播放日志：记录每次播放 */
  CREATE TABLE IF NOT EXISTS play_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    song_mid    TEXT,
    name        TEXT NOT NULL,
    singer      TEXT,
    album       TEXT,
    album_mid   TEXT,
    duration    INTEGER DEFAULT 0,   -- 歌曲标准时长（秒）
    played_sec  INTEGER DEFAULT 0,   -- 本次实际播放秒数（由前端上报）
    bvid        TEXT,
    played_at   INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  /* 歌曲红心（用户喜欢）*/
  CREATE TABLE IF NOT EXISTS likes (
    user_id   INTEGER NOT NULL,
    song_mid  TEXT    NOT NULL,
    name      TEXT NOT NULL,
    singer    TEXT,
    album     TEXT,
    album_mid TEXT,
    duration  INTEGER DEFAULT 0,
    liked_at  INTEGER NOT NULL,
    PRIMARY KEY (user_id, song_mid)
  );

  CREATE INDEX IF NOT EXISTS idx_playlists_user  ON playlists(user_id);
  CREATE INDEX IF NOT EXISTS idx_songs_playlist  ON songs(playlist_id);
  CREATE INDEX IF NOT EXISTS idx_play_logs_user  ON play_logs(user_id, played_at);
  CREATE INDEX IF NOT EXISTS idx_play_logs_name   ON play_logs(user_id, name, singer);
  CREATE INDEX IF NOT EXISTS idx_play_logs_singer ON play_logs(user_id, singer);
  CREATE INDEX IF NOT EXISTS idx_likes_user      ON likes(user_id, liked_at);

  /* 锁定的视频源 / 歌词源黑名单：用户可以为每首歌屏蔽不想要的候选 */
  CREATE TABLE IF NOT EXISTS blocked_sources (
    user_id     INTEGER NOT NULL,
    song_key    TEXT NOT NULL,           -- name__singer（唯一标识一首歌，与 play_logs 一致）
    source_type TEXT NOT NULL,           -- 'video' | 'lyrics'
    source_id   TEXT NOT NULL,           -- bvid（视频）| 网易云 songId 字符串（歌词）
    blocked_at  INTEGER NOT NULL,
    PRIMARY KEY (user_id, song_key, source_type, source_id)
  );

  /* 用户偏好（主题/字体/字号/色板等，服务端持久化，跨设备同步） */
  CREATE TABLE IF NOT EXISTS user_preferences (
    user_id INTEGER PRIMARY KEY,
    data    TEXT NOT NULL DEFAULT '{}',  -- JSON 对象
    updated_at INTEGER NOT NULL
  );

  /* 用户反馈 */
  CREATE TABLE IF NOT EXISTS feedback (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    type       TEXT NOT NULL,                -- 'bug' | 'feature' | 'other'
    content    TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  /* 收藏的专辑 */
  CREATE TABLE IF NOT EXISTS saved_albums (
    user_id     INTEGER NOT NULL,
    album_mid   TEXT NOT NULL,
    name        TEXT NOT NULL,
    singer      TEXT,
    desc        TEXT DEFAULT '',
    company     TEXT DEFAULT '',
    genre       TEXT DEFAULT '',
    lan         TEXT DEFAULT '',
    aDate       TEXT DEFAULT '',
    saved_at    INTEGER NOT NULL,
    PRIMARY KEY (user_id, album_mid)
  );
`);

// ---- 迁移：为旧库补充字段 ----
const songCols = db.prepare('PRAGMA table_info(songs)').all().map((c) => c.name);
if (!songCols.includes('sort_order')) {
  db.exec('ALTER TABLE songs ADD COLUMN sort_order INTEGER DEFAULT 0');
  db.exec('UPDATE songs SET sort_order = added_at');
}

const plCols = db.prepare('PRAGMA table_info(playlists)').all().map((c) => c.name);
if (!plCols.includes('sort_order')) {
  db.exec('ALTER TABLE playlists ADD COLUMN sort_order INTEGER DEFAULT 0');
}
if (!plCols.includes('desc')) {
  db.exec("ALTER TABLE playlists ADD COLUMN desc TEXT DEFAULT ''");
}

const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
if (!userCols.includes('avatar')) {
  db.exec('ALTER TABLE users ADD COLUMN avatar TEXT');
}
if (!userCols.includes('last_login_at')) {
  db.exec('ALTER TABLE users ADD COLUMN last_login_at INTEGER');
}

export default db;
