'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Settings as SettingsIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { SEED_TENANT_ID, SEED_TENANT_NAME } from '@/lib/auth';
import {
  GROUP_LABELS,
  ICONS,
  groupedNav,
  isNavMatch,
  type NavItem,
} from './nav-config';

interface NavListProps {
  readonly pathname: string;
  readonly onNavigate?: () => void;
}

/**
 * Shared grouped nav list — used by both the desktop `<Sidebar>` and
 * the mobile `<MobileNav>` sheet so the IA renders identically.
 */
export function NavList({ pathname, onNavigate }: NavListProps) {
  const groups = groupedNav();
  return (
    <nav className="flex flex-col gap-1" aria-label="Primary">
      {groups.map(({ group, items }) => (
        <div key={group} className="mt-4 first:mt-0">
          <p className="px-2 pb-1 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
            {GROUP_LABELS[group]}
          </p>
          <ul className="space-y-0.5">
            {items.map((item) => {
              const Icon = ICONS[item.iconName];
              const active = isNavMatch(pathname, item);
              return (
                <li key={item.href + '-' + item.label}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    data-nav={item.label.toLowerCase()}
                    data-active={active ? 'true' : 'false'}
                    className={cn(
                      'group flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition',
                      active
                        ? 'bg-primary/15 text-primary font-medium'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <Icon
                      className={cn(
                        'h-4 w-4 shrink-0',
                        active
                          ? 'text-primary'
                          : 'text-muted-foreground group-hover:text-primary',
                      )}
                      aria-hidden="true"
                    />
                    <span className="truncate">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {group !== 'lifecycle' ? <Separator className="mt-3 opacity-0" /> : null}
        </div>
      ))}
    </nav>
  );
}

/**
 * Persistent left sidebar — same for every page.
 * Hidden below the `md` breakpoint (the mobile sheet takes over).
 */
export function Sidebar() {
  const pathname = usePathname() ?? '/';

  return (
    <aside
      className="hidden w-60 shrink-0 border-r border-border bg-card/80 backdrop-blur md:flex md:flex-col"
      data-testid="app-sidebar"
    >
      {/* Brand */}
      <Link
        href="/dashboard"
        className="flex items-center gap-2 px-5 py-4"
        aria-label="Forge AI — back to dashboard"
      >
        <div className="forge-mark" aria-hidden="true">
          <span className="text-sm font-bold">F</span>
        </div>
        <div className="leading-tight">
          <p className="text-sm font-semibold tracking-tight">Forge AI</p>
          <p className="text-2xs uppercase tracking-wider text-muted-foreground">
            Agent OS
          </p>
        </div>
      </Link>

      {/* Body */}
      <ScrollArea className="flex-1">
        <div className="px-3 pb-6">
          <NavList pathname={pathname} />
        </div>
      </ScrollArea>

      {/* Tenant footer */}
      <TenantFooter />
    </aside>
  );
}

function TenantFooter() {
  return (
    <div className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate" title={SEED_TENANT_ID}>
          tenant · {SEED_TENANT_NAME}
        </span>
      </div>
      <div className="mt-1 truncate font-mono text-2xs text-muted-foreground/70">
        {SEED_TENANT_ID}
      </div>
      <div className="mt-3 flex items-center justify-between">
        <Link
          href="/healthz"
          className="inline-flex items-center gap-1.5 hover:text-foreground"
          data-testid="sidebar-healthz"
        >
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-success" />
          health
        </Link>
        <Link
          href="/admin"
          className="inline-flex items-center gap-1 hover:text-foreground"
          aria-label="Settings"
        >
          <SettingsIcon className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
