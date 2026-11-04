// 架构依赖检查（读取 codegraph 输出，验证架构规则）
// 用法: npm run check-deps
// 由 npm test 自动调用

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const graphPath = resolve(process.cwd(), '.project-graph.json');
let graph;
try { graph = JSON.parse(readFileSync(graphPath, 'utf8')); }
catch { console.log('⚠  请先运行 npm run codegraph'); process.exit(0); }

const errors = [];

// 规则：main.js 禁止被其他模块静态 import
for (const [file, info] of Object.entries(graph.modules)) {
  if (file === 'main.js') continue;
  for (const imp of info.imports) {
    if (imp.endsWith('main.js')) {
      errors.push(`禁止: ${file} → main.js（应使用 await import('./main.js')）`);
    }
  }
}

// 规则：页面引用模块入口 /dist/app.js 时禁止带查询参数。
// 业务 chunk 动态 import('./main.js') 会解析成不带参数的 /dist/app.js，与 /dist/app.js?v=… 是两个不同的模块 URL，
// 入口会被执行两遍（全局监听器重复注册：一次按键 playNext 触发两次）。详见 vite.config.js 同名插件注释。
for (const html of ['public/index.html', 'public/login.html']) {
  let text;
  try { text = readFileSync(resolve(process.cwd(), html), 'utf8'); } catch { continue; }
  const m = text.match(/\/dist\/app\.js\?[^"']*/);
  if (m) errors.push(`禁止: ${html} 引用了带参数的模块入口 ${m[0]}（会导致入口被执行两遍）`);
}

if (errors.length) {
  console.log('❌ 架构约束违反:');
  errors.forEach(e => console.log('  - ' + e));
  process.exit(1);
}
console.log('✅ 架构检查通过');
