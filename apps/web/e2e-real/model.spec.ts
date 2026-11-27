import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import {
  API_URL,
  apiCreateProject,
  apiGetDiagram,
  apiListDiagrams,
  getActiveElements,
  interactiveCanvas,
  isConnected,
  openProject,
  registerUser,
  twoPeople,
  waitForSaved,
  type TestUser,
} from './helpers';

/**
 * The architecture model (docs/model-layer.md): computed from the drawings
 * plus recorded details. Renaming a component relabels it everywhere — in
 * open tabs at once, and in diagrams nobody has open.
 */

type Component = {
  id: string;
  name: string;
  kind: string;
  description: string | null;
  technology: string | null;
  links: Array<{ label: string; url: string }>;
  detailDiagramId: string | null;
  appearances: Array<{ diagramId: string; elementId: string; path: string[] }>;
  parents: string[];
};
type Relationship = {
  sourceId: string;
  targetId: string;
  description: string | null;
  labels: string[];
  drawn: unknown[];
};

async function pasteMermaid(page: Page, lines: string[]) {
  const box = (await interactiveCanvas(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.evaluate((text) => {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
  }, lines.join('\n'));
}

function api(request: APIRequestContext, user: TestUser, projectId: string) {
  const headers = { Authorization: `Bearer ${user.accessToken}` };
  const base = `${API_URL}/api/projects/${projectId}/model`;
  return {
    get: async () => {
      const res = await request.get(base, { headers });
      expect(res.status(), await res.text()).toBe(200);
      return (
        (await res.json()) as {
          model: { components: Component[]; relationships: Relationship[] };
        }
      ).model;
    },
    put: (componentId: string, data: Record<string, unknown>) =>
      request.put(`${base}/components/${componentId}`, { headers, data }),
    create: (data: Record<string, unknown>) =>
      request.post(`${base}/components`, { headers, data }),
    remove: (componentId: string) =>
      request.delete(`${base}/components/${componentId}`, { headers }),
    relate: (data: Record<string, unknown>) =>
      request.put(`${base}/relationships`, { headers, data }),
    unrelate: (source: string, target: string) =>
      request.delete(`${base}/relationships?source=${source}&target=${target}`, { headers }),
  };
}

const named = (components: Component[], name: string) => {
  const c = components.find((x) => x.name === name);
  if (!c) throw new Error(`no component "${name}" in ${components.map((x) => x.name)}`);
  return c;
};

test.describe('Architecture model', () => {
  test('is computed from the map, and a rename reaches every diagram', async ({
    page,
    context,
  }) => {
    const user = await registerUser(context, 'Model Owner');
    const project = await apiCreateProject(context.request, user, 'Model Demo');
    await openProject(page, 'Model Demo');
    await pasteMermaid(page, [
      'flowchart LR',
      '  web[Web App] -->|HTTPS| api',
      '  subgraph platform [Platform]',
      '    api[API] --> db[(Orders DB)]',
      '  end',
    ]);
    await waitForSaved(page);
    const model = api(context.request, user, project.id);
    await expect
      .poll(async () => (await model.get()).components.map((c) => c.name).sort())
      .toEqual(['API', 'Orders DB', 'Platform', 'Web App']);

    const first = await model.get();
    const platform = named(first.components, 'Platform');
    const apiC = named(first.components, 'API');
    const db = named(first.components, 'Orders DB');
    expect(platform).toMatchObject({ kind: 'system' });
    expect(platform.detailDiagramId).toBeTruthy();
    // What's drawn inside Platform is inside it…
    expect(apiC.parents).toEqual([platform.id]);
    expect(apiC.appearances[0].path).toEqual([expect.any(String), 'Platform']);
    // …and the arrow inside is a relationship
    expect(first.relationships).toContainEqual(
      expect.objectContaining({ sourceId: apiC.id, targetId: db.id }),
    );

    // Rename Platform while it's open here: the tab shows it at once, and the
    // diagram it opens into is renamed too
    await isConnected(page);
    const res = await model.put(platform.id, { name: 'Commerce Platform' });
    expect(res.status(), await res.text()).toBe(200);
    await expect
      .poll(async () => (await getActiveElements(page)).find((e) => e.type === 'portal')?.label)
      .toBe('Commerce Platform');
    expect(
      (await apiListDiagrams(context.request, user, project.id)).find(
        (d) => d.id === platform.detailDiagramId,
      )?.title,
    ).toBe('Commerce Platform');

    // Rename API, which nobody has open: its stored diagram changes, and it
    // stays changed when a live room opens on it
    const renamed = await model.put(apiC.id, { name: 'Orders API' });
    expect(renamed.status()).toBe(200);
    await expect
      .poll(async () =>
        (
          await apiGetDiagram(context.request, user, platform.detailDiagramId!)
        ).diagram!.elements.map((e) => e.text),
      )
      .toContain('Orders API');
    await page.goto(`/p/${project.id}/d/${platform.detailDiagramId}`);
    await expect(page.locator('canvas').first()).toBeVisible();
    await isConnected(page);
    await expect
      .poll(async () => (await getActiveElements(page)).map((e) => e.text).filter(Boolean))
      .toContain('Orders API');
    expect((await model.get()).components.map((c) => c.name).sort()).toEqual([
      'Commerce Platform',
      'Orders API',
      'Orders DB',
      'Web App',
    ]);
  });

  test('records details, model-only components and undrawn dependencies', async ({ browser }) => {
    const { ctxA, ctxB, a, owner, guest, project } = await twoPeople(browser, 'viewer');
    await pasteMermaid(a, ['flowchart LR', '  web[Web App] --> api[API]']);
    await waitForSaved(a);
    const model = api(ctxA.request, owner, project.id);
    await expect.poll(async () => (await model.get()).components.length).toBe(2);
    const { components } = await model.get();
    const apiC = named(components, 'API');
    const web = named(components, 'Web App');

    // Details
    const saved = await model.put(apiC.id, {
      kind: 'service',
      description: 'Serves the storefront',
      technology: 'Node.js',
      links: [{ label: 'Runbook', url: 'https://wiki.example.com/api' }],
    });
    expect(saved.status(), await saved.text()).toBe(200);
    expect(named((await model.get()).components, 'API')).toMatchObject({
      description: 'Serves the storefront',
      technology: 'Node.js',
      links: [{ label: 'Runbook', url: 'https://wiki.example.com/api' }],
    });
    expect(
      (await model.put(apiC.id, { links: [{ label: 'x', url: 'javascript:alert(1)' }] })).status(),
    ).toBe(400);

    // A component nobody has drawn yet, and a dependency on it
    const created = await model.create({ name: 'Stripe', kind: 'external' });
    expect(created.status()).toBe(201);
    const stripe = ((await created.json()) as { component: Component }).component;
    expect(stripe).toMatchObject({ name: 'Stripe', appearances: [] });
    const rel = await model.relate({
      sourceId: apiC.id,
      targetId: stripe.id,
      description: 'charges cards',
    });
    expect(rel.status(), await rel.text()).toBe(200);
    // The drawn arrow gets recorded details too
    expect(
      (await model.relate({ sourceId: web.id, targetId: apiC.id, technology: 'REST' })).status(),
    ).toBe(200);
    const rels = (await model.get()).relationships;
    expect(rels).toContainEqual(
      expect.objectContaining({ sourceId: apiC.id, targetId: stripe.id, drawn: [] }),
    );
    expect(rels.find((r) => r.sourceId === web.id)).toMatchObject({ technology: 'REST' });
    expect((await model.relate({ sourceId: apiC.id, targetId: apiC.id })).status()).toBe(400);
    expect((await model.relate({ sourceId: apiC.id, targetId: 'c_nope' })).status()).toBe(404);

    // Viewers read the model but can't change it
    const viewer = api(ctxB.request, guest, project.id);
    expect((await viewer.get()).components.map((c) => c.name)).toContain('Stripe');
    expect((await viewer.put(apiC.id, { description: 'hacked' })).status()).toBe(403);
    expect((await viewer.create({ name: 'Mine' })).status()).toBe(403);

    // Forgetting Stripe removes it and what was recorded about it
    expect((await model.unrelate(web.id, apiC.id)).status()).toBe(204);
    expect((await model.remove(stripe.id)).status()).toBe(204);
    const after = await model.get();
    expect(after.components.map((c) => c.name).sort()).toEqual(['API', 'Web App']);
    expect(after.relationships.map((r) => [r.sourceId, r.targetId])).toEqual([[web.id, apiC.id]]);
    expect(after.relationships[0]).toMatchObject({ technology: null });

    // Someone outside the project sees nothing
    const ctxC = await browser.newContext();
    const stranger = await registerUser(ctxC, 'Stranger');
    const res = await ctxC.request.get(`${API_URL}/api/projects/${project.id}/model`, {
      headers: { Authorization: `Bearer ${stranger.accessToken}` },
    });
    expect(res.status()).toBe(403);

    await ctxA.close();
    await ctxB.close();
    await ctxC.close();
  });
});
