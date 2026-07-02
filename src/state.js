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
  songIndex: new Map(),
  isAdmin: false,       // 管理员标记（登录后由 /auth/me 设置）
  user: null,           // { id, username, avatar }
};
