# WeMusic 后台播放

> 最后更新：2026-06-30

---

## 目标

切到后台（Chrome 其他标签激活时），计时器切歌后新歌立即有声音，无需切回前台。

---

## 关键事实

| 事实 | 说明 |
|------|------|
| iframe 后台继续播 | 已在播的 B 站 iframe 切后台后不会停 |
| **新建** iframe autoplay 失败 | `document.hidden=true` 时创建 iframe，autoplay 被浏览器拦截 |
| `<audio>` 后台可播 | 前台触发过一次 play() 后，后台换 src 再 play() 浏览器允许 |
| `/api/play/stream` 已修复 | 原 WBI 接口被 B 站 412 风控；现降级为 `platform=html5` durl，稳定 200 |

---

## 当前方案（已实现）

**切后台时销毁 iframe，用 `<audio>` 从当前进度接管；回前台时停 audio、重建 iframe。**

```
前台播放 (iframe)
  ↓ 切到后台 (visibilitychange hidden)
销毁 iframe
bgAudio.src = /api/play/stream?bvid
bgAudio.canplay 后 seek 到 elapsed，再 play()   ← 从当前进度接续

  ↓ 计时器切歌 (startVideo, document.hidden=true)
bgAudio.src = 新歌 stream → play()（新歌从 0 开始）
记录 _pendingMount = { bvid, title }

  ↓ 回到前台 (visibilitychange visible)
elapsed = bgAudio.currentTime  (校正进度)
bgAudio.pause(); bgAudio.src = ''
mountVideoAt(bvid, title, elapsed)  (iframe 带 &t= 时间戳)
```

### 音量控制

WeMusic 维护独立音量（`_bgVolume`，存 `localStorage`），控制 bgAudio。
UI 上的音量滑块（`#volBar` / `#volBtn`）已重新启用并绑定到 bgAudio。
注意：iframe 内 B 站播放器的音量无法跨域控制，两者音量独立。

### 核心代码位置（`src/player.js`）

- `_bgPlay(bvid, seekSec)` / `_bgStop()` — bgAudio 启停，支持 seek
- `startVideo()` — 后台时走 bgAudio，前台时走 iframe
- `visibilitychange` — 切后台启 bgAudio，回前台停 bgAudio 建 iframe
- `destroyVideo()` — 同步停 bgAudio
- `initPlayer()` 音量控件初始化

---

## 废弃方案

### bgAudio 与 iframe 共存（❌）
切后台时不销毁 iframe，同时启动 bgAudio → **双重声音、音量变大**，且 bgAudio 从 0 开始导致进度重置。

---

## 文件索引

| 文件 | 说明 |
|------|------|
| `src/player.js` | 播放核心，包含所有后台逻辑 |
| `src/utils.js` | `biliEmbed(bvid, startSec)` 支持 `&t=` 时间戳 |
| `server/routes/play.js` | `/api/play/stream` 音频流代理 |
| `server/services/bilibili.js` | `getAudioStream`：DASH → html5 durl 降级 |
| `public/index.html` | `<audio id="audio">` 元素 |
| `restart.sh` | 重启服务器 |
