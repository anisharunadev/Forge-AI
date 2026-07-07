/**
 * InternalErrorBoundary — a class-component error boundary that
 * renders the typed INTERNAL_ERROR envelope on uncaught errors.
 *
 * Why a class component? React error boundaries MUST be class
 * components as of React 18. Functional alternatives (`react-error-
 * boundary`) are deliberately not used here — the workflow shell's
 * contract is that errors always render the typed envelope, and
 * owning the boundary directly is the simplest way to guarantee it.
 *
 * What it catches:
 *   - Uncaught errors during render
 *   - Uncaught errors inside effects (via React's componentDidCatch
 *     signal)
 *
 * What it does NOT catch:
 *   - Errors in event handlers (use `toast.error` from there)
 *   - Errors in async callbacks not awaited during render
 *
 * On error: convert the thrown value into an `ErrorEnvelope` via
 * `toErrorEnvelope` and render `StageErrorFallback`. The error is
 * also logged via `console.error` so the dev tools see the stack.
 */

'use client';

import * as React from 'react';

import { StageErrorFallback } from './StageErrorFallback';
import { toErrorEnvelope, type ErrorEnvelope } from '@/lib/workflow-shell/states';

interface InternalErrorBoundaryProps {
  readonly children: React.ReactNode;
  readonly fallbackTitle?: string;
}

interface InternalErrorBoundaryState {
  readonly error: ErrorEnvelope | null;
}

export class InternalErrorBoundary extends React.Component<
  InternalErrorBoundaryProps,
  InternalErrorBoundaryState
> {
  state: InternalErrorBoundaryState = { error: null };

  static getDerivedStateFromError(value: unknown): InternalErrorBoundaryState {
    return { error: toErrorEnvelope(value) };
  }

  componentDidCatch(value: unknown, info: React.ErrorInfo): void {
    if (typeof console !== 'undefined') {
      // eslint-disable-next-line no-console
      console.error('[InternalErrorBoundary]', value, info);
    }
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): React.ReactNode {
    const { error } = this.state;
    if (error) {
      return <StageErrorFallback envelope={error} />;
    }
    return this.props.children;
  }
}