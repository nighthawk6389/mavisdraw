import { useEffect, useState } from 'react';
import { apiForgotPassword } from '../../services/api';
import { serverSendsEmail } from '../../services/serverConfig';

/** Ask for a reset link by email (or, on a server without email, who to ask). */
export default function ForgotPasswordForm({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  const [mail, setMail] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void serverSendsEmail().then((m) => live && setMail(m));
    return () => {
      live = false;
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState('sending');
    try {
      await apiForgotPassword(email);
      setState('sent');
    } catch {
      setState('failed');
    }
  };

  return (
    <div className="mx-auto w-full max-w-md">
      <div className="rounded-lg bg-white p-8 shadow-lg" data-testid="forgot-password">
        <h2 className="mb-2 text-center text-2xl font-bold text-gray-900">Reset your password</h2>
        {mail === false ? (
          <p className="mt-4 text-sm text-gray-700">
            This server doesn’t send email. Ask whoever runs it for a reset link: they can make one
            for your address.
          </p>
        ) : state === 'sent' ? (
          <p role="status" className="mt-4 text-sm text-gray-700">
            If there’s an account for <strong>{email}</strong>, we’ve emailed it a link to choose a
            new password. It works once, for an hour.
          </p>
        ) : (
          <form onSubmit={submit} className="mt-4 space-y-4">
            <p className="text-sm text-gray-600">
              We’ll email you a link to choose a new password.
            </p>
            <div>
              <label
                htmlFor="forgot-email"
                className="mb-1 block text-sm font-medium text-gray-700"
              >
                Email
              </label>
              <input
                id="forgot-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="you@example.com"
              />
            </div>
            {state === 'failed' && (
              <p role="alert" className="text-sm text-red-600">
                Couldn’t send it. Try again in a moment.
              </p>
            )}
            <button
              type="submit"
              disabled={state === 'sending'}
              className="w-full rounded-md bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {state === 'sending' ? 'Sending…' : 'Email me a reset link'}
            </button>
          </form>
        )}
        <p className="mt-4 text-center text-sm text-gray-600">
          <button type="button" className="text-blue-600 hover:underline" onClick={onBack}>
            Back to sign in
          </button>
        </p>
      </div>
    </div>
  );
}
