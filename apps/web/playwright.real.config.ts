import { generateKeyPairSync } from 'node:crypto';
import { fileURLToPath } from 'node:url';
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
  process.env.E2E_DATABASE_URL ?? 'postgresql://mavisdraw:mavisdraw_dev@localhost:5432/mavisdraw';

export const API_URL = `http://localhost:${API_PORT}`;

export const WEB_URL = `http://localhost:${WEB_PORT}`;

/**
 * The Render setup: the API serves a same-origin build of the app on its own
 * address (WEB_DIST), knowing that address only from RENDER_EXTERNAL_URL.
 */
const SINGLE_PORT = process.env.E2E_SINGLE_PORT ?? '3103';
export const SINGLE_SITE_URL = `http://localhost:${SINGLE_PORT}`;
const SINGLE_SITE_DIST = fileURLToPath(new URL('./e2e-real/.single-site/dist', import.meta.url));

/**
 * Pull-request checks talk to a fake GitHub (e2e-real/fake-github.mjs) as a
 * GitHub App with a key made for this run; tests sign webhooks with the
 * secret below.
 */
const GITHUB_PORT = process.env.E2E_GITHUB_PORT ?? '3102';
export const GITHUB_URL = `http://localhost:${GITHUB_PORT}`;
export const GITHUB_APP_WEBHOOK_SECRET = 'e2e-github-webhook-secret';
const githubAppKey = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

/** The API's settings, shared by both ways of running it. */
const serverEnv = {
  HOST: '127.0.0.1',
  DATABASE_URL,
  JWT_SECRET: 'e2e-jwt-secret',
  COOKIE_SECRET: 'e2e-cookie-secret',
  AUTH_RATE_LIMIT_MAX: '10000',
  // Deterministic stand-in for the LLM (never active in production)
  AGENT_MOCK: '1',
  // Emails are kept in memory and read back by the tests (GET /api/test/outbox)
  MAIL_PROVIDER: 'outbox',
  LOG_LEVEL: 'warn',
  NODE_ENV: 'test',
  // The fake GitHub is this instance's Enterprise server (people
  // connect to it) and hosts its GitHub App
  GITHUB_ENTERPRISE_URL: GITHUB_URL,
  GITHUB_ENTERPRISE_CLIENT_ID: 'e2e-client',
  GITHUB_ENTERPRISE_CLIENT_SECRET: 'e2e-client-secret',
  GITHUB_TOKEN_ENCRYPTION_KEY: 'ab'.repeat(32),
  GITHUB_APP_ID: '424242',
  GITHUB_APP_PRIVATE_KEY: githubAppKey.privateKey,
  GITHUB_APP_WEBHOOK_SECRET,
  GITHUB_APP_SLUG: 'mavisdraw-e2e',
  GITHUB_APP_WEB_URL: GITHUB_URL,
  GITHUB_APP_API_URL: `${GITHUB_URL}/api/v3`,
  // Single sign-on against the fake provider (fake-github.mjs, /oidc)
  OIDC_ISSUER: `${GITHUB_URL}/oidc`,
  OIDC_CLIENT_ID: 'e2e-oidc',
  OIDC_CLIENT_SECRET: 'e2e-oidc-secret',
  OIDC_NAME: 'Acme SSO',
  OIDC_ALLOWED_DOMAINS: 'acme.example,e2e.mavisdraw.dev',
};

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
      env: { ...serverEnv, PORT: API_PORT, CORS_ORIGIN: WEB_URL, APP_URL: WEB_URL },
    },
    {
      command: 'node e2e-real/fake-github.mjs',
      url: `${GITHUB_URL}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: {
        FAKE_GITHUB_PORT: GITHUB_PORT,
        FAKE_GITHUB_APP_ID: '424242',
        FAKE_GITHUB_APP_PUBLIC_KEY: githubAppKey.publicKey,
        FAKE_GITHUB_APP_SLUG: 'mavisdraw-e2e',
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
    {
      command: `pnpm exec vite build --outDir ${SINGLE_SITE_DIST} --emptyOutDir --logLevel warn && pnpm --filter @mavisdraw/server exec tsx src/index.ts`,
      url: `${SINGLE_SITE_URL}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: {
        ...serverEnv,
        PORT: SINGLE_PORT,
        WEB_DIST: SINGLE_SITE_DIST,
        RENDER_EXTERNAL_URL: SINGLE_SITE_URL,
        // Built for the address it's served from: relative API and socket
        VITE_API_URL: '',
        VITE_WS_URL: '',
      },
    },
  ],
});
