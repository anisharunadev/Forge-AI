'use client';

/**
 * SettingsSidebar — vertical 240px sticky nav for the Settings page
 * (Step-47 expansion: 10 → 21 tabs grouped into Account / Workspace /
 * Enterprise sections).
 *
 * Step-62 Zone 8 — count badges are now driven by `useSettingsCounts`,
 * which calls `/projects/{id}/settings/counts`. Until that hook
 * resolves, badges fall back to the previous hardcoded defaults so the
 * sidebar layout never shifts in width.
 */

import * as React from 'react';
import { motion } from 'framer-motion';
import {
  Building2,
  Users,
  Bot,
  KeyRound,
  Eye,
  PlugZap,
  Workflow,
  History,
  Cpu,
  Sprout,
  UserCircle,
  MonitorSmartphone,
  Bell,
  Key,
  Webhook,
  AppWindow,
  ShieldCheck,
  Palette,
  CreditCard,
  FlaskConical,
  KeyboardIcon,
  type LucideIcon,
} from 'lucide-react';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { useSettingsCounts } from '@/lib/hooks/useSettingsCounts';

export type SettingsSectionId =
  // Account
  | 'profile'
  | 'sessions'
  | 'notifications'
  | 'api-tokens'
  // Workspace
  | 'general'
  | 'members'
  | 'agents'
  | 'providers'
  | 'env-vars'
  | 'integrations'
  | 'workflow'
  | 'audit'
  // Enterprise
  | 'ai-gateway'
  | 'seeds'
  | 'webhooks'
  | 'connected-apps'
  | 'sso'
  | 'branding'
  | 'billing'
  | 'feature-flags'
  | 'shortcuts';

export type SettingsGroupId = 'account' | 'workspace' | 'enterprise';

export interface SettingsSection {
  id: SettingsSectionId;
  label: string;
  icon: LucideIcon;
  /** Semantic accent for the icon glyph (matches the goal spec). */
  accentVar: string;
  /** Optional count badge (e.g. members count). */
  count?: number;
}

export interface SettingsGroup {
  id: SettingsGroupId;
  label: string;
  sections: ReadonlyArray<SettingsSection>;
}

export const SETTINGS_GROUPS: ReadonlyArray<SettingsGroup> = [
  {
    id: 'account',
    label: 'Account',
    sections: [
      { id: 'profile',       label: 'Profile',       icon: UserCircle,       accentVar: 'var(--accent-primary)' },
      { id: 'sessions',      label: 'Sessions',      icon: MonitorSmartphone, accentVar: 'var(--accent-cyan)' },
      { id: 'notifications', label: 'Notifications', icon: Bell,             accentVar: 'var(--accent-amber)' },
      { id: 'api-tokens',    label: 'API Tokens',    icon: Key,              accentVar: 'var(--accent-violet)' },
    ],
  },
  {
    id: 'workspace',
    label: 'Workspace',
    sections: [
      { id: 'general',      label: 'General',      icon: Building2, accentVar: 'var(--accent-primary)' },
      { id: 'members',      label: 'Members',      icon: Users,     accentVar: 'var(--accent-emerald)' },
      { id: 'agents',       label: 'Agents',       icon: Bot,       accentVar: 'var(--accent-cyan)' },
      { id: 'providers',    label: 'Providers',    icon: KeyRound,  accentVar: 'var(--accent-violet)' },
      { id: 'env-vars',     label: 'Env Vars',     icon: Eye,       accentVar: 'var(--accent-amber)' },
      { id: 'integrations', label: 'Integrations', icon: PlugZap,   accentVar: 'var(--accent-primary)' },
      { id: 'workflow',     label: 'Workflow',     icon: Workflow,  accentVar: 'var(--accent-cyan)' },
      { id: 'audit',        label: 'Audit',        icon: History,   accentVar: 'var(--accent-emerald)' },
    ],
  },
  {
    id: 'enterprise',
    label: 'Enterprise',
    sections: [
      { id: 'ai-gateway',      label: 'AI Gateway',      icon: Cpu,            accentVar: 'var(--accent-violet)' },
      { id: 'seeds',           label: 'Seeds',           icon: Sprout,         accentVar: 'var(--accent-emerald)' },
      { id: 'webhooks',        label: 'Webhooks',        icon: Webhook,        accentVar: 'var(--accent-cyan)' },
      { id: 'connected-apps',  label: 'Connected Apps',  icon: AppWindow,      accentVar: 'var(--accent-primary)' },
      { id: 'sso',             label: 'SSO',             icon: ShieldCheck,    accentVar: 'var(--accent-emerald)' },
      { id: 'branding',        label: 'Branding',        icon: Palette,        accentVar: 'var(--accent-violet)' },
      { id: 'billing',         label: 'Billing',         icon: CreditCard,     accentVar: 'var(--accent-amber)' },
      { id: 'feature-flags',   label: 'Feature Flags',   icon: FlaskConical,   accentVar: 'var(--accent-cyan)' },
      { id: 'shortcuts',       label: 'Keyboard',        icon: KeyboardIcon,   accentVar: 'var(--fg-secondary)' },
    ],
  },
];

/** Flat array (legacy export — used by index.ts and tests). */
export const SETTINGS_SECTIONS: ReadonlyArray<SettingsSection> = SETTINGS_GROUPS.flatMap(
  (g) => g.sections,
);

export interface SettingsSidebarProps {
  active: SettingsSectionId;
  onChange: (id: SettingsSectionId) => void;
  counts?: Partial<Record<SettingsSectionId, number>>;
  lastChange?: {
    whenLabel: string;
    actorName: string;
  };
}

/** Fallback counts that match the previous hardcoded layout. */
const FALLBACK_COUNTS: Partial<Record<SettingsSectionId, number>> = {
  members: 6,
  agents: 8,
  providers: 4,
  'env-vars': 12,
  integrations: 5,
  sessions: 4,
  'api-tokens': 3,
  webhooks: 2,
  'connected-apps': 4,
  'feature-flags': 6,
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function SettingsSidebar({
  active,
  onChange,
  counts,
  lastChange = { whenLabel: '12m ago', actorName: 'Arun' },
}: SettingsSidebarProps) {
  const { data: liveCounts } = useSettingsCounts();

  const resolvedCounts: Partial<Record<SettingsSectionId, number>> = {
    ...FALLBACK_COUNTS,
    ...(liveCounts
      ? {
          members: liveCounts.members,
          agents: liveCounts.agents,
          providers: liveCounts.providers,
          'env-vars': liveCounts.env_vars,
          integrations: liveCounts.integrations,
          webhooks: liveCounts.webhooks,
          'connected-apps': liveCounts.connected_apps,
          'feature-flags': liveCounts.feature_flags,
        }
      : {}),
    ...(counts ?? {}),
  };

  return (
    <aside
      className="sticky top-6 flex h-fit w-[240px] flex-col gap-4 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4"
      aria-label="Settings sections"
      data-testid="settings-sidebar"
    >
      <header className="flex flex-col gap-1 border-b border-[var(--border-subtle)] pb-4">
        <p className="text-[var(--text-xs)] uppercase tracking-widest text-[var(--fg-tertiary)]">
          Project settings
        </p>
        <h2
          className="text-[var(--text-xl)] text-[var(--fg-primary)]"
          style={{ fontWeight: 'var(--font-weight-bold)' }}
        >
          Settings
        </h2>
        <p className="text-[var(--text-sm)] text-[var(--fg-secondary)]">
          Configure your account, workspace, and enterprise controls.
        </p>
      </header>

      <nav className="flex flex-col gap-3" role="list">
        {SETTINGS_GROUPS.map((group) => (
          <div
            key={group.id}
            className="flex flex-col gap-1"
            data-testid={`settings-group-${group.id}`}
          >
            <p
              className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-[var(--fg-tertiary)]"
              data-testid={`settings-group-label-${group.id}`}
            >
              {group.label}
            </p>
            <div className="flex flex-col gap-0.5" role="list">
              {group.sections.map((section) => {
                const Icon = section.icon;
                const isActive = section.id === active;
                const count = resolvedCounts[section.id];
                return (
                  <button
                    key={section.id}
                    type="button"
                    role="listitem"
                    onClick={() => onChange(section.id)}
                    aria-current={isActive ? 'page' : undefined}
                    className={cn(
                      'group relative flex w-full items-center gap-3 rounded-[var(--radius-md)] px-3 py-1.5 text-left transition-colors',
                      isActive
                        ? 'bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]'
                        : 'text-[var(--fg-secondary)] hover:bg-[var(--bg-inset)] hover:text-[var(--fg-primary)]',
                    )}
                    style={{ fontWeight: 'var(--font-weight-medium)' }}
                    data-testid={`settings-nav-${section.id}`}
                  >
                    {isActive ? (
                      <motion.span
                        layoutId="settings-rail"
                        className="absolute left-0 top-1/2 h-6 w-[2px] -translate-y-1/2 rounded-r bg-[var(--accent-primary)]"
                        transition={{
                          type: 'tween',
                          duration: 0.18,
                          ease: [0.16, 1, 0.3, 1],
                        }}
                      />
                    ) : null}
                    <Icon
                      className="h-4 w-4 shrink-0"
                      style={{ color: section.accentVar }}
                      aria-hidden="true"
                    />
                    <span className="flex-1 text-[var(--text-sm)]">{section.label}</span>
                    {typeof count === 'number' && count > 0 ? (
                      <span
                        className="inline-flex items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-1.5 text-[10px] font-semibold text-[var(--fg-secondary)]"
                        data-testid={`settings-nav-count-${section.id}`}
                      >
                        {count}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <footer className="flex items-center gap-2 border-t border-[var(--border-subtle)] pt-3 text-[var(--text-xs)] text-[var(--fg-tertiary)]">
        <Avatar className="h-6 w-6">
          <AvatarFallback className="bg-[var(--bg-inset)] text-[9px] text-[var(--fg-secondary)]">
            {initials(lastChange.actorName)}
          </AvatarFallback>
        </Avatar>
        <div className="flex flex-col leading-tight">
          <span>Last change: {lastChange.whenLabel}</span>
          <span className="text-[var(--fg-muted)]">by {lastChange.actorName}</span>
        </div>
      </footer>
    </aside>
  );
}
