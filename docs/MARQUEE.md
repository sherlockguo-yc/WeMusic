# 视频标题 / 歌名 左右滚动

## 设计目标

底栏歌名、底栏视频标题、浮窗视频标题在文字太长无法完整显示时，自动左右滚动，确保用户看到完整内容。

## 实现方案

### 通用原理

**rAF 匀速驱动**：所有滚动统一用 `requestAnimationFrame` + 状态机，替代 CSS keyframes。

```
状态机循环：暂停2s → 滚动(40px/s) → 暂停2s → 回滚(40px/s) → 重复
```

1. 文本元素内部包一层 `<span class="xxx-inner">`，用于 transform 滚动
2. 父级设 `overflow: hidden` 裁剪，禁止 `text-overflow: ellipsis`
3. JS 检测溢出：`inner.scrollWidth > parent.clientWidth + 4`
4. 溢出时调 `startMarquee(inner, extra)` 启动 rAF 循环
5. `checkMarquee(el)` 统一入口：先停止旧动画 → 重新检测 → 按需启动

### 匀速逻辑

```js
function startMarquee(inner, extra) {
  // extra = 溢出像素数（scrollWidth - clientWidth）
  const SPEED = 40;  // px/s，滚动和回滚速度一致
  const PAUSE = 2000; // 起止暂停各 2s
  
  const scrollTime = (extra / SPEED) * 1000;
  const cycle = PAUSE * 2 + scrollTime * 2;

  // rAF tick：累加 dt → 按阶段计算 transform
  // hover 暂停：mouseenter 停止累加，mouseleave 继续
}

### 三处滚动位置

| 位置 | inner class | 滚动速度 | 触发函数 |
|------|-------------|----------|----------|
| 底栏歌名 | `.np-title-line` | 40px/s | `checkMarquee` |
| 底栏视频标题 | `.status-inner` | 40px/s | `checkMarquee` |
| 浮窗视频标题 | `.vp-title-inner` | 40px/s | `setVpTitle` |

三处共用同一个 `startMarquee(inner, extra)` 函数，速度统一。

### 底栏布局（desktop）

```css
.player {
  display: grid;
  grid-template-columns: 46px minmax(60px, 180px) auto 1fr auto;
  grid-template-areas: "cover np controls . right";
  position: relative;
}
```

| 区域 | 宽度 | 内容 |
|------|------|------|
| cover | 46px | 专辑封面 |
| np | 60-180px | 歌名 |
| controls | auto | 模式/上一首/播放/下一首/音量 |
| . | 1fr | 弹性空白填充 |
| right | auto | 词/队列/换源/看视频 |

### 视频标题绝对定位

进度条（`.progress-center`，380px 宽，`position: absolute; left: 50%`）和视频标题都不在 grid 流中：

```css
.player-status {
  position: absolute;
  left: calc(50% + 202px);  /* 进度条右边缘 + 12px 间隙 */
  right: 210px;             /* 右按钮左边缘 */
  top: 50%;
  transform: translateY(-50%);
  width: auto;              /* 宽度由 left/right 两端决定 */
  z-index: 1;
}
```

- `left: calc(50% + 202px)` = 进度条半宽(190) + 间隙(12)，左边缘贴进度条
- `right: 210px` = 右按钮区域宽度 + 间隙，右边缘贴按钮
- 进度条宽度变化时需同步调整 `202` 和 `210`

### 移动端

移动端进度条和视频标题均取消绝对定位，使用 flex 流布局。

## 常见问题

- **滚动不触发**：inner span 不能设 `min-width: max-content`（否则 `scrollWidth == clientWidth`）；确保 `requestAnimationFrame` 双帧后再检测
- **动画无效**：`--scroll-dist` 必须为负数 px，用 `child.scrollWidth - parent.clientWidth` 计算
- **文本被截断**：父级禁止 `text-overflow: ellipsis`
- **底栏视频标题不见了**：检查 `.player` 是否有 `position: relative`；检查 `right: 210px` 是否太大导致宽度为 0
- **进度条和视频标题重叠**：确保进度条宽度与 `left` 的计算一致（380px 宽 → `left: calc(50% + 202px)`）

## 更新记录

- 2026-07-03：视频标题改为绝对定位，左右同时贴紧进度条和按钮
- 2026-07-03：用 rAF 状态机替代 CSS keyframes，40px/s 匀速 + hover 暂停
- 2026-07-03：统一 inner span 方案，三处滚动一致
- 2026-07-03：修复 `text-overflow: ellipsis` 截断内容
