import { test, expect } from '@playwright/test';

test.describe('Dev Auto-Login', () => {
  test('auto-logs in as demo user in dev mode and shows dashboard', async ({ page }) => {
    const authLogs: string[] = [];
    page.on('console', (msg) => {
      if (msg.text().startsWith('[auth]')) {
        authLogs.push(msg.text());
      }
    });

    // No session yet; the demo login succeeds (mocked: this suite has no backend)
    const demoUser = {
      id: 'demo-user',
      email: 'demo@mavisdraw.dev',
      name: 'Demo User',
      avatarUrl: null,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    };
    await page.route('**/api/auth/refresh', (route) =>
      route.fulfill({ status: 401, json: { error: 'No session' } }),
    );
    await page.route('**/api/auth/login', (route) =>
      route.fulfill({ status: 200, json: { user: demoUser, accessToken: 'demo-token' } }),
    );
    await page.route('**/api/projects', (route) =>
      route.fulfill({ status: 200, json: { projects: [] } }),
    );

    await page.goto('/');

    // Wait for the dashboard to appear (auto-login should kick in)
    await page.waitForSelector('text=Projects', { timeout: 10000 });

    // Should NOT see login form
    const loginForm = page.locator('form').filter({ hasText: /sign in|log in/i });
    await expect(loginForm).not.toBeVisible();

    // Should see the logged-in user name
    await expect(page.locator('text=Demo User')).toBeVisible();

    // Should see the dashboard
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();

    // Verify auth logs show dev auto-login path
    expect(authLogs.some((l) => l.includes('Dev auto-login succeeded'))).toBe(true);
  });

  test('shows login page when auto-login fails', async ({ page }) => {
    // Block all auth endpoints to simulate backend down
    await page.route('**/api/auth/**', (route) =>
      route.fulfill({ status: 500, json: { error: 'Server error' } }),
    );

    await page.goto('/');

    // Should see login form (once auto-login has given up)
    const emailInput = page.locator('input[type="email"], input[name="email"]');
    await expect(emailInput).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('heading', { name: 'Projects' })).toHaveCount(0);
  });
});
