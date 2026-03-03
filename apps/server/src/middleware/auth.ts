import type { FastifyRequest, FastifyReply } from 'fastify';
import { verifyAccessToken, type TokenPayload } from '../services/authService.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: TokenPayload;
  }
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    reply.code(401).send({ error: 'Missing or invalid authorization header' });
    return;
  }

  const token = authHeader.slice(7);
  try {
    request.user = verifyAccessToken(token);
  } catch {
    reply.code(401).send({ error: 'Invalid or expired access token' });
  }
}

export async function optionalAuth(request: FastifyRequest): Promise<void> {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return;
  }

  const token = authHeader.slice(7);
  try {
    request.user = verifyAccessToken(token);
  } catch {
    // Silently ignore invalid tokens for optional auth
  }
}
