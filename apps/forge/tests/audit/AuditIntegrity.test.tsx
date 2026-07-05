/**
 * M7-G1 — `AuditIntegrityBanner` component tests (3 cases).
 *
 *   (a) renders_OK_state_with_green_banner_when_integrity_ok_true
 *         — fixture has `integrity_ok: true`; the banner shows the
 *           "Integrity OK (head {hash[:12]}…, {length} events)"
 *           copy and carries `data-state="ok"`.
 *   (b) renders_broken_state_with_rose_banner_when_integrity_ok_false
 *         — fixture has `integrity_ok: false` + a
 *           `broken_at_event_id`; the banner shows the
 *           "⚠ Chain broken at event {id}" copy and carries
 *           `data-state="broken"`.
 *   (c) renders_loading_skeleton_when_data_undefined
 *         — the banner reports `isLoading: true` and `data: undefined`;
 *           the skeleton + spinner render and carry
 *           `data-state="loading"`.
 *
 * The banner accepts a `queryOverride` prop (test seam) so each
 * case can pin the exact query state without spinning up a real
 * QueryClientProvider or hitting the network. The override type
 * matches `ReturnType<typeof useAuditIntegrity>` so we don't have
 * to stub out every TanStack field — we only populate the ones the
 * banner reads (`data`, `isLoading`, `isError`, `error`, `refetch`,
 * `isFetching`).
 */

import * as React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { AuditIntegrityBanner } from '@/components/audit/AuditIntegrityBanner';
import type { AuditIntegrity } from '@/lib/hooks/useAudit';

// ---------------------------------------------------------------------------
// Test seam — the banner reads from `useAuditIntegrity()` internally but
// accepts an `queryOverride` prop so the tests can pin the exact state.
// `as never` keeps the field set narrow (TanStack Query returns ~30 fields
// and we only care about the half-dozen the banner reads).
// ---------------------------------------------------------------------------

type QueryShape = Parameters<
  typeof AuditIntegrityBanner
>[0] extends { queryOverride?: infer Q }
  ? Q
  : never;

function makeQuery(
  overrides: Partial<{
    data: AuditIntegrity | undefined;
    isLoading: boolean;
    isError: boolean;
    error: Error | null;
    isFetching: boolean;
  }>,
): QueryShape {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
    refetch: () => Promise.resolve({} as never),
    ...overrides,
  } as unknown as QueryShape;
}

// ---------------------------------------------------------------------------
// Fixture — matches the backend AuditIntegrityRead shape (M7-G1).
// ---------------------------------------------------------------------------

const OK_INTEGRITY: AuditIntegrity = {
  tenant_id: 'acme-corp',
  head_hash:
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  length: 1247,
  last_event_at: '2026-07-05T16:30:00Z',
  integrity_ok: true,
};

const BROKEN_INTEGRITY: AuditIntegrity = {
  tenant_id: 'acme-corp',
  head_hash:
    'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
  length: 204,
  last_event_at: '2026-07-05T15:42:11Z',
  integrity_ok: false,
  broken_at_event_id: 'evt-a3f2-9011',
};

describe('<AuditIntegrityBanner>', () => {
  // -------------------------------------------------------------------------
  // Case (a) — OK state with green/emerald banner.
  // -------------------------------------------------------------------------
  it('renders_OK_state_with_green_banner_when_integrity_ok_true', () => {
    render(
      <AuditIntegrityBanner
        queryOverride={makeQuery({ data: OK_INTEGRITY })}
      />,
    );

    const banner = screen.getByTestId('audit-integrity-banner');
    expect(banner.getAttribute('data-state')).toBe('ok');

    // Head hash is truncated to 12 chars + "…" per the spec.
    expect(banner.getAttribute('data-state')).toBe('ok');
    const message = screen.getByTestId('audit-integrity-banner-message');
    expect(message.textContent).toContain('Integrity OK');
    expect(message.textContent).toContain('head 0123456789ab…');
    expect(message.textContent).toContain('1,247 events');

    // The OK state carries the emerald tone — the marker is
    // `border-[var(--accent-emerald)]` on the section element.
    expect(banner.className).toContain('accent-emerald');
    // And it must NOT carry the rose tone (broken / error).
    expect(banner.className).not.toContain('accent-rose');
  });

  // -------------------------------------------------------------------------
  // Case (b) — broken state with rose banner.
  // -------------------------------------------------------------------------
  it('renders_broken_state_with_rose_banner_when_integrity_ok_false', () => {
    render(
      <AuditIntegrityBanner
        queryOverride={makeQuery({ data: BROKEN_INTEGRITY })}
      />,
    );

    const banner = screen.getByTestId('audit-integrity-banner');
    expect(banner.getAttribute('data-state')).toBe('broken');
    expect(banner.getAttribute('role')).toBe('alert');

    const message = screen.getByTestId('audit-integrity-banner-message');
    expect(message.textContent).toContain('⚠ Chain broken at event');
    expect(message.textContent).toContain('evt-a3f2-9011');

    // The broken state carries the rose tone.
    expect(banner.className).toContain('accent-rose');
    expect(banner.className).not.toContain('accent-emerald');
  });

  // -------------------------------------------------------------------------
  // Case (c) — loading skeleton when data is undefined.
  // -------------------------------------------------------------------------
  it('renders_loading_skeleton_when_data_undefined', () => {
    render(
      <AuditIntegrityBanner
        queryOverride={makeQuery({ data: undefined, isLoading: true })}
      />,
    );

    const banner = screen.getByTestId('audit-integrity-banner');
    expect(banner.getAttribute('data-state')).toBe('loading');
    expect(banner.getAttribute('aria-busy')).toBe('true');

    // The skeleton marker is exposed for the loading state so the
    // test can probe without coupling to the spinner className.
    expect(
      screen.getByTestId('audit-integrity-banner-skeleton'),
    ).toBeTruthy();

    // Neither message variant should render while we're loading.
    expect(
      screen.queryByTestId('audit-integrity-banner-message'),
    ).toBeNull();
  });
});