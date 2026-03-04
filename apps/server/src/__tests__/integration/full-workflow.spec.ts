/**
 * Full-workflow integration tests running against the Docker environment.
 *
 * Prerequisites: `docker compose up -d` with API on port 3001 and Postgres healthy.
 *
 * Run: pnpm run test:integration (from apps/server)
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  api,
  registerUser,
  loginUser,
  uniqueEmail,
  extractRefreshCookie,
  withRateLimitRetry,
} from './helpers.js';

// ─── Connectivity check ──────────────────────────────────────────────────────

beforeAll(async () => {
  const res = await fetch('http://localhost:3001/api/auth/me').catch(() => null);
  if (!res) {
    throw new Error(
      'API not reachable at http://localhost:3001 — is Docker running? (docker compose up -d)',
    );
  }
});

// ─── 1. Auth: Registration, Login, Token Refresh, Logout ─────────────────────

describe('Auth workflow', () => {
  const email = uniqueEmail();
  const password = 'Test1234!';
  const name = 'Integration Tester';
  let accessToken: string;
  let refreshCookie: string;

  it('registers a new user', async () => {
    const res = await registerUser(email, password, name);
    expect(res.status).toBe(201);
    expect(res.data.user.email).toBe(email);
    expect(res.data.user.name).toBe(name);
    expect(res.data.accessToken).toBeTruthy();
    expect(res.refreshCookie).toContain('refreshToken');
    accessToken = res.data.accessToken;
    refreshCookie = res.refreshCookie;
  });

  it('rejects duplicate registration', async () => {
    const res = await registerUser(email, password, name);
    expect(res.status).toBe(409);
  });

  it('fetches current user with access token', async () => {
    const res = await api<{ user: { email: string } }>('/api/auth/me', { accessToken });
    expect(res.status).toBe(200);
    expect(res.data.user.email).toBe(email);
  });

  it('rejects unauthenticated requests', async () => {
    const res = await api('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('refreshes the access token via cookie', async () => {
    const res = await api<{ accessToken: string }>('/api/auth/refresh', {
      method: 'POST',
      cookie: refreshCookie,
    });
    expect(res.status).toBe(200);
    expect(res.data.accessToken).toBeTruthy();
    accessToken = res.data.accessToken;
    const newCookie = res.headers.get('set-cookie');
    if (newCookie) {
      refreshCookie = extractRefreshCookie(newCookie);
    }
  });

  it('logs in with existing credentials', async () => {
    const res = await loginUser(email, password);
    expect(res.status).toBe(200);
    expect(res.data.user.email).toBe(email);
    expect(res.data.accessToken).toBeTruthy();
    accessToken = res.data.accessToken;
    refreshCookie = res.refreshCookie;
  });

  it('rejects login with wrong password', async () => {
    const res = await loginUser(email, 'WrongPassword1!');
    expect(res.status).toBe(401);
  });

  it('logs out and invalidates refresh token', async () => {
    const logoutRes = await api('/api/auth/logout', {
      method: 'POST',
      cookie: refreshCookie,
    });
    expect(logoutRes.status).toBe(200);

    // The old refresh token should no longer work
    const refreshRes = await api('/api/auth/refresh', {
      method: 'POST',
      cookie: refreshCookie,
    });
    expect(refreshRes.status).toBe(401);
  });
});

// ─── 2. Projects: CRUD ──────────────────────────────────────────────────────

describe('Project workflow', () => {
  let accessToken: string;
  let projectId: string;

  beforeAll(async () => {
    const res = await withRateLimitRetry(() =>
      registerUser(uniqueEmail(), 'Test1234!', 'Project User'),
    );
    accessToken = res.data.accessToken;
  });

  it('creates a project with auto-generated root diagram', async () => {
    const res = await api<{
      project: { id: string; name: string; rootDiagramId: string };
      rootDiagram: { id: string; title: string };
    }>('/api/projects', {
      method: 'POST',
      accessToken,
      body: { name: 'Test Project' },
    });
    expect(res.status).toBe(201);
    expect(res.data.project.name).toBe('Test Project');
    expect(res.data.rootDiagram.title).toBe('Root Diagram');
    projectId = res.data.project.id;
  });

  it('lists projects including the new one', async () => {
    const res = await api<{ projects: { id: string }[] }>('/api/projects', { accessToken });
    expect(res.status).toBe(200);
    expect(res.data.projects.some((p) => p.id === projectId)).toBe(true);
  });

  it('gets a single project by id', async () => {
    const res = await api<{ project: { id: string; name: string } }>(
      `/api/projects/${projectId}`,
      { accessToken },
    );
    expect(res.status).toBe(200);
    expect(res.data.project.id).toBe(projectId);
  });

  it('updates project name', async () => {
    const res = await api<{ project: { name: string } }>(`/api/projects/${projectId}`, {
      method: 'PUT',
      accessToken,
      body: { name: 'Renamed Project' },
    });
    expect(res.status).toBe(200);
    expect(res.data.project.name).toBe('Renamed Project');
  });

  it('denies access to another user', async () => {
    const otherRes = await registerUser(uniqueEmail(), 'Test1234!', 'Other');
    const res = await api(`/api/projects/${projectId}`, {
      accessToken: otherRes.data.accessToken,
    });
    expect(res.status).toBe(403);
  });

  it('deletes the project', async () => {
    const delRes = await api(`/api/projects/${projectId}`, {
      method: 'DELETE',
      accessToken,
    });
    expect(delRes.status).toBe(200);

    const getRes = await api(`/api/projects/${projectId}`, { accessToken });
    expect(getRes.status).toBe(404);
  });
});

// ─── 3. Diagrams: CRUD, Nested, Snapshots ────────────────────────────────────

describe('Diagram workflow', () => {
  let accessToken: string;
  let projectId: string;
  let rootDiagramId: string;
  let childDiagramId: string;

  beforeAll(async () => {
    const reg = await withRateLimitRetry(() =>
      registerUser(uniqueEmail(), 'Test1234!', 'Diagram User'),
    );
    accessToken = reg.data.accessToken;

    const proj = await api<{
      project: { id: string };
      rootDiagram: { id: string };
    }>('/api/projects', {
      method: 'POST',
      accessToken,
      body: { name: 'Diagram Test Project' },
    });
    projectId = proj.data.project.id;
    rootDiagramId = proj.data.rootDiagram.id;
  });

  it('gets the root diagram', async () => {
    const res = await api<{ diagram: { id: string; title: string } }>(
      `/api/diagrams/${rootDiagramId}`,
      { accessToken },
    );
    expect(res.status).toBe(200);
    expect(res.data.diagram.title).toBe('Root Diagram');
  });

  it('creates a nested child diagram', async () => {
    const res = await api<{ diagram: { id: string; parentDiagramId: string } }>('/api/diagrams', {
      method: 'POST',
      accessToken,
      body: {
        projectId,
        parentDiagramId: rootDiagramId,
        title: 'Child Diagram',
      },
    });
    expect(res.status).toBe(201);
    expect(res.data.diagram.parentDiagramId).toBe(rootDiagramId);
    childDiagramId = res.data.diagram.id;
  });

  it('lists all diagrams for the project', async () => {
    const res = await api<{ diagrams: { id: string }[] }>(
      `/api/projects/${projectId}/diagrams`,
      { accessToken },
    );
    expect(res.status).toBe(200);
    expect(res.data.diagrams.length).toBeGreaterThanOrEqual(2);
  });

  it('updates diagram elements', async () => {
    const elements = [
      {
        id: 'el-1',
        type: 'rectangle',
        x: 100,
        y: 100,
        width: 200,
        height: 150,
        isDeleted: false,
      },
    ];
    const res = await api<{ diagram: { elements: unknown[] } }>(
      `/api/diagrams/${rootDiagramId}`,
      {
        method: 'PUT',
        accessToken,
        body: { elements },
      },
    );
    expect(res.status).toBe(200);
    expect(res.data.diagram.elements).toHaveLength(1);
  });

  it('updates diagram settings', async () => {
    const res = await api<{
      diagram: { viewBackgroundColor: string; gridEnabled: boolean; renderMode: string };
    }>(`/api/diagrams/${rootDiagramId}`, {
      method: 'PUT',
      accessToken,
      body: {
        viewBackgroundColor: '#f0f0f0',
        gridEnabled: false,
        renderMode: 'clean',
      },
    });
    expect(res.status).toBe(200);
    expect(res.data.diagram.viewBackgroundColor).toBe('#f0f0f0');
    expect(res.data.diagram.gridEnabled).toBe(false);
    expect(res.data.diagram.renderMode).toBe('clean');
  });

  it('creates a manual snapshot (save)', async () => {
    const res = await api<{ snapshot: { id: string; version: number; trigger: string } }>(
      `/api/diagrams/${rootDiagramId}/save`,
      {
        method: 'POST',
        accessToken,
        body: { trigger: 'manual', label: 'First save' },
      },
    );
    expect(res.status).toBe(201);
    expect(res.data.snapshot.version).toBe(1);
    expect(res.data.snapshot.trigger).toBe('manual');
  });

  it('lists snapshots', async () => {
    const res = await api<{ snapshots: { id: string; version: number }[] }>(
      `/api/diagrams/${rootDiagramId}/snapshots`,
      { accessToken },
    );
    expect(res.status).toBe(200);
    expect(res.data.snapshots.length).toBeGreaterThanOrEqual(1);
  });

  it('restores a snapshot to a previous version', async () => {
    // Update elements to something new
    await api(`/api/diagrams/${rootDiagramId}`, {
      method: 'PUT',
      accessToken,
      body: {
        elements: [{ id: 'el-2', type: 'ellipse', x: 50, y: 50, width: 100, height: 100 }],
      },
    });

    // Create snapshot of current state
    await api(`/api/diagrams/${rootDiagramId}/save`, {
      method: 'POST',
      accessToken,
      body: { trigger: 'manual', label: 'Second save' },
    });

    // Get snapshot list and restore the first one
    const listRes = await api<{ snapshots: { id: string; version: number }[] }>(
      `/api/diagrams/${rootDiagramId}/snapshots`,
      { accessToken },
    );
    const firstSnapshot = listRes.data.snapshots.find((s) => s.version === 1);
    expect(firstSnapshot).toBeTruthy();

    const restoreRes = await api<{ diagram: { elements: unknown[] } }>(
      `/api/diagrams/${rootDiagramId}/snapshots/${firstSnapshot!.id}/restore`,
      { method: 'POST', accessToken, body: {} },
    );
    expect(restoreRes.status).toBe(200);
    // After restore, elements should be back to the original rectangle
    const restored = restoreRes.data.diagram.elements as { id: string }[];
    expect(restored.some((e) => e.id === 'el-1')).toBe(true);
  });

  it('deletes a child diagram', async () => {
    const delRes = await api(`/api/diagrams/${childDiagramId}`, {
      method: 'DELETE',
      accessToken,
    });
    expect(delRes.status).toBe(200);
  });
});

// ─── 4. Sharing: Create link, join, permissions ──────────────────────────────

describe('Sharing workflow', () => {
  let ownerToken: string;
  let collaboratorToken: string;
  let collaboratorUserId: string;
  let projectId: string;
  let rootDiagramId: string;

  beforeAll(async () => {
    const ownerRes = await withRateLimitRetry(() =>
      registerUser(uniqueEmail(), 'Test1234!', 'Owner'),
    );
    ownerToken = ownerRes.data.accessToken;

    const collabRes = await withRateLimitRetry(() =>
      registerUser(uniqueEmail(), 'Test1234!', 'Collaborator'),
    );
    collaboratorToken = collabRes.data.accessToken;
    collaboratorUserId = collabRes.data.user.id;

    const proj = await api<{
      project: { id: string };
      rootDiagram: { id: string };
    }>('/api/projects', {
      method: 'POST',
      accessToken: ownerToken,
      body: { name: 'Shared Project' },
    });
    projectId = proj.data.project.id;
    rootDiagramId = proj.data.rootDiagram.id;
  });

  it('denies collaborator access before sharing', async () => {
    const res = await api(`/api/projects/${projectId}`, {
      accessToken: collaboratorToken,
    });
    expect(res.status).toBe(403);
  });

  let shareToken: string;

  it('creates a share link as editor', async () => {
    const res = await api<{ share: { shareToken: string; role: string } }>(
      `/api/projects/${projectId}/share`,
      {
        method: 'POST',
        accessToken: ownerToken,
        body: { role: 'editor' },
      },
    );
    expect(res.status).toBe(201);
    expect(res.data.share.shareToken).toBeTruthy();
    expect(res.data.share.role).toBe('editor');
    shareToken = res.data.share.shareToken;
  });

  it('collaborator joins via share link', async () => {
    const res = await api<{ projectId: string; role: string }>(
      `/api/share/${shareToken}`,
      {
        method: 'POST',
        accessToken: collaboratorToken,
        body: {},
      },
    );
    expect(res.status).toBe(200);
    expect(res.data.projectId).toBe(projectId);
    expect(res.data.role).toBe('editor');
  });

  it('collaborator can now access the project', async () => {
    const res = await api<{ project: { id: string } }>(`/api/projects/${projectId}`, {
      accessToken: collaboratorToken,
    });
    expect(res.status).toBe(200);
    expect(res.data.project.id).toBe(projectId);
  });

  it('collaborator can edit diagrams', async () => {
    const res = await api<{ diagram: { elements: unknown[] } }>(
      `/api/diagrams/${rootDiagramId}`,
      {
        method: 'PUT',
        accessToken: collaboratorToken,
        body: {
          elements: [
            { id: 'collab-el', type: 'rectangle', x: 0, y: 0, width: 50, height: 50 },
          ],
        },
      },
    );
    expect(res.status).toBe(200);
  });

  it('collaborator appears in project permissions', async () => {
    const res = await api<{ permissions: { userId: string | null; role: string }[] }>(
      `/api/projects/${projectId}/permissions`,
      { accessToken: ownerToken },
    );
    expect(res.status).toBe(200);
    const collabPerm = res.data.permissions.find((p) => p.userId === collaboratorUserId);
    expect(collabPerm).toBeTruthy();
    expect(collabPerm!.role).toBe('editor');
  });

  it('owner can change collaborator role to viewer', async () => {
    const permRes = await api<{ permissions: { id: string; userId: string | null }[] }>(
      `/api/projects/${projectId}/permissions`,
      { accessToken: ownerToken },
    );
    const perm = permRes.data.permissions.find((p) => p.userId === collaboratorUserId);
    expect(perm).toBeTruthy();

    const res = await api<{ permission: { role: string } }>(`/api/permissions/${perm!.id}`, {
      method: 'PUT',
      accessToken: ownerToken,
      body: { role: 'viewer' },
    });
    expect(res.status).toBe(200);
    expect(res.data.permission.role).toBe('viewer');
  });

  it('viewer cannot edit diagrams', async () => {
    const res = await api(`/api/diagrams/${rootDiagramId}`, {
      method: 'PUT',
      accessToken: collaboratorToken,
      body: { elements: [] },
    });
    expect(res.status).toBe(403);
  });

  it('owner can revoke access', async () => {
    const permRes = await api<{ permissions: { id: string; userId: string | null }[] }>(
      `/api/projects/${projectId}/permissions`,
      { accessToken: ownerToken },
    );
    const perm = permRes.data.permissions.find((p) => p.userId === collaboratorUserId);
    expect(perm).toBeTruthy();

    const res = await api(`/api/permissions/${perm!.id}`, {
      method: 'DELETE',
      accessToken: ownerToken,
    });
    expect(res.status).toBe(200);

    // Collaborator can no longer access
    const accessRes = await api(`/api/projects/${projectId}`, {
      accessToken: collaboratorToken,
    });
    expect(accessRes.status).toBe(403);
  });
});

// ─── 5. End-to-End: Full user journey ────────────────────────────────────────

describe('Full user journey', () => {
  let alice: { data: { user: { id: string }; accessToken: string } };
  let bob: { data: { user: { id: string }; accessToken: string } };

  beforeAll(async () => {
    // Earlier test suites may exhaust the 10 req/min auth rate limit.
    // Use withRateLimitRetry to wait for the window to reset if needed.
    alice = await withRateLimitRetry(() => loginUser('demo@mavisdraw.dev', 'password123'));
    bob = await withRateLimitRetry(() =>
      registerUser(uniqueEmail(), 'Test1234!', 'Bob'),
    );
  });

  it('login + create project → add diagrams → save → share → collaborate → cleanup', async () => {
    expect(alice.data.accessToken).toBeTruthy();
    expect(bob.data.accessToken).toBeTruthy();

    // 3. Alice creates a project
    const projRes = await api<{
      project: { id: string };
      rootDiagram: { id: string };
    }>('/api/projects', {
      method: 'POST',
      accessToken: alice.data.accessToken,
      body: { name: 'Architecture Diagram' },
    });
    expect(projRes.status).toBe(201);
    const projectId = projRes.data.project.id;
    const rootDiagramId = projRes.data.rootDiagram.id;

    // 4. Alice adds elements to the root diagram
    const elements = [
      {
        id: 'svc-1',
        type: 'rectangle',
        x: 100,
        y: 100,
        width: 200,
        height: 100,
      },
      {
        id: 'svc-2',
        type: 'rectangle',
        x: 400,
        y: 100,
        width: 200,
        height: 100,
      },
      { id: 'arr-1', type: 'arrow', x: 300, y: 150, width: 100, height: 0 },
    ];
    const updateRes = await api(`/api/diagrams/${rootDiagramId}`, {
      method: 'PUT',
      accessToken: alice.data.accessToken,
      body: { elements },
    });
    expect(updateRes.status).toBe(200);

    // 5. Alice saves a snapshot
    const snapRes = await api<{ snapshot: { version: number } }>(
      `/api/diagrams/${rootDiagramId}/save`,
      {
        method: 'POST',
        accessToken: alice.data.accessToken,
        body: { trigger: 'manual', label: 'Initial architecture' },
      },
    );
    expect(snapRes.status).toBe(201);
    expect(snapRes.data.snapshot.version).toBe(1);

    // 6. Alice creates a nested diagram (drill-down)
    const childRes = await api<{ diagram: { id: string } }>('/api/diagrams', {
      method: 'POST',
      accessToken: alice.data.accessToken,
      body: {
        projectId,
        parentDiagramId: rootDiagramId,
        parentPortalId: 'svc-1',
        title: 'API Server Detail',
      },
    });
    expect(childRes.status).toBe(201);
    const childDiagramId = childRes.data.diagram.id;

    // 7. Alice adds elements to child diagram
    await api(`/api/diagrams/${childDiagramId}`, {
      method: 'PUT',
      accessToken: alice.data.accessToken,
      body: {
        elements: [
          { id: 'route-1', type: 'rectangle', x: 50, y: 50, width: 150, height: 80 },
          { id: 'route-2', type: 'rectangle', x: 250, y: 50, width: 150, height: 80 },
        ],
      },
    });

    // 8. Alice shares with Bob as editor
    const shareRes = await api<{ share: { shareToken: string } }>(
      `/api/projects/${projectId}/share`,
      {
        method: 'POST',
        accessToken: alice.data.accessToken,
        body: { role: 'editor' },
      },
    );
    expect(shareRes.status).toBe(201);

    // 9. Bob joins via share link
    const joinRes = await api<{ projectId: string; role: string }>(
      `/api/share/${shareRes.data.share.shareToken}`,
      {
        method: 'POST',
        accessToken: bob.data.accessToken,
        body: {},
      },
    );
    expect(joinRes.status).toBe(200);
    expect(joinRes.data.projectId).toBe(projectId);

    // 10. Bob can see the project in his list
    const bobProjects = await api<{ projects: { id: string }[] }>('/api/projects', {
      accessToken: bob.data.accessToken,
    });
    expect(bobProjects.data.projects.some((p) => p.id === projectId)).toBe(true);

    // 11. Bob can read and edit diagrams
    const bobDiagram = await api<{ diagram: { elements: unknown[] } }>(
      `/api/diagrams/${rootDiagramId}`,
      { accessToken: bob.data.accessToken },
    );
    expect(bobDiagram.status).toBe(200);
    expect((bobDiagram.data.diagram.elements as unknown[]).length).toBe(3);

    await api(`/api/diagrams/${rootDiagramId}`, {
      method: 'PUT',
      accessToken: bob.data.accessToken,
      body: {
        elements: [
          ...elements,
          { id: 'svc-3', type: 'rectangle', x: 400, y: 300, width: 200, height: 100 },
        ],
      },
    });

    // 12. Alice saves another snapshot after Bob's edit
    const snap2 = await api<{ snapshot: { version: number } }>(
      `/api/diagrams/${rootDiagramId}/save`,
      {
        method: 'POST',
        accessToken: alice.data.accessToken,
        body: { trigger: 'manual', label: 'After Bob added cache' },
      },
    );
    expect(snap2.data.snapshot.version).toBe(2);

    // 13. Alice restores to version 1
    const snapshotList = await api<{ snapshots: { id: string; version: number }[] }>(
      `/api/diagrams/${rootDiagramId}/snapshots`,
      { accessToken: alice.data.accessToken },
    );
    const v1 = snapshotList.data.snapshots.find((s) => s.version === 1)!;

    const restoreRes = await api<{ diagram: { elements: { id: string }[] } }>(
      `/api/diagrams/${rootDiagramId}/snapshots/${v1.id}/restore`,
      { method: 'POST', accessToken: alice.data.accessToken, body: {} },
    );
    expect(restoreRes.status).toBe(200);
    expect(restoreRes.data.diagram.elements.length).toBe(3); // original 3 elements

    // 14. Alice downgrades Bob to viewer
    const permsRes = await api<{ permissions: { id: string; userId: string | null }[] }>(
      `/api/projects/${projectId}/permissions`,
      { accessToken: alice.data.accessToken },
    );
    const bobPerm = permsRes.data.permissions.find((p) => p.userId === bob.data.user.id);
    expect(bobPerm).toBeTruthy();

    await api(`/api/permissions/${bobPerm!.id}`, {
      method: 'PUT',
      accessToken: alice.data.accessToken,
      body: { role: 'viewer' },
    });

    // 15. Bob can no longer edit
    const editAttempt = await api(`/api/diagrams/${rootDiagramId}`, {
      method: 'PUT',
      accessToken: bob.data.accessToken,
      body: { elements: [] },
    });
    expect(editAttempt.status).toBe(403);

    // 16. Bob can still read
    const readAttempt = await api(`/api/diagrams/${rootDiagramId}`, {
      accessToken: bob.data.accessToken,
    });
    expect(readAttempt.status).toBe(200);

    // 17. Alice revokes Bob's access entirely
    await api(`/api/permissions/${bobPerm!.id}`, {
      method: 'DELETE',
      accessToken: alice.data.accessToken,
    });

    const bobAccessDenied = await api(`/api/projects/${projectId}`, {
      accessToken: bob.data.accessToken,
    });
    expect(bobAccessDenied.status).toBe(403);

    // 18. Alice deletes the project
    const deleteRes = await api(`/api/projects/${projectId}`, {
      method: 'DELETE',
      accessToken: alice.data.accessToken,
    });
    expect(deleteRes.status).toBe(200);

    // 19. Verify cascade — diagrams gone too
    const diagGone = await api(`/api/diagrams/${rootDiagramId}`, {
      accessToken: alice.data.accessToken,
    });
    expect(diagGone.status).toBe(404);
  });
});
