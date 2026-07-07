/**
 * Pure state-derivation tests for the workflow shell state machine.
 *
 * These tests are the regression guard for `deriveStageState` and
 * `toErrorEnvelope`. They run via Vitest (deferred to the user's
 * local env) and are also exercised by a Node-side script in CI.
 */

import { describe, expect, it } from 'vitest';

import {
  deriveStageState,
  isErrorEnvelope,
  toErrorEnvelope,
  type ErrorEnvelope,
} from '@/lib/workflow-shell/states';

describe('deriveStageState', () => {
  it('returns loading when isLoading is true', () => {
    expect(
      deriveStageState({ isLoading: true, isError: false, isSuccess: false }),
    ).toBe('loading');
  });

  it('returns error when isError is true (overrides loading)', () => {
    expect(
      deriveStageState({ isLoading: true, isError: true, isSuccess: false }),
    ).toBe('error');
  });

  it('returns live when isSuccess is true and no degradation flags', () => {
    expect(
      deriveStageState({ isLoading: false, isError: false, isSuccess: true }),
    ).toBe('live');
  });

  it('returns cached when isCached is true', () => {
    expect(
      deriveStageState({
        isLoading: false,
        isError: false,
        isSuccess: true,
        isCached: true,
      }),
    ).toBe('cached');
  });

  it('returns demo when isDemo is true', () => {
    expect(
      deriveStageState({
        isLoading: false,
        isError: false,
        isSuccess: true,
        isDemo: true,
      }),
    ).toBe('demo');
  });

  it('returns loading when no flag is set (initial state)', () => {
    expect(deriveStageState({ isLoading: false, isError: false })).toBe(
      'loading',
    );
  });
});

describe('isErrorEnvelope', () => {
  const valid: ErrorEnvelope = {
    error: 'PASS_THROUGH_DISABLED',
    message: 'Disabled in this environment',
    details: {},
    occurred_at: '2026-07-07T12:00:00+00:00',
  };

  it('accepts a valid envelope', () => {
    expect(isErrorEnvelope(valid)).toBe(true);
  });

  it('rejects a missing fields', () => {
    expect(
      isErrorEnvelope({ error: 'X', message: 'Y', details: {}, occurred_at: 'Z' }),
    ).toBe(true);
    expect(isErrorEnvelope({ error: 'X', message: 'Y', details: {} })).toBe(false);
    expect(isErrorEnvelope({ error: 1, message: 'Y', details: {}, occurred_at: 'Z' })).toBe(
      false,
    );
  });

  it('rejects null / undefined / primitives', () => {
    expect(isErrorEnvelope(null)).toBe(false);
    expect(isErrorEnvelope(undefined)).toBe(false);
    expect(isErrorEnvelope('string')).toBe(false);
    expect(isErrorEnvelope(42)).toBe(false);
  });
});

describe('toErrorEnvelope', () => {
  it('wraps an Error instance', () => {
    const e = new Error('boom');
    const env = toErrorEnvelope(e);
    expect(env.error).toBe('UNEXPECTED_ERROR');
    expect(env.message).toBe('boom');
    expect(env.details.name).toBe('Error');
    expect(typeof env.occurred_at).toBe('string');
  });

  it('passes through a valid envelope', () => {
    const env = toErrorEnvelope({
      error: 'X',
      message: 'Y',
      details: { a: 1 },
      occurred_at: '2026-01-01T00:00:00Z',
    });
    expect(env.error).toBe('X');
    expect(env.details).toEqual({ a: 1 });
  });

  it('unwraps envelope wrapped under .body', () => {
    const env = toErrorEnvelope({
      body: {
        error: 'X',
        message: 'Y',
        details: {},
        occurred_at: '2026-01-01T00:00:00Z',
      },
    });
    expect(env.error).toBe('X');
  });

  it('synthesizes an envelope for unknown values', () => {
    const env = toErrorEnvelope('not an error');
    expect(env.error).toBe('UNKNOWN_ERROR');
    expect(env.message).toMatch(/unexpected/i);
  });
});