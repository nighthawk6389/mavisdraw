import { test, expect } from '@playwright/test';
import { API_URL, apiCreateProject, openProject, registerUser } from './helpers';

const uniq = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

test.describe('Workspaces, invites and folders', () => {
  test('a workspace shares every project with the team', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const a = await ctxA.newPage();
    const b = await ctxB.newPage();
    await registerUser(ctxA, 'Olivia Owner');
    const bob = await registerUser(ctxB, 'Bob Builder');

    // Olivia creates a workspace and adds Bob by email (he has an account)
    await a.goto('/');
    a.once('dialog', (d) => void d.accept(`Acme ${uniq()}`));
    await a.getByRole('button', { name: 'New workspace' }).click();
    await a.getByRole('button', { name: /^Members/ }).click();
    await a.getByLabel('Email to invite').fill(bob.email);
    await a.getByRole('button', { name: 'Invite', exact: true }).click();
    await expect(a.getByTestId('invite-result')).toContainText('was added');
    await expect(
      a.getByTestId('workspace-member').filter({ hasText: 'Bob Builder' }),
    ).toBeVisible();
    await a.getByRole('button', { name: 'Close' }).click();

    // A project made in the workspace…
    await a.getByRole('button', { name: 'New Project' }).click();
    await a.getByPlaceholder('Project name').fill('Team Map');
    await a.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(a.getByTestId('project-card').filter({ hasText: 'Team Map' })).toBeVisible();

    // …is Bob's to open and edit, without sharing it separately
    await b.goto('/');
    await b
      .getByRole('navigation', { name: 'Spaces' })
      .getByRole('button', { name: /Acme/ })
      .click();
    await b.getByText('Team Map', { exact: true }).click();
    await expect(b.locator('canvas').first()).toBeVisible();
    await expect(b.getByTestId('view-only-badge')).toHaveCount(0);

    await ctxA.close();
    await ctxB.close();
  });

  test('inviting someone without an account: they join by signing up from the link', async ({
    browser,
  }) => {
    const ctxA = await browser.newContext();
    const a = await ctxA.newPage();
    const owner = await registerUser(ctxA, 'Olivia Owner');
    await apiCreateProject(ctxA.request, owner, 'Invite Map');
    await openProject(a, 'Invite Map');

    const email = `newcomer-${uniq()}@example.com`;
    await a.getByRole('button', { name: 'Share' }).click();
    await a.getByLabel('Email to invite').fill(email);
    await a.getByRole('button', { name: 'Invite', exact: true }).click();
    const link = await a.getByLabel('Invite link').inputValue();
    expect(link).toMatch(/\/invite\/[A-Za-z0-9_-]+$/);
    await expect(a.getByTestId('pending-invite')).toContainText(email);

    // The newcomer opens the link: told what it's for, and signs up
    const ctxN = await browser.newContext();
    const n = await ctxN.newPage();
    await n.goto(new URL(link).pathname);
    await expect(n.getByTestId('invite-banner')).toContainText('Olivia Owner invited you');
    await expect(n.getByTestId('invite-banner')).toContainText('Invite Map');
    await n.getByPlaceholder('Your name').fill('Nina Newcomer');
    await n.getByPlaceholder('you@example.com').fill(email);
    await n.getByPlaceholder('At least 8 characters').fill('correct-horse-battery');
    await n.getByPlaceholder('Confirm your password').fill('correct-horse-battery');
    await n.getByRole('button', { name: 'Create account' }).click();

    // …and lands in the project, able to edit
    await expect(n.locator('canvas').first()).toBeVisible({ timeout: 15_000 });
    await expect(n).toHaveURL(/\/p\//);
    await expect(n.getByTestId('view-only-badge')).toHaveCount(0);

    await ctxA.close();
    await ctxN.close();
  });

  test('an invite link only works for the address it was sent to', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const owner = await registerUser(ctxA, 'Olivia Owner');
    const project = await apiCreateProject(ctxA.request, owner, 'Private Map');
    const res = await ctxA.request.post(`${API_URL}/api/projects/${project.id}/invites`, {
      headers: { Authorization: `Bearer ${owner.accessToken}` },
      data: { email: `someone-${uniq()}@example.com`, role: 'editor' },
    });
    const { inviteUrl } = (await res.json()) as { inviteUrl: string };

    const ctxM = await browser.newContext();
    const m = await ctxM.newPage();
    await registerUser(ctxM, 'Mallory');
    await m.goto(inviteUrl);
    await expect(m.getByTestId('toast').filter({ hasText: 'This invite is for' })).toBeVisible();
    await expect(m).toHaveURL(/\/$/);
    await expect(m.getByText('Private Map')).toHaveCount(0);

    await ctxA.close();
    await ctxM.close();
  });

  test('projects can be filed in folders', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const user = await registerUser(ctx, 'Folder Fan');
    await apiCreateProject(ctx.request, user, 'Billing');
    await apiCreateProject(ctx.request, user, 'Search');
    await page.goto('/');
    // Folders organise a space (Recent is one list across everything)
    const yours = page.getByRole('navigation', { name: 'Spaces' }).getByRole('button', { name: /Your projects/ });
    await yours.click();

    const card = page.getByTestId('project-card').filter({ hasText: 'Billing' });
    await card.hover();
    page.once('dialog', (d) => void d.accept('Q3 Planning'));
    await card.getByRole('button', { name: 'Folder…' }).click();
    await expect(page.getByTestId('folder-heading')).toContainText('Q3 Planning');

    await page.reload();
    await yours.click();
    const folder = page.getByRole('region', { name: 'Q3 Planning' });
    await expect(folder.getByTestId('project-card')).toHaveText(/Billing/);
    await expect(folder.getByText('Search')).toHaveCount(0);
    await ctx.close();
  });

  test('the owner can hand a project to someone else and stay on as admin', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const a = await ctxA.newPage();
    const owner = await registerUser(ctxA, 'Olivia Owner');
    const bob = await registerUser(ctxB, 'Bob Builder');
    const project = await apiCreateProject(ctxA.request, owner, 'Handover');
    await ctxA.request.post(`${API_URL}/api/projects/${project.id}/invites`, {
      headers: { Authorization: `Bearer ${owner.accessToken}` },
      data: { email: bob.email, role: 'editor' },
    });

    await openProject(a, 'Handover');
    await a.getByRole('button', { name: 'Share' }).click();
    a.once('dialog', (d) => void d.accept());
    await a.getByRole('button', { name: 'Make owner' }).click();
    await expect(a.getByTestId('toast').filter({ hasText: 'now owns this project' })).toBeVisible();

    const roleOf = async (token: string) =>
      (
        (await (
          await ctxA.request.get(`${API_URL}/api/projects/${project.id}`, {
            headers: { Authorization: `Bearer ${token}` },
          })
        ).json()) as { project: { role: string } }
      ).project.role;
    expect(await roleOf(bob.accessToken)).toBe('owner');
    expect(await roleOf(owner.accessToken)).toBe('admin');

    await ctxA.close();
    await ctxB.close();
  });
});
