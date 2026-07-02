# 视频标题 / 歌名 左右滚动

## 设计目标

底栏歌名、底栏视频标题、浮窗视频标题在文字太长无法完整显示时，自动左右滚动，确保用户看到完整内容。

## 实现方案

### 通用原理

1. 文本元素内部包一层 `<span class="xxx-inner">`，`display: inline-block; min-width: max-content` 让它撑开到文本真实宽度
2. 父级元素设 `overflow: hidden; white-space: nowrap` 裁剪溢出部分
3. JS 检测溢出：比较 `inner.scrollWidth` 和 `父级.clientWidth`
4. 溢出时给 inner 加 `scrolling` class，启动 CSS `translateX` 动画
5. 动画的 `--scroll-dist` 由 JS 动态计算：`-(inner.scrollWidth - 父级.clientWidth + 24)px`

### 三处滚动位置

| 位置 | 元素 | inner class | 动画名 | 触发 JS |
|------|------|-------------|--------|---------|
| 底栏歌名 | `#npTitle` | `.np-title-line` | `marquee` | `checkMarquee()` |
| 底栏视频标题 | `#playStatus` | (自身) | `marquee` | `checkMarquee()` |
| 浮窗视频标题 | `#vpTitle` | `.vp-title-inner` | `vp-scroll` | `setVpTitle()` |

### CSS 动画

- **marquee**（底栏）: 8s ease-in-out，0%→12%暂停，12%→50%滚到末尾，50%→80%暂停，80%→100%归位
- **vp-scroll**（浮窗）: 10s ease-in-out，0%→8%暂停，8%→45%滚到末尾，45%→75%暂停，75%→92%归位

### 底栏布局

```css
grid-template-columns: 46px minmax(80px, 200px) auto 1fr auto auto;
grid-template-areas: "cover np controls . status right";
```

| 区域 | 宽度 | 内容 |
|------|------|------|
| cover | 46px | 专辑封面 |
| np | 80-200px | 歌名 |
| controls | auto | 播放控制按钮 |
| . | 1fr spacer | 空白填充 |
| status | auto | 视频标题（`.player-status`），max-width 220px，超出不可见 |
| right | auto | 词/队列/换源/看视频按钮 |

### 进度条绝对定位

进度条 `.progress-center` 独立于底栏布局流：
- `.player { position: relative }` — 作为定位参考
- `.progress-center { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 380px }` — 绝对居中
- 不受任何兄弟元素（歌名、按钮、视频标题）长度变化影响

### 视频标题独立区域

视频标题专属 grid 列（`status`），位于进度条右侧和按钮左侧之间的空白区：
- 超出该列宽度（max-width 220px）的部分被 `overflow: hidden` 裁剪
- 溢出时触发 marquee 滚动显示完整内容

### 滚动动画 vs 父级裁剪

动画中的 `transform: translateX(负值)` 在父级 `overflow: hidden` 下依然可见，因为：
- 父级裁剪基于元素的原始布局盒（不含 `transform`）
- 平移操作只影响渲染位置，不影响布局盒
- 内层 span 的文本向右溢出（`min-width: max-content`），被父级裁剪
- 平移负值时，左侧被裁剪部分会移入可视区，右侧溢出的文本也移入可视区

## 常见问题

- **inner scrollWidth 为 0**：检查 `overflow` 应设在父级而非 inner
- **动画不滚动**：确保 `--scroll-dist` 已设置且为负数 `px` 值
- **文本被截断看不到末尾**：增大 `+24` padding 或改用更大的 `+` 值
- **动画停止**：hover 时暂停（`animation-play-state: paused`）

## 更新记录

- 2026-07-03：从 `overflow:hidden` 同级动画改为 inner span 方案，解决父级裁剪冲突
