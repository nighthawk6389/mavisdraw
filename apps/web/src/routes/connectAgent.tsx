import { useEffect, useState } from 'react';
import {
  ApiError,
  apiApproveAgentSignIn,
  apiDenyAgentSignIn,
  apiGetAgentSignIn,
  type AgentSignInRequest,
  type TokenScope,
} from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { navigate } from '../routing';
import { TokenScopeFields, scopeIsComplete } from '../components/agent/TokenScopeFields';

const requestId = () => new URLSearchParams(window.location.search).get('request');

/** Inside another site's frame, a click on "Approve" could be someone else's trick. */
const framed = () => {
  try {
    return window.top !== window.self;
  } catch {
    return true;
  }
};

type Phase =
  | { name: 'loading' }
  | { name: 'error'; message: string }
  | { name: 'asking'; request: AgentSignInRequest }
  | { name: 'leaving'; message: string };

function Destination({ redirect }: { redirect: AgentSignInRequest['redirect'] }) {
  if (redirect.kind === 'local') {
    return <>Approving sends you back to the agent on this computer ({redirect.host}).</>;
  }
  if (redirect.kind === 'app') {
    return (
      <>
        Approving opens the <strong>{redirect.host}</strong> app on this computer.
      </>
    );
  }
  return (
    <>
      Approving sends you to <strong className="break-all">{redirect.host}</strong>. Only continue
      if you trust that site.
    </>
  );
}

/**
 * /connect-agent?request=… — a coding agent opened the browser to sign in.
 * The person sees which agent, chooses what it may do and on which maps,
 * and approves or cancels; either way the browser goes back to the agent.
 */
export default function ConnectAgentPage() {
  const [id] = useState(requestId);
  const user = useAuthStore((s) => s.user);
  const [phase, setPhase] = useState<Phase>(() =>
    framed()
      ? { name: 'error', message: 'Open this page in its own tab to connect an agent.' }
      : id
        ? { name: 'loading' }
        : { name: 'error', message: 'This sign-in link is incomplete.' },
  );
  const [scope, setScope] = useState<TokenScope>({ access: 'propose', projectIds: null });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id || framed()) return;
    let cancelled = false;
    apiGetAgentSignIn(id)
      .then((request) => {
        if (cancelled) return;
        setScope({ access: request.requestedAccess, projectIds: null });
        setPhase({ name: 'asking', request });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setPhase({
          name: 'error',
          message: err instanceof ApiError ? err.message : 'Couldn’t load this sign-in. Try again.',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const answer = async (approve: boolean) => {
    if (!id || busy || phase.name !== 'asking') return;
    setBusy(true);
    try {
      const { redirectTo } = approve
        ? await apiApproveAgentSignIn(id, scope)
        : await apiDenyAgentSignIn(id);
      const agent = phase.request.client.name;
      setPhase({
        name: 'leaving',
        message: approve
          ? `${agent} is connected. Go back to it; you can close this tab.`
          : `You didn't connect ${agent}.`,
      });
      window.location.assign(redirectTo);
    } catch (err) {
      setBusy(false);
      setPhase({
        name: 'error',
        message: err instanceof ApiError ? err.message : 'Couldn’t answer the agent. Try again.',
      });
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div
        className="w-full max-w-md rounded-lg bg-white p-8 shadow-lg"
        data-testid="connect-agent"
      >
        {phase.name === 'loading' && <p className="text-center text-gray-500">Loading…</p>}

        {phase.name === 'error' && (
          <>
            <h1 className="mb-4 text-xl font-bold text-gray-900">Connect a coding agent</h1>
            <p role="alert" className="mb-6 text-sm text-red-700">
              {phase.message}
            </p>
            <button
              type="button"
              onClick={() => navigate('/', { replace: true })}
              className="text-sm text-blue-600 hover:text-blue-800"
            >
              Go to your maps
            </button>
          </>
        )}

        {phase.name === 'leaving' && (
          <p className="text-center text-gray-700" role="status">
            {phase.message}
          </p>
        )}

        {phase.name === 'asking' && (
          <>
            <h1 className="mb-1 text-xl font-bold text-gray-900">
              Connect {phase.request.client.name}?
            </h1>
            <p className="mb-4 text-sm text-gray-600">
              It wants to use MavisDraw as <strong>{user?.name || user?.email || 'you'}</strong>: to
              read your architecture maps
              {phase.request.requestedAccess === 'propose'
                ? ' and propose updates for you to review'
                : ''}
              .
            </p>
            <TokenScopeFields
              idPrefix="consent"
              value={scope}
              onChange={setScope}
              projects={phase.request.projects}
              canPropose={phase.request.requestedAccess === 'propose'}
            />
            <p className="mt-4 text-xs text-gray-500">
              <Destination redirect={phase.request.redirect} />
            </p>
            <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
              Only approve if you just started connecting an agent yourself. If you didn't, cancel:
              someone may be trying to reach your maps.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                data-testid="connect-agent-deny"
                disabled={busy}
                onClick={() => void answer(false)}
                className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="connect-agent-approve"
                disabled={busy || !scopeIsComplete(scope)}
                onClick={() => void answer(true)}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                Approve
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
