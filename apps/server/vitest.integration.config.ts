import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/__tests__/integration/**/*.spec.ts'],
    testTimeout: 120_000,
    hookTimeout: 90_000,
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
