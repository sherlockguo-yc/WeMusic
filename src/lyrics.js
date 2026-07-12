// ---------------- 歌词全屏页（含换源支持） ----------------
import { $, esc, albumCover, toast, PLAY_ICON, PAUSE_ICON, fetchBlockedList, blockedSectionHtml, bindBlockedSection, saveBlockedMeta } from './utils.js';
import { api } from './api.js';
import { state } from './state.js';
import { LyricsSource } from './platform.js';

// 预加载 player 模块（避免在 setInterval 中重复 import，解决循环依赖）
const _playerP = import('./player.js');
const _uiP = import('./ui.js');

export let lyricsLines = [];
export let lyricsFor = '';
export let lyricsCandidates = []; // 当前候选列表
export let lyricsCurrentSourceId = null; // 当前使用的网易云 songId
let _lyricsUISyncId = null;  // UI 同步 setInterval ID
let _lyricsSyncId = null;    // 进度同步 setInterval ID
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
  const cover = song.album_mid ? albumCover(song.album_mid, 500) : '';
  const coverImg = $('lpCoverImg');
  if (cover) { coverImg.src = cover; coverImg.style.display = 'block'; }
  else { coverImg.style.display = 'none'; }
  const bg = $('lpBg');
  if (cover) bg.style.backgroundImage = `url(${cover})`;
  else bg.style.backgroundImage = 'none';

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
    // 脏检查：仅在值变化时更新 DOM
    const ct = $('curTime').textContent,
          dt = $('durTime').textContent,
          sb = $('seekBar').value,
          pb = $('playPauseBtn').innerHTML;
    if ($('lpCurTime').textContent !== ct) $('lpCurTime').textContent = ct;
    if ($('lpDurTime').textContent !== dt) $('lpDurTime').textContent = dt;
    if ($('lpSeekBar').value !== sb) $('lpSeekBar').value = sb;
    if ($('lpPlayBtn').innerHTML !== pb) $('lpPlayBtn').innerHTML = pb;
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
  // 清除 initLyrics 中启动的两个同步定时器
  if (_lyricsUISyncId) { clearInterval(_lyricsUISyncId); _lyricsUISyncId = null; }
  if (_lyricsSyncId) { clearInterval(_lyricsSyncId); _lyricsSyncId = null; }
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

  try {
    const params = `name=${encodeURIComponent(song.name)}&singer=${encodeURIComponent(song.singer || '')}${forceSourceId ? `&sourceId=${forceSourceId}` : ''}`;
    const data = await api(`/stats/lyrics?${params}`);

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
  modal.querySelector('h3').textContent = '选择歌词版本';

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
    const body = $('lpBody');
    const lineTop = lines[idx].offsetTop;
    body.scrollTo({ top: lineTop - body.clientHeight / 2 + lines[idx].clientHeight / 2, behavior: 'smooth' });
  }
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
  $('lpSeekBar').addEventListener('input', () => {
    $('seekBar').value = Number($('lpSeekBar').value);
    $('seekBar').style.setProperty('--seek-pct', ($('seekBar').value / 10) + '%');
    $('seekBar').dispatchEvent(new Event('input'));
  });
}
