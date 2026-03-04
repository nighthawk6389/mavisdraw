/**
 * Integration test helpers — HTTP client for the running Docker API.
 */

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

interface RequestOptions {
  method?: string;
  body?: unknown;
  accessToken?: string;
  cookie?: string;
}

interface ApiResponse<T = unknown> {
  status: number;
  data: T;
  headers: Headers;
}

export async function api<T = unknown>(
  path: string,
  opts: RequestOptions = {},
): Promise<ApiResponse<T>> {
  const { method = 'GET', body, accessToken, cookie } = opts;
  const headers: Record<string, string> = {};

  // Only set Content-Type when there's actually a body — Fastify rejects
  // `Content-Type: application/json` with an empty body.
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }
  if (cookie) {
    headers['Cookie'] = cookie;
  }

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });

  const data = (await res.json().catch(() => null)) as T;
  return { status: res.status, data, headers: res.headers };
}

/**
 * Extract the refreshToken cookie value from a set-cookie header.
 * Returns a Cookie header string suitable for forwarding.
 */
export function extractRefreshCookie(setCookieHeader: string): string {
  // set-cookie: refreshToken=<value>; Path=...; ...
  // We need to send back: refreshToken=<value>
  const match = setCookieHeader.match(/refreshToken=([^;]+)/);
  return match ? `refreshToken=${match[1]}` : '';
}

/** Register a new user and return tokens + user info. */
export async function registerUser(email: string, password: string, name: string) {
  const res = await api<{
    user: { id: string; email: string; name: string };
    accessToken: string;
  }>('/api/auth/register', {
    method: 'POST',
    body: { email, password, name },
  });
  const setCookie = res.headers.get('set-cookie') ?? '';
  return { ...res, refreshCookie: extractRefreshCookie(setCookie) };
}

/** Login and return tokens. */
export async function loginUser(email: string, password: string) {
  const res = await api<{
    user: { id: string; email: string; name: string };
    accessToken: string;
  }>('/api/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  const setCookie = res.headers.get('set-cookie') ?? '';
  return { ...res, refreshCookie: extractRefreshCookie(setCookie) };
}

/** Generate a unique email for test isolation. */
let counter = 0;
export function uniqueEmail(): string {
  return `test-${Date.now()}-${counter++}@mavisdraw.test`;
}

/**
 * Retry an auth operation if rate-limited (429).
 * Waits for the Retry-After header or 61s, then retries once.
 */
export async function withRateLimitRetry<T>(
  fn: () => Promise<{ status: number; headers: Headers } & T>,
): Promise<{ status: number; headers: Headers } & T> {
  const result = await fn();
  if (result.status === 429) {
    const retryAfter = result.headers.get('retry-after');
    const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 + 1000 : 61_000;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return fn();
  }
  return result;
}
