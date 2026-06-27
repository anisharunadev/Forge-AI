'use client';

/**
 * UserMenu — Zone 8 (step-52).
 *
 * Replaces the hardcoded "Arun R. / arun@acme-corp.com" block in the
 * Topbar with the real user/tenant pulled from `useAuth`.
 *
 * Skill rules applied:
 *   - toast.success semantics on logout (UX skill, "Use toast variants").
 *   - Sign-out colour uses --accent-rose (matches the existing
 *     destructive DropdownMenuItem convention in Topbar.tsx).
 */

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Keyboard,
  LogOut,
  Settings as SettingsIcon,
  Shield,
  User as UserIcon,
} from 'lucide-react';
import { toast } from 'sonner';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/lib/api/auth';

function initials(name?: string | null, email?: string | null): string {
  const trimmedName = name?.trim() ?? '';
  const emailLocal = email?.split('@')[0] ?? '';
  const source = trimmedName || emailLocal || '';
  if (!source) return '?';
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const first = parts[0]?.[0] ?? '';
    const second = parts[1]?.[0] ?? '';
    return `${first}${second}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

export function UserMenu() {
  const router = useRouter();
  const { user, tenant, logout } = useAuth();
  const [mounted, setMounted] = React.useState(false);

  // Avoid SSR/CSR mismatch: the persisted avatar/name may differ from
  // what the server rendered. We render the initials placeholder until
  // hydration is complete, then swap to the real values.
  React.useEffect(() => setMounted(true), []);

  const displayName = mounted ? user?.name ?? 'Signed out' : '…';
  const displayEmail = mounted ? user?.email ?? '' : '';
  const fallback = initials(displayName, displayEmail);

  const handleLogout = () => {
    logout();
    toast.success('Signed out');
    router.replace('/login');
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="User menu"
          data-testid="user-menu-trigger"
          className="ml-1 flex h-9 items-center gap-2 rounded-md px-1.5 text-sm text-[var(--fg-secondary)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]"
        >
          <Avatar className="h-7 w-7">
            {user?.avatar_url ? (
              <AvatarImage src={user.avatar_url} alt={user.name} />
            ) : null}
            <AvatarFallback className="bg-gradient-to-br from-[var(--accent-violet)] to-[var(--accent-primary)] text-[10px] font-bold text-white">
              {fallback}
            </AvatarFallback>
          </Avatar>
          <span className="hidden font-medium lg:inline">{displayName}</span>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        sideOffset={6}
        className="w-56 border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--fg-primary)]"
        data-testid="user-menu-content"
      >
        <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--fg-tertiary)]">
          Signed in as
        </DropdownMenuLabel>
        <div className="px-2 pb-2">
          <p className="truncate text-sm font-semibold text-[var(--fg-primary)]">
            {displayName}
          </p>
          <p className="truncate text-xs text-[var(--fg-tertiary)]">
            {displayEmail}
          </p>
          {tenant ? (
            <p className="mt-1 truncate text-[11px] text-[var(--fg-tertiary)]">
              {tenant.name}
            </p>
          ) : null}
        </div>
        <DropdownMenuSeparator className="bg-[var(--border-subtle)]" />
        <DropdownMenuItem
          asChild
          className="gap-2 focus:bg-[rgba(255,255,255,0.06)] focus:text-[var(--fg-primary)]"
        >
          <Link href="/settings/profile">
            <UserIcon className="h-4 w-4" aria-hidden="true" /> Profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          asChild
          className="gap-2 focus:bg-[rgba(255,255,255,0.06)] focus:text-[var(--fg-primary)]"
        >
          <Link href="/settings/workspace">
            <SettingsIcon className="h-4 w-4" aria-hidden="true" /> Workspace
            settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          asChild
          className="gap-2 focus:bg-[rgba(255,255,255,0.06)] focus:text-[var(--fg-primary)]"
        >
          <Link href="/governance">
            <Shield className="h-4 w-4" aria-hidden="true" /> Governance
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          asChild
          className="gap-2 focus:bg-[rgba(255,255,255,0.06)] focus:text-[var(--fg-primary)]"
        >
          <Link href="/help/keyboard-shortcuts">
            <Keyboard className="h-4 w-4" aria-hidden="true" /> Keyboard shortcuts
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator className="bg-[var(--border-subtle)]" />
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            handleLogout();
          }}
          className="gap-2 text-[var(--accent-rose)] focus:bg-[rgba(255,255,255,0.06)] focus:text-[var(--accent-rose)]"
          data-testid="user-menu-logout"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}