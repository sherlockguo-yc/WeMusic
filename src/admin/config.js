// 系统配置 Tab（功能开关 + 注册控制）
import { api } from '../api.js';
import { esc, toast } from '../utils.js';

export async function renderConfig(container, role) {
  container.innerHTML = '<div class="loading">加载中...</div>';

  try {
    const config = await api('/admin/config');

    container.innerHTML = `
      <div class="admin-section">
        <h2 class="admin-section-title">系统配置</h2>

        <div class="admin-config-group">
          <h3>注册控制</h3>
          <div class="admin-config-row">
            <label>允许注册</label>
            <select id="cfgAllowRegister">
              <option value="true" ${config.allowRegister !== false ? 'selected' : ''}>开启</option>
              <option value="false" ${config.allowRegister === false ? 'selected' : ''}>关闭</option>
            </select>
            <button class="btn sm green" data-save="allowRegister">保存</button>
          </div>
        </div>

        <div class="admin-config-group">
          <h3>功能开关</h3>
          <p class="admin-hint">运行时启用/禁用各个功能模块，无需重启服务。</p>
          <div class="admin-config-row">
            <label>发现页</label>
            <select id="cfgDiscover">
              <option value="true" ${config.discoverEnabled !== false ? 'selected' : ''}>开启</option>
              <option value="false" ${config.discoverEnabled === false ? 'selected' : ''}>关闭</option>
            </select>
            <button class="btn sm green" data-save="discoverEnabled">保存</button>
          </div>
          <div class="admin-config-row">
            <label>搜索</label>
            <select id="cfgSearch">
              <option value="true" ${config.searchEnabled !== false ? 'selected' : ''}>开启</option>
              <option value="false" ${config.searchEnabled === false ? 'selected' : ''}>关闭</option>
            </select>
            <button class="btn sm green" data-save="searchEnabled">保存</button>
          </div>
          <div class="admin-config-row">
            <label>数据统计</label>
            <select id="cfgStats">
              <option value="true" ${config.statsEnabled !== false ? 'selected' : ''}>开启</option>
              <option value="false" ${config.statsEnabled === false ? 'selected' : ''}>关闭</option>
            </select>
            <button class="btn sm green" data-save="statsEnabled">保存</button>
          </div>
          <div class="admin-config-row">
            <label>喜欢/红心</label>
            <select id="cfgLikes">
              <option value="true" ${config.likesEnabled !== false ? 'selected' : ''}>开启</option>
              <option value="false" ${config.likesEnabled === false ? 'selected' : ''}>关闭</option>
            </select>
            <button class="btn sm green" data-save="likesEnabled">保存</button>
          </div>
        </div>
      </div>
    `;

    container.querySelectorAll('[data-save]').forEach((btn) => {
      btn.onclick = async () => {
        const key = btn.dataset.save;
        const select = container.querySelector(`#cfg${key.charAt(0).toUpperCase() + key.slice(1)}`);
        const value = select.value === 'true';
        await api(`/admin/config/${key}`, { method: 'PUT', body: { value } });
        toast('已保存');
      };
    });
  } catch (e) {
    container.innerHTML = `<div class="empty">加载失败：${esc(e.message)}</div>`;
  }
}
