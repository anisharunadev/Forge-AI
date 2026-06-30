'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ChevronsLeft,
  ChevronsRight,
  Settings as SettingsIcon,
  type LucideIcon
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { TenantSwitcher } from '@/components/tenant-switcher';
import { useAdminLLMHealth } from '@/lib/hooks/useLiteLLM';
import { useAuth } from '@/lib/api/auth';
import { useShell } from './ShellProvider';
import {
  GROUP_LABELS,
  ICONS,
  groupedNav,
  isNavMatch,
  type NavItem,
} from './nav-config';

/**
 * Width tokens for the shell sidebar.
 *
 *  - expanded  256px
 *  - collapsed 64px (icon-only)
 *
 * The 200ms transition matches `--motion-standard` from the Phase 1
 * token layer (see `app/globals.css`).
 */
const SIDEBAR_WIDTH_EXPANDED = 'w-[256px]';
const SIDEBAR_WIDTH_COLLAPSED = 'w-[64px]';
const SIDEBAR_TRANSITION = 'transition-[width] duration-200 ease-out-soft';

interface NavRowProps {
  readonly item: NavItem;
  readonly active: boolean;
  readonly collapsed: boolean;
}

function NavRow({ item, active, collapsed }: NavRowProps) {
  const Icon = ICONS[item.iconName];
  const linkContent = (
    <Link
      href={item.href}
      data-nav={item.label.toLowerCase()}
      data-active={active ? 'true' : 'false'}
      className={cn(
        // Layout
        'group relative flex items-center gap-2.5 rounded-md py-1.5 text-sm',
        // Spacing per state
        collapsed ? 'justify-center px-0' : 'pl-3 pr-2.5',
        // Transition for hover + active background
        'transition-colors duration-150 ease-out-soft',
        // Active state — 2px left rail + indigo wash + fg-primary + semibold
        active && [
          'bg-[rgba(99,102,241,0.08)]',
          'text-[var(--fg-primary)]',
          'font-semibold',
        ],
        // Inactive
        !active && [
          'text-[var(--fg-secondary)]',
          'hover:bg-[rgba(255,255,255,0.04)]',
          'hover:text-[var(--fg-primary)]',
        ],
        // Focus ring
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]',
      )}
      aria-label={collapsed ? item.label : undefined}
      aria-current={active ? 'page' : undefined}
    >
      {/* 2px left rail — visible only when active. CSS-only slide via
          opacity + transform keeps this framer-motion-free. */}
      <span
        aria-hidden="true"
        className={cn(
          'absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-r-full bg-[var(--accent-primary)]',
          'transition-all duration-200 ease-out-soft',
          active ? 'opacity-100 scale-y-100' : 'opacity-0 scale-y-50',
        )}
      />
      <Icon
        className={cn(
          'h-4 w-4 shrink-0',
          active ? 'text-[var(--accent-primary)]' : 'text-[var(--fg-tertiary)] group-hover:text-[var(--fg-primary)]',
        )}
        aria-hidden="true"
      />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </Link>
  );

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          <span className="font-medium">{item.label}</span>
        </TooltipContent>
      </Tooltip>
    );
  }
  return linkContent;
}

interface NavListProps {
  readonly pathname: string;
  readonly collapsed: boolean;
  readonly onNavigate?: () => void;
}

export function NavList({ pathname, collapsed }: NavListProps) {
  const groups = groupedNav();
  return (
    <nav className="flex flex-col gap-1" aria-label="Primary">
      {groups.map(({ group, items }, groupIdx) => (
        <div key={group} className={cn(groupIdx === 0 ? 'mt-0' : 'mt-5')}>
          {!collapsed && (
            <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--fg-tertiary)]">
              {GROUP_LABELS[group]}
            </p>
          )}
          <ul className={cn('space-y-0.5', collapsed && 'flex flex-col items-center')}>
            {items.map((item) => (
              <li key={item.href + '-' + item.label} className={cn(collapsed && 'flex justify-center')}>
                <NavRow item={item} active={isNavMatch(pathname, item)} collapsed={collapsed} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

// ponytail: Sidebar previously had its own hardcoded workspace switcher
// (mock Acme/Beta/Cosmic list + `⌘\` shortcut). Canonical TenantSwitcher
// now lives in Topbar; Sidebar renders the same component so workspace
// state stays in one place. The collapsed rail wraps it in a Tooltip
// so the 64px width stays usable.
/**
 * Tenant health status pill pinned to the bottom of the sidebar.
 *
 * Shows an emerald pulsing dot (animate-pulse) + "Healthy" + tenant
 * name + settings gear shortcut. In collapsed mode, the row collapses
 * to just the pulsing dot + gear (40x40 hits).
 */
function TenantStatusFooter({ collapsed }: { collapsed: boolean }) {
  const { tenant } = useAuth();
  const { data: health } = useAdminLLMHealth();
  // ponytail: status pill drives off the real /admin/llm-gateway/health
  // query; falls back to the previous "Healthy" copy if the hook has
  // not resolved yet (no network flapping in the footer).
  const isHealthy = health?.healthy ?? true;
  const statusTone = isHealthy ? 'var(--accent-emerald)' : 'var(--accent-rose)';
  const statusLabel = isHealthy ? 'Healthy' : 'Degraded';

  const pulseDot = (
    <span
      aria-hidden="true"
      className="relative inline-flex h-2 w-2 shrink-0 items-center justify-center"
    >
      <span
        className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
        style={{ background: statusTone }}
      />
      <span
        className="relative inline-flex h-2 w-2 rounded-full"
        style={{ background: statusTone }}
      />
    </span>
  );

  const tenantLabel = tenant?.name ?? tenant?.id ?? 'workspace';

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="flex h-10 w-10 items-center justify-center rounded-md hover:bg-[rgba(255,255,255,0.04)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]"
              aria-label={`Tenant ${statusLabel.toLowerCase()}`}
            >
              {pulseDot}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>
            <span className="font-medium">{`${statusLabel} · ${tenantLabel}`}</span>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              href="/admin"
              className="flex h-10 w-10 items-center justify-center rounded-md text-[var(--fg-tertiary)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]"
              aria-label="Workspace settings"
            >
              <SettingsIcon className="h-4 w-4" aria-hidden="true" />
            </Link>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>
            <span className="font-medium">Workspace settings</span>
          </TooltipContent>
        </Tooltip>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-2.5 py-2">
      <div className="flex items-center gap-2">
        {pulseDot}
        <span
          className="text-[11px] font-medium uppercase tracking-[0.08em]"
          style={{ color: statusTone }}
        >
          {statusLabel}
        </span>
        <span className="truncate text-xs text-[var(--fg-tertiary)]">· {tenantLabel}</span>
        <Link
          href="/admin"
          className="ml-auto flex h-6 w-6 items-center justify-center rounded text-[var(--fg-tertiary)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
          aria-label="Workspace settings"
        >
          <SettingsIcon className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}

/**
 * Persistent left sidebar. Hidden below `md` (the mobile sheet takes over).
 *
 * Width animates between 256px (expanded) and 64px (collapsed) over
 * 200ms with the easing curve from `--motion-ease-out`. The collapse
 * choice persists to localStorage (see `ShellProvider`).
 */
export function Sidebar() {
  const pathname = usePathname() ?? '/';
  const { sidebarCollapsed, toggleSidebar } = useShell();

  const CollapseIcon: LucideIcon = sidebarCollapsed ? ChevronsRight : ChevronsLeft;

  return (
    <TooltipProvider delayDuration={200}>
      <aside
        className={cn(
          'sticky top-0 hidden h-screen shrink-0 flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-surface)] md:flex',
          SIDEBAR_TRANSITION,
          sidebarCollapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED,
        )}
        data-testid="app-sidebar"
        data-collapsed={sidebarCollapsed ? 'true' : 'false'}
      >
        {/* Workspace switcher (top) — canonical TenantSwitcher; same
            component as the topbar so workspace state stays in one
            place. Wrapped in a tooltip when collapsed to keep the 64px
            rail usable. */}
        <div className={cn('flex shrink-0 items-center', sidebarCollapsed ? 'justify-center px-2 pt-4' : 'px-3 pt-4')}>
          {sidebarCollapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <TenantSwitcher />
                </span>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                <span className="font-medium">{`Workspace · click to switch`}</span>
              </TooltipContent>
            </Tooltip>
          ) : (
            <TenantSwitcher />
          )}
        </div>

        {/* Body — scrollable nav */}
        <ScrollArea className="flex-1">
          <div className={cn('pb-4 pt-3', sidebarCollapsed ? 'px-2' : 'px-2')}>
            <NavList pathname={pathname} collapsed={sidebarCollapsed} />
          </div>
        </ScrollArea>

        {/* Bottom: status pill + collapse toggle */}
        <div className={cn('shrink-0 space-y-2 border-t border-[var(--border-subtle)] pt-3', sidebarCollapsed ? 'px-2 pb-3' : 'px-3 pb-3')}>
          <TenantStatusFooter collapsed={sidebarCollapsed} />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={toggleSidebar}
                aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                className={cn(
                  'h-8 w-full text-xs text-[var(--fg-tertiary)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--fg-primary)]',
                  sidebarCollapsed && 'px-0',
                )}
              >
                <CollapseIcon className="h-3.5 w-3.5" aria-hidden="true" />
                {!sidebarCollapsed && <span className="ml-1.5">Collapse</span>}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>
              <span className="font-medium">{sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}</span>
              <span className="ml-2 text-[var(--fg-tertiary)]">{`[`} {sidebarCollapsed ? ']' : '['}</span>
            </TooltipContent>
          </Tooltip>
        </div>
      </aside>
    </TooltipProvider>
  );
}