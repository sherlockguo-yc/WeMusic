# 图标使用规范

> **本项目所有 UI 图标统一使用 [Lucide](https://lucide.dev/) 风格。** 后续新增任何图标，都必须从 Lucide 图标库中选用，禁止使用 emoji 或其他图标库的图标。

## 规格

| 项 | 值 |
|---|---|
| 库 | [Lucide](https://lucide.dev/)（基于 Feather Icons 演进） |
| 协议 | ISC（可商用） |
| 视图框 | `viewBox="0 0 24 24"` |
| 默认描边宽度 | `stroke-width="2"` |
| 端点圆角 | `stroke-linecap="round" stroke-linejoin="round"` |
| 颜色 | `stroke="currentColor"`（自动适配深/浅色主题） |
| 填充 | 默认 `fill="none"`；仅在「实心/激活」状态改为 `fill="currentColor"` |
| 缩放 | 通过 `width` / `height` 属性控制（12-20px 为常用范围） |

## 标准 SVG 模板

```html
<!-- 空心（默认） -->
<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="..."/>
</svg>

<!-- 实心（激活/收藏状态） -->
<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="..."/>
</svg>
```

## 当前项目已用图标

| 用途 | 图标名 | SVG path / 备注 |
|---|---|---|
| 侧栏 导航/统计/搜索/喜欢 | compass / bar-chart-3 / search / heart | Lucide 原始 |
| 侧栏 专辑 | disc | `circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/>` |
| 播放模式 | repeat / repeat-1 / shuffle | Lucide 原始 |
| 喜欢/不喜欢 | heart / heart-crack | Lucide 原始 |
| 编辑 | pencil | `M12 20h9 / M16.5 3.5a2.121 ... 3L7 19l-4 1 1-4L16.5 3.5z` |
| 删除/关闭 | x | `<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>` |
| 播放控制 | play / pause / skip-forward / skip-back / volume-2 | Lucide 原始 |
| 报告头 | bar-chart-3 | `M3 3v18h18 / m19 9-5 5-4-4-3 3` |
| 趋势 | trending-up | Lucide 原始 |
| 完播率 | check | Lucide 原始 |
| 时段图标 | sun (上午) / sun-rise (清晨) / sun-set (夕阳) | Lucide 原始 |
| 标签 | bookmark | `m19 21-7-4-7 4V5a2 2 ... 2 2v16z` |
| 链接 | link | Lucide 原始 |
| 搜索 | search | Lucide 原始 |
| 添加 | plus | `M12 5v14 / M5 12h14` |
| 拖动 | grip-vertical | Lucide 原始 |
| 上一首/下一首 | chevron-left / chevron-right | Lucide 原始 |
| 随机 | shuffle | Lucide 原始 |
| 循环 | repeat / repeat-1 | Lucide 原始 |
| 列表/队列 | list-music | Lucide 原始 |
| 闹钟/定时 | timer | Lucide 原始 |
| 锁/私密 | lock | Lucide 原始 |
| 用户/头像 | user | Lucide 原始 |
| 设置 | settings | Lucide 原始 |
| 退出/登出 | log-out | Lucide 原始 |
| 主题 | sun / moon | Lucide 原始 |

## 如何使用

### HTML 静态使用

直接在 `index.html` 中嵌入 SVG 标签：

```html
<button>
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="11" cy="11" r="8"/>
    <path d="m21 21-4.3-4.3"/>
  </svg>
  发现
</button>
```

### JS 动态生成

```js
// 模板字符串（注意双引号转义）
const ICON_SEARCH = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>';

// 使用
const html = `<button>${ICON_SEARCH} 搜索</button>`;
```

### 切换实心/空心

只需要修改 `fill` 属性：

```js
// 空心（默认）
const ICON_HEART = '<svg ... fill="none" ...><path d="..."/></svg>';

// 实心（激活/已收藏）
const ICON_HEART_FILLED = '<svg ... fill="currentColor" ...><path d="..."/></svg>';
```

## 禁止

- ❌ Emoji（📊🎵🔥 等）— 跨平台渲染不一致、风格不可控
- ❌ Unicode 符号（✕ ▶ ★）— 字体环境依赖
- ❌ Material Icons / Font Awesome / 其他图标库 — 风格不统一
- ❌ 彩色实心图标 — 与本项目「简洁线条」风格冲突
- ❌ PNG / JPG 格式图标 — 不能缩放、不适配主题

## 未来扩展流程

新增图标时：
1. 打开 https://lucide.dev/icons 找到合适的图标
2. 点击图标 → 选 "SVG" → 复制 path data
3. 套用本规范的 SVG 模板（24x24 viewBox、stroke-width=2、currentColor）
4. 在本文件「当前项目已用图标」表格中登记

## 注意事项

- **不要**给 SVG 加 `width="24" height="24"` 硬编码在 SVG 标签内，通过外层 `<svg width="X" height="X">` 控制缩放
- **不要**用 `fill="black"` / `fill="white"` / 任何颜色名，用 `currentColor` 让主题色接管
- **不要**用 `stroke-width="1.5"` 或 "1.8"，统一用 "2"（Lucide 标准）
- 缩放范围建议 12-20px：12-14 用于内联/密集布局，16 用于侧栏/按钮，18-20 用于大图标
