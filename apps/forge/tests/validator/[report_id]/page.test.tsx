/**
 * FORA-620 — render tests for the Validator detail page.
 *
 * Covers:
 *   - Findings table renders one row per finding.
 *   - Default sort is severity-ascending (critical first).
 *   - Toggle flips the order so the lowest-severity finding is first.
 *   - Toggling preserves severity grouping (a critical after a low in
 *     source order must still appear above the low).
 *
 * The page is a Client Component that reads `params` asynchronously;
 * we pass a pre-resolved `Promise` to skip the effect-driven resolve.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';

import type { ValidationFinding, ValidationReport } from '../../../lib/api';

// ---- mock the hook ----
const useValidationReportMock = vi.fn();

vi.mock('../../../lib/hooks/useValidationReports', () => ({
  useValidationReport: (reportId: string) =>
    useValidationReportMock(reportId),
}));

import ValidatorDetailPage from '../../../app/validator/[report_id]/page';

function finding(
  overrides: Partial<ValidationFinding>,
): ValidationFinding {
  return {
    id: overrides.id ?? 'finding-default',
    ruleId: overrides.ruleId ?? 'RULE-1',
    severity: overrides.severity ?? 'low',
    title: overrides.title ?? 'Untitled finding',
    message: overrides.message ?? '',
    location: overrides.location ?? {
      filePath: 'src/example.ts',
      line: 1,
    },
    suggestedFix: overrides.suggestedFix,
    ...overrides,
  };
}

function report(
  findings: ReadonlyArray<ValidationFinding>,
  overrides: Partial<ValidationReport> = {},
): ValidationReport {
  return {
    reportId: overrides.reportId ?? 'r-detail',
    projectId: 'demo-project-001',
    tenantId: 'tenant-acme',
    status: overrides.status ?? 'fail',
    startedAt: '2026-06-22T10:00:00Z',
    finishedAt: '2026-06-22T10:01:00Z',
    summary: overrides.summary ?? {
      total: findings.length,
      critical: findings.filter((f) => f.severity === 'critical').length,
      high: findings.filter((f) => f.severity === 'high').length,
      medium: findings.filter((f) => f.severity === 'medium').length,
      low: findings.filter((f) => f.severity === 'low').length,
      passed: 0,
    },
    findings,
    ...overrides,
  };
}

function setupQuery(opts: {
  data?: ValidationReport | null;
  isLoading?: boolean;
  isError?: boolean;
  error?: Error | null;
}) {
  useValidationReportMock.mockReturnValue({
    data: opts.data ?? null,
    isLoading: opts.isLoading ?? false,
    isError: opts.isError ?? false,
    error: opts.error ?? null,
    refetch: vi.fn(),
    isFetching: false,
  });
}

const resolvedParams = Promise.resolve({ report_id: 'r-detail' });

describe('<ValidatorDetailPage />', () => {
  beforeEach(() => {
    useValidationReportMock.mockReset();
  });

  it('renders a row per finding and badges per severity', () => {
    const findings: ValidationFinding[] = [
      finding({ id: 'a', severity: 'critical', ruleId: 'C-1' }),
      finding({ id: 'b', severity: 'medium', ruleId: 'M-1' }),
      finding({ id: 'c', severity: 'low', ruleId: 'L-1' }),
    ];
    setupQuery({ data: report(findings) });
    render(<ValidatorDetailPage params={resolvedParams} />);
    const rows = screen.getAllByTestId('findings-row');
    expect(rows).toHaveLength(3);
    // Scope to the findings table — the summary panel also renders
    // severity badges for its breakdown chips.
    const findingsTable = screen.getByTestId('findings-table');
    const badges = within(findingsTable).getAllByTestId('severity-badge');
    expect(badges.map((b) => b.getAttribute('data-severity'))).toEqual([
      'critical',
      'medium',
      'low',
    ]);
  });

  it('sorts findings severity-ascending by default (critical first)', () => {
    const findings: ValidationFinding[] = [
      // Deliberately pass them in shuffled order.
      finding({ id: 'low-1', severity: 'low' }),
      finding({ id: 'crit-1', severity: 'critical' }),
      finding({ id: 'high-1', severity: 'high' }),
      finding({ id: 'med-1', severity: 'medium' }),
    ];
    setupQuery({ data: report(findings) });
    render(<ValidatorDetailPage params={resolvedParams} />);
    const tbody = screen.getByTestId('findings-tbody');
    expect(tbody.getAttribute('data-severity-order')).toBe(
      'critical,high,medium,low',
    );
    const rows = within(tbody).getAllByTestId('findings-row');
    expect(
      rows.map((r) => r.getAttribute('data-severity')),
    ).toEqual(['critical', 'high', 'medium', 'low']);
  });

  it('toggle flips the sort so the lowest-severity finding comes first', () => {
    const findings: ValidationFinding[] = [
      finding({ id: 'low-1', severity: 'low' }),
      finding({ id: 'crit-1', severity: 'critical' }),
      finding({ id: 'high-1', severity: 'high' }),
      finding({ id: 'med-1', severity: 'medium' }),
    ];
    setupQuery({ data: report(findings) });
    render(<ValidatorDetailPage params={resolvedParams} />);

    const tbody = screen.getByTestId('findings-tbody');
    const toggle = screen.getByTestId('findings-sort-toggle');
    expect(toggle.getAttribute('data-sort')).toBe('severity-asc');

    fireEvent.click(toggle);

    expect(toggle.getAttribute('data-sort')).toBe('severity-desc');
    expect(tbody.getAttribute('data-severity-order')).toBe(
      'low,medium,high,critical',
    );
    const rows = within(tbody).getAllByTestId('findings-row');
    expect(
      rows.map((r) => r.getAttribute('data-severity')),
    ).toEqual(['low', 'medium', 'high', 'critical']);
  });

  it('preserves severity grouping across a toggle', () => {
    // Two criticals and two lows, filePath breaks the tie inside a
    // severity bucket. Criticals should remain at the top after a
    // round-trip toggle.
    const findings: ValidationFinding[] = [
      finding({
        id: 'c-a',
        severity: 'critical',
        location: { filePath: 'src/a.ts', line: 10 },
      }),
      finding({
        id: 'c-b',
        severity: 'critical',
        location: { filePath: 'src/b.ts', line: 1 },
      }),
      finding({
        id: 'l-a',
        severity: 'low',
        location: { filePath: 'src/a.ts', line: 5 },
      }),
      finding({
        id: 'l-b',
        severity: 'low',
        location: { filePath: 'src/b.ts', line: 50 },
      }),
    ];
    setupQuery({ data: report(findings) });
    render(<ValidatorDetailPage params={resolvedParams} />);

    // Default: critical first, sorted by filePath asc.
    let rows = within(screen.getByTestId('findings-tbody')).getAllByTestId(
      'findings-row',
    );
    expect(
      rows.map((r) => r.getAttribute('data-finding-id') ?? r.getAttribute('data-severity')),
    ).toEqual(['critical', 'critical', 'low', 'low']);
    expect(rows[0]?.getAttribute('data-file')).toBe('src/a.ts');
    expect(rows[1]?.getAttribute('data-file')).toBe('src/b.ts');

    // Toggle.
    fireEvent.click(screen.getByTestId('findings-sort-toggle'));

    rows = within(screen.getByTestId('findings-tbody')).getAllByTestId(
      'findings-row',
    );
    expect(
      rows.map((r) => r.getAttribute('data-severity')),
    ).toEqual(['low', 'low', 'critical', 'critical']);
    expect(rows[2]?.getAttribute('data-file')).toBe('src/a.ts');
    expect(rows[3]?.getAttribute('data-file')).toBe('src/b.ts');
  });

  it('renders the loading state when the query is loading', () => {
    setupQuery({ isLoading: true });
    render(<ValidatorDetailPage params={resolvedParams} />);
    expect(screen.getByTestId('detail-loading')).toBeTruthy();
  });

  it('renders the error state when the query has errored', () => {
    setupQuery({ isError: true, error: new Error('offline') });
    render(<ValidatorDetailPage params={resolvedParams} />);
    expect(screen.getByTestId('detail-error').textContent).toMatch(/offline/);
  });

  it('renders an empty findings table when the report passed', () => {
    setupQuery({
      data: report([], {
        status: 'pass',
        summary: {
          total: 0,
          critical: 0,
          high: 0,
          medium: 0,
          low: 0,
          passed: 0,
        },
      }),
    });
    render(<ValidatorDetailPage params={resolvedParams} />);
    expect(screen.getByTestId('findings-empty')).toBeTruthy();
  });
});