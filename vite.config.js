import { defineConfig } from 'vite';
import { resolve } from 'path';
import fs from 'node:fs';

export default defineConfig({
  root: 'src',
  publicDir: false,
  base: '/dist/',
  plugins: [
    // SW 预缓存清单：构建后把所有 JS 产物写入 public/dist/sw-precache.json，
    // 供 sw.js install 时全量预缓存。修复：预缓存缺业务 chunks 导致
    // 网络抖动时 module 链断裂、页面变死页的问题。
    {
      name: 'sw-precache-manifest',
      writeBundle(_options, bundle) {
        const files = Object.values(bundle)
          .filter((f) => f.type === 'chunk' && f.fileName.endsWith('.js'))
          .map((f) => `/dist/${f.fileName}`)
          .sort();
        const out = resolve(__dirname, 'public/dist/sw-precache.json');
        fs.writeFileSync(out, JSON.stringify({ files }, null, 2) + '\n');

        // 静态资源版本戳：把 HTML 里的 ?v=__BUILD__ / ?v=<旧值> 统一替换为本次构建时间戳。
        // 目的：CF 会把源站的 no-cache 改写成 max-age=14400（Browser Cache TTL），
        // 浏览器 4 小时内不回源，导致部署后手机仍用旧 CSS/JS。URL 变化即可强制取新。
        const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 12); // YYYYMMDDHHmm
        for (const name of ['index.html', 'login.html']) {
          const p = resolve(__dirname, 'public', name);
          const html = fs.readFileSync(p, 'utf8');
          let next = html.replace(/\?v=(?:__BUILD__|\d+)/g, `?v=${stamp}`);
          // 例外：模块入口 /dist/app.js 绝不能带查询参数。
          // 业务 chunk 里有 import('./main.js')（取 navPush），构建后是 import("../app.js")，
          // 解析成不带参数的 /dist/app.js；而页面若引用 /dist/app.js?v=…，浏览器按完整 URL 区分模块，
          // 入口会被当成两个模块各执行一遍：全局监听器重复注册（一次按键 playNext 触发两次 = 跳两首）、
          // 首页接口重复请求。2026-11-04 实测复现。cache bust 对入口并不需要：
          // 服务端返回 no-cache,must-revalidate，Cloudflare 已遵循源站头（线上实测），chunk 本身带内容 hash。
          next = next.replace(/(\/dist\/app\.js)\?v=[^"']*/g, '$1');
          if (next !== html) fs.writeFileSync(p, next);
        }
      },
    },
  ],
  build: {
    outDir: '../public/dist',
    emptyOutDir: false, // 不清理旧 chunk：避免构建后旧客户端缓存引用失效 404
    target: 'es2020',
    minify: 'esbuild',
    rollupOptions: {
      input: {
        app: resolve(__dirname, 'src/main.js'),
        login: resolve(__dirname, 'src/login-entry.js'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
        manualChunks: {
          stats: [resolve(__dirname, 'src/stats.js')],
          search: [resolve(__dirname, 'src/search.js')],
          lyrics: [resolve(__dirname, 'src/lyrics.js')],
          player: [resolve(__dirname, 'src/player.js')],
          playlist: [resolve(__dirname, 'src/playlist-ui.js')],
          migration: [resolve(__dirname, 'src/admin/migration.js')],
        },
      },
    },
    // 注：此前生产构建会 drop console.log（只保留 warn/error）。
    // 引入全量日志持久化基础设施（src/logger.js）后，console.log 也需要被
    // monkey-patch 捕获并上报，因此不再 drop，改为全部保留。
  },
  server: {
    proxy: { '/api': 'http://localhost:5174' },
  },
});
