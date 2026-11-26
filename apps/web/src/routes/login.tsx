import React, { useState } from 'react';
import LoginForm from '../components/auth/LoginForm';
import SignupForm from '../components/auth/SignupForm';
import type { InviteInfo } from '../services/api';

export default function LoginPage({
  sharedLink = false,
  invite = null,
}: {
  sharedLink?: boolean;
  /** Arrived through an email invitation (shown so people know where they're going). */
  invite?: InviteInfo | null;
}) {
  // An invitation usually means a new account
  const [mode, setMode] = useState<'login' | 'signup'>(invite ? 'signup' : 'login');

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

      {mode === 'login' ? (
        <LoginForm onSwitchToSignup={() => setMode('signup')} />
      ) : (
        <SignupForm onSwitchToLogin={() => setMode('login')} />
      )}
    </div>
  );
}
