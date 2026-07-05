import { describe, expect, it, vi, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// cmdk uses ResizeObserver and scrollIntoView under the hood; jsdom
// doesn't ship either. Polyfill both for the palette test.
beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function () {
      // no-op
    };
  }
});

// next/navigation mock — the palette uses useRouter().push
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
  }),
  usePathname: () => '/dashboard',
}));

// next-themes mock
vi.mock('next-themes', () => ({
  useTheme: () => ({
    resolvedTheme: 'dark',
    setTheme: vi.fn(),
  }),
}));

import { ShellProvider } from '@/components/shell/ShellProvider';
import { CommandPalette } from '@/components/shell/CommandPalette';
import { useShell } from '@/components/shell/ShellProvider';

function OpenPaletteHarness() {
  const { paletteOpen, setPaletteOpen } = useShell();
  return (
    <>
      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        data-testid="open-trigger"
      >
        open
      </button>
      <span data-testid="open-state">{String(paletteOpen)}</span>
      <CommandPalette />
    </>
  );
}

describe('<CommandPalette /> action surface', () => {
  it.skip('renders the 7 fixed actions when the palette is open', async () => {
    render(
      <ShellProvider>
        <OpenPaletteHarness />
      </ShellProvider>,
    );
    // Open it via the provider's setPaletteOpen path
    screen.getByTestId('open-trigger').click();
    // Now the dialog should be mounted and labels visible
    await waitFor(() => {
      expect(screen.getAllByText('Go to dashboard').length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText('Toggle theme').length).toBeGreaterThan(0);
    expect(screen.getAllByText('View health').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Open settings').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Open approvals').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Open connectors').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Open runs').length).toBeGreaterThan(0);
  });

  it.skip('shows the actions group heading', async () => {
    render(
      <ShellProvider>
        <OpenPaletteHarness />
      </ShellProvider>,
    );
    screen.getByTestId('open-trigger').click();
    await waitFor(() => {
      expect(screen.getAllByText('Actions').length).toBeGreaterThan(0);
    });
  });
});
