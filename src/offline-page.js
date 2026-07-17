// 离线缓存管理页面（独立视图，从侧边栏进入）
import { $, esc, toast, albumCover, CACHE_ICON, PIN_ICON, X_ICON, PLAY_ICON } from './utils.js';
import * as offline from './offlineCache.js';
import { setActiveNav } from './playlist-ui.js';
import { api } from './api.js';

export async function openOfflinePage() {
  import('./main.js').then(({ navPush }) => navPush('offline'));
  setActiveNav('navOffline');
  const main = $('main');
  main.innerHTML = '<div class="loading">加载缓存数据…</div>';

  try {
    // 一次性迁移旧条目：补全 song 字段，无法回填的自动删除
    const mig = await offline.migrateOldEntries();
    if (mig.deleted) {
      console.log('[offline] 迁移完成:', JSON.stringify(mig));
      toast(`已清理 ${mig.deleted} 条无歌名旧缓存`);
    }
    await renderOfflineView(main);
  } catch (e) {
    main.innerHTML = `<div class="empty">加载失败：${esc(e.message)}</div>`;
  }
}

// 存量回填：对缺少 album_mid 但歌词有 sourceId 的条目，批量反查封面
async function backfillMissingCovers(container, items) {
  const missing = items.filter(e => !e.song?.album_mid && e.lyrics?.sourceId && e.song?.name);
  if (!missing.length) return;
  try {
    const resp = await api('/music/album-backfill', {
      method: 'POST',
      body: {
        items: missing.map(e => ({
          sourceId: e.lyrics.sourceId,
          name: e.song.name,
          singer: e.song.singer || '',
        })),
      },
    });
    if (!resp?.results?.length) return;
    // 并行更新 DOM + IndexedDB
    const updates = resp.results.filter(r => r.album_mid);
    await Promise.all(updates.map(async (r) => {
      const bvidItem = missing.find(e => e.lyrics.sourceId === r.sourceId);
      if (!bvidItem) return;
      // 更新 DOM：替换占位图标为封面图片
      const row = container.querySelector(`.offline-item[data-bvid="${esc(bvidItem.key)}"]`);
      if (!row) return;
      const ph = row.querySelector('.oi-cover-ph');
      if (ph) {
        const img = document.createElement('img');
        img.className = 'oi-cover';
        img.src = albumCover(r.album_mid, 150);
        img.loading = 'lazy';
        img.alt = '';
        img.addEventListener('error', () => {
          const fallback = document.createElement('div');
          fallback.className = 'oi-cover-ph';
          fallback.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
          img.replaceWith(fallback);
        });
        ph.replaceWith(img);
      }
      // 写入 IndexedDB 持久化
      try {
        const entry = await offline.get(bvidItem.key);
        if (entry) {
          await offline.put({ ...entry, song: { ...(entry.song || {}), name: entry.song?.name || bvidItem.song.name, singer: entry.song?.singer || bvidItem.song.singer, album_mid: r.album_mid } });
        }
      } catch { /* IndexedDB 写入失败不阻断 UI */ }
    }));
  } catch (e) {
    console.warn('[offline-page] 封面回填失败:', e.message);
  }
}

async function renderOfflineView(container) {
  const s = await offline.stats();
  const items = await offline.list();

  const usedGB = (s.used / 1024 / 1024 / 1024).toFixed(2);
  const limitGB = Math.round(offline.getLimitBytes() / 1024 / 1024 / 1024);

  const pinnedCount = items.filter(e => e.pinned).length;
  const autoCount = items.length - pinnedCount;

  const subParts = [];
  subParts.push(`${items.length} 首歌曲`);
  if (pinnedCount) subParts.push(`${pinnedCount} 首主动缓存`);
  if (autoCount) subParts.push(`${autoCount} 首自动缓存`);
  subParts.push(`已用 <span class="offline-used">${usedGB} GB</span> / <select id="offlineLimitSel" class="offline-limit-sel">
    <option value="2" ${limitGB === 2 ? 'selected' : ''}>2 GB</option>
    <option value="5" ${limitGB === 5 ? 'selected' : ''}>5 GB</option>
    <option value="10" ${limitGB === 10 ? 'selected' : ''}>10 GB</option>
  </select>`);

  container.innerHTML = `
    <div class="view-title">离线缓存</div>
    <div class="offline-page-bar">
      <div class="view-sub">${subParts.join(' · ')}</div>
      <div class="offline-actions">
        <button class="btn sm" id="offlineClearAuto">清空自动缓存</button>
        <button class="btn sm danger" id="offlineClearAll">清空全部</button>
      </div>
    </div>
    <div class="section-head offline-section-head">
      <h2>已缓存歌曲</h2>
      ${items.length ? `<button class="btn sm green" id="offlinePlayAll">${PLAY_ICON} 播放全部</button>` : ''}
    </div>
    <div class="offline-page-list" id="offlineList">
      ${items.length ? items.map(e => renderOfflineItem(e)).join('') : '<div class="empty">暂无离线缓存，播放歌曲时会自动缓存</div>'}
    </div>
  `;

  // 存储当前条目列表供事件使用
  container._offlineItems = items;

  // 绑定事件
  bindOfflineEvents(container);

  // 存量回填：无 album_mid 但歌词有 sourceId 的条目，异步反查封面
  backfillMissingCovers(container, items);
}

function renderOfflineItem(e) {
  const name = e.song?.name || e.lyrics?.song?.name || e.videoSource?.title || e.key;
  const sub = e.song?.singer || e.lyrics?.song?.artist || '';
  const srcLabel = 'B站音频';
  const lyrLabel = e.lyrics ? (e.lyrics.sourceId || '已缓存') : '无';
  const statusTag = e.pinned
    ? `<span class="oi-status pinned">${PIN_ICON} 本地缓存</span>`
    : `<span class="oi-status temp">${CACHE_ICON} 自动缓存</span>`;

  const coverHtml = e.song?.album_mid
    ? `<img class="oi-cover" src="${albumCover(e.song.album_mid, 150)}" loading="lazy" alt="" />`
    : `<div class="oi-cover-ph"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>`;

  // 非钉住的显示「转本地缓存」按钮
  const pinBtn = e.pinned
    ? ''
    : `<button class="btn sm oi-pin-btn" data-pin="${esc(e.key)}" title="转为本地缓存，不被自动清空">${PIN_ICON} 转为本地</button>`;

  return `
    <div class="offline-item" data-bvid="${esc(e.key)}">
      ${coverHtml}
      <div class="oi-text">
        <span class="oi-name">${esc(name)}</span>
        <span class="oi-sub">${sub ? esc(sub) + ' · ' : ''}${esc(srcLabel)} ${esc(e.key)} · 歌词 ${esc(lyrLabel)} · ${statusTag}</span>
      </div>
      <div class="oi-item-ops">
        ${pinBtn}
        <button class="oi-remove" data-del="${esc(e.key)}" title="移除缓存" aria-label="移除">${X_ICON}</button>
      </div>
    </div>`;
}

function bindOfflineEvents(container) {
  // 封面加载失败 → 替换为占位图标
  container.querySelectorAll('.oi-cover').forEach(img => {
    img.addEventListener('error', () => {
      const ph = document.createElement('div');
      ph.className = 'oi-cover-ph';
      ph.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
      img.replaceWith(ph);
    });
  });

  // 存储上限选择器
  const limitSel = container.querySelector('#offlineLimitSel');
  if (limitSel) {
    limitSel.onchange = () => {
      offline.setLimitBytes(Number(limitSel.value) * 1024 ** 3);
      renderOfflineView(container);
    };
  }

  // 清空按钮
  container.querySelector('#offlineClearAuto').onclick = async () => {
    await offline.clearAuto();
    window.dispatchEvent(new CustomEvent('offline_cache_changed'));
    toast('已清空自动缓存');
    renderOfflineView(container);
  };

  container.querySelector('#offlineClearAll').onclick = async () => {
    const { uiConfirm } = await import('./utils.js');
    if (await uiConfirm('确定清空全部离线缓存（含主动缓存）？')) {
      await offline.clearAll();
      window.dispatchEvent(new CustomEvent('offline_cache_changed'));
      toast('已清空全部');
      renderOfflineView(container);
    }
  };

  // 播放全部
  const playAllBtn = container.querySelector('#offlinePlayAll');
  if (playAllBtn) {
    playAllBtn.onclick = () => {
      const items = container._offlineItems;
      const songs = items.map(entryToSong).filter(Boolean);
      if (!songs.length) return toast('没有可播放的歌曲');
      import('./player.js').then(({ playFromList }) => playFromList(songs, 0, null, null));
    };
  }

  // 整行点击 → 播放该首
  container.querySelectorAll('.offline-item[data-bvid]').forEach(row => {
    const bvid = row.dataset.bvid;
    row.addEventListener('click', (e) => {
      // 如果点击的是按钮，不触发整行播放
      if (e.target.closest('button')) return;
      const items = container._offlineItems;
      const songs = items.map(entryToSong).filter(Boolean);
      const idx = songs.findIndex(s => s.bvid === bvid);
      if (idx === -1) return;
      import('./player.js').then(({ playFromList }) => playFromList(songs, idx, null, null));
    });
  });

  // 钉住按钮：自动缓存 → 本地缓存
  container.querySelectorAll('[data-pin]').forEach(b => {
    b.onclick = async (e) => {
      e.stopPropagation();
      const bvid = b.dataset.pin;
      const entry = await offline.get(bvid);
      if (!entry) return;
      // 复用已有音频，仅升级 pinned 标记
      await offline.put({ ...entry, pinned: true, lastAccessed: Date.now() });
      window.dispatchEvent(new CustomEvent('offline_cache_changed'));
      toast('已转为本地缓存');
      renderOfflineView(container);
    };
  });

  // 移除按钮
  container.querySelectorAll('[data-del]').forEach(b => {
    b.onclick = async (e) => {
      e.stopPropagation();
      await offline.remove(b.dataset.del);
      window.dispatchEvent(new CustomEvent('offline_cache_changed'));
      renderOfflineView(container);
    };
  });
}

// 将离线缓存条目转为 playFromList 需要的歌曲对象
function entryToSong(e) {
  const name = e.song?.name || e.lyrics?.song?.name || e.videoSource?.title;
  if (!name) return null;
  return {
    name,
    singer: e.song?.singer || e.lyrics?.song?.artist || '',
    bvid: e.key,
    album_mid: e.song?.album_mid || null,
  };
}
