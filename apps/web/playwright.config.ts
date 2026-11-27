import { defineConfig, devices } from '@playwright/test';

/**
 * Mocked-API e2e suite: the dev server runs alone and every test stubs the
 * backend with `page.route`. For tests against a real Fastify + Postgres
 * backend, see `playwright.real.config.ts`.
 *
 * Set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to run against a pre-installed
 * Chromium when it doesn't match the bundled Playwright revision.
 */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
