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
