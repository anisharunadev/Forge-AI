'use client';

/**
 * api-toast — Zone 9 (step-52).
 *
 * Thin wrapper around Sonner that:
 *
 *   - Maps `ApiError` → a context-aware toast (network / 4xx / 5xx).
 *   - Provides a "Network error — retrying…" promise-based toast that
 *     resolves to a success/failure toast. Used by mutations that need
 *     to surface optimistic loading state.
 *
 * Why a wrapper and not direct `toast.error(err)` calls everywhere?
 *   1. Centralizes the "what does an API error look like to the user"
 *      decision in one place — every component inherits the same UX.
 *   2. Keeps the type narrowing in one place so callers don't need to
 *      import `ApiError` everywhere.
 *   3. Lets us swap the underlying toast library later without
 *      touching every component.
 *
 * Skill rules applied (UX):
 *   - toast.success / toast.error semantic variants
 *     (UX skill "Use toast variants").
 *
 * Implementation note: this project pins `sonner@1.7.4` which exposes
 * only `success` / `error` / `info` (no `loading`, no `promise`, no
 * `dismiss`). The helpers below degrade gracefully — they emit a
 * success or error toast directly, and `toastApiPromise` shows the
 * error via `toastApiError` so the user sees the rich API-error copy
 * regardless of what the caller passes in.
 */

import { toast } from 'sonner';

import { ApiError } from '@/lib/api/client';

export interface ApiToastOptions {
  /** Friendly prefix (e.g. "Couldn't save changes"). Defaults to a
   *  status-derived string. */
  title?: string;
  /** Suppress the toast entirely (useful for silent background calls). */
  silent?: boolean;
  /** Override the description. */
  description?: string;
}

interface ToastDescriptor {
  title: string;
  description?: string;
}

function describe(err: unknown, opts: ApiToastOptions): ToastDescriptor {
  if (err instanceof ApiError) {
    if (err.status === 0) {
      return {
        title: opts.title ?? 'Network error',
        description: opts.description ?? 'Check your connection and try again.',
      };
    }
    if (err.status === 401) {
      return {
        title: opts.title ?? 'Session expired',
        description: opts.description ?? 'Please sign in again.',
      };
    }
    if (err.status >= 500) {
      return {
        title: opts.title ?? 'Server error',
        description:
          opts.description ??
          'The server hit an unexpected error. We\'ve been notified.',
      };
    }
    if (err.status === 429) {
      return {
        title: opts.title ?? 'Too many requests',
        description: opts.description ?? 'Slow down a moment, then try again.',
      };
    }
    return {
      title: opts.title ?? 'Request failed',
      description: opts.description ?? err.message,
    };
  }
  return {
    title: opts.title ?? 'Unexpected error',
    description:
      opts.description ??
      (err instanceof Error ? err.message : 'Something went wrong.'),
  };
}

/** Show a toast describing the given error. */
export function toastApiError(err: unknown, opts: ApiToastOptions = {}): void {
  if (opts.silent) return;
  const d = describe(err, opts);
  toast.error(d.title, { description: d.description });
}

/**
 * Promise-shaped helper. Resolves with the original value on success
 * (emitting a success toast), or re-throws the error after emitting
 * an error toast. Note: this version of Sonner can't render a
 * long-lived "loading…" toast, so the caller should add a button-level
 * spinner for the in-flight state.
 */
export async function toastApiPromise<T>(
  promise: Promise<T>,
  options: {
    success?: string | ((data: T) => string);
    error?: string | ((err: unknown) => string);
  },
): Promise<T> {
  try {
    const data = await promise;
    toast.success(
      typeof options.success === 'function'
        ? options.success(data)
        : (options.success ?? 'Done'),
    );
    return data;
  } catch (err) {
    // Surface the rich API-error copy first…
    toastApiError(err);
    // …then the short label the caller asked for, so screen-reader
    // users still hear the high-level outcome.
    const label =
      typeof options.error === 'function'
        ? options.error(err)
        : (options.error ?? 'Failed');
    toast.error(label);
    throw err;
  }
}

/** Convenience for "we're retrying…" flows. */
export async function toastRetry<T>(
  attempt: () => Promise<T>,
  options: { success?: string; failure?: string },
): Promise<T> {
  return toastApiPromise(attempt(), {
    success: options.success ?? 'Reconnected',
    error: options.failure ?? 'Still offline',
  });
}