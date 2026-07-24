// 简单的 API 封装 + 登录态管理
const TOKEN_KEY = 'wemusic_token';
const USER_KEY = 'wemusic_user';

let _tokenCache = null; // 缓存 token，避免每次 API 调用读 localStorage

export const Auth = {
  get token() {
    if (_tokenCache === null) _tokenCache = localStorage.getItem(TOKEN_KEY);
    return _tokenCache;
  },
  get user() {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); }
    catch { localStorage.removeItem(USER_KEY); return null; }
  },
  save(token, user) {
    _tokenCache = token;
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  clear() {
    _tokenCache = null;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },
};

export async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && Auth.token) headers.Authorization = `Bearer ${Auth.token}`;
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* ignore */ }
  if (res.status === 401) {
    Auth.clear();
    if (!location.pathname.endsWith('login.html')) {
      sessionStorage.setItem('wemusic_redirect', location.href);
      location.href = '/login.html';
    }
    throw new Error((data && data.error) || '登录已过期，请重新登录');
  }
  if (!res.ok) {
    throw new Error((data && data.error) || `请求失败 (${res.status})`);
  }
  return data;
}
