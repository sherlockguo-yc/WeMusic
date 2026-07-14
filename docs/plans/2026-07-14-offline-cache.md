# 离线缓存 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 WeMusic 在播放过的歌曲上自动落盘音频（被动缓存），并支持用户右键「缓存到本地」钉住整包（主动缓存），断网/弱网时自动降级到本地缓存播放。

**Architecture:** 纯前端实现（无新增服务端接口）。新建 `src/offlineCache.js` 作为缓存存储与逻辑核心，底层用 IndexedDB 存 `{audio 字节, videoSource, lyrics, pinned, lastAccessed, size}`。播放路径（`player.js` 的 `_getPlayableUrl`）先查缓存命中；未命中则走现有直连/代理流，同时后台经**同源代理 `/api/play/stream`** 抓取完整字节落盘（绕开 B站 CDN 的跨域 fetch 限制）。右键菜单（`ui.js`）与设置页（`settings.js` + `index.html`）分别承载主动钉住与管理 UI。

**Tech Stack:** 原生 JS (ESM) / IndexedDB / Vite 构建 / Vitest 单测。遵循项目 Lucide 图标 + CSS 变量规范；歌曲行 Grid 模板不变（角标注入 `.name` 单元格内）。

**前置必读（项目规则）：** 动手改每个模块前，先读对应 Specs：
- 改 `src/player.js` → `docs/功能规格/后台播放.md`
- 改 `src/ui.js` / `src/player.js`(换源) → `docs/功能规格/候选选择.md`
- 改 `src/play.js`(服务端) → 本项目**不新增服务端接口**，复用 `/api/play/stream`

---

## 核心设计要点（实现时必须遵守）

1. **缓存只能经同源代理抓取**：`fetch('/api/play/stream?bvid=&token=')` 是同源，无 CORS 问题；直连 B站 CDN 的 `direct-url` 是跨域，`fetch` 取字节会被拦，**禁止**用直链落盘。
2. **缓存键**：`bvid`（单曲目音频由 bvid 唯一决定；cid 记录在条目内）。
3. **两态隔离**：`pinned=true` 的条目永不参与 LRU；仅 `pinned=false` 按 `lastAccessed` 升序淘汰。
4. **LRU 纯逻辑与 IO 分离**：`chooseEvictions()` 为纯函数，便于单测，不依赖 IndexedDB。
5. **Object URL 必须回收**：切歌时 `URL.revokeObjectURL` 上一个缓存 URL，防内存泄漏。
6. **不破坏 `.song-row` Grid 模板**：角标注入 `.name` 单元格内（inline），不新增 grid 列。
7. **构建**：`src/` 改动需 `npx vite build`；本功能纯前端，改完刷新即可验证，但生产需 build。

---

## Task 1: 缓存存储核心 `src/offlineCache.js`（含单测）

**Files:**
- Create: `src/offlineCache.js`
- Create: `tests/unit/offlineCache.test.js`

**Step 1: 写失败单测** `tests/unit/offlineCache.test.js`

```js
import { describe, it, expect } from 'vitest';
import { chooseEvictions, cacheKey } from '../../src/offlineCache.js';

describe('cacheKey', () => {
  it('以 bvid 为键', () => {
    expect(cacheKey('BV1xx')).toBe('BV1xx');
  });
});

describe('chooseEvictions (LRU)', () => {
  const mk = (key, size, lastAccessed, pinned) => ({ key, size, lastAccessed, pinned });
  it('超限时只淘汰被动项，且从最旧开始', () => {
    const entries = [
      mk('a', 100, 10, false),
      mk('b', 100, 5,  false),   // 最旧
      mk('c', 100, 20, true),    // 钉住，不可淘汰
    ];
    const del = chooseEvictions(entries, 150); // 仅容 150，需删 150
    expect(del).toEqual(['b', 'a']);           // 先删最旧 b，再删 a；c 保留
    expect(del).not.toContain('c');
  });
  it('钉住项永不被淘汰', () => {
    const entries = [ mk('x', 1000, 1, true) ];
    expect(chooseEvictions(entries, 1)).toEqual([]);
  });
  it('未超限不淘汰', () => {
    const entries = [ mk('a', 100, 1, false) ];
    expect(chooseEvictions(entries, 200)).toEqual([]);
  });
});
```

**Step 2: 运行确认失败** `npx vitest run tests/unit/offlineCache.test.js`
Expected: FAIL（`offlineCache.js` 不存在 / `chooseEvictions` 未定义）

**Step 3: 实现 `src/offlineCache.js`**（纯逻辑 + IndexedDB IO，常量放本模块不影响其他 chunk）

```js
// src/offlineCache.js
const DB_NAME = 'wemusic-offline';
const STORE = 'cache';
const LIMIT_KEY = 'offline_limit_bytes';

let _db = null;
let _limitBytes = 2 * 1024 * 1024 * 1024; // 默认 2GB

export function cacheKey(bvid) { return bvid; }

// ---- 纯逻辑：选出需淘汰的 key（仅被动、按 lastAccessed 升序） ----
export function chooseEvictions(entries, limitBytes) {
  const passive = entries.filter(e => !e.pinned).sort((a, b) => a.lastAccessed - b.lastAccessed);
  const total = entries.reduce((s, e) => s + e.size, 0);
  if (total <= limitBytes) return [];
  let need = total - limitBytes;
  const out = [];
  for (const e of passive) {
    if (need <= 0) break;
    out.push(e.key); need -= e.size;
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
  const v = localStorage.getItem('wemusic_offline_limit');
  if (v) _limitBytes = Number(v);
}
export async function get(bvid) {
  const os = await tx('readonly');
  return new Promise((res, rej) => { const r = os.get(cacheKey(bvid)); r.onsuccess = () => res(r.result || null); r.onerror = () => rej(r.error); });
}
export async function put(entry) {
  const os = await tx('readwrite');
  return new Promise((res, rej) => { const r = os.put({ ...entry, key: cacheKey(entry.key) }); r.onsuccess = () => res(); r.onerror = () => rej(r.error); });
}
export async function remove(bvid) {
  const os = await tx('readwrite');
  return new Promise((res, rej) => { const r = os.delete(cacheKey(bvid)); r.onsuccess = () => res(); r.onerror = () => rej(r.error); });
}
export async function list() {
  const os = await tx('readonly');
  return new Promise((res, rej) => { const r = os.getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error); });
}
export async function stats() {
  const all = await list();
  const used = all.reduce((s, e) => s + (e.size || 0), 0);
  const pinned = all.filter(e => e.pinned).length;
  return { used, limit: _limitBytes, count: all.length, pinned };
}
export function setLimitBytes(n) { _limitBytes = n; localStorage.setItem('wemusic_offline_limit', String(n)); }

// 落盘：经同源代理抓取完整字节（pinned 决定淘汰属性）
export async function fetchAndStore(bvid, token, { pinned = false, videoSource = null, lyrics = null } = {}) {
  const existing = await get(bvid);
  if (existing && existing.pinned === pinned && existing.audio) return existing; // 已存在同态
  const url = `/api/play/stream?bvid=${encodeURIComponent(bvid)}&token=${encodeURIComponent(token || '')}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('stream fetch failed: ' + resp.status);
  const blob = await resp.blob();
  const entry = {
    key: bvid, audio: blob, videoSource, lyrics,
    pinned, lastAccessed: Date.now(), size: blob.size, createdAt: Date.now(),
  };
  await put(entry);
  await evictIfNeeded();
  return entry;
}
export async function touch(bvid) {
  const e = await get(bvid); if (!e) return;
  e.lastAccessed = Date.now(); await put(e);
}
export async function evictIfNeeded() {
  const all = await list();
  const del = chooseEvictions(all, _limitBytes);
  for (const k of del) await remove(k);
}
export async function clearAuto() { const all = await list(); for (const e of all) if (!e.pinned) await remove(e.key); }
export async function clearAll() { const all = await list(); for (const e of all) await remove(e.key); }
// 钉住随源迁移：释放旧源、钉住新源由调用方编排（见 Task 7）
```

**Step 4: 运行单测通过** `npx vitest run tests/unit/offlineCache.test.js` → PASS

**Step 5: Commit**
```bash
git add src/offlineCache.js tests/unit/offlineCache.test.js
git commit -m "feat(offline): 缓存存储核心 + LRU 纯逻辑单测"
```

---

## Task 2: 播放路径接入缓存（命中 + 边播边落盘）

**Files:**
- Modify: `src/player.js`（需先读 `docs/功能规格/后台播放.md`）
- Test: `tests/unit/offlineCache.test.js` 可加 `fetchAndStore` mock 测试（可选）

**Step 1: 在 `player.js` 顶部引入**
```js
import * as offline from './offlineCache.js';
```

**Step 2: 改造 `_getPlayableUrl` 先查缓存**（约 line 785）
```js
let _cacheUse = null; // { fromCache, reason }
async function _getPlayableUrl(bvid) {
  // —— 缓存优先（同源字节，离线可用）——
  try {
    const c = await offline.get(bvid);
    if (c && c.audio) {
      const url = URL.createObjectURL(c.audio);
      if (_cacheUrl) URL.revokeObjectURL(_cacheUrl);
      _cacheUrl = url;
      offline.touch(bvid);
      const reason = !navigator.onLine ? '离线' : (_weakFallback ? '网络不佳' : '离线缓存');
      _cacheUse = { fromCache: true, reason };
      return { url, isDirect: false, fromCache: true };
    }
  } catch {}
  _cacheUse = null;
  // —— 原有逻辑：直连 → 代理 ——
  try {
    const r = await api(`/play/direct-url?bvid=${encodeURIComponent(bvid)}`);
    if (r && r.url) return { url: r.url, isDirect: true };
  } catch {}
  return { url: `/api/play/stream?bvid=${encodeURIComponent(bvid)}&token=${encodeURIComponent(Auth.token)}`, isDirect: false };
}
```

**Step 3: 播放开始后后台落盘**（在 `_loadAndPlayBgTrack` 与 `_loadBgTrack` 内，`bgAudio.load()` 之后追加）
```js
// 边播边后台落盘（被动，pinned=false）；失败静默
offline.fetchAndStore(bvid, Auth.token, { pinned: false, videoSource: { bvid } })
  .catch(e => console.warn('[offline] 后台缓存失败', bvid, e.message));
```

**Step 4: 切歌回收 object URL + 复位标志**
在 `playCurrent` 开头或 `startVideo` 卸载处：
```js
if (_cacheUrl) { URL.revokeObjectURL(_cacheUrl); _cacheUrl = null; }
_cacheUse = null;
```

**Step 5: 构建验证**
```bash
npx vite build
```
Expected: build 成功，无 TDZ（offlineCache 无被外部同步 import 的 `export const`）。

**Step 6: Commit**
```bash
git add src/player.js
git commit -m "feat(offline): 播放路径接入缓存命中与边播边落盘"
```

---

## Task 3: 右键「缓存到本地」主动钉住（整包）

**Files:**
- Modify: `src/ui.js`（需先读 `docs/功能规格/候选选择.md` 的换源/屏蔽部分）
- Modify: `src/player.js`（暴露 `ensurePinned` 或复用 `fetchAndStore`）

**Step 1: 在 `openSongMenu` 的 `items` 数组加入「缓存到本地」项**（ui.js ~line 20 后）
```js
{ label: CACHE_ICON + ' 缓存到本地', act: 'cacheoffline', dim: !song.bvid, dimTip: '请先播放一次以匹配资源' },
```
（图标 `CACHE_ICON` 用 Lucide `download` 路径，定义在 `utils.js` 共享常量。）

**Step 2: 在 `el.onclick` 的 act 分支追加**
```js
else if (act === 'cacheoffline') {
  import('./offlineCache.js').then(({ fetchAndStore }) => {
    toast('正在缓存到本地…');
    fetchAndStore(song.bvid, Auth.token, { pinned: true, videoSource: { bvid: song.bvid }, lyrics: null })
      .then(() => toast('已缓存到本地（钉住）'))
      .catch(e => toast('缓存失败：' + e.message));
  });
}
```
（歌词 `lyrics` 在 Task 7 或后续补获；整包以 audio+videoSource 为 v1，lyrics 见 Task 7 说明。）

**Step 3: Commit**
```bash
git add src/ui.js
git commit -m "feat(offline): 右键菜单「缓存到本地」主动钉住"
```

---

## Task 4: 离线/弱网降级提示「离线播放 + 原因」

**Files:**
- Modify: `src/player.js`（`setStatus` / `$('playStatus')` 状态区）

**Step 1: 在 `startVideo` 设置状态处，根据 `_cacheUse` 显示离线提示**（player.js ~line 925 状态区）
```js
if (_cacheUse?.fromCache) {
  $('playStatus').innerHTML = `<span class="status-inner"><span class="badge offline-badge">${WIFI_OFF_ICON} 离线播放</span> <span class="offline-reason">${esc(_cacheUse.reason)}</span> ${esc(displayTitle)}</span>`;
} else {
  $('playStatus').innerHTML = `<span class="status-inner"><span class="badge">${PLAY_ICON} Bilibili</span> ${esc(displayTitle)}</span>`;
}
```

**Step 2: 弱网 fallback 标记**（在 `bgAudio` 的 `error` 处理里，当从直连降级代理仍失败、准备切缓存前）
```js
_weakFallback = true; // 供 _getPlayableUrl 判定 reason
```
并在 `playCurrent` 重试前复位 `_weakFallback = false`。

**Step 3: CSS 角标（`public/css/style.css`，用 CSS 变量，不硬编码）**
```css
.offline-badge { color: var(--text-dim); border: 1px solid var(--border); }
.offline-reason { color: var(--text-dim); font-size: calc(var(--font-size) * 0.85); }
```
（CSS 改动**无需** vite build，刷新即可。）

**Step 4: Commit**
```bash
git add src/player.js public/css/style.css
git commit -m "feat(offline): 离线/弱网降级显示「离线播放 + 原因」"
```

---

## Task 5: 设置页「离线缓存」管理区（方案 A）

**Files:**
- Modify: `public/index.html`（在 `#settingsModal` 内新增「离线缓存」分区 HTML）
- Modify: `src/settings.js`（`openSettings()` 内渲染与绑定）
- Test: `tests/unit/offlineCache.test.js` 已覆盖核心逻辑

**Step 1: `index.html` 增加分区**（放在设置 modal 内容内，参考现有 `.setting-section` 结构）
```html
<section class="setting-section" id="offlineSection">
  <h3>离线缓存</h3>
  <div class="offline-stat"><span id="offlineUsed">0 MB</span> / <span id="offlineLimitLabel">2 GB</span></div>
  <div class="offline-limit">
    <label>存储上限</label>
    <select id="offlineLimitSel">
      <option value="2">2 GB</option><option value="5">5 GB</option><option value="10">10 GB</option>
    </select>
  </div>
  <div class="offline-actions">
    <button class="btn sm" id="offlineClearAuto">清空自动缓存</button>
    <button class="btn sm blue" id="offlineClearAll">清空全部</button>
  </div>
  <div class="offline-list" id="offlineList"></div>
</section>
```

**Step 2: `settings.js` `openSettings()` 内绑定**（在 `updateSleepHint();` 附近追加）
```js
import * as offline from './offlineCache.js';
// 渲染统计
const renderOffline = async () => {
  const s = await offline.stats();
  $('offlineUsed').textContent = (s.used / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  $('offlineLimitLabel').textContent = (_limitGB()) + ' GB';
  const items = await offline.list();
  $('offlineList').innerHTML = items.map(e => `
    <div class="offline-item ${e.pinned ? 'pinned' : ''}">
      <span class="oi-name">${esc(e.videoSource?.bvid || e.key)}</span>
      <span class="oi-tag">${e.pinned ? '钉住' : '自动'}</span>
      <button class="btn sm" data-del="${esc(e.key)}">${e.pinned ? '删除' : '取消离线'}</button>
    </div>`).join('');
  $('offlineList').querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    await offline.remove(b.dataset.del); renderOffline();
  });
};
await renderOffline();
$('offlineLimitSel').value = String(_limitGB());
$('offlineLimitSel').onchange = () => { offline.setLimitBytes(Number($('offlineLimitSel').value) * 1024**3); renderOffline(); };
$('offlineClearAuto').onclick = async () => { await offline.clearAuto(); renderOffline(); toast('已清空自动缓存'); };
$('offlineClearAll').onclick = async () => {
  const { uiConfirm } = await import('./utils.js');
  if (await uiConfirm('确定清空全部离线缓存（含主动钉住）？')) { await offline.clearAll(); renderOffline(); toast('已清空全部'); }
};
```
（其中 `_limitGB()` 为 settings.js 内从 `localStorage` 读当前上限的辅助函数，需补定义；或直接读 `offline` 暴露的 limit。）

**Step 3: `index.html` 同步无需改脚本 src（base `/dist/` 已配置）**

**Step 4: 构建 + 手动验证**
```bash
npx vite build
```
浏览器打开设置页 → 播放几首歌 → 设置页应显示占用增长、列表出现「自动」项。

**Step 5: Commit**
```bash
git add public/index.html src/settings.js
git commit -m "feat(offline): 设置页离线缓存管理区（统计/上限/清空）"
```

---

## Task 6: 歌曲行两态角标（已下载 / 已临时缓存）

**Files:**
- Modify: `src/utils.js`（新增 `cacheBadgeHtml(song)` 共享函数 + `CACHE_ICON`/`PIN_ICON` Lucide 常量）
- Modify: `src/playlist-ui.js`（~line 257 `.name` 注入）
- Modify: `src/search.js`（~line 117 `.name` 注入）
- Modify: `src/player.js`（播放后 `refreshCacheBadges()`）
- Modify: `public/css/style.css`（两态样式，CSS 变量）

**Step 1: `utils.js` 增加**
```js
export const CACHE_ICON = '<svg ...download...></svg>';
export const PIN_ICON   = '<svg ...pin...></svg>';
// 根据离线索引返回角标；status: 'pinned' | 'temp' | null
export function cacheBadgeHtml(status) {
  if (status === 'pinned') return `<span class="cache-badge pinned" title="已下载（钉住）">${PIN_ICON}</span>`;
  if (status === 'temp')   return `<span class="cache-badge temp" title="已临时缓存">${CACHE_ICON}</span>`;
  return '';
}
```
（离线索引查询：在 `offlineCache.js` 暴露 `statusOf(bvid)` 返回 `'pinned'|'temp'|null`，player.js 播放/钉住后广播事件，各列表 `refreshCacheBadges()` 重查。）

**Step 2: 注入 `.name` 单元格**
playlist-ui.js 模板（~line 257）：
```html
<span class="name${showCover ? ' name-with-cover' : ''}">${coverHtml}<span class="name-text">${esc(s.name)}</span>${cacheBadgeHtml(s._cacheStatus)}</span>
```
search.js 同理（~line 117）。`s._cacheStatus` 在渲染前由各列表调用 `offline.statusOf(s.bvid)` 填充（无 bvid 则为 null）。

**Step 3: CSS 两态（明显区分）**
```css
.cache-badge { display:inline-flex; vertical-align:middle; margin-left:5px; }
.cache-badge.pinned { color: var(--accent); }              /* 强调：accent 实心感 */
.cache-badge.temp   { color: var(--text-dim); opacity:.7; } /* 弱化：灰度描边感 */
```
（具体图标/配色实现后由用户评审微调，遵循 Lucide + 变量规范。）

**Step 4: 广播刷新**
player.js 钉住/落盘完成后 `window.dispatchEvent(new CustomEvent('offline_cache_changed'))`；playlist-ui.js / search.js 监听该事件调用本列表 `refreshCacheBadges()`。

**Step 5: 构建验证** `npx vite build`，浏览器播放→列表出现弱化角标；右键钉住→出现强调角标。

**Step 6: Commit**
```bash
git add src/utils.js src/playlist-ui.js src/search.js src/player.js public/css/style.css
git commit -m "feat(offline): 歌曲行两态缓存角标（钉住/临时）"
```

---

## Task 7: 换源时钉住随源迁移

**Files:**
- Modify: `src/ui.js`（换源处理处，需先读 `docs/功能规格/候选选择.md`）
- Modify: `src/offlineCache.js`（新增 `migratePin(oldBvid, newBvid, token)`）

**Step 1: `offlineCache.js` 增加迁移**
```js
export async function migratePin(oldBvid, newBvid, token) {
  const old = await get(oldBvid);
  if (!old || !old.pinned) return;          // 旧源未钉住则无需迁移
  await remove(oldBvid);                     // 释放旧源
  await fetchAndStore(newBvid, token, { pinned: true, videoSource: { bvid: newBvid }, lyrics: null });
}
```

**Step 2: 在换源成功回调中调用**（ui.js 换源逻辑处）
```js
import('./offlineCache.js').then(({ migratePin }) => migratePin(oldBvid, newBvid, Auth.token).catch(()=>{}));
```

**Step 3: Commit**
```bash
git add src/offlineCache.js src/ui.js
git commit -m "feat(offline): 换源时钉住随源迁移"
```

---

## Task 8: 收尾（persist + 构建 + e2e 冒烟）

**Files:**
- Modify: `src/main.js`（`init` 时调用 `offline.init()`）
- Modify: `e2e/`（可选新增离线冒烟脚本）

**Step 1: `main.js` 启动时初始化**
```js
import * as offline from './offlineCache.js';
offline.init().catch(e => console.warn('offline init failed', e));
```

**Step 2: 构建**
```bash
npx vite build
```

**Step 3: 手动冒烟（浏览器）**
1. 播放 3 首不同歌 → 设置页「离线缓存」占用增长、列表 3 条「自动」。
2. 断网（DevTools Network → Offline）再播这 3 首 → 播放栏显示「离线播放 · 离线」，声音正常。
3. 右键某歌「缓存到本地」→ 列表该行出现强调角标；设置页该条变「钉住」。
4. 反复播放直到超过上限 → 「自动」项被 LRU 淘汰、「钉住」项保留。
5. 换源已钉住歌曲 → 旧源缓存释放、新源变「钉住」。

**Step 4: Commit**
```bash
git add src/main.js
git commit -m "feat(offline): 初始化 + 构建收尾"
```

---

## 风险与未决

- **歌词整包缓存**：本方案 v1 主动钉住以 audio+videoSource 为主，lyrics 取数依赖 `loadLyrics` 结果，建议在钉住流程里补 `lyrics` 入参（已在 `fetchAndStore` 预留字段）。
- **直连 CDN 不可用于落盘**：已强制走 `/api/play/stream`，服务器需稳定（占用自建带宽，符合既有代理路径）。
- **`objectURL` 生命周期**：切歌严格回收，避免内存泄漏（已在 Task 2 处理）。
- **角标视觉**：具体 Lucide 图标与配色待实现后由用户评审（Task 6 Step 3 注释）。
