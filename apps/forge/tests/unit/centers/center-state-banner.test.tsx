/**
 * CenterStateBanner — Sprint 5 primitive test.
 *
 * Contract:
 *   1. Renders nothing when state="live".
 *   2. Renders with the right role + aria-live per state.
 *   3. data-testid="center-state-banner-{state}" is present for E2E.
 *   4. Custom title/description overrides defaults.
 *   5. Action slot renders.
 */

import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

import { CenterStateBanner } from '@/components/ui/CenterStateBanner';

afterEach(() => cleanup());

describe('<CenterStateBanner>', () => {
  it('renders nothing when state=live', () => {
    const { container } = render(<CenterStateBanner state="live" />);
    expect(container.firstChild).toBeNull();
  });

  it.each(['demo', 'cached', 'error', 'loading'] as const)(
    'renders the %s banner with state testid',
    (state) => {
      render(<CenterStateBanner state={state} />);
      const banner = screen.getByTestId('center-state-banner');
      expect(banner).toBeTruthy();
      expect(banner.getAttribute('data-banner-state')).toBe(state);
      expect(screen.getByTestId(`center-state-banner-${state}`)).toBeTruthy();
    },
  );

  it('uses role=alert + aria-live=assertive for error state', () => {
    render(<CenterStateBanner state="error" />);
    const banner = screen.getByTestId('center-state-banner');
    expect(banner.getAttribute('role')).toBe('alert');
    expect(banner.getAttribute('aria-live')).toBe('assertive');
  });

  it.each(['demo', 'cached', 'loading'] as const)(
    'uses role=status + aria-live=polite for %s state',
    (state) => {
      render(<CenterStateBanner state={state} />);
      const banner = screen.getByTestId('center-state-banner');
      expect(banner.getAttribute('role')).toBe('status');
      expect(banner.getAttribute('aria-live')).toBe('polite');
    },
  );

  it('honours custom title and description overrides', () => {
    render(
      <CenterStateBanner
        state="error"
        title="Couldn't reach Runs API"
        description="Retry in a moment."
      />,
    );
    expect(screen.getByText("Couldn't reach Runs API")).toBeTruthy();
    expect(screen.getByText('Retry in a moment.')).toBeTruthy();
  });

  it('renders an action slot to the right of the copy', () => {
    render(
      <CenterStateBanner
        state="error"
        action={<button type="button">Retry</button>}
      />,
    );
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('honours a custom testid suffix when provided', () => {
    render(
      <CenterStateBanner state="error" testIdSuffix="hash-chain" />,
    );
    expect(screen.getByTestId('center-state-banner-hash-chain')).toBeTruthy();
  });
});
