import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { Timeline } from '../components/Timeline';
import type { StageRecord } from '../lib/types';

const RUN_ID = 'demo-run-001';
const STAGES_IN_ORDER: ReadonlyArray<StageRecord['stage']> = [
  'ideation',
  'architect',
  'dev',
  'qa',
  'security',
  'devops',
  'docs',
];

function stageRow(stage: StageRecord['stage'], overrides: Partial<StageRecord> = {}): StageRecord {
  return {
    id: `${stage}-row`,
    run_id: RUN_ID,
    stage,
    status: 'pending',
    decision: null,
    started_at: null,
    finished_at: null,
    ...overrides,
  };
}

describe('<Timeline>', () => {
  it('renders all seven canonical stages in canonical order', () => {
    const rows = STAGES_IN_ORDER.map((s) => stageRow(s));
    render(<Timeline runId={RUN_ID} currentStage="ideation" stages={rows} />);
    const ol = screen.getByRole('list');
    const items = within(ol).getAllByRole('listitem');
    expect(items).toHaveLength(7);
    expect(items.map((li) => li.getAttribute('data-stage'))).toEqual([
      'ideation',
      'architect',
      'dev',
      'qa',
      'security',
      'devops',
      'docs',
    ]);
  });

  it('marks the current stage and shows the current-stage badge', () => {
    const rows = STAGES_IN_ORDER.map((s, i) =>
      stageRow(s, { status: i === 1 ? 'running' : 'pending' }),
    );
    render(<Timeline runId={RUN_ID} currentStage="architect" stages={rows} />);
    expect(screen.getByTestId('current-stage-marker')).toBeTruthy();
    const architect = screen.getByTestId('stage-badge-architect');
    expect(architect.textContent).toMatch(/running/);
  });

  it('handles a missing row by rendering a placeholder pending stage', () => {
    // Drop the 'qa' row — the orchestrator should always write seven,
    // but the timeline must not blow up if a partial list is returned.
    const rows = STAGES_IN_ORDER.filter((s) => s !== 'qa').map((s) => stageRow(s));
    render(<Timeline runId={RUN_ID} currentStage="docs" stages={rows} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(7);
    const qa = items.find((li) => li.getAttribute('data-stage') === 'qa');
    expect(qa?.getAttribute('data-status')).toBe('pending');
  });

  it('sets data-testid=timeline on the section root for the smoke probe', () => {
    render(<Timeline runId={RUN_ID} currentStage="docs" stages={[]} />);
    expect(screen.getByTestId('timeline')).toBeTruthy();
  });
});