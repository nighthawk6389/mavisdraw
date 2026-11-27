import { useEffect, useState } from 'react';
import { apiGetProject, apiGitHubAppStatus, apiUpdateProject } from '../../services/api';
import { absoluteApiBase } from '../../services/apiBase';
import { useDiagramStore } from '../../stores/diagramStore';
import { usePermissionStore } from '../../stores/permissionStore';
import { toast } from '../../stores/toastStore';

/**
 * Pull request checks for a map generated from a GitHub repository: once
 * the MavisDraw GitHub App is installed on it, every pull request gets a
 * comment with what it changes on the map, and a proposed update here.
 */
export default function PullRequestChecks({ repo, active }: { repo: string; active: boolean }) {
  const [status, setStatus] = useState<{ configured: boolean; installUrl: string | null } | null>(
    null,
  );
  const projectId = useDiagramStore((s) => s.diagrams.get(s.activeDiagramId)?.projectId ?? null);
  const role = usePermissionStore((s) => s.role);
  const canManage = role === 'owner' || role === 'admin';
  // This map's own switch (null until loaded)
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    apiGetProject(projectId)
      .then(({ project }) => {
        if (!cancelled) setEnabled(project.prChecksEnabled ?? true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const toggle = async () => {
    if (!projectId || enabled === null) return;
    const next = !enabled;
    setEnabled(next);
    try {
      await apiUpdateProject(projectId, { prChecks: next });
    } catch (err) {
      setEnabled(!next);
      toast(
        `Couldn’t change pull request checks: ${err instanceof Error ? err.message : String(err)}`,
        'error',
      );
    }
  };

  useEffect(() => {
    let cancelled = false;
    apiGitHubAppStatus()
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!status) return null;
  return (
    <div className="mb-4 rounded-md border border-gray-200 px-3 py-2" data-testid="pr-checks">
      <h3 className="mb-1 font-medium text-gray-900">Pull request checks</h3>
      <p className="mb-2 text-xs text-gray-600">
        Every pull request on <span className="font-medium">{repo}</span> gets a comment saying
        which components it touches and how it changes the architecture, and the map update shows up
        here under Proposals for one-click review.
      </p>
      {status.configured && !active ? (
        <p className="text-xs text-amber-800" data-testid="pr-checks-off">
          Off for this map: pull requests are only checked against maps linked by a project owner or
          admin whose GitHub account can push to {repo}. Such a person can turn them on with “Check
          against the code”, then “Mark map as up to date”.
        </p>
      ) : status.configured ? (
        <>
          {enabled !== null && (
            <label className="mb-2 flex items-center gap-2 text-xs text-gray-700">
              <input
                type="checkbox"
                data-testid="pr-checks-toggle"
                checked={enabled}
                disabled={!canManage}
                onChange={() => void toggle()}
              />
              {enabled
                ? 'On for this map: a comment and a check on each pull request'
                : 'Off for this map: its pull requests aren’t checked'}
              {!canManage && (
                <span className="text-gray-400">(owners and admins can change this)</span>
              )}
            </label>
          )}
          {status.installUrl ? (
            <a
              href={status.installUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-block rounded bg-gray-900 px-3 py-1 text-xs font-medium text-white hover:bg-gray-700"
            >
              Install the GitHub App on {repo}
            </a>
          ) : (
            <p className="text-xs text-gray-500">Install your MavisDraw GitHub App on {repo}.</p>
          )}
        </>
      ) : (
        <p className="text-xs text-gray-500">
          Not set up on this server yet. An administrator registers the GitHub App once at{' '}
          <a
            className="text-blue-600 hover:underline"
            href={`${absoluteApiBase()}/api/github-app/setup`}
            target="_blank"
            rel="noreferrer"
          >
            {absoluteApiBase()}/api/github-app/setup
          </a>
          .
        </p>
      )}
    </div>
  );
}
