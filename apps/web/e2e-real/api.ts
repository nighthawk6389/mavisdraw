import type { APIRequestContext, APIResponse } from '@playwright/test';
import { expect } from '@playwright/test';
import { API_URL } from './helpers';

/**
 * Helpers for API-level tests: several people calling the real backend with
 * their own bearer tokens, no browser involved.
 */

export interface Person {
  id: string;
  name: string;
  email: string;
  token: string;
}

let counter = 0;
/** Unique per call and per run, so tests never collide with data left by earlier runs. */
export const uniq = () =>
  `${Date.now().toString(36)}${(++counter).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export async function signUp(api: APIRequestContext, name: string): Promise<Person> {
  const email = `${name.toLowerCase().replace(/\W+/g, '-')}-${uniq()}@e2e.mavisdraw.dev`;
  const res = await api.post(`${API_URL}/api/auth/register`, {
    data: { email, password: 'correct-horse-battery', name },
  });
  expect(res.status(), await res.text()).toBe(201);
  const body = (await res.json()) as { user: { id: string }; accessToken: string };
  return { id: body.user.id, name, email, token: body.accessToken };
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Calls as one person (or anonymously). */
export function as(api: APIRequestContext, who: Person | null) {
  const call = (method: Method, path: string, data?: unknown): Promise<APIResponse> =>
    api.fetch(`${API_URL}${path}`, {
      method,
      headers: who ? { Authorization: `Bearer ${who.token}` } : {},
      ...(data !== undefined ? { data } : {}),
    });
  return {
    get: (path: string) => call('GET', path),
    post: (path: string, data: unknown = {}) => call('POST', path, data),
    put: (path: string, data: unknown) => call('PUT', path, data),
    patch: (path: string, data: unknown) => call('PATCH', path, data),
    delete: (path: string) => call('DELETE', path),
  };
}

/** The JSON body of a response that must have the given status. */
export async function expectJson<T>(res: Promise<APIResponse> | APIResponse, status: number) {
  const r = await res;
  expect(r.status(), `${r.url()}: ${await r.text()}`).toBe(status);
  return (r.status() === 204 ? undefined : await r.json()) as T;
}

export async function createProject(
  api: APIRequestContext,
  owner: Person,
  name: string,
  workspaceId?: string,
) {
  const body = await expectJson<{
    project: { id: string; rootDiagramId: string };
  }>(as(api, owner).post('/api/projects', { name, ...(workspaceId ? { workspaceId } : {}) }), 201);
  return body.project;
}

/** Add someone with an account to a project directly (by email invite). */
export async function addToProject(
  api: APIRequestContext,
  by: Person,
  projectId: string,
  who: Person,
  role: 'viewer' | 'editor' | 'admin',
) {
  const body = await expectJson<{ status: string }>(
    as(api, by).post(`/api/projects/${projectId}/invites`, { email: who.email, role }),
    201,
  );
  expect(body.status).toBe('added');
}

export async function createWorkspace(api: APIRequestContext, owner: Person, name: string) {
  return (
    await expectJson<{ workspace: { id: string } }>(
      as(api, owner).post('/api/workspaces', { name }),
      201,
    )
  ).workspace;
}

export async function addToWorkspace(
  api: APIRequestContext,
  by: Person,
  workspaceId: string,
  who: Person,
  role: 'member' | 'admin',
) {
  const body = await expectJson<{ status: string }>(
    as(api, by).post(`/api/workspaces/${workspaceId}/invites`, { email: who.email, role }),
    201,
  );
  expect(body.status).toBe('added');
}

export async function roleIn(api: APIRequestContext, who: Person, projectId: string) {
  const res = await as(api, who).get(`/api/projects/${projectId}`);
  if (!res.ok()) return res.status();
  return ((await res.json()) as { project: { role: string } }).project.role;
}

export async function permissionsOf(api: APIRequestContext, who: Person, projectId: string) {
  return (
    await expectJson<{
      permissions: Array<{
        id: string;
        userId: string | null;
        role: string;
        shareToken: string | null;
      }>;
    }>(as(api, who).get(`/api/projects/${projectId}/permissions`), 200)
  ).permissions;
}
