import React, { useEffect, useRef, useState } from 'react';
import { describeDrift, type DriftChange } from '@mavisdraw/compat';
import {
  applyDrift,
  checkDrift,
  focusElement,
  generateMapFromRepo,
  markUpToDate,
  portalForPath,
  snapshotFromFolder,
  snapshotFromGitHub,
  useRepoStore,
} from '../../repo/repoMap';
import {
  apiGetGitHubStatus,
  apiListGitHubRepos,
  type GitHubConnection,
  type GitHubRepo,
} from '../../services/github';
import { toast } from '../../stores/toastStore';

const timeAgo = (iso: string) => {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h} h ago` : new Date(iso).toLocaleDateString();
};

/** A folder picker (webkitdirectory isn't in React's input typings). */
function FolderInput({ onPick, label }: { onPick: (files: FileList) => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.setAttribute('webkitdirectory', '');
    ref.current?.setAttribute('directory', '');
  }, []);
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700">
      {label}
      <input
        ref={ref}
        type="file"
        multiple
        className="sr-only"
        data-testid="repo-folder-input"
        onChange={(e) => e.target.files?.length && onPick(e.target.files)}
      />
    </label>
  );
}

/** Generate a map from a repository, and keep it in line with the code. */
export default function RepoMapDialog() {
  const open = useRepoStore((s) => s.dialogOpen);
  const setOpen = useRepoStore((s) => s.setDialogOpen);
  const source = useRepoStore((s) => s.source);
  const drift = useRepoStore((s) => s.drift);
  const applied = useRepoStore((s) => s.applied);
  const [busy, setBusy] = useState(false);
  const [connections, setConnections] = useState<GitHubConnection[]>([]);
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [repoChoice, setRepoChoice] = useState('');
  const [ref, setRef] = useState('');

  // GitHub, if connected: offer its repositories
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    apiGetGitHubStatus()
      .then(({ connections }) => {
        if (cancelled) return;
        setConnections(connections);
        if (connections[0]) {
          return apiListGitHubRepos(connections[0].id).then((r) => {
            if (!cancelled) setRepos(r.repos ?? []);
          });
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Something went wrong', 'error');
    } finally {
      setBusy(false);
    }
  };

  const generateFromFolder = (files: FileList) =>
    run(async () => {
      const snapshot = await snapshotFromFolder(files);
      const r = await generateMapFromRepo(snapshot, { kind: 'folder', label: snapshot.name });
      toast(
        `Mapped ${snapshot.name}: ${r.components} components, ${r.resources} services and datastores, ${r.diagrams} levels`,
        'success',
      );
      setOpen(false);
    });

  const generateFromGitHub = () =>
    run(async () => {
      const repo = repos.find((r) => r.full_name === repoChoice);
      const conn = connections[0];
      if (!repo || !conn) return;
      const [owner, name] = repo.full_name.split('/');
      const {
        snapshot,
        ref: resolved,
        truncated,
      } = await snapshotFromGitHub(conn.id, owner, name, ref || undefined);
      const r = await generateMapFromRepo(snapshot, {
        kind: 'github',
        label: `${repo.full_name}@${resolved}`,
        owner,
        repo: name,
        ref: resolved,
        connectionId: conn.id,
      });
      toast(
        `Mapped ${repo.full_name}: ${r.components} components, ${r.diagrams} levels${truncated ? ' (large repo: partly analysed)' : ''}`,
        'success',
      );
      setOpen(false);
    });

  const checkFolder = (files: FileList) =>
    run(async () => {
      const changes = checkDrift(await snapshotFromFolder(files));
      if (changes.length === 0) toast('The map matches the code.', 'success');
    });

  const checkGitHub = () =>
    run(async () => {
      if (!source?.connectionId || !source.owner || !source.repo) return;
      const { snapshot } = await snapshotFromGitHub(
        source.connectionId,
        source.owner,
        source.repo,
        source.ref,
      );
      const changes = checkDrift(snapshot);
      if (changes.length === 0) toast('The map matches the code.', 'success');
    });

  const fix = (change: DriftChange, index: number) =>
    run(async () => {
      const problem = await applyDrift(change);
      if (problem) {
        toast(problem, 'info');
        return;
      }
      useRepoStore.setState((s) => ({ applied: new Set(s.applied).add(index) }));
    });

  const actionFor = (c: DriftChange): string =>
    c.kind === 'component-added'
      ? 'Add to map'
      : c.kind === 'component-removed'
        ? 'Remove from map'
        : c.kind.endsWith('-added')
          ? 'Connect'
          : 'Disconnect';

  const subjectPath = (c: DriftChange) =>
    c.kind === 'component-added' || c.kind === 'component-removed' ? c.component.path : c.from.path;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={() => setOpen(false)}
    >
      <div
        role="dialog"
        aria-label="Map ⇄ code"
        data-testid="repo-dialog"
        className="w-full max-w-xl rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="font-semibold text-gray-900">Map ⇄ code</h2>
          <button
            type="button"
            aria-label="Close"
            className="text-gray-400 hover:text-gray-600"
            onClick={() => setOpen(false)}
          >
            ×
          </button>
        </div>

        {!source ? (
          <div className="space-y-5 px-5 py-4 text-sm text-gray-700">
            <p>
              Turn a repository into a nested architecture map: one level per app and package
              (linked to its code), their main folders inside, and the datastores and services they
              use. Later, check the map against the code to see what changed.
            </p>
            <div>
              <div className="mb-2 font-medium text-gray-900">From a folder on this computer</div>
              <FolderInput
                label={busy ? 'Reading…' : 'Choose a repository folder'}
                onPick={(f) => void generateFromFolder(f)}
              />
              <p className="mt-1 text-xs text-gray-500">
                Only file names and manifests (package.json, docker-compose…) are read, in your
                browser.
              </p>
            </div>
            <div>
              <div className="mb-2 font-medium text-gray-900">From GitHub</div>
              {connections.length === 0 ? (
                <p className="text-xs text-gray-500">
                  Connect GitHub (header → GitHub) to map a repository there.
                </p>
              ) : (
                <div className="flex gap-2">
                  <select
                    value={repoChoice}
                    onChange={(e) => setRepoChoice(e.target.value)}
                    aria-label="Repository"
                    className="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1.5"
                  >
                    <option value="">Choose a repository…</option>
                    {repos.map((r) => (
                      <option key={r.full_name} value={r.full_name}>
                        {r.full_name}
                      </option>
                    ))}
                  </select>
                  <input
                    value={ref}
                    onChange={(e) => setRef(e.target.value)}
                    placeholder="branch (default)"
                    aria-label="Branch"
                    className="w-32 rounded-md border border-gray-300 px-2 py-1.5"
                  />
                  <button
                    type="button"
                    disabled={!repoChoice || busy}
                    className="rounded-md bg-blue-600 px-3 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    onClick={() => void generateFromGitHub()}
                  >
                    Map it
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="px-5 py-4 text-sm text-gray-700">
            <p className="mb-3" data-testid="repo-linked">
              Mapped from <span className="font-medium text-gray-900">{source.label}</span> ·{' '}
              {timeAgo(source.generatedAt)} · {source.model.components.length} components
            </p>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              {source.kind === 'github' ? (
                <button
                  type="button"
                  disabled={busy}
                  className="rounded-md bg-blue-600 px-3 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  onClick={() => void checkGitHub()}
                >
                  {busy ? 'Checking…' : 'Check against the code'}
                </button>
              ) : (
                <FolderInput
                  label={busy ? 'Checking…' : 'Check against the folder again'}
                  onPick={(f) => void checkFolder(f)}
                />
              )}
            </div>

            {drift && drift.length > 0 && (
              <>
                <h3 className="mb-2 font-medium text-gray-900">
                  {drift.length} {drift.length === 1 ? 'change' : 'changes'} in the code since the
                  map was made
                </h3>
                <ul className="max-h-72 space-y-1 overflow-y-auto" data-testid="drift-list">
                  {drift.map((change, i) => {
                    const done = applied.has(i);
                    const portal = portalForPath(subjectPath(change));
                    return (
                      <li
                        key={i}
                        className="flex items-center gap-2 rounded-md bg-gray-50 px-3 py-2"
                        data-testid="drift-item"
                      >
                        <span className={`flex-1 ${done ? 'text-gray-400 line-through' : ''}`}>
                          {describeDrift(change)}
                        </span>
                        {portal && change.kind !== 'component-added' && (
                          <button
                            type="button"
                            className="text-xs text-gray-500 hover:text-gray-800"
                            onClick={() => focusElement(portal)}
                          >
                            Show
                          </button>
                        )}
                        {done ? (
                          <span className="text-xs text-green-700">Done ✓</span>
                        ) : (
                          <button
                            type="button"
                            disabled={busy}
                            className="rounded bg-white px-2 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-blue-200 hover:bg-blue-50"
                            onClick={() => void fix(change, i)}
                          >
                            {actionFor(change)}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    className="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
                    onClick={() =>
                      void run(async () => {
                        await markUpToDate();
                        toast('The map is now up to date with the code.', 'success');
                      })
                    }
                  >
                    Mark map as up to date
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
