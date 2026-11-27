import { useEffect, useState } from 'react';
import { apiGitHubAppStatus } from '../../services/api';
import { API_BASE } from '../../services/apiBase';

/**
 * Pull request checks for a map generated from a GitHub repository: once
 * the MavisDraw GitHub App is installed on it, every pull request gets a
 * comment with what it changes on the map, and a proposed update here.
 */
export default function PullRequestChecks({ repo }: { repo: string }) {
  const [status, setStatus] = useState<{ configured: boolean; installUrl: string | null } | null>(
    null,
  );

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
      {status.configured ? (
        status.installUrl ? (
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
        )
      ) : (
        <p className="text-xs text-gray-500">
          Not set up on this server yet. An administrator registers the GitHub App once at{' '}
          <a
            className="text-blue-600 hover:underline"
            href={`${API_BASE}/api/github-app/setup`}
            target="_blank"
            rel="noreferrer"
          >
            {API_BASE}/api/github-app/setup
          </a>
          .
        </p>
      )}
    </div>
  );
}
