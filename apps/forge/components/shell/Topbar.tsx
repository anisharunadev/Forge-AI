'use client';

import * as React from 'react';
import Link from 'next/link';
import { Menu, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ThemeToggle } from './ThemeToggle';
import { useShell } from './ShellProvider';
import { SEED_TENANT_NAME } from '@/lib/auth';

/**
 * Top bar — search trigger + theme toggle + mobile menu button.
 *
 * Sticky to the top of the right-side content column. The desktop
 * sidebar sits to the left; on mobile, the sidebar is replaced by a
 * hamburger that opens `<MobileNav>`.
 */
export function Topbar() {
  const { openPalette, openMobileNav } = useShell();
  const [isMac, setIsMac] = React.useState(false);

  React.useEffect(() => {
    if (typeof navigator !== 'undefined') {
      setIsMac(/Mac|iPod|iPhone|iPad/.test(navigator.platform));
    }
  }, []);

  return (
    <header
      className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60 md:px-6"
      data-testid="app-topbar"
    >
      {/* Mobile menu + brand */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="md:hidden"
        aria-label="Open navigation"
        onClick={openMobileNav}
      >
        <Menu className="h-5 w-5" aria-hidden="true" />
      </Button>

      <Link
        href="/dashboard"
        className="flex items-center gap-2 text-sm font-semibold tracking-tight md:hidden"
        aria-label="Forge AI — back to dashboard"
      >
        <div className="forge-mark" aria-hidden="true">
          <span className="text-sm font-bold">F</span>
        </div>
        <span>Forge AI</span>
      </Link>

      {/* Search trigger */}
      <Button
        type="button"
        variant="outline"
        onClick={openPalette}
        className="ml-1 flex h-9 max-w-xl flex-1 items-center justify-between gap-2 px-3 text-muted-foreground"
        data-testid="topbar-search"
        aria-label="Open command palette"
      >
        <span className="flex items-center gap-2 truncate text-sm">
          <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="hidden truncate md:inline">
            Search centers, runs, agents…
          </span>
          <span className="truncate md:hidden">Search…</span>
        </span>
        <kbd
          aria-hidden="true"
          className="hidden rounded border border-border bg-muted px-1.5 py-0.5 text-2xs font-mono text-muted-foreground md:inline-block"
        >
          {isMac ? '⌘' : 'Ctrl'}K
        </kbd>
      </Button>

      {/* Right cluster */}
      <div className="flex items-center gap-1">
        <Link
          href="/healthz"
          className="hidden items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground md:inline-flex"
        >
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-success" />
          <span className="hidden lg:inline">health</span>
        </Link>
        <span
          className="hidden truncate text-xs text-muted-foreground lg:inline"
          title={SEED_TENANT_NAME}
        >
          {SEED_TENANT_NAME}
        </span>
        <ThemeToggle />
      </div>
    </header>
  );
}
