import type { FastifyRequest, FastifyReply } from 'fastify';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

const WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS = 100;
const AUTH_MAX_REQUESTS = parseInt(process.env.AUTH_RATE_LIMIT_MAX ?? '30', 10);

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

/**
 * `scope` gives a limiter its own counters, so (for example) a coding
 * agent's MCP calls never count against sign-in attempts from the same IP.
 */
export function createRateLimiter(
  maxRequests: number = MAX_REQUESTS,
  windowMs: number = WINDOW_MS,
  scope = '',
) {
  // Periodically clean up expired entries
  setInterval(cleanupExpired, windowMs * 2);

  return async function rateLimit(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const clientId = scope ? `${scope}:${getClientId(request)}` : getClientId(request);
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
/** Coding agents over MCP: a few calls per task, in bursts. */
export const mcpRateLimit = createRateLimiter(120, WINDOW_MS, 'mcp');
/** Public embeds: viewers drilling around, and image proxies fetching README SVGs. */
export const embedRateLimit = createRateLimiter(600, WINDOW_MS, 'embed');
