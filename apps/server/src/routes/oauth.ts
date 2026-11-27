import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { requireAuth } from '../middleware/auth.js';
import { oauthRateLimit } from '../middleware/rateLimit.js';
import {
  refreshOAuthTokens,
  revokeByToken,
  MAX_TOKEN_PROJECTS,
} from '../services/apiTokenService.js';
import {
  OAuthError,
  SCOPES,
  accessForScope,
  approveRequest,
  denyRequest,
  describeRedirect,
  exchangeCode,
  getClient,
  pendingRequest,
  redirectMatches,
  redirectWith,
  registerClient,
  scopeForAccess,
  startRequest,
} from '../services/oauthService.js';
import { listAccessibleProjects } from '../services/projectService.js';

/** This server as the agent reached it (behind a proxy: the address the proxy was asked for). */
const originOf = (request: FastifyRequest) => `${request.protocol}://${request.host}`;

/** The MCP endpoint: the "resource" tokens are for. */
export const mcpResourceUrl = (request: FastifyRequest) => `${originOf(request)}/api/mcp`;

/** RFC 9728: where an agent turned away from /api/mcp learns how to sign in. */
export const resourceMetadataUrl = (request: FastifyRequest) =>
  `${originOf(request)}/.well-known/oauth-protected-resource/api/mcp`;

const sameResource = (a: string, b: string) => a.replace(/\/+$/, '') === b.replace(/\/+$/, '');

const field = (body: unknown, key: string): string | undefined => {
  const value = (body as Record<string, unknown> | null)?.[key];
  return typeof value === 'string' ? value : undefined;
};

/** Before there's a trustworthy redirect address, errors are shown, not sent anywhere. */
const errorPage = (reply: FastifyReply, message: string) =>
  reply
    .code(400)
    .type('text/plain; charset=utf-8')
    .send(`MavisDraw couldn't start connecting this agent: ${message}`);

const oauthFailure = (reply: FastifyReply, err: OAuthError) =>
  reply.code(err.status).send({ error: err.code, error_description: err.message });

const grantSchema = z.object({
  access: z.enum(['read', 'propose']),
  projectIds: z.array(z.string().min(1).max(64)).min(1).max(MAX_TOKEN_PROJECTS).nullable(),
});

/**
 * Signing coding agents in through the browser (OAuth 2.1 with PKCE and
 * dynamic client registration, as the MCP spec has clients expect).
 */
export async function oauthRoutes(app: FastifyInstance): Promise<void> {
  // Token and registration requests are form-encoded (RFC 6749); only here
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string', bodyLimit: 16 * 1024 },
    (_request, body, done) => {
      done(null, Object.fromEntries(new URLSearchParams(body as string)));
    },
  );

  const protectedResource = async (request: FastifyRequest, reply: FastifyReply) =>
    reply.header('Cache-Control', 'public, max-age=3600').send({
      resource: mcpResourceUrl(request),
      authorization_servers: [originOf(request)],
      scopes_supported: SCOPES,
      bearer_methods_supported: ['header'],
      resource_name: 'MavisDraw',
      resource_documentation: `${config.appUrl}`,
    });
  app.get('/.well-known/oauth-protected-resource', protectedResource);
  app.get('/.well-known/oauth-protected-resource/api/mcp', protectedResource);

  app.get('/.well-known/oauth-authorization-server', async (request, reply) => {
    const origin = originOf(request);
    return reply.header('Cache-Control', 'public, max-age=3600').send({
      issuer: origin,
      authorization_endpoint: `${origin}/api/oauth/authorize`,
      token_endpoint: `${origin}/api/oauth/token`,
      registration_endpoint: `${origin}/api/oauth/register`,
      revocation_endpoint: `${origin}/api/oauth/revoke`,
      response_types_supported: ['code'],
      response_modes_supported: ['query'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      revocation_endpoint_auth_methods_supported: ['none'],
      scopes_supported: SCOPES,
    });
  });

  app.post('/api/oauth/register', { preHandler: [oauthRateLimit] }, async (request, reply) => {
    try {
      const client = await registerClient({
        name: field(request.body, 'client_name'),
        redirectUris: (request.body as Record<string, unknown> | null)?.redirect_uris,
      });
      return reply.code(201).send({
        client_id: client.id,
        client_name: client.name,
        redirect_uris: client.redirectUris,
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        // Agents run on people's machines: no secret to keep
        token_endpoint_auth_method: 'none',
        client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
      });
    } catch (err) {
      if (err instanceof OAuthError) {
        return reply.code(400).send({ error: err.code, error_description: err.message });
      }
      throw err;
    }
  });

  app.get('/api/oauth/authorize', { preHandler: [oauthRateLimit] }, async (request, reply) => {
    const q = request.query as Record<string, string | undefined>;
    const client = q.client_id ? await getClient(q.client_id) : null;
    if (!client)
      return errorPage(reply, 'unknown client_id. Start connecting again from the agent.');
    const redirectUri =
      q.redirect_uri ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : undefined);
    if (!redirectUri || !redirectMatches(client.redirectUris, redirectUri)) {
      return errorPage(reply, 'redirect_uri is not one this agent registered.');
    }
    const state = q.state ?? null;
    const fail = (error: string, description: string) =>
      reply.redirect(redirectWith(redirectUri, { error, error_description: description, state }));
    if (q.response_type !== 'code') {
      return fail('unsupported_response_type', 'Only response_type=code is supported');
    }
    if (q.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(q.code_challenge ?? '')) {
      return fail('invalid_request', 'PKCE is required: send an S256 code_challenge');
    }
    if (state && state.length > 1000) return fail('invalid_request', 'state is too long');
    if (q.resource && !sameResource(q.resource, mcpResourceUrl(request))) {
      return fail(
        'invalid_target',
        `This server only issues tokens for ${mcpResourceUrl(request)}`,
      );
    }
    const id = await startRequest({
      client,
      redirectUri,
      codeChallenge: q.code_challenge!,
      state,
      access: accessForScope(q.scope),
    });
    // The person approves in the web app, where they're signed in
    return reply.redirect(`${config.appUrl}/connect-agent?request=${encodeURIComponent(id)}`);
  });

  const gone = (reply: FastifyReply) =>
    reply.code(404).send({
      error:
        'This sign-in link has expired or was already used. Start connecting again from your agent.',
    });

  app.get('/api/oauth/requests/:id', { preHandler: [requireAuth] }, async (request, reply) => {
    const pending = await pendingRequest((request.params as { id: string }).id);
    if (!pending) return gone(reply);
    const projects = await listAccessibleProjects(request.user!.userId);
    return reply.send({
      client: { name: pending.client.name },
      redirect: describeRedirect(pending.redirectUri),
      requestedAccess: pending.requestedAccess,
      projects: projects.map((p) => ({ id: p.id, name: p.name, role: p.role })),
    });
  });

  app.post(
    '/api/oauth/requests/:id/approve',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = grantSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Choose what the agent may do' });
      const pending = await pendingRequest(id);
      if (!pending) return gone(reply);
      const userId = request.user!.userId;
      let projectIds = parsed.data.projectIds;
      if (projectIds) {
        const mine = new Set((await listAccessibleProjects(userId)).map((p) => p.id));
        projectIds = [...new Set(projectIds)];
        if (projectIds.some((p) => !mine.has(p))) {
          return reply.code(400).send({ error: "Some of those projects aren't yours to share" });
        }
      }
      // Never more than the agent asked for
      const access = pending.requestedAccess === 'read' ? 'read' : parsed.data.access;
      const redirectTo = await approveRequest(id, userId, { access, projectIds });
      if (!redirectTo) return gone(reply);
      return reply.send({ redirectTo });
    },
  );

  app.post(
    '/api/oauth/requests/:id/deny',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const redirectTo = await denyRequest((request.params as { id: string }).id);
      if (!redirectTo) return gone(reply);
      return reply.send({ redirectTo });
    },
  );

  app.post('/api/oauth/token', { preHandler: [oauthRateLimit] }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store').header('Pragma', 'no-cache');
    const body = request.body;
    const clientId = field(body, 'client_id');
    try {
      if (!clientId) throw new OAuthError('invalid_client', 'client_id is required', 401);
      const grantType = field(body, 'grant_type');
      let issued;
      if (grantType === 'authorization_code') {
        const code = field(body, 'code');
        const redirectUri = field(body, 'redirect_uri');
        const codeVerifier = field(body, 'code_verifier');
        if (!code || !redirectUri || !codeVerifier) {
          throw new OAuthError(
            'invalid_request',
            'code, redirect_uri and code_verifier are required',
          );
        }
        issued = await exchangeCode({ code, clientId, redirectUri, codeVerifier });
      } else if (grantType === 'refresh_token') {
        const refreshToken = field(body, 'refresh_token');
        if (!refreshToken) throw new OAuthError('invalid_request', 'refresh_token is required');
        issued = await refreshOAuthTokens(refreshToken, clientId);
        if (!issued) {
          throw new OAuthError(
            'invalid_grant',
            'This sign-in has ended (revoked, expired or already refreshed). Sign in again.',
          );
        }
      } else {
        throw new OAuthError('unsupported_grant_type', 'Use authorization_code or refresh_token');
      }
      return reply.send({
        access_token: issued.accessToken,
        token_type: 'Bearer',
        expires_in: issued.expiresIn,
        refresh_token: issued.refreshToken,
        scope: scopeForAccess(issued.access),
      });
    } catch (err) {
      if (err instanceof OAuthError) return oauthFailure(reply, err);
      throw err;
    }
  });

  app.post('/api/oauth/revoke', { preHandler: [oauthRateLimit] }, async (request, reply) => {
    const token = field(request.body, 'token');
    if (token && token.length <= 200) await revokeByToken(token);
    // RFC 7009: the same answer whether or not the token was known
    return reply.code(200).send({});
  });
}
