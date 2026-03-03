import type { FastifyRequest, FastifyReply } from 'fastify';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

const WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS = 100;
const AUTH_MAX_REQUESTS = 10;

function getClientId(request: FastifyRequest): string {
  return request.ip ?? 'unknown';
}

function cleanupExpired(): void {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) {
      store.delete(key);
    }
  }
}

export function createRateLimiter(maxRequests: number = MAX_REQUESTS, windowMs: number = WINDOW_MS) {
  // Periodically clean up expired entries
  setInterval(cleanupExpired, windowMs * 2);

  return async function rateLimit(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const clientId = getClientId(request);
    const now = Date.now();

    const entry = store.get(clientId);
    if (!entry || entry.resetAt <= now) {
      store.set(clientId, { count: 1, resetAt: now + windowMs });
      return;
    }

    entry.count++;
    if (entry.count > maxRequests) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      reply
        .code(429)
        .header('Retry-After', retryAfter.toString())
        .send({ error: 'Too many requests, please try again later' });
    }
  };
}

export const generalRateLimit = createRateLimiter(MAX_REQUESTS, WINDOW_MS);
export const authRateLimit = createRateLimiter(AUTH_MAX_REQUESTS, WINDOW_MS);
