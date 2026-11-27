import React from 'react';
import { reportError } from '../../observability';

interface State {
  error: Error | null;
  reportId?: string;
}

/**
 * If rendering crashes, show a way out instead of a blank page. Local edits
 * are in the offline journal, so reloading doesn't lose them.
 */
export default class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('MavisDraw crashed:', error, info.componentStack);
    this.setState({ reportId: reportError(error, { componentStack: info.componentStack }) });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        role="alert"
        className="flex min-h-screen items-center justify-center bg-gray-50 p-6"
        data-testid="crash-screen"
      >
        <div className="max-w-md rounded-xl border border-gray-200 bg-white p-6 text-center shadow-sm">
          <h1 className="mb-2 text-lg font-semibold text-gray-900">Something went wrong</h1>
          <p className="mb-4 text-sm text-gray-600">
            MavisDraw hit an unexpected error. Your recent edits are kept in this browser —
            reloading brings them back.
          </p>
          <button
            type="button"
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
          {this.state.reportId && (
            <p className="mt-3 text-xs text-gray-400">Reference: {this.state.reportId}</p>
          )}
        </div>
      </div>
    );
  }
}

/** Dev/test only: `window.dispatchEvent(new Event('mavisdraw:test-crash'))` crashes the tree. */
export function CrashTrigger() {
  const [crash, setCrash] = React.useState(false);
  React.useEffect(() => {
    const onCrash = () => setCrash(true);
    window.addEventListener('mavisdraw:test-crash', onCrash);
    return () => window.removeEventListener('mavisdraw:test-crash', onCrash);
  }, []);
  if (crash) throw new Error('Test crash');
  return null;
}
