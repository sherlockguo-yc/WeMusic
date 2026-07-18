import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: 'src',
  publicDir: false,
  base: '/dist/',
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
        },
      },
    },
    esbuild: {
      drop: ['console.log'], // 保留 console.error / console.warn 用于线上排查
    },
  },
  server: {
    proxy: { '/api': 'http://localhost:5174' },
  },
});
