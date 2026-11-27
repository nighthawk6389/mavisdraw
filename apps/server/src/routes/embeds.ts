import { createHash, randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { MavisElement } from '@mavisdraw/types';
import { renderSvgMarkup } from '@mavisdraw/export/svg-markup';
import { requireAuth } from '../middleware/auth.js';
import { embedRateLimit } from '../middleware/rateLimit.js';
import { checkProjectAccess, getDiagram, getDiagramSummaries } from '../services/diagramService.js';
import { getEmbed, publishEmbed, resolveEmbed, unpublishEmbed } from '../services/embedService.js';
import { documentNameFor } from '../ws/hocuspocus.js';
import { readLiveElements } from '../ws/ydocElements.js';

const publishSchema = z.object({ rotate: z.boolean().optional() });
const svgQuerySchema = z.object({
  d: z.string().max(64).optional(),
  theme: z.enum(['light', 'dark']).optional(),
  style: z.enum(['clean', 'sketchy']).optional(),
});

/** README images: the drawing scales down past this, the viewBox keeps every detail. */
const SVG_MAX_WIDTH = 1600;
/** Hand-drawn rendering is costly per shape: past this, big maps are drawn clean. */
export const SKETCHY_MAX_ELEMENTS = 1500;
/** Rendered SVGs kept in memory (README images are fetched over and over). */
const SVG_CACHE_BYTES = 32 * 1024 * 1024;
/** A new server may draw differently: its ETags never match an old one's. */
const RENDERER_ID = randomUUID();

const sha1 = (value: string | Uint8Array) => createHash('sha1').update(value).digest('base64url');

/**
 * An SVG is a document: if someone opens the URL directly, nothing in it
 * may run or load (it's served from the API's origin).
 */
function svgHeaders(reply: FastifyReply, etag: string): FastifyReply {
  return reply
    .header('Content-Type', 'image/svg+xml; charset=utf-8')
    .header(
      'Content-Security-Policy',
      "default-src 'none'; img-src data:; style-src 'unsafe-inline'",
    )
    .header('X-Content-Type-Options', 'nosniff')
    .header('Cache-Control', 'public, max-age=300')
    .header('ETag', etag);
}

export async function embedRoutes(app: FastifyInstance): Promise<void> {
  /** Owners and admins publish, like they share. */
  const canPublish = async (projectId: string, userId: string) => {
    const access = await checkProjectAccess(projectId, userId);
    return access === 'owner' || access === 'admin';
  };

  // ── Managing the embed ────────────────────────────────────

  app.get('/api/projects/:id/embed', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await canPublish(id, request.user!.userId))) {
      return reply.code(403).send({ error: 'Only owners and admins can publish embeds' });
    }
    return reply.send({ embed: await getEmbed(id) });
  });

  app.post('/api/projects/:id/embed', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = publishSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid request' });
    if (!(await canPublish(id, request.user!.userId))) {
      return reply.code(403).send({ error: 'Only owners and admins can publish embeds' });
    }
    const embed = await publishEmbed(id, request.user!.userId, parsed.data.rotate ?? false);
    return reply.code(201).send({ embed });
  });

  app.delete('/api/projects/:id/embed', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await canPublish(id, request.user!.userId))) {
      return reply.code(403).send({ error: 'Only owners and admins can publish embeds' });
    }
    await unpublishEmbed(id);
    return reply.code(204).send();
  });

  // ── Public, read-only (the token is the key) ──────────────

  /** A diagram of the embedded project as it is right now (live room first). */
  const embeddedDiagram = async (token: string, diagramId: string | undefined) => {
    const project = await resolveEmbed(token);
    if (!project) return null;
    const id = diagramId || project.rootDiagramId;
    if (!id) return null;
    const diagram = await getDiagram(id);
    if (!diagram || diagram.projectId !== project.id) return null;
    const live = app.hocuspocus.documents.get(documentNameFor(diagram.id));
    return {
      project,
      diagram,
      /** Changes whenever what would be drawn does (cheap: nothing is read or drawn). */
      version: `${diagram.updatedAt.toISOString()}:${live ? sha1(Y.encodeStateVector(live)) : ''}`,
      elements: () =>
        ((live ? readLiveElements(live) : diagram.elements) as MavisElement[]).filter(
          (el) => !el.isDeleted,
        ),
    };
  };

  // Rendered SVGs by what they show, oldest evicted first
  const svgCache = new Map<string, string>();
  let svgCacheBytes = 0;
  const remember = (key: string, svg: string) => {
    svgCache.set(key, svg);
    svgCacheBytes += svg.length;
    for (const [oldKey, old] of svgCache) {
      if (svgCacheBytes <= SVG_CACHE_BYTES || oldKey === key) break;
      svgCache.delete(oldKey);
      svgCacheBytes -= old.length;
    }
  };

  const gone = (reply: FastifyReply) =>
    reply.code(404).send({ error: 'This embed is no longer available' });

  app.get('/api/embed/:token', { preHandler: [embedRateLimit] }, async (request, reply) => {
    const { token } = request.params as { token: string };
    const project = await resolveEmbed(token);
    if (!project) return gone(reply);
    const diagrams = await getDiagramSummaries(project.id);
    return reply.header('Cache-Control', 'no-cache').send({
      project: { id: project.id, name: project.name },
      rootDiagramId: project.rootDiagramId,
      diagrams: diagrams.map((d) => ({
        id: d.id,
        title: d.title,
        parentDiagramId: d.parentDiagramId,
      })),
    });
  });

  app.get(
    '/api/embed/:token/diagrams/:diagramId',
    { preHandler: [embedRateLimit] },
    async (request, reply) => {
      const { token, diagramId } = request.params as { token: string; diagramId: string };
      const found = await embeddedDiagram(token, diagramId);
      if (!found) return gone(reply);
      return reply.header('Cache-Control', 'no-cache').send({
        diagram: {
          id: found.diagram.id,
          title: found.diagram.title,
          renderMode: found.diagram.renderMode,
          viewBackgroundColor: found.diagram.viewBackgroundColor,
          elements: found.elements(),
        },
      });
    },
  );

  app.get('/api/embed/:token/svg', { preHandler: [embedRateLimit] }, async (request, reply) => {
    const { token } = request.params as { token: string };
    const query = svgQuerySchema.safeParse(request.query ?? {});
    if (!query.success) return reply.code(400).send({ error: 'Invalid options' });
    const found = await embeddedDiagram(token, query.data.d);
    if (!found) return gone(reply);
    const theme = query.data.theme ?? 'light';
    const style =
      query.data.style ?? (found.diagram.renderMode === 'sketchy' ? 'sketchy' : 'clean');
    // Known before drawing anything, so revalidations (GitHub's image proxy,
    // CDNs) and repeat fetches cost no rendering
    const key = [RENDERER_ID, found.diagram.id, found.version, theme, style].join('|');
    const etag = `"${sha1(key)}"`;
    if (request.headers['if-none-match'] === etag) return svgHeaders(reply, etag).code(304).send();
    let svg = svgCache.get(key);
    if (svg === undefined) {
      const elements = found.elements();
      svg = renderSvgMarkup(elements, {
        theme,
        renderMode:
          style === 'sketchy' && elements.length <= SKETCHY_MAX_ELEMENTS ? style : 'clean',
        backgroundColor: found.diagram.viewBackgroundColor,
        maxWidth: SVG_MAX_WIDTH,
      });
      remember(key, svg);
    }
    return svgHeaders(reply, etag).send(svg);
  });
}
