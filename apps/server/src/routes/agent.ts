import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { streamAgentChat } from '../services/agentService.js';
import type { ModelMessage } from 'ai';

const chatBodySchema = z.object({
  messages: z.array(z.record(z.unknown())),
  diagramMarkdown: z.string(),
});

export async function agentRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/agent/chat', { preHandler: [requireAuth] }, async (request, reply) => {
    const parsed = chatBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed', details: parsed.error.issues });
    }

    const userId = request.user!.userId;
    const { messages, diagramMarkdown } = parsed.data;

    const result = streamAgentChat(messages as ModelMessage[], userId, diagramMarkdown);

    // Use Vercel AI SDK UI message stream protocol
    const response = result.toUIMessageStreamResponse();

    // Forward headers from the SDK response
    const headers: Record<string, string> = {};
    response.headers.forEach((value: string, key: string) => {
      headers[key] = value;
    });

    reply.raw.writeHead(200, headers);

    // Pipe the ReadableStream to the raw response
    const reader = response.body!.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        reply.raw.write(value);
      }
    } finally {
      reply.raw.end();
    }
  });
}
