/**
 * Component-level tests for the workflow shell. Verifies that the
 * progress bar renders all seven stages, that the ContinueCard
 * shows the correct headline per status, and that the home page
 * assembles the spine correctly.
 */

import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';

import { deriveProgress } from '@/lib/workflow-shell/progress';
import { ContinueCard } from '@/components/workflow-shell/ContinueCard';
import { RecentActivityCard } from '@/components/workflow-shell/RecentActivityCard';
import { StageChip } from '@/components/workflow-shell/StageChip';
import { StartProjectCard } from '@/components/workflow-shell/StartProjectCard';
import { WorkflowProgressBar } from '@/components/workflow-shell/WorkflowProgressBar';

function makeProgress(overrides: Partial<Parameters<typeof deriveProgress>[0]> = {}) {
  return deriveProgress({
    projectId: 'proj_test',
    hasIdeationBrief: false,
    hasPrd: false,
    hasArchitecture: false,
    hasTaskBreakdown: false,
    approvalStatus: null,
    hasActiveRun: false,
    hasOpenPr: false,
    ...overrides,
  });
}

describe('StageChip', () => {
  it('renders the stage label and exposes a stable data-testid', () => {
    render(<StageChip id="idea" status="current" />);
    const link = screen.getByTestId('workflow-stage-chip-idea');
    expect(link).toHaveAttribute('data-stage-status', 'current');
    expect(within(link).getByText('Idea')).toBeTruthy();
  });

  it('renders a blocked reason when supplied', () => {
    render(
      <StageChip
        id="approval"
        status="blocked"
        blockedReason="Plan denied"
      />,
    );
    const link = screen.getByTestId('workflow-stage-chip-approval');
    expect(link).toHaveAttribute('title', 'Plan denied');
  });
});

describe('WorkflowProgressBar', () => {
  it('renders all seven stage chips', () => {
    render(<WorkflowProgressBar progress={makeProgress()} />);
    const nav = screen.getByTestId('workflow-progress-bar');
    expect(within(nav).getAllByTestId(/^workflow-stage-chip-/)).toHaveLength(7);
  });

  it('renders six connectors between seven stages', () => {
    render(<WorkflowProgressBar progress={makeProgress()} />);
    expect(screen.getAllByTestId(/^workflow-connector-/)).toHaveLength(6);
  });
});

describe('ContinueCard', () => {
  it('shows "Continue: Idea" for an empty project', () => {
    render(<ContinueCard progress={makeProgress()} />);
    expect(screen.getByTestId('workflow-continue-card')).toBeTruthy();
    expect(screen.getByText(/Continue: Idea/)).toBeTruthy();
  });

  it('shows "All stages complete" when every stage is done', () => {
    const p = makeProgress({
      hasIdeationBrief: true,
      hasPrd: true,
      hasArchitecture: true,
      hasTaskBreakdown: true,
      approvalStatus: 'approved',
      hasActiveRun: true,
      hasOpenPr: true,
    });
    render(<ContinueCard progress={p} />);
    expect(screen.getByText(/All stages complete/)).toBeTruthy();
  });
});

describe('StartProjectCard', () => {
  it('surfaces the onboarding copy for first-run users', () => {
    render(<StartProjectCard hasActiveProject={false} />);
    expect(screen.getByText(/New to Forge/)).toBeTruthy();
  });

  it('shows the secondary copy when a project is in flight', () => {
    render(<StartProjectCard hasActiveProject={true} />);
    expect(screen.getByText(/Start another project/)).toBeTruthy();
  });
});

describe('RecentActivityCard', () => {
  it('renders an empty list when no items are provided', () => {
    render(<RecentActivityCard items={[]} />);
    expect(screen.queryByTestId('workflow-recent-activity-list')).toBeNull();
  });

  it('renders one row per activity item', () => {
    render(
      <RecentActivityCard
        items={[
          {
            id: 'a1',
            stage: 'prd',
            kind: 'completed',
            summary: 'PRD generated',
            occurredAt: new Date('2026-07-06T12:00:00Z').toISOString(),
          },
        ]}
      />,
    );
    expect(screen.getAllByTestId('workflow-activity-item')).toHaveLength(1);
    expect(screen.getByText('PRD generated')).toBeTruthy();
  });
});