# 视频标题 / 歌名 左右滚动

## 设计目标

底栏歌名、底栏视频标题、浮窗视频标题在文字太长无法完整显示时，自动左右滚动，确保用户看到完整内容。

## 实现方案

### 通用原理

**inner span 方案**：所有滚动位置统一采用「父级 `overflow: hidden` 裁剪 + 内层 span `display: inline-block` + `translateX` 动画」。

1. 文本元素内部包一层 `<span class="xxx-inner">`，`display: inline-block; white-space: nowrap`（**不加** `min-width: max-content`）
2. 父级设 `overflow: hidden` 裁剪溢出
3. JS 检测溢出：`child.scrollWidth > parent.clientWidth + 4`
   - `child.scrollWidth` = inner span 的文本自然宽度（不受父级裁剪影响）
   - `parent.clientWidth` = 父级可见宽度（被 grid 列/容器约束）
   - **不要**用 inner 的 `clientWidth`（等于 `scrollWidth`，永远不溢出）
4. 溢出时给 inner 加 `scrolling` class + `--scroll-dist` CSS 变量
5. CSS 动画 `translateX(var(--scroll-dist))` 滚动 inner span

> **为什么不用 `min-width: max-content`**：如果 inner span 设了 `min-width: max-content`，它的自然宽度会等于 `scrollWidth`，导致 `scrollWidth == clientWidth`，永远不会被判定为溢出。

### 三处滚动位置

| 位置 | 父级 | inner class | 动画名 | 触发时机 |
|------|------|-------------|--------|----------|
| 底栏歌名 | `#npTitle` (grid 列 60-180px) | `.np-title-line` | `marquee` | 每次更新歌名 |
| 底栏视频标题 | `#playStatus` (grid 列 0-220px) | `.status-inner` | `marquee` | 每次播放视频 |
| 浮窗视频标题 | `#vpTitle` (flex:1) | `.vp-title-inner` | `vp-scroll` | `setVpTitle()` |

### CSS 动画

- **marquee**（底栏）: 8s ease-in-out，0%→12%暂停，12%→50%滚到末尾，50%→80%暂停，80%→100%归位
- **vp-scroll**（浮窗）: 10s ease-in-out，0%→8%暂停，8%→45%滚到末尾，45%→75%暂停，75%→92%归位

### 底栏网格布局

```css
.player {
  display: grid;
  grid-template-columns: 46px minmax(60px, 180px) auto 1fr minmax(0, 220px) auto;
  grid-template-areas: "cover np controls . status right";
}
```

| 区域 | 宽度 | 内容 |
|------|------|------|
| cover | 46px | 专辑封面 |
| np | 60-180px | 歌名（overflow:hidden，inner span 滚动） |
| controls | auto | 模式/上一首/播放/下一首/音量 |
| . | 1fr | 空白填充 |
| status | 0-220px | 视频标题（overflow:hidden，inner span 滚动） |
| right | auto | 词/队列/换源/看视频按钮 |

进度条 `.progress-center` 使用 `position: absolute; left: 50%; transform: translateX(-50%)` 绝对居中，完全独立于网格流，不受任何元素影响。

## 常见问题

- **滚动不触发**：检查 inner span **不要**设 `min-width: max-content`，确认 `requestAnimationFrame` 足够让文本渲染完成
- **动画不滚动**：确保 `--scroll-dist` 为负数 `px` 值
- **文本截断**：父级禁止 `text-overflow: ellipsis`，否则 inner span 内容被截为 "..."
- **文本溢出可见区**：确保父级设 `overflow: hidden`，grid 列用 `minmax(0, Npx)` 硬限制宽度

## 更新记录

- 2026-07-03：统一为 inner span 方案，三处滚动一致
- 2026-07-03：修复 `min-width: max-content` 导致 `scrollWidth == clientWidth` 无法检测溢出
- 2026-07-03：修复 `text-overflow: ellipsis` 截断 inner span 内容
- 2026-07-03：视频标题独立 grid 列 + inner span 裁剪
