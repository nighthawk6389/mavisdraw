import React, { useEffect, useState } from 'react';
import LoginForm from '../components/auth/LoginForm';
import SignupForm from '../components/auth/SignupForm';
import ForgotPasswordForm from '../components/auth/ForgotPasswordForm';
import SsoSignIn, { ssoErrorMessage } from '../components/auth/SsoSignIn';
import { getServerConfig } from '../services/serverConfig';
import type { InviteInfo, ServerConfig } from '../services/api';

/** ?sso_error=… from a sign-in with the provider that didn't go through (read once). */
function takeSsoError(): string | null {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('sso_error');
  if (code) {
    params.delete('sso_error');
    const rest = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : ''));
  }
  return code;
}

export default function LoginPage({
  sharedLink = false,
  invite = null,
}: {
  sharedLink?: boolean;
  /** Arrived through an email invitation (shown so people know where they're going). */
  invite?: InviteInfo | null;
}) {
  // An invitation usually means a new account
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot'>(invite ? 'signup' : 'login');
  const [server, setServer] = useState<ServerConfig | null>(null);
  const [ssoError] = useState(takeSsoError);
  useEffect(() => {
    let live = true;
    void getServerConfig().then((c) => live && setServer(c));
    return () => {
      live = false;
    };
  }, []);
  const sso = server?.sso ?? null;
  const passwords = server?.passwordLogin ?? true;
  const ssoProblem = ssoErrorMessage(ssoError, sso?.name ?? 'single sign-on');

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex flex-col items-center justify-center p-4">
      <div className="mb-8 text-center">
        <h1 className="text-4xl font-bold text-gray-900 mb-2">MavisDraw</h1>
        <p className="text-gray-600">Collaborative diagramming with nested drill-down support</p>
      </div>

      {invite && (
        <p
          role="status"
          data-testid="invite-banner"
          className="mb-4 max-w-md rounded-md border border-blue-200 bg-white px-4 py-2 text-center text-sm text-blue-800"
        >
          {invite.invitedBy ?? 'Someone'} invited you to the {invite.kind}{' '}
          <span className="font-semibold">{invite.targetName}</span>. Sign up or sign in with{' '}
          <span className="font-mono">{invite.email}</span> to join.
        </p>
      )}

      {sharedLink && (
        <p
          role="status"
          className="mb-4 max-w-md rounded-md border border-blue-200 bg-white px-4 py-2 text-center text-sm text-blue-800"
        >
          Someone shared a diagram with you. Sign in or create an account to open it.
        </p>
      )}

      {ssoProblem && (
        <p
          role="alert"
          data-testid="sso-error"
          className="mb-4 max-w-md rounded-md border border-red-200 bg-white px-4 py-2 text-center text-sm text-red-700"
        >
          {ssoProblem}
        </p>
      )}

      {sso && (
        <div className="mb-4 w-full max-w-md">
          <SsoSignIn name={sso.name} primary={!passwords} />
          {passwords && (
            <p className="mt-3 text-center text-xs uppercase tracking-wide text-gray-400">
              or with your email
            </p>
          )}
        </div>
      )}

      {!passwords ? null : mode === 'login' ? (
        <LoginForm
          onSwitchToSignup={() => setMode('signup')}
          onForgotPassword={() => setMode('forgot')}
        />
      ) : mode === 'forgot' ? (
        <ForgotPasswordForm onBack={() => setMode('login')} />
      ) : (
        <SignupForm onSwitchToLogin={() => setMode('login')} />
      )}
    </div>
  );
}
