'use client';

/**
 * `<DestinationsTab>` — Step 28 + M4 Track B (T-B5 / M4-G9).
 *
 * Grid of sync destinations (Jira, Confluence, AI agent via MCP, Slack,
 * Teams, email digest, GitHub mirror). Mirrors the layout of
 * `<SourcesTab>` for visual consistency.
 *
 * M4 rewire: reads from the live `useDestinations()` hook
 * (GET /ideation/destinations). Destinations are grouped by `kind` in
 * the render so PMs see Jira+Linear together, Chat destinations
 * together, etc. — per-spec "configured push targets grouped by
 * kind".
 *
 * Connectors with `has_connector === false` render a 'Connect' CTA
 * (the connector-center pickup); true ones render 'Configure'.
 */

import * as React from 'react';
import {
  BookOpen,
  CheckCircle2,
  Code,
  Cog,
  Inbox,
  Mail,
  MessageSquare,
  Plug,
  Settings,
  Sparkles,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

import { IdeationQueryState } from '@/components/ideation/IdeationQueryState';
import { useDestinations } from '@/lib/hooks/useIdeation';
import type { DestinationRead, DestinationKind } from '@/lib/ideation/types';

// ---------------------------------------------------------------------------
// Icon mapping — wire string → Lucide component.
// ---------------------------------------------------------------------------

const ICON_LOOKUP: Record<string, LucideIcon> = {
  BookOpen,
  Code,
  Sparkles,
  Slack: MessageSquare, // Slack glyph dropped during lint cleanup; fallback matches the prior fixture
  Github: Code,
  Mail,
  MessageSquare,
  TrendingUp,
};

function iconForDestination(name: string): LucideIcon {
  return ICON_LOOKUP[name] ?? Code;
}

// ---------------------------------------------------------------------------
// Kind label + grouping.
// ---------------------------------------------------------------------------

const KIND_LABEL: Record<DestinationKind, string> = {
  pm: 'Project management',
  docs: 'Docs',
  ide: 'IDE execution',
  chat: 'Notifications',
  digest: 'Email',
  mirror: 'Mirror',
};

function groupByKind(
  rows: ReadonlyArray<DestinationRead>,
): Array<{ kind: DestinationKind; label: string; rows: ReadonlyArray<DestinationRead> }> {
  const buckets = new Map<DestinationKind, DestinationRead[]>();
  for (const r of rows) {
    const arr = buckets.get(r.kind) ?? [];
    arr.push(r);
    buckets.set(r.kind, arr);
  }
  // Stable iteration order matching KIND_LABEL keys.
  return (Object.keys(KIND_LABEL) as DestinationKind[])
    .filter((k) => (buckets.get(k)?.length ?? 0) > 0)
    .map((k) => ({
      kind: k,
      label: KIND_LABEL[k],
      rows: buckets.get(k)!,
    }));
}

// ---------------------------------------------------------------------------
// Accent classes (preserved from the fixture card).
// ---------------------------------------------------------------------------

function accentClasses(accent: DestinationRead['accent']): {
  ring: string;
  bg: string;
  text: string;
} {
  switch (accent) {
    case 'cyan':
      return { ring: 'ring-[rgba(34,211,238,0.35)]', bg: 'bg-[rgba(34,211,238,0.10)]', text: 'text-[var(--accent-cyan)]' };
    case 'amber':
      return { ring: 'ring-[rgba(245,158,11,0.35)]', bg: 'bg-[rgba(245,158,11,0.10)]', text: 'text-[var(--accent-amber)]' };
    case 'indigo':
      return { ring: 'ring-[rgba(99,102,241,0.35)]', bg: 'bg-[rgba(99,102,241,0.10)]', text: 'text-[var(--accent-primary)]' };
    case 'violet':
      return { ring: 'ring-[rgba(168,85,247,0.35)]', bg: 'bg-[rgba(168,85,247,0.10)]', text: 'text-[var(--accent-violet)]' };
    case 'rose':
      return { ring: 'ring-[rgba(244,63,94,0.35)]', bg: 'bg-[rgba(244,63,94,0.10)]', text: 'text-[var(--accent-rose)]' };
    case 'emerald':
      return { ring: 'ring-[rgba(16,185,129,0.35)]', bg: 'bg-[rgba(16,185,129,0.10)]', text: 'text-[var(--accent-emerald)]' };
  }
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

function DestinationCardGrid({ destination }: { destination: DestinationRead }) {
  const accent = accentClasses(destination.accent);
  const Icon = iconForDestination(destination.icon);
  const connected = destination.status === 'connected' || destination.status === 'syncing';

  return (
    <article
      data-testid="destination-card"
      data-destination-id={destination.id}
      data-destination-status={destination.status}
      className={cn(
        'flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 transition-[border,transform] duration-200 ease-out-soft hover:-translate-y-px hover:border-[var(--border-default)]',
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              'inline-flex h-10 w-10 items-center justify-center rounded-md ring-1',
              accent.bg,
              accent.text,
              accent.ring,
            )}
          >
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-[var(--fg-primary)]">{destination.name}</h3>
            <p className="line-clamp-2 text-[11px] text-[var(--fg-tertiary)]">
              {destination.description}
            </p>
          </div>
        </div>
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider',
            connected
              ? 'bg-[rgba(16,185,129,0.12)] text-[var(--accent-emerald)]'
              : 'bg-[var(--bg-inset)] text-[var(--fg-tertiary)]',
          )}
        >
          {connected ? (
            <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
          ) : (
            <Plug className="h-3 w-3" aria-hidden="true" />
          )}
          {connected ? 'connected' : 'available'}
        </span>
      </header>

      {connected ? (
        <div className="grid grid-cols-2 gap-2 text-[10px]">
          <div className="rounded-[var(--radius-sm)] bg-[var(--bg-inset)] px-2 py-1.5">
            <div className="text-[var(--fg-tertiary)]">Last sync</div>
            <div className="font-mono text-[var(--fg-primary)]">{destination.last_sync ?? '—'}</div>
          </div>
          {destination.metric ? (
            <div className="rounded-[var(--radius-sm)] bg-[var(--bg-inset)] px-2 py-1.5">
              <div className="text-[var(--fg-tertiary)]">{destination.metric.label}</div>
              <div className="font-mono text-[var(--fg-primary)]">{destination.metric.value}</div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--border-default)] bg-[var(--bg-inset)] p-3 text-[11px] text-[var(--fg-tertiary)]">
          Connect to start syncing.
        </div>
      )}

      <div className="rounded-[var(--radius-md)] bg-[var(--bg-inset)] px-2 py-1.5 text-[10px] font-mono text-[var(--fg-secondary)]">
        {destination.kpi}
      </div>

      <footer className="mt-auto flex items-center justify-between border-t border-[var(--border-subtle)] pt-3">
        <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">
          {KIND_LABEL[destination.kind]}
        </span>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid={`destination-configure-${destination.id}`}
            onClick={() => toast.info(`Configure ${destination.name}`)}
            className="text-[var(--fg-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--fg-primary)]"
          >
            <Cog className="h-3.5 w-3.5" aria-hidden="true" />
            Configure
          </Button>
          {destination.has_connector ? (
            connected ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                data-testid={`destination-disconnect-${destination.id}`}
                onClick={() => toast.info(`Disconnect ${destination.name}`)}
                className="text-[var(--accent-rose)] hover:bg-[rgba(244,63,94,0.10)] hover:text-[var(--accent-rose)]"
              >
                Disconnect
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                data-testid={`destination-connect-${destination.id}`}
                onClick={() => toast.success(`Mock OAuth: ${destination.name} connected`, {
                  description: 'Real OAuth lands in a follow-up step.',
                })}
                className="bg-[var(--accent-primary)] text-white hover:opacity-90"
              >
                <Plug className="h-3.5 w-3.5" aria-hidden="true" />
                Connect
              </Button>
            )
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid={`destination-install-${destination.id}`}
              onClick={() => toast.info(`Open Connectors → ${destination.name}`)}
              className="border-[var(--border-default)] text-[var(--fg-secondary)] hover:bg-[var(--bg-elevated)]"
            >
              <Plug className="h-3.5 w-3.5" aria-hidden="true" />
              Install connector
            </Button>
          )}
        </div>
      </footer>
    </article>
  );
}

function DestinationsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {[...Array(6)].map((_, i) => (
        <div
          key={i}
          role="status"
          aria-busy="true"
          className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4"
        >
          <div className="flex items-start gap-3">
            <span className="h-10 w-10 animate-pulse rounded-md bg-[var(--bg-inset)]" />
            <div className="flex flex-1 flex-col gap-2">
              <span className="h-3 w-3/5 animate-pulse rounded-[var(--radius-sm)] bg-[var(--bg-inset)]" />
              <span className="h-2 w-2/5 animate-pulse rounded-[var(--radius-sm)] bg-[var(--bg-inset)]" />
            </div>
          </div>
          <div className="h-12 animate-pulse rounded-[var(--radius-md)] bg-[var(--bg-inset)]" />
        </div>
      ))}
    </div>
  );
}

function DestinationsEmpty({ onAddCustom }: { onAddCustom?: () => void }) {
  return (
    <div
      data-testid="destinations-empty"
      className="flex flex-col items-center justify-center gap-4 rounded-[var(--radius-xl)] border border-dashed border-[var(--border-default)] bg-[var(--bg-surface)] p-10 text-center"
    >
      <Inbox className="h-10 w-10 text-[var(--fg-muted)]" aria-hidden="true" />
      <div>
        <h3 className="text-sm font-semibold text-[var(--fg-primary)]">
          No push destinations configured
        </h3>
        <p className="text-xs text-[var(--fg-tertiary)]">
          Forge pushes approved ideas, PRDs, and architecture previews to Jira,
          Confluence, Slack, GitHub Issues, and more.
        </p>
      </div>
      <Button
        type="button"
        size="sm"
        onClick={onAddCustom ?? (() => toast.info('Open Connectors to install one.'))}
        className="bg-[var(--accent-primary)] text-white hover:opacity-90"
      >
        <Settings className="h-3.5 w-3.5" aria-hidden="true" />
        Install a connector
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab
// ---------------------------------------------------------------------------

export interface DestinationsTabProps {
  readonly onAddCustom?: () => void;
}

export function DestinationsTab({ onAddCustom }: DestinationsTabProps) {
  const destinationsQuery = useDestinations();

  if (destinationsQuery.isLoading) {
    return (
      <section
        aria-label="Sync destinations"
        data-testid="destinations-tab"
        className="flex flex-col gap-6"
      >
        <header className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-[var(--fg-tertiary)]">
              Destinations
            </p>
            <h2 className="text-lg font-semibold text-[var(--fg-primary)]">
              Where Forge pushes results
            </h2>
            <p className="text-xs text-[var(--fg-tertiary)]">Loading…</p>
          </div>
        </header>
        <DestinationsSkeleton />
      </section>
    );
  }

  if (destinationsQuery.isError) {
    return (
      <IdeationQueryState
        isLoading={false}
        isError
        error={(destinationsQuery.error as { message?: string } | null)?.message ?? 'Failed to load destinations'}
        onRetry={() => void destinationsQuery.refetch()}
        loadingRows={6}
      >
        <></>
      </IdeationQueryState>
    );
  }

  const items = destinationsQuery.data?.items ?? [];
  const groups = groupByKind(items);
  const connected = items.filter((d) => d.status === 'connected').length;

  if (items.length === 0) {
    return (
      <section
        aria-label="Sync destinations"
        data-testid="destinations-tab"
        className="flex flex-col gap-6"
      >
        <header className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-[var(--fg-tertiary)]">
              Destinations
            </p>
            <h2 className="text-lg font-semibold text-[var(--fg-primary)]">
              Where Forge pushes results
            </h2>
          </div>
        </header>
        <DestinationsEmpty onAddCustom={onAddCustom} />
      </section>
    );
  }

  return (
    <section
      aria-label="Sync destinations"
      data-testid="destinations-tab"
      className="flex flex-col gap-6"
    >
      <header className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-[var(--fg-tertiary)]">
            Destinations
          </p>
          <h2 className="text-lg font-semibold text-[var(--fg-primary)]">
            Where Forge pushes results
          </h2>
          <p className="text-xs text-[var(--fg-tertiary)]">
            {connected} connected · {items.length - connected} available
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onAddCustom ?? (() => toast.info('Custom destination picker opens in a follow-up.'))}
          className="border-dashed border-[var(--border-default)] bg-transparent text-[var(--fg-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--fg-primary)]"
        >
          <Settings className="h-3.5 w-3.5" aria-hidden="true" />
          Custom destination
        </Button>
      </header>

      {groups.map(({ kind, label, rows }) => (
        <section key={kind} className="flex flex-col gap-3" aria-label={`${label} destinations`}>
          <header className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-2">
            <h3 className="text-sm font-semibold text-[var(--fg-secondary)]">{label}</h3>
            <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--fg-tertiary)]">
              {rows.length} {rows.length === 1 ? 'target' : 'targets'}
            </span>
          </header>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((d) => (
              <DestinationCardGrid key={d.id} destination={d} />
            ))}
          </div>
        </section>
      ))}
    </section>
  );
}
