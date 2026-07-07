/**
 * Component tests for `CenterStateBanner`. Verifies all five states
 * render with the correct `data-state` attribute (the e2e hook) and
 * that the optional detail prop renders next to the label.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { CenterStateBanner } from '@/components/workflow-shell/CenterStateBanner';
import {
  STATE_LABEL,
  STATE_TESTID,
} from '@/lib/workflow-shell/states';

const ALL_STATES = ['live', 'cached', 'demo', 'error', 'loading'] as const;

describe('CenterStateBanner', () => {
  it.each(ALL_STATES)('renders %s state with the right data-state', (state) => {
    render(<CenterStateBanner state={state} />);
    const banner = screen.getByTestId(STATE_TESTID[state]);
    expect(banner.dataset.state).toBe(state);
    expect(banner.textContent).toContain(STATE_LABEL[state]);
  });

  it('renders the detail prop next to the label when state=error', () => {
    render(<CenterStateBanner state="error" detail="PASS_THROUGH_DISABLED" />);
    const banner = screen.getByTestId(STATE_TESTID.error);
    expect(banner.textContent).toMatch(/PASS_THROUGH_DISABLED/);
  });

  it('does not render detail when state is not error', () => {
    render(<CenterStateBanner state="live" detail="should-not-show" />);
    const banner = screen.getByTestId(STATE_TESTID.live);
    expect(banner.textContent).not.toMatch(/should-not-show/);
  });

  it('exposes role=status and aria-live=polite', () => {
    render(<CenterStateBanner state="loading" />);
    const banner = screen.getByTestId(STATE_TESTID.loading);
    expect(banner.getAttribute('role')).toBe('status');
    expect(banner.getAttribute('aria-live')).toBe('polite');
  });
});