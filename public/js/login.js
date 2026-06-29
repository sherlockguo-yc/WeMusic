// 已登录则直接进入主页
if (Auth.token) location.href = '/';

let mode = 'login'; // 'login' | 'register'

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

// 首次访问（或从未有账号）→ 默认显示注册
api('/auth/me', { auth: false }).catch(() => {}).then((d) => {
  // 若后端返回 401 不做任何事（已在跳转处理）
});
// 用 /api/health 无法得知是否有用户，只有注册提示是否显示由 ALLOW_REGISTER 控制
// 如果先前本地储存过 token 但已过期，用户到了登录页，不自动跳注册

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

switchLink.onclick = () => {
  mode = mode === 'login' ? 'register' : 'login';
  render();
};

// 密码强度提示
function updateStrength(pwd) {
  const bar = strengthBar;
  if (!pwd) { bar.style.width = '0'; return; }
  let score = 0;
  if (pwd.length >= 8) score++;
  if (/[A-Z]/.test(pwd)) score++;
  if (/[0-9]/.test(pwd)) score++;
  if (/[^A-Za-z0-9]/.test(pwd)) score++;
  const widths = ['0', '30%', '55%', '75%', '100%'];
  const colors = ['', '#e0556a', '#e08050', '#d4a017', '#1db954'];
  bar.style.width = widths[score];
  bar.style.background = colors[score];
}
passwordEl.addEventListener('input', () => {
  if (mode === 'register') updateStrength(passwordEl.value);
});

async function submit() {
  const username = usernameEl.value.trim();
  const password = passwordEl.value;
  if (!username || !password) {
    show('请输入用户名和密码', 'error');
    return;
  }
  if (mode === 'register') {
    if (password.length < 4) { show('密码至少 4 位', 'error'); return; }
    if (confirmEl.value && confirmEl.value !== password) {
      show('两次输入的密码不一致', 'error');
      confirmEl.value = '';
      confirmEl.focus();
      return;
    }
  }
  submitBtn.disabled = true;
  try {
    const data = await api(`/auth/${mode}`, {
      method: 'POST',
      body: { username, password },
      auth: false,
    });
    Auth.save(data.token, data.user);
    location.href = '/';
  } catch (e) {
    show(e.message, 'error');
    passwordEl.value = '';
    if (confirmEl) confirmEl.value = '';
    updateStrength('');
    passwordEl.focus();
  } finally {
    submitBtn.disabled = false;
  }
}

function show(msg, type = '') {
  msgEl.textContent = msg;
  msgEl.className = 'msg' + (type ? ' ' + type : '');
}

submitBtn.onclick = submit;
passwordEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    if (mode === 'register' && !confirmEl.value) { confirmEl.focus(); return; }
    submit();
  }
});
usernameEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') passwordEl.focus(); });
confirmEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

render();
