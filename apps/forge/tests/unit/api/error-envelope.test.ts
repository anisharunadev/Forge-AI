/**
 * Sprint 3 — Crash #3 regression test.
 *
 * Contract: ApiError carries the structured envelope the backend returns
 * — stable `errorCode`, server-minted `traceId` (from `x-request-id`),
 * and a `retryable` hint. renderErrorToast turns these into a sonner
 * toast shape with the right testids so the UI can assert on them.
 */

import { describe, expect, it, vi, afterEach } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ApiError, renderErrorToast } from '@/lib/api/client';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ApiError envelope — Sprint 3 Crash #3', () => {
  it('extracts errorCode from the response body', () => {
    const err = new ApiError(500, 'boom', { code: 'INTERNAL_ERROR' }, 'INTERNAL_ERROR');
    expect(err.errorCode).toBe('INTERNAL_ERROR');
    expect(err.code).toBe('INTERNAL_ERROR');
  });

  it('extracts traceId from the x-request-id response header', () => {
    const headers = new Headers({ 'x-request-id': 'abcd1234-5678-90ab-cdef-1234567890ab' });
    const err = new ApiError(
      500,
      'boom',
      { code: 'INTERNAL_ERROR' },
      'INTERNAL_ERROR',
      headers,
      { traceId: 'abcd1234-5678-90ab-cdef-1234567890ab' },
    );
    expect(err.traceId).toBe('abcd1234-5678-90ab-cdef-1234567890ab');
  });

  it('falls back to body traceId when header is missing', () => {
    const err = new ApiError(
      500,
      'boom',
      { code: 'INTERNAL_ERROR', traceId: 'body-trace-id' },
      'INTERNAL_ERROR',
      undefined,
      { traceId: 'body-trace-id' },
    );
    expect(err.traceId).toBe('body-trace-id');
  });

  it('marks 5xx and 408/429 as retryable by default', () => {
    expect(new ApiError(500, 'x', null).retryable).toBe(true);
    expect(new ApiError(503, 'x', null).retryable).toBe(true);
    expect(new ApiError(408, 'x', null).retryable).toBe(true);
    expect(new ApiError(429, 'x', null).retryable).toBe(true);
    expect(new ApiError(0, 'x', null).retryable).toBe(true); // network error
  });

  it('does NOT mark 4xx (except 408/429) as retryable', () => {
    expect(new ApiError(400, 'x', null).retryable).toBe(false);
    expect(new ApiError(401, 'x', null).retryable).toBe(false);
    expect(new ApiError(403, 'x', null).retryable).toBe(false);
    expect(new ApiError(404, 'x', null).retryable).toBe(false);
    expect(new ApiError(422, 'x', null).retryable).toBe(false);
  });

  it('respects the server-supplied retryable override', () => {
    const err = new ApiError(400, 'x', null, undefined, undefined, { retryable: true });
    expect(err.retryable).toBe(true);
  });

  it('handles non-ApiError inputs gracefully (no throw)', () => {
    const err = renderErrorToast(new Error('plain'));
    expect(err.title).toBe('Request failed (network)');
  });
});

describe('renderErrorToast — Sprint 3 Crash #3', () => {
  it('renders the error code in the description', () => {
    const apiErr = new ApiError(500, 'boom', { code: 'INTERNAL_ERROR' }, 'INTERNAL_ERROR');
    const toast = renderErrorToast(apiErr);
    const html = renderToStaticMarkup(toast.description as React.ReactElement);
    expect(html).toContain('INTERNAL_ERROR');
    expect(html).toContain('boom');
  });

  it('renders the trace id (short form) when present', () => {
    const apiErr = new ApiError(
      500,
      'boom',
      { code: 'INTERNAL_ERROR' },
      'INTERNAL_ERROR',
      undefined,
      { traceId: 'abcd1234-5678-90ab-cdef-1234567890ab' },
    );
    const toast = renderErrorToast(apiErr);
    const html = renderToStaticMarkup(toast.description as React.ReactElement);
    expect(html).toContain('abcd1234');
  });

  it('renders a Retry action when retryable + onRetry provided', () => {
    const apiErr = new ApiError(500, 'boom', null);
    const onRetry = vi.fn();
    const toast = renderErrorToast(apiErr, { onRetry });
    expect(toast.action).toBeTruthy();
    const html = renderToStaticMarkup(toast.action as React.ReactElement);
    expect(html).toContain('Retry');
    expect(html).toContain('error-toast-retry');
  });

  it('omits the Retry action for non-retryable errors even with onRetry', () => {
    const apiErr = new ApiError(400, 'bad', null);
    const onRetry = vi.fn();
    const toast = renderErrorToast(apiErr, { onRetry });
    expect(toast.action).toBeUndefined();
  });

  it('uses the caller-provided title override', () => {
    const apiErr = new ApiError(500, 'boom', null);
    const toast = renderErrorToast(apiErr, { title: 'Failed to load connectors' });
    expect(toast.title).toBe('Failed to load connectors');
  });
});
