// 离线缓存存储核心（纯前端，IndexedDB）
// 两类数据：被动（自动落盘，受 LRU） / 主动（右键钉住整包，不 LRU、仅手动删）
// 音频字节经同源代理 /api/play/stream 抓取（直连 B 站 CDN 跨域，无法 fetch 落盘）。

import { api } from './api.js';

const DB_NAME = 'wemusic-offline';
const STORE = 'cache';
const LIMIT_KEY = 'wemusic_offline_limit';

let _db = null;
let _limitBytes = 2 * 1024 * 1024 * 1024; // 默认 2GB

export function cacheKey(bvid) { return bvid; }

// ---- 纯逻辑：选出需淘汰的 key（仅被动、按 lastAccessed 升序）----
// 不依赖 IndexedDB，便于单测。
export function chooseEvictions(entries, limitBytes) {
  const passive = entries.filter(e => !e.pinned).sort((a, b) => a.lastAccessed - b.lastAccessed);
  const total = entries.reduce((s, e) => s + (e.size || 0), 0);
  if (total <= limitBytes) return [];
  let need = total - limitBytes;
  const out = [];
  for (const e of passive) {
    if (need <= 0) break;
    out.push(e.key);
    need -= e.size || 0;
  }
  return out;
}

// ---- IndexedDB IO ----
function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'key' });
    r.onsuccess = () => { _db = r.result; res(_db); };
    r.onerror = () => rej(r.error);
  });
}
async function tx(mode) { const db = await openDB(); return db.transaction(STORE, mode).objectStore(STORE); }

export async function init() {
  await openDB();
  try { await navigator.storage?.persist?.(); } catch {}
  const v = localStorage.getItem(LIMIT_KEY);
  if (v) _limitBytes = Number(v);
}

export async function get(bvid) {
  const os = await tx('readonly');
  return new Promise((res, rej) => {
    const r = os.get(cacheKey(bvid));
    r.onsuccess = () => res(r.result || null);
    r.onerror = () => rej(r.error);
  });
}

export async function put(entry) {
  const os = await tx('readwrite');
  return new Promise((res, rej) => {
    const r = os.put({ ...entry, key: cacheKey(entry.key) });
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
}

export async function remove(bvid) {
  const os = await tx('readwrite');
  return new Promise((res, rej) => {
    const r = os.delete(cacheKey(bvid));
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
}

export async function list() {
  const os = await tx('readonly');
  return new Promise((res, rej) => {
    const r = os.getAll();
    r.onsuccess = () => res(r.result || []);
    r.onerror = () => rej(r.error);
  });
}

export async function stats() {
  const all = await list();
  const used = all.reduce((s, e) => s + (e.size || 0), 0);
  const pinned = all.filter(e => e.pinned).length;
  return { used, limit: _limitBytes, count: all.length, pinned };
}

export function setLimitBytes(n) { _limitBytes = n; localStorage.setItem(LIMIT_KEY, String(n)); }
export function getLimitBytes() { return _limitBytes; }

// 角标查询：'pinned' | 'temp' | null
export async function statusOf(bvid) {
  const e = await get(bvid);
  if (!e || !e.audio) return null;
  return e.pinned ? 'pinned' : 'temp';
}

// 落盘：经同源代理抓取完整字节。
// 关键规则（防"听过即存"误降级用户钉住项）：
//  - 已有钉住 + 本次被动 → 保留钉住，仅刷新 lastAccessed，不重抓、不降级
//  - 已有被动 + 本次钉住 → 升级钉住，复用已有音频，仅更新元数据（不重抓）
//  - 已有钉住 + 本次钉住 → 重写（更新 videoSource/lyrics）
//  - 已有被动 + 本次被动 → 同态，跳过
//  - 无音频 → 抓取整包
// 抓取歌词整包用于离线落盘：返回 { lines, candidates, sourceId, song, artist }。
// 失败静默返回 null（不阻断音频落盘）。
export async function fetchLyricsForOffline(name, singer) {
  try {
    const data = await api(`/stats/lyrics?name=${encodeURIComponent(name)}&singer=${encodeURIComponent(singer || '')}`);
    if (!data) return null;
    return {
      lines: data.lines || [],
      candidates: data.candidates || [],
      sourceId: data.sourceId || null,
      song: data.song || null,
      artist: data.artist || null,
    };
  } catch (e) {
    console.warn('[offline] 抓取歌词失败', name, singer, e.message);
    return null;
  }
}

export async function fetchAndStore(bvid, token, { pinned = false, videoSource = null, lyrics = null, song = null } = {}) {
  const existing = await get(bvid);
  if (existing && existing.audio) {
    if (existing.pinned && !pinned) {
      await touch(bvid);          // 被动落盘不得降级钉住项
      return existing;
    }
    if (!existing.pinned && !pinned) {
      return existing;            // 同态被动，跳过
    }
    if (!existing.pinned && pinned) {
      // 被动升级钉住：复用音频；lyrics 复用已有，或按需抓取
      const resolvedLyrics = lyrics !== null ? lyrics
        : (song && song.name ? await fetchLyricsForOffline(song.name, song.singer) : existing.lyrics || null);
      const entry = { ...existing, pinned: true, videoSource, lyrics: resolvedLyrics, song: song || existing.song || null, lastAccessed: Date.now() };
      await put(entry);
      return entry;               // 被动升级钉住，复用音频
    }
    // existing.pinned && pinned → 落到下方重写
  }
  const url = `/api/play/stream?bvid=${encodeURIComponent(bvid)}&token=${encodeURIComponent(token || '')}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('stream fetch failed: ' + resp.status);
  const blob = await resp.blob();
  // 未显式传 lyrics 时，若有 song 则尝试抓取整包
  const resolvedLyrics = lyrics !== null ? lyrics
    : (song && song.name ? await fetchLyricsForOffline(song.name, song.singer) : null);
  const entry = {
    key: bvid, audio: blob, videoSource, lyrics: resolvedLyrics, song: song || null,
    pinned, lastAccessed: Date.now(), size: blob.size, createdAt: Date.now(),
  };
  await put(entry);
  await evictIfNeeded();
  return entry;
}

export async function touch(bvid) {
  const e = await get(bvid);
  if (!e) return;
  e.lastAccessed = Date.now();
  await put(e);
}

export async function evictIfNeeded() {
  const all = await list();
  const del = chooseEvictions(all, _limitBytes);
  for (const k of del) await remove(k);
}

// 清空自动缓存（保留主动钉住）
export async function clearAuto() {
  const all = await list();
  for (const e of all) if (!e.pinned) await remove(e.key);
}
// 清空全部（含主动钉住）
export async function clearAll() {
  const all = await list();
  for (const e of all) await remove(e.key);
}

// 迁移旧条目：补全 song 字段（从 lyrics 包内提取），无法回填的自动删除。
// 返回 { updated, deleted } 统计。
export async function migrateOldEntries() {
  const all = await list();
  let updated = 0, deleted = 0;
  for (const e of all) {
    // 已有 song 字段 → 跳过
    if (e.song && e.song.name) continue;
    // 尝试从歌词包提取歌名
    const name = e.lyrics?.song?.name || null;
    const artist = e.lyrics?.song?.artist || e.lyrics?.artist || null;
    if (name) {
      e.song = { name, singer: artist };
      await put(e);
      updated++;
    } else {
      // 无法回填 → 删除（用户要求）
      await remove(e.key);
      deleted++;
    }
  }
  return { updated, deleted };
}

// 钉住随源迁移：旧源已钉住才迁移 —— 释放旧源、钉住新源
export async function migratePin(oldBvid, newBvid, token, song = null) {
  const old = await get(oldBvid);
  if (!old || !old.pinned) return;          // 旧源未钉住则无需迁移
  await remove(oldBvid);                     // 释放旧源
  await fetchAndStore(newBvid, token, { pinned: true, videoSource: { bvid: newBvid }, lyrics: null, song });
}
