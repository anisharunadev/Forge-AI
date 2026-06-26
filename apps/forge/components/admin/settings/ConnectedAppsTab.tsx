'use client';

/**
 * Settings — Connected Apps tab (Step-47 Enterprise section).
 *
 * OAuth apps you've authorized — each row shows icon, name,
 * developer, scopes granted, authorized + last-used dates, expand
 * to see full scope list, and a rose "Revoke access" with confirm.
 *
 * Category filter pills (All / Productivity / Dev tools /
 * Communication / Data) sit above the list.
 */

import * as React from 'react';
import {
  Store,
  Calendar,
  Code2 as Github,
  MessageSquare,
  Database,
  ChevronDown,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/shell';
import { cn } from '@/lib/utils';

type Category = 'productivity' | 'dev' | 'communication' | 'data';

interface ConnectedApp {
  id: string;
  name: string;
  developer: string;
  category: Category;
  scopes: ReadonlyArray<string>;
  authorizedAt: string;
  lastUsedAt: string | null;
  Icon: React.ComponentType<{ className?: string }>;
  color: string;
}

const SEED: ReadonlyArray<ConnectedApp> = [
  {
    id: 'a-1',
    name: 'GitHub',
    developer: 'GitHub, Inc.',
    category: 'dev',
    scopes: ['Read projects', 'Write stories', 'Manage webhooks'],
    authorizedAt: '2026-01-04T10:11:00Z',
    lastUsedAt: '2026-06-27T05:48:00Z',
    Icon: Github,
    color: '#FFFFFF',
  },
  {
    id: 'a-2',
    name: 'Google Calendar',
    developer: 'Google LLC',
    category: 'productivity',
    scopes: ['Read events', 'Create events'],
    authorizedAt: '2026-02-11T14:30:00Z',
    lastUsedAt: '2026-06-26T20:11:00Z',
    Icon: Calendar,
    color: '#4285F4',
  },
  {
    id: 'a-3',
    name: 'Slack',
    developer: 'Slack Technologies',
    category: 'communication',
    scopes: ['Read channels', 'Post messages'],
    authorizedAt: '2026-03-22T08:00:00Z',
    lastUsedAt: '2026-06-27T05:32:00Z',
    Icon: MessageSquare,
    color: '#4A154B',
  },
  {
    id: 'a-4',
    name: 'Snowflake Mirror',
    developer: 'Acme Analytics',
    category: 'data',
    scopes: ['Read datasets', 'Write datasets'],
    authorizedAt: '2026-05-09T16:45:00Z',
    lastUsedAt: null,
    Icon: Database,
    color: '#29B5E8',
  },
];

const STORAGE_KEY = 'forge.connected-apps.v1';

function loadApps(): ConnectedApp[] {
  if (typeof window === 'undefined') return [...SEED];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [...SEED];
    return JSON.parse(raw) as ConnectedApp[];
  } catch {
    return [...SEED];
  }
}

function persistApps(a: ConnectedApp[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(a));
  } catch {
    /* noop */
  }
}

const CATEGORY_FILTERS: ReadonlyArray<{ id: 'all' | Category; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'productivity', label: 'Productivity' },
  { id: 'dev', label: 'Dev tools' },
  { id: 'communication', label: 'Communication' },
  { id: 'data', label: 'Data' },
];

export function ConnectedAppsTab() {
  const [apps, setApps] = React.useState<ReadonlyArray<ConnectedApp>>(SEED);
  const [filter, setFilter] = React.useState<'all' | Category>('all');
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = React.useState<ConnectedApp | null>(null);

  React.useEffect(() => {
    setApps(loadApps());
  }, []);

  const visible = apps.filter((a) => filter === 'all' || a.category === filter);

  const revoke = (id: string) => {
    const next = apps.filter((a) => a.id !== id);
    setApps(next);
    persistApps(next);
    setConfirmRevoke(null);
  };

  return (
    <div className="flex flex-col gap-6" data-testid="connected-apps-tab">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[var(--text-2xl)] font-semibold text-[var(--fg-primary)]">
            Connected apps
          </h2>
          <p className="mt-1 max-w-xl text-[var(--text-sm)] text-[var(--fg-secondary)]">
            Third-party OAuth apps you've authorized. Revoke access if you no longer use them.
          </p>
        </div>
        <Button variant="outline" data-testid="connected-apps-marketplace">
          <Store className="h-3.5 w-3.5" aria-hidden="true" />
          Browse marketplace
        </Button>
      </header>

      <div className="flex flex-wrap gap-2" role="tablist" data-testid="connected-apps-filters">
        {CATEGORY_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={cn(
              'inline-flex h-8 items-center rounded-full border px-3 text-[var(--text-xs)] font-medium transition-colors',
              filter === f.id
                ? 'border-[var(--accent-primary)]/40 bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]'
                : 'border-[var(--border-subtle)] bg-[var(--bg-inset)] text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]',
            )}
            data-testid={`connected-apps-filter-${f.id}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={<Store className="h-5 w-5" aria-hidden="true" />}
          title="No apps connected"
          description="Browse the marketplace to find apps that integrate with Forge."
          testId="connected-apps-empty"
          action={
            <Button variant="outline" data-testid="connected-apps-empty-cta">
              <Store className="h-3.5 w-3.5" aria-hidden="true" />
              Browse marketplace
            </Button>
          }
        />
      ) : (
        <ul className="flex flex-col gap-3" data-testid="connected-apps-list">
          {visible.map((app) => (
            <AppRow
              key={app.id}
              app={app}
              expanded={expanded === app.id}
              onToggle={() =>
                setExpanded((prev) => (prev === app.id ? null : app.id))
              }
              onRevoke={() => setConfirmRevoke(app)}
            />
          ))}
        </ul>
      )}

      <Dialog
        open={confirmRevoke !== null}
        onOpenChange={(o) => {
          if (!o) setConfirmRevoke(null);
        }}
      >
        <DialogContent data-testid="connected-apps-revoke-dialog">
          <DialogHeader>
            <DialogTitle>Revoke access?</DialogTitle>
            <DialogDescription>
              "{confirmRevoke?.name}" will lose access to your Forge workspace immediately. The
              developer will be notified and can request re-authorization next time.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRevoke(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => confirmRevoke && revoke(confirmRevoke.id)}
              data-testid="connected-apps-revoke-confirm"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              Revoke access
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ---------------- App Row ---------------- */

interface AppRowProps {
  app: ConnectedApp;
  expanded: boolean;
  onToggle: () => void;
  onRevoke: () => void;
}

function AppRow({ app, expanded, onToggle, onRevoke }: AppRowProps) {
  const Icon = app.Icon;
  return (
    <li
      className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5"
      data-testid={`app-row-${app.id}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)]"
            style={{ color: app.color }}
          >
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="text-[var(--text-sm)] font-semibold text-[var(--fg-primary)]">
                {app.name}
              </span>
              <span className="text-[var(--text-xs)] text-[var(--fg-tertiary)]">
                by {app.developer}
              </span>
            </div>
            <p className="truncate text-[var(--text-xs)] text-[var(--fg-secondary)]">
              {app.scopes.slice(0, 2).join(' · ')}
              {app.scopes.length > 2 ? ` · +${app.scopes.length - 2} more` : ''}
            </p>
            <p className="text-[11px] text-[var(--fg-tertiary)]">
              Authorized {new Date(app.authorizedAt).toLocaleDateString()}
              {app.lastUsedAt
                ? ` · Last used ${new Date(app.lastUsedAt).toLocaleDateString()}`
                : ' · Never used'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggle}
            data-testid={`app-permissions-${app.id}`}
            aria-expanded={expanded}
          >
            Permissions
            <ChevronDown
              className={cn(
                'h-3.5 w-3.5 transition-transform',
                expanded && 'rotate-180',
              )}
              aria-hidden="true"
            />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-[var(--accent-rose)] hover:bg-[var(--accent-rose)]/10 hover:text-[var(--accent-rose)]"
            onClick={onRevoke}
            data-testid={`app-revoke-${app.id}`}
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            Revoke
          </Button>
        </div>
      </div>

      {expanded ? (
        <div
          className="mt-4 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-3"
          data-testid={`app-permissions-list-${app.id}`}
        >
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
            Granted scopes
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {app.scopes.map((s) => (
              <li
                key={s}
                className="flex items-center gap-2 text-[var(--text-xs)] text-[var(--fg-secondary)]"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-emerald)]" />
                {s}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </li>
  );
}
