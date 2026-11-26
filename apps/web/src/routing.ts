import { useSyncExternalStore } from 'react';

/**
 * Minimal History-API router. URLs are the app's addresses:
 *   /                          dashboard
 *   /p/:projectId              a project's root diagram
 *   /p/:projectId/d/:diagramId a nested diagram (deep link)
 *   /share/:token              accept a share link, then open the project
 */
export type Route =
  | { name: 'dashboard' }
  | { name: 'project'; projectId: string; diagramId: string | null }
  | { name: 'share'; token: string };

export function parseRoute(pathname: string): Route {
  const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'p' && parts[1]) {
    return {
      name: 'project',
      projectId: parts[1],
      diagramId: parts[2] === 'd' && parts[3] ? parts[3] : null,
    };
  }
  if (parts[0] === 'share' && parts[1]) return { name: 'share', token: parts[1] };
  return { name: 'dashboard' };
}

export function projectPath(projectId: string, diagramId?: string | null): string {
  const base = `/p/${encodeURIComponent(projectId)}`;
  return diagramId ? `${base}/d/${encodeURIComponent(diagramId)}` : base;
}

const listeners = new Set<() => void>();
let current: Route =
  typeof window === 'undefined' ? { name: 'dashboard' } : parseRoute(window.location.pathname);

function refresh(): void {
  current = parseRoute(window.location.pathname);
  for (const l of listeners) l();
}

if (typeof window !== 'undefined') window.addEventListener('popstate', refresh);

export function navigate(path: string, options: { replace?: boolean } = {}): void {
  if (window.location.pathname === path) return;
  if (options.replace) window.history.replaceState(null, '', path);
  else window.history.pushState(null, '', path);
  refresh();
}

/**
 * Update the address bar without notifying listeners (e.g. tracking the open
 * diagram). With `push`, it's a new history entry, so Back returns to it.
 */
export function reflectPath(path: string, options: { push?: boolean } = {}): void {
  if (window.location.pathname !== path) {
    if (options.push) window.history.pushState(null, '', path);
    else window.history.replaceState(null, '', path);
  }
  current = parseRoute(path);
}

export function useRoute(): Route {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
    () => current,
  );
}
