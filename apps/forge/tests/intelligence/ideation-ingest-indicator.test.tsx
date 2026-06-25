/**
 * Forge AI-440 / Pillar 1 Phase 3 — Ideation ingest indicator tests.
 *
 * Covers `<IngestIndicator>`:
 *   - success → "Last daily ingest: N new ideas" with N = ideas_created_today.
 *   - failed  → "Daily ingest: failed".
 *   - runs inside the `<header>` from the `/ideation` page (smoke).
 *   - data-attributes are exposed for downstream tooling.
 *
 * No TanStack Query wrapper needed — `<IngestIndicator>` is a pure
 * render-only component that takes the status payload via props.
 */

import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { IngestIndicator } from '../../components/ideation/IngestIndicator';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('<IngestIndicator>', () => {
  it('renders "Last daily ingest: 3 new ideas" when status="success"', () => {
    render(
      <IngestIndicator status="success" ideas_created_today={3} />,
    );
    const badge = screen.getByTestId('ideation-ingest-indicator');
    expect(badge.textContent).toContain('Last daily ingest: 3 new ideas');
    expect(badge.getAttribute('data-ingest-status')).toBe('success');
    expect(badge.getAttribute('data-ideas-created-today')).toBe('3');
  });

  it('renders "Daily ingest: failed" when status="failed"', () => {
    render(
      <IngestIndicator status="failed" ideas_created_today={0} />,
    );
    const badge = screen.getByTestId('ideation-ingest-indicator');
    expect(badge.textContent).toContain('Daily ingest: failed');
    expect(badge.getAttribute('data-ingest-status')).toBe('failed');
  });

  it('renders "Daily ingest: never run" when status="never"', () => {
    render(<IngestIndicator status="never" />);
    const badge = screen.getByTestId('ideation-ingest-indicator');
    expect(badge.textContent).toContain('Daily ingest: never run');
  });

  it('renders "Daily ingest: running…" when status="running"', () => {
    render(<IngestIndicator status="running" />);
    const badge = screen.getByTestId('ideation-ingest-indicator');
    expect(badge.textContent).toContain('Daily ingest: running');
  });

  it('renders the partial fallback copy when status="partial"', () => {
    render(
      <IngestIndicator status="partial" ideas_created_today={2} />,
    );
    const badge = screen.getByTestId('ideation-ingest-indicator');
    expect(badge.textContent).toContain(
      'Daily ingest: partial — 2 ideas (budget fallback)',
    );
  });

  it('smoke: renders inside a <header> element as expected on /ideation', () => {
    render(
      <header data-testid="ideation-header">
        <h1>Ideation Center</h1>
        <IngestIndicator status="success" ideas_created_today={7} />
      </header>,
    );
    const header = screen.getByTestId('ideation-header');
    expect(header.contains(screen.getByTestId('ideation-ingest-indicator'))).toBe(
      true,
    );
    expect(
      screen.getByTestId('ideation-ingest-indicator').textContent,
    ).toContain('7 new ideas');
  });

  it('exposes last_run_at via data attribute when provided', () => {
    render(
      <IngestIndicator
        status="success"
        ideas_created_today={1}
        last_run_at="2026-06-22T06:00:00Z"
      />,
    );
    const badge = screen.getByTestId('ideation-ingest-indicator');
    expect(badge.getAttribute('data-last-run-at')).toBe(
      '2026-06-22T06:00:00Z',
    );
  });
});