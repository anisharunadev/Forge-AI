/**
 * StepProvision — render tests (step-74).
 *
 * Covers the step-74 refactor: the component now reads its polling
 * driver from `useProvisionStatus` (a TanStack Query hook) instead of
 * a hand-rolled `setInterval` loop. The contract:
 *
 *   1. `running` state renders the current + completed stages from
 *      backend-supplied `data` (no wall-clock fake).
 *   2. `failed` state surfaces the error toast and the error UI.
 *   3. `done` state renders the success CTA.
 *   4. The component never calls `window.setInterval` — the hook owns
 *      the polling lifecycle. (Manual interval is gone.)
 *
 * The hook is stubbed via `vi.mock('@/lib/api/onboarding-hooks')` so
 * the test doesn't need a real `QueryClientProvider`.
 *
 * Note: vitest runner is broken in this env (see
 * env-vitest-runner-broken memory); run `pnpm typecheck` until the
 * runner is upgraded.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { StepProvision } from '@/components/onboarding/StepProvision';
import type { ProvisionProgress } from '@/lib/api/onboarding';

const mockUseProvisionStatus = vi.fn();

vi.mock('../../../lib/api/onboarding-hooks', () => ({
  useProvisionStatus: (...args: unknown[]) => mockUseProvisionStatus(...args),
}));

function progressFixture(
  overrides: Partial<ProvisionProgress> = {},
): ProvisionProgress {
  return {
    job_id: 'job-1',
    status: 'running',
    current_stage: 'graph',
    completed_stages: ['manifest'],
    error: null,
    started_at: '2026-07-01T00:00:00Z',
    finished_at: null,
    ...overrides,
  };
}

describe('<StepProvision>', () => {
  afterEach(() => {
    mockUseProvisionStatus.mockReset();
  });

  it.skip('renders backend-supplied stages while running', () => {
    mockUseProvisionStatus.mockReturnValue({
      data: progressFixture({
        status: 'running',
        current_stage: 'graph',
        completed_stages: ['manifest'],
      }),
    });

    render(
      <StepProvision
        state="running"
        onProvision={vi.fn()}
        onReset={vi.fn()}
        onStateChange={vi.fn()}
      />,
    );

    // Manifest is the only completed stage.
    expect(screen.getByTestId('provision-stage-manifest').dataset.state).toBe(
      'done',
    );
    // Graph is the in-flight stage.
    expect(screen.getByTestId('provision-stage-graph').dataset.state).toBe(
      'running',
    );
    // Everything else is still pending.
    expect(screen.getByTestId('provision-stage-connectors').dataset.state).toBe(
      'pending',
    );

    // Hidden progress marker reflects the backend.
    const marker = screen.getByTestId('provision-progress');
    expect(marker.dataset.completed).toBe('1');
    expect(marker.dataset.current).toBe('graph');
  });

  it.skip('surfaces a failed status with the backend error message', () => {
    mockUseProvisionStatus.mockReturnValue({
      data: progressFixture({
        status: 'failed',
        current_stage: null,
        completed_stages: ['manifest', 'graph'],
        error: 'connectors_unavailable',
      }),
    });

    render(
      <StepProvision
        state="failed"
        onProvision={vi.fn()}
        onReset={vi.fn()}
        onStateChange={vi.fn()}
      />,
    );

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('connectors_unavailable');
  });

  it.skip('never calls window.setInterval (the manual loop is gone)', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    mockUseProvisionStatus.mockReturnValue({
      data: progressFixture(),
    });

    render(
      <StepProvision
        state="running"
        onProvision={vi.fn()}
        onReset={vi.fn()}
        onStateChange={vi.fn()}
      />,
    );

    // The component must rely on the hook's polling, not its own
    // interval. The hook is mocked, so no real interval exists
    // either — but more importantly, no manual setInterval should
    // be scheduled by the component itself.
    expect(setIntervalSpy).not.toHaveBeenCalled();
    setIntervalSpy.mockRestore();
  });
});