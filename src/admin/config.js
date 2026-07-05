// 系统配置 Tab（功能开关 + 注册控制）—— 开关按钮，点击即生效
import { api } from '../api.js';
import { esc, toast } from '../utils.js';

const KEYS = [
  { id: 'cfgAllowRegister', key: 'allowRegister', label: '允许注册' },
  { id: 'cfgDiscover', key: 'discoverEnabled', label: '发现页' },
  { id: 'cfgSearch', key: 'searchEnabled', label: '搜索' },
  { id: 'cfgStats', key: 'statsEnabled', label: '数据统计' },
  { id: 'cfgLikes', key: 'likesEnabled', label: '喜欢/红心' },
];

export async function renderConfig(container) {
  container.innerHTML = '<div class="loading">加载中...</div>';

  try {
    const saved = await api('/admin/config');

    container.innerHTML = `
      <div class="admin-section">
        <h2 class="admin-section-title">系统配置</h2>
        <p class="admin-hint">点击开关即生效，无需额外操作。</p>

        <div class="admin-config-group">
          ${KEYS.map(({ id, key, label }) => {
            const on = saved[key] !== false;
            return `
              <div class="admin-toggle-row">
                <span class="admin-toggle-label">${label}</span>
                <div class="admin-toggle-right">
                  <label class="toggle-switch" id="${id}Switch">
                    <input type="checkbox" id="${id}" ${on ? 'checked' : ''}>
                    <span class="toggle-track"></span>
                  </label>
                  <span class="config-status" id="${id}Status"></span>
                </div>
              </div>`;
          }).join('')}
        </div>
      </div>
    `;

    // 绑定自动保存
    KEYS.forEach(({ id, key }) => {
      const checkbox = container.querySelector(`#${id}`);
      const switchEl = container.querySelector(`#${id}Switch`);
      const status = container.querySelector(`#${id}Status`);
      if (!checkbox) return;

      let prevChecked = checkbox.checked;

      // 点击整行区域（含开关）触发切换
      switchEl.onclick = async (e) => {
        // 让浏览器先完成 checkbox 的勾选变化
        await new Promise((r) => setTimeout(r, 0));
        const nowChecked = checkbox.checked;

        if (nowChecked === prevChecked) return; // 没变化

        status.textContent = '保存中…';
        status.className = 'config-status saving';

        try {
          await api(`/admin/config/${key}`, { method: 'PUT', body: { value: nowChecked } });
          prevChecked = nowChecked;
          status.textContent = '✓';
          status.className = 'config-status saved';
          setTimeout(() => {
            if (status.className === 'config-status saved') { status.textContent = ''; status.className = 'config-status'; }
          }, 2000);
        } catch (e) {
          checkbox.checked = prevChecked;
          status.textContent = '失败';
          status.className = 'config-status error';
          toast(e.message || '保存失败，已恢复');
          setTimeout(() => { status.textContent = ''; status.className = 'config-status'; }, 3000);
        }
      };
    });
  } catch (e) {
    container.innerHTML = `<div class="empty">加载失败：${esc(e.message)}</div>`;
  }
}
