/**
 * Browser error reporting. With VITE_SENTRY_DSN set, Sentry is loaded after
 * startup (it's not in the main bundle) and catches uncaught errors and
 * crashes of the React tree; without it, errors only go to the console.
 */
type SentryModule = typeof import('@sentry/react');

let sentry: SentryModule | null = null;
const early: unknown[] = [];

export function initErrorReporting(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return;
  void import('@sentry/react').then((S) => {
    S.init({
      dsn,
      environment: import.meta.env.MODE,
      release: import.meta.env.VITE_RELEASE as string | undefined,
      sendDefaultPii: false,
    });
    sentry = S;
    // Anything that broke before the SDK arrived
    for (const err of early.splice(0)) S.captureException(err);
  });
}

/** Report an error; returns the report id when one was sent. */
export function reportError(error: unknown, context?: Record<string, unknown>): string | undefined {
  if (!import.meta.env.VITE_SENTRY_DSN) return undefined;
  if (!sentry) {
    early.push(error);
    return undefined;
  }
  return sentry.captureException(error, context ? { extra: context } : undefined);
}
