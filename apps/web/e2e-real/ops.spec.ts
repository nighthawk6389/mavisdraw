import { test, expect } from '@playwright/test';
import { API_URL } from './helpers';

test.describe('Operations', () => {
  test('readiness reflects the database; liveness is just the process', async ({ request }) => {
    const ready = await request.get(`${API_URL}/api/ready`);
    expect(ready.status()).toBe(200);
    expect(await ready.json()).toEqual({ ready: true, checks: { database: 'ok' } });
    expect((await request.get(`${API_URL}/api/health`)).status()).toBe(200);
  });

  test('every response carries a request id the browser can read', async ({ page }) => {
    await page.goto('/');
    const id = await page.evaluate(async (api) => {
      const res = await fetch(`${api}/api/health`, { credentials: 'include' });
      return res.headers.get('x-request-id');
    }, API_URL);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('errors explain client mistakes but never leak internals', async ({ request }) => {
    const res = await request.post(`${API_URL}/api/auth/login`, {
      data: { email: 'not-an-email' },
    });
    expect(res.status()).toBe(400);
    const body = (await res.json()) as { error: string; requestId?: string };
    expect(body.error).toBeTruthy();
    expect(res.headers()['x-request-id']).toBeTruthy();
  });
});
