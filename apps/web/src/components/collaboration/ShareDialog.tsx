import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  apiCreateShareLink,
  apiInviteToProject,
  apiListPermissions,
  apiListProjectInvites,
  apiRevokePermission,
  apiRevokeProjectInvite,
  apiTransferProject,
  type PendingInvite,
  type PermissionResponse,
} from '../../services/api';
import { usePermissionStore } from '../../stores/permissionStore';
import { toast } from '../../stores/toastStore';
import EmbedSection from './EmbedSection';
import { useModalDialog } from '../ui/useModalDialog';

interface ShareDialogProps {
  projectId: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function ShareDialog({ projectId, isOpen, onClose }: ShareDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalDialog(dialogRef, onClose, isOpen);
  const [permissions, setPermissions] = useState<PermissionResponse[]>([]);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [shareRole, setShareRole] = useState<'viewer' | 'editor'>('viewer');
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'viewer' | 'editor' | 'admin'>('editor');
  const [inviteResult, setInviteResult] = useState<{ text: string; link?: string } | null>(null);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const isOwner = usePermissionStore((s) => s.role === 'owner');

  const loadPermissions = useCallback(async () => {
    try {
      setError(null);
      const [response, pending] = await Promise.all([
        apiListPermissions(projectId),
        apiListProjectInvites(projectId).catch(() => ({ invites: [] as PendingInvite[] })),
      ]);
      setPermissions(response.permissions);
      setInvites(pending.invites);
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

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = inviteEmail.trim();
    if (!email) return;
    setError(null);
    try {
      const result = await apiInviteToProject(projectId, email, inviteRole);
      setInviteResult(
        result.status === 'added'
          ? {
              text: `${email} now has access${result.emailed ? ' (we let them know by email)' : ''}.`,
            }
          : {
              text: result.emailed
                ? `We emailed ${email} an invite — they'll get access when they sign up. You can also share the link:`
                : `${email} doesn't have an account yet. Send them this link — they'll get access when they sign up:`,
              link: `${window.location.origin}${result.inviteUrl}`,
            },
      );
      setInviteEmail('');
      await loadPermissions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to invite');
    }
  };

  const handleTransfer = async (permission: PermissionResponse) => {
    if (!permission.userId) return;
    const who = permission.name ?? permission.email ?? 'them';
    if (!confirm(`Make ${who} the owner? You'll stay on as an admin.`)) return;
    try {
      await apiTransferProject(projectId, permission.userId);
      usePermissionStore.getState().setRole('admin');
      toast(`${who} now owns this project`, 'success');
      await loadPermissions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to transfer ownership');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-dialog-title"
        tabIndex={-1}
        className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4 flex max-h-[90vh] flex-col"
      >
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h3 id="share-dialog-title" className="text-lg font-semibold text-gray-900">Share Project</h3>
          <button
            aria-label="Close"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
          >
            &times;
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto">
          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              {error}
            </div>
          )}

          {/* Invite by email */}
          <div>
            <h4 className="text-sm font-medium text-gray-700 mb-2">Invite people</h4>
            <form onSubmit={handleInvite} className="flex items-center gap-2">
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="name@company.com"
                aria-label="Email to invite"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as 'viewer' | 'editor' | 'admin')}
                aria-label="Invite role"
                className="px-2 py-2 border border-gray-300 rounded-md text-sm"
              >
                <option value="viewer">Can view</option>
                <option value="editor">Can edit</option>
                {isOwner && <option value="admin">Admin</option>}
              </select>
              <button
                type="submit"
                className="px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm"
              >
                Invite
              </button>
            </form>
            {inviteResult && (
              <div
                className="mt-2 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-900"
                data-testid="invite-result"
              >
                {inviteResult.text}
                {inviteResult.link && (
                  <input
                    readOnly
                    value={inviteResult.link}
                    aria-label="Invite link"
                    className="mt-1 w-full rounded border bg-white px-2 py-1 font-mono text-xs"
                    onFocus={(e) => e.currentTarget.select()}
                  />
                )}
              </div>
            )}
            {invites.length > 0 && (
              <ul className="mt-2 space-y-1">
                {invites.map((i) => (
                  <li
                    key={i.id}
                    className="flex items-center justify-between rounded-md bg-gray-50 px-3 py-1.5 text-sm"
                    data-testid="pending-invite"
                  >
                    <span className="truncate text-gray-700">
                      ✉ {i.email}{' '}
                      <span className="text-xs text-gray-400">· invited · {i.role}</span>
                    </span>
                    <span className="flex gap-2 text-xs">
                      <button
                        type="button"
                        className="text-blue-600 hover:underline"
                        onClick={() =>
                          void navigator.clipboard?.writeText(
                            `${window.location.origin}/invite/${i.token}`,
                          )
                        }
                      >
                        Copy link
                      </button>
                      <button
                        type="button"
                        className="text-red-500 hover:text-red-700"
                        onClick={() =>
                          void apiRevokeProjectInvite(projectId, i.id).then(() =>
                            setInvites((prev) => prev.filter((x) => x.id !== i.id)),
                          )
                        }
                      >
                        Revoke
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

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
                        {isOwner && (
                          <button
                            onClick={() => void handleTransfer(permission)}
                            className="text-xs text-gray-500 hover:text-gray-800"
                          >
                            Make owner
                          </button>
                        )}
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
                        <span className="text-xs text-gray-500">Link ({permission.role})</span>
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

          <div className="border-t border-gray-200 pt-4">
            <EmbedSection projectId={projectId} />
          </div>
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
