// ---------------- 歌词全屏页（含换源支持） ----------------
import { $, esc, albumCover, toast } from './utils.js';
import { api } from './api.js';
import { state } from './state.js';

export let lyricsLines = [];
export let lyricsFor = '';
export let lyricsCandidates = []; // 当前候选列表
export let lyricsCurrentSourceId = null; // 当前使用的网易云 songId
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
  } catch {}
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

  import('./ui.js').then(({ heartOutline, heartFilled }) => {
  const isLiked = song.song_mid && state.likedMids && state.likedMids.has(song.song_mid);
  $('lpLikeRow').innerHTML = `
    ${song.song_mid ? `<button class="lp-action-btn like-btn${isLiked ? ' liked' : ''}" title="${isLiked ? '取消喜欢' : '喜欢'}" id="lpLikeBtn">${isLiked ? heartFilled : heartOutline}</button>` : ''}
    <button class="lp-action-btn" title="添加到歌单" id="lpAddBtn">＋ 歌单</button>
    <button class="lp-action-btn" title="歌词换源" id="lpSwitchBtn">⤢ 歌词</button>
    <button class="lp-action-btn lp-bg-action" title="歌曲背景" id="lpBgBtn">💿 背景</button>
  `;
  const lpLikeBtn = document.getElementById('lpLikeBtn');
  if (lpLikeBtn) {
      lpLikeBtn.onclick = async () => {
      const { toggleLike, heartOutline, heartFilled } = await import('./ui.js');
      await toggleLike(song, null);
      const liked2 = state.likedMids.has(song.song_mid);
      lpLikeBtn.innerHTML = liked2 ? heartFilled : heartOutline;
      lpLikeBtn.classList.toggle('liked', liked2);
      lpLikeBtn.title = liked2 ? '取消喜欢' : '喜欢';
    };
  }
  document.getElementById('lpAddBtn').onclick = async () => {
    const { addSongs } = await import('./playlist-ui.js');
    addSongs([song]);
  };
  document.getElementById('lpSwitchBtn').onclick = () => openLyricsSwitchModal(song);
  const bgBtn = document.getElementById('lpBgBtn');
  if (bgBtn) bgBtn.onclick = () => {
    const ov = $('lpBgOverlay');
    ov.style.display = ov.style.display === 'none' || !ov.style.display ? 'flex' : 'none';
  };
  }); // close import('./ui.js').then(...)
}

export function openLyricsPanel() {
  const panel = $('lyricsPanel');
  // 计算封面元素在视口中的中心坐标，作为 transform-origin（百分比）
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
  import('./player.js').then(({ autoTimer, timerPaused }) => {
    if (autoTimer && !timerPaused) panel.classList.add('playing');
  });
}

export function closeLyricsPanel() {
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
    } else {
      renderLyricsLines();
    }
  } catch (e) {
    $('lpBody').innerHTML = `<div class="lp-error">${esc(e.message)}</div>`;
    lyricsLines = []; lyricsFor = ''; lyricsCandidates = []; lyricsCurrentSourceId = null;
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
  // 先确保有候选列表
  if (!lyricsCandidates.length) {
    // 实时拉取候选
    try {
      const data = await api(`/stats/lyrics?name=${encodeURIComponent(song.name)}&singer=${encodeURIComponent(song.singer || '')}`);
      lyricsCandidates = data.candidates || [];
    } catch { toast('获取候选列表失败'); return; }
  }

  if (!lyricsCandidates.length) { toast('暂无其他歌词版本'); return; }

  const modal = $('candModal');
  const list = $('candList');
  // 复用换源弹层 → 改标题
  modal.querySelector('h3').textContent = '选择歌词版本（网易云音乐）';

  list.innerHTML = lyricsCandidates.map((c, i) => {
    const isCurrent = c.id === lyricsCurrentSourceId;
    return `<div class="cand-row ${isCurrent ? 'live' : ''}" data-i="${i}">
      <div class="ct">
        <div class="title">${esc(c.name)}</div>
        <div class="meta">歌手：${esc(c.artist || '未知')} ${isCurrent ? '（当前）' : ''}</div>
      </div>
      <span class="tag ${isCurrent ? 'live' : ''}">${isCurrent ? '当前' : '选择'}</span>
    </div>`;
  }).join('');

  modal.classList.add('show');

  // 关闭时总是恢复标题（无论点叉还是选候选）
  const restoreTitle = () => { modal.querySelector('h3').textContent = '选择播放资源（Bilibili）'; };

  list.querySelectorAll('.cand-row').forEach((row) => {
    row.onclick = async () => {
      const c = lyricsCandidates[Number(row.dataset.i)];
      modal.classList.remove('show');
      restoreTitle();
      if (song.song_mid) saveSourceCache(song.song_mid, c.id);
      await doLoadLyrics(song, c.id);
      toast(`已切换到：${c.name}`);
    };
  });

  // 点叉关闭时恢复标题（openCandModal 总会再设回 Bilibili 标题）
  const origClose = $('candClose').onclick;
  $('candClose').onclick = () => { restoreTitle(); modal.classList.remove('show'); $('candClose').onclick = origClose; };
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
  $('lyricsBtn').onclick = openLyricsPanel;
  $('npCover').style.cursor = 'pointer';
  $('npCover').onclick = openLyricsPanel;
  $('lpClose').onclick = closeLyricsPanel;

  // 背景面板关闭方式（静态绑定）
  $('lpBgCardClose').onclick = () => { $('lpBgOverlay').style.display = 'none'; };
  $('lpBgOverlay').onclick = (e) => { if (e.target === e.currentTarget) $('lpBgOverlay').style.display = 'none'; };
  $('lpNextBtn').onclick = () => import('./player.js').then(({ playNext }) => playNext(false));
  $('lpPlayBtn').onclick = () => {
    if (!state.current) return toast('请选择一首歌曲播放');
    const mounted = $('videoContainer').children.length > 0;
    if (!mounted) { import('./player.js').then(({ playCurrent }) => playCurrent()); return; }
    import('./player.js').then((p) => {
      p.timerPaused = !p.timerPaused;
      $('playPauseBtn').textContent = p.timerPaused ? '▶' : '⏸';
      $('lpPlayBtn').textContent = p.timerPaused ? '▶' : '⏸';
      toast(p.timerPaused ? '已暂停自动连播' : '继续自动连播');
    });
  };
  $('lpSeekBar').addEventListener('input', () => {
    $('seekBar').value = Number($('lpSeekBar').value);
    $('seekBar').dispatchEvent(new Event('input'));
  });

  setInterval(() => {
    if (!$('lyricsPanel').classList.contains('show')) return;
    $('lpCurTime').textContent = $('curTime').textContent;
    $('lpDurTime').textContent = $('durTime').textContent;
    $('lpSeekBar').value = $('seekBar').value;
    $('lpPlayBtn').textContent = $('playPauseBtn').textContent;
  }, 500);

  setInterval(() => {
    const panel = $('lyricsPanel');
    import('./player.js').then(({ autoTimer, timerPaused, elapsed }) => {
      if (!autoTimer) { panel.classList.remove('playing'); return; }
      panel.classList.toggle('playing', !timerPaused);
      if (!timerPaused && panel.classList.contains('show') && lyricsLines.length) {
        syncLyrics(elapsed);
      }
    });
  }, 1000);
}
