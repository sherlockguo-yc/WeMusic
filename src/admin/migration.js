/**
 * 数据迁移 Tab（管理员专属）
 * 功能：按用户导出数据 / 导入用户数据 / 导出/导入系统配置
 */
import { api } from '../api.js';
import { esc, toast, uiConfirm, fmtTime } from '../utils.js';

export async function renderMigration(container) {
  container.innerHTML = `
    <div class="admin-section">
      <h2 class="admin-section-title">数据迁移</h2>
      <p class="admin-hint">导出用户数据用于迁移到其他服务器。导入操作会创建新用户（含全套数据）。</p>

      <!-- 导出区域 -->
      <div class="migration-card">
        <h3 class="migration-card-title">导出用户数据</h3>
        <div class="migration-user-list" id="migrationUserList">
          <div class="loading">加载中...</div>
        </div>
      </div>

      <!-- 导入区域 -->
      <div class="migration-card">
        <h3 class="migration-card-title">导入用户数据</h3>
        <p class="admin-hint">选择从其他 WeMusic 导出的 JSON 文件，导入用户及其全部数据。</p>
        <div class="migration-upload" id="migrationUpload">
          <div class="migration-drop-zone" id="migrationDropZone">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            <p>拖拽 JSON 文件到此处，或点击选择</p>
            <input type="file" accept=".json" id="migrationFileInput" style="display:none">
          </div>
        </div>
        <div class="migration-preview" id="migrationPreview" style="display:none"></div>
        <div class="migration-result" id="migrationResult" style="display:none"></div>
      </div>

      <!-- 系统配置区域 -->
      <div class="migration-card">
        <h3 class="migration-card-title">系统配置</h3>
        <div class="migration-config-actions">
          <button class="btn sm" id="migrationExportConfig">导出系统配置</button>
          <button class="btn sm" id="migrationImportConfigBtn">导入系统配置</button>
          <input type="file" accept=".json" id="migrationConfigFileInput" style="display:none">
        </div>
        <div class="migration-result" id="migrationConfigResult" style="display:none"></div>
      </div>
    </div>
  `;

  // 加载用户列表
  loadUserList();

  // 绑定导出系统配置
  container.querySelector('#migrationExportConfig').onclick = exportConfig;

  // 绑定导入系统配置
  const configFileInput = container.querySelector('#migrationConfigFileInput');
  container.querySelector('#migrationImportConfigBtn').onclick = () => configFileInput.click();
  configFileInput.onchange = (e) => {
    const file = e.target.files[0];
    if (file) importConfig(file);
    configFileInput.value = '';
  };

  // 绑定用户数据导入：文件选择 + 拖拽
  const fileInput = container.querySelector('#migrationFileInput');
  const dropZone = container.querySelector('#migrationDropZone');
  dropZone.onclick = () => fileInput.click();
  fileInput.onchange = (e) => {
    const file = e.target.files[0];
    if (file) handleImportFile(file);
    fileInput.value = '';
  };

  dropZone.ondragover = (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); };
  dropZone.ondragleave = () => dropZone.classList.remove('drag-over');
  dropZone.ondrop = (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleImportFile(file);
  };
}

// ============================================================
// 加载可导出的用户列表
// ============================================================
async function loadUserList() {
  const list = document.getElementById('migrationUserList');
  if (!list) return;
  try {
    const { users } = await api('/migration/users');
    if (!users || users.length === 0) {
      list.innerHTML = '<div class="empty">暂无用户</div>';
      return;
    }
    list.innerHTML = `
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead><tr>
            <th>用户名</th>
            <th>角色</th>
            <th>歌单</th>
            <th>播放记录</th>
            <th>注册时间</th>
            <th>操作</th>
          </tr></thead>
          <tbody>
            ${users.map((u) => `
              <tr>
                <td><strong>${esc(u.username)}</strong></td>
                <td><span class="admin-b-tag">${esc(u.role)}</span></td>
                <td>${u.playlist_count}</td>
                <td>${u.log_count}</td>
                <td>${fmtTime(u.created_at)}</td>
                <td><button class="btn sm migration-export-btn" data-uid="${u.id}" data-uname="${esc(u.username)}">导出</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;

    list.querySelectorAll('.migration-export-btn').forEach((btn) => {
      btn.onclick = () => exportUser(Number(btn.dataset.uid), btn.dataset.uname);
    });
  } catch (e) {
    list.innerHTML = `<div class="empty">加载失败：${esc(e.message)}</div>`;
  }
}

// ============================================================
// 导出用户
// ============================================================
async function exportUser(userId, username) {
  try {
    toast('正在导出...');
    const res = await fetch(`/api/migration/export/${userId}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('wemusic_token')}` },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: '导出失败' }));
      throw new Error(err.error || `导出失败 (${res.status})`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wemusic-${username}-export.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('导出成功');
  } catch (e) {
    toast(e.message || '导出失败');
  }
}

// ============================================================
// 导出系统配置
// ============================================================
async function exportConfig() {
  try {
    toast('正在导出...');
    const res = await fetch('/api/migration/export-config', {
      headers: { Authorization: `Bearer ${localStorage.getItem('wemusic_token')}` },
    });
    if (!res.ok) throw new Error('导出失败');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'wemusic-config-export.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('导出成功');
  } catch (e) {
    toast(e.message || '导出失败');
  }
}

// ============================================================
// 导入用户数据处理
// ============================================================
async function handleImportFile(file) {
  const preview = document.getElementById('migrationPreview');
  const result = document.getElementById('migrationResult');
  if (!preview || !result) return;

  result.style.display = 'none';

  // 读取并解析 JSON
  let data;
  try {
    const text = await file.text();
    data = JSON.parse(text);
  } catch {
    preview.innerHTML = '<div class="empty error">文件格式错误，无法解析 JSON</div>';
    preview.style.display = 'block';
    return;
  }

  if (data.version !== 1 || !data.user) {
    preview.innerHTML = '<div class="empty error">无效的导出文件格式</div>';
    preview.style.display = 'block';
    return;
  }

  // 显示预览摘要
  const pls = data.playlists || [];
  const songs = pls.reduce((s, pl) => s + (pl.songs || []).length, 0);
  const likes = data.likes || [];
  const logs = data.play_logs || [];
  const albums = data.saved_albums || [];
  const blocked = data.blocked_sources || [];
  const fb = data.feedback || [];

  preview.innerHTML = `
    <div class="migration-summary">
      <h4>预览：${esc(data.user.username)}</h4>
      <div class="migration-summary-grid">
        <div class="admin-stat-item"><strong>${pls.length}</strong> 歌单</div>
        <div class="admin-stat-item"><strong>${songs}</strong> 歌曲</div>
        <div class="admin-stat-item"><strong>${likes.length}</strong> 红心</div>
        <div class="admin-stat-item"><strong>${logs.length}</strong> 播放记录</div>
        <div class="admin-stat-item"><strong>${albums.length}</strong> 收藏专辑</div>
        <div class="admin-stat-item"><strong>${blocked.length}</strong> 屏蔽源</div>
        <div class="admin-stat-item"><strong>${fb.length}</strong> 反馈</div>
      </div>
      <div class="migration-actions">
        <button class="btn green" id="migrationConfirmImport">确认导入</button>
        <button class="btn" id="migrationCancelImport">取消</button>
      </div>
    </div>
  `;
  preview.style.display = 'block';

  document.getElementById('migrationCancelImport').onclick = () => {
    preview.style.display = 'none';
  };

  document.getElementById('migrationConfirmImport').onclick = async () => {
    preview.style.display = 'none';

    const confirmed = await uiConfirm(`确认导入用户 "${data.user.username}" 的全部数据？此操作不可撤销。`);
    if (!confirmed) return;

    try {
      const res = await api('/migration/import', {
        method: 'POST',
        body: data,
      });
      result.innerHTML = `
        <div class="migration-success">
          <p>导入成功！用户 ID: ${res.userId}</p>
          <div class="migration-summary-grid">
            <div class="admin-stat-item"><strong>${res.summary.playlists}</strong> 歌单</div>
            <div class="admin-stat-item"><strong>${res.summary.songs}</strong> 歌曲</div>
            <div class="admin-stat-item"><strong>${res.summary.likes}</strong> 红心</div>
            <div class="admin-stat-item"><strong>${res.summary.play_logs}</strong> 播放记录</div>
            <div class="admin-stat-item"><strong>${res.summary.saved_albums}</strong> 收藏专辑</div>
          </div>
        </div>
      `;
      result.style.display = 'block';
      loadUserList(); // 刷新用户列表
    } catch (e) {
      result.innerHTML = `<div class="empty error">导入失败：${esc(e.message)}</div>`;
      result.style.display = 'block';
    }
  };
}

// ============================================================
// 导入系统配置
// ============================================================
async function importConfig(file) {
  const result = document.getElementById('migrationConfigResult');
  if (!result) return;

  let data;
  try {
    const text = await file.text();
    data = JSON.parse(text);
  } catch {
    result.innerHTML = '<div class="empty error">文件格式错误</div>';
    result.style.display = 'block';
    return;
  }

  if (data.type !== 'system_config' || !data.config) {
    result.innerHTML = '<div class="empty error">无效的配置文件格式</div>';
    result.style.display = 'block';
    return;
  }

  const keys = Object.keys(data.config);
  const confirmed = await uiConfirm(`确认导入 ${keys.length} 项系统配置？`);
  if (!confirmed) return;

  try {
    const res = await api('/migration/import-config', {
      method: 'POST',
      body: data,
    });
    result.innerHTML = `<div class="migration-success"><p>配置导入成功，共 ${res.count} 项</p></div>`;
    result.style.display = 'block';
  } catch (e) {
    result.innerHTML = `<div class="empty error">导入失败：${esc(e.message)}</div>`;
    result.style.display = 'block';
  }
}
