// ---------------- 歌词全屏页（含换源支持） ----------------
import { $, esc, albumCover, singerAvatar, toast, PLAY_ICON, PAUSE_ICON, fetchBlockedList, blockedSectionHtml, bindBlockedSection, saveBlockedMeta } from './utils.js';
import { api } from './api.js';
import { state } from './state.js';
import { LyricsSource } from './platform.js';
import * as offline from './offlineCache.js';

// 无封面时的占位图标（音乐符号，240x240 画布上居中）
const PLACEHOLDER_COVER_SVG = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240" fill="none">' +
  '<rect width="240" height="240" fill="#a0a0a0" opacity=".12" rx="0"/>' +
  '<g transform="translate(72,56)">' +
  '<path d="M18 126V39l84-14v91" stroke="#6b6b6b" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>' +
  '<circle cx="30" cy="126" r="21" fill="#6b6b6b"/>' +
  '<circle cx="90" cy="112" r="21" fill="#6b6b6b"/>' +
  '</g></svg>'
);

// 预加载 player 模块（避免在 setInterval 中重复 import，解决循环依赖）
const _playerP = import('./player.js');
const _uiP = import('./ui.js');

export let lyricsLines = [];
export let lyricsFor = '';
export let lyricsCandidates = []; // 当前候选列表
export let lyricsCurrentSourceId = null; // 当前使用的网易云 songId
let _lyricsUISyncId = null;  // UI 同步 setInterval ID
let _lyricsSyncId = null;    // 进度同步 setInterval ID

// 用户滚动状态管理：区分主动滚动与自动滚动
let _userScrolling = false;      // 用户是否正在主动滚动歌词
let _scrollIdleTimer = null;     // 闲置倒计时 setTimeout ID
let _ignoreScrollUntil = 0;      // 时间戳，在此之前忽略 scroll 事件（过滤程序触发的滚动）
const SCROLL_IDLE_MS = 3000;     // 闲置超时：3 秒

export function setLyricsFor(v) { lyricsFor = v; }

// ---- localStorage 缓存：song_mid → netease_song_id ----
function getSourceCache() {
  try { return JSON.parse(localStorage.getItem('wemusic_lyrics_src') || '{}'); }
  catch { return {}; }
}
function saveSourceCache(songMid, sourceId) {
  const cache = getSourceCache();
  cache[songMid] = sourceId;
  localStorage.setItem('wemusic_lyrics_src', JSON.stringify(cache));
}

// 加载当前歌曲的背景信息（专辑简介）
let _bgLoading = false;
let _bgLoadedFor = '';

// 清理 QQ 音乐专辑简介：截断重复内容、去营销语
function cleanAlbumDesc(raw) {
  if (!raw) return '';
  // 去掉明显重复的段落（相同开头的段落保留第一个）
  const paras = raw.split(/\n\n+/);
  const seen = new Set();
  const clean = [];
  for (const p of paras) {
    const key = p.trim().slice(0, 30);
    if (seen.has(key)) continue;
    seen.add(key);
    clean.push(p);
  }
  let text = clean.join('\n\n');
  // 截断到 400 字左右
  if (text.length > 450) {
    text = text.slice(0, 450).replace(/\n[^\n]*$/, '') + '…';
  }
  return text;
}

export async function loadSongBackground(song) {
  const key = song.song_mid || `${song.name}__${song.singer || ''}`;
  if (_bgLoadedFor === key) return;
  _bgLoadedFor = key;
  if (_bgLoading) return;
  _bgLoading = true;
  const btn = document.getElementById('lpBgBtn');
  if (btn) btn.classList.remove('has-bg');
  try {
    const bg = await api(`/music/song-background?name=${encodeURIComponent(song.name)}&singer=${encodeURIComponent(song.singer || '')}&album_mid=${encodeURIComponent(song.album_mid || '')}`);
    if (!bg || !bg.desc) return;
    const title = bg.album_name || song.album || '未知专辑';
    const sub = [bg.aDate, bg.genre, bg.lan, bg.company].filter(Boolean).join(' · ');
    const desc = cleanAlbumDesc(bg.desc).replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>');
    $('lpBgCardTitle').textContent = title;
    $('lpBgCardSub').textContent = sub;
    $('lpBgCardBody').innerHTML = `<p>${desc}</p>`;
    if (btn) btn.classList.add('has-bg');
  } catch { console.warn('loadSongBackground 失败') }
  _bgLoading = false;
}

export function updateLyricsPanelMeta(song) {
  if (!song) return;
  $('lpTitle').textContent = `${song.name} · ${(song.singer || '').split('/')[0]}`;
  $('lpSongName').textContent = song.name || '';
  $('lpSongSinger').textContent = song.singer || '';

  // 三级兜底：专辑封面 → 歌手头像 → 默认音乐图标
  const albumUrl = song.album_mid ? albumCover(song.album_mid, 500) : '';
  const singerUrl = song.singer_mid ? singerAvatar(song.singer_mid, 500) : '';
  const coverImg = $('lpCoverImg');
  const bg = $('lpBg');

  function tryCover(url, fallback) {
    if (!url) return fallback();
    coverImg.src = url;
    coverImg.style.display = 'block';
    coverImg.removeAttribute('data-no-cover');
    bg.style.backgroundImage = `url(${url})`;
    coverImg.onerror = () => { coverImg.onerror = null; fallback(); };
  }

  tryCover(albumUrl, () => {
    tryCover(singerUrl, () => {
      // 最后兜底：默认音乐图标 + 渐变背景
      coverImg.src = PLACEHOLDER_COVER_SVG;
      coverImg.style.display = 'block';
      coverImg.setAttribute('data-no-cover', '');
      bg.style.backgroundImage = 'linear-gradient(135deg, var(--bg-card) 0%, var(--bg) 100%)';
    });
  });

  _uiP.then(({ heartOutline, heartFilled }) => {
  const isLiked = song.song_mid && state.likedMids && state.likedMids.has(song.song_mid);
  // .lp-like-row 是 grid 布局。上行：歌单/歌词/背景 三列；下行：♡ 按钮居中（grid-column: 1/-1 全宽 + justify-self: center）。
  $('lpLikeRow').innerHTML = `
    <button class="lp-action-btn" title="添加到歌单" id="lpAddBtn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg> 歌单</button>
    <button class="lp-action-btn" title="歌词换源" id="lpSwitchBtn">⤢ 歌词</button>
    <button class="lp-action-btn lp-bg-action" title="歌曲背景" id="lpBgBtn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg> 背景</button>
    ${song.song_mid ? `<button class="lp-action-btn like-btn${isLiked ? ' liked' : ''}" title="${isLiked ? '取消喜欢' : '喜欢'}" id="lpLikeBtn" style="grid-column:1/-1;justify-self:center">${isLiked ? heartFilled : heartOutline}</button>` : ''}
  `;
  const lpLikeBtn = document.getElementById('lpLikeBtn');
  if (lpLikeBtn) {
      lpLikeBtn.onclick = async () => {
      const { toggleLike, heartOutline, heartFilled } = await _uiP;
      await toggleLike(song, null);
      const liked2 = state.likedMids.has(song.song_mid);
      lpLikeBtn.innerHTML = liked2 ? heartFilled : heartOutline;
      lpLikeBtn.classList.toggle('liked', liked2);
      lpLikeBtn.title = liked2 ? '取消喜欢' : '喜欢';
    };
  }
  const lpAdd = document.getElementById('lpAddBtn');
  if (lpAdd) lpAdd.onclick = async () => {
    const { addSongs } = await import('./playlist-ui.js');
    addSongs([song]);
  };
  const lpSwitch = document.getElementById('lpSwitchBtn');
  if (lpSwitch) lpSwitch.onclick = () => openLyricsSwitchModal(song);
  const bgBtn = document.getElementById('lpBgBtn');
  if (bgBtn) bgBtn.onclick = () => {
    const ov = $('lpBgOverlay');
    ov.style.display = ov.style.display === 'none' || !ov.style.display ? 'flex' : 'none';
  };
  }); // close _uiP.then(...)
}

export function openLyricsPanel() {
  const panel = $('lyricsPanel');
  const cover = $('npCover');
  if (cover) {
    const r = cover.getBoundingClientRect();
    const cx = ((r.left + r.width / 2) / window.innerWidth * 100).toFixed(1) + '%';
    const cy = ((r.top + r.height / 2) / window.innerHeight * 100).toFixed(1) + '%';
    panel.style.setProperty('--lp-origin-x', cx);
    panel.style.setProperty('--lp-origin-y', cy);
  }
  panel.classList.add('show');
  document.body.style.overflow = 'hidden';
  // 重置滚动状态：打开面板时恢复自动跟随
  _userScrolling = false;
  if (_scrollIdleTimer) { clearTimeout(_scrollIdleTimer); _scrollIdleTimer = null; }
  if (state.current) {
    updateLyricsPanelMeta(state.current);
    loadLyrics(state.current);
  }
  _playerP.then(({ autoTimer, timerPaused }) => {
    if (autoTimer && !timerPaused) panel.classList.add('playing');
    $('lpPlayBtn').innerHTML = timerPaused ? PLAY_ICON : PAUSE_ICON;
  });

  // 启动 UI 同步定时器（仅在面板显示时运行）
  if (_lyricsUISyncId) clearInterval(_lyricsUISyncId);
  _lyricsUISyncId = setInterval(() => {
    _playerP.then(({ isSeeking }) => {
      // 用户正在拖动任一进度条时跳过同步，避免覆盖拖拽中的滑块值
      if (isSeeking()) return;
      // 脏检查：仅在值变化时更新 DOM
      const ct = $('curTime').textContent,
            dt = $('durTime').textContent,
            sb = $('seekBar').value,
            pb = $('playPauseBtn').innerHTML;
      if ($('lpCurTime').textContent !== ct) $('lpCurTime').textContent = ct;
      if ($('lpDurTime').textContent !== dt) $('lpDurTime').textContent = dt;
      if ($('lpSeekBar').value !== sb) $('lpSeekBar').value = sb;
      if ($('lpPlayBtn').innerHTML !== pb) $('lpPlayBtn').innerHTML = pb;
    });
  }, 500);

  // 启动歌词进度同步定时器
  if (_lyricsSyncId) clearInterval(_lyricsSyncId);
  _lyricsSyncId = setInterval(() => {
    _playerP.then(({ autoTimer, timerPaused, elapsed }) => {
      if (!autoTimer) { panel.classList.remove('playing'); return; }
      panel.classList.toggle('playing', !timerPaused);
      if (!timerPaused && lyricsLines.length) {
        syncLyrics(elapsed);
      }
    });
  }, 1000);
}

export function closeLyricsPanel() {
  // 清除定时器
  if (_lyricsUISyncId) { clearInterval(_lyricsUISyncId); _lyricsUISyncId = null; }
  if (_lyricsSyncId) { clearInterval(_lyricsSyncId); _lyricsSyncId = null; }
  // 重置滚动状态
  _userScrolling = false;
  if (_scrollIdleTimer) { clearTimeout(_scrollIdleTimer); _scrollIdleTimer = null; }
  _ignoreScrollUntil = 0;
  const panel = $('lyricsPanel');
  // 关闭时同步更新 origin，让动画缩回当前封面位置
  const cover = $('npCover');
  if (cover) {
    const r = cover.getBoundingClientRect();
    const cx = ((r.left + r.width / 2) / window.innerWidth * 100).toFixed(1) + '%';
    const cy = ((r.top + r.height / 2) / window.innerHeight * 100).toFixed(1) + '%';
    panel.style.setProperty('--lp-origin-x', cx);
    panel.style.setProperty('--lp-origin-y', cy);
  }
  panel.classList.remove('show');
  document.body.style.overflow = '';
}

export async function loadLyrics(song) {
  const key = `${song.name}__${song.singer || ''}`;
  if (lyricsFor === key && lyricsLines.length) return;

  // 检查是否有缓存的 sourceId
  const cache = getSourceCache();
  const cachedSourceId = song.song_mid && cache[song.song_mid];
  await doLoadLyrics(song, cachedSourceId || undefined);
}

async function doLoadLyrics(song, forceSourceId) {
  const key = `${song.name}__${song.singer || ''}`;
  $('lpBody').innerHTML = '<div class="lp-loading">加载歌词中…</div>';

  // 离线优先：若本地缓存命中且已有歌词整包，直接复用，不发网络请求
  // 但用户显式切换歌词源（forceSourceId）且离线缓存的源与之不一致时，
  // 必须落到网络请求以尊重用户选择，否则切换歌词源会无效。
  if (song.bvid) {
    try {
      const cached = await offline.get(song.bvid);
      if (cached && cached.lyrics) {
        const offlineSourceId = cached.lyrics.sourceId || null;
        const sameSource = !forceSourceId || String(offlineSourceId) === String(forceSourceId);
        if (sameSource) {
          lyricsLines = cached.lyrics.lines || [];
          lyricsFor = key;
          lyricsCandidates = cached.lyrics.candidates || [];
          lyricsCurrentSourceId = offlineSourceId || forceSourceId || null;
          renderLyricsLines();
          return true;
        }
      }
    } catch { /* 离线读取失败则回退到网络 */ }
  }

  try {
    const params = `name=${encodeURIComponent(song.name)}&singer=${encodeURIComponent(song.singer || '')}${forceSourceId ? `&sourceId=${forceSourceId}` : ''}`;
    const data = await api(`/stats/lyrics?${params}`);

    // 纯音乐检测：歌名命中关键词，跳过歌词搜索
    if (data.instrumental) {
      lyricsLines = [];
      lyricsFor = key;
      lyricsCandidates = [];
      lyricsCurrentSourceId = null;
      _userScrolling = false;
      if (_scrollIdleTimer) { clearTimeout(_scrollIdleTimer); _scrollIdleTimer = null; }
      $('lpBody').innerHTML = '<div class="lp-placeholder lp-instrumental">纯音乐，暂无歌词</div>';
      return true;
    }

    lyricsLines = data.lines || [];
    lyricsFor = key;
    lyricsCandidates = data.candidates || [];
    lyricsCurrentSourceId = data.sourceId || forceSourceId || null;

    if (!lyricsLines.length && lyricsCandidates.length && data.error) {
      $('lpBody').innerHTML = `<div class="lp-placeholder">${esc(data.error)}<br><span style="font-size:12px;color:var(--text-dim)">点「⤢ 歌词」选择其他版本</span></div>`;
      throw new Error(data.error); // 通知调用方失败
    } else {
      renderLyricsLines();
    }
    return true;
  } catch (e) {
    $('lpBody').innerHTML = `<div class="lp-error">${esc(e.message)}</div>`;
    lyricsLines = []; lyricsFor = ''; lyricsCandidates = []; lyricsCurrentSourceId = null;
    throw e; // 重新抛出，让调用方感知失败
  }
}

function renderLyricsLines() {
  // 新歌词加载时重置滚动状态，恢复自动跟随
  _userScrolling = false;
  if (_scrollIdleTimer) { clearTimeout(_scrollIdleTimer); _scrollIdleTimer = null; }
  if (!lyricsLines.length) {
    $('lpBody').innerHTML = '<div class="lp-placeholder">暂无歌词</div>';
    return;
  }
  $('lpBody').innerHTML = lyricsLines.map((l, i) => `<div class="lp-line" data-i="${i}">${esc(l.text)}</div>`).join('');
}

// ---- 歌词换源弹层 ----
async function openLyricsSwitchModal(song) {
  if (!lyricsCandidates.length) {
    try {
      const data = await api(`/stats/lyrics?name=${encodeURIComponent(song.name)}&singer=${encodeURIComponent(song.singer || '')}`);
      lyricsCandidates = data.candidates || [];
      // 同时记录主 sourceId（如果响应里有），确保"当前"标记能正确显示
      if (data.sourceId) lyricsCurrentSourceId = String(data.sourceId);
    } catch { toast('获取候选列表失败'); return; }
  }

  if (!lyricsCandidates.length) { toast('暂无其他歌词版本'); return; }

  const modal = $('candModal');
  const list = $('candList');
  // 歌词模式：隐藏 tabs，只显示候选列表
  const tabsEl = modal.querySelector('.cand-tabs');
  if (tabsEl) tabsEl.style.display = 'none';
  modal.querySelectorAll('.cand-panel').forEach(p => p.classList.remove('active'));
  list.classList.add('active');

  const songKey = `${song.name}__${song.singer || ''}`;

  // 拉取已屏蔽的歌词源
  const blockedList = await fetchBlockedList(api, songKey, 'lyrics', { name: song.name, singer: song.singer });

  list.innerHTML = lyricsCandidates.map((c, i) => {
    const isCurrent = String(c.id) === String(lyricsCurrentSourceId);
    const isQQ = c.source === LyricsSource.QQ;
    const platformLabel = isQQ ? 'QQ音乐' : '网易云';
    return `<div class="cand-row ${isCurrent ? 'current' : ''}" data-id="${esc(String(c.id))}" data-i="${i}">
      <span class="cand-rank">${i + 1}</span>
      <div class="ct">
        <div class="title">
          ${esc(c.name)}
          <span class="cand-source-tag${isQQ ? ' qq' : ''}">${esc(platformLabel)}</span>
        </div>
        <div class="meta">歌手：${esc(c.artist || '未知')} ${isCurrent ? '（当前）' : ''}</div>
      </div>
      <span class="tag ${isCurrent ? 'current' : ''}">${isCurrent ? '当前' : '选择'}</span>
      <button class="cand-block-btn" title="屏蔽此歌词源，以后不再出现"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>`;
  }).join('') + blockedSectionHtml(blockedList, 'candLyrics');

  modal.classList.add('show');

  // 关闭时恢复标题
  const restoreTitle = () => { modal.querySelector('h3').textContent = '选择播放资源（Bilibili）'; };

  // 辅助函数：按 data-id 从 candidates 数组查找候选（替代不稳定数组下标）
  const findById = (id) => lyricsCandidates.find(c => String(c.id) === String(id));

  list.querySelectorAll('.cand-row').forEach((row) => {
    row.onclick = async () => {
      const c = findById(row.dataset.id);
      if (!c) return;
      modal.classList.remove('show');
      restoreTitle();
      try {
        await doLoadLyrics(song, c.id);
        if (song.song_mid) saveSourceCache(song.song_mid, c.id);
        toast(`已切换到：${c.name}`);
      } catch {
        toast('该歌词源暂无内容，请换一个试试');
      }
    };
    row.querySelector('.cand-block-btn')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const targetId = row.dataset.id;
      const c = findById(targetId);
      if (!c) return;
      try {
        const sourceLabel = c.source === LyricsSource.QQ ? 'QQ音乐' : '网易云';
        await api('/stats/blocked', { method: 'POST', body: {
          song: songKey, type: 'lyrics', sourceId: String(c.id),
          name: c.name, artist: c.artist, sourceLabel,
        } });
        // 缓存被屏蔽源的展示信息（兜底，主要靠服务端存储）
        saveBlockedMeta(c.id, { name: c.name, artist: c.artist, source: c.source });
        lyricsCandidates = lyricsCandidates.filter(c => String(c.id) !== String(targetId));
        // 如果被屏蔽的源就是当前选中的源，同时清理 localStorage 缓存，避免下次刷新又加载到被屏蔽的源
        if (song.song_mid && String(lyricsCurrentSourceId) === String(c.id)) {
          const cache = getSourceCache();
          delete cache[song.song_mid];
          localStorage.setItem('wemusic_lyrics_src', JSON.stringify(cache));
          lyricsCurrentSourceId = null;
        }
        row.remove();
        // 立即刷新底部「已屏蔽的源」区域
        const oldBlocked = list.querySelector('.cand-blocked-section');
        if (oldBlocked) oldBlocked.remove();
        const newBlocked = await fetchBlockedList(api, songKey, 'lyrics', { name: song.name, singer: song.singer });
        list.insertAdjacentHTML('beforeend', blockedSectionHtml(newBlocked, 'candLyrics'));
        bindBlockedSection(list, api, songKey, 'lyrics', 'candLyrics');
        toast('已屏蔽，刷新后不再出现');
      } catch (err) { toast('屏蔽失败：' + err.message); }
    });
  });

  // 点叉关闭时恢复标题
  const origClose = $('candClose').onclick;
  $('candClose').onclick = () => { restoreTitle(); modal.classList.remove('show'); $('candClose').onclick = origClose; };

  // 已屏蔽列表事件
  bindBlockedSection(list, api, songKey, 'lyrics', 'candLyrics');
}

export function syncLyrics(sec) {
  if (!lyricsLines.length) return;
  let idx = 0;
  for (let i = 0; i < lyricsLines.length; i++) {
    if (lyricsLines[i].time <= sec) idx = i;
    else break;
  }
  const lines = $('lpBody').querySelectorAll('.lp-line');
  lines.forEach((el, i) => el.classList.toggle('active', i === idx));
  if (lines[idx] && $('lyricsPanel').classList.contains('show')) {
    // 用户主动滚动时跳过自动滚动，允许自由浏览
    if (_userScrolling) return;
    const body = $('lpBody');
    const lineTop = lines[idx].offsetTop;
    // 标记程序触发的滚动，让 scroll 事件处理器忽略此次滚动
    _ignoreScrollUntil = Date.now() + 600;
    body.scrollTo({ top: lineTop - body.clientHeight / 2 + lines[idx].clientHeight / 2, behavior: 'smooth' });
  }
}

// ---- 用户滚动检测与自动跟随恢复 ----

/**
 * lpBody 的 scroll 事件处理器。
 * 过滤程序触发的滚动（syncLyrics 的 scrollTo），
 * 检测到用户主动滚动时暂停自动跟随，并启动闲置倒计时。
 */
function _onLyricsScroll() {
  // 忽略程序触发的滚动（syncLyrics 设置了 _ignoreScrollUntil）
  if (Date.now() < _ignoreScrollUntil) return;

  _userScrolling = true;

  // 重置闲置倒计时：每次滚动都重新计时
  if (_scrollIdleTimer) clearTimeout(_scrollIdleTimer);
  _scrollIdleTimer = setTimeout(_resumeAutoScroll, SCROLL_IDLE_MS);
}

/**
 * 闲置倒计时到期后，平滑恢复自动跟随到当前播放位置。
 */
function _resumeAutoScroll() {
  _userScrolling = false;
  _scrollIdleTimer = null;
  // 立即滚动回当前播放行
  _playerP.then(({ elapsed, autoTimer, timerPaused }) => {
    if (!autoTimer || timerPaused) return;
    if (!lyricsLines.length) return;
    syncLyrics(elapsed);
  });
}

export function initLyrics() {
  $('npCover').style.cursor = 'pointer';
  $('npCover').onclick = openLyricsPanel;
  $('lpClose').onclick = closeLyricsPanel;

  // 背景面板关闭方式（静态绑定）
  $('lpBgCardClose').onclick = () => { $('lpBgOverlay').style.display = 'none'; };
  $('lpBgOverlay').onclick = (e) => { if (e.target === e.currentTarget) $('lpBgOverlay').style.display = 'none'; };
  $('lpPrevBtn').onclick = () => _playerP.then(({ playPrev }) => playPrev());
  $('lpNextBtn').onclick = () => _playerP.then(({ playNext }) => playNext(false));
  $('lpPlayBtn').onclick = async () => {
    const { togglePause } = await _playerP;
    const result = togglePause();
    if (result === 'noSong') return toast('请选择一首歌曲播放');
    if (result === 'mounted') return;
    // togglePause 已更新 playPauseBtn，这里同步更新歌词页按钮
    $('lpPlayBtn').innerHTML = $('playPauseBtn').innerHTML;
    toast(result ? '已暂停自动连播' : '继续自动连播');
  };
  _playerP.then(({ bindSeekBar }) => bindSeekBar($('lpSeekBar'), $('lpCurTime')));

  // 歌词滚动监听：检测用户主动滚动以暂停/恢复自动跟随
  $('lpBody').addEventListener('scroll', _onLyricsScroll, { passive: true });
}
