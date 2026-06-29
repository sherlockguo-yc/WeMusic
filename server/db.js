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
    bvid        TEXT,           -- 缓存命中的 Bilibili 视频
    cid         INTEGER,
    sort_order  INTEGER DEFAULT 0,
    added_at    INTEGER NOT NULL,
    FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_playlists_user ON playlists(user_id);
  CREATE INDEX IF NOT EXISTS idx_songs_playlist ON songs(playlist_id);
`);

// 迁移：为旧库补充 sort_order 列
const songCols = db.prepare('PRAGMA table_info(songs)').all().map((c) => c.name);
if (!songCols.includes('sort_order')) {
  db.exec('ALTER TABLE songs ADD COLUMN sort_order INTEGER DEFAULT 0');
  db.exec('UPDATE songs SET sort_order = added_at');
}

export default db;

// 允许通过 `npm run init-db` 直接初始化
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('数据库初始化完成:', config.dbPath);
}
