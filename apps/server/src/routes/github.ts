import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isManifest, isRelevantPath } from '@mavisdraw/compat/repo';
import { requireAuth } from '../middleware/auth.js';
import {
  getAuthorizeUrl,
  exchangeCodeForToken,
  getGitHubUser,
  listRepos,
  getRepoBranches,
  getRepoTree,
  getFileContent,
  saveConnection,
  getConnectionsForUser,
  getDecryptedToken,
  deleteConnection,
  GitHubError,
  getRepoSnapshot,
  verifyOAuthState,
} from '../services/githubService.js';
import { config } from '../config.js';

const REDIRECT_URI = config.github.redirectUri;

const repoParamsSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
});

const treeQuerySchema = z.object({
  path: z.string().optional().default(''),
  ref: z.string().optional().default('HEAD'),
  connectionId: z.string().min(1),
});

const contentsQuerySchema = z.object({
  path: z.string().min(1),
  ref: z.string().optional().default('HEAD'),
  connectionId: z.string().min(1),
});

export async function githubRoutes(app: FastifyInstance): Promise<void> {
  // ── Get OAuth authorize URL ─────────────────────────────
  app.get('/api/github/authorize', { preHandler: [requireAuth] }, async (request, reply) => {
    const { enterpriseUrl } = request.query as { enterpriseUrl?: string };
    try {
      const url = getAuthorizeUrl(REDIRECT_URI, request.user!.userId, enterpriseUrl);
      return reply.send({ url });
    } catch (err) {
      if (err instanceof GitHubError) {
        request.log.warn({ err }, 'GitHub API error');
        return reply.code(err.statusCode).send({ error: err.message });
      }
      request.log.error({ err }, 'Unexpected error in GitHub route');
      throw err;
    }
  });

  // ── OAuth callback ──────────────────────────────────────
  app.post('/api/github/callback', { preHandler: [requireAuth] }, async (request, reply) => {
    const schema = z.object({
      code: z.string().min(1),
      // Signed by /authorize: proves this user started the flow, and for which host
      state: z.string().min(1),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed', details: parsed.error.issues });
    }

    const userId = request.user!.userId;
    const { code, state } = parsed.data;

    try {
      // The host comes from the signed state, never from the request body
      const { enterpriseUrl } = verifyOAuthState(state, userId);
      const { accessToken, scope } = await exchangeCodeForToken(
        code,
        REDIRECT_URI,
        enterpriseUrl,
      );
      const githubUser = await getGitHubUser(accessToken, enterpriseUrl);
      const connection = await saveConnection(userId, accessToken, scope, githubUser, enterpriseUrl);

      return reply.code(200).send({ connection });
    } catch (err) {
      if (err instanceof GitHubError) {
        request.log.warn({ err }, 'GitHub API error');
        return reply.code(err.statusCode).send({ error: err.message });
      }
      request.log.error({ err }, 'Unexpected error in GitHub route');
      throw err;
    }
  });

  // ── Get connection status ───────────────────────────────
  app.get('/api/github/status', { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = request.user!.userId;
    const connections = await getConnectionsForUser(userId);
    return reply.send({ connections });
  });

  // ── List repos ──────────────────────────────────────────
  app.get('/api/github/repos', { preHandler: [requireAuth] }, async (request, reply) => {
    const { connectionId, page } = request.query as {
      connectionId: string;
      page?: string;
    };
    if (!connectionId) {
      return reply.code(400).send({ error: 'connectionId is required' });
    }

    const userId = request.user!.userId;

    try {
      const { accessToken, enterpriseUrl } = await getDecryptedToken(connectionId, userId);
      const repos = await listRepos(accessToken, Number(page) || 1, 30, enterpriseUrl);
      return reply.send({ repos });
    } catch (err) {
      if (err instanceof GitHubError) {
        request.log.warn({ err }, 'GitHub API error');
        return reply.code(err.statusCode).send({ error: err.message });
      }
      request.log.error({ err }, 'Unexpected error in GitHub route');
      throw err;
    }
  });

  // ── List branches ───────────────────────────────────────
  app.get(
    '/api/github/repos/:owner/:repo/branches',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const params = repoParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: 'Invalid params' });
      }

      const { connectionId } = request.query as { connectionId: string };
      if (!connectionId) {
        return reply.code(400).send({ error: 'connectionId is required' });
      }

      const userId = request.user!.userId;

      try {
        const { accessToken, enterpriseUrl } = await getDecryptedToken(connectionId, userId);
        const branches = await getRepoBranches(
          accessToken,
          params.data.owner,
          params.data.repo,
          enterpriseUrl,
        );
        return reply.send({ branches });
      } catch (err) {
        if (err instanceof GitHubError) {
          return reply.code(err.statusCode).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  // ── Repository snapshot (for repo → map and drift checks) ──
  app.get(
    '/api/github/repos/:owner/:repo/snapshot',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const params = repoParamsSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'Invalid params' });
      const { connectionId, ref } = request.query as { connectionId?: string; ref?: string };
      if (!connectionId) return reply.code(400).send({ error: 'connectionId is required' });
      try {
        const { accessToken, enterpriseUrl } = await getDecryptedToken(connectionId, request.user!.userId);
        const snapshot = await getRepoSnapshot(
          accessToken,
          params.data.owner,
          params.data.repo,
          ref || 'HEAD',
          isManifest,
          isRelevantPath,
          enterpriseUrl,
        );
        return reply.send({ snapshot });
      } catch (err) {
        if (err instanceof GitHubError) return reply.code(err.statusCode).send({ error: err.message });
        throw err;
      }
    },
  );

  // ── Browse repo tree ────────────────────────────────────
  app.get(
    '/api/github/repos/:owner/:repo/tree',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const params = repoParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: 'Invalid params' });
      }

      const query = treeQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.code(400).send({ error: 'Invalid query', details: query.error.issues });
      }

      const userId = request.user!.userId;

      try {
        const { accessToken, enterpriseUrl } = await getDecryptedToken(
          query.data.connectionId,
          userId,
        );
        const entries = await getRepoTree(
          accessToken,
          params.data.owner,
          params.data.repo,
          query.data.ref,
          query.data.path,
          enterpriseUrl,
        );
        return reply.send({ entries });
      } catch (err) {
        if (err instanceof GitHubError) {
          return reply.code(err.statusCode).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  // ── Get file content ────────────────────────────────────
  app.get(
    '/api/github/repos/:owner/:repo/contents',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const params = repoParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: 'Invalid params' });
      }

      const query = contentsQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.code(400).send({ error: 'Invalid query', details: query.error.issues });
      }

      const userId = request.user!.userId;

      try {
        const { accessToken, enterpriseUrl } = await getDecryptedToken(
          query.data.connectionId,
          userId,
        );
        const file = await getFileContent(
          accessToken,
          params.data.owner,
          params.data.repo,
          query.data.path,
          query.data.ref,
          enterpriseUrl,
        );
        return reply.send(file);
      } catch (err) {
        if (err instanceof GitHubError) {
          return reply.code(err.statusCode).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  // ── Disconnect ──────────────────────────────────────────
  app.delete(
    '/api/github/connections/:connectionId',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { connectionId } = request.params as { connectionId: string };
      const userId = request.user!.userId;

      try {
        await deleteConnection(connectionId, userId);
        return reply.code(204).send();
      } catch (err) {
        if (err instanceof GitHubError) {
          return reply.code(err.statusCode).send({ error: err.message });
        }
        throw err;
      }
    },
  );
}
