import React, { useState, useEffect, useCallback } from 'react';
import {
  apiCreateShareLink,
  apiListPermissions,
  apiRevokePermission,
  type PermissionResponse,
} from '../../services/api';

interface ShareDialogProps {
  projectId: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function ShareDialog({ projectId, isOpen, onClose }: ShareDialogProps) {
  const [permissions, setPermissions] = useState<PermissionResponse[]>([]);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [shareRole, setShareRole] = useState<'viewer' | 'editor'>('viewer');
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPermissions = useCallback(async () => {
    try {
      setError(null);
      const response = await apiListPermissions(projectId);
      setPermissions(response.permissions);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load permissions';
      setError(message);
    }
  }, [projectId]);

  useEffect(() => {
    if (isOpen) {
      loadPermissions();
      setShareLink(null);
      setCopied(false);
      setError(null);
    }
  }, [isOpen, loadPermissions]);

  const handleCreateLink = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await apiCreateShareLink(projectId, shareRole);
      const link = `${window.location.origin}/share/${response.share.shareToken}`;
      setShareLink(link);
      loadPermissions();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create share link';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyLink = async () => {
    if (shareLink) {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleRevoke = async (permissionId: string) => {
    try {
      setError(null);
      await apiRevokePermission(permissionId);
      setPermissions((prev) => prev.filter((p) => p.id !== permissionId));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to revoke permission';
      setError(message);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Share Project</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
          >
            &times;
          </button>
        </div>

        <div className="p-4 space-y-4">
          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              {error}
            </div>
          )}

          {/* Create share link */}
          <div>
            <h4 className="text-sm font-medium text-gray-700 mb-2">Create share link</h4>
            <div className="flex items-center gap-2">
              <select
                value={shareRole}
                onChange={(e) => setShareRole(e.target.value as 'viewer' | 'editor')}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="viewer">Can view</option>
                <option value="editor">Can edit</option>
              </select>
              <button
                onClick={handleCreateLink}
                disabled={isLoading}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm disabled:opacity-50"
              >
                {isLoading ? 'Creating...' : 'Create Link'}
              </button>
            </div>

            {shareLink && (
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="text"
                  value={shareLink}
                  readOnly
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm bg-gray-50"
                />
                <button
                  onClick={handleCopyLink}
                  className="px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            )}
          </div>

          {/* Current permissions */}
          <div>
            <h4 className="text-sm font-medium text-gray-700 mb-2">People with access</h4>
            {permissions.length === 0 ? (
              <p className="text-sm text-gray-500">No one else has access yet</p>
            ) : (
              <ul className="space-y-2">
                {permissions
                  .filter((p) => p.userId)
                  .map((permission) => (
                    <li
                      key={permission.id}
                      className="flex items-center justify-between py-2 px-3 bg-gray-50 rounded-md"
                    >
                      <div>
                        <div className="text-sm font-medium text-gray-900">
                          {permission.name ?? permission.email ?? 'Unknown'}
                        </div>
                        {permission.email && (
                          <div className="text-xs text-gray-500">{permission.email}</div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500 bg-gray-200 px-2 py-0.5 rounded">
                          {permission.role}
                        </span>
                        <button
                          onClick={() => handleRevoke(permission.id)}
                          className="text-xs text-red-500 hover:text-red-700"
                        >
                          Remove
                        </button>
                      </div>
                    </li>
                  ))}
              </ul>
            )}
          </div>

          {/* Active share links */}
          {permissions.filter((p) => p.shareToken && !p.userId).length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-gray-700 mb-2">Active share links</h4>
              <ul className="space-y-2">
                {permissions
                  .filter((p) => p.shareToken && !p.userId)
                  .map((permission) => (
                    <li
                      key={permission.id}
                      className="flex items-center justify-between py-2 px-3 bg-gray-50 rounded-md"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500">
                          Link ({permission.role})
                        </span>
                        <span className="text-xs text-gray-400 font-mono">
                          ...{permission.shareToken?.slice(-8)}
                        </span>
                      </div>
                      <button
                        onClick={() => handleRevoke(permission.id)}
                        className="text-xs text-red-500 hover:text-red-700"
                      >
                        Revoke
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-gray-200">
          <button
            onClick={onClose}
            className="w-full py-2 text-sm text-gray-600 hover:text-gray-800"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
