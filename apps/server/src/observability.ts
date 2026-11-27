import * as Sentry from '@sentry/node';

/**
 * Error reporting and the shapes of error responses.
 *
 * Sentry is optional: with SENTRY_DSN set, server errors (5xx) are reported
 * with the request id and user id (never request bodies, headers or other
 * personal data); without it, they're only logged.
 */

let enabled = false;

export function initErrorReporting(env: Record<string, string | undefined> = process.env): boolean {
  if (!env.SENTRY_DSN) return false;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment:
      env.SENTRY_ENVIRONMENT ?? (env.NODE_ENV === 'production' ? 'production' : 'development'),
    release: env.SENTRY_RELEASE ?? env.RENDER_GIT_COMMIT ?? env.GIT_SHA,
    tracesSampleRate: Number(env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
    sendDefaultPii: false,
  });
  enabled = true;
  return true;
}

export interface ErrorContext {
  requestId?: string;
  userId?: string;
  route?: string;
  method?: string;
}

export function reportError(error: unknown, context: ErrorContext = {}): void {
  if (!enabled) return;
  Sentry.withScope((scope) => {
    if (context.requestId) scope.setTag('request_id', context.requestId);
    if (context.route) scope.setTag('route', context.route);
    if (context.method) scope.setTag('method', context.method);
    if (context.userId) scope.setUser({ id: context.userId });
    Sentry.captureException(error);
  });
}

/** Wait for queued reports (graceful shutdown). */
export async function flushErrorReporting(timeoutMs = 2000): Promise<void> {
  if (enabled) await Sentry.flush(timeoutMs);
}

/**
 * What the client is told about an error. Client errors (4xx) keep their
 * message — it's about their request. Server errors (5xx) never echo the
 * internal message (it can leak SQL, paths or library details); they carry
 * the request id instead, which is in the logs and in Sentry.
 */
export function errorResponse(
  error: { statusCode?: number; message?: string },
  requestId: string,
): { status: number; body: { error: string; requestId: string } } {
  const code = error.statusCode;
  const status = typeof code === 'number' && code >= 400 && code < 600 ? code : 500;
  if (status >= 500) {
    return {
      status,
      body: { error: 'Something went wrong on our side. Please try again.', requestId },
    };
  }
  return { status, body: { error: error.message || 'Request failed', requestId } };
}

/** A request id we're willing to echo back (from a proxy or client), or null. */
export function acceptRequestId(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  return value && /^[\w.-]{1,64}$/.test(value) ? value : null;
}

/** Readiness: can this instance serve requests (is the database reachable)? */
export async function checkReadiness(
  pingDatabase: () => Promise<unknown>,
  timeoutMs = 2000,
): Promise<{ ready: boolean; checks: { database: 'ok' | 'unavailable' } }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      pingDatabase(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
      }),
    ]);
    return { ready: true, checks: { database: 'ok' } };
  } catch {
    return { ready: false, checks: { database: 'unavailable' } };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
