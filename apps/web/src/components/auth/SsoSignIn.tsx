import { ssoStartUrl } from '../../services/api';

/** Why a sign-in with the provider came back without signing in (?sso_error=…). */
export function ssoErrorMessage(code: string | null, provider: string): string | null {
  switch (code) {
    case null:
    case '':
      return null;
    case 'denied':
      return `Signing in with ${provider} was cancelled.`;
    case 'domain':
      return 'That account isn’t allowed to sign in here. Use your work account.';
    case 'email':
      return `${provider} didn’t share a verified email address for your account.`;
    case 'state':
      return 'That sign-in expired or didn’t start here. Try again.';
    default:
      return `Signing in with ${provider} didn’t work. Try again, or ask whoever runs this server.`;
  }
}

/** "Sign in with <provider>", coming back to where you were. */
export default function SsoSignIn({ name, primary }: { name: string; primary: boolean }) {
  const go = () => {
    window.location.href = ssoStartUrl(window.location.pathname + window.location.search);
  };
  return (
    <button
      type="button"
      onClick={go}
      data-testid="sso-button"
      className={
        primary
          ? 'w-full rounded-md bg-gray-900 px-4 py-2.5 font-medium text-white hover:bg-gray-800'
          : 'w-full rounded-md border border-gray-300 bg-white px-4 py-2 font-medium text-gray-800 hover:bg-gray-50'
      }
    >
      Sign in with {name}
    </button>
  );
}
