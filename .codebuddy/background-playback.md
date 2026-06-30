# WeMusic 后台播放

> 最后更新：2026-06-30 | 状态：✅ 已完成

---

## 目标

切到后台（Chrome 其他标签激活时），计时器切歌后新歌立即有声音，无需切回前台。

---

## 关键事实

| 事实 | 说明 |
|------|------|
| 已在播的 iframe 后台继续播 | 不需要干预 |
| **新建** iframe autoplay 被阻止 | `document.hidden=true` 时创建 iframe，autoplay 被浏览器拒绝 |
| `<audio>` 后台可播 | 前台触发过 play() 后，后台换 src 再 play() 浏览器允许 |
| `/api/play/stream` | 原 WBI 接口被 B 站 412 风控；已降级为 `platform=html5` durl，稳定 200 |

---

## 实现方案

**前台：iframe 播放 + bgAudio 静音预缓冲  
后台：销毁 iframe + bgAudio 有声接管  
回前台：bgAudio 交叉播放 1.8s → 停止，iframe 带时间戳重建**

```
前台播放 (iframe)
  startVideo 后 1s → bgAudio 静音预缓冲（load but not play）

  ↓ 切到后台
销毁 iframe
bgAudio 解除静音，seek 到 elapsed（数据已预缓冲，几乎无延迟），play()

  ↓ 后台计时器切歌
bgAudio.src = 新歌 stream → play()（新歌从 0 开始）
记录 _pendingMount = { bvid, title }

  ↓ 回到前台
elapsed = bgAudio.currentTime（校正进度）
mountVideoAt(bvid, title, elapsed)（iframe 带 &t= 时间戳）
setTimeout 1.8s 后停 bgAudio（交叉，填补 iframe 加载空档）
```

### 关键代码（`src/player.js`）

| 函数 | 作用 |
|------|------|
| `_bgPreload(bvid)` | 静音加载 bgAudio，不 play，前台预热 |
| `_bgUnmuteAndPlay(seekSec)` | 解除静音，seek 后 play |
| `_bgStop()` | 停止并清空 bgAudio |
| `startVideo()` | 前台→挂 iframe + 预缓冲；后台→换 bgAudio src + play |
| `visibilitychange hidden` | 销毁 iframe，调 `_bgUnmuteAndPlay(elapsed)` |
| `visibilitychange visible` | 校正进度，建 iframe，1.8s 后停 bgAudio |

### 音量

- WeMusic 维护独立音量 `_bgVolume`（存 `localStorage`），控制 bgAudio
- 底部播放栏音量滑块（🔊）控制后台音量，前台 iframe 音量需在 B 站播放器内调节（跨域限制）

---

## 废弃方案

**bgAudio 与 iframe 共存**：切后台时不销毁 iframe，双轨同时播 → 双重声音叠加、音量变大、进度从 0 开始。

---

## 相关文件

| 文件 | 说明 |
|------|------|
| `src/player.js` | 所有后台逻辑 |
| `src/utils.js` | `biliEmbed(bvid, startSec)` 支持 `&t=` |
| `server/routes/play.js` | `/api/play/stream` 音频流代理 |
| `server/services/bilibili.js` | `getAudioStream`：DASH 优先，失败降级 html5 durl |
| `restart.sh` | 重启服务器 |
