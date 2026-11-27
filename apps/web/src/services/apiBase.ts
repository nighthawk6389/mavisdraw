/**
 * Where the API lives (the embed viewer imports only this, not the whole client).
 *
 * VITE_API_URL is the API's address; empty means "this same origin": the
 * self-hosted images serve the app and proxy /api and /collaboration to the
 * server, so requests are relative. Unset (local development): the API on 3001.
 */
export function resolveApiBase(configured: string | undefined): string {
  return (configured ?? 'http://localhost:3001').trim().replace(/\/+$/, '');
}

export const API_BASE: string = resolveApiBase(import.meta.env.VITE_API_URL);

/**
 * The API's absolute address, for links that leave the app (README images,
 * agent setup commands): the page's own origin when the API shares it.
 */
export function absoluteApiBase(apiBase: string = API_BASE): string {
  if (apiBase) return apiBase;
  return typeof window === 'undefined' ? '' : window.location.origin;
}
