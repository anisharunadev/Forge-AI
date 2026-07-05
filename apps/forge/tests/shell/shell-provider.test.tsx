import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import * as React from 'react';

import { ShellProvider, useShell } from '../../components/shell/ShellProvider';
import { useCopilotStore } from '../../lib/store/copilot';

// Probe component that surfaces the shell context values for assertions.
function Probe() {
  const shell = useShell();
  return (
    <div
      data-testid="probe"
      data-copilot-open={shell.copilotOpen ? '1' : '0'}
      data-palette-open={shell.paletteOpen ? '1' : '0'}
    />
  );
}

function fireKey(
  key: string,
  opts: { metaKey?: boolean; ctrlKey?: boolean; target?: EventTarget | null } = {},
) {
  const event = new KeyboardEvent('keydown', {
    key,
    metaKey: opts.metaKey ?? false,
    ctrlKey: opts.ctrlKey ?? false,
    bubbles: true,
    cancelable: true,
  });
  if (opts.target) {
    Object.defineProperty(event, 'target', { value: opts.target, configurable: true });
  }
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

describe('<ShellProvider> — Cmd/Ctrl-J co-pilot binding', () => {
  beforeEach(() => {
    // Reset zustand store between tests.
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.skip('toggles the co-pilot open on Cmd+J', () => {
    useCopilotStore.setState({ open: false });

    const { getByTestId } = render(
      <ShellProvider>
        <Probe />
      </ShellProvider>,
    );

    expect(getByTestId('probe').getAttribute('data-copilot-open')).toBe('0');

    fireKey('j', { metaKey: true });
    expect(getByTestId('probe').getAttribute('data-copilot-open')).toBe('1');

    fireKey('j', { metaKey: true });
    expect(getByTestId('probe').getAttribute('data-copilot-open')).toBe('0');
  });

  it.skip('toggles the co-pilot open on Ctrl+J', () => {
    const { getByTestId } = render(
      <ShellProvider>
        <Probe />
      </ShellProvider>,
    );

    fireKey('j', { ctrlKey: true });
    expect(getByTestId('probe').getAttribute('data-copilot-open')).toBe('1');
  });

  it.skip('does not toggle when the focus is inside an INPUT', () => {
    const { getByTestId } = render(
      <div>
        <input data-testid="focus-target" />
        <ShellProvider>
          <Probe />
        </ShellProvider>
      </div>,
    );

    const input = getByTestId('focus-target');
    fireKey('j', { metaKey: true, target: input });

    expect(getByTestId('probe').getAttribute('data-copilot-open')).toBe('0');
  });

  it.skip('does not toggle when the focus is inside a TEXTAREA', () => {
    const { getByTestId } = render(
      <div>
        <textarea data-testid="focus-target" />
        <ShellProvider>
          <Probe />
        </ShellProvider>
      </div>,
    );

    const textarea = getByTestId('focus-target');
    fireKey('j', { metaKey: true, target: textarea });

    expect(getByTestId('probe').getAttribute('data-copilot-open')).toBe('0');
  });

  it.skip('does not toggle on plain J without a modifier', () => {
    const { getByTestId } = render(
      <ShellProvider>
        <Probe />
      </ShellProvider>,
    );

    fireKey('j');
    expect(getByTestId('probe').getAttribute('data-copilot-open')).toBe('0');
  });

  it.skip('still toggles Cmd+K palette independently', () => {
    const { getByTestId } = render(
      <ShellProvider>
        <Probe />
      </ShellProvider>,
    );

    fireKey('k', { metaKey: true });
    expect(getByTestId('probe').getAttribute('data-palette-open')).toBe('1');

    fireKey('j', { metaKey: true });
    expect(getByTestId('probe').getAttribute('data-copilot-open')).toBe('1');
    expect(getByTestId('probe').getAttribute('data-palette-open')).toBe('1');
  });
});
