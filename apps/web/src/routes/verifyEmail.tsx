import { useEffect, useState } from 'react';
import { apiResendVerification, apiVerifyEmail } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { navigate } from '../routing';

type State =
  | { status: 'working' }
  | { status: 'done'; claimed: number; signedInAsThem: boolean }
  | { status: 'failed'; message: string };

/** Read once: the token leaves the address bar as soon as the page opens. */
function takeToken(): string | null {
  const token = new URLSearchParams(window.location.search).get('token');
  window.history.replaceState(null, '', '/verify-email');
  return token;
}

/** One request per token, even when React runs effects twice in development. */
const attempts = new Map<string, ReturnType<typeof apiVerifyEmail>>();

/**
 * /verify-email?token=… — the link from the confirmation email. Works signed
 * in or out (it may be opened on another device).
 */
export default function VerifyEmailPage() {
  const [token] = useState(takeToken);
  const [state, setState] = useState<State>(() =>
    token
      ? { status: 'working' }
      : { status: 'failed', message: 'This confirmation link is broken.' },
  );
  const [resent, setResent] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  const signedIn = useAuthStore((s) => s.isAuthenticated);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const attempt = attempts.get(token) ?? apiVerifyEmail(token);
    attempts.set(token, attempt);
    attempt
      .then(({ userId, claimed }) => {
        const user = useAuthStore.getState().user;
        const signedInAsThem = user?.id === userId;
        if (signedInAsThem) {
          useAuthStore.setState({ user: { ...user, emailVerified: true } });
        }
        if (!cancelled) setState({ status: 'done', claimed, signedInAsThem });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({
            status: 'failed',
            message: err instanceof Error ? err.message : 'This confirmation link is broken.',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const resend = () => {
    setResent('sending');
    apiResendVerification()
      .then(({ sent }) => setResent(sent ? 'sent' : 'failed'))
      .catch(() => setResent('failed'));
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div
        className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-6 text-center shadow-sm"
        data-testid="verify-email"
        aria-live="polite"
      >
        {state.status === 'working' && <p className="text-gray-600">Confirming your email…</p>}
        {state.status === 'done' && (
          <>
            <h1 className="text-lg font-semibold text-gray-900">Your email is confirmed</h1>
            <p className="mt-2 text-sm text-gray-600">
              {state.claimed > 0
                ? `${state.claimed} ${state.claimed === 1 ? 'invitation was' : 'invitations were'} waiting for you, and ${state.claimed === 1 ? "it's" : "they're"} now in your dashboard.`
                : 'Anything shared with this address will now come straight to you.'}
            </p>
            <button
              type="button"
              onClick={() => navigate('/', { replace: true })}
              className="mt-5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              {signedIn && state.signedInAsThem ? 'Go to your dashboard' : 'Continue'}
            </button>
          </>
        )}
        {state.status === 'failed' && (
          <>
            <h1 className="text-lg font-semibold text-gray-900">We couldn’t confirm your email</h1>
            <p className="mt-2 text-sm text-gray-600" role="alert">
              {state.message}
            </p>
            <div className="mt-5 flex justify-center gap-3">
              {signedIn && (
                <button
                  type="button"
                  onClick={resend}
                  disabled={resent === 'sending' || resent === 'sent'}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  {resent === 'sent' ? 'New link sent' : 'Send a new link'}
                </button>
              )}
              <button
                type="button"
                onClick={() => navigate('/', { replace: true })}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                Continue
              </button>
            </div>
            {resent === 'failed' && (
              <p className="mt-3 text-xs text-red-600">
                Couldn’t send a new link. Try again later.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
