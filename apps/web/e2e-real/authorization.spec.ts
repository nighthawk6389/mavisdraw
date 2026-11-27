import { test, expect, type APIRequestContext, type APIResponse } from '@playwright/test';
import {
  addToProject,
  addToWorkspace,
  as,
  createProject,
  createWorkspace,
  expectJson,
  permissionsOf,
  roleIn,
  signUp,
  uniq,
  type Person,
} from './api';
import { API_URL, confirmEmail } from './helpers';

/**
 * Who may do what, checked against the real API and database. Every route
 * is called by everyone in a team — owner, a project admin, editor and
 * viewer, a workspace admin and member, and an outsider — and must allow
 * exactly the people whose role is high enough.
 */

type Role = 'viewer' | 'editor' | 'admin' | 'owner';
const RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };

interface Team {
  owner: Person;
  admin: Person;
  editor: Person;
  viewer: Person;
  wsAdmin: Person;
  wsMember: Person;
  outsider: Person;
  workspaceId: string;
  project: { id: string; rootDiagramId: string };
}

/** Each person and the role they should end up with in the team's project. */
const EXPECTED_ROLE: Record<keyof Omit<Team, 'workspaceId' | 'project'>, Role | null> = {
  owner: 'owner',
  admin: 'admin',
  editor: 'editor',
  viewer: 'viewer',
  // Workspace admins administer its projects; members edit them
  wsAdmin: 'admin',
  wsMember: 'editor',
  outsider: null,
};
const PEOPLE = Object.keys(EXPECTED_ROLE) as Array<keyof typeof EXPECTED_ROLE>;

async function makeTeam(api: APIRequestContext): Promise<Team> {
  const [owner, admin, editor, viewer, wsAdmin, wsMember, outsider] = await Promise.all(
    ['Owner', 'Admin', 'Editor', 'Viewer', 'WS Admin', 'WS Member', 'Outsider'].map((n) =>
      signUp(api, n),
    ),
  );
  const ws = await createWorkspace(api, owner, `Team ${uniq()}`);
  await addToWorkspace(api, owner, ws.id, wsAdmin, 'admin');
  await addToWorkspace(api, owner, ws.id, wsMember, 'member');
  const project = await createProject(api, owner, `Map ${uniq()}`, ws.id);
  await addToProject(api, owner, project.id, admin, 'admin');
  await addToProject(api, owner, project.id, editor, 'editor');
  await addToProject(api, owner, project.id, viewer, 'viewer');
  return { owner, admin, editor, viewer, wsAdmin, wsMember, outsider, workspaceId: ws.id, project };
}

/**
 * Call a route as everyone: people below `min` (and the outsider) must be
 * refused with `denied`, everyone else must get `allowed`.
 */
async function expectOnly(
  api: APIRequestContext,
  team: Team,
  min: Role,
  call: (client: ReturnType<typeof as>) => Promise<APIResponse>,
  { allowed = [200], denied = 403 }: { allowed?: number[]; denied?: number } = {},
) {
  const results: string[] = [];
  const expected: string[] = [];
  for (const person of PEOPLE) {
    const role = EXPECTED_ROLE[person];
    const ok = role !== null && RANK[role] >= RANK[min];
    const res = await call(as(api, team[person]));
    const status = res.status();
    results.push(`${person}: ${ok ? (allowed.includes(status) ? 'allowed' : status) : status}`);
    expected.push(`${person}: ${ok ? 'allowed' : denied}`);
  }
  expect(results).toEqual(expected);
}

test.describe('Authorization (API)', () => {
  test('everyone gets the role their share or workspace membership grants', async ({ request }) => {
    const team = await makeTeam(request);
    for (const person of PEOPLE) {
      const expected = EXPECTED_ROLE[person];
      expect(await roleIn(request, team[person], team.project.id), person).toBe(expected ?? 403);
      // …and the dashboard lists it (with that role) exactly for them
      const { projects } = await expectJson<{ projects: Array<{ id: string; role: string }> }>(
        as(request, team[person]).get('/api/projects'),
        200,
      );
      expect(projects.find((p) => p.id === team.project.id)?.role ?? null, person).toBe(expected);
    }
    expect(await roleIn(request, team.owner, `missing-${uniq()}`)).toBe(404);
  });

  test('reading needs any role; outsiders are refused everywhere', async ({ request }) => {
    const team = await makeTeam(request);
    const { id, rootDiagramId } = team.project;
    const snapshot = (
      await expectJson<{ snapshot: { id: string } }>(
        as(request, team.owner).post(`/api/diagrams/${rootDiagramId}/save`, { label: 'v1' }),
        201,
      )
    ).snapshot;
    for (const path of [
      `/api/projects/${id}`,
      `/api/projects/${id}/diagrams`,
      `/api/projects/${id}/members`,
      `/api/projects/${id}/comments`,
      `/api/projects/${id}/proposals`,
      `/api/projects/${id}/tour`,
      `/api/projects/${id}/presentation`,
      `/api/projects/${id}/permissions`,
      `/api/diagrams/${rootDiagramId}`,
      `/api/diagrams/${rootDiagramId}/snapshots`,
      `/api/diagrams/${rootDiagramId}/snapshots/${snapshot.id}`,
    ]) {
      await test.step(path, () => expectOnly(request, team, 'viewer', (c) => c.get(path)));
    }
  });

  test('editing needs editor or above, and refused writes change nothing', async ({ request }) => {
    const team = await makeTeam(request);
    const { id, rootDiagramId } = team.project;
    const rect = (n: number) => ({
      id: `rect-${n}`,
      type: 'rectangle',
      x: n * 10,
      y: 0,
      width: 50,
      height: 40,
      version: 1,
      isDeleted: false,
      diagramId: rootDiagramId,
    });
    let n = 0;
    const snapshotId = (
      await expectJson<{ snapshot: { id: string } }>(
        as(request, team.owner).post(`/api/diagrams/${rootDiagramId}/save`, {}),
        201,
      )
    ).snapshot.id;

    const cases: Array<[string, (c: ReturnType<typeof as>) => Promise<APIResponse>, number[]?]> = [
      [
        'save the diagram',
        (c) => c.put(`/api/diagrams/${rootDiagramId}`, { elements: [rect(++n)] }),
      ],
      ['rename the diagram', (c) => c.put(`/api/diagrams/${rootDiagramId}`, { title: `T${++n}` })],
      [
        'add a nested diagram',
        (c) => c.post('/api/diagrams', { projectId: id, parentDiagramId: rootDiagramId }),
        [201],
      ],
      ['save a version', (c) => c.post(`/api/diagrams/${rootDiagramId}/save`, {}), [201]],
      [
        'restore a version',
        (c) => c.post(`/api/diagrams/${rootDiagramId}/snapshots/${snapshotId}/restore`, {}),
      ],
      ['change the tour', (c) => c.put(`/api/projects/${id}/tour`, { stops: [] })],
      ['file it in a folder', (c) => c.put(`/api/projects/${id}`, { folder: `F${++n}` })],
      [
        'link it to a folder it was generated from',
        (c) =>
          c.put(`/api/projects/${id}/repo`, {
            kind: 'folder',
            label: 'shop',
            model: { name: 'shop', components: [], resources: [] },
          }),
      ],
    ];
    for (const [what, call, allowed] of cases) {
      await test.step(what, () => expectOnly(request, team, 'editor', call, { allowed }));
    }

    // Nothing a viewer or outsider sent reached the diagram
    const before = await expectJson<{ diagram: { title: string; elements: unknown[] } }>(
      as(request, team.owner).get(`/api/diagrams/${rootDiagramId}`),
      200,
    );
    for (const who of [team.viewer, team.outsider]) {
      const c = as(request, who);
      expect((await c.put(`/api/diagrams/${rootDiagramId}`, { title: 'Hijacked' })).status()).toBe(
        403,
      );
      expect(
        (await c.put(`/api/diagrams/${rootDiagramId}`, { elements: [rect(999)] })).status(),
      ).toBe(403);
      expect((await c.delete(`/api/diagrams/${rootDiagramId}`)).status()).toBe(403);
    }
    const after = await expectJson<{ diagram: { title: string; elements: unknown[] } }>(
      as(request, team.owner).get(`/api/diagrams/${rootDiagramId}`),
      200,
    );
    expect(after.diagram).toEqual(before.diagram);
  });

  test('anyone on the project can comment and present; outsiders cannot', async ({ request }) => {
    const team = await makeTeam(request);
    const { id, rootDiagramId } = team.project;
    await expectOnly(
      request,
      team,
      'viewer',
      (c) => c.post(`/api/diagrams/${rootDiagramId}/comments`, { x: 1, y: 2, body: 'Why?' }),
      { allowed: [201] },
    );
    await expectOnly(request, team, 'viewer', (c) =>
      c.put(`/api/projects/${id}/presentation`, { stop: 0 }),
    );
  });

  test('sharing, invites and embeds are for owners and admins', async ({ request }) => {
    const team = await makeTeam(request);
    const { id } = team.project;
    const cases: Array<[string, (c: ReturnType<typeof as>) => Promise<APIResponse>, number[]?]> = [
      [
        'create a share link',
        (c) => c.post(`/api/projects/${id}/share`, { role: 'viewer' }),
        [201],
      ],
      ['list invites', (c) => c.get(`/api/projects/${id}/invites`)],
      [
        'invite an editor',
        (c) =>
          c.post(`/api/projects/${id}/invites`, {
            email: `x-${uniq()}@example.com`,
            role: 'editor',
          }),
        [201],
      ],
      ['see the embed', (c) => c.get(`/api/projects/${id}/embed`)],
      ['publish an embed', (c) => c.post(`/api/projects/${id}/embed`, {}), [201]],
      ['unpublish the embed', (c) => c.delete(`/api/projects/${id}/embed`), [204]],
    ];
    for (const [what, call, allowed] of cases) {
      await test.step(what, () => expectOnly(request, team, 'admin', call, { allowed }));
    }

    // Changing and removing someone's access
    const perms = await permissionsOf(request, team.owner, id);
    const viewerPerm = perms.find((p) => p.userId === team.viewer.id)!;
    await expectOnly(request, team, 'admin', (c) =>
      c.put(`/api/permissions/${viewerPerm.id}`, { role: 'viewer' }),
    );
    // Revoking is checked on a throwaway share link (a revoke can only succeed once)
    for (const who of [team.editor, team.wsMember, team.viewer, team.outsider]) {
      const link = (
        await expectJson<{ share: { id: string } }>(
          as(request, team.owner).post(`/api/projects/${id}/share`, { role: 'viewer' }),
          201,
        )
      ).share;
      expect((await as(request, who).delete(`/api/permissions/${link.id}`)).status()).toBe(403);
      expect((await as(request, team.admin).delete(`/api/permissions/${link.id}`)).status()).toBe(
        200,
      );
    }
  });

  test('share tokens are only shown to people who can manage sharing', async ({ request }) => {
    const team = await makeTeam(request);
    const { id } = team.project;
    const link = (
      await expectJson<{ share: { shareToken: string } }>(
        as(request, team.owner).post(`/api/projects/${id}/share`, { role: 'editor' }),
        201,
      )
    ).share;
    for (const person of PEOPLE) {
      const role = EXPECTED_ROLE[person];
      if (!role) continue;
      const listed = JSON.stringify(await permissionsOf(request, team[person], id));
      expect(listed.includes(link.shareToken), person).toBe(RANK[role] >= RANK.admin);
    }
  });

  test('only the owner renames, publishes, transfers, deletes or hands out admin', async ({
    request,
  }) => {
    const team = await makeTeam(request);
    const { id } = team.project;
    await expectOnly(request, team, 'owner', (c) => c.put(`/api/projects/${id}`, { name: 'New' }));
    await expectOnly(request, team, 'owner', (c) =>
      c.put(`/api/projects/${id}`, { isPublic: false }),
    );
    await expectOnly(
      request,
      team,
      'owner',
      (c) =>
        c.post(`/api/projects/${id}/invites`, { email: `a-${uniq()}@example.com`, role: 'admin' }),
      { allowed: [201] },
    );

    // An admin can't make another admin by changing an existing share either
    const editorPerm = (await permissionsOf(request, team.owner, id)).find(
      (p) => p.userId === team.editor.id,
    )!;
    for (const who of [team.admin, team.wsAdmin]) {
      const res = await as(request, who).put(`/api/permissions/${editorPerm.id}`, {
        role: 'admin',
      });
      expect(res.status(), await res.text()).toBe(403);
    }
    expect(await roleIn(request, team.editor, id)).toBe('editor');
    expect(
      (
        await as(request, team.owner).put(`/api/permissions/${editorPerm.id}`, { role: 'admin' })
      ).status(),
    ).toBe(200);
    expect(await roleIn(request, team.editor, id)).toBe('admin');

    for (const who of [team.admin, team.wsAdmin, team.viewer, team.outsider]) {
      expect(
        (await as(request, who).post(`/api/projects/${id}/transfer`, { userId: who.id })).status(),
      ).toBe(403);
      expect((await as(request, who).delete(`/api/projects/${id}`)).status()).toBe(403);
    }
    expect(await roleIn(request, team.owner, id)).toBe('owner');
    await expectJson(as(request, team.owner).delete(`/api/projects/${id}`), 200);
    expect(await roleIn(request, team.owner, id)).toBe(404);
  });

  test('share links: join, upgrade but never downgrade, and stop working when revoked', async ({
    request,
  }) => {
    const owner = await signUp(request, 'Owner');
    const [early, late, editor] = await Promise.all([
      signUp(request, 'Early'),
      signUp(request, 'Late'),
      signUp(request, 'Editor'),
    ]);
    const project = await createProject(request, owner, `Links ${uniq()}`);
    await addToProject(request, owner, project.id, editor, 'editor');
    const link = (
      await expectJson<{ share: { id: string; shareToken: string } }>(
        as(request, owner).post(`/api/projects/${project.id}/share`, { role: 'viewer' }),
        201,
      )
    ).share;

    expect(await expectJson(as(request, early).post(`/api/share/${link.shareToken}`), 200)).toEqual(
      { projectId: project.id, role: 'viewer' },
    );
    expect(await roleIn(request, early, project.id)).toBe('viewer');
    // A viewer link never downgrades someone who can already edit
    await expectJson(as(request, editor).post(`/api/share/${link.shareToken}`), 200);
    expect(await roleIn(request, editor, project.id)).toBe('editor');
    // The owner following their own link stays the owner, and isn't listed as a viewer
    await expectJson(as(request, owner).post(`/api/share/${link.shareToken}`), 200);
    expect(await roleIn(request, owner, project.id)).toBe('owner');
    const people = (await permissionsOf(request, owner, project.id)).filter((p) => p.userId);
    expect(people.map((p) => p.userId).sort()).toEqual([early.id, editor.id].sort());

    // Revoked: the link no longer lets anyone in, but people who joined stay
    await expectJson(as(request, owner).delete(`/api/permissions/${link.id}`), 200);
    expect((await as(request, late).post(`/api/share/${link.shareToken}`)).status()).toBe(404);
    expect(await roleIn(request, late, project.id)).toBe(403);
    expect(await roleIn(request, early, project.id)).toBe('viewer');
    // Anonymous joins are impossible
    expect((await as(request, null).post(`/api/share/${link.shareToken}`)).status()).toBe(401);
  });

  test('handing a project over keeps exactly one role per person', async ({ request }) => {
    const owner = await signUp(request, 'Owner');
    const heir = await signUp(request, 'Heir');
    const project = await createProject(request, owner, `Handover ${uniq()}`);
    await addToProject(request, owner, project.id, heir, 'editor');
    // The owner once opened their own share link
    const link = (
      await expectJson<{ share: { shareToken: string } }>(
        as(request, owner).post(`/api/projects/${project.id}/share`, { role: 'viewer' }),
        201,
      )
    ).share;
    await expectJson(as(request, owner).post(`/api/share/${link.shareToken}`), 200);

    await expectJson(
      as(request, owner).post(`/api/projects/${project.id}/transfer`, { userId: heir.id }),
      200,
    );
    expect(await roleIn(request, heir, project.id)).toBe('owner');
    expect(await roleIn(request, owner, project.id)).toBe('admin');
    const rows = (await permissionsOf(request, heir, project.id)).filter((p) => p.userId);
    expect(rows.map((p) => [p.userId, p.role])).toEqual([[owner.id, 'admin']]);
    // Only someone who already has access can receive a project
    const stranger = await signUp(request, 'Stranger');
    expect(
      (
        await as(request, heir).post(`/api/projects/${project.id}/transfer`, {
          userId: stranger.id,
        })
      ).status(),
    ).toBe(400);
  });

  test('comments: authors edit their own; authors and admins delete', async ({ request }) => {
    const team = await makeTeam(request);
    const { id, rootDiagramId } = team.project;
    const thread = (
      await expectJson<{ thread: { id: string; comments: Array<{ id: string }> } }>(
        as(request, team.viewer).post(`/api/diagrams/${rootDiagramId}/comments`, {
          x: 10,
          y: 20,
          body: 'Is this the right cache?',
        }),
        201,
      )
    ).thread;
    const commentId = thread.comments[0].id;

    // Anyone on the project replies and resolves; outsiders can't even see it
    await expectOnly(
      request,
      team,
      'viewer',
      (c) => c.post(`/api/comment-threads/${thread.id}/replies`, { body: '+1' }),
      { allowed: [201], denied: 404 },
    );
    await expectOnly(
      request,
      team,
      'viewer',
      (c) => c.patch(`/api/comment-threads/${thread.id}`, { resolved: false }),
      { denied: 404 },
    );

    // Only the author edits a comment, not even the owner
    for (const who of [team.owner, team.admin, team.editor]) {
      expect(
        (
          await as(request, who).patch(`/api/comments/${commentId}`, { body: 'Rewritten' })
        ).status(),
      ).toBe(403);
    }
    expect(
      (
        await as(request, team.outsider).patch(`/api/comments/${commentId}`, { body: 'x' })
      ).status(),
    ).toBe(404);
    const edited = await expectJson<{ thread: { comments: Array<{ body: string }> } }>(
      as(request, team.viewer).patch(`/api/comments/${commentId}`, {
        body: 'Is this the right DB?',
      }),
      200,
    );
    expect(edited.thread.comments[0].body).toBe('Is this the right DB?');

    // Deleting someone else's thread takes an admin
    for (const who of [team.editor, team.wsMember]) {
      expect((await as(request, who).delete(`/api/comment-threads/${thread.id}`)).status()).toBe(
        403,
      );
    }
    expect(
      (await as(request, team.outsider).delete(`/api/comment-threads/${thread.id}`)).status(),
    ).toBe(404);
    await expectJson(as(request, team.wsAdmin).delete(`/api/comment-threads/${thread.id}`), 204);
    const { threads } = await expectJson<{ threads: unknown[] }>(
      as(request, team.owner).get(`/api/projects/${id}/comments`),
      200,
    );
    expect(threads).toEqual([]);
  });

  test('one project’s ids never reach into another', async ({ request }) => {
    const alice = await signUp(request, 'Alice');
    const bob = await signUp(request, 'Bob');
    const mine = await createProject(request, alice, `Mine ${uniq()}`);
    const theirs = await createProject(request, bob, `Theirs ${uniq()}`);
    const a = as(request, alice);
    const theirSnapshot = (
      await expectJson<{ snapshot: { id: string } }>(
        as(request, bob).post(`/api/diagrams/${theirs.rootDiagramId}/save`, {}),
        201,
      )
    ).snapshot;

    // Their version, addressed through my diagram
    expect(
      (await a.get(`/api/diagrams/${mine.rootDiagramId}/snapshots/${theirSnapshot.id}`)).status(),
    ).toBe(404);
    expect(
      (
        await a.post(`/api/diagrams/${mine.rootDiagramId}/snapshots/${theirSnapshot.id}/restore`)
      ).status(),
    ).toBe(404);
    // A child of their diagram in my project, or reusing their diagram's id
    expect(
      (
        await a.post('/api/diagrams', { projectId: mine.id, parentDiagramId: theirs.rootDiagramId })
      ).status(),
    ).toBe(400);
    expect(
      (await a.post('/api/diagrams', { projectId: mine.id, id: theirs.rootDiagramId })).status(),
    ).toBe(409);
    // My tour can't point at their diagrams
    const tour = await expectJson<{ stops: unknown[] }>(
      a.put(`/api/projects/${mine.id}/tour`, {
        stops: [
          { id: 's1', diagramId: theirs.rootDiagramId, viewport: null, title: 'x', note: '' },
          { id: 's2', diagramId: mine.rootDiagramId, viewport: null, title: 'y', note: '' },
        ],
      }),
      200,
    );
    expect(tour.stops).toEqual([expect.objectContaining({ id: 's2' })]);
    // My embed token doesn't open their diagrams
    const embed = (
      await expectJson<{ embed: { token: string } }>(a.post(`/api/projects/${mine.id}/embed`), 201)
    ).embed;
    expect(
      (
        await as(request, null).get(`/api/embed/${embed.token}/diagrams/${theirs.rootDiagramId}`)
      ).status(),
    ).toBe(404);
    expect(
      (
        await as(request, null).get(`/api/embed/${embed.token}/svg?d=${theirs.rootDiagramId}`)
      ).status(),
    ).toBe(404);

    // Their share link and invite can't be managed through my project
    const theirLink = (
      await expectJson<{ share: { id: string } }>(
        as(request, bob).post(`/api/projects/${theirs.id}/share`, { role: 'viewer' }),
        201,
      )
    ).share;
    expect((await a.put(`/api/permissions/${theirLink.id}`, { role: 'editor' })).status()).toBe(
      403,
    );
    expect((await a.delete(`/api/permissions/${theirLink.id}`)).status()).toBe(403);
    await expectJson(
      as(request, bob).post(`/api/projects/${theirs.id}/invites`, {
        email: `p-${uniq()}@example.com`,
      }),
      201,
    );
    const theirInvites = async () =>
      (
        await expectJson<{ invites: Array<{ id: string }> }>(
          as(request, bob).get(`/api/projects/${theirs.id}/invites`),
          200,
        )
      ).invites;
    const [invite] = await theirInvites();
    await a.delete(`/api/projects/${mine.id}/invites/${invite.id}`);
    expect((await theirInvites()).map((i) => i.id)).toEqual([invite.id]);
    expect((await permissionsOf(request, bob, theirs.id)).map((p) => p.id)).toContain(theirLink.id);
  });

  test('workspace roles: members edit, admins manage, only owners make owners', async ({
    request,
  }) => {
    const [owner, admin, member, outsider] = await Promise.all(
      ['Owner', 'Admin', 'Member', 'Outsider'].map((n) => signUp(request, n)),
    );
    const ws = await createWorkspace(request, owner, `WS ${uniq()}`);
    await addToWorkspace(request, owner, ws.id, admin, 'admin');
    await addToWorkspace(request, owner, ws.id, member, 'member');
    await expectJson(
      as(request, owner).post(`/api/workspaces/${ws.id}/invites`, {
        email: `n-${uniq()}@example.com`,
      }),
      201,
    );
    const project = await createProject(request, owner, `WS map ${uniq()}`, ws.id);
    const members = (who: Person) => as(request, who).get(`/api/workspaces/${ws.id}/members`);

    // Who sees the member list, and the pending invite links
    expect((await members(outsider)).status()).toBe(404);
    const seen = async (who: Person) =>
      (await expectJson<{ invites: unknown[] }>(members(who), 200)).invites.length;
    expect(await seen(member)).toBe(0);
    expect(await seen(admin)).toBe(1);

    // Members can't invite or change roles
    const m = as(request, member);
    expect(
      (
        await m.post(`/api/workspaces/${ws.id}/invites`, { email: `q-${uniq()}@example.com` })
      ).status(),
    ).toBe(403);
    expect(
      (await m.patch(`/api/workspaces/${ws.id}/members/${member.id}`, { role: 'admin' })).status(),
    ).toBe(403);
    expect((await m.delete(`/api/workspaces/${ws.id}/members/${admin.id}`)).status()).toBe(403);
    // Admins can't create, demote or remove owners
    const ad = as(request, admin);
    expect(
      (await ad.patch(`/api/workspaces/${ws.id}/members/${member.id}`, { role: 'owner' })).status(),
    ).toBe(403);
    expect(
      (await ad.patch(`/api/workspaces/${ws.id}/members/${owner.id}`, { role: 'member' })).status(),
    ).toBe(403);
    expect((await ad.delete(`/api/workspaces/${ws.id}/members/${owner.id}`)).status()).toBe(403);
    // The last owner can't leave or step down
    const o = as(request, owner);
    expect((await o.delete(`/api/workspaces/${ws.id}/members/${owner.id}`)).status()).toBe(400);
    expect(
      (await o.patch(`/api/workspaces/${ws.id}/members/${owner.id}`, { role: 'admin' })).status(),
    ).toBe(400);
    // Outsiders can't put projects in the workspace, or move theirs in
    expect(
      (
        await as(request, outsider).post('/api/projects', { name: 'Sneaky', workspaceId: ws.id })
      ).status(),
    ).toBe(403);
    const own = await createProject(request, outsider, `Own ${uniq()}`);
    expect(
      (await as(request, outsider).put(`/api/projects/${own.id}`, { workspaceId: ws.id })).status(),
    ).toBe(403);

    // An admin promotes a member; a member who leaves loses the workspace's projects
    await expectJson(
      ad.patch(`/api/workspaces/${ws.id}/members/${member.id}`, { role: 'admin' }),
      200,
    );
    expect(await roleIn(request, member, project.id)).toBe('admin');
    await expectJson(m.delete(`/api/workspaces/${ws.id}/members/${member.id}`), 204);
    expect(await roleIn(request, member, project.id)).toBe(403);
    const { projects } = await expectJson<{ projects: Array<{ id: string }> }>(
      m.get('/api/projects'),
      200,
    );
    expect(projects.map((p) => p.id)).not.toContain(project.id);
  });

  test('applying a proposed map update needs edit access, and happens once', async ({
    request,
  }) => {
    const team = await makeTeam(request);
    // A coding agent with the owner's token proposes an update (MCP)
    const { token } = await expectJson<{ token: string }>(
      as(request, team.owner).post('/api/tokens', { name: 'agent' }),
      201,
    );
    const rpc = await request.post(`${API_URL}/api/mcp`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json, text/event-stream' },
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'propose_update',
          arguments: {
            project: team.project.id,
            description: 'Add a cache',
            add: [{ name: 'Redis', kind: 'datastore' }],
          },
        },
      },
    });
    expect(rpc.status(), await rpc.text()).toBe(200);
    const { proposals } = await expectJson<{ proposals: Array<{ id: string }> }>(
      as(request, team.viewer).get(`/api/projects/${team.project.id}/proposals`),
      200,
    );
    expect(proposals).toHaveLength(1);
    const resolve = (who: Person) =>
      as(request, who).post(`/api/proposals/${proposals[0].id}/resolve`, { status: 'dismissed' });
    for (const who of [team.viewer, team.outsider]) expect((await resolve(who)).status()).toBe(403);
    expect((await resolve(team.wsMember)).status()).toBe(200);
    // Someone else got there first
    expect((await resolve(team.editor)).status()).toBe(409);
    // A settled proposal can't be reopened (and applied a second time)
    expect(
      (
        await as(request, team.editor).post(`/api/proposals/${proposals[0].id}/resolve`, {
          status: 'pending',
        })
      ).status(),
    ).toBe(400);

    // Marked applied with a key: the same request again (its answer was lost)
    // is done; anyone else, or another attempt, finds it taken
    const rpc2 = await request.post(`${API_URL}/api/mcp`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json, text/event-stream' },
      data: {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'propose_update',
          arguments: {
            project: team.project.id,
            description: 'Add a queue',
            add: [{ name: 'Queue', kind: 'component' }],
          },
        },
      },
    });
    expect(rpc2.status(), await rpc2.text()).toBe(200);
    const second = (
      await expectJson<{ proposals: Array<{ id: string }> }>(
        as(request, team.editor).get(`/api/projects/${team.project.id}/proposals`),
        200,
      )
    ).proposals[0];
    const mark = (who: Person, key: string) =>
      as(request, who).post(`/api/proposals/${second.id}/resolve`, { status: 'applied', key });
    expect((await mark(team.editor, 'attempt-one-key')).status()).toBe(200);
    expect((await mark(team.editor, 'attempt-one-key')).status()).toBe(200);
    expect((await mark(team.editor, 'attempt-two-key')).status()).toBe(409);
    expect((await mark(team.wsMember, 'attempt-one-key')).status()).toBe(409);

    // Nobody but its owner can revoke the token
    const { tokens } = await expectJson<{ tokens: Array<{ id: string }> }>(
      as(request, team.owner).get('/api/tokens'),
      200,
    );
    for (const who of [team.admin, team.outsider]) {
      expect((await as(request, who).delete(`/api/tokens/${tokens[0].id}`)).status()).toBe(404);
    }
    expect(
      (await expectJson<{ tokens: unknown[] }>(as(request, team.owner).get('/api/tokens'), 200))
        .tokens,
    ).toHaveLength(1);
  });

  test('an invite stops working once whoever sent it can no longer invite', async ({ request }) => {
    const owner = await signUp(request, 'Owner');
    const admin = await signUp(request, 'Admin');
    const project = await createProject(request, owner, `Stale invites ${uniq()}`);
    await addToProject(request, owner, project.id, admin, 'admin');
    const invite = async (email: string) =>
      (
        await expectJson<{ inviteUrl: string }>(
          as(request, admin).post(`/api/projects/${project.id}/invites`, { email, role: 'editor' }),
          201,
        )
      ).inviteUrl;
    const viaSignUp = `newcomer-${uniq()}@e2e.mavisdraw.dev`;
    const viaLink = `linked-${uniq()}@e2e.mavisdraw.dev`;
    await invite(viaSignUp);
    const link = await invite(viaLink);

    // The admin is made an editor: they couldn't send those invites now
    const perm = (await permissionsOf(request, owner, project.id)).find((p) => p.role === 'admin')!;
    await expectJson(
      as(request, owner).put(`/api/permissions/${perm.id}`, { role: 'editor' }),
      200,
    );

    const register = async (email: string, name: string) => {
      const res = await request.post(`${API_URL}/api/auth/register`, {
        data: { email, password: 'correct-horse-battery', name },
      });
      expect(res.status(), await res.text()).toBe(201);
      const body = (await res.json()) as { user: { id: string }; accessToken: string };
      return { id: body.user.id, name, email, token: body.accessToken };
    };
    // Signing up and confirming the address doesn't claim it…
    const newcomer = await register(viaSignUp, 'Newcomer');
    await confirmEmail(request, viaSignUp);
    expect(await roleIn(request, newcomer, project.id)).toBe(403);
    // …and the link says it's no longer valid
    const linked = await register(viaLink, 'Linked');
    const token = new URL(link, API_URL).pathname.split('/').pop()!;
    const accepted = await as(request, linked).post(`/api/invites/${token}/accept`);
    expect(accepted.status()).toBe(410);
    expect(await roleIn(request, linked, project.id)).toBe(403);
  });

  test('a public project is readable by anyone signed in, writable only by its people', async ({
    request,
  }) => {
    const owner = await signUp(request, 'Owner');
    const reader = await signUp(request, 'Reader');
    const project = await createProject(request, owner, `Public ${uniq()}`);
    expect(await roleIn(request, reader, project.id)).toBe(403);
    await expectJson(
      as(request, owner).put(`/api/projects/${project.id}`, { isPublic: true }),
      200,
    );

    const r = as(request, reader);
    expect(await roleIn(request, reader, project.id)).toBe('viewer');
    expect((await r.get(`/api/diagrams/${project.rootDiagramId}`)).status()).toBe(200);
    expect(
      (await r.put(`/api/diagrams/${project.rootDiagramId}`, { title: 'Mine now' })).status(),
    ).toBe(403);
    expect((await r.post(`/api/projects/${project.id}/share`, { role: 'editor' })).status()).toBe(
      403,
    );
    // Public doesn't mean it shows up on everyone's dashboard
    const { projects } = await expectJson<{ projects: Array<{ id: string }> }>(
      r.get('/api/projects'),
      200,
    );
    expect(projects.map((p) => p.id)).not.toContain(project.id);
  });
});
