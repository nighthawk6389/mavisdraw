import { test, expect, type APIRequestContext } from '@playwright/test';
import { addToProject, as, createProject, expectJson, signUp, uniq, type Person } from './api';

/**
 * Diagram contents, version history and nested diagrams through the REST
 * API (what the editor's autosave, the History panel and agents rely on),
 * with no live collaboration room open.
 */

interface Element {
  id: string;
  type: string;
  x: number;
  version: number;
  [k: string]: unknown;
}

const box = (id: string, diagramId: string, x: number, version = 1): Element => ({
  id,
  type: 'rectangle',
  x,
  y: 0,
  width: 100,
  height: 60,
  version,
  isDeleted: false,
  diagramId,
});

async function elementsOf(api: APIRequestContext, who: Person, diagramId: string) {
  const { diagram } = await expectJson<{ diagram: { elements: Element[] } }>(
    as(api, who).get(`/api/diagrams/${diagramId}`),
    200,
  );
  return diagram.elements;
}

interface VersionRow {
  id: string;
  version: number;
  label: string | null;
  trigger: string;
  elementCount: number;
}

async function versionsOf(api: APIRequestContext, who: Person, diagramId: string, query = '') {
  return (
    await expectJson<{ snapshots: VersionRow[] }>(
      as(api, who).get(`/api/diagrams/${diagramId}/snapshots${query}`),
      200,
    )
  ).snapshots;
}

test.describe('Diagrams over REST', () => {
  test('versions are listed newest first, page, and refuse nonsense paging', async ({
    request,
  }) => {
    const owner = await signUp(request, 'Owner');
    const { rootDiagramId: d } = await createProject(request, owner, `Versions ${uniq()}`);
    const c = as(request, owner);
    for (let i = 1; i <= 3; i++) {
      await expectJson(
        c.put(`/api/diagrams/${d}`, {
          elements: [1, 2, 3].slice(0, i).map((n) => box(`b${n}`, d, n)),
        }),
        200,
      );
      await expectJson(c.post(`/api/diagrams/${d}/save`, { label: `v${i}` }), 201);
    }

    const all = await versionsOf(request, owner, d);
    expect(all.map((v) => [v.version, v.label, v.elementCount])).toEqual([
      [3, 'v3', 3],
      [2, 'v2', 2],
      [1, 'v1', 1],
    ]);
    expect((await versionsOf(request, owner, d, '?limit=1&offset=1')).map((v) => v.label)).toEqual([
      'v2',
    ]);
    // The list is for browsing: one version's contents come separately
    expect(all[0]).not.toHaveProperty('elements');
    const one = await expectJson<{ snapshot: { elements: Element[] } }>(
      c.get(`/api/diagrams/${d}/snapshots/${all[2].id}`),
      200,
    );
    expect(one.snapshot.elements.map((e) => e.id)).toEqual(['b1']);

    for (const query of ['?offset=-1', '?limit=0', '?limit=abc', '?offset=1.5']) {
      expect((await c.get(`/api/diagrams/${d}/snapshots${query}`)).status(), query).toBe(400);
    }
    // Asking for more than a page is capped, not refused
    expect(await versionsOf(request, owner, d, '?limit=1000')).toHaveLength(3);
  });

  test('restoring a version brings its contents back and keeps what it replaced', async ({
    request,
  }) => {
    const owner = await signUp(request, 'Owner');
    const { rootDiagramId: d } = await createProject(request, owner, `Restore ${uniq()}`);
    const c = as(request, owner);
    await expectJson(c.put(`/api/diagrams/${d}`, { elements: [box('keep', d, 10)] }), 200);
    const good = (
      await expectJson<{ snapshot: { id: string } }>(
        c.post(`/api/diagrams/${d}/save`, { label: 'Good' }),
        201,
      )
    ).snapshot;
    await expectJson(
      c.put(`/api/diagrams/${d}`, { elements: [box('oops', d, 99), box('oops2', d, 199)] }),
      200,
    );

    await expectJson(c.post(`/api/diagrams/${d}/snapshots/${good.id}/restore`), 200);
    expect((await elementsOf(request, owner, d)).map((e) => e.id)).toEqual(['keep']);

    // The replaced state is a named version (automatic ones get pruned)…
    const versions = await versionsOf(request, owner, d);
    const backup = versions.find((v) => v.label === 'Before restoring “Good”');
    expect(backup).toMatchObject({ trigger: 'manual', elementCount: 2 });
    // …so the restore itself can be undone
    await expectJson(c.post(`/api/diagrams/${d}/snapshots/${backup!.id}/restore`), 200);
    expect((await elementsOf(request, owner, d)).map((e) => e.id).sort()).toEqual([
      'oops',
      'oops2',
    ]);
  });

  test('automatic versions are capped per diagram; named ones are kept', async ({ request }) => {
    const owner = await signUp(request, 'Owner');
    const { rootDiagramId: d } = await createProject(request, owner, `Prune ${uniq()}`);
    const c = as(request, owner);
    await expectJson(c.post(`/api/diagrams/${d}/save`, { label: 'Launch' }), 201);
    for (let i = 0; i < 52; i++) {
      await expectJson(c.post(`/api/diagrams/${d}/save`, { trigger: 'auto' }), 201);
    }
    const versions = await versionsOf(request, owner, d, '?limit=100');
    expect(versions.filter((v) => v.trigger === 'auto')).toHaveLength(50);
    // The oldest automatic ones went; the named version stayed
    expect(versions.map((v) => v.version)).not.toContain(2);
    expect(versions.find((v) => v.label === 'Launch')).toMatchObject({ version: 1 });
  });

  test('a save based on an outdated copy is reported, not applied', async ({ request }) => {
    const owner = await signUp(request, 'Owner');
    const teammate = await signUp(request, 'Teammate');
    const project = await createProject(request, owner, `Conflicts ${uniq()}`);
    await addToProject(request, owner, project.id, teammate, 'editor');
    const d = project.rootDiagramId;

    // Both start from version 1 of the same box
    await expectJson(
      as(request, owner).put(`/api/diagrams/${d}`, { elements: [box('b', d, 0)] }),
      200,
    );
    // The owner moves it (based on v1)
    const first = await expectJson<{ conflicts: string[] }>(
      as(request, owner).put(`/api/diagrams/${d}`, {
        elements: [box('b', d, 300, 2)],
        baseVersions: { b: 1 },
      }),
      200,
    );
    expect(first.conflicts).toEqual([]);
    // The teammate, still on v1, moves it elsewhere: refused, and told so
    const second = await expectJson<{ conflicts: string[]; diagram: { elements: Element[] } }>(
      as(request, teammate).put(`/api/diagrams/${d}`, {
        elements: [box('b', d, -500, 2)],
        baseVersions: { b: 1 },
      }),
      200,
    );
    expect(second.conflicts).toEqual(['b']);
    expect((await elementsOf(request, owner, d)).map((e) => [e.id, e.x])).toEqual([['b', 300]]);

    // A delete based on an outdated copy doesn't remove the newer version either
    const del = await expectJson<{ conflicts: string[] }>(
      as(request, teammate).put(`/api/diagrams/${d}`, {
        elements: [],
        deletedIds: ['b'],
        baseVersions: { b: 1 },
      }),
      200,
    );
    expect(del.conflicts).toEqual(['b']);
    expect((await elementsOf(request, owner, d)).map((e) => e.id)).toEqual(['b']);
    // Based on the current version, it goes
    const current = (await elementsOf(request, owner, d))[0].version;
    await expectJson(
      as(request, teammate).put(`/api/diagrams/${d}`, {
        elements: [],
        deletedIds: ['b'],
        baseVersions: { b: current },
      }),
      200,
    );
    expect(await elementsOf(request, owner, d)).toEqual([]);
  });

  test('nested diagrams: created idempotently, deletable, but the top level stays', async ({
    request,
  }) => {
    const owner = await signUp(request, 'Owner');
    const editor = await signUp(request, 'Editor');
    const project = await createProject(request, owner, `Nested ${uniq()}`);
    await addToProject(request, owner, project.id, editor, 'editor');
    const e = as(request, editor);

    // The editor creates a nested level with a client id (offline-first): a
    // retry returns the same diagram instead of a duplicate
    const id = `child${uniq()}`.slice(0, 32);
    const create = () =>
      e.post('/api/diagrams', {
        id,
        projectId: project.id,
        parentDiagramId: project.rootDiagramId,
        title: 'Payments',
      });
    expect((await create()).status()).toBe(201);
    expect((await create()).status()).toBe(200);
    const list = async () =>
      (
        await expectJson<{ diagrams: Array<{ id: string; parentDiagramId: string | null }> }>(
          e.get(`/api/projects/${project.id}/diagrams`),
          200,
        )
      ).diagrams;
    expect((await list()).filter((d) => d.id === id)).toEqual([
      expect.objectContaining({ parentDiagramId: project.rootDiagramId }),
    ]);
    expect((await e.post('/api/diagrams', { id: 'bad id!', projectId: project.id })).status()).toBe(
      400,
    );

    // Nested levels can be deleted; the top-level diagram can't (the project
    // would no longer open, and its history would go with it)
    await expectJson(e.delete(`/api/diagrams/${id}`), 200);
    expect((await list()).map((d) => d.id)).toEqual([project.rootDiagramId]);
    for (const who of [editor, owner]) {
      expect(
        (await as(request, who).delete(`/api/diagrams/${project.rootDiagramId}`)).status(),
      ).toBe(409);
    }
    expect((await e.get(`/api/diagrams/${project.rootDiagramId}`)).status()).toBe(200);
  });
});
