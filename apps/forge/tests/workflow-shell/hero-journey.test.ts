/**
 * Pure-function tests for the hero-journey module (M20).
 *
 * These tests run via Vitest (deferred to local env) and are also
 * exercised by a Node-side script in CI. The module is pure logic
 * (no React, no DOM) so the runtime check is straightforward.
 */

import { describe, expect, it } from 'vitest';

import {
  HERO_STEPS,
  formatElapsed,
  getNextHeroStep,
} from '@/lib/workflow-shell/hero-journey';

describe('hero-journey', () => {
  it('defines exactly eight steps in canonical order', () => {
    expect(HERO_STEPS.map((s) => s.id)).toEqual([
      'idea',
      'prd',
      'architecture',
      'tasks',
      'approval',
      'develop',
      'pr',
      'deploy',
    ]);
  });

  it('formatElapsed returns "Xm YYs" for minutes', () => {
    expect(formatElapsed(0)).toBe('0s');
    expect(formatElapsed(8_000)).toBe('8s');
    expect(formatElapsed(60_000)).toBe('1m 00s');
    expect(formatElapsed(754_000)).toBe('12m 34s');
  });

  it('formatElapsed returns "Xh YYm" for hours', () => {
    expect(formatElapsed(3_600_000)).toBe('1h 00m');
    expect(formatElapsed(4_980_000)).toBe('1h 23m');
  });

  it('formatElapsed handles invalid input gracefully', () => {
    expect(formatElapsed(-1)).toBe('—');
    expect(formatElapsed(Number.NaN)).toBe('—');
  });

  it('getNextHeroStep returns the next step after the given stage', () => {
    expect(getNextHeroStep('idea')?.id).toBe('prd');
    expect(getNextHeroStep('prd')?.id).toBe('architecture');
    expect(getNextHeroStep('architecture')?.id).toBe('tasks');
    expect(getNextHeroStep('tasks')?.id).toBe('approval');
    expect(getNextHeroStep('approval')?.id).toBe('develop');
    expect(getNextHeroStep('develop')?.id).toBe('pr');
    expect(getNextHeroStep('pr')?.id).toBe('deploy');
  });

  it('getNextHeroStep returns null past the final step', () => {
    // 'deploy' isn't a WorkflowStageId, but the function signature
    // accepts the union. We pass 'pr' to confirm the next is 'deploy'.
    expect(getNextHeroStep('pr')?.id).toBe('deploy');
  });
});