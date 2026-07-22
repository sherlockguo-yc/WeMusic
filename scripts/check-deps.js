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

if (errors.length) {
  console.log('❌ 架构约束违反:');
  errors.forEach(e => console.log('  - ' + e));
  process.exit(1);
}
console.log('✅ 架构检查通过');
