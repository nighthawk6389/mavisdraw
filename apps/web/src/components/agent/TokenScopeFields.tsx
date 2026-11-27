import type { TokenAccess, TokenScope } from '../../services/api';

export interface ScopeProject {
  id: string;
  name: string;
}

/**
 * What an agent may do and which maps it sees: for a new token and for an
 * agent signing in. `projects` is null while the list loads.
 */
export function TokenScopeFields({
  value,
  onChange,
  projects,
  canPropose = true,
  idPrefix,
}: {
  value: TokenScope;
  onChange: (next: TokenScope) => void;
  projects: ScopeProject[] | null;
  /** False when the agent only asked to read: proposing isn't offered. */
  canPropose?: boolean;
  /** Keeps radio groups apart when two forms are on one page. */
  idPrefix: string;
}) {
  const limited = value.projectIds !== null;
  const chosen = new Set(value.projectIds ?? []);
  const setAccess = (access: TokenAccess) => onChange({ ...value, access });
  const toggle = (id: string) => {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange({ ...value, projectIds: [...next] });
  };

  const radio = 'h-3.5 w-3.5 text-blue-600 focus:ring-blue-500';
  return (
    <div className="space-y-3 text-sm" data-testid={`${idPrefix}-scope`}>
      <fieldset>
        <legend className="mb-1 text-xs font-medium text-gray-600">It can</legend>
        <div className="space-y-1">
          {canPropose && (
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name={`${idPrefix}-access`}
                className={radio}
                checked={value.access === 'propose'}
                onChange={() => setAccess('propose')}
              />
              Read maps and propose updates for you to review
            </label>
          )}
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name={`${idPrefix}-access`}
              className={radio}
              checked={value.access === 'read'}
              onChange={() => setAccess('read')}
            />
            Only read maps
          </label>
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-1 text-xs font-medium text-gray-600">On</legend>
        <div className="space-y-1">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name={`${idPrefix}-projects`}
              className={radio}
              checked={!limited}
              onChange={() => onChange({ ...value, projectIds: null })}
            />
            Every map you can open
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name={`${idPrefix}-projects`}
              className={radio}
              checked={limited}
              onChange={() => onChange({ ...value, projectIds: value.projectIds ?? [] })}
            />
            Only the maps I choose
          </label>
        </div>
        {limited && (
          <div
            className="mt-2 max-h-40 overflow-y-auto rounded-md border border-gray-200 p-2"
            role="group"
            aria-label="Maps it can open"
          >
            {projects === null ? (
              <p className="text-gray-400">Loading your maps…</p>
            ) : projects.length === 0 ? (
              <p className="text-gray-500">You don't have any maps yet.</p>
            ) : (
              projects.map((p) => (
                <label key={p.id} className="flex items-center gap-2 py-0.5">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 rounded text-blue-600 focus:ring-blue-500"
                    checked={chosen.has(p.id)}
                    onChange={() => toggle(p.id)}
                  />
                  <span className="truncate">{p.name}</span>
                </label>
              ))
            )}
          </div>
        )}
      </fieldset>
    </div>
  );
}

/** A scope that can be submitted: a limited one names at least one map. */
export const scopeIsComplete = (scope: TokenScope) =>
  scope.projectIds === null || scope.projectIds.length > 0;

/** "Read only · 2 maps" — how a token's limits read in a list. */
export function describeScope(
  access: TokenAccess,
  projects: Array<{ name: string }> | null,
): string | null {
  const parts = [
    access === 'read' ? 'Read only' : null,
    projects
      ? projects.length === 1
        ? `only “${projects[0].name}”`
        : `${projects.length} maps`
      : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
}
