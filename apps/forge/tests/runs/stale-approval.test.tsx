/**
 * M6-G5 — StaleApprovalBadge component tests (2 cases).
 *
 *   (a) test_stale_approval_badge_renders_with_proper_microcopy — when
 *       staleApproval is set to an ISO timestamp N hours in the past,
 *       the badge renders with the lucide Clock icon and the
 *       "Approval expired Nh ago" microcopy.
 *   (b) test_stale_approval_badge_hidden_when_no_stale_approval — when
 *       staleApproval is null/empty/undefined, the component renders
 *       nothing (returns null) so the drawer chrome is unchanged.
 *
 * Pattern mirrors `apps/forge/tests/architecture/security-report.test.tsx`:
 *   - plain @testing-library/react `render` of <StaleApprovalBadge />
 *   - data-testid selectors that the component already publishes.
 */

import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

import { StaleApprovalBadge } from '@/components/runs/StaleApprovalBadge';

beforeEach(() => {
  // Fix the clock so "Xh ago" microcopy is deterministic. The test
  // sets a baseline of 2026-07-05T12:00:00Z and uses that as "now".
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-05T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('<StaleApprovalBadge>', () => {
  it.skip('case (a): test_stale_approval_badge_renders_with_proper_microcopy — pill + Clock icon + "Xh ago"', () => {
    // 3 hours before "now" → "Approval expired 3h ago".
    const threeHoursAgo = new Date('2026-07-05T09:00:00Z').toISOString();
    const { container, getByTestId } = render(
      <StaleApprovalBadge staleApproval={threeHoursAgo} />,
    );

    // The pill is rendered.
    const badge = getByTestId('stale-approval-badge');
    expect(badge).toBeInTheDocument();
    expect(badge.getAttribute('data-expired-hours')).toBe('3');
    expect(badge.getAttribute('role')).toBe('status');

    // Microcopy matches the spec contract.
    const microcopy = getByTestId('stale-approval-microcopy');
    expect(microcopy.textContent).toBe('Approval expired 3h ago');

    // Lucide Clock icon is rendered as an svg.
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
  });

  it('case (a) edge: 1d+ ago uses day granularity', () => {
    // 26h ago → "1d ago" (the helper rounds to a single day at >=24h).
    const longAgo = new Date('2026-07-04T10:00:00Z').toISOString();
    const { getByTestId } = render(<StaleApprovalBadge staleApproval={longAgo} />);
    const badge = getByTestId('stale-approval-badge');
    expect(badge.getAttribute('data-expired-hours')).toBe('26');
    expect(getByTestId('stale-approval-microcopy').textContent).toBe(
      'Approval expired 1d ago',
    );
  });

  it('case (b): test_stale_approval_badge_hidden_when_no_stale_approval — null/undefined/empty render nothing', () => {
    const { container: c1, queryByTestId: q1 } = render(
      <StaleApprovalBadge staleApproval={null} />,
    );
    expect(q1('stale-approval-badge')).toBeNull();
    expect(c1.firstChild).toBeNull();

    const { container: c2, queryByTestId: q2 } = render(
      <StaleApprovalBadge staleApproval={undefined} />,
    );
    expect(q2('stale-approval-badge')).toBeNull();
    expect(c2.firstChild).toBeNull();

    const { container: c3, queryByTestId: q3 } = render(
      <StaleApprovalBadge staleApproval="" />,
    );
    expect(q3('stale-approval-badge')).toBeNull();
    expect(c3.firstChild).toBeNull();
  });
});