// 离线缓存管理页面（独立视图，从侧边栏进入）
import { $, esc, toast, albumCover, CACHE_ICON, PIN_ICON, X_ICON } from './utils.js';
import * as offline from './offlineCache.js';
import { setActiveNav } from './playlist-ui.js';

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
  subParts.push(`已用 ${usedGB} GB / ${limitGB} GB`);

  container.innerHTML = `
    <div class="view-title">离线缓存</div>
    <div class="view-sub">${subParts.join(' · ')}</div>
    <div class="offline-page-bar">
      <div class="offline-stat">
        存储上限：
        <select id="offlineLimitSel" class="offline-limit-sel">
          <option value="2" ${limitGB === 2 ? 'selected' : ''}>2 GB</option>
          <option value="5" ${limitGB === 5 ? 'selected' : ''}>5 GB</option>
          <option value="10" ${limitGB === 10 ? 'selected' : ''}>10 GB</option>
        </select>
      </div>
      <div class="offline-actions">
        <button class="btn sm" id="offlineClearAuto">清空自动缓存</button>
        <button class="btn sm blue" id="offlineClearAll">清空全部</button>
      </div>
    </div>
    <div class="section-head">
      <h2>已缓存歌曲</h2>
    </div>
    <div class="offline-page-list" id="offlineList">
      ${items.length ? items.map(e => renderOfflineItem(e)).join('') : '<div class="empty">暂无离线缓存，播放歌曲时会自动缓存</div>'}
    </div>
  `;

  // 绑定事件
  bindOfflineEvents(container);
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

  return `
    <div class="offline-item">
      ${coverHtml}
      <div class="oi-text">
        <span class="oi-name">${esc(name)}</span>
        <span class="oi-sub">${sub ? esc(sub) + ' · ' : ''}${esc(srcLabel)} · 歌词 ${esc(lyrLabel)} · ${statusTag}</span>
      </div>
      <button class="oi-remove" data-del="${esc(e.key)}" title="移除缓存" aria-label="移除">${X_ICON}</button>
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

  const limitSel = container.querySelector('#offlineLimitSel');
  if (limitSel) {
    limitSel.onchange = () => {
      offline.setLimitBytes(Number(limitSel.value) * 1024 ** 3);
      renderOfflineView(container);
    };
  }

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

  container.querySelectorAll('[data-del]').forEach(b => {
    b.onclick = async () => {
      await offline.remove(b.dataset.del);
      window.dispatchEvent(new CustomEvent('offline_cache_changed'));
      renderOfflineView(container);
    };
  });
}
