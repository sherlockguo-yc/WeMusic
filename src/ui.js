// ---------------- 通用 UI：右键菜单、换源、喜欢、弹幕 ----------------
import { $, esc, fmtDur, fmtPlay, toast, fetchBlockedList, blockedSectionHtml, bindBlockedSection, saveBlockedMeta, BROKEN_HEART_OUTLINE, BROKEN_HEART_FILLED, CACHE_ICON } from './utils.js';
import { api, Auth } from './api.js';
import { state } from './state.js';

// ---- 右键菜单 ----
export function closeCtxMenu() { $('ctxMenu').classList.remove('show'); }
document.addEventListener('click', closeCtxMenu);
document.addEventListener('scroll', closeCtxMenu, true);

export function openSongMenu(evt, songs, i, context, playlistId, row) {
  const song = songs[i]; if (!song) return;
  const menu = $('ctxMenu');
  const inPlaylist = context === 'playlist';
  const items = [
    { label: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg> 下一首播放', act: 'enqueue' },
    { sep: true },
    { label: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg> 添加到歌单', act: 'add' },
    { label: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg> 分享', act: 'share', dim: !song.song_mid, dimTip: '该歌曲不支持分享' },
    { sep: true },
    { label: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> 复制 Bilibili 链接', act: 'copy', dim: !song.bvid, dimTip: '请先播放一次以匹配资源' },
    { label: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg> 在 Bilibili 搜索此歌', act: 'search' },
    { sep: true },
    { label: CACHE_ICON + ' 缓存到本地', act: 'cacheoffline', dim: !song.bvid, dimTip: '请先播放一次以匹配资源' },
  ];
  if (inPlaylist) items.push({ sep: true }, { label: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> 从歌单移除', act: 'del', danger: true });
  menu.innerHTML = items.map((it) =>
    it.sep ? '<div class="ctx-sep"></div>'
    : `<div class="ctx-item${it.danger ? ' danger' : ''}${it.dim ? ' dim' : ''}" data-act="${it.act}"${it.dimTip ? ` data-dim-tip="${esc(it.dimTip)}"` : ''}>${it.label}</div>`
  ).join('');
  menu.classList.add('show');
  const mw = menu.offsetWidth || 170, mh = menu.offsetHeight || 200;
  let x = evt.clientX, y = evt.clientY;
  if (x + mw > window.innerWidth) x = window.innerWidth - mw - 8;
  if (y + mh > window.innerHeight) y = window.innerHeight - mh - 8;
  menu.style.left = x + 'px'; menu.style.top = y + 'px';

  menu.querySelectorAll('.ctx-item').forEach((el) => {
    el.onclick = async (e) => {
      e.stopPropagation();
      if (el.classList.contains('dim')) { closeCtxMenu(); toast(el.dataset.dimTip || '暂不可用'); return; }
      closeCtxMenu();
      const act = el.dataset.act;
      if (act === 'enqueue') import('./queue.js').then(({ enqueueNext }) => enqueueNext(song));
      else if (act === 'add') import('./playlist-ui.js').then(({ addSongs }) => addSongs([song]));
      else if (act === 'share') import('./share.js').then(({ openShareModal }) => openShareModal(song));
      else if (act === 'del') import('./playlist-ui.js').then(({ deleteSong }) => deleteSong(playlistId, song.id, row));
      else if (act === 'copy') copyBiliLink(song);
      else if (act === 'search') {
        const kw = `${song.name} ${(song.singer || '').split('/')[0]}`.trim();
        window.open(`https://search.bilibili.com/all?keyword=${encodeURIComponent(kw)}`, '_blank');
      }
      else if (act === 'cacheoffline') {
        import('./offlineCache.js').then(({ fetchAndStore }) => {
          toast('正在缓存到本地…');
          fetchAndStore(song.bvid, Auth.token, { pinned: true, videoSource: { bvid: song.bvid }, lyrics: null, song: { name: song.name, singer: song.singer } })
            .then(() => { toast('已缓存到本地'); window.dispatchEvent(new CustomEvent('offline_cache_changed')); })
            .catch(e => toast('缓存失败：' + e.message));
        });
      }
    };
  });
}

async function copyBiliLink(song) {
  if (!song.bvid) return toast('该歌曲尚未匹配资源，先播放一次');
  const link = `https://www.bilibili.com/video/${song.bvid}`;
  try { await navigator.clipboard.writeText(link); toast('已复制 Bilibili 链接'); }
  catch {
    const ta = document.createElement('textarea');
    ta.value = link; ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('已复制 Bilibili 链接'); } catch { toast('复制失败：' + link); }
    ta.remove();
  }
}

// ---- 换源 ----
export async function openCandModal() {
  if (!state.current) return toast('请先播放一首歌曲');
  const modal = $('candModal');
  const list = $('candList');
  const debugPanel = $('candDebug');

  // 视频源模式：显示 tabs
  const tabsEl = modal.querySelector('.cand-tabs');
  tabsEl.style.display = 'flex';
  setActiveTab('candidates');

  modal.classList.add('show');
  let candidates = state.current._candidates;
  if (!candidates) {
    list.innerHTML = '<div class="loading">搜索中…</div>';
    try {
      const name = state.current.name;
      const singer = (state.current.singer || '').split('/')[0];
      const params = new URLSearchParams({ keyword: `${name} ${singer}`, name, singer });
      const r = await api(`/play/search?${params.toString()}`);
      candidates = r.candidates; state.current._candidates = candidates;
      if (r._debug) state.current._debug = r._debug;
    } catch (e) { list.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  }

  // 确保当前播放的 bvid 始终在候选列表中（防止搜索漏召，如分享链接预设了 bvid）
  const currentBvid = state.current.bvid || '';
  if (currentBvid && !candidates.some(c => c.bvid === currentBvid)) {
    try {
      const info = await api(`/play/video?bvid=${encodeURIComponent(currentBvid)}`);
      if (info) {
        info._fetched = true; // 标记为单独补查的，便于后续排查
        candidates = [info, ...candidates];
      }
    } catch { /* 静默：搜不到比完全没有好 */ }
  }

  const songKey = `${state.current.name}__${state.current.singer || ''}`;

  // 拉取用户已屏蔽的源（含 metadata）
  const blockedList = await fetchBlockedList(api, songKey, 'video');
  list.innerHTML = candidates.map((c, i) => {
    const isCurrent = c.bvid && c.bvid === currentBvid;
    return `
    <div class="cand-row ${c.live ? 'live' : ''}${isCurrent ? ' current' : ''}" data-bvid="${esc(c.bvid)}" data-i="${i}">
      <span class="cand-rank">${i + 1}</span>
      <div class="ct">
        <div class="title">${esc(c.title)}</div>
        <div class="meta">UP：${esc(c.author)} · ${fmtPlay(c.play)} 播放 · ${fmtDur(c.duration)}</div>
      </div>
      <span class="tag ${c.live ? 'live' : ''}${isCurrent ? ' current' : ''}">${isCurrent ? '当前' : (c.live ? '现场' : '推荐')}</span>
      <button class="cand-block-btn" title="屏蔽此视频源，以后不再出现"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>`;
  }).join('') + blockedSectionHtml(blockedList, 'cand');

  // 辅助：按 bvid 从 candidates 查找（替代不稳定数组下标）
  const findByBvid = (bvid) => candidates.find(c => c.bvid === bvid);

  list.querySelectorAll('.cand-row').forEach((row) => {
    row.onclick = () => {
      const c = findByBvid(row.dataset.bvid);
      if (!c) return;
      const oldBvid = currentBvid;
      state.current.bvid = c.bvid; state.current._biliTitle = c.title;
      state.current._biliDur = c.duration || state.current.duration;
      // 钉住随源迁移：旧源已钉住则释放并钉住新源
      if (oldBvid && oldBvid !== c.bvid) {
        import('./offlineCache.js').then(({ migratePin }) => migratePin(oldBvid, c.bvid, Auth.token, { name: state.current.name, singer: state.current.singer }).catch(() => {}));
      }
      import('./player.js').then(({ cacheBvid, resetProgress, startVideo }) => {
        cacheBvid(state.current);
        resetProgress(state.current._biliDur);
        startVideo(c.bvid, c.title, state.current._biliDur);
      });
      modal.classList.remove('show');
    };
    // 屏蔽按钮
    row.querySelector('.cand-block-btn').onclick = async (e) => {
      e.stopPropagation();
      const targetBvid = row.dataset.bvid;
      const c = findByBvid(targetBvid);
      if (!c) return;
      try {
        await api('/stats/blocked', { method: 'POST', body: {
          song: songKey, type: 'video', sourceId: c.bvid,
          name: c.title, artist: c.author, sourceLabel: 'B站',
        } });
        saveBlockedMeta(c.bvid, { name: c.title, artist: c.author, source: 'bili' });
        candidates = candidates.filter(c => c.bvid !== targetBvid);
        state.current._candidates = candidates;
        row.remove();
        // 立即刷新底部「已屏蔽的源」区域
        const oldBlocked = list.querySelector('.cand-blocked-section');
        if (oldBlocked) oldBlocked.remove();
        const newBlocked = await fetchBlockedList(api, songKey, 'video');
        list.insertAdjacentHTML('beforeend', blockedSectionHtml(newBlocked, 'cand'));
        bindBlockedSection(list, api, songKey, 'video', 'cand');
        toast('已屏蔽，刷新后不再出现');
      } catch (err) { toast('屏蔽失败：' + err.message); }
    };
  });

  // 已屏蔽列表事件（折叠/恢复）
  bindBlockedSection(list, api, songKey, 'video', 'cand');

  // 渲染 debug 面板
  if (state.current._debug) {
    renderDebug(debugPanel, state.current._debug);
  } else {
    debugPanel.innerHTML = '<div class="debug-section-body" style="display:block;padding:24px;text-align:center;color:var(--text-dim)">暂无 debug 数据。播放一首歌曲后将自动获得最近一次匹配的 debug 信息。</div>';
  }

  // tab 切换
  modal.querySelectorAll('.cand-tab').forEach(tab => {
    tab.onclick = () => setActiveTab(tab.dataset.tab);
  });
}

function setActiveTab(tabName) {
  const modal = $('candModal');
  modal.querySelectorAll('.cand-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
  modal.querySelectorAll('.cand-panel').forEach(p => p.classList.toggle('active', p.id === (tabName === 'candidates' ? 'candList' : 'candDebug')));
}

function renderDebug(el, d) {
  if (!d) { el.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-dim)">无 debug 数据</div>'; return; }

  const badge = (v, cls) => `<span class="debug-badge ${cls}">${esc(String(v))}</span>`;
  // kv: 纯文本键值对（value 会被转义）
  const kv = (k, v, mono) => `<div class="debug-kv"><span class="dk">${esc(k)}</span><span class="dv${mono ? ' mono' : ''}">${esc(String(v))}</span></div>`;
  // kvHtml: value 是安全的 HTML（不会被转义）
  const kvHtml = (k, v, mono) => `<div class="debug-kv"><span class="dk">${esc(k)}</span><span class="dv${mono ? ' mono' : ''}">${v}</span></div>`;
  const section = (title, body, open) => `
    <div class="debug-section${open ? ' open' : ''}">
      <div class="debug-section-header"><span class="debug-arrow">▶</span>${esc(title)}</div>
      <div class="debug-section-body">${body}</div>
    </div>`;

  const fmtNum = (n) => n != null ? Number(n).toLocaleString() : '-';
  const fmtDur = (s) => s != null ? `${s}s` : '(无)';

  const sections = [];

  // 1. 输入参数
  sections.push(section('输入参数', `
    ${kv('歌名', d.input.name)}
    ${kv('歌手', d.input.singer || '(无)')}
    ${kv('时长', fmtDur(d.input.duration))}
    ${kv('singerFirst', d.input.singerFirst || '(空)')}
    ${kv('singerExtra', (d.input.singerExtra && d.input.singerExtra.length) ? d.input.singerExtra.join(', ') : '(空)')}
    ${kv('bracketCN', d.input.bracketCN || '(空)')}
  `, true));

  // 2. 搜索 query
  if (d.queries) {
    const qList = d.queries.map(q => `<div class="debug-query-row"><span class="q-text">${esc(q)}</span></div>`).join('');
    sections.push(section(`搜索 Query（${d.queries.length} 组）`, qList));
  }

  // 3. Wave 1
  if (d.wave1) {
    const rows = d.wave1.queries.map(q => `<div class="debug-query-row"><span class="q-text">${esc(q.query)}</span>${q.status === 'ok' ? badge(q.resultCount, 'info') : badge('失败', 'fail')}</div>`).join('');
    sections.push(section(`Wave 1（page=1）— 去重前 ${fmtNum(d.wave1.totalBeforeDedup)} 条，去重后 ${badge(fmtNum(d.wave1.totalAfterDedup), 'ok')} 条`, rows));
  }

  // 4. Wave 2
  if (d.wave2) {
    const rows = d.wave2.queries.map(q => `<div class="debug-query-row"><span class="q-text">${esc(q.query)}</span>${q.status === 'ok' ? badge(q.resultCount, 'info') : badge('失败', 'fail')}</div>`).join('');
    sections.push(section(`Wave 2（page=2）— 触发条件：Wave1 不足 80 条 — 去重前 ${fmtNum(d.wave2.totalBeforeDedup)} 条，累计去重后 ${badge(fmtNum(d.wave2.totalAfterDedup), 'ok')} 条`, rows));
  }

  // 5. Rank 过程
  if (d.rankDebug) {
    const rd = d.rankDebug;
    let rankBody = '';
    rankBody += kvHtml('总原始结果', badge(fmtNum(d.totalRaw), 'info'));
    rankBody += kv('歌名片段 (segs)', rd.segs.join(' | ') || '(无)');

    // 片段过滤详情
    const segLoss = rd.beforeSegFilter - rd.afterSegFilter;
    rankBody += kvHtml('片段过滤', `${fmtNum(rd.beforeSegFilter)} → ${badge(fmtNum(rd.afterSegFilter), segLoss > 0 ? 'warn' : 'ok')}（过滤掉 ${segLoss} 条不包含歌名片段的，保留 ${rd.afterSegFilter} 条）`);
    rankBody += kv('过滤规则', `歌名「${d.input.name}」拆分为片段：[${rd.segs.join(', ')}]，视频标题必须包含至少一个片段`);

    // 被保留的视频（通过片段过滤的）
    if (rd.filteredOutSamples && rd.filteredOutSamples.length) {
      const outList = rd.filteredOutSamples.map((v, i) => `<div class="debug-query-row" style="opacity:.6"><span class="q-text"><span style="color:var(--text-dim)">#${i + 1}</span> ✕ ${esc(v.title)} <span style="color:var(--text-dim)">UP:${esc(v.author)}</span></span></div>`).join('');
      rankBody += `<div class="debug-kv"><span class="dk">被过滤的 ${rd.filteredOutSamples.length} 条</span><span class="dv" style="flex-direction:column;align-items:flex-start;gap:2px">${outList}</span></div>`;
    }

    // 通过片段过滤的（保留的）
    if (rd.afterSegSamples && rd.afterSegSamples.length) {
      const inList = rd.afterSegSamples.map((v, i) => `<div class="debug-query-row"><span class="q-text"><span style="color:var(--accent)">#${i + 1}</span> ✓ ${esc(v.title)} <span style="color:var(--text-dim)">UP:${esc(v.author)}</span></span></div>`).join('');
      rankBody += `<div class="debug-kv"><span class="dk">通过的 ${rd.afterSegSamples.length} 条</span><span class="dv" style="flex-direction:column;align-items:flex-start;gap:2px">${inList}</span></div>`;
    }
    rankBody += kvHtml('进入歌手筛选', `${badge(fmtNum(rd.afterSegFilter), 'ok')} 条`);

    // 歌手筛选详情
    if (rd.singerParts && rd.singerParts.length) {
      const singerLoss = rd.afterSegFilter - rd.afterSingerFilter;
      rankBody += kv('歌手拆分', `${rd.singerParts.join(' / ')}（检查视频标题或 UP 主名是否包含以上任意一个）`);
      rankBody += kvHtml('歌手筛选', rd.singerFiltered
        ? `${fmtNum(rd.afterSegFilter)} 条 → ${badge(fmtNum(rd.afterSingerFilter), 'ok')} 条匹配（过滤掉 ${singerLoss} 条不匹配歌手的）`
        : '未触发（所有候选都不匹配歌手名，保留全部进入下一轮）');

      // 匹配歌手的视频
      if (rd.singerOkSamples && rd.singerOkSamples.length) {
        const okList = rd.singerOkSamples.map((v, i) => `<div class="debug-query-row"><span class="q-text"><span style="color:var(--accent)">#${i + 1}</span> ✓ ${esc(v.title)} <span style="color:var(--text-dim)">UP:${esc(v.author)}</span></span></div>`).join('');
        rankBody += `<div class="debug-kv"><span class="dk">匹配的 ${rd.singerOkSamples.length} 条</span><span class="dv" style="flex-direction:column;align-items:flex-start;gap:2px">${okList}</span></div>`;
      }

      // 不匹配歌手的视频
      if (rd.singerNotOkSamples && rd.singerNotOkSamples.length) {
        const noList = rd.singerNotOkSamples.map((v, i) => `<div class="debug-query-row" style="opacity:.6"><span class="q-text">✕ ${esc(v.title)} <span style="color:var(--text-dim)">UP:${esc(v.author)}</span></span></div>`).join('');
        rankBody += `<div class="debug-kv"><span class="dk">不匹配的 ${rd.singerNotOkSamples.length} 条</span><span class="dv" style="flex-direction:column;align-items:flex-start;gap:2px">${noList}</span></div>`;
      }
    } else {
      rankBody += kv('歌手筛选', '未触发（singer 为空，跳过歌手过滤）');
      rankBody += kvHtml('通过歌手筛选', `${badge(fmtNum(rd.afterSingerFilter), 'ok')} 条进入下一轮`);
    }

    rankBody += kv('Live 调整', rd.nameSuggestsLive
      ? '歌名含 Live 关键词 → 取消现场惩罚 + 现场版 +30 提权'
      : '普通歌名 → 非现场版优先');
    rankBody += kvHtml('rank 后', `${badge(fmtNum(rd.scoredCount), rd.scoredCount > 0 ? 'ok' : 'warn')} 条候选`);
    sections.push(section('Rank 排序过程', rankBody, true));
  }

  // 6. Top 评分明细
  if (d.topSamples && d.topSamples.length) {
    const thead = `<tr><th>#</th><th class="col-title">标题</th><th>歌名</th><th>歌手<br>标题/UP</th><th>时长<br>(diff)</th><th>播放<br>加权</th><th>高清<br>词</th><th>官方<br>MV</th><th>优<br>质</th><th>降<br>权</th><th>UP<br>匹配</th><th>得分</th><th>现场</th></tr>`;
    const tbody = d.topSamples.map((v, i) => {
      const bd = v.breakdown || {};
      const durLabel = bd.durDiff != null ? `${bd.durDiff}s` : '-';
      const durCls = bd.durMatch > 0 ? 'pos' : (bd.durMatch < 0 ? 'neg' : '');
      return `<tr>
        <td>${i + 1}</td>
        <td class="col-title" title="${esc(v.title)}"><a href="https://www.bilibili.com/video/${esc(v.bvid || '')}" target="_blank">${esc(v.title.slice(0, 40))}</a></td>
        <td>${bd.nameMatch != null ? badge(bd.nameMatch, bd.nameMatch >= 50 ? 'ok' : 'info') : '-'}</td>
        <td>${bd.singerInTitle ? badge(bd.singerInTitle, 'ok') : (bd.singerInAuthor ? badge(bd.singerInAuthor, 'info') : '-')}</td>
        <td class="${durCls}">${durLabel}<br><small>${bd.durMatch > 0 ? '+' : ''}${bd.durMatch || 0}</small></td>
        <td>${fmtNum(v.play)}<br><small>+${bd.playWeight || 0}</small></td>
        <td>${bd.hqKw && bd.hqKw.length ? badge('+'+bd.hqBonus, 'ok') + '<br><small>' + esc(bd.hqKw.join(',')) + '</small>' : '-'}</td>
        <td>${bd.officialMV > 0 ? badge('+'+bd.officialMV, 'ok') : '-'}</td>
        <td>${bd.goodKw > 0 ? badge('+'+bd.goodKw, 'info') + (bd.goodKwList && bd.goodKwList.length ? '<br><small>' + esc(bd.goodKwList.join(',')) + '</small>' : '') : '-'}</td>
        <td>${bd.badKw && bd.badKw < 0 ? badge(bd.badKw, 'fail') + (bd.badKwList && bd.badKwList.length ? '<br><small>' + esc(bd.badKwList.join(',')) + '</small>' : '') : '-'}</td>
        <td>${bd.authorMatch > 0 ? badge('+'+bd.authorMatch, 'info') : '-'}</td>
        <td><strong>${Math.round(v.score)}</strong></td>
        <td>${v.live ? badge('是', 'warn') : '-'}</td>
      </tr>`;
    }).join('');
    sections.push(section(`Top ${d.topSamples.length} 评分明细`, `<table class="debug-score-table">${thead}${tbody}</table>`, true));
  }

  // 7. 黑名单
  if (d.blockedCount != null) {
    sections.push(section('黑名单过滤', `
      ${kvHtml('已屏蔽源数', badge(fmtNum(d.blockedCount), d.blockedCount > 0 ? 'warn' : 'ok'))}
      ${kvHtml('过滤后候选', badge(fmtNum(d.cleanCount), 'ok'))}
    `));
  }

  el.innerHTML = sections.join('');

  // 折叠/展开
  el.querySelectorAll('.debug-section-header').forEach(hdr => {
    hdr.onclick = () => hdr.parentElement.classList.toggle('open');
  });
}

// ---- 换源 ----
export async function toggleLike(song, btn) {
  if (!song.song_mid) return toast('该歌曲无 mid，无法标记喜欢');
  try {
    const r = await api(`/stats/likes/${encodeURIComponent(song.song_mid)}`, {
      method: 'POST',
      body: { name: song.name, singer: song.singer, album: song.album, album_mid: song.album_mid, duration: song.duration },
    });
    if (r.liked) {
      state.likedMids.add(song.song_mid);
      if (btn) {
        btn.classList.add('liked-active');
        const svg = btn.querySelector('svg'); if (svg) svg.setAttribute('fill', 'currentColor');
      }
      toast('已添加到喜欢');
    } else {
      state.likedMids.delete(song.song_mid);
      if (btn) {
        btn.classList.remove('liked-active');
        const svg = btn.querySelector('svg'); if (svg) svg.setAttribute('fill', 'none');
      }
      toast('已取消喜欢');
    }
    // 更新侧边栏计数
    updateLikesCount();
  } catch (e) { toast('操作失败：' + e.message); }
}

export const heartOutline = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>`;
export const heartFilled = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>`;

// ---- 不喜欢 ----
export async function toggleDislike(song, btn) {
  const songKey = `${song.name}__${song.singer || ''}`;
  try {
    const r = await api('/stats/disliked-songs', {
      method: 'POST',
      body: { song_key: songKey },
    });
    const isCurrent = state.current && `${state.current.name}__${state.current.singer || ''}` === songKey;

    if (r.disliked) {
      state.dislikedSongKeys.add(songKey);
      if (btn) {
        btn.classList.add('disliked-active');
        btn.title = '取消不喜欢';
        // 通用：更新按钮内 SVG 的 fill 和 line stroke
        updateDislikeBtnSVG(btn, true);
      }
      toast('已标记为不喜欢');
      // 如果是当前播放的歌 → 同步播放器按钮状态 + 自动切下一首
      if (isCurrent) {
        updateNpDislikeBtn();
        import('./player.js').then(({ playNext }) => playNext(false));
      }
    } else {
      state.dislikedSongKeys.delete(songKey);
      if (btn) {
        btn.classList.remove('disliked-active');
        btn.title = '不喜欢';
        updateDislikeBtnSVG(btn, false);
      }
      toast('已取消不喜欢');
      // 如果是当前播放的歌 → 同步播放器按钮状态
      if (isCurrent) updateNpDislikeBtn();
    }
  } catch (e) { toast('操作失败：' + e.message); }
}

/** 通用：更新 dislike 按钮内的 SVG — 对 player 用 innerHTML 替换，对列表行用 setAttribute */
function updateDislikeBtnSVG(btn, disliked) {
  if (btn.id === 'npDislikeBtn') {
    btn.innerHTML = disliked ? BROKEN_HEART_FILLED : BROKEN_HEART_OUTLINE;
    return;
  }
  // 列表行按钮：直接改 SVG 属性（避免重建 DOM）
  const svg = btn.querySelector('svg');
  if (!svg) return;
  svg.setAttribute('fill', disliked ? 'currentColor' : 'none');
  const line = svg.querySelector('line');
  if (line) line.setAttribute('stroke', disliked ? '#6b6b6b' : 'currentColor');
}

export function updateNpDislikeBtn() {
  const btn = $('npDislikeBtn');
  if (!btn || !state.current) return;
  const songKey = `${state.current.name}__${state.current.singer || ''}`;
  const disliked = state.dislikedSongKeys.has(songKey);
  btn.classList.toggle('disliked-active', !!disliked);
  btn.title = disliked ? '取消不喜欢' : '不喜欢';
  // 关键：切换底部播放器按钮的图标（静态 HTML 里的 fill="none" 不会自动变）
  btn.innerHTML = disliked ? BROKEN_HEART_FILLED : BROKEN_HEART_OUTLINE;
}

// 启动时从服务端加载已不喜欢的歌曲
export async function loadDislikedSongs() {
  try {
    const { disliked } = await api('/stats/disliked-songs');
    state.dislikedSongKeys = new Set(disliked);
  } catch { console.warn('加载不喜欢列表失败'); }
}

export function updateNpLikeBtn() {
  const btn = $('npLikeBtn');
  if (!btn || !state.current) return;
  const liked = state.current.song_mid && state.likedMids.has(state.current.song_mid);
  btn.innerHTML = liked ? heartFilled : heartOutline;
  btn.title = liked ? '取消喜欢' : '喜欢';
  btn.classList.toggle('liked-active', !!liked);
}

export function updateLikesCount() {
  const el = document.getElementById('navLikes');
  if (el) {
    const n = state.likedMids.size;
    el.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg> 我喜欢的${n ? `<span class="side-count">${n}</span>` : ''}`;
  }
}

export async function updateAlbumCount() {
  const el = document.getElementById('navSavedAlbums');
  if (!el) return;
  try {
    const { albums } = await api('/stats/albums');
    el.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg> 我的专辑${albums.length ? `<span class="side-count">${albums.length}</span>` : ''}`;
  } catch { console.warn('更新专辑数失败') }
}

export function initUI() {
  // 换源
  $('switchSrcBtn').onclick = openCandModal;
  $('vpSwitch').onclick = openCandModal;
  $('candClose').onclick = () => $('candModal').classList.remove('show');
  $('candModal').onclick = (e) => { if (e.target.id === 'candModal') $('candModal').classList.remove('show'); };

  // 播放器喜欢 + 不喜欢 + 三点菜单
  $('npLikeBtn').onclick = async () => {
    if (!state.current) return toast('当前没有播放的歌曲');
    await toggleLike(state.current, null);
    updateNpLikeBtn();
  };
  $('npDislikeBtn').onclick = async () => {
    if (!state.current) return toast('当前没有播放的歌曲');
    await toggleDislike(state.current, $('npDislikeBtn'));
    updateNpDislikeBtn();
  };
  $('npMoreBtn').onclick = (e) => {
    e.stopPropagation();
    if (!state.current) return toast('当前没有播放的歌曲');
    const song = state.current;
    const btn = $('npMoreBtn');
    const rect = btn.getBoundingClientRect();
    const menu = $('ctxMenu');
    menu.innerHTML = `
      <div class="ctx-item" id="ctxNpAdd"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg> 添加到歌单</div>
      ${song.song_mid ? `<div class="ctx-item" id="ctxNpShare"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg> 分享</div>` : ''}
      ${song.bvid ? `<div class="ctx-item" id="ctxNpCopy"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> 复制 Bilibili 链接</div>` : ''}
      ${song.bvid ? `<div class="ctx-item" id="ctxNpCache">${CACHE_ICON} 缓存到本地</div>` : ''}`;
    menu.style.left = Math.min(rect.left, window.innerWidth - 180) + 'px';
    menu.style.top = (rect.top - menu.offsetHeight - 4) + 'px';
    menu.classList.add('show');
    document.getElementById('ctxNpAdd').onclick = () => { menu.classList.remove('show'); import('./playlist-ui.js').then(({ addSongs }) => addSongs([song])); };
    const shareBtn = document.getElementById('ctxNpShare');
    if (shareBtn) shareBtn.onclick = () => { menu.classList.remove('show'); import('./share.js').then(({ openShareModal }) => openShareModal(song)); };
    const cpBtn = document.getElementById('ctxNpCopy');
    if (cpBtn) cpBtn.onclick = () => { menu.classList.remove('show'); copyBiliLink(song); };
    const cacheBtn = document.getElementById('ctxNpCache');
    if (cacheBtn) cacheBtn.onclick = () => {
      menu.classList.remove('show');
      import('./offlineCache.js').then(({ fetchAndStore }) => {
        toast('正在缓存到本地…');
        fetchAndStore(song.bvid, Auth.token, { pinned: true, videoSource: { bvid: song.bvid }, lyrics: null, song: { name: song.name, singer: song.singer } })
          .then(() => { toast('已缓存到本地（钉住）'); window.dispatchEvent(new CustomEvent('offline_cache_changed')); })
          .catch(e => toast('缓存失败：' + e.message));
      });
    };
    requestAnimationFrame(() => { menu.style.top = (rect.top - menu.offsetHeight - 4) + 'px'; });
  };

  // 帮助
  $('helpBtn').onclick = () => $('helpModal').classList.add('show');
  $('helpClose').onclick = () => $('helpModal').classList.remove('show');
  $('helpModal').onclick = (e) => { if (e.target.id === 'helpModal') $('helpModal').classList.remove('show'); };
}
