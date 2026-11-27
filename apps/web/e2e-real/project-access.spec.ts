import { test, expect, type APIRequestContext } from '@playwright/test';
import { API_URL, apiCreateProject, isConnected, registerUser, type TestUser } from './helpers';

/**
 * Access that came from where a project lives (a workspace, or being public)
 * ends for open tabs as soon as that changes — not at their next reload.
 */

const uniq = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function updateProject(
  request: APIRequestContext,
  owner: TestUser,
  projectId: string,
  data: Record<string, unknown>,
) {
  const res = await request.put(`${API_URL}/api/projects/${projectId}`, {
    headers: { Authorization: `Bearer ${owner.accessToken}` },
    data,
  });
  expect(res.status(), await res.text()).toBe(200);
}

test.describe('Who can reach a project, and what they see', () => {
  test('a teammate is disconnected when the project leaves the workspace', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const owner = await registerUser(ctxA, 'Olivia Owner');
    const auth = { Authorization: `Bearer ${owner.accessToken}` };
    const ws = await ctxA.request.post(`${API_URL}/api/workspaces`, {
      headers: auth,
      data: { name: `Acme ${uniq()}` },
    });
    const { workspace } = (await ws.json()) as { workspace: { id: string } };

    const ctxB = await browser.newContext();
    const b = await ctxB.newPage();
    const bob = await registerUser(ctxB, 'Bob Builder');
    const added = await ctxA.request.post(`${API_URL}/api/workspaces/${workspace.id}/invites`, {
      headers: auth,
      data: { email: bob.email, role: 'member' },
    });
    expect(((await added.json()) as { status: string }).status).toBe('added');

    const project = await apiCreateProject(ctxA.request, owner, `Team Map ${uniq()}`);
    await updateProject(ctxA.request, owner, project.id, { workspaceId: workspace.id });

    // Bob has it open, live, through the workspace
    await b.goto(`/p/${project.id}`);
    await expect(b.locator('canvas').first()).toBeVisible();
    await isConnected(b);

    // Olivia takes it back to her personal space
    await updateProject(ctxA.request, owner, project.id, { workspaceId: null });
    await expect(b.getByTestId('toast').filter({ hasText: 'no longer have access' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(b).toHaveURL(/\/$/);

    await ctxA.close();
    await ctxB.close();
  });

  test('a passer-by viewing a public project is disconnected when it goes private', async ({
    browser,
  }) => {
    const ctxA = await browser.newContext();
    const owner = await registerUser(ctxA, 'Olivia Owner');
    const project = await apiCreateProject(ctxA.request, owner, `Open Map ${uniq()}`);
    await updateProject(ctxA.request, owner, project.id, { isPublic: true });

    const ctxC = await browser.newContext();
    const c = await ctxC.newPage();
    await registerUser(ctxC, 'Casey Curious');
    await c.goto(`/p/${project.id}`);
    await expect(c.getByTestId('view-only-badge')).toBeVisible({ timeout: 15_000 });
    await isConnected(c);

    await updateProject(ctxA.request, owner, project.id, { isPublic: false });
    await expect(c.getByTestId('toast').filter({ hasText: 'no longer have access' })).toBeVisible({
      timeout: 15_000,
    });

    await ctxA.close();
    await ctxC.close();
  });

  test('people viewing a public project see collaborators by name, not email', async ({
    browser,
  }) => {
    const ctxA = await browser.newContext();
    const owner = await registerUser(ctxA, 'Olivia Owner');
    const project = await apiCreateProject(ctxA.request, owner, `Public Map ${uniq()}`);
    await updateProject(ctxA.request, owner, project.id, { isPublic: true });
    const ctxD = await browser.newContext();
    const dana = await registerUser(ctxD, 'Dana Designer');
    const invited = await ctxA.request.post(`${API_URL}/api/projects/${project.id}/invites`, {
      headers: { Authorization: `Bearer ${owner.accessToken}` },
      data: { email: dana.email, role: 'editor' },
    });
    expect(invited.status()).toBe(201);

    const list = async (request: APIRequestContext, user: TestUser) => {
      const res = await request.get(`${API_URL}/api/projects/${project.id}/permissions`, {
        headers: { Authorization: `Bearer ${user.accessToken}` },
      });
      expect(res.status()).toBe(200);
      return (
        (await res.json()) as {
          permissions: Array<{ name: string | null; email: string | null }>;
        }
      ).permissions;
    };
    const ctxC = await browser.newContext();
    const casey = await registerUser(ctxC, 'Casey Curious');
    expect(await list(ctxC.request, casey)).toEqual([
      expect.objectContaining({ name: 'Dana Designer', email: null }),
    ]);
    // Dana sees her own address; the owner sees everyone's
    expect(await list(ctxD.request, dana)).toEqual([
      expect.objectContaining({ name: 'Dana Designer', email: dana.email }),
    ]);
    expect(await list(ctxA.request, owner)).toEqual([
      expect.objectContaining({ name: 'Dana Designer', email: dana.email }),
    ]);

    await ctxA.close();
    await ctxC.close();
    await ctxD.close();
  });
});
