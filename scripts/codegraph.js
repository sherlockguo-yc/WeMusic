// 项目符号图 — 解析所有源码 → 提取模块/导出/依赖/路由 → 生成结构化 JSON
// 输出: .project-graph.json（AI 会话自动读取，无需 grep 文件）
// 用法: npm run codegraph

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
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
