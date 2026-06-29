// ---------------- 歌词全屏页 ----------------
import { $, esc, albumCover, toast } from './utils.js';
import { api } from './api.js';
import { state } from './state.js';

export let lyricsLines = [];
export let lyricsFor = '';
export function setLyricsFor(v) { lyricsFor = v; }

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

  const isLiked = song.song_mid && state.likedMids && state.likedMids.has(song.song_mid);
  $('lpLikeRow').innerHTML = `
    ${song.song_mid ? `<button class="lp-action-btn like-btn${isLiked ? ' liked' : ''}" title="${isLiked ? '取消喜欢' : '喜欢'}" id="lpLikeBtn">${isLiked ? '❤' : '🤍'}</button>` : ''}
    <button class="lp-action-btn" title="添加到歌单" id="lpAddBtn">＋ 歌单</button>
  `;
  const lpLikeBtn = document.getElementById('lpLikeBtn');
  if (lpLikeBtn) {
    lpLikeBtn.onclick = async () => {
      const { toggleLike } = await import('./ui.js');
      await toggleLike(song, null);
      const liked2 = state.likedMids.has(song.song_mid);
      lpLikeBtn.textContent = liked2 ? '❤' : '🤍';
      lpLikeBtn.classList.toggle('liked', liked2);
      lpLikeBtn.title = liked2 ? '取消喜欢' : '喜欢';
    };
  }
  document.getElementById('lpAddBtn').onclick = async () => {
    const { addSongs } = await import('./playlist-ui.js');
    addSongs([song]);
  };
}

export function openLyricsPanel() {
  const panel = $('lyricsPanel');
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
  $('lyricsPanel').classList.remove('show');
  document.body.style.overflow = '';
}

export async function loadLyrics(song) {
  const key = `${song.name}__${song.singer || ''}`;
  if (lyricsFor === key && lyricsLines.length) return;
  $('lpBody').innerHTML = '<div class="lp-loading">加载歌词中…</div>';
  try {
    const data = await api(`/stats/lyrics?name=${encodeURIComponent(song.name)}&singer=${encodeURIComponent(song.singer || '')}`);
    lyricsLines = data.lines || [];
    lyricsFor = key;
    renderLyricsLines();
  } catch (e) {
    $('lpBody').innerHTML = `<div class="lp-error">${esc(e.message)}</div>`;
    lyricsLines = []; lyricsFor = '';
  }
}

function renderLyricsLines() {
  if (!lyricsLines.length) {
    $('lpBody').innerHTML = '<div class="lp-placeholder">暂无歌词</div>';
    return;
  }
  $('lpBody').innerHTML = lyricsLines.map((l, i) => `<div class="lp-line" data-i="${i}">${esc(l.text)}</div>`).join('');
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

  $('lpPrevBtn').onclick = () => import('./player.js').then(({ playPrev }) => playPrev());
  $('lpNextBtn').onclick = () => import('./player.js').then(({ playNext }) => playNext(false));
  $('lpPlayBtn').onclick = () => {
    import('./player.js').then(({ playCurrent, timerPaused: tp, autoTimer: at }) => {
      // 读取当前 timerPaused 值需要动态引用
    });
    // 直接操作 DOM 按钮触发
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

  // 500ms 同步进度条显示
  setInterval(() => {
    if (!$('lyricsPanel').classList.contains('show')) return;
    $('lpCurTime').textContent = $('curTime').textContent;
    $('lpDurTime').textContent = $('durTime').textContent;
    $('lpSeekBar').value = $('seekBar').value;
    $('lpPlayBtn').textContent = $('playPauseBtn').textContent;
  }, 500);

  // 每秒歌词同步 + 封面旋转动画
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
