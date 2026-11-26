import { defineConfig, devices } from '@playwright/test';

/**
 * Real-backend e2e suite.
 *
 * Boots the Fastify API (with Hocuspocus) against a real Postgres database
 * and the Vite dev server, then drives the app in a real browser. Use this
 * suite for anything that must survive a reload or involves more than one
 * user: persistence, nested diagrams, sharing, collaboration.
 *
 * Requires a reachable Postgres. Defaults match docker-compose.yml:
 *   E2E_DATABASE_URL=postgresql://mavisdraw:mavisdraw_dev@localhost:5432/mavisdraw
 *
 * Run: pnpm run test:e2e:real
 */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

const API_PORT = process.env.E2E_API_PORT ?? '3101';
const WEB_PORT = process.env.E2E_WEB_PORT ?? '3100';
const DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  'postgresql://mavisdraw:mavisdraw_dev@localhost:5432/mavisdraw';

export const API_URL = `http://localhost:${API_PORT}`;
export const WEB_URL = `http://localhost:${WEB_PORT}`;

export default defineConfig({
  testDir: './e2e-real',
  globalSetup: './e2e-real/global-setup.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 60_000,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @mavisdraw/server exec tsx src/index.ts',
      url: `${API_URL}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        PORT: API_PORT,
        HOST: '127.0.0.1',
        DATABASE_URL,
        CORS_ORIGIN: WEB_URL,
        JWT_SECRET: 'e2e-jwt-secret',
        COOKIE_SECRET: 'e2e-cookie-secret',
        AUTH_RATE_LIMIT_MAX: '10000',
        // Deterministic stand-in for the LLM (never active in production)
        AGENT_MOCK: '1',
        LOG_LEVEL: 'warn',
        NODE_ENV: 'test',
      },
    },
    {
      command: `pnpm exec vite --port ${WEB_PORT} --strictPort`,
      url: WEB_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        VITE_API_URL: API_URL,
        VITE_WS_URL: `ws://localhost:${API_PORT}`,
        VITE_DISABLE_DEV_AUTO_LOGIN: 'true',
      },
    },
  ],
});
