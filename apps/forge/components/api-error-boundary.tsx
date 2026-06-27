'use client';

/**
 * ApiErrorBoundary — Zone 9 (step-52).
 *
 * Catches uncaught render-time errors inside the workspace tree and
 * renders a friendly recovery surface. Catches thrown Errors from:
 *
 *   - React render lifecycle (lifecycle / effect bugs)
 *   - TanStack Query error boundaries (when used with `<ErrorBoundary>`)
 *   - Suspense fallbacks (when `use()` throws)
 *
 * What it does NOT catch:
 *   - Errors thrown inside event handlers (use toast.error from there).
 *   - Errors thrown inside async callbacks not awaited during render.
 *
 * For network errors specifically, the API client (Zone 1) already
 * converts them into typed `ApiError` instances. Handlers in event
 * callbacks should `toast.error(...)` directly. This boundary is the
 * last line of defence when something escapes those handlers.
 *
 * Skills applied (UX):
 *   - "Catch errors globally" — the boundary mounts once at the shell
 *     level so the whole app gets the same recovery surface.
 *   - Accessibility — the alert region announces the failure to
 *     screen readers.
 *   - Recovery action (`Reload`) restores the workspace without
 *     forcing a logout.
 */

import * as React from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api/client';

interface ApiErrorBoundaryProps {
  children: React.ReactNode;
  /** Optional override for the boundary title. */
  title?: string;
}

interface ApiErrorBoundaryState {
  error: Error | null;
}

export class ApiErrorBoundary extends React.Component<
  ApiErrorBoundaryProps,
  ApiErrorBoundaryState
> {
  state: ApiErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ApiErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // In production this would forward to Sentry / Datadog. For now we
    // log to the console so the dev tools still see the stack trace.
    // The intent is documented in the goal file's "Error reporting"
    // bullet ("Sentry or similar (optional)").
    // eslint-disable-next-line no-console
    console.error('[ApiErrorBoundary]', error, info);
  }

  reset = () => {
    this.setState({ error: null });
  };

  reload = () => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const isApiError = error instanceof ApiError;
    const title = this.props.title ?? (
      isApiError
        ? error.status === 0
          ? 'Network error'
          : error.status >= 500
            ? 'Server error'
            : 'Something went wrong'
        : 'Unexpected error'
    );
    const detail =
      isApiError && error.status === 0
        ? 'We can\'t reach the server right now. Check your connection and try again.'
        : error.message;

    return (
      <div
        role="alert"
        aria-live="assertive"
        className="flex min-h-[60vh] items-center justify-center px-6 py-10"
        data-testid="api-error-boundary"
      >
        <div className="w-full max-w-md rounded-[var(--radius-xl)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-8 text-center shadow-[var(--shadow-md)]">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--accent-rose)]/10 text-[var(--accent-rose)]">
            <AlertTriangle className="h-6 w-6" aria-hidden="true" />
          </div>
          <h2 className="text-lg font-semibold text-[var(--fg-primary)]">
            {title}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-[var(--fg-tertiary)]">
            {detail}
          </p>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button
              variant="outline"
              onClick={this.reset}
              data-testid="api-error-boundary-retry"
              className="h-10 border-[var(--border-default)]"
            >
              Try again
            </Button>
            <Button
              onClick={this.reload}
              data-testid="api-error-boundary-reload"
              className="h-10 bg-[var(--accent-primary)] text-white hover:bg-[var(--accent-primary)]/90"
            >
              <RotateCw className="h-4 w-4" aria-hidden="true" />
              Reload page
            </Button>
          </div>
        </div>
      </div>
    );
  }
}