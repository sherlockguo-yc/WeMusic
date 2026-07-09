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

  /* 源质量众包：记录每个源（视频/歌词）对每首歌被完整播放的次数 */
  CREATE TABLE IF NOT EXISTS source_completions (
    source_type TEXT NOT NULL,           -- 'video' | 'lyrics'
    source_id   TEXT NOT NULL,           -- bvid（视频）| 网易云 songId / qq:mid（歌词）
    song_key    TEXT NOT NULL,           -- name__singer
    completions INTEGER DEFAULT 1,
    last_updated INTEGER NOT NULL,
    PRIMARY KEY (source_type, source_id, song_key)
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
// ---- 管理功能：角色、归档、状态 ----
if (!userCols.includes('role')) {
  db.exec("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'");
}
if (!userCols.includes('archived_at')) {
  db.exec('ALTER TABLE users ADD COLUMN archived_at INTEGER DEFAULT NULL');
}
if (!userCols.includes('status')) {
  db.exec("ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'active'");
}

// blocked_sources 展示元信息（name/artist/source_label）— 之前只存了 source_id，
// 旧数据回显为 raw id；重新屏蔽一次或服务端补齐后即可用元信息显示
const blockedCols = db.prepare('PRAGMA table_info(blocked_sources)').all().map((c) => c.name);
if (!blockedCols.includes('name')) db.exec('ALTER TABLE blocked_sources ADD COLUMN name TEXT');
if (!blockedCols.includes('artist')) db.exec('ALTER TABLE blocked_sources ADD COLUMN artist TEXT');
if (!blockedCols.includes('source_label')) db.exec('ALTER TABLE blocked_sources ADD COLUMN source_label TEXT');

// ---- 管理功能：新表 ----
db.exec(`
  /* 操作审计日志 */
  CREATE TABLE IF NOT EXISTS audit_logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    operator   TEXT NOT NULL,          -- 操作人用户名
    target     TEXT,                   -- 操作目标（用户名/资源名）
    action     TEXT NOT NULL,          -- 操作类型
    detail     TEXT,                   -- 额外详情（JSON）
    ip         TEXT,
    created_at INTEGER NOT NULL
  );

  /* 敏感词库：管理员可增删 */
  CREATE TABLE IF NOT EXISTS sensitive_words (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    word       TEXT UNIQUE NOT NULL,   -- 敏感词
    category   TEXT DEFAULT 'other',   -- 分类：political/porn/violence/other
    added_by   TEXT,                   -- 添加人
    created_at INTEGER NOT NULL
  );

  /* 系统配置（功能开关/运行时参数） */
  CREATE TABLE IF NOT EXISTS system_config (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,          -- JSON 序列化的值
    updated_by TEXT,
    updated_at INTEGER NOT NULL
  );
`);

// ---- 初始化超级管理员：将 superAdmins 列表中的用户 role 设为 super_admin ----
import('./config.js').then(({ config: cfg }) => {
  const names = cfg.superAdmins;
  if (names && names.length) {
    for (const name of names) {
      const row = db.prepare("SELECT id, role FROM users WHERE username = ?").get(name);
      if (row && row.role !== 'super_admin') {
        db.prepare("UPDATE users SET role = 'super_admin' WHERE id = ?").run(row.id);
        console.log(`[db] 已将 ${name} 提升为超级管理员`);
      }
    }
  }
}).catch(() => {});

export default db;
