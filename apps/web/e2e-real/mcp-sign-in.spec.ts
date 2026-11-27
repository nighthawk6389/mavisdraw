import { createHash, randomBytes } from 'node:crypto';
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { API_URL, apiCreateProject, registerUser } from './helpers';

/**
 * Coding agents signing in through the browser (OAuth 2.1), driven by the
 * MCP SDK's own client: the discovery, registration, PKCE and token exchange
 * real agents (Claude Code, Cursor…) perform.
 */

const MCP_URL = `${API_URL}/api/mcp`;
const CALLBACK_ORIGIN = 'http://127.0.0.1:47811';
const CALLBACK = `${CALLBACK_ORIGIN}/callback`;

/** An agent's sign-in state, kept in memory as a CLI would keep it on disk. */
class AgentAuth implements OAuthClientProvider {
  info?: OAuthClientInformationMixed;
  saved?: OAuthTokens;
  verifier = '';
  authorizationUrl?: URL;

  get redirectUrl() {
    return CALLBACK;
  }
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'E2E Agent',
      redirect_uris: [CALLBACK],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
  }
  clientInformation() {
    return this.info;
  }
  saveClientInformation(info: OAuthClientInformationMixed) {
    this.info = info;
  }
  tokens() {
    return this.saved;
  }
  saveTokens(tokens: OAuthTokens) {
    this.saved = tokens;
  }
  redirectToAuthorization(url: URL) {
    this.authorizationUrl = url;
  }
  saveCodeVerifier(verifier: string) {
    this.verifier = verifier;
  }
  codeVerifier() {
    return this.verifier;
  }
}

/** Catch the browser being sent back to the agent; resolves with that address. */
async function catchCallback(page: Page): Promise<() => string | null> {
  let reached: string | null = null;
  await page.route(`${CALLBACK_ORIGIN}/**`, (route) => {
    reached = route.request().url();
    return route.fulfill({ contentType: 'text/plain', body: 'Signed in: back to the agent' });
  });
  return () => reached;
}

/** The agent's first connection: turned away, it opens the browser to sign in. */
async function startSignIn(auth: AgentAuth) {
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), { authProvider: auth });
  const client = new Client({ name: 'e2e-agent', version: '1.0.0' });
  await expect(client.connect(transport)).rejects.toThrow(/Unauthorized/);
  expect(auth.authorizationUrl, 'the agent should have been sent to sign in').toBeDefined();
  return transport;
}

async function connectSignedIn(auth: AgentAuth) {
  const client = new Client({ name: 'e2e-agent', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(MCP_URL), { authProvider: auth }));
  return client;
}

async function callTool(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = (await client.callTool({ name, arguments: args })) as {
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  };
  return { text: result.content.map((c) => c.text).join('\n'), isError: !!result.isError };
}

const mcpStatus = async (request: APIRequestContext, accessToken: string) =>
  (
    await request.post(MCP_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
      },
      data: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
    })
  ).status();

/** A sign-in by hand (no SDK), to try what a misbehaving client might send. */
async function manualCode(page: Page, request: APIRequestContext) {
  const registered = await request.post(`${API_URL}/api/oauth/register`, {
    data: { client_name: 'Hand-rolled Agent', redirect_uris: [CALLBACK] },
  });
  expect(registered.status()).toBe(201);
  const { client_id: clientId } = (await registered.json()) as { client_id: string };
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const reached = await catchCallback(page);
  const authorize = new URL(`${API_URL}/api/oauth/authorize`);
  authorize.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: CALLBACK,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'xyz',
    resource: MCP_URL,
  }).toString();
  await page.goto(authorize.toString());
  await page.getByTestId('connect-agent-approve').click();
  await expect.poll(reached).not.toBeNull();
  const back = new URL(reached()!);
  expect(back.searchParams.get('state')).toBe('xyz');
  await page.unroute(`${CALLBACK_ORIGIN}/**`);
  return { clientId, verifier, code: back.searchParams.get('code')! };
}

const exchange = (
  request: APIRequestContext,
  form: { clientId: string; code: string; verifier: string },
) =>
  request.post(`${API_URL}/api/oauth/token`, {
    form: {
      grant_type: 'authorization_code',
      client_id: form.clientId,
      code: form.code,
      code_verifier: form.verifier,
      redirect_uri: CALLBACK,
    },
  });

test.describe('Coding agents signing in through the browser', () => {
  test('the agent signs in with the limits the person chose, renews, and is disconnected', async ({
    page,
    context,
  }) => {
    const user = await registerUser(context, 'Agent Owner');
    await apiCreateProject(context.request, user, 'Shop Map');
    await apiCreateProject(context.request, user, 'Secret Map');

    const auth = new AgentAuth();
    const transport = await startSignIn(auth);
    const reached = await catchCallback(page);

    // The browser opens MavisDraw's consent page, already signed in
    await page.goto(auth.authorizationUrl!.toString());
    const consent = page.getByTestId('connect-agent');
    await expect(consent).toContainText('Connect E2E Agent?');
    await expect(consent).toContainText('back to the agent on this computer (127.0.0.1:47811)');
    await consent.getByLabel('Only read maps').check();
    await consent.getByLabel('Only the maps I choose').check();
    // A limited sign-in needs at least one map
    await expect(page.getByTestId('connect-agent-approve')).toBeDisabled();
    await consent.getByLabel('Shop Map').check();
    await page.getByTestId('connect-agent-approve').click();

    await expect.poll(reached).not.toBeNull();
    const code = new URL(reached()!).searchParams.get('code')!;
    await transport.finishAuth(code);
    expect(auth.saved?.scope).toBe('mcp:read');
    expect(auth.saved?.refresh_token).toMatch(/^mdwr_/);

    // It reads only the chosen map, and can't propose
    const agent = await connectSignedIn(auth);
    const { tools } = await agent.listTools();
    expect(tools.map((t) => t.name)).not.toContain('propose_update');
    const listed = await callTool(agent, 'list_projects');
    expect(listed.text).toContain('Shop Map');
    expect(listed.text).not.toContain('Secret Map');
    expect((await callTool(agent, 'read_architecture', { project: 'Secret Map' })).isError).toBe(
      true,
    );

    // Renewing: a refresh token works once
    const clientId = (auth.info as { client_id: string }).client_id;
    const refresh = (token: string) =>
      context.request.post(`${API_URL}/api/oauth/token`, {
        form: { grant_type: 'refresh_token', refresh_token: token, client_id: clientId },
      });
    const oldAccess = auth.saved!.access_token;
    const renewed = await refresh(auth.saved!.refresh_token!);
    expect(renewed.status()).toBe(200);
    const next = (await renewed.json()) as { access_token: string; refresh_token: string };
    expect(next.refresh_token).not.toBe(auth.saved!.refresh_token);
    const reused = await refresh(auth.saved!.refresh_token!);
    expect(reused.status()).toBe(400);
    expect(((await reused.json()) as { error: string }).error).toBe('invalid_grant');
    expect(await mcpStatus(context.request, oldAccess)).toBe(401);
    expect(await mcpStatus(context.request, next.access_token)).toBe(200);

    // The connection is listed with its limits, and can be disconnected
    await page.goto('/');
    await page.getByRole('button', { name: 'Connect a coding agent' }).click();
    const dialog = page.getByRole('dialog', { name: 'Connect a coding agent' });
    const row = dialog.getByRole('listitem').filter({ hasText: 'E2E Agent' });
    await expect(row).toContainText('signed in');
    await expect(row.getByTestId('token-limits')).toHaveText('Read only · only “Shop Map”');
    await dialog.getByRole('button', { name: 'Disconnect E2E Agent' }).click();
    await expect(row).toHaveCount(0);
    expect(await mcpStatus(context.request, next.access_token)).toBe(401);
    const afterDisconnect = await refresh(next.refresh_token);
    expect(afterDisconnect.status()).toBe(400);
  });

  test('the dialog gives the sign-in setup, and cancelling tells the agent no', async ({
    page,
    context,
  }) => {
    await registerUser(context, 'Careful Owner');
    await page.goto('/');
    await page.getByRole('button', { name: 'Connect a coding agent' }).click();
    const dialog = page.getByRole('dialog', { name: 'Connect a coding agent' });
    // Nothing secret to paste: the agent signs in when it first connects
    await expect(dialog.getByTestId('sign-in-claude-code')).toHaveText(
      `claude mcp add --transport http mavisdraw ${MCP_URL}`,
    );
    await expect(dialog.getByTestId('sign-in-json')).not.toContainText('Authorization');

    const auth = new AgentAuth();
    await startSignIn(auth);
    const reached = await catchCallback(page);
    await page.goto(auth.authorizationUrl!.toString());
    await page.getByTestId('connect-agent-deny').click();
    await expect.poll(reached).not.toBeNull();
    const back = new URL(reached()!);
    expect(back.searchParams.get('error')).toBe('access_denied');
    expect(back.searchParams.has('code')).toBe(false);

    // An answered sign-in's link is used up
    await page.goto(auth.authorizationUrl!.toString());
    await expect(page.getByTestId('connect-agent')).toContainText('Connect E2E Agent?');
    const requestLink = page.url();
    await page.getByTestId('connect-agent-deny').click();
    await page.waitForURL(`${CALLBACK_ORIGIN}/**`);
    await page.goto(requestLink);
    await expect(page.getByTestId('connect-agent')).toContainText('expired or was already used');
  });

  test('signed out, the person signs in first and lands on the consent page', async ({
    browser,
    context,
  }) => {
    const user = await registerUser(context, 'Returning Owner');
    const fresh = await browser.newContext();
    const page = await fresh.newPage();
    const auth = new AgentAuth();
    const transport = await startSignIn(auth);
    const reached = await catchCallback(page);

    await page.goto(auth.authorizationUrl!.toString());
    await page.getByLabel('Email').fill(user.email);
    await page.getByLabel('Password').fill(user.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByTestId('connect-agent')).toContainText('Connect E2E Agent?');
    await expect(page.getByTestId('connect-agent')).toContainText('Returning Owner');
    await page.getByTestId('connect-agent-approve').click();
    await expect.poll(reached).not.toBeNull();
    await transport.finishAuth(new URL(reached()!).searchParams.get('code')!);

    const agent = await connectSignedIn(auth);
    const { tools } = await agent.listTools();
    expect(tools.map((t) => t.name)).toContain('propose_update');
    await fresh.close();
  });

  test('a code works once, only with its verifier, for the agent it was issued to', async ({
    page,
    context,
  }) => {
    await registerUser(context, 'Code Owner');

    // A wrong verifier fails, and uses the code up
    const first = await manualCode(page, context.request);
    const wrong = await exchange(context.request, { ...first, verifier: 'x'.repeat(43) });
    expect(wrong.status()).toBe(400);
    expect(((await wrong.json()) as { error: string }).error).toBe('invalid_grant');
    expect((await exchange(context.request, first)).status()).toBe(400);

    // Another app can't redeem it
    const second = await manualCode(page, context.request);
    const otherApp = await exchange(context.request, { ...second, clientId: first.clientId });
    expect(otherApp.status()).toBe(400);

    // The right one, once
    const third = await manualCode(page, context.request);
    const ok = await exchange(context.request, third);
    expect(ok.status()).toBe(200);
    expect(ok.headers()['cache-control']).toBe('no-store');
    const tokens = (await ok.json()) as { access_token: string; scope: string };
    expect(tokens.scope).toBe('mcp:read mcp:propose');
    expect(await mcpStatus(context.request, tokens.access_token)).toBe(200);
    expect((await exchange(context.request, third)).status()).toBe(400);

    // Revoking it (RFC 7009) ends the connection
    await context.request.post(`${API_URL}/api/oauth/revoke`, {
      form: { token: tokens.access_token, client_id: third.clientId },
    });
    expect(await mcpStatus(context.request, tokens.access_token)).toBe(401);
  });

  test('agents can discover how to sign in, and bad registrations are refused', async ({
    request,
  }) => {
    const turnedAway = await request.post(MCP_URL, {
      headers: { Accept: 'application/json, text/event-stream' },
      data: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
    });
    expect(turnedAway.status()).toBe(401);
    const challenge = turnedAway.headers()['www-authenticate'];
    const metadataUrl = /resource_metadata="([^"]+)"/.exec(challenge)?.[1];
    expect(metadataUrl).toBe(`${API_URL}/.well-known/oauth-protected-resource/api/mcp`);

    const resource = (await (await request.get(metadataUrl!)).json()) as {
      resource: string;
      authorization_servers: string[];
    };
    expect(resource.resource).toBe(MCP_URL);
    expect(resource.authorization_servers).toEqual([API_URL]);
    const server = (await (
      await request.get(`${API_URL}/.well-known/oauth-authorization-server`)
    ).json()) as Record<string, unknown>;
    expect(server).toMatchObject({
      issuer: API_URL,
      authorization_endpoint: `${API_URL}/api/oauth/authorize`,
      token_endpoint: `${API_URL}/api/oauth/token`,
      registration_endpoint: `${API_URL}/api/oauth/register`,
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
    });

    // Redirects that would run script, or go elsewhere in the clear, can't be registered
    for (const bad of ['javascript:alert(document.domain)', 'http://evil.example/cb']) {
      const res = await request.post(`${API_URL}/api/oauth/register`, {
        data: { client_name: 'Bad', redirect_uris: [bad] },
      });
      expect(res.status()).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe('invalid_redirect_uri');
    }

    // A redirect it didn't register is shown as an error, never followed
    const registered = await request.post(`${API_URL}/api/oauth/register`, {
      data: { client_name: 'Agent', redirect_uris: [CALLBACK] },
    });
    const { client_id: clientId } = (await registered.json()) as { client_id: string };
    const authorize = (params: Record<string, string>) =>
      request.get(`${API_URL}/api/oauth/authorize?${new URLSearchParams(params)}`, {
        maxRedirects: 0,
      });
    const elsewhere = await authorize({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: 'https://evil.example/cb',
      code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
      code_challenge_method: 'S256',
    });
    expect(elsewhere.status()).toBe(400);
    expect(elsewhere.headers()['location']).toBeUndefined();

    // Without PKCE the agent is told why, at its own address
    const noPkce = await authorize({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: CALLBACK,
      state: 's1',
    });
    expect(noPkce.status()).toBe(302);
    const sentBack = new URL(noPkce.headers()['location']);
    expect(sentBack.origin + sentBack.pathname).toBe(CALLBACK);
    expect(sentBack.searchParams.get('error')).toBe('invalid_request');
    expect(sentBack.searchParams.get('state')).toBe('s1');
  });

  test('a read-only token for one map, made in the dialog', async ({ page, context }) => {
    const user = await registerUser(context, 'Token Owner');
    await apiCreateProject(context.request, user, 'Shop Map');
    await apiCreateProject(context.request, user, 'Secret Map');
    await page.goto('/');
    await page.getByRole('button', { name: 'Connect a coding agent' }).click();
    const dialog = page.getByRole('dialog', { name: 'Connect a coding agent' });
    await dialog.getByLabel('Token name').fill('CI job');
    const scope = dialog.getByTestId('token-scope');
    await scope.getByLabel('Only read maps').check();
    await scope.getByLabel('Only the maps I choose').check();
    await expect(dialog.getByRole('button', { name: 'Create token' })).toBeDisabled();
    await scope.getByLabel('Shop Map').check();
    await dialog.getByRole('button', { name: 'Create token' }).click();
    const token = (await dialog.getByTestId('new-token').textContent())!.trim();
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(
      dialog.getByRole('listitem').filter({ hasText: 'CI job' }).getByTestId('token-limits'),
    ).toHaveText('Read only · only “Shop Map”');

    const agent = new Client({ name: 'ci', version: '1.0.0' });
    await agent.connect(
      new StreamableHTTPClientTransport(new URL(MCP_URL), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    const { tools } = await agent.listTools();
    expect(tools.map((t) => t.name)).not.toContain('propose_update');
    const listed = await callTool(agent, 'list_projects');
    expect(listed.text).toContain('Shop Map');
    expect(listed.text).not.toContain('Secret Map');
  });
});
