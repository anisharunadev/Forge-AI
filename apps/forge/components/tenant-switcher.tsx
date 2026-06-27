'use client';

/**
 * TenantSwitcher — Zone 6 (step-52).
 *
 * Replaces the mocked tenant selector in the top bar. Opens a popover
 * listing every workspace the current user belongs to, plus a "Create
 * new workspace" entry that links to the onboarding wizard.
 *
 * Data flow:
 *   1. On open, fetch GET /auth/me/tenants (cached via React Query in
 *      the caller; here we use local state to keep this component
 *      dependency-free).
 *   2. On select, call useAuth.switchTenant(id). That posts to
 *      /tenants/{id}/switch, gets back a new access token scoped to
 *      the selected tenant, and reloads the page so every TanStack
 *      Query / Zustand store keyed on tenant-id refetches.
 *   3. The reload is intentional — documented in the goal file as the
 *      simplest way to force a tenant-scope reset across all stores.
 *
 * Skill rules applied (UX):
 *   - Sidebar / popover pattern via SidebarProvider at layout level
 *     — the topbar popover uses Radix Popover primitives.
 *   - Empty state uses the design-system empty microcopy rules.
 */

import * as React from 'react';
import Link from 'next/link';
import {
  Building2,
  Check,
  ChevronDown,
  Loader2,
  Plus,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth, type Tenant } from '@/lib/api/auth';
import { api, ApiError } from '@/lib/api/client';
import { toast } from 'sonner';

const PLAN_LABELS: Record<Tenant['plan'], string> = {
  free: 'Free',
  pro: 'Pro',
  enterprise: 'Enterprise',
};

export function TenantSwitcher() {
  const { tenant, switchTenant } = useAuth();
  const [open, setOpen] = React.useState(false);
  const [tenants, setTenants] = React.useState<Tenant[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [switchingId, setSwitchingId] = React.useState<string | null>(null);

  const loadTenants = React.useCallback(async () => {
    if (tenants !== null) return; // cache hit
    setLoading(true);
    try {
      const list = await api.get<Tenant[]>('/auth/me/tenants');
      setTenants(list);
    } catch (err) {
      // Surface the error but don't close the popover — the user
      // should still see "no tenants loaded" rather than a blank list.
      const message =
        err instanceof ApiError && err.status === 0
          ? 'Cannot reach the server.'
          : 'Could not load your workspaces.';
      toast.error(message);
      setTenants([]); // mark as loaded-empty so we don't spin forever
    } finally {
      setLoading(false);
    }
  }, [tenants]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) loadTenants();
  };

  const handleSelect = async (id: string) => {
    if (id === tenant?.id) {
      setOpen(false);
      return;
    }
    setSwitchingId(id);
    try {
      // switchTenant reloads the page on success.
      await switchTenant(id);
      // Page reload happens here — no further UI to update.
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Could not switch workspace.';
      toast.error(message);
      setSwitchingId(null);
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Switch workspace — currently ${tenant?.name ?? 'none'}`}
          className="h-9 gap-2 px-2 text-[var(--fg-primary)] hover:bg-[rgba(255,255,255,0.04)]"
          data-testid="tenant-switcher-trigger"
        >
          <Avatar className="h-6 w-6 rounded-md">
            {tenant?.logo_url ? (
              <AvatarImage src={tenant.logo_url} alt={tenant.name} />
            ) : null}
            <AvatarFallback className="rounded-md bg-gradient-to-br from-[var(--accent-violet)] to-[var(--accent-primary)] text-[10px] font-bold text-white">
              {tenant?.name?.[0]?.toUpperCase() ?? 'W'}
            </AvatarFallback>
          </Avatar>
          <span className="hidden max-w-[140px] truncate text-sm font-medium md:inline">
            {tenant?.name ?? 'Select workspace'}
          </span>
          <ChevronDown className="h-3.5 w-3.5 text-[var(--fg-tertiary)]" aria-hidden="true" />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-72 border-[var(--border-default)] bg-[var(--bg-elevated)] p-1 text-[var(--fg-primary)]"
        data-testid="tenant-switcher-content"
      >
        <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--fg-tertiary)]">
          Your workspaces
        </div>

        {loading ? (
          <div className="space-y-1 px-1 py-1">
            {[0, 1].map((i) => (
              <div key={i} className="flex items-center gap-2 px-2 py-2">
                <Skeleton className="h-6 w-6 rounded-md" />
                <div className="flex-1 space-y-1">
                  <Skeleton className="h-3.5 w-32" />
                  <Skeleton className="h-3 w-16" />
                </div>
              </div>
            ))}
          </div>
        ) : tenants && tenants.length === 0 ? (
          <div className="px-2 py-3 text-sm text-[var(--fg-tertiary)]">
            No workspaces yet.
          </div>
        ) : (
          <ul role="listbox" className="max-h-72 overflow-y-auto">
            {(tenants ?? []).map((t) => {
              const isActive = t.id === tenant?.id;
              const isSwitching = switchingId === t.id;
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    disabled={isSwitching}
                    onClick={() => handleSelect(t.id)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-[rgba(255,255,255,0.04)] focus-visible:bg-[rgba(255,255,255,0.04)] focus-visible:outline-none disabled:opacity-60"
                  >
                    <Avatar className="h-6 w-6 rounded-md">
                      {t.logo_url ? (
                        <AvatarImage src={t.logo_url} alt={t.name} />
                      ) : null}
                      <AvatarFallback className="rounded-md bg-[var(--bg-inset)] text-[10px] font-bold text-[var(--fg-secondary)]">
                        {t.name[0]?.toUpperCase() ?? 'W'}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-medium">{t.name}</span>
                        {isActive ? (
                          <Check
                            className="h-3.5 w-3.5 shrink-0 text-[var(--accent-primary)]"
                            aria-hidden="true"
                          />
                        ) : null}
                      </div>
                      <div className="text-[11px] text-[var(--fg-tertiary)]">
                        {PLAN_LABELS[t.plan] ?? t.plan} · {t.region}
                      </div>
                    </div>
                    {isSwitching ? (
                      <Loader2
                        className="h-3.5 w-3.5 animate-spin text-[var(--fg-tertiary)]"
                        aria-hidden="true"
                      />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <Separator className="my-1 bg-[var(--border-subtle)]" />

        <Link
          href="/onboarding/workspace"
          onClick={() => setOpen(false)}
          className="flex items-center gap-2 rounded-md px-2 py-2 text-sm text-[var(--accent-primary)] hover:bg-[rgba(255,255,255,0.04)] focus-visible:bg-[rgba(255,255,255,0.04)] focus-visible:outline-none"
        >
          {tenants && tenants.length === 0 ? (
            <Building2 className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Plus className="h-4 w-4" aria-hidden="true" />
          )}
          {tenants && tenants.length === 0
            ? 'Create your first workspace'
            : 'Create new workspace'}
        </Link>
      </PopoverContent>
    </Popover>
  );
}