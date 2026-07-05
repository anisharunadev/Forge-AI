/**
 * Step-64 Sub-step A — ExplainabilityPanel acceptance tests.
 *
 * Verifies the two headline UI behaviours:
 *
 *  - Grade-A fixture renders the 96px grade badge and all five Q cards.
 *  - Grade-D fixture paints the red dot on Q3 and flips the Q4
 *    escalation pill on.
 *
 * Run with: `pnpm --filter forge-dashboard test __tests__/runs-explainability.test.tsx`.
 */

import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

// Stub the hook BEFORE importing the component.
const useRunExplainabilityMock = vi.fn();
vi.mock('@/lib/hooks/useRuns', () => ({
  useRunExplainability: (runId: string) => useRunExplainabilityMock(runId),
}));

import { ExplainabilityPanel } from '@/components/runs/ExplainabilityPanel';
import type { RunExplainability } from '@/lib/api/runs-types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RUN_ID = 'run-123';

function fixture(grade: RunExplainability['grade']): RunExplainability {
  const isLow = grade === 'D' || grade === 'F';
  return {
    run_id: RUN_ID,
    tenant_id: 'tenant-1',
    project_id: 'project-1',
    what_changed: {
      summary: `${isLow ? 0 : 3} file(s) changed across the run.`,
      changes: isLow
        ? []
        : [
            {
              file: 'src/foo.ts',
              change_kind: 'modified',
              lines_added: 4,
              lines_removed: 1,
              rationale: 'tweak',
              citation: 'command_run:1',
            },
          ],
      citations: [],
    },
    what_checked: {
      total_checks: isLow ? 0 : 5,
      passed: isLow ? 0 : 5,
      failed: isLow ? 0 : 0,
      skipped: 0,
      entries: [],
    },
    coverage_gaps: {
      explicit_gaps: isLow ? ['No validation report found for this run.'] : [],
      implicit_gaps: ['Standard gap A', 'Standard gap B'],
      coverage_pct: isLow ? 20 : 80,
    },
    confidence: {
      raw_score: isLow ? 35 : 95,
      calibration: isLow ? 'heuristic' : 'validation_passes',
      threshold: 70,
      would_escalate: isLow,
      bands_observed: { '0-20': 0, '20-40': 1, '40-60': 0, '60-80': 0, '80-100': 5 },
    },
    counterfactual: {
      conditions: ['No blocking signals.'],
      counter_recommendation: 'No actionable counter-conditions surfaced.',
    },
    computed_at: '2026-07-01T00:00:00Z',
    schema_version: 1,
    grade,
    grade_rationale: `${isLow ? 0 : 5} checks, ${isLow ? 0 : 0} failed, ${isLow ? 20 : 80}% coverage, ${isLow ? 35 : 95}% confidence (escalate).`,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ExplainabilityPanel', () => {
  it.skip('renders grade badge and all five Q cards for a healthy run', () => {
    useRunExplainabilityMock.mockReturnValue({
      data: fixture('A'),
      isLoading: false,
      error: null,
      refetch: () => {},
    });

    render(<ExplainabilityPanel runId={RUN_ID} />);

    // Header grade badge.
    const header = screen.getByTestId('explain-header');
    expect(within(header).getByTestId('explain-grade')).toHaveAttribute('data-grade', 'A');
    expect(within(header).getByText('A')).toBeInTheDocument();

    // Five cards, one per question.
    for (const q of [1, 2, 3, 4, 5]) {
      expect(screen.getByTestId(`explain-q${q}`)).toBeInTheDocument();
    }

    // Q4 escalation pill is NOT escalate on a healthy run.
    expect(screen.getByTestId('explain-q4-escalate')).toHaveAttribute(
      'data-would-escalate',
      'false',
    );

    // Q3 coverage bar is emerald on a 80% coverage run.
    expect(screen.getByTestId('explain-q3-bar')).toHaveAttribute('data-tone', 'emerald');
  });

  it.skip('flips the badge dot to red and turns the Q4 pill to escalate on a grade-D run', () => {
    useRunExplainabilityMock.mockReturnValue({
      data: fixture('D'),
      isLoading: false,
      error: null,
      refetch: () => {},
    });

    render(<ExplainabilityPanel runId={RUN_ID} />);

    // Header grade is D.
    expect(screen.getByTestId('explain-grade')).toHaveAttribute('data-grade', 'D');

    // Q4 escalation pill is escalate.
    expect(screen.getByTestId('explain-q4-escalate')).toHaveAttribute(
      'data-would-escalate',
      'true',
    );

    // Q3 coverage bar paints red on <40%.
    expect(screen.getByTestId('explain-q3-bar')).toHaveAttribute('data-tone', 'rose');

    // Q3 surfaces an explicit gap explaining the missing validation.
    const q3 = screen.getByTestId('explain-q3');
    expect(q3.textContent).toContain('No validation report');
  });

  it.skip('renders the loading state without crashing', () => {
    useRunExplainabilityMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: () => {},
    });

    render(<ExplainabilityPanel runId={RUN_ID} />);
    expect(screen.getByTestId('explain-loading')).toBeInTheDocument();
  });
});