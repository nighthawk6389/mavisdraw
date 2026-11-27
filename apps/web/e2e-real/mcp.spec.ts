import { test, expect, type Page } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
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
} from './helpers';

/** A coding agent connected the way Claude Code connects: MCP over HTTP with a bearer token. */
async function connectAgent(token: string): Promise<Client> {
  const client = new Client({ name: 'e2e-agent', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${API_URL}/api/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}

async function callTool(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = (await client.callTool({ name, arguments: args })) as {
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  };
  return { text: result.content.map((c) => c.text).join('\n'), isError: !!result.isError };
}

/** Paste a Mermaid flowchart onto the canvas (subgraphs become nested diagrams). */
async function pasteMermaid(page: Page, lines: string[]) {
  const box = (await interactiveCanvas(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.evaluate((text) => {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
  }, lines.join('\n'));
}

const labelsOf = (elements: Array<Record<string, unknown>>) =>
  elements
    .filter((e) => !e.isDeleted)
    .map((e) =>
      e.type === 'portal' ? (e.label as string) : e.type === 'text' ? (e.text as string) : null,
    )
    .filter((l): l is string => !!l)
    .sort();

test.describe('Coding agents (MCP)', () => {
  test('an agent reads the map, finds a component, and its proposal is applied in the editor', async ({
    page,
    context,
  }) => {
    const user = await registerUser(context, 'Agent Owner');
    const project = await apiCreateProject(context.request, user, 'Shop Map');

    // Draw the map the usual way: paste a Mermaid flowchart
    await openProject(page, 'Shop Map');
    await pasteMermaid(page, [
      'flowchart LR',
      '  web[Web App] -->|HTTPS| api',
      '  subgraph platform [Platform]',
      '    api[API] --> orders[Orders]',
      '  end',
    ]);
    await waitForSaved(page);
    const platform = async () =>
      (await apiListDiagrams(context.request, user, project.id)).find(
        (d) => d.title === 'Platform',
      );
    await expect.poll(async () => (await platform())?.id ?? null).not.toBeNull();
    const platformId = (await platform())!.id;
    await expect
      .poll(async () =>
        labelsOf((await apiGetDiagram(context.request, user, platformId)).diagram?.elements ?? []),
      )
      .toEqual(['API', 'Orders']);

    // Create a token from the dashboard, as a new user would
    await page.getByRole('button', { name: '← Projects' }).click();
    await page.getByRole('button', { name: 'Connect a coding agent' }).click();
    const dialog = page.getByRole('dialog', { name: 'Connect a coding agent' });
    await dialog.getByLabel('Token name').fill('Claude Code (e2e)');
    await dialog.getByRole('button', { name: 'Create token' }).click();
    const token = (await dialog.getByTestId('new-token').textContent())!.trim();
    expect(token).toMatch(/^mdw_/);
    await expect(dialog.getByTestId('setup-claude-code')).toContainText(
      `claude mcp add --transport http mavisdraw ${API_URL}/api/mcp --header "Authorization: Bearer ${token}"`,
    );
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(dialog.getByRole('list', { name: 'Access tokens' })).toContainText(
      'Claude Code (e2e)',
    );
    await dialog.getByRole('button', { name: 'Close' }).click();

    // The agent explores
    const agent = await connectAgent(token);
    const { tools } = await agent.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'find_component',
      'get_component',
      'list_projects',
      'propose_update',
      'read_architecture',
    ]);
    expect((await callTool(agent, 'list_projects')).text).toContain('**Shop Map**');
    const map = await callTool(agent, 'read_architecture', { project: 'Shop Map' });
    expect(map.isError).toBe(false);
    for (const name of ['Web App', 'Platform', 'API', 'Orders']) expect(map.text).toContain(name);
    const found = await callTool(agent, 'find_component', { query: 'orders' });
    expect(found.text).toContain('### Orders — project "Shop Map"');
    expect(found.text).toContain('Platform');
    // The component across levels, by the id find_component gave
    const componentId = /component id: `([^`]+)`/.exec(found.text)![1];
    const component = await callTool(agent, 'get_component', {
      project: 'Shop Map',
      component: componentId,
    });
    expect(component.isError).toBe(false);
    expect(component.text).toContain(`### Orders (`);
    expect(component.text).toContain('- part of: Platform');

    // The owner has the map open while the agent proposes an update
    await openProject(page, 'Shop Map');
    await isConnected(page);
    const proposed = await callTool(agent, 'propose_update', {
      project: 'Shop Map',
      diagram: 'Platform',
      description: 'Orders now charge cards through Stripe',
      add: [{ name: 'Payments' }, { name: 'Stripe', kind: 'system' }],
      connect: [
        { from: 'Orders', to: 'Payments', label: 'charges' },
        { from: 'Payments', to: 'Stripe' },
      ],
    });
    expect(proposed.isError, proposed.text).toBe(false);
    expect(proposed.text).toContain('waiting for review');

    // It shows up live, without a reload
    const button = page.getByRole('button', { name: 'Proposals · 1' });
    await expect(button).toBeVisible({ timeout: 10_000 });
    await button.click();
    const card = page.getByTestId('proposal');
    await expect(card).toContainText('Orders now charge cards through Stripe');
    await expect(card).toContainText('Claude Code (e2e)');
    await expect(card).toContainText('On “Platform”');
    await expect(card).toContainText('"Orders" → "Payments" (charges)');

    await card.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByTestId('toast')).toContainText('Applied: 2 added, 2 connected');
    // Applied where it was proposed: inside Platform
    await expect(page.getByRole('navigation')).toContainText('Platform');
    await expect
      .poll(async () => labelsOf(await getActiveElements(page)))
      .toEqual(['API', 'Orders', 'Payments', 'Stripe', 'charges']);
    await expect(page.getByTestId('proposals-panel')).toContainText('Nothing waiting for review');

    // …and saved for everyone
    await expect
      .poll(
        async () =>
          labelsOf(
            (await apiGetDiagram(context.request, user, platformId)).diagram?.elements ?? [],
          ),
        { timeout: 20_000 },
      )
      .toEqual(['API', 'Orders', 'Payments', 'Stripe', 'charges']);

    // Across levels. Web App is only on the top level, so from inside
    // Platform a connection to it is recorded in the model…
    const recordOnly = await callTool(agent, 'propose_update', {
      project: 'Shop Map',
      diagram: 'Platform',
      description: 'Orders pushes order updates to the web app',
      connect: [{ from: 'Orders', to: 'Web App', label: 'order updates' }],
    });
    expect(recordOnly.isError, recordOnly.text).toBe(false);
    const card2 = page.getByTestId('proposal');
    await expect(card2).toContainText('recorded: one end is on another diagram', {
      timeout: 10_000,
    });
    await card2.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByTestId('toast').filter({ hasText: '1 recorded' })).toBeVisible();

    // …and it can be shown here as the same component, not a copy
    const showHere = await callTool(agent, 'propose_update', {
      project: 'Shop Map',
      diagram: 'Platform',
      description: 'Show the web app next to Payments',
      add: [{ name: 'Web App' }],
      connect: [{ from: 'Payments', to: 'Web App', label: 'receipts' }],
    });
    expect(showHere.isError, showHere.text).toBe(false);
    const card3 = page.getByTestId('proposal');
    await expect(card3).toContainText('Show "Web App" here too (already on', {
      timeout: 10_000,
    });
    await card3.getByRole('button', { name: 'Apply' }).click();
    await expect(
      page.getByTestId('toast').filter({ hasText: 'Applied: 1 added, 1 connected' }),
    ).toBeVisible();

    const model = async () => {
      const res = await context.request.get(`${API_URL}/api/projects/${project.id}/model`, {
        headers: { Authorization: `Bearer ${user.accessToken}` },
      });
      return (
        (await res.json()) as {
          model: {
            components: Array<{ id: string; name: string; appearances: unknown[] }>;
            relationships: Array<{
              sourceId: string;
              targetId: string;
              description: string | null;
            }>;
          };
        }
      ).model;
    };
    // One Web App, drawn on both levels; Orders → Web App recorded with its description
    await expect
      .poll(
        async () =>
          (await model()).components
            .filter((c) => c.name === 'Web App')
            .map((c) => c.appearances.length),
        { timeout: 15_000 },
      )
      .toEqual([2]);
    const m = await model();
    const web = m.components.find((c) => c.name === 'Web App')!;
    const ordersC = m.components.find((c) => c.name === 'Orders')!;
    expect(m.relationships).toContainEqual(
      expect.objectContaining({
        sourceId: ordersC.id,
        targetId: web.id,
        description: 'order updates',
      }),
    );

    // Revoking the token cuts the agent off at once
    await page.keyboard.press('Escape');
    await page.keyboard.press('ControlOrMeta+k');
    await page.getByLabel('Search shapes, diagrams and commands').fill('coding agent');
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Revoke Claude Code (e2e)' }).click();
    await expect(
      page.getByTestId('toast').filter({ hasText: 'can no longer connect' }),
    ).toBeVisible();
    await expect(callTool(agent, 'list_projects')).rejects.toThrow();
  });

  test('a viewer’s agent can read the map but not propose changes', async ({ browser }) => {
    const { ctxA, ctxB, guest, owner, project } = await twoPeople(browser, 'viewer');
    const res = await ctxB.request.post(`${API_URL}/api/tokens`, {
      headers: { Authorization: `Bearer ${guest.accessToken}` },
      data: { name: 'Viewer agent' },
    });
    expect(res.status()).toBe(201);
    const { token } = (await res.json()) as { token: string };

    const agent = await connectAgent(token);
    const read = await callTool(agent, 'read_architecture', { project: project.id });
    expect(read.isError).toBe(false);
    const proposed = await callTool(agent, 'propose_update', {
      project: project.id,
      description: 'Add a cache',
      add: [{ name: 'Redis', kind: 'datastore' }],
    });
    expect(proposed.isError).toBe(true);
    expect(proposed.text).toContain('but not change it');

    // Nothing reached the review queue
    const list = await ctxA.request.get(`${API_URL}/api/projects/${project.id}/proposals`, {
      headers: { Authorization: `Bearer ${owner.accessToken}` },
    });
    expect(((await list.json()) as { proposals: unknown[] }).proposals).toEqual([]);

    await ctxA.close();
    await ctxB.close();
  });

  test('the endpoint refuses requests without a valid token', async ({ request }) => {
    const res = await request.post(`${API_URL}/api/mcp`, {
      headers: { Accept: 'application/json, text/event-stream' },
      data: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    });
    expect(res.status()).toBe(401);
    expect(res.headers()['www-authenticate']).toContain('Bearer');
    const wrong = await request.post(`${API_URL}/api/mcp`, {
      headers: {
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer mdw_${'x'.repeat(43)}`,
      },
      data: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    });
    expect(wrong.status()).toBe(401);
  });
});
