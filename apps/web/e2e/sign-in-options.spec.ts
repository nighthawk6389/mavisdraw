import { test, expect, type Page } from '@playwright/test';

/**
 * The sign-in page offers what the server does (GET /api/config): a button
 * for the server's single sign-on, password forms unless it's SSO-only, and
 * why a sign-in with the provider came back without signing in.
 */

async function signedOutServer(
  page: Page,
  config: { sso: { name: string } | null; passwordLogin: boolean },
) {
  // No session, and the dev auto-login gives up
  await page.route('**/api/auth/**', (route) =>
    route.fulfill({ status: 401, json: { error: 'No session' } }),
  );
  await page.route('**/api/config', (route) =>
    route.fulfill({ status: 200, json: { mail: true, ...config } }),
  );
}

const emailField = (page: Page) => page.locator('input[type="email"]');

test.describe('Sign-in options', () => {
  test('a server with single sign-on and passwords offers both', async ({ page }) => {
    await signedOutServer(page, { sso: { name: 'Acme SSO' }, passwordLogin: true });
    await page.goto('/');
    await expect(page.getByTestId('sso-button')).toHaveText('Sign in with Acme SSO');
    await expect(page.getByText('or with your email')).toBeVisible();
    await expect(emailField(page)).toBeVisible();
  });

  test('an SSO-only server shows just the provider, and the button goes there', async ({
    page,
  }) => {
    await signedOutServer(page, { sso: { name: 'Acme SSO' }, passwordLogin: false });
    let started: URL | null = null;
    await page.route('**/api/auth/oidc/start**', (route) => {
      started = new URL(route.request().url());
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<p>provider</p>' });
    });
    await page.goto('/?view=recent');
    await expect(page.getByTestId('sso-button')).toBeVisible();
    await expect(emailField(page)).toHaveCount(0);
    await expect(page.getByText('or with your email')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /create an account|sign up/i })).toHaveCount(0);

    await page.getByTestId('sso-button').click();
    await expect(page.getByText('provider')).toBeVisible();
    // Comes back to the page it started from
    expect(started!.searchParams.get('next')).toBe('/?view=recent');
  });

  test('a server without single sign-on shows no button', async ({ page }) => {
    await signedOutServer(page, { sso: null, passwordLogin: true });
    await page.goto('/');
    await expect(emailField(page)).toBeVisible();
    await expect(page.getByTestId('sso-button')).toHaveCount(0);
  });

  test('says why a sign-in with the provider did not go through, once', async ({ page }) => {
    await signedOutServer(page, { sso: { name: 'Acme SSO' }, passwordLogin: true });
    await page.goto('/?sso_error=email');
    await expect(page.getByTestId('sso-error')).toHaveText(
      'Acme SSO didn’t share a verified email address for your account.',
    );
    // The code is taken out of the address, so a reload doesn't repeat it
    await expect(page).toHaveURL(/\/$/);
    await page.reload();
    await expect(page.getByTestId('sso-button')).toBeVisible();
    await expect(page.getByTestId('sso-error')).toHaveCount(0);
  });
});
