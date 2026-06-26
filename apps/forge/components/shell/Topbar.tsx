'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Bell,
  ChevronRight,
  Home,
  LogOut,
  Menu,
  Search,
  Settings as SettingsIcon,
  Shield,
  Sun,
  Moon,
  User,
} from 'lucide-react';
import { useTheme } from 'next-themes';

import { Button } from '@/components/ui/button';
import { ThemeToggle } from './ThemeToggle';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useShell } from './ShellProvider';
import { pathnameToSegments } from './Breadcrumbs';

/**
 * Top bar — 56px sticky, layered on top of the content column.
 *
 * Composition (left → right):
 *   - Mobile menu button + brand mark
 *   - Breadcrumb trail (home / section / page) — last segment is h1 weight 600
 *   - Command palette trigger (full-width up to 520px, ⌘K hint)
 *   - Theme toggle · notifications (unread dot) · user avatar dropdown
 *
 * The bar's bottom border darkens + gains `--shadow-sm` when the
 * user scrolls the page so the chrome reads as "above the content"
 * the moment motion starts.
 */
export function Topbar() {
  const { openPalette, openMobileNav } = useShell();
  const pathname = usePathname() ?? '/';
  const { resolvedTheme, setTheme } = useTheme();
  const [scrolled, setScrolled] = React.useState(false);
  const [isMac, setIsMac] = React.useState(false);

  React.useEffect(() => {
    if (typeof navigator !== 'undefined') {
      setIsMac(/Mac|iPod|iPhone|iPad/.test(navigator.platform));
    }
  }, []);

  // Track scroll position of the scrolling column (the parent <div> in
  // app/layout.tsx owns the scroll context). We listen on window since
  // overflow-y-auto on a non-document element still bubbles to the
  // viewport scroll.
  React.useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 4);
    }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const segments = pathnameToSegments(pathname);
  const lastSegment = segments[segments.length - 1];

  return (
    <header
      className={[
        'sticky top-0 z-30 flex h-14 items-center gap-3',
        'border-b border-[var(--border-subtle)] bg-[var(--bg-base)]/80 backdrop-blur-md',
        'px-4 md:px-5',
        scrolled ? 'shadow-[var(--shadow-sm)]' : '',
        'transition-shadow duration-200 ease-out-soft',
      ].join(' ')}
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

      {/* Breadcrumb (desktop) */}
      <nav aria-label="Breadcrumb" className="hidden min-w-0 flex-1 items-center gap-1.5 md:flex">
        <Link
          href="/dashboard"
          className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--fg-tertiary)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]"
          aria-label="Home"
        >
          <Home className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
        {segments.slice(-3).map((segment, idx, arr) => {
          const isLast = idx === arr.length - 1;
          const href = segment.href;
          return (
            <React.Fragment key={`${segment.label}-${idx}`}>
              <ChevronRight className="h-3 w-3 shrink-0 text-[var(--fg-tertiary)]" aria-hidden="true" />
              {isLast || !href ? (
                <h1 className="truncate text-[15px] font-semibold text-[var(--fg-primary)]" aria-current="page">
                  {segment.label}
                </h1>
              ) : (
                <Link
                  href={href}
                  className="truncate rounded px-1.5 py-0.5 text-sm text-[var(--fg-secondary)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
                >
                  {segment.label}
                </Link>
              )}
            </React.Fragment>
          );
        })}
      </nav>

      {/* Mobile-only spacer */}
      <div className="flex-1 md:hidden" />

      {/* Command palette trigger */}
      <button
        type="button"
        onClick={openPalette}
        className={[
          'flex h-9 max-w-[520px] flex-1 items-center gap-2.5 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 text-sm text-[var(--fg-tertiary)]',
          'transition-colors duration-150 ease-out-soft',
          'hover:border-[var(--border-default)] hover:bg-[var(--bg-elevated)] hover:text-[var(--fg-secondary)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]',
        ].join(' ')}
        data-testid="topbar-search"
        aria-label="Open command palette"
      >
        <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="hidden truncate md:inline">Search centers, runs, agents…</span>
        <span className="truncate md:hidden">Search…</span>
        <kbd className="ml-auto hidden shrink-0 rounded border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--fg-tertiary)] md:inline-block">
          {isMac ? '⌘' : 'Ctrl'}K
        </kbd>
      </button>

      {/* Right cluster */}
      <div className="flex items-center gap-1">
        {/* Theme toggle */}
        <ThemeInlineToggle
          isDark={resolvedTheme === 'dark'}
          onToggle={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
        />

        {/* Notifications */}
        <Link
          href="/audit"
          aria-label="Notifications"
          className="relative flex h-9 w-9 items-center justify-center rounded-md text-[var(--fg-secondary)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]"
        >
          <Bell className="h-4 w-4" aria-hidden="true" />
          <span
            aria-hidden="true"
            className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-[var(--accent-rose)] ring-2 ring-[var(--bg-base)]"
          />
        </Link>

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="User menu"
              className="ml-1 flex h-9 items-center gap-2 rounded-md px-1.5 text-sm text-[var(--fg-secondary)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]"
            >
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-[var(--accent-violet)] to-[var(--accent-primary)] text-[10px] font-bold text-white" aria-hidden="true">
                AR
              </div>
              <span className="hidden font-medium lg:inline">Arun</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            sideOffset={6}
            className="w-56 border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--fg-primary)]"
          >
            <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--fg-tertiary)]">
              Signed in as
            </DropdownMenuLabel>
            <div className="px-2 pb-2">
              <p className="text-sm font-semibold text-[var(--fg-primary)]">Arun R.</p>
              <p className="truncate text-xs text-[var(--fg-tertiary)]">arun@acme-corp.com</p>
            </div>
            <DropdownMenuSeparator className="bg-[var(--border-subtle)]" />
            <DropdownMenuItem className="gap-2 focus:bg-[rgba(255,255,255,0.06)] focus:text-[var(--fg-primary)]">
              <User className="h-4 w-4" aria-hidden="true" /> Profile
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2 focus:bg-[rgba(255,255,255,0.06)] focus:text-[var(--fg-primary)]">
              <SettingsIcon className="h-4 w-4" aria-hidden="true" /> Workspace settings
            </DropdownMenuItem>
            <DropdownMenuItem
              className="gap-2 focus:bg-[rgba(255,255,255,0.06)] focus:text-[var(--fg-primary)]"
              onSelect={(e) => {
                e.preventDefault();
                setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
              }}
            >
              {resolvedTheme === 'dark' ? (
                <Sun className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Moon className="h-4 w-4" aria-hidden="true" />
              )}{' '}
              Theme
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2 focus:bg-[rgba(255,255,255,0.06)] focus:text-[var(--fg-primary)]">
              <Shield className="h-4 w-4" aria-hidden="true" /> Governance
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-[var(--border-subtle)]" />
            <DropdownMenuItem className="gap-2 text-[var(--accent-rose)] focus:bg-[rgba(255,255,255,0.06)]">
              <LogOut className="h-4 w-4" aria-hidden="true" /> Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

/**
 * Inline theme toggle — same affordance as the standalone ThemeToggle
 * but rendered directly in the Topbar's right cluster so the icon
 * lives next to the other chrome controls.
 */
function ThemeInlineToggle({
  isDark,
  onToggle,
}: {
  isDark: boolean;
  onToggle: () => void;
}) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const Icon = mounted && isDark ? Moon : Sun;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={`Switch to ${mounted && isDark ? 'light' : 'dark'} theme`}
      className="flex h-9 w-9 items-center justify-center rounded-md text-[var(--fg-secondary)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]"
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}