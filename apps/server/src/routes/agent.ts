import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { convertToModelMessages, type UIMessage } from 'ai';
import { requireAuth } from '../middleware/auth.js';
import { isAgentConfigured, streamAgentChat } from '../services/agentService.js';

/** Bounds on what a client can send per turn (cost and abuse control). */
const MAX_MESSAGES = 60;
const MAX_DIAGRAM_CHARS = 200_000;

const chatBodySchema = z.object({
  messages: z
    .array(
      z
        .object({
          id: z.string().optional(),
          role: z.enum(['user', 'assistant', 'system']),
          parts: z.array(z.record(z.unknown())),
        })
        .passthrough(),
    )
    .min(1)
    .max(MAX_MESSAGES),
  diagramMarkdown: z.string().max(MAX_DIAGRAM_CHARS).default(''),
});

// Per-user sliding window: AI turns are the expensive endpoint
const AGENT_TURNS_PER_MINUTE = parseInt(process.env.AGENT_RATE_LIMIT ?? '12', 10);
const recentTurns = new Map<string, number[]>();

function allowTurn(userId: string): boolean {
  const now = Date.now();
  const window = (recentTurns.get(userId) ?? []).filter((t) => now - t < 60_000);
  if (window.length >= AGENT_TURNS_PER_MINUTE) {
    recentTurns.set(userId, window);
    return false;
  }
  window.push(now);
  recentTurns.set(userId, window);
  return true;
}

function allowedOrigin(origin: string | undefined): string | null {
  const configured = process.env.CORS_ORIGIN ?? 'http://localhost:3000';
  return origin && origin === configured ? origin : null;
}

export async function agentRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/agent/chat',
    { preHandler: [requireAuth], bodyLimit: MAX_DIAGRAM_CHARS * 4 },
    async (request, reply) => {
      const parsed = chatBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Validation failed', details: parsed.error.issues });
      }
      if (!isAgentConfigured()) {
        return reply.code(503).send({ error: 'AI is not configured on this server' });
      }

      const userId = request.user!.userId;
      if (!allowTurn(userId)) {
        return reply
          .code(429)
          .header('Retry-After', '60')
          .send({ error: 'Too many AI requests; try again in a minute' });
      }

      // Only the user and assistant speak; the server owns the system prompt
      const uiMessages = parsed.data.messages.filter((m) => m.role !== 'system') as unknown as UIMessage[];
      let modelMessages;
      try {
        modelMessages = await convertToModelMessages(uiMessages);
      } catch (err) {
        request.log.warn({ err }, 'Rejected malformed chat messages');
        return reply.code(400).send({ error: 'Malformed chat messages' });
      }

      // Stop generating (and paying) when the user closes the panel or tab
      const abort = new AbortController();
      request.raw.on('close', () => abort.abort());

      const result = await streamAgentChat(
        modelMessages,
        userId,
        parsed.data.diagramMarkdown,
        abort.signal,
      );
      const response = result.toUIMessageStreamResponse({
        onError: (err) => {
          request.log.error({ err }, 'Agent stream error');
          return 'The AI request failed. Please try again.';
        },
      });

      // We write the raw stream ourselves, so the CORS plugin's headers must be
      // set here too or the browser drops the response.
      reply.hijack();
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });
      const origin = allowedOrigin(request.headers.origin);
      if (origin) {
        headers['access-control-allow-origin'] = origin;
        headers['access-control-allow-credentials'] = 'true';
        headers['vary'] = 'Origin';
      }
      reply.raw.writeHead(response.status, headers);

      const reader = response.body!.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          reply.raw.write(value);
        }
      } catch (err) {
        if (!abort.signal.aborted) request.log.error({ err }, 'Error streaming agent response');
      } finally {
        reply.raw.end();
      }
    },
  );
}
