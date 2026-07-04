---
name: 模块拆分
description: >
  用于将大型源文件拆分为多个小模块，或从现有代码中提取新文件。
  触发条件："拆分 stats.js"、"把这个函数提取到单独文件"、"拆解这个模块"、"重构为多个文件"等。
  此 skill 用于防止最常见的 bug：遗漏原文件使用的 import 符号。
---

## 模块拆分工作流

拆分源文件为多个小文件时，**绝对不要手写 import 头部**。每次手写都至少遗漏 2-3 个 import，导致运行时报 `ReferenceError`。

### 步骤 1：读取项目图

```
读取 .project-graph.json → 找到被拆分文件的模块条目
```

这会给出原模块导入和使用的精确符号列表。

### 步骤 2：将符号映射到新文件

对于每个要提取到新文件的函数/代码块，检查它实际引用了哪些原始 import。使用 grep 或 AST 检查——不要靠猜。

### 步骤 3：程序化生成 import

**禁止**手写 import 头部。正确做法：

1. 列出提取出的代码所使用的所有外部符号
2. 交叉对照 `.project-graph.json`，找到每个符号由哪个模块导出
3. 根据这些数据生成 `import { ... } from './module.js'` 行

### 步骤 4：立即验证

```bash
npm run deploy
```

检查：
- 0 个构建错误（语法、缺失 import）
- 控制台中 0 个 `ReferenceError` 运行时错误
- 拆分后的页面实际能渲染（逐个点击检查）

### 已知失败模式（不要再犯）

当 `src/stats.js`（900+ 行）拆分为 `discover.js`、`report.js`、`likes.js`、`albums.js` 时：

- `report.js`：漏了 `timeLabel`、`albumCover` → `ReferenceError`
- `discover.js`：漏了 `setTooltip`、`renderSongList` → `ReferenceError`
- `report.js`：漏了 `albumCover` 的 import → `ReferenceError`

三个全部是因为手写 import 头部，而非从原始文件的实际使用中提取所致。
