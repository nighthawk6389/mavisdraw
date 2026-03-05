import React, { useState, useEffect, useCallback } from 'react';
import { useGitHubStore } from '../../stores/githubStore';
import type { GitHubLink } from '@mavisdraw/types';

interface RepoBrowserProps {
  connectionId: string;
  initialOwner?: string;
  initialRepo?: string;
  initialPath?: string;
  initialRef?: string;
  onSelect: (link: GitHubLink) => void;
  onClose: () => void;
}

type BrowseStep = 'repos' | 'tree';

export default function RepoBrowser({
  connectionId,
  initialOwner,
  initialRepo,
  initialPath,
  initialRef,
  onSelect,
  onClose,
}: RepoBrowserProps) {
  const repos = useGitHubStore((s) => s.repos);
  const branches = useGitHubStore((s) => s.branches);
  const treeEntries = useGitHubStore((s) => s.treeEntries);
  const fileContent = useGitHubStore((s) => s.fileContent);
  const isLoading = useGitHubStore((s) => s.isLoading);
  const error = useGitHubStore((s) => s.error);
  const fetchRepos = useGitHubStore((s) => s.fetchRepos);
  const fetchBranches = useGitHubStore((s) => s.fetchBranches);
  const fetchTree = useGitHubStore((s) => s.fetchTree);
  const fetchFileContent = useGitHubStore((s) => s.fetchFileContent);
  const clearFileContent = useGitHubStore((s) => s.clearFileContent);

  const [step, setStep] = useState<BrowseStep>(
    initialOwner && initialRepo ? 'tree' : 'repos',
  );
  const [selectedOwner, setSelectedOwner] = useState(initialOwner ?? '');
  const [selectedRepo, setSelectedRepo] = useState(initialRepo ?? '');
  const [currentPath, setCurrentPath] = useState(initialPath ?? '');
  const [selectedRef, setSelectedRef] = useState(initialRef ?? 'HEAD');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (step === 'repos') {
      fetchRepos(connectionId);
    }
  }, [step, connectionId, fetchRepos]);

  useEffect(() => {
    if (step === 'tree' && selectedOwner && selectedRepo) {
      fetchTree(connectionId, selectedOwner, selectedRepo, currentPath, selectedRef);
      fetchBranches(connectionId, selectedOwner, selectedRepo);
    }
  }, [step, connectionId, selectedOwner, selectedRepo, currentPath, selectedRef, fetchTree, fetchBranches]);

  const selectRepo = useCallback(
    (owner: string, repo: string, defaultBranch: string) => {
      setSelectedOwner(owner);
      setSelectedRepo(repo);
      setSelectedRef(defaultBranch);
      setCurrentPath('');
      setStep('tree');
      clearFileContent();
    },
    [clearFileContent],
  );

  const navigateToFolder = useCallback(
    (path: string) => {
      setCurrentPath(path);
      clearFileContent();
    },
    [clearFileContent],
  );

  const navigateUp = useCallback(() => {
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    setCurrentPath(parts.join('/'));
    clearFileContent();
  }, [currentPath, clearFileContent]);

  const handleLinkCurrent = useCallback(() => {
    onSelect({
      owner: selectedOwner,
      repo: selectedRepo,
      path: currentPath,
      ref: selectedRef,
    });
  }, [selectedOwner, selectedRepo, currentPath, selectedRef, onSelect]);

  const filteredRepos = searchQuery
    ? repos.filter(
        (r) =>
          r.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (r.description?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false),
      )
    : repos;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-[600px] w-full max-w-2xl flex-col rounded-xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            {step === 'tree' && (
              <button
                onClick={() => {
                  setStep('repos');
                  clearFileContent();
                }}
                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                title="Back to repos"
              >
                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            )}
            <h3 className="text-sm font-semibold">
              {step === 'repos'
                ? 'Select Repository'
                : `${selectedOwner}/${selectedRepo}`}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>

        {/* Branch selector (tree step only) */}
        {step === 'tree' && branches.length > 0 && (
          <div className="flex items-center gap-2 border-b px-4 py-2">
            <label className="text-xs text-gray-500">Branch:</label>
            <select
              value={selectedRef}
              onChange={(e) => setSelectedRef(e.target.value)}
              className="rounded border px-2 py-1 text-xs"
            >
              {branches.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name}
                </option>
              ))}
            </select>
            {currentPath && (
              <span className="text-xs text-gray-400">/ {currentPath}</span>
            )}
          </div>
        )}

        {/* Content area */}
        <div className="flex-1 overflow-y-auto">
          {error && (
            <div className="m-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>
          )}

          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-gray-900" />
            </div>
          )}

          {!isLoading && step === 'repos' && (
            <>
              <div className="p-3">
                <input
                  type="text"
                  placeholder="Search repositories..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-md border px-3 py-2 text-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div className="divide-y">
                {filteredRepos.map((repo) => (
                  <button
                    key={repo.id}
                    onClick={() => selectRepo(repo.owner.login, repo.name, repo.default_branch)}
                    className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-gray-50"
                  >
                    <div className="mt-0.5">
                      {repo.private ? (
                        <svg className="h-4 w-4 text-yellow-500" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                        </svg>
                      ) : (
                        <svg className="h-4 w-4 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
                        </svg>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{repo.full_name}</p>
                      {repo.description && (
                        <p className="mt-0.5 truncate text-xs text-gray-500">{repo.description}</p>
                      )}
                      <div className="mt-1 flex items-center gap-3 text-xs text-gray-400">
                        {repo.language && <span>{repo.language}</span>}
                        <span>Updated {new Date(repo.updated_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}

          {!isLoading && step === 'tree' && !fileContent && (
            <div className="divide-y">
              {currentPath && (
                <button
                  onClick={navigateUp}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-500 hover:bg-gray-50"
                >
                  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path
                      fillRule="evenodd"
                      d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                  ..
                </button>
              )}
              {treeEntries.map((entry) => (
                <button
                  key={entry.sha}
                  onClick={() => {
                    if (entry.type === 'tree') {
                      navigateToFolder(entry.path);
                    } else {
                      fetchFileContent(connectionId, selectedOwner, selectedRepo, entry.path, selectedRef);
                    }
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-gray-50"
                >
                  {entry.type === 'tree' ? (
                    <svg className="h-4 w-4 text-blue-500" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                    </svg>
                  ) : (
                    <svg className="h-4 w-4 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                    </svg>
                  )}
                  <span className="truncate">{entry.path.split('/').pop()}</span>
                  {entry.size != null && entry.type === 'blob' && (
                    <span className="ml-auto text-xs text-gray-400">
                      {entry.size < 1024
                        ? `${entry.size} B`
                        : `${(entry.size / 1024).toFixed(1)} KB`}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          {!isLoading && fileContent != null && (
            <div className="p-4">
              <div className="flex items-center justify-between pb-2">
                <button
                  onClick={clearFileContent}
                  className="text-xs text-blue-600 hover:underline"
                >
                  Back to tree
                </button>
              </div>
              <pre className="max-h-96 overflow-auto rounded-md bg-gray-50 p-3 text-xs leading-relaxed">
                {fileContent}
              </pre>
            </div>
          )}
        </div>

        {/* Footer — link button */}
        {step === 'tree' && (
          <div className="flex items-center justify-between border-t px-4 py-3">
            <span className="text-xs text-gray-400">
              {selectedOwner}/{selectedRepo}
              {currentPath ? `/${currentPath}` : ''}
            </span>
            <button
              onClick={handleLinkCurrent}
              className="rounded-md bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-800"
            >
              Link to Portal
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
