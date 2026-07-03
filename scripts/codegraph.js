// 项目符号图 — 解析所有源码 → 提取模块/导出/依赖/路由 → 生成结构化 JSON
// 输出: .project-graph.json（AI 会话自动读取，无需 grep 文件）
// 用法: npm run codegraph

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';

const traverse = _traverse.default;
const ROOT = resolve(process.cwd());

// —— 解析任意目录 ——
function parseDir(dir) {
  const result = {};
  try {
    for (const f of readdirSync(dir).filter(f => f.endsWith('.js'))) {
      const fp = join(dir, f);
      try {
        const src = readFileSync(fp, 'utf8');
        const ast = parse(src, { sourceType: 'module', plugins: ['dynamicImport', 'classProperties'], errorRecovery: true });
        const info = { exports: [], imports: [], routes: [] };

        traverse(ast, {
          // 静态 import
          ImportDeclaration(path) {
            const from = path.node.source.value;
            if (from.startsWith('./') || from.startsWith('../')) {
              const resolved = resolve(dirname(fp), from + '.js');
              if (resolved.includes('src') || resolved.includes('server') || resolved.includes('shared')) {
                info.imports.push(resolved.replace(ROOT + '/', ''));
              }
            }
          },
          // 命名导出
          ExportNamedDeclaration(path) {
            if (path.node.declaration) {
              const d = path.node.declaration;
              if (d.id) info.exports.push({ name: d.id.name, type: d.type });
              else if (d.declarations) {
                d.declarations.forEach(dec => {
                  if (dec.id) info.exports.push({ name: dec.id.name, type: d.type });
                });
              }
            } else if (path.node.specifiers) {
              path.node.specifiers.forEach(s => info.exports.push({ name: s.exported.name, type: 're-export' }));
            }
          },
          // 默认导出
          ExportDefaultDeclaration(path) {
            const d = path.node.declaration;
            info.exports.push({ name: d?.id?.name || 'default', type: 'default' });
          },
          // 路由定义
          CallExpression(path) {
            if (path.node.callee.type === 'MemberExpression') {
              const obj = path.node.callee.object;
              const prop = path.node.callee.property;
              if (obj && prop && ['get', 'post', 'put', 'delete', 'use'].includes(prop.name)) {
                const args = path.node.arguments;
                if (args.length >= 1 && args[0].type === 'StringLiteral') {
                  info.routes.push({ method: prop.name.toUpperCase(), path: args[0].value });
                }
              }
            }
          },
          // 动态 import
          Import(path) {
            if (path.parent.type === 'CallExpression' && path.parent.arguments[0]?.value) {
              // 动态导入在调用时才解析，这里只标记模块使用了动态导入
              if (!info.exports.some(e => e.name === 'dynamic-import')) {
                info.exports.push({ name: '__uses_dynamic_import__', type: 'meta' });
              }
            }
          },
        });

        result[f] = info;
      } catch { /* skip unparseable files */ }
    }
  } catch { /* skip missing dirs */ }
  return result;
}

function dirname(p) { return p.substring(0, p.lastIndexOf('/')); }

// —— 构建全图 ——
const modules = {};

// 前端
Object.assign(modules, parseDir(join(ROOT, 'src')));
// 后端路由
Object.assign(modules, parseDir(join(ROOT, 'server/routes')));
// 后端服务
Object.assign(modules, parseDir(join(ROOT, 'server/services')));
// 中间件
Object.assign(modules, parseDir(join(ROOT, 'server/middleware')));
Object.assign(modules, parseDir(join(ROOT, 'server')));
// 共享
Object.assign(modules, parseDir(join(ROOT, 'shared')));

// —— 收集路由表 ——
const routes = [];
for (const [file, info] of Object.entries(modules)) {
  for (const r of info.routes) {
    routes.push({ file, ...r });
  }
}

// —— 生成图 ——
const graph = {
  generated: new Date().toISOString(),
  moduleCount: Object.keys(modules).length,
  modules,
  routes,
};

// 输出
const out = join(ROOT, '.project-graph.json');
writeFileSync(out, JSON.stringify(graph, null, 2));
console.log(`✅ CodeGraph 已生成: ${out}`);
console.log(`   ${Object.keys(modules).length} 个模块, ${routes.length} 条路由`);

// ---- 自动生成 docs/README.md 索引 ----
try {
  const docsDir = join(ROOT, 'docs');
  const entries = readdirSync(docsDir, { withFileTypes: true });
  const lines = ['# WeMusic 文档索引', '', '> 此文件由 `npm run codegraph` 自动生成，无需手动维护。', ''];

  // 根目录下的 .md 文件
  const rootMds = entries.filter(e => e.isFile() && e.name.endsWith('.md') && e.name !== 'README.md');
  if (rootMds.length) {
    lines.push('## 项目级文档', '');
    for (const e of rootMds) {
      const content = readFileSync(join(docsDir, e.name), 'utf8');
      const title = content.match(/^#\s+(.+)/m)?.[1] || e.name.replace('.md', '');
      lines.push(`- [${title}](${e.name})`);
    }
    lines.push('');
  }

  // 子目录
  const dirs = entries.filter(e => e.isDirectory());
  for (const d of dirs) {
    const subFiles = readdirSync(join(docsDir, d.name)).filter(f => f.endsWith('.md'));
    if (!subFiles.length) continue;
    lines.push(`## ${d.name}/`, '');
    for (const f of subFiles) {
      const content = readFileSync(join(docsDir, d.name, f), 'utf8');
      const title = content.match(/^#\s+(.+)/m)?.[1] || f.replace('.md', '');
      lines.push(`- [${title}](${d.name}/${f})`);
    }
    lines.push('');
  }

  // 规则文件
  const rulesDir = join(ROOT, '.codebuddy', 'rules');
  if (existsSync(rulesDir)) {
    const rules = readdirSync(rulesDir).filter(f => f.endsWith('.mdc'));
    lines.push('## .codebuddy/rules/（AI 会话自动加载）', '');
    for (const r of rules) {
      const content = readFileSync(join(rulesDir, r), 'utf8');
      const title = content.match(/^##\s+(.+)/m)?.[1] || r.replace('.mdc', '');
      lines.push(`- **${r}** — ${title}`);
    }
  }

  writeFileSync(join(docsDir, 'README.md'), lines.join('\n') + '\n');
  console.log(`✅ docs/README.md 已更新`);
} catch (e) { console.warn('⚠ docs/README.md 生成失败:', e.message); }
