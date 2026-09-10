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

const FETCH_TIMEOUT_MS = 8000; // 弱网（蜂窝→CF 国际链路）下 fetch 会永久挂起，必须主动超时
const RETRY_DELAY_MS = 1200;

export async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && Auth.token) headers.Authorization = `Bearer ${Auth.token}`;
  const attempts = method === 'GET' ? 2 : 1; // 读操作幂等，超时自动重试一次
  for (let i = 0; i < attempts; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(`/api${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      // 网络失败/超时：GET 再试一次（弱网链路质量波动大），写操作直接抛出
      if (i < attempts - 1) {
        console.warn(`[api] ${method} ${path} 第${i + 1}次失败(${err.name})，${RETRY_DELAY_MS}ms 后重试`);
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        continue;
      }
      throw err;
    }
    clearTimeout(timer);
    let data = null;
    try { data = await res.json(); } catch { /* ignore */ }
    if (res.status === 401) {
      console.warn(`[api] 401: ${method} ${path} token存在=${!!Auth.token} 响应=${data?.error || '(无body)'}`);
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
}
