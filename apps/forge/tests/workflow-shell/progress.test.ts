/**
 * Pure progress-derivation tests. These run via Vitest and are the
 * regression guard for the workflow shell.
 *
 * Why pure-function tests? The progress bar must work even before
 * the backend exposes a /workflow/progress aggregate. So
 * `deriveProgress` is a pure function that accepts booleans we
 * already query from existing centers — and the bar is only as
 * good as this function.
 */

import { describe, expect, it } from 'vitest';

import {
  deriveProgress,
  emptyProgress,
  type ProgressInputs,
} from '@/lib/workflow-shell/progress';
import { WORKFLOW_STAGES, getNextStage, getStage } from '@/lib/workflow-shell/stages';

const baseInputs: ProgressInputs = {
  projectId: 'proj_test',
  hasIdeationBrief: false,
  hasPrd: false,
  hasArchitecture: false,
  hasTaskBreakdown: false,
  approvalStatus: null,
  hasActiveRun: false,
  hasOpenPr: false,
};

describe('workflow stages', () => {
  it('defines exactly seven stages in the canonical order', () => {
    expect(WORKFLOW_STAGES.map((s) => s.id)).toEqual([
      'idea',
      'prd',
      'architecture',
      'tasks',
      'approval',
      'develop',
      'pr',
    ]);
  });

  it('getStage returns the matching definition or falls back to idea', () => {
    expect(getStage('idea').id).toBe('idea');
    expect(getStage('pr').label).toBe('Pull Request');
  });

  it('getNextStage returns null past the final stage', () => {
    expect(getNextStage('pr')).toBeNull();
    expect(getNextStage('idea')?.id).toBe('prd');
  });
});

describe('deriveProgress', () => {
  it('marks idea as current for an empty project', () => {
    const p = deriveProgress(baseInputs);
    expect(p.currentStage).toBe('idea');
    expect(p.stages.find((s) => s.id === 'idea')?.status).toBe('current');
    expect(p.stages.filter((s) => s.status === 'pending')).toHaveLength(6);
  });

  it('advances to prd once an ideation brief exists', () => {
    const p = deriveProgress({ ...baseInputs, hasIdeationBrief: true });
    expect(p.stages.find((s) => s.id === 'idea')?.status).toBe('done');
    expect(p.currentStage).toBe('prd');
  });

  it('blocks approval when status is denied and exposes a reason', () => {
    const p = deriveProgress({
      ...baseInputs,
      hasIdeationBrief: true,
      hasPrd: true,
      hasArchitecture: true,
      hasTaskBreakdown: true,
      approvalStatus: 'denied',
    });
    const approval = p.stages.find((s) => s.id === 'approval');
    expect(approval?.status).toBe('blocked');
    expect(approval?.blockedReason).toMatch(/denied/i);
    expect(p.currentStage).toBe('approval');
  });

  it('progresses through develop only after approval is approved', () => {
    const inputs: ProgressInputs = {
      ...baseInputs,
      hasIdeationBrief: true,
      hasPrd: true,
      hasArchitecture: true,
      hasTaskBreakdown: true,
      approvalStatus: 'approved',
      hasActiveRun: true,
    };
    const p = deriveProgress(inputs);
    expect(p.stages.find((s) => s.id === 'approval')?.status).toBe('done');
    expect(p.stages.find((s) => s.id === 'develop')?.status).toBe('current');
    expect(p.stages.find((s) => s.id === 'pr')?.status).toBe('current');
  });

  it('marks every stage done when the project is fully delivered', () => {
    const p = deriveProgress({
      ...baseInputs,
      hasIdeationBrief: true,
      hasPrd: true,
      hasArchitecture: true,
      hasTaskBreakdown: true,
      approvalStatus: 'approved',
      hasActiveRun: true,
      hasOpenPr: true,
    });
    expect(p.stages.every((s) => s.status === 'done')).toBe(true);
    // Falls back to final stage when every prior stage is done
    expect(p.currentStage).toBe('pr');
  });

  it('emptyProgress is a stable default for first-run users', () => {
    const p = emptyProgress('proj_new');
    expect(p.projectId).toBe('proj_new');
    expect(p.currentStage).toBe('idea');
  });
});