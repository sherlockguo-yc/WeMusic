# WeMusic 前端开发准则

> 长期有效的开发规范和行为准则。新增功能、修改 UI、调整代码前应参阅本文。

---

## 一、图标

- **强制使用 [Lucide](https://lucide.dev/) 图标**，禁止 emoji、Unicode 符号、其他图标库。
- 规格：`viewBox="0 0 24 24"` / `stroke-width="2"` / `stroke-linecap="round" stroke-linejoin="round"` / `stroke="currentColor"` / 默认 `fill="none"`，激活态改为 `fill="currentColor"`。
- 按钮内图标与文字对齐：按钮需 `display: inline-flex; align-items: center; gap: 5px;`，SVG 加 `flex-shrink: 0`。
- 详细规范见 `docs/ICON_STYLE.md`。

## 二、CSS 变量

- 颜色必须使用 CSS 变量，**禁止硬编码颜色值**：
  - `var(--text)` / `var(--text-dim)` 用于文字
  - `var(--bg)` / `var(--bg-soft)` / `var(--bg-card)` 用于背景
  - `var(--border)` 用于边框
  - `var(--accent)` 用于强调色（按钮、高亮）
  - `var(--danger)` 用于危险操作
  - `var(--radius)` 用于圆角
  - `var(--shadow)` 用于阴影
- 字号使用 `calc(var(--font-size) * 比例)`，不使用硬编码 `px`（参见「字号」节）。
- 字体使用 `var(--font)`。

## 三、字号

- 基础字号由 `--font-size` CSS 变量控制（默认 14px）。
- **所有重要 UI 文本**必须使用 `calc(var(--font-size) * 比例)`，不能硬编码 `px`。
- `html { font-size: var(--font-size); }` 作为基准。
- 设置中提供 小(13px) / 默认(14px) / 中(15px) / 大(16px) 四档。

## 四、按钮

- 所有按钮统一使用 `.btn` 基类：
  - `.btn.green` — 主操作
  - `.btn.sm` — 小按钮
  - `.btn.blue` — 蓝色（Bilibili 相关）
- 按钮必须包含图标时使用 Lucide SVG + 文字，两者水平对齐。
- 按钮的 hover/active 状态必须通过 CSS 实现，不可仅在 JS 中硬编码。

## 五、表格 / 列表

- **所有歌曲列表**（搜索、歌单、喜欢、推荐、专辑）必须使用统一的 `.song-row` + `.song-row-head`。
- Grid 模板：`28px 1fr 1.2fr 0.8fr 20px 56px 112px`（# / 歌名 / 歌手 / 专辑 / 标记 / 时长 / 操作）。
- 表头和数据行使用**相同的 Grid 模板**确保列对齐。
- 表头文字对齐必须匹配数据列：歌名/歌手/专辑 left，时长 right，操作 left。
- 新增歌曲列表时必须包含 `.song-row-head` 表头。

## 六、Hover 反馈

- 所有可点击元素必须有 hover 视觉反馈：
  - 歌曲行/队列行：背景变色 + 左侧绿线
  - 按钮：边框变色
  - 卡片：上浮 + 阴影
  - 导航项：背景变色
- 新增交互元素时检查是否遗漏 hover 样式。

## 七、表格列头

- **任何歌曲列表都必须有表头**（# / 歌名 / 歌手 / 专辑 / 时长 / 操作）。
- 表头与数据必须严格对齐（同 Grid 模板）。
- 表头的 `.h-ops` 列必须有「操作」文字。

## 八、候选列表

- 歌词候选和视频候选的**评分/过滤逻辑**在 `docs/CANDIDATE_SELECTION.md` 中有详细记录。
- 修改候选逻辑前**必须先阅读该文档**，避免破坏已有优化。
- 修改后必须测试：热门歌（晴天）+ 冷门歌（El Hombre）+ 短歌名（Hell）。

## 九、搜索栏

- placeholder 不能承诺不支持的功能。
- 搜索栏必须有清除按钮（input 有内容时显示 ×）。
- 搜索建议（history autocompletion）在 focus/input 时自动弹出。

## 十、排版

- 主要文字颜色使用 `var(--text)`，次要文字使用 `var(--text-dim)`。
- 标题使用 `.view-title`，副标题使用 `.view-sub`。
- 按钮文字使用 `font-weight: 600` 或 `700`。
- 所有 SVG 图标使用 `currentColor` 继承文字颜色。

---

> 最后更新：2026-07-02
