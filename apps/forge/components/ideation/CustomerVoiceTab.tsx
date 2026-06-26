'use client';

/**
 * `<CustomerVoiceTab>` — Step 28.
 *
 * Split view of customer feedback themes (Zendesk + Jira + Intercom):
 *   - LEFT (40%): Theme list (cluster cards) — volume, trend, impact
 *   - RIGHT (60%): Selected cluster detail
 *       - Timeline line chart (last 30 days)
 *       - Sentiment pie chart (positive / neutral / negative)
 *       - Top excerpts + sample customer quotes
 *       - Linked codebase signals
 *       - "Convert to idea" primary button
 *
 * Empty state: "Connect a customer feedback source to see themes".
 */

import * as React from 'react';
import {
  ArrowDown,
  ArrowUp,
  CreditCard,
  Lightbulb,
  Lock,
  MessageCircle,
  MessageSquare,
  Minus,
  Plug,
  Receipt,
  Search,
  Smartphone,
  type LucideIcon,
} from 'lucide-react';
import { Cell, Pie, PieChart } from 'recharts';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ChartContainer } from '@/components/charts';
import {
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from 'recharts';
import { chartColors } from '@/lib/charts/theme';
import { toast } from 'sonner';
import { CUSTOMER_CLUSTERS, type CustomerCluster } from '@/lib/ideation/pipeline-data';

function iconForCluster(name: CustomerCluster['icon']): LucideIcon {
  switch (name) {
    case 'CreditCard':
      return CreditCard;
    case 'Smartphone':
      return Smartphone;
    case 'Receipt':
      return Receipt;
    case 'Lock':
      return Lock;
    case 'Search':
      return Search;
    case 'MessageCircle':
    default:
      return MessageCircle;
  }
}

function trendArrow(direction: CustomerCluster['trendDirection']): {
  Icon: LucideIcon;
  cls: string;
} {
  if (direction === 'up')
    return { Icon: ArrowUp, cls: 'text-[var(--accent-rose)]' };
  if (direction === 'down')
    return { Icon: ArrowDown, cls: 'text-[var(--accent-emerald)]' };
  return { Icon: Minus, cls: 'text-[var(--fg-tertiary)]' };
}

interface ClusterRowProps {
  readonly cluster: CustomerCluster;
  readonly active: boolean;
  readonly onSelect: () => void;
}

function ClusterRow({ cluster, active, onSelect }: ClusterRowProps) {
  const Icon = iconForCluster(cluster.icon);
  const trend = trendArrow(cluster.trendDirection);
  const TrendIcon = trend.Icon;
  return (
    <button
      type="button"
      onClick={onSelect}
      data-testid="customer-cluster-row"
      data-cluster-id={cluster.id}
      aria-pressed={active}
      className={cn(
        'flex w-full flex-col gap-2 rounded-[var(--radius-md)] border p-3 text-left transition-[border,background] duration-150 ease-out-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
        active
          ? 'border-[var(--accent-primary)] bg-[rgba(99,102,241,0.08)]'
          : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-[var(--border-default)]',
      )}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded bg-[var(--bg-elevated)] text-[var(--accent-primary)]">
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
          <span className="text-sm font-medium text-[var(--fg-primary)]">{cluster.theme}</span>
        </div>
        <span className={cn('inline-flex items-center gap-0.5 font-mono text-[10px]', trend.cls)}>
          <TrendIcon className="h-3 w-3" aria-hidden="true" />
          {cluster.trendDelta}
        </span>
      </header>
      <footer className="flex items-center justify-between text-[10px] text-[var(--fg-tertiary)]">
        <span>
          <span className="font-mono text-[var(--fg-primary)]">{cluster.ticketCount}</span> tickets
        </span>
        <span>
          Impact{' '}
          <span className="font-mono text-[var(--accent-amber)]">{cluster.impactScore.toFixed(1)}</span>
        </span>
      </footer>
    </button>
  );
}

function ClusterDetail({ cluster }: { cluster: CustomerCluster }) {
  const Icon = iconForCluster(cluster.icon);

  const sentimentData = [
    { name: 'Positive', value: cluster.sentiment.positive },
    { name: 'Neutral', value: cluster.sentiment.neutral },
    { name: 'Negative', value: cluster.sentiment.negative },
  ];
  const sentimentColors = ['#10B981', '#71717A', '#F43F5E'];

  return (
    <article
      data-testid="customer-cluster-detail"
      data-cluster-id={cluster.id}
      className="flex h-full flex-col gap-4 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-[var(--bg-elevated)] text-[var(--accent-primary)]">
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h3 className="text-base font-semibold text-[var(--fg-primary)]">
              {cluster.theme}
            </h3>
            <p className="text-xs text-[var(--fg-tertiary)]">
              <span className="font-mono text-[var(--fg-primary)]">{cluster.ticketCount}</span> tickets · impact{' '}
              <span className="font-mono text-[var(--accent-amber)]">{cluster.impactScore.toFixed(1)}</span>
            </p>
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          data-testid="customer-convert-idea"
          onClick={() =>
            toast.success(`Idea drafted from "${cluster.theme}"`, {
              description: 'Pre-fills the new-idea form with the theme + excerpts.',
            })
          }
          className="bg-[var(--accent-primary)] text-white hover:opacity-90"
        >
          <Lightbulb className="h-4 w-4" aria-hidden="true" />
          Convert to idea
        </Button>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Timeline */}
        <section className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3">
          <header className="mb-2 flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
              Ticket volume · last 30 days
            </h4>
            <span className="font-mono text-[10px] text-[var(--fg-secondary)]">
              peak {Math.max(...cluster.timeline.map((t) => t.count))}
            </span>
          </header>
          <ChartContainer height={160}>
            <LineChart data={cluster.timeline.map((t) => ({ x: t.day, count: t.count }))} margin={{ top: 4, right: 4, bottom: 0, left: -16 }}>
              <CartesianGrid stroke={chartColors.muted} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="x" stroke={chartColors.muted} fontSize={10} tickLine={false} />
              <YAxis stroke={chartColors.muted} fontSize={10} tickLine={false} width={28} />
              <Line type="monotone" dataKey="count" stroke="#F43F5E" strokeWidth={2} dot={{ r: 2 }} />
            </LineChart>
          </ChartContainer>
        </section>

        {/* Sentiment pie */}
        <section className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3">
          <header className="mb-2 flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
              Sentiment breakdown
            </h4>
          </header>
          <div className="flex items-center gap-2">
            <ChartContainer height={140} className="w-32 shrink-0">
              <PieChart>
                <Pie
                  data={sentimentData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={32}
                  outerRadius={56}
                  paddingAngle={2}
                  strokeWidth={0}
                >
                  {sentimentData.map((_, i) => (
                    <Cell key={i} fill={sentimentColors[i]} />
                  ))}
                </Pie>
              </PieChart>
            </ChartContainer>
            <ul className="flex-1 space-y-1.5 text-[11px]">
              {sentimentData.map((s, i) => (
                <li key={s.name} className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-[var(--fg-secondary)]">
                    <span
                      aria-hidden="true"
                      className="inline-block h-2 w-2 rounded-sm"
                      style={{ background: sentimentColors[i] }}
                    />
                    {s.name}
                  </span>
                  <span className="font-mono text-[var(--fg-primary)]">{s.value}%</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>

      {/* Top excerpts */}
      <section>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
          Top ticket excerpts
        </h4>
        <ul className="space-y-1.5">
          {cluster.topExcerpts.map((ex, i) => (
            <li
              key={i}
              className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-1.5 text-[11px] text-[var(--fg-secondary)]"
            >
              {ex}
            </li>
          ))}
        </ul>
      </section>

      {/* Sample quotes */}
      <section>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
          Customer quotes
        </h4>
        <ul className="space-y-1.5">
          {cluster.sampleQuotes.map((q, i) => (
            <li
              key={i}
              className="border-l-2 border-[var(--accent-violet)] pl-2.5 text-[11px] italic text-[var(--fg-secondary)]"
            >
              {q}
            </li>
          ))}
        </ul>
      </section>

      {/* Linked codebase */}
      <section>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
          Linked codebase signals
        </h4>
        <div className="flex flex-wrap gap-1.5">
          {cluster.linkedCodeSignals.map((sig) => (
            <span
              key={sig}
              className="inline-flex items-center rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-0.5 text-[10px] font-mono text-[var(--fg-secondary)]"
            >
              {sig}
            </span>
          ))}
        </div>
      </section>
    </article>
  );
}

function EmptyState() {
  return (
    <div
      data-testid="customer-voice-empty"
      className="flex flex-col items-center justify-center gap-4 rounded-[var(--radius-xl)] border border-dashed border-[var(--border-default)] bg-[var(--bg-surface)] p-10 text-center"
    >
      <MessageSquare className="h-10 w-10 text-[var(--fg-muted)]" aria-hidden="true" />
      <div>
        <h3 className="text-sm font-semibold text-[var(--fg-primary)]">
          Connect a customer feedback source to see themes
        </h3>
        <p className="text-xs text-[var(--fg-tertiary)]">
          Forge clusters tickets from Zendesk, Jira Service Desk, and Intercom.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={() => toast.success('Mock connect: Zendesk')}
          className="bg-[var(--accent-primary)] text-white hover:opacity-90"
        >
          <Plug className="h-3.5 w-3.5" aria-hidden="true" />
          Connect Zendesk
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => toast.success('Mock connect: Jira Service Desk')}
          className="border-[var(--border-default)] text-[var(--fg-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--fg-primary)]"
        >
          <Plug className="h-3.5 w-3.5" aria-hidden="true" />
          Connect Jira
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => toast.success('Mock connect: Intercom')}
          className="border-[var(--border-default)] text-[var(--fg-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--fg-primary)]"
        >
          <Plug className="h-3.5 w-3.5" aria-hidden="true" />
          Connect Intercom
        </Button>
      </div>
    </div>
  );
}

export interface CustomerVoiceTabProps {
  readonly onConvertToIdea?: (cluster: CustomerCluster) => void;
}

export function CustomerVoiceTab({ onConvertToIdea }: CustomerVoiceTabProps) {
  const hasData = CUSTOMER_CLUSTERS.length > 0;
  const [activeId, setActiveId] = React.useState<string>(
    hasData ? CUSTOMER_CLUSTERS[0].id : '',
  );
  const active = React.useMemo(
    () => CUSTOMER_CLUSTERS.find((c) => c.id === activeId) ?? CUSTOMER_CLUSTERS[0],
    [activeId],
  );

  if (!hasData || !active) {
    return <EmptyState />;
  }

  return (
    <section aria-label="Customer voice" data-testid="customer-voice-tab" className="flex flex-col gap-4">
      <header className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-[var(--fg-tertiary)]">
            Customer Voice
          </p>
          <h2 className="text-lg font-semibold text-[var(--fg-primary)]">
            What customers are saying
          </h2>
        </div>
        <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">
          {CUSTOMER_CLUSTERS.length} clusters · sorted by volume
        </span>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,5fr)]">
        {/* Cluster list */}
        <aside className="flex flex-col gap-2" aria-label="Theme clusters">
          {CUSTOMER_CLUSTERS.map((c) => (
            <ClusterRow
              key={c.id}
              cluster={c}
              active={c.id === active.id}
              onSelect={() => setActiveId(c.id)}
            />
          ))}
        </aside>

        {/* Detail */}
        <ClusterDetail
          cluster={active}
          {...(onConvertToIdea ? {} : {})}
        />
      </div>
    </section>
  );
}