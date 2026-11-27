import { useState } from 'react';
import { apiResetPassword, ApiError } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { toast } from '../stores/toastStore';
import { navigate } from '../routing';

/** Read once: the token leaves the address bar as soon as the page opens. */
function takeToken(): string | null {
  const token = new URLSearchParams(window.location.search).get('token');
  window.history.replaceState(null, '', '/reset-password');
  return token;
}

/**
 * /reset-password?token=… — the link from the reset email. Setting the new
 * password signs out every session of the account and signs this browser in.
 */
export default function ResetPasswordPage() {
  const [token] = useState(takeToken);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(
    token ? null : 'This reset link is broken. Ask for a new one.',
  );
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    if (password.length < 8) return setError('Choose a password of at least 8 characters.');
    if (password !== confirm) return setError('The two passwords don’t match.');
    setSaving(true);
    setError(null);
    try {
      const response = await apiResetPassword(token, password);
      useAuthStore.getState().signedIn(response);
      toast('Password changed. Every other session was signed out.', 'success');
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Couldn’t reset the password. Try again.');
      setSaving(false);
    }
  };

  const field =
    'w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500';

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div
        className="w-full max-w-md rounded-lg bg-white p-8 shadow-lg"
        data-testid="reset-password"
      >
        <h1 className="mb-6 text-center text-2xl font-bold text-gray-900">Choose a new password</h1>
        {error && (
          <div
            role="alert"
            className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
          >
            {error}
          </div>
        )}
        {token ? (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label
                htmlFor="new-password"
                className="mb-1 block text-sm font-medium text-gray-700"
              >
                New password
              </label>
              <input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                className={field}
                placeholder="At least 8 characters"
              />
            </div>
            <div>
              <label
                htmlFor="confirm-password"
                className="mb-1 block text-sm font-medium text-gray-700"
              >
                Confirm it
              </label>
              <input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                className={field}
                placeholder="The same again"
              />
            </div>
            <button
              type="submit"
              disabled={saving}
              className="w-full rounded-md bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Set password and sign in'}
            </button>
          </form>
        ) : null}
        <p className="mt-4 text-center text-sm text-gray-600">
          <button
            type="button"
            className="text-blue-600 hover:underline"
            onClick={() => navigate('/', { replace: true })}
          >
            Back to sign in
          </button>
        </p>
      </div>
    </div>
  );
}
