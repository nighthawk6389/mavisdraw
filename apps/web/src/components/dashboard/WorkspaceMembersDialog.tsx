import React, { useCallback, useEffect, useState } from 'react';
import {
  apiInviteToWorkspace,
  apiRemoveWorkspaceMember,
  apiRevokeWorkspaceInvite,
  apiSetWorkspaceRole,
  apiWorkspaceMembers,
  type PendingInvite,
  type WorkspaceMember,
  type WorkspaceResponse,
  type WorkspaceRole,
} from '../../services/api';
import { useAuthStore } from '../../stores/authStore';

/** Who's in a workspace; invite by email; change roles. */
export default function WorkspaceMembersDialog({
  workspace,
  onClose,
  onChanged,
}: {
  workspace: WorkspaceResponse;
  onClose: () => void;
  onChanged: () => void;
}) {
  const me = useAuthStore((s) => s.user?.id);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [myRole, setMyRole] = useState<WorkspaceRole>(workspace.role);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'member' | 'admin'>('member');
  const [message, setMessage] = useState<{ text: string; link?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canManage = myRole !== 'member';

  const load = useCallback(async () => {
    try {
      const res = await apiWorkspaceMembers(workspace.id);
      setMembers(res.members);
      setInvites(res.invites);
      setMyRole(res.role);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [workspace.id]);

  useEffect(() => {
    let cancelled = false;
    apiWorkspaceMembers(workspace.id)
      .then((res) => {
        if (cancelled) return;
        setMembers(res.members);
        setInvites(res.invites);
        setMyRole(res.role);
      })
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [workspace.id]);

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setError(null);
    try {
      const result = await apiInviteToWorkspace(workspace.id, email.trim(), role);
      if (result.status === 'added') {
        setMessage({ text: `${email.trim()} was added to the workspace.` });
      } else {
        setMessage({
          text: `${email.trim()} doesn't have an account yet. Send them this link — they'll join when they sign up:`,
          link: `${window.location.origin}${result.inviteUrl}`,
        });
      }
      setEmail('');
      await load();
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await load();
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label={`${workspace.name} members`}
        className="w-full max-w-lg rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="font-semibold text-gray-900">{workspace.name} · Members</h2>
          <button
            type="button"
            aria-label="Close"
            className="text-gray-400 hover:text-gray-600"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {canManage && (
          <form onSubmit={invite} className="flex gap-2 border-b px-5 py-3">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Invite by email"
              aria-label="Email to invite"
              className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as 'member' | 'admin')}
              aria-label="Role"
              className="rounded-md border border-gray-300 px-2 text-sm"
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
            <button
              type="submit"
              className="rounded-md bg-blue-600 px-3 text-sm font-medium text-white hover:bg-blue-700"
            >
              Invite
            </button>
          </form>
        )}

        {message && (
          <div
            className="border-b bg-blue-50 px-5 py-2 text-sm text-blue-900"
            data-testid="invite-result"
          >
            {message.text}
            {message.link && (
              <div className="mt-1 flex gap-2">
                <input
                  readOnly
                  value={message.link}
                  className="flex-1 rounded border bg-white px-2 py-1 font-mono text-xs"
                  aria-label="Invite link"
                />
                <button
                  type="button"
                  className="rounded bg-white px-2 text-xs text-blue-700 ring-1 ring-blue-200 hover:bg-blue-100"
                  onClick={() => void navigator.clipboard?.writeText(message.link!)}
                >
                  Copy
                </button>
              </div>
            )}
          </div>
        )}
        {error && <div className="border-b bg-red-50 px-5 py-2 text-sm text-red-700">{error}</div>}

        <ul className="max-h-80 overflow-y-auto px-5 py-2" aria-label="Members">
          {members.map((m) => (
            <li
              key={m.userId}
              className="flex items-center gap-3 py-2"
              data-testid="workspace-member"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700">
                {m.name.slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-gray-900">
                  {m.name} {m.userId === me && <span className="text-gray-400">(you)</span>}
                </div>
                <div className="truncate text-xs text-gray-500">{m.email}</div>
              </div>
              {canManage && m.userId !== me && (myRole === 'owner' || m.role !== 'owner') ? (
                <>
                  <select
                    value={m.role}
                    aria-label={`${m.name}'s role`}
                    onChange={(e) =>
                      void act(() =>
                        apiSetWorkspaceRole(
                          workspace.id,
                          m.userId,
                          e.target.value as WorkspaceRole,
                        ),
                      )
                    }
                    className="rounded border border-gray-300 px-1 py-0.5 text-xs"
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                    {myRole === 'owner' && <option value="owner">Owner</option>}
                  </select>
                  <button
                    type="button"
                    className="text-xs text-gray-400 hover:text-red-600"
                    onClick={() => void act(() => apiRemoveWorkspaceMember(workspace.id, m.userId))}
                  >
                    Remove
                  </button>
                </>
              ) : (
                <span className="text-xs capitalize text-gray-500">{m.role}</span>
              )}
            </li>
          ))}
          {invites.map((i) => (
            <li
              key={i.id}
              className="flex items-center gap-3 py-2 text-sm"
              data-testid="pending-invite"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full border border-dashed border-gray-300 text-xs text-gray-400">
                ✉
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-gray-700">{i.email}</div>
                <div className="text-xs text-gray-400">Invited · {i.role}</div>
              </div>
              <button
                type="button"
                className="text-xs text-blue-600 hover:underline"
                onClick={() =>
                  void navigator.clipboard?.writeText(`${window.location.origin}/invite/${i.token}`)
                }
              >
                Copy link
              </button>
              <button
                type="button"
                className="text-xs text-gray-400 hover:text-red-600"
                onClick={() => void act(() => apiRevokeWorkspaceInvite(workspace.id, i.id))}
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>

        <div className="flex justify-between border-t px-5 py-3 text-xs text-gray-500">
          <span>Members can edit every project in the workspace; admins can manage it.</span>
          <button
            type="button"
            className="text-red-500 hover:underline"
            onClick={() => {
              if (me && confirm(`Leave ${workspace.name}?`)) {
                void act(() => apiRemoveWorkspaceMember(workspace.id, me)).then(onClose);
              }
            }}
          >
            Leave
          </button>
        </div>
      </div>
    </div>
  );
}
