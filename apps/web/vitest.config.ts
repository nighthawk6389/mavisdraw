import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    exclude: ['e2e/**', 'e2e-real/**', 'node_modules/**'],
  },
});
