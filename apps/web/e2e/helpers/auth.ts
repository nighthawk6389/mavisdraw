import type { Page, ConsoleMessage } from '@playwright/test';

const TEST_USER = {
  id: 'test-user-id',
  email: 'demo@mavisdraw.dev',
  name: 'Test User',
  avatarUrl: null,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
};

const TEST_PROJECT = {
  id: 'test-project-id',
  name: 'Test Project',
  ownerId: TEST_USER.id,
  rootDiagramId: 'root-diagram',
  isPublic: false,
  thumbnailUrl: null,
  role: 'owner',
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
};

const TEST_DIAGRAM = {
  id: 'root-diagram',
  projectId: TEST_PROJECT.id,
  parentDiagramId: null,
  parentPortalId: null,
  title: 'Root Diagram',
  elements: [],
  viewBackgroundColor: '#ffffff',
  gridEnabled: true,
  gridSize: 20,
  renderMode: 'clean',
  layers: [{ id: 'default', name: 'Layer 1', visible: true, locked: false }],
  createdBy: TEST_USER.id,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
};

/**
 * Mock all API endpoints needed for auth + dashboard, navigate to '/',
 * then click into the test project so the editor (canvas) is visible.
 */
export async function mockAuthAndOpenEditor(page: Page) {
  // Auth endpoints
  await page.route('**/api/auth/refresh', (route) =>
    route.fulfill({ status: 200, json: { accessToken: 'fake-token' } }),
  );
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ status: 200, json: { user: TEST_USER } }),
  );

  // Dashboard endpoint
  await page.route('**/api/projects', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ status: 200, json: { projects: [TEST_PROJECT] } });
    }
    return route.continue();
  });

  // Editor endpoints — diagram listing & fetching + auto-save PUT
  await page.route(`**/api/projects/${TEST_PROJECT.id}/diagrams`, (route) =>
    route.fulfill({ status: 200, json: { diagrams: [TEST_DIAGRAM] } }),
  );
  await page.route('**/api/diagrams/**', (route) =>
    route.fulfill({ status: 200, json: { diagram: TEST_DIAGRAM } }),
  );

  await page.goto('/');

  // Click the project card to enter the editor
  await page.locator('text=Test Project').click();

  // Wait for the canvas to be ready
  await page.waitForSelector('canvas', { state: 'visible' });
}

/** Patterns to ignore when collecting console errors in e2e tests. */
const IGNORED_ERROR_PATTERNS = [/WebSocket connection.*failed/i, /ERR_CONNECTION_REFUSED/i];

/** Returns true if the error message is a known harmless error (e.g. WebSocket to missing backend). */
export function isHarmlessError(msg: string): boolean {
  return IGNORED_ERROR_PATTERNS.some((p) => p.test(msg));
}

/**
 * Collect console errors from the page, filtering out harmless ones
 * (e.g. WebSocket connection failures when no backend is running).
 */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => {
    if (!isHarmlessError(err.message)) errors.push(err.message);
  });
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error' && !isHarmlessError(msg.text())) {
      errors.push(msg.text());
    }
  });
  return errors;
}
