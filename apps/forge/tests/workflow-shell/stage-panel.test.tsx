/**
 * Component tests for `StagePanel`. Verifies:
 *
 *   - Loading state renders the skeleton, not children
 *   - Error state renders the typed INTERNAL_ERROR envelope
 *   - Permission-required state renders a stable empty surface
 *   - The successful state renders children
 *   - The banner state matches the panel's data-state attribute
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { StagePanel } from '@/components/workflow-shell/StagePanel';

// Stub the side-effects hook so the panel's RBAC + audit + analytics
// calls don't try to hit fetch / dataLayer in the test environment.
vi.mock('@/lib/workflow-shell/use-stage-side-effects', () => ({
  useStageSideEffects: () => ({
    canView: true,
    canAct: true,
  }),
}));

describe('StagePanel', () => {
  it('renders the loading skeleton when isLoading=true', () => {
    render(
      <StagePanel stage="idea" isLoading>
        <span data-testid="child-content">should-not-render</span>
      </StagePanel>,
    );
    expect(screen.getByTestId('workflow-stage-skeleton')).toBeTruthy();
    expect(screen.queryByTestId('child-content')).toBeNull();
  });

  it('renders children when isSuccess=true', () => {
    render(
      <StagePanel stage="idea" isSuccess>
        <span data-testid="child-content">rendered</span>
      </StagePanel>,
    );
    expect(screen.getByTestId('child-content')).toBeTruthy();
  });

  it('renders the error envelope fallback when isError=true', () => {
    render(
      <StagePanel
        stage="architecture"
        isError
        error={
          {
            envelope: {
              error: 'PASS_THROUGH_DISABLED',
              message: 'Pass-through disabled',
              details: { env: 'prod' },
              occurred_at: '2026-07-07T12:00:00+00:00',
            },
          }
        }
      >
        <span data-testid="child-content">should-not-render</span>
      </StagePanel>,
    );
    const fallback = screen.getByTestId('workflow-stage-error-fallback');
    expect(fallback.dataset.errorCode).toBe('PASS_THROUGH_DISABLED');
    expect(fallback.textContent).toMatch(/Pass-through disabled/);
    expect(screen.queryByTestId('child-content')).toBeNull();
  });

  it('panel data-state matches the derived state', () => {
    const { rerender } = render(
      <StagePanel stage="idea" isLoading>
        <span>child</span>
      </StagePanel>,
    );
    expect(
      screen.getByTestId('workflow-stage-panel-idea').dataset.state,
    ).toBe('loading');

    rerender(
      <StagePanel stage="idea" isSuccess>
        <span>child</span>
      </StagePanel>,
    );
    expect(
      screen.getByTestId('workflow-stage-panel-idea').dataset.state,
    ).toBe('live');

    rerender(
      <StagePanel stage="idea" isError error={new Error('boom')}>
        <span>child</span>
      </StagePanel>,
    );
    expect(
      screen.getByTestId('workflow-stage-panel-idea').dataset.state,
    ).toBe('error');
  });

  it('renders the permission-required state when canView=false', async () => {
    vi.doMock('@/lib/workflow-shell/use-stage-side-effects', () => ({
      useStageSideEffects: () => ({
        canView: false,
        canAct: false,
        deniedReason: 'No session',
      }),
    }));
    // Re-import with the new mock — Vitest module isolation makes
    // this a fresh copy.
    const { StagePanel: FreshPanel } = await import(
      '@/components/workflow-shell/StagePanel'
    );
    render(
      <FreshPanel stage="pr">
        <span>should-not-render</span>
      </FreshPanel>,
    );
    expect(
      screen.getByTestId('workflow-stage-panel-pr').dataset.state,
    ).toBe('permission-required');
  });
});