import { useEffect, useState } from 'react';
import { apiResendVerification } from '../../services/api';
import { serverSendsEmail } from '../../services/serverConfig';
import { useAuthStore } from '../../stores/authStore';

/**
 * Until the account confirms its email, invitations to that address wait —
 * say so, and offer to send the link again. A server that sends no email
 * (some self-hosted ones) can't: opening an invite link confirms it instead.
 */
export default function ConfirmEmailBanner() {
  const user = useAuthStore((s) => s.user);
  const [resent, setResent] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  const unconfirmed = !!user && user.emailVerified === false;
  const [mail, setMail] = useState<boolean | null>(null);
  useEffect(() => {
    if (!unconfirmed) return;
    let live = true;
    void serverSendsEmail().then((m) => live && setMail(m));
    return () => {
      live = false;
    };
  }, [unconfirmed]);
  if (!user || !unconfirmed || mail === null) return null;

  if (!mail) {
    return (
      <div
        className="border-b border-amber-200 bg-amber-50"
        role="status"
        data-testid="confirm-email-banner"
      >
        <div className="mx-auto max-w-7xl px-4 py-2 text-sm text-amber-900 sm:px-6 lg:px-8">
          Your email isn’t confirmed, and this server doesn’t send email: when someone shares a
          project or workspace with <strong>{user.email}</strong>, ask them for the invite link.
          Opening it confirms your address and adds you.
        </div>
      </div>
    );
  }

  const resend = () => {
    setResent('sending');
    apiResendVerification()
      .then(({ sent, verified }) => {
        if (verified) useAuthStore.setState({ user: { ...user, emailVerified: true } });
        else setResent(sent ? 'sent' : 'failed');
      })
      .catch(() => setResent('failed'));
  };

  return (
    <div
      className="border-b border-amber-200 bg-amber-50"
      role="status"
      data-testid="confirm-email-banner"
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-sm text-amber-900 sm:px-6 lg:px-8">
        <span>
          Confirm your email: we sent a link to <strong>{user.email}</strong>. Projects and
          workspaces shared with this address will appear once you do. An account that isn’t
          confirmed within 30 days, and has nothing in it, is removed.
        </span>
        {resent === 'sent' ? (
          <span className="text-amber-700">Sent. Check your inbox.</span>
        ) : (
          <button
            type="button"
            onClick={resend}
            disabled={resent === 'sending'}
            className="font-medium text-amber-900 underline underline-offset-2 hover:text-amber-700 disabled:opacity-60"
          >
            {resent === 'failed' ? 'Couldn’t send. Try again' : 'Send it again'}
          </button>
        )}
      </div>
    </div>
  );
}
