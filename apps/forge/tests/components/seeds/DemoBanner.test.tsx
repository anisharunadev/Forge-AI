/**
 * DemoBanner — render tests (Plan G commit 2).
 *
 * Covers:
 *   AC1 — Renders when seed is applied with row counts.
 *   AC2 — Renders zero artifacts gracefully when applied but no rows.
 *   AC3 — Renders "drift detected" copy when checksum_match=false.
 *   AC4 — Renders nothing when the seed has not been applied.
 *   AC5 — Has role="status" and aria-live="polite" for OQ-16.
 *
 * The hook is stubbed via `vi.mock('@/lib/hooks/useSeeds')` so the
 * tests don't need a QueryClientProvider wrapper.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import { DemoBanner } from '../../../components/seeds/DemoBanner';
import type { SeedStatusRead } from '../../../lib/seeds/types';

const mockUseSeedStatus = vi.fn();

vi.mock('../../../lib/hooks/useSeeds', () => ({
  useSeedStatus: (...args: unknown[]) => mockUseSeedStatus(...args),
  seedKeys: { all: ['seeds'] },
}));

function statusFixture(overrides: Partial<SeedStatusRead> = {}): SeedStatusRead {
  return {
    seed_name: 'acme-corp',
    applied: true,
    applied_version: 1,
    last_run_at: '2026-06-24T12:00:00Z',
    last_run_status: 'completed',
    checksum: 'sha256:abcd',
    checksum_match: true,
    drift: 'none',
    row_counts: { tenants: 1, users: 50, adrs: 12 },
    production_safe: true,
    ...overrides,
  };
}

describe('<DemoBanner>', () => {
  beforeEach(() => {
    mockUseSeedStatus.mockReset();
  });

  it('renders when the seed is applied with row counts', () => {
    mockUseSeedStatus.mockReturnValue({
      data: statusFixture({
        row_counts: { tenants: 1, users: 50, adrs: 12 },
      }),
      error: null,
      isLoading: false,
    });

    render(<DemoBanner />);

    const banner = screen.getByTestId('demo-banner');
    expect(banner).toBeTruthy();

    // 1 + 50 + 12 = 63
    expect(screen.getByTestId('demo-banner-row-count').textContent).toBe('63');
    expect(screen.getByTestId('demo-banner-checksum').textContent).toBe(
      'verified',
    );
    expect(screen.getByTestId('demo-banner-checksum').getAttribute('data-state')).toBe(
      'match',
    );
    expect(screen.getByTestId('demo-banner-message').textContent).toMatch(
      /Acme Corp Demo Tenant/,
    );
  });

  it('renders zero artifacts gracefully when applied but no rows', () => {
    mockUseSeedStatus.mockReturnValue({
      data: statusFixture({ row_counts: {} }),
      error: null,
      isLoading: false,
    });

    render(<DemoBanner />);

    expect(screen.getByTestId('demo-banner')).toBeTruthy();
    expect(screen.getByTestId('demo-banner-row-count').textContent).toBe('0');
    expect(screen.getByTestId('demo-banner-checksum').textContent).toBe(
      'verified',
    );
  });

  it('renders "drift detected" copy when checksum_match is false', () => {
    mockUseSeedStatus.mockReturnValue({
      data: statusFixture({
        checksum_match: false,
        drift: 'checksum',
        row_counts: { tenants: 1, adrs: 12 },
      }),
      error: null,
      isLoading: false,
    });

    render(<DemoBanner />);

    const checksum = screen.getByTestId('demo-banner-checksum');
    expect(checksum.textContent).toBe('drift detected');
    expect(checksum.getAttribute('data-state')).toBe('drift');
  });

  it('does not render when the seed is not applied', () => {
    mockUseSeedStatus.mockReturnValue({
      data: statusFixture({ applied: false, row_counts: {} }),
      error: null,
      isLoading: false,
    });

    const { container } = render(<DemoBanner />);

    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('demo-banner')).toBeNull();
  });

  it('does not render when the hook returns no data', () => {
    mockUseSeedStatus.mockReturnValue({
      data: undefined,
      error: null,
      isLoading: false,
    });

    const { container } = render(<DemoBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('has role="status" and aria-live="polite" (OQ-16)', () => {
    mockUseSeedStatus.mockReturnValue({
      data: statusFixture({ row_counts: { tenants: 1 } }),
      error: null,
      isLoading: false,
    });

    render(<DemoBanner />);

    const banner = screen.getByTestId('demo-banner');
    expect(banner.getAttribute('role')).toBe('status');
    expect(banner.getAttribute('aria-live')).toBe('polite');
  });
});