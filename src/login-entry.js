// 登录页入口
import { Auth, api } from './api.js';

// 已登录时：检查是否有保存的跳转 URL，恢复原来的页面
if (Auth.token) {
  const redirect = sessionStorage.getItem('wemusic_redirect');
  if (redirect) {
    sessionStorage.removeItem('wemusic_redirect');
    try {
      const url = new URL(redirect, location.origin);
      // 安全校验：跳转 URL 必须同源
      if (url.origin === location.origin) {
        location.href = url.pathname + url.search + url.hash;
      } else {
        location.href = '/';
      }
    } catch { location.href = '/'; }
  } else {
    location.href = '/';
  }
}
// 注意：未登录时继续渲染登录表单，不跳转

let mode = 'login';

const $ = (id) => document.getElementById(id);
const usernameEl = $('username');
const passwordEl = $('password');
const confirmEl  = $('confirm');
const submitBtn  = $('submitBtn');
const msgEl      = $('msg');
const formSub    = $('formSub');
const switchHint = $('switchHint');
const switchLink = $('switchLink');
const confirmField = $('confirmField');
const strengthBar  = $('strengthBar');

function render() {
  const isReg = mode === 'register';
  submitBtn.textContent = isReg ? '注册' : '登录';
  formSub.textContent   = isReg ? '创建你的个人音乐账户' : '登录你的个人音乐空间';
  switchHint.textContent = isReg ? '已有账号？' : '还没有账号？';
  switchLink.textContent = isReg ? '去登录' : '立即注册';
  confirmField.classList.toggle('show', isReg);
  passwordEl.setAttribute('autocomplete', isReg ? 'new-password' : 'current-password');
  msgEl.textContent = '';
  msgEl.className = 'msg';
  updateStrength('');
}

switchLink.onclick = () => { mode = mode === 'login' ? 'register' : 'login'; render(); };

function updateStrength(pwd) {
  if (!pwd) { strengthBar.style.width = '0'; return; }
  let score = 0;
  if (pwd.length >= 8) score++;
  if (/[A-Z]/.test(pwd)) score++;
  if (/[0-9]/.test(pwd)) score++;
  if (/[^A-Za-z0-9]/.test(pwd)) score++;
  strengthBar.style.width = ['0', '30%', '55%', '75%', '100%'][score];
  strengthBar.style.background = ['', '#e0556a', '#e08050', '#d4a017', '#2ab758'][score];
}
passwordEl.addEventListener('input', () => { if (mode === 'register') updateStrength(passwordEl.value); });

async function submit() {
  const username = usernameEl.value.trim();
  const password = passwordEl.value;
  if (!username || !password) { show('请输入用户名和密码', 'error'); return; }
  if (mode === 'register') {
    if (password.length < 8) { show('密码至少 8 位', 'error'); return; }
    if (confirmEl.value && confirmEl.value !== password) {
      show('两次输入的密码不一致', 'error'); confirmEl.value = ''; confirmEl.focus(); return;
    }
  }
  submitBtn.disabled = true;
  try {
    const data = await api(`/auth/${mode}`, { method: 'POST', body: { username, password }, auth: false });
    Auth.save(data.token, data.user);
    // 登录成功后恢复到之前保存的页面（如分享链接、搜索结果等）
    const redirect = sessionStorage.getItem('wemusic_redirect');
    if (redirect) {
      sessionStorage.removeItem('wemusic_redirect');
      try {
        const url = new URL(redirect, location.origin);
        if (url.origin === location.origin) {
          location.href = url.pathname + url.search + url.hash;
          return;
        }
      } catch { /* fall through to default redirect */ }
    }
    location.href = '/';
  } catch (e) {
    show(e.message, 'error');
    passwordEl.value = ''; if (confirmEl) confirmEl.value = '';
    updateStrength(''); passwordEl.focus();
  } finally { submitBtn.disabled = false; }
}

function show(msg, type = '') { msgEl.textContent = msg; msgEl.className = 'msg' + (type ? ' ' + type : ''); }

submitBtn.onclick = submit;
passwordEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { if (mode === 'register' && !confirmEl.value) { confirmEl.focus(); return; } submit(); }
});
usernameEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') passwordEl.focus(); });
if (confirmEl) confirmEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

render();
