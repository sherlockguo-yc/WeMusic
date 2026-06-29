// ---------------- 播放队列 + 历史抽屉 ----------------
import { $, esc, toast } from './utils.js';
import { state } from './state.js';

export let activeTab = 'queue';

export function getPlayHistory() {
  try { return JSON.parse(localStorage.getItem('wemusic_play_hist') || '[]'); }
  catch { return []; }
}

export function pushPlayHistory(song) {
  if (!song || !song.name) return;
  const item = {
    song_mid: song.song_mid, name: song.name, singer: song.singer,
    album: song.album, album_mid: song.album_mid, duration: song.duration,
    bvid: song.bvid, _biliTitle: song._biliTitle, _biliDur: song._biliDur,
    at: Date.now(),
  };
  let h = getPlayHistory().filter((x) => `${x.name}__${x.singer || ''}` !== `${item.name}__${item.singer || ''}`);
  h.unshift(item); h = h.slice(0, 100);
  localStorage.setItem('wemusic_play_hist', JSON.stringify(h));
  if ($('queueDrawer').classList.contains('show') && activeTab === 'history') renderHistory();
}

function setTab(t) {
  $('tabQueue').classList.toggle('active', t === 'queue');
  $('tabHistory').classList.toggle('active', t === 'history');
}

export function renderActiveTab() { activeTab === 'queue' ? renderQueue() : renderHistory(); }

export function renderQueue() {
  const list = $('qdList');
  if (!state.queue.length) { list.innerHTML = '<div class="empty">队列为空</div>'; return; }
  list.innerHTML = state.queue.map((s, i) => `
    <div class="qd-row ${i === state.queueIndex ? 'playing' : ''}" data-i="${i}">
      <div class="qd-ct">
        <div class="qd-name">${esc(s.name)}</div>
        <div class="qd-singer">${esc(s.singer || '')}</div>
      </div>
      <span class="qd-del" data-i="${i}" title="移出队列">✕</span>
    </div>`).join('');

  list.querySelectorAll('.qd-row').forEach((row) => {
    row.onclick = (e) => {
      if (e.target.classList.contains('qd-del')) return;
      state.queueIndex = Number(row.dataset.i);
      import('./player.js').then(({ playCurrent }) => playCurrent());
      renderQueue();
    };
  });
  list.querySelectorAll('.qd-del').forEach((el) => {
    el.onclick = (e) => { e.stopPropagation(); removeFromQueue(Number(el.dataset.i)); };
  });
}

export function removeFromQueue(i) {
  if (i < 0 || i >= state.queue.length) return;
  const removingCurrent = i === state.queueIndex;
  state.queue.splice(i, 1);
  if (i < state.queueIndex) {
    state.queueIndex--;
  } else if (removingCurrent) {
    if (state.queue.length === 0) {
      state.queueIndex = -1; state.current = null;
      import('./player.js').then(({ destroyVideo, setStatus }) => destroyVideo());
      $('npTitle').textContent = '未在播放';
      $('npSinger').textContent = '—';
      document.title = 'WeMusic · 个人音乐';
    } else {
      if (state.queueIndex >= state.queue.length) state.queueIndex = 0;
      import('./player.js').then(({ playCurrent }) => playCurrent());
    }
  }
  import('./player.js').then(({ saveSession }) => saveSession());
  renderQueue();
}

export function renderHistory() {
  const list = $('qdList');
  const hist = getPlayHistory();
  if (!hist.length) { list.innerHTML = '<div class="empty">还没有播放记录</div>'; return; }
  list.innerHTML = hist.map((s, i) => `
    <div class="qd-row" data-i="${i}">
      <div class="qd-ct">
        <div class="qd-name">${esc(s.name)}</div>
        <div class="qd-singer">${esc(s.singer || '')}</div>
      </div>
      <span class="qd-del" data-i="${i}" title="移出历史">✕</span>
    </div>`).join('');

  list.querySelectorAll('.qd-row').forEach((row) => {
    row.onclick = (e) => {
      if (e.target.classList.contains('qd-del')) return;
      const song = hist[Number(row.dataset.i)];
      import('./player.js').then(({ playFromList }) => playFromList([{ ...song }], 0, null, null));
    };
  });
  list.querySelectorAll('.qd-del').forEach((el) => {
    el.onclick = (e) => {
      e.stopPropagation();
      const h = getPlayHistory();
      h.splice(Number(el.dataset.i), 1);
      localStorage.setItem('wemusic_play_hist', JSON.stringify(h));
      renderHistory();
    };
  });
}

export function initQueue() {
  $('queueBtn').onclick = () => {
    const d = $('queueDrawer');
    const show = d.classList.toggle('show');
    if (show) renderActiveTab();
  };
  $('qdClose').onclick = () => $('queueDrawer').classList.remove('show');
  $('qdClear').onclick = () => {
    if (activeTab === 'queue') {
      state.queue = []; state.queueIndex = -1; state.current = null; state.history = [];
      import('./player.js').then(({ destroyVideo, saveSession, setStatus }) => {
        destroyVideo(); saveSession();
      });
      $('npTitle').textContent = '未在播放';
      $('npSinger').textContent = '—';
      $('npCover').classList.remove('show');
      document.title = 'WeMusic · 个人音乐';
      renderQueue(); toast('已清空播放队列');
    } else {
      localStorage.removeItem('wemusic_play_hist');
      renderHistory(); toast('已清空播放历史');
    }
  };
  $('tabQueue').onclick = () => { activeTab = 'queue'; setTab('queue'); renderQueue(); };
  $('tabHistory').onclick = () => { activeTab = 'history'; setTab('history'); renderHistory(); };

  // 最近播放导航
  const navHistory = $('navHistory');
  if (navHistory) {
    navHistory.onclick = () => {
      activeTab = 'history';
      $('queueDrawer').classList.add('show');
      setTab('history');
      renderHistory();
    };
  }
}
