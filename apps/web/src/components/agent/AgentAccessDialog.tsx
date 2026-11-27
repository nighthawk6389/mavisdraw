import { useEffect, useState, type FormEvent } from 'react';
import {
  MCP_URL,
  apiCreateToken,
  apiListTokens,
  apiRevokeToken,
  type AccessTokenSummary,
} from '../../services/api';
import { useUIStore } from '../../stores/uiStore';
import { toast } from '../../stores/toastStore';
import { mcpSetup, timeAgo } from './mcpSetup';

async function copy(text: string, what: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what} copied`, 'success');
  } catch {
    toast(`Couldn't copy: select the text and copy it instead`, 'error');
  }
}

function Snippet({ label, text, testId }: { label: string; text: string; testId: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium text-gray-600">{label}</span>
        <button
          type="button"
          onClick={() => void copy(text, label)}
          className="text-xs text-blue-600 hover:text-blue-800"
        >
          Copy
        </button>
      </div>
      <pre
        data-testid={testId}
        className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md bg-gray-900 px-3 py-2 font-mono text-[11px] leading-relaxed text-gray-100"
      >
        {text}
      </pre>
    </div>
  );
}

/**
 * "Connect a coding agent": create an access token for MCP clients (Claude
 * Code, Cursor…), with the setup to paste, and revoke old ones.
 */
const close = () => useUIStore.getState().setShowAgentAccess(false);

export default function AgentAccessDialog() {
  const [tokens, setTokens] = useState<AccessTokenSummary[] | null>(null);
  const [name, setName] = useState('');
  const [created, setCreated] = useState<{ token: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiListTokens()
      .then(({ tokens }) => {
        if (!cancelled) setTokens(tokens);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    const tokenName = name.trim();
    if (!tokenName || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { token, summary } = await apiCreateToken(tokenName);
      setCreated({ token, name: summary.name });
      setTokens((list) => [summary, ...(list ?? [])]);
      setName('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (token: AccessTokenSummary) => {
    try {
      await apiRevokeToken(token.id);
      setTokens((list) => (list ?? []).filter((t) => t.id !== token.id));
      toast(`"${token.name}" can no longer connect`, 'success');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const setup = created ? mcpSetup(MCP_URL, created.token) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Connect a coding agent"
        className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="font-semibold text-gray-900">Connect a coding agent</h2>
          <button
            type="button"
            aria-label="Close"
            className="text-gray-400 hover:text-gray-600"
            onClick={close}
          >
            ×
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-5 py-4 text-sm">
          <p className="text-gray-600">
            Coding agents like Claude Code and Cursor can read your architecture maps over{' '}
            <abbr title="Model Context Protocol">MCP</abbr>: which component owns the file they're
            changing, what it talks to, and the big picture. When their change alters the
            architecture, they propose a map update for you to review here.
          </p>

          {setup && created ? (
            <div className="space-y-3 rounded-lg border border-green-200 bg-green-50 p-3">
              <p className="font-medium text-green-900">
                Token “{created.name}” created. Copy it now: it won't be shown again.
              </p>
              <Snippet label="Token" text={created.token} testId="new-token" />
              <Snippet label="Claude Code" text={setup.claudeCode} testId="setup-claude-code" />
              <Snippet
                label="Cursor, VS Code and others (MCP JSON)"
                text={setup.json}
                testId="setup-json"
              />
              <button
                type="button"
                onClick={() => setCreated(null)}
                className="text-xs text-gray-600 hover:text-gray-800"
              >
                Done
              </button>
            </div>
          ) : (
            <form onSubmit={create} className="flex gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name it, e.g. “Claude Code on my laptop”"
                aria-label="Token name"
                maxLength={100}
                className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={!name.trim() || busy}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                Create token
              </button>
            </form>
          )}

          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Your tokens
            </h3>
            {tokens === null ? (
              <p className="text-gray-400">Loading…</p>
            ) : tokens.length === 0 ? (
              <p className="text-gray-500">None yet.</p>
            ) : (
              <ul className="divide-y rounded-md border" aria-label="Access tokens">
                {tokens.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-gray-800">{t.name}</div>
                      <div className="text-xs text-gray-500">
                        <code>{t.prefix}…</code> · created {timeAgo(t.createdAt)} ·{' '}
                        {t.lastUsedAt ? `last used ${timeAgo(t.lastUsedAt)}` : 'never used'}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void revoke(t)}
                      aria-label={`Revoke ${t.name}`}
                      className="shrink-0 text-xs text-red-600 hover:text-red-800"
                    >
                      Revoke
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="text-xs text-gray-500">
            A token acts as you: agents see the projects you can see, and can propose (never make)
            changes where you can edit. Endpoint: <code className="break-all">{MCP_URL}</code>
          </p>
        </div>
      </div>
    </div>
  );
}
