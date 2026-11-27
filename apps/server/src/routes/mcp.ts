import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { projects } from '../db/schema.js';
import { authenticateToken } from '../services/apiTokenService.js';
import { buildMcpServer, type McpDeps } from '../services/mcpServer.js';
import { listAccessibleProjects, loadProjectScene } from '../services/projectService.js';
import { createProposal } from '../services/proposalService.js';
import { getDiagramsByProject } from '../services/diagramService.js';
import { signalDocument } from '../ws/hocuspocus.js';
import { mcpRateLimit } from '../middleware/rateLimit.js';
import type { RepoSource } from '../db/schema.js';

const repoOf = (source: RepoSource | null) =>
  source?.kind === 'github' && source.owner && source.repo
    ? `${source.owner}/${source.repo}`
    : null;

/**
 * MCP over Streamable HTTP, stateless: every POST carries the access token
 * and is served by a fresh server (revoking a token takes effect at once,
 * and any instance can answer).
 */
export async function mcpRoutes(app: FastifyInstance): Promise<void> {
  const deps: McpDeps = {
    appUrl: config.appUrl,
    async listProjects(userId) {
      const list = await listAccessibleProjects(userId);
      return list.map((p) => ({
        id: p.id,
        name: p.name,
        role: p.role,
        repo: repoOf(p.repoSource),
      }));
    },
    async loadScene(projectId) {
      const project = await db.query.projects.findFirst({
        where: eq(projects.id, projectId),
        columns: { id: true, rootDiagramId: true },
      });
      if (!project) throw new Error(`Project ${projectId} vanished`);
      return loadProjectScene(project, app.hocuspocus.documents);
    },
    async createProposal({ projectId, diagramId, authorId, sourceLabel, proposal }) {
      const created = await createProposal({
        projectId,
        diagramId,
        authorId,
        source: 'agent',
        sourceLabel,
        description: proposal.description,
        changes: proposal.changes,
        connections: proposal.connections,
      });
      // Open editors show it right away
      for (const d of await getDiagramsByProject(projectId)) {
        signalDocument(app.hocuspocus, d.id, 'proposals');
      }
      return created;
    },
  };

  app.post('/api/mcp', { preHandler: [mcpRateLimit] }, async (request, reply) => {
    const identity = await authenticateToken(request.headers.authorization);
    if (!identity) {
      return reply
        .code(401)
        .header('WWW-Authenticate', 'Bearer realm="MavisDraw"')
        .send({
          jsonrpc: '2.0',
          error: {
            code: -32001,
            message:
              'A valid MavisDraw access token is required (Authorization: Bearer mdw_…). Create one in MavisDraw under "Connect a coding agent".',
          },
          id: null,
        });
    }

    const server = buildMcpServer({ userId: identity.userId, tokenName: identity.tokenName }, deps);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    // The SDK writes the response itself
    reply.hijack();
    reply.raw.setHeader('x-request-id', request.id);
    reply.raw.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(request.raw, reply.raw, request.body);
    } catch (err) {
      request.log.error({ err }, 'MCP request failed');
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { 'content-type': 'application/json' });
        reply.raw.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal error', data: { requestId: request.id } },
            id: null,
          }),
        );
      }
    }
  });

  // Stateless: no server-initiated stream to open, and no session to end
  const notAllowed = async (_request: FastifyRequest, reply: FastifyReply) =>
    reply
      .code(405)
      .header('Allow', 'POST')
      .send({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });
  app.get('/api/mcp', notAllowed);
  app.delete('/api/mcp', notAllowed);
}
