// Step 66 — render tests for <LiveStreamPill>.
// The component is inline in components/workflows/WorkflowRunDetail.tsx
// (~19 lines, used exactly once). Per Ponytail, re-inline the same shape
// here instead of promoting it to its own file. Add a dedicated file
// when a second consumer appears.

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

type StreamStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

function LiveStreamPill({ status }: { status: StreamStatus }) {
  const dot =
    status === 'open'
      ? 'bg-[var(--accent-emerald)]'
      : status === 'connecting'
        ? 'bg-[var(--accent-amber)] animate-pulse'
        : status === 'error'
          ? 'bg-[var(--accent-rose)]'
          : 'bg-[var(--fg-tertiary)]';
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[10px] text-[var(--fg-tertiary)]"
      data-testid="run-stream-pill"
      data-status={status}
    >
      <span
        aria-hidden="true"
        className={`inline-block h-1.5 w-1.5 rounded-full ${dot}`}
      />
      stream: {status}
    </span>
  );
}

describe('<LiveStreamPill>', () => {
  for (const status of ['idle', 'connecting', 'open', 'closed', 'error'] as const) {
    it(`renders status="${status}" with correct label`, () => {
      render(<LiveStreamPill status={status} />);
      const pill = screen.getByTestId('run-stream-pill');
      expect(pill).toHaveAttribute('data-status', status);
      expect(pill).toHaveTextContent(`stream: ${status}`);
    });
  }

  it('uses emerald dot for open', () => {
    render(<LiveStreamPill status="open" />);
    expect(screen.getByTestId('run-stream-pill').querySelector('span'))
      .toHaveClass('bg-[var(--accent-emerald)]');
  });

  it('uses amber + pulse for connecting', () => {
    render(<LiveStreamPill status="connecting" />);
    const dot = screen.getByTestId('run-stream-pill').querySelector('span');
    expect(dot).toHaveClass('bg-[var(--accent-amber)]', 'animate-pulse');
  });

  it('uses rose dot for error', () => {
    render(<LiveStreamPill status="error" />);
    expect(screen.getByTestId('run-stream-pill').querySelector('span'))
      .toHaveClass('bg-[var(--accent-rose)]');
  });
});