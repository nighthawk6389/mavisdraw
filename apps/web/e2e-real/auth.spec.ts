import { test, expect } from '@playwright/test';
import { API_URL } from './helpers';

function refreshCookie(setCookie: string | undefined): string {
  const match = /refreshToken=([^;]+)/.exec(setCookie ?? '');
  if (!match) throw new Error(`no refresh cookie in: ${setCookie}`);
  return match[1];
}

test.describe('Session refresh', () => {
  test('a just-rotated refresh token still works (aborted responses, many tabs)', async ({
    playwright,
  }) => {
    // Each call from a cookie-less client, so only the explicit token is sent
    const post = async (path: string, data: unknown) => {
      const ctx = await playwright.request.newContext();
      const res = await ctx.post(`${API_URL}${path}`, { data });
      const result = {
        status: res.status(),
        setCookie: res.headers()['set-cookie'],
        body: (await res.json()) as { accessToken?: string },
      };
      await ctx.dispose();
      return result;
    };
    const email = `rotate-${Date.now()}@e2e.mavisdraw.dev`;
    const reg = await post('/api/auth/register', {
      email,
      password: 'correct-horse-battery',
      name: 'Rotator',
    });
    expect(reg.status).toBe(201);
    const original = refreshCookie(reg.setCookie);

    // First refresh rotates the token
    const first = await post('/api/auth/refresh', { refreshToken: original });
    expect(first.status).toBe(200);
    const rotated = refreshCookie(first.setCookie);
    expect(rotated).not.toBe(original);

    // The browser never got that response: it retries with the old token
    const retry = await post('/api/auth/refresh', { refreshToken: original });
    expect(retry.status).toBe(200);
    // ...and is handed the session's current token, not a fork
    expect(refreshCookie(retry.setCookie)).toBe(rotated);
    expect(retry.body.accessToken).toBeTruthy();
  });

  test('an unknown refresh token is rejected', async ({ request }) => {
    const res = await request.post(`${API_URL}/api/auth/refresh`, {
      data: { refreshToken: 'not-a-real-token' },
    });
    expect(res.status()).toBe(401);
  });
});
