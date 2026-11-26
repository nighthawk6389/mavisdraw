import type { APIRequestContext, BrowserContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';

export const API_URL = `http://localhost:${process.env.E2E_API_PORT ?? '3101'}`;

export interface TestUser {
  email: string;
  password: string;
  name: string;
  accessToken: string;
}

let counter = 0;

/** Unique, human-readable test email. */
function uniqueEmail(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}-${Math.random().toString(36).slice(2, 7)}@e2e.mavisdraw.dev`;
}

/**
 * Register a brand-new user through the real API using the browser context's
 * request client, so the httpOnly refresh cookie lands in the context's jar
 * and the app's startup refresh logs the user in.
 */
export async function registerUser(
  context: BrowserContext,
  name = 'E2E User',
  prefix = 'user',
): Promise<TestUser> {
  const email = uniqueEmail(prefix);
  const password = 'correct-horse-battery';
  const res = await context.request.post(`${API_URL}/api/auth/register`, {
    data: { email, password, name },
  });
  expect(res.status(), await res.text()).toBe(201);
  const body = (await res.json()) as { accessToken: string };
  return { email, password, name, accessToken: body.accessToken };
}

export async function apiCreateProject(
  request: APIRequestContext,
  user: TestUser,
  name: string,
): Promise<{ id: string; rootDiagramId: string }> {
  const res = await request.post(`${API_URL}/api/projects`, {
    headers: { Authorization: `Bearer ${user.accessToken}` },
    data: { name },
  });
  expect(res.status(), await res.text()).toBe(201);
  const body = (await res.json()) as { project: { id: string; rootDiagramId: string } };
  return body.project;
}

export async function apiGetDiagram(
  request: APIRequestContext,
  user: TestUser,
  diagramId: string,
): Promise<{ status: number; diagram?: { elements: Array<Record<string, unknown>> } }> {
  const res = await request.get(`${API_URL}/api/diagrams/${diagramId}`, {
    headers: { Authorization: `Bearer ${user.accessToken}` },
  });
  if (!res.ok()) return { status: res.status() };
  const body = (await res.json()) as { diagram: { elements: Array<Record<string, unknown>> } };
  return { status: res.status(), diagram: body.diagram };
}

export async function apiListDiagrams(
  request: APIRequestContext,
  user: TestUser,
  projectId: string,
): Promise<Array<{ id: string; parentDiagramId: string | null; title: string }>> {
  const res = await request.get(`${API_URL}/api/projects/${projectId}/diagrams`, {
    headers: { Authorization: `Bearer ${user.accessToken}` },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  const body = (await res.json()) as {
    diagrams: Array<{ id: string; parentDiagramId: string | null; title: string }>;
  };
  return body.diagrams;
}

/** Open the dashboard and click into a project by name. */
export async function openProject(page: Page, projectName: string): Promise<void> {
  await page.goto('/');
  await page.getByText(projectName, { exact: true }).click();
  await expect(page.locator('canvas').first()).toBeVisible();
}

/** The interactive (top) canvas receives pointer events. */
export function interactiveCanvas(page: Page) {
  return page.locator('canvas').nth(1);
}

/** Drag on the canvas in page coordinates relative to the canvas box. */
export async function dragOnCanvas(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 8,
): Promise<void> {
  const box = await interactiveCanvas(page).boundingBox();
  if (!box) throw new Error('canvas not visible');
  await page.mouse.move(box.x + from.x, box.y + from.y);
  await page.mouse.down();
  await page.mouse.move(box.x + to.x, box.y + to.y, { steps });
  await page.mouse.up();
}

/** Read elements of the active diagram from the dev-only test hook. */
export async function getActiveElements(
  page: Page,
): Promise<Array<{ id: string; type: string; x: number; y: number; width: number; height: number; [k: string]: unknown }>> {
  return page.evaluate(() => {
    const hook = (window as unknown as { __MAVISDRAW__?: { getActiveElements: () => unknown[] } })
      .__MAVISDRAW__;
    if (!hook) throw new Error('__MAVISDRAW__ test hook missing (dev build only)');
    return hook.getActiveElements() as never;
  });
}

/** Wait until the save indicator reports a successful save. */
export async function waitForSaved(page: Page): Promise<void> {
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 15_000 });
}
