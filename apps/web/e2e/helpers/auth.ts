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

export { TEST_USER, TEST_PROJECT, TEST_DIAGRAM };

/**
 * Mock every API endpoint a signed-in session uses (auth, dashboard, the
 * test project and its diagram). Routes added afterwards take precedence,
 * so a test can override one endpoint (e.g. make saves fail).
 */
export async function mockSignedIn(page: Page) {
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

  // Opening a project (router: /p/:id) fetches it, including the caller's role
  await page.route(`**/api/projects/${TEST_PROJECT.id}`, (route) =>
    route.fulfill({ status: 200, json: { project: TEST_PROJECT } }),
  );

  // Workspaces (none), comments, proposals, members and notifications (empty by default)
  await page.route('**/api/workspaces', (route) =>
    route.fulfill({ status: 200, json: { workspaces: [] } }),
  );
  await page.route(`**/api/projects/${TEST_PROJECT.id}/comments`, (route) =>
    route.fulfill({ status: 200, json: { threads: [] } }),
  );
  await page.route(`**/api/projects/${TEST_PROJECT.id}/proposals`, (route) =>
    route.fulfill({ status: 200, json: { proposals: [] } }),
  );
  await page.route(`**/api/projects/${TEST_PROJECT.id}/members`, (route) =>
    route.fulfill({
      status: 200,
      json: { members: [{ id: TEST_USER.id, name: TEST_USER.name, avatarUrl: null }] },
    }),
  );
  await page.route('**/api/notifications', (route) =>
    route.fulfill({ status: 200, json: { notifications: [], unreadCount: 0 } }),
  );

  // Editor endpoints — diagram listing & fetching + auto-save PUT
  await page.route(`**/api/projects/${TEST_PROJECT.id}/diagrams`, (route) =>
    route.fulfill({ status: 200, json: { diagrams: [TEST_DIAGRAM] } }),
  );
  await page.route('**/api/diagrams/**', (route) =>
    route.fulfill({ status: 200, json: { diagram: TEST_DIAGRAM } }),
  );
  // Shared version history (in-memory per page)
  const snapshots: Record<string, unknown>[] = [];
  await page.route('**/api/diagrams/*/snapshots**', (route) =>
    route.fulfill({ status: 200, json: { snapshots } }),
  );
  await page.route('**/api/diagrams/*/save', (route) => {
    const body = (route.request().postDataJSON() ?? {}) as { trigger?: string; label?: string };
    const snapshot = {
      id: `snap-${snapshots.length + 1}`,
      diagramId: TEST_DIAGRAM.id,
      version: snapshots.length + 1,
      label: body.label ?? null,
      trigger: body.trigger ?? 'manual',
      createdBy: TEST_USER.id,
      elementCount: 0,
      createdAt: new Date().toISOString(),
    };
    snapshots.unshift(snapshot);
    return route.fulfill({ status: 201, json: { snapshot } });
  });
  // Nested diagrams are created on the server as soon as a portal is drawn
  await page.route('**/api/diagrams', (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown> | null;
    return route.fulfill({
      status: 201,
      json: { diagram: { ...TEST_DIAGRAM, ...body, elements: [] } },
    });
  });
}

/**
 * Mock all API endpoints needed for auth + dashboard, navigate to '/',
 * then click into the test project so the editor (canvas) is visible.
 */
export async function mockAuthAndOpenEditor(page: Page) {
  await mockSignedIn(page);
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
