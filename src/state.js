// ---------------- 全局状态 ----------------
export const state = {
  playlists: [],
  targetPlaylistId: null,
  view: 'home',
  queue: [],
  queueIndex: -1,
  current: null,
  currentContext: null,
  playMode: localStorage.getItem('wemusic_mode') || 'loop',
  history: [],
  paneVisible: localStorage.getItem('wemusic_pane') !== 'false',
  likedMids: new Set(),
  favMids: new Set(),          // 收藏（特别喜欢），独立于喜欢
  dislikedSongKeys: new Set(), // name__singer 格式，用于跳过不喜欢的歌曲
  songIndex: new Map(),
  isAdmin: false,       // 管理员标记（登录后由 /auth/me 设置）
  user: null,           // { id, username, avatar }
};
