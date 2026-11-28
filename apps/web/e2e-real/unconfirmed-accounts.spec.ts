import { test, expect, type APIRequestContext } from '@playwright/test';
import { API_URL, runSql } from './helpers';

const register = (request: APIRequestContext, email: string, password: string, name: string) =>
  request.post(`${API_URL}/api/auth/register`, { data: { email, password, name } });

const aMonthOn = (email: string) =>
  runSql(`update users set created_at = now() - interval '31 days' where email = $1`, [email]);

test.describe('Addresses nobody confirmed', () => {
  test('one left unconfirmed for a month goes to whoever signs up with it next', async ({
    playwright,
  }) => {
    const email = `squatted-${Date.now()}@e2e.mavisdraw.dev`;
    const squatter = await playwright.request.newContext();
    expect((await register(squatter, email, 'squatter-password', 'Squatter')).status()).toBe(201);

    // Too soon: the address is still taken
    const owner = await playwright.request.newContext();
    expect((await register(owner, email, 'owners-own-password', 'Owner')).status()).toBe(409);

    aMonthOn(email);
    const res = await register(owner, email, 'owners-own-password', 'Owner');
    expect(res.status(), await res.text()).toBe(201);
    expect(((await res.json()) as { user: { name: string } }).user.name).toBe('Owner');
    // The old password is gone with the old account
    const old = await squatter.post(`${API_URL}/api/auth/login`, {
      data: { email, password: 'squatter-password' },
    });
    expect(old.status()).toBe(401);
    await squatter.dispose();
    await owner.dispose();
  });

  test('one with work in it is kept (its owner can take it back with a password reset)', async ({
    playwright,
  }) => {
    const email = `busy-${Date.now()}@e2e.mavisdraw.dev`;
    const first = await playwright.request.newContext();
    const res = await register(first, email, 'first-password-1', 'First');
    const { accessToken } = (await res.json()) as { accessToken: string };
    const project = await first.post(`${API_URL}/api/projects`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: { name: 'Their work' },
    });
    expect(project.status()).toBe(201);

    aMonthOn(email);
    const second = await playwright.request.newContext();
    expect((await register(second, email, 'second-password', 'Second')).status()).toBe(409);
    await first.dispose();
    await second.dispose();
  });
});
