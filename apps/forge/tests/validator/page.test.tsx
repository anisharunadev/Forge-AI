/**
 * FORA-620 — render tests for the Validator list page.
 *
 * Covers:
 *   - Page renders header + project selector.
 *   - PASS / FAIL banners are visible when reports are loaded.
 *   - Loading / error / empty states all render typed messages.
 *
 * The page is a Client Component driven by TanStack Query. To keep
 * the test deterministic we mock `useValidationReports` and feed it
 * a fixed list of reports covering all four status tones (pass /
 * fail / running / error).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';

import type { ValidationReport } from '../../lib/api';

// ---- mock the hook ----
const useValidationReportsMock = vi.fn();

vi.mock('../../lib/hooks/useValidationReports', () => ({
  useValidationReports: (projectId: string) =>
    useValidationReportsMock(projectId),
}));

import ValidatorListPage from '../../app/validator/page';

function report(overrides: Partial<ValidationReport>): ValidationReport {
  return {
    reportId: overrides.reportId ?? 'report-default',
    projectId: 'demo-project-001',
    tenantId: 'tenant-acme',
    status: 'pass',
    startedAt: '2026-06-22T10:00:00Z',
    finishedAt: '2026-06-22T10:01:00Z',
    summary: {
      total: 0,
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      passed: 0,
    },
    findings: [],
    ...overrides,
  };
}

function setupQuery(opts: {
  data?: ReadonlyArray<ValidationReport>;
  isLoading?: boolean;
  isError?: boolean;
  error?: Error | null;
}) {
  useValidationReportsMock.mockReturnValue({
    data: opts.data ?? [],
    isLoading: opts.isLoading ?? false,
    isError: opts.isError ?? false,
    error: opts.error ?? null,
    refetch: vi.fn(),
    isFetching: false,
  });
}

describe('<ValidatorListPage />', () => {
  beforeEach(() => {
    useValidationReportsMock.mockReset();
  });

  it('renders the page header and project input', () => {
    setupQuery({ data: [] });
    render(<ValidatorListPage />);
    expect(screen.getByTestId('validator-list-page')).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: /Code Validator/i }),
    ).toBeTruthy();
    expect(screen.getByTestId('validator-project-input')).toBeTruthy();
  });

  it('renders an empty state when there are no reports', () => {
    setupQuery({ data: [] });
    render(<ValidatorListPage />);
    const empty = screen.getByTestId('validator-empty');
    expect(empty.textContent).toMatch(/No reports yet/i);
  });

  it('renders a PASS banner for a passing report', () => {
    setupQuery({
      data: [report({ reportId: 'r-pass', status: 'pass' })],
    });
    render(<ValidatorListPage />);
    const grid = screen.getByTestId('validator-grid');
    const banner = within(grid).getByTestId('validation-report-banner');
    expect(banner.getAttribute('data-status')).toBe('pass');
    expect(banner.textContent).toMatch(/PASS/);
  });

  it('renders a FAIL banner for a failing report', () => {
    setupQuery({
      data: [
        report({
          reportId: 'r-fail',
          status: 'fail',
          summary: {
            total: 2,
            critical: 1,
            high: 1,
            medium: 0,
            low: 0,
            passed: 0,
          },
        }),
      ],
    });
    render(<ValidatorListPage />);
    const grid = screen.getByTestId('validator-grid');
    const banner = within(grid).getByTestId('validation-report-banner');
    expect(banner.getAttribute('data-status')).toBe('fail');
    expect(banner.textContent).toMatch(/FAIL/);
  });

  it('renders severity summary chips with the correct counts', () => {
    setupQuery({
      data: [
        report({
          reportId: 'r-mixed',
          status: 'fail',
          summary: {
            total: 7,
            critical: 1,
            high: 2,
            medium: 3,
            low: 1,
            passed: 0,
          },
        }),
      ],
    });
    render(<ValidatorListPage />);
    const card = screen.getByTestId('validation-report-card');
    expect(within(card).getByTestId('summary-critical').textContent).toBe('1');
    expect(within(card).getByTestId('summary-high').textContent).toBe('2');
    expect(within(card).getByTestId('summary-medium').textContent).toBe('3');
    expect(within(card).getByTestId('summary-low').textContent).toBe('1');
    expect(within(card).getByTestId('summary-total').textContent).toBe('7');
  });

  it('renders the loading state when the query is loading', () => {
    setupQuery({ isLoading: true });
    render(<ValidatorListPage />);
    expect(screen.getByTestId('validator-loading')).toBeTruthy();
  });

  it('renders the error state when the query has errored', () => {
    setupQuery({ isError: true, error: new Error('boom') });
    render(<ValidatorListPage />);
    const errorBox = screen.getByTestId('validator-error');
    expect(errorBox.textContent).toMatch(/boom/);
  });

  it('renders an Open link to the per-report detail page', () => {
    setupQuery({
      data: [report({ reportId: 'r-link' })],
    });
    render(<ValidatorListPage />);
    const link = screen.getByTestId('report-open');
    expect(link.getAttribute('href')).toBe('/validator/r-link');
  });
});