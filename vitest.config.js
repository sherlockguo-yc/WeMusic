import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.js', 'tests/api/**/*.test.js'],
    testTimeout: 15000,
    coverage: {
      provider: 'v8',
      include: ['server/**/*.js', 'src/utils.js', 'shared/**/*.js'],
      exclude: ['server/services/poster.js'],
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: 'coverage',
    },
  },
});
