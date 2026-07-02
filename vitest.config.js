import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 单元测试 + API 集成测试
    include: ['tests/unit/**/*.test.js', 'tests/api/**/*.test.js'],
    globals: false,
    testTimeout: 15000,
  },
});
