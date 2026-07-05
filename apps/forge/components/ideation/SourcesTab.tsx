'use client';

/**
 * `<SourcesTab>` — Step 28 + M4 Track B (T-B2 / M4-G6).
 *
 * Grid of ingest source cards. Connected sources render their preview
 * (last 3 ingested items), disconnected sources show a "Connect"
 * affordance. Layout: 3-column grid on `md+`, single column on mobile.
 *
 * M4 rewire: the component now reads live data from
 * `GET /ideation/sources` via `useSources()`. The "Sync" button is
 * wired to `useSyncSource().mutate(source.id)`. The
 * `<ConnectorSpotlight>` cross-cut is preserved so the page can also
 * pull a connector install CTA without leaving.
 */

import * as React from 'react';
import {
  BookOpen,
  CheckCircle2,
  Code,
  Cog,
  Headphones,
  Inbox,
  Mail,
  MessageSquare,
  Plug,
  Rss,
  Settings,
  TrendingUp,
  Webhook,
  Zap,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

import { IdeationQueryState } from '@/components/ideation/IdeationQueryState';
import { useSources, useSyncSource } from '@/lib/hooks/useIdeation';
import type { IngestSourceRead } from '@/lib/ideation/types';
import { ConnectorSpotlight } from '@/components/connectors/ConnectorSpotlight';

// ---------------------------------------------------------------------------
// Local mappers — turn wire shape into the legacy fixture structure
// the cards below were written against. Keeps the presentational
// layer untouched while making the swap obvious in one place.
// ---------------------------------------------------------------------------

type SourceAccent = IngestSourceRead['accent'];

function wireToFixture(src: IngestSourceRead): IngestSourceFixture {
  return {
    id: src.id,
    name: src.name,
    kind: src.kind,
    icon: iconForKind(src.kind, src.slug),
    description: src.description,
    status: src.status === 'syncing' ? 'connected' : src.status,
    accent: src.accent,
    lastSync: src.last_sync ?? '—',
    todayCount: src.today_count,
    weekCount: src.week_count,
    kpi: `${src.week_count} this week`,
    preview: src.preview,
    frequency: src.frequency,
  };
}

function iconForKind(
  kind: IngestSourceRead['kind'],
  _slug: string,
): IngestSourceFixture['icon'] {
  switch (kind) {
    case 'support':
      return 'Headphones';
    case 'market':
      return 'TrendingUp';
    case 'codebase':
      return 'Code';
    case 'team':
      return 'Slack';
    case 'doc':
      return 'BookOpen';
    case 'webhook':
      return 'Webhook';
    case 'feed':
      return 'Rss';
    case 'email':
      return 'Mail';
    case 'confluence':
    case 'slack':
    case 'zendesk':
      return 'Slack';
    case 'manual':
    default:
      return 'MessageSquare';
  }
}

interface IngestSourceFixture {
  readonly id: string;
  readonly name: string;
  readonly kind: IngestSourceRead['kind'];
  readonly icon:
    | 'Headphones'
    | 'TrendingUp'
    | 'Code'
    | 'MessageSquare'
    | 'BookOpen'
    | 'Rss'
    | 'Mail'
    | 'Webhook'
    | 'Slack';
  readonly description: string;
  readonly status: 'connected' | 'available' | 'error';
  readonly accent: SourceAccent;
  readonly lastSync: string;
  readonly todayCount: number;
  readonly weekCount: number;
  readonly kpi: string;
  readonly preview: ReadonlyArray<{ title: string; at: string }>;
  readonly frequency: string;
}

function accentClasses(accent: SourceAccent): {
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

function sourceIconNode(name: IngestSourceFixture['icon']): React.ReactNode {
  switch (name) {
    case 'Headphones':
      return <Headphones className="h-5 w-5" aria-hidden="true" />;
    case 'TrendingUp':
      return <TrendingUp className="h-5 w-5" aria-hidden="true" />;
    case 'Code':
      return <Code className="h-5 w-5" aria-hidden="true" />;
    case 'MessageSquare':
      return <MessageSquare className="h-5 w-5" aria-hidden="true" />;
    case 'BookOpen':
      return <BookOpen className="h-5 w-5" aria-hidden="true" />;
    case 'Rss':
      return <Rss className="h-5 w-5" aria-hidden="true" />;
    case 'Mail':
      return <Mail className="h-5 w-5" aria-hidden="true" />;
    case 'Webhook':
      return <Webhook className="h-5 w-5" aria-hidden="true" />;
    case 'Slack':
      return <Code className="h-5 w-5" aria-hidden="true" />;
  }
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

interface SourceCardProps {
  readonly source: IngestSourceFixture;
  readonly onSync?: (id: string) => void;
  readonly syncing?: boolean;
}

function SourceCardGrid({ source, onSync, syncing }: SourceCardProps) {
  const accent = accentClasses(source.accent);
  const connected = source.status === 'connected' || source.status === 'syncing';

  return (
    <article
      data-testid="source-card"
      data-source-id={source.id}
      data-source-status={source.status}
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
            {sourceIconNode(source.icon)}
          </span>
          <div>
            <h3 className="text-sm font-semibold text-[var(--fg-primary)]">{source.name}</h3>
            <p className="line-clamp-2 text-[11px] text-[var(--fg-tertiary)]">
              {source.description}
            </p>
          </div>
        </div>
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider',
            connected
              ? 'bg-[rgba(16,185,129,0.12)] text-[var(--accent-emerald)]'
              : source.status === 'error'
                ? 'bg-[rgba(244,63,94,0.12)] text-[var(--accent-rose)]'
                : 'bg-[var(--bg-inset)] text-[var(--fg-tertiary)]',
          )}
        >
          {connected ? (
            <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
          ) : (
            <Plug className="h-3 w-3" aria-hidden="true" />
          )}
          {syncing
            ? 'syncing'
            : connected
              ? 'connected'
              : source.status === 'error'
                ? 'error'
                : 'available'}
        </span>
      </header>

      {connected ? (
        <>
          <div className="grid grid-cols-3 gap-2 text-[10px]">
            <div className="rounded-[var(--radius-sm)] bg-[var(--bg-inset)] px-2 py-1.5">
              <div className="text-[var(--fg-tertiary)]">Last sync</div>
              <div className="font-mono text-[var(--fg-primary)]">{source.lastSync}</div>
            </div>
            <div className="rounded-[var(--radius-sm)] bg-[var(--bg-inset)] px-2 py-1.5">
              <div className="text-[var(--fg-tertiary)]">Today</div>
              <div className="font-mono text-[var(--fg-primary)]">{source.todayCount}</div>
            </div>
            <div className="rounded-[var(--radius-sm)] bg-[var(--bg-inset)] px-2 py-1.5">
              <div className="text-[var(--fg-tertiary)]">This week</div>
              <div className="font-mono text-[var(--fg-primary)]">{source.weekCount}</div>
            </div>
          </div>

          <ul className="flex flex-col gap-1.5 rounded-[var(--radius-md)] bg-[var(--bg-inset)] p-2 text-[11px]">
            <li className="text-[10px] font-mono uppercase tracking-wider text-[var(--fg-tertiary)]">
              Last ingested
            </li>
            {source.preview.map((p, i) => (
              <li key={i} className="flex items-center justify-between gap-2 text-[var(--fg-secondary)]">
                <span className="line-clamp-1">{p.title}</span>
                <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">{p.at}</span>
              </li>
            ))}
            {source.preview.length === 0 ? (
              <li className="text-[var(--fg-tertiary)]">No records yet.</li>
            ) : null}
          </ul>
        </>
      ) : (
        <div className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-dashed border-[var(--border-default)] bg-[var(--bg-inset)] p-3 text-[11px] text-[var(--fg-tertiary)]">
          <span className="inline-flex items-center gap-1.5">
            <Zap className="h-3.5 w-3.5 text-[var(--accent-amber)]" aria-hidden="true" />
            Frequency: {source.frequency}
          </span>
          <span>Connect to start ingesting from this source.</span>
        </div>
      )}

      <footer className="mt-auto flex items-center justify-between border-t border-[var(--border-subtle)] pt-3">
        <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">{source.frequency}</span>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid={`source-configure-${source.id}`}
            onClick={() => toast.info(`Configure ${source.name}`)}
            className="text-[var(--fg-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--fg-primary)]"
          >
            <Cog className="h-3.5 w-3.5" aria-hidden="true" />
            Configure
          </Button>
          {connected ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid={`source-sync-${source.id}`}
              disabled={syncing}
              onClick={() => onSync?.(source.id)}
              className="border-[var(--border-default)] text-[var(--fg-primary)] hover:bg-[var(--bg-elevated)]"
            >
              {syncing ? (
                <>
                  <Settings className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  Syncing…
                </>
              ) : (
                <>
                  <Zap className="h-3.5 w-3.5" aria-hidden="true" />
                  Sync
                </>
              )}
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              data-testid={`source-connect-${source.id}`}
              onClick={() => toast.success(`Mock OAuth: ${source.name} connected`, {
                description: 'Real OAuth lands in a follow-up step.',
              })}
              className="bg-[var(--accent-primary)] text-white hover:opacity-90"
            >
              <Plug className="h-3.5 w-3.5" aria-hidden="true" />
              Connect
            </Button>
          )}
        </div>
      </footer>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Skeleton placeholder — six neutral cards while the live fetch resolves.
// ---------------------------------------------------------------------------

function SourcesSkeleton() {
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
          <div className="h-16 animate-pulse rounded-[var(--radius-md)] bg-[var(--bg-inset)]" />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state — Rule 15: icon + value prop + primary CTA.
// ---------------------------------------------------------------------------

function SourcesEmpty({ onSetup }: { onSetup?: () => void }) {
  return (
    <div
      data-testid="sources-empty"
      className="flex flex-col items-center justify-center gap-4 rounded-[var(--radius-xl)] border border-dashed border-[var(--border-default)] bg-[var(--bg-surface)] p-10 text-center"
    >
      <Inbox className="h-10 w-10 text-[var(--fg-muted)]" aria-hidden="true" />
      <div>
        <h3 className="text-sm font-semibold text-[var(--fg-primary)]">
          No ingest sources configured
        </h3>
        <p className="text-xs text-[var(--fg-tertiary)]">
          Forge pulls signals from Confluence, Slack, Zendesk, GitHub, Linear, Notion,
          Intercom, RSS and more. Add your first source to start ingesting.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={onSetup ?? (() => toast.info('Settings → Integrations opens next.'))}
          className="bg-[var(--accent-primary)] text-white hover:opacity-90"
        >
          <Settings className="h-3.5 w-3.5" aria-hidden="true" />
          Go to Settings → Integrations
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => toast.success('Mock connect: Custom webhook')}
          className="border-[var(--border-default)] text-[var(--fg-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--fg-primary)]"
        >
          <Plug className="h-3.5 w-3.5" aria-hidden="true" />
          Add a custom webhook
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab
// ---------------------------------------------------------------------------

export interface SourcesTabProps {
  readonly onAddCustom?: () => void;
}

export function SourcesTab({ onAddCustom }: SourcesTabProps) {
  const sourcesQuery = useSources();
  const syncMutation = useSyncSource();

  const items = sourcesQuery.data?.items ?? [];
  const sources: ReadonlyArray<IngestSourceFixture> = items.map(wireToFixture);
  const connected = sources.filter((s) => s.status === 'connected');
  const available = sources.filter((s) => s.status !== 'connected');

  // Per-source "is this one mid-sync?" — drives the per-card button.
  const syncingId =
    syncMutation.isPending && syncMutation.variables
      ? syncMutation.variables
      : null;

  if (sourcesQuery.isLoading) {
    return (
      <section aria-label="Ingest sources" data-testid="sources-tab" className="flex flex-col gap-6">
        <header className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-[var(--fg-tertiary)]">
              Sources
            </p>
            <h2 className="text-lg font-semibold text-[var(--fg-primary)]">
              Ingest from your stack
            </h2>
            <p className="text-xs text-[var(--fg-tertiary)]">Loading…</p>
          </div>
        </header>
        <SourcesSkeleton />
      </section>
    );
  }

  if (sourcesQuery.isError) {
    return (
      <IdeationQueryState
        isLoading={false}
        isError
        error={(sourcesQuery.error as { message?: string } | null)?.message ?? 'Failed to load sources'}
        onRetry={() => void sourcesQuery.refetch()}
        loadingRows={6}
      >
        <></>
      </IdeationQueryState>
    );
  }

  if (sources.length === 0) {
    return (
      <section aria-label="Ingest sources" data-testid="sources-tab" className="flex flex-col gap-6">
        <header className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-[var(--fg-tertiary)]">
              Sources
            </p>
            <h2 className="text-lg font-semibold text-[var(--fg-primary)]">
              Ingest from your stack
            </h2>
          </div>
        </header>
        <SourcesEmpty onSetup={onAddCustom} />
      </section>
    );
  }

  return (
    <section aria-label="Ingest sources" data-testid="sources-tab" className="flex flex-col gap-6">
      <header className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-[var(--fg-tertiary)]">
            Sources
          </p>
          <h2 className="text-lg font-semibold text-[var(--fg-primary)]">
            Ingest from your stack
          </h2>
          <p className="text-xs text-[var(--fg-tertiary)]">
            {connected.length} connected · {available.length} available
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onAddCustom ?? (() => toast.info('Custom source picker opens in a follow-up.'))}
          className="border-dashed border-[var(--border-default)] bg-transparent text-[var(--fg-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--fg-primary)]"
        >
          <Settings className="h-3.5 w-3.5" aria-hidden="true" />
          Custom source
        </Button>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {sources.map((s) => (
          <SourceCardGrid
            key={s.id}
            source={s}
            syncing={syncingId === s.id}
            onSync={(id) => syncMutation.mutate(id)}
          />
        ))}
      </div>

      {/* Step 31 — cross-cutting connector embed (Zone 10E demo).
          Shows that any page can pull a connector via the provider
          without reaching into the connector-center page. */}
      <ConnectorSpotlight
        title="Add another source"
        description="Pick from your connected connectors, or install a new one — without leaving this page."
        className="mt-2"
      />
    </section>
  );
}
