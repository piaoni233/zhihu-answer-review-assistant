import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2022',
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.js', 'tests/regression/**/*.test.js'],
    coverage: {
      provider: 'v8',
      include: ['src/core/**/*.js'],
      reporter: ['text', 'json-summary'],
    },
  },
});
