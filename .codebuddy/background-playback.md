# WeMusic 后台播放机制

> 本文档详细描述后台播放的架构、状态流转、已知问题及修复历史。  
> 修改 `src/player.js` 中 `_bg*` 相关代码前**必须阅读本文档**。

---

## 一、架构概览

WeMusic 通过两种不同的播放路径支持前台/后台无缝切换：

| 模式 | 载体 | 说明 |
|------|------|------|
| 前台 | B 站 `<iframe>` | 完整的视频播放器，用户可交互 |
| 后台 | `<audio>` 元素（id=audio） | 仅音频流，通过服务端代理 `/api/play/stream?bvid=...` 获取 |

切换核心：`visibilitychange` 事件 → 前台销毁 iframe + bgAudio 接管 / 后台停 bgAudio + iframe 重建。

---

## 二、核心状态变量

```js
const bgAudio = document.getElementById('audio'); // <audio id="audio">

let _bgBvid = null;          // bgAudio 当前加载的 bvid
let _bgPlaying = false;      // bgAudio 是否在有声播放（非静音 preload）
let _pendingMount = null;    // { bvid, title } 回前台待挂载的 iframe 信息
let _bgVolume = 0.8;         // 独立音量 0~1

let _bgSyncTimer = null;     // 后台进度同步 setInterval ID
let _bgHealthCheckId = null; // play() 成功后 5s 健康检查 setTimeout ID
```

---

## 三、后台播放完整流程

### 3.1 初次切到后台

```
用户切标签页
  ↓
visibilitychange (document.hidden = true)
  ↓
if (_bgBvid !== state.current.bvid)
    _bgPreload(state.current.bvid)   // 设置 src + load（静音）
  ↓
$('videoContainer').innerHTML = ''  // 销毁 iframe
  ↓
_bgUnmuteAndPlay(elapsed)            // 解除静音 + play()（最多 10 次递增重试）
  ↓
_startBgSync()                       // 每 4s 校准进度 + 健康检查
```

### 3.2 后台自动切歌（歌曲播完 → 下一首）

```
bgAudio 'ended' 事件触发  ← 最可靠，不受 Chrome 节流影响
  ↓
_bgPlaying = false
  ↓
autoAdvance()
  → stopTimer()
  → playNext(true)
      → playCurrent()
          → startVideo(newBvid, newTitle, newDur)
  ↓
startVideo 后台分支：
  _bgBvid = null              // 强制重新 preload
  _bgPreload(newBvid)         // 换 src + load（静音）
  _bgUnmuteAndPlay(0)         // 解除静音 + play()
  _pendingMount = { ... }     // 记录回前台信息
```

### 3.3 切回前台

```
visibilitychange (document.hidden = false)
  ↓
_stopBgSync()
  ↓
用 bgAudio.currentTime 校正 elapsed
  ↓
mountVideoAt(bvid, title, elapsed)  // 重建 iframe，带时间戳
  ↓
交叉过渡：收到 B 站 postMessage 或 800ms 兜底后 _bgStop()
```

---

## 四、三层健壮性防护

### 第一层：`_bgUnmuteAndPlay` 的 play() 重试

- 最多 10 次，间隔递增 500ms → 3s
- 新歌（seekSec < 2）等 `canplay` 事件再播，避免数据未就绪

### 第二层：play() 成功后 5 秒健康检查

- 如果 `_bgPlaying && bgAudio.paused && !timerPaused`，重新 `doPlay()`
- timer ID 存储为 `_bgHealthCheckId`，在 `_bgStop()` 中清除

### 第三层：`_bgSyncTimer` 每 4 秒巡检

- `_bgPlaying && bgAudio.paused && !timerPaused` → `bgAudio.play()`
- 校准 elapsed（偏差 ≥ 2s 修正）
- 兜底切歌（elapsed >= totalDur - 1）

---

## 五、已知缺陷 & 待修复

### 5.1 bgAudio 未监听 `error` / `stalled` 事件

**影响**：服务端音频流代理（`/api/play/stream`）连接断开时，`<audio>` 元素会触发 `error` 或 `stalled` 事件，但当前代码未监听这些事件。bgAudio 可能在 `_bgPlaying=true` 的情况下变为 paused 状态，且 bgAudio.currentTime 停止推进。

- `_bgSyncTimer` 能检测到 `bgAudio.paused` 并尝试 `play()`，但如果流已经断开，`play()` 只会再次失败。
- 没有机制重新加载流（重新设置 `src`）。

**状态**：2026-07-02 已有日志埋点，错误恢复逻辑待加。

### 5.2 bgAudio 后台长时间运行后浏览器可能冻结标签页

Chrome 的 "Intensive Wake Up Throttling" 在标签页长时间不可见后可能：
- 将 `setInterval` 频率降到 1 分钟一次 → `_bgSyncTimer` 检查间隔被拉伸
- 完全冻结 JavaScript 执行 → `_bgSyncTimer` 不再运行
- 释放音频缓冲区

`ended` 事件是最后防线，但如果音频流在播完前就断了（非正常 ended），不会有 `ended` 事件。

### 5.3 恢复策略不够激进

当前 `_bgSyncTimer` 中恢复 play() 失败后只 catch 忽略，没有重试机制（不同于 `_bgUnmuteAndPlay` 的 10 次重试）。如果流断了需要重新 `load()` 而非仅 `play()`。

---

## 六、修复历史

| 日期 | 改动 | 解决问题 |
|------|------|----------|
| 首次 | bgAudio 接管 + ended 自动切歌 | 基础后台播放 |
| ~2026-06 | _bgSyncTimer 校准进度 | setInterval 后台节流导致进度漂移 |
| 2026-07-02 (1) | 10 次递增重试 + canplay 等待 | play() 单次失败后恢复 |
| 2026-07-02 (2) | 5s 健康检查 + _bgSyncTimer 恢复 | 播放途中意外暂停 |
| 2026-07-02 (3) | _bgStop 清除 _bgHealthCheckId | 健康检查 timer 泄漏 |

---

## 七、调试日志

服务端查看：`grep '\[bg' /tmp/wemusic.log`

日志前缀：
- `[bgAudio]` — bgAudio 元素状态变化
- `[bgSync]` — _bgSyncTimer 巡检
- `[bg:state]` — 状态变量变更
- `[bg:retry]` — play() 重试详情
- `[bg:stream]` — 音频流相关

---

> 最后更新：2026-07-02
