'use client';

/**
 * WorkflowCenter — Step-56 (Phase 4).
 *
 * List view of the Workflows center, wired to the FastAPI backend.
 * Replaces the dummy data in the Step-22/23 gallery.
 *
 * Layout:
 *   - Hero band (name + primary action)
 *   - 4 KPI tiles (workflows / runs today / avg duration / success)
 *   - Tab strip: My workflows | Templates | Shared | Drafts
 *   - Search + grid of `WorkflowCard`s
 *
 * The gallery tab uses the static `WORKFLOW_TEMPLATES` from
 * `lib/workflow/templates.ts` (kept as a starting-point catalog) but
 * every "From scratch" / "Install" CTA mutates the backend so the
 * gallery stops being decorative.
 */

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Activity,
  CheckCircle2,
  Clock,
  FileCode,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Workflow as WorkflowIcon,
  Zap,
  type LucideIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ErrorState } from '@/components/error-state';
import { EmptyState as EmptyStateV2 } from '@/src/components/empty-state';

import { AdminShell } from '@/components/admin/AdminShell';
import { cn } from '@/lib/utils';
import {
  useCreateWorkflow,
  useDeleteWorkflow,
  useDuplicateWorkflow,
  usePublishWorkflow,
  useWorkflows,
} from '@/lib/hooks/useWorkflows';
import { canvasToWire } from '@/lib/workflows/adapter';
import type { Workflow, WorkflowRun } from '@/lib/workflows/types';
import {
  WORKFLOW_TEMPLATES,
} from '@/lib/workflow/templates';
import type { WorkflowTemplate } from '@/lib/workflow/types'; // ponytail: WorkflowTemplate lives in types.ts, not re-exported by templates.ts
import { useWorkflowStore } from '@/components/workflow/store';

type Tab = 'my' | 'templates' | 'shared' | 'drafts';

const STATUS_TONE: Record<string, 'emerald' | 'amber' | 'rose' | 'cyan' | 'idle'> = {
  draft: 'amber',
  published: 'emerald',
  archived: 'idle',
  disabled: 'rose',
};

const RUN_STATUS_TONE: Record<string, 'emerald' | 'amber' | 'rose' | 'cyan' | 'idle'> = {
  queued: 'idle',
  running: 'cyan',
  waiting_approval: 'amber',
  paused: 'amber',
  succeeded: 'emerald',
  failed: 'rose',
  cancelled: 'idle',
};

export function WorkflowCenter() {
  const router = useRouter();
  const [tab, setTab] = React.useState<Tab>('my');
  const [search, setSearch] = React.useState('');

  const { data, isLoading, error, refetch } = useWorkflows({
    search: search || undefined,
  });
  // No tenant-wide runs list endpoint yet (the backend only exposes
  // `GET /workflows/{id}/runs`). Fetch per-workflow when a card is
  // present; the KPI tile falls back to "—" otherwise.
  const createWorkflow = useCreateWorkflow();
  const deleteWorkflow = useDeleteWorkflow();
  const duplicateWorkflow = useDuplicateWorkflow();
  const publishWorkflow = usePublishWorkflow();
  const hydrateFromTemplate = useWorkflowStore((s) => s.hydrateFromTemplate);
  const setDoc = useWorkflowStore((s) => s.setDoc);

  const workflows = data ?? [];

  // Aggregate the latest run per workflow from the per-workflow fetch
  // below. We only fetch runs for workflows currently visible, so the
  // gallery page never fires a tenant-wide call.
  const visibleWorkflows = React.useMemo(() => {
    let list = workflows;
    if (tab === 'drafts') {
      list = list.filter((w) => w.status === 'draft');
    } else if (tab === 'shared') {
      list = list.filter((w) => w.status === 'published');
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (w) =>
          w.name.toLowerCase().includes(q) ||
          (w.description ?? '').toLowerCase().includes(q),
      );
    }
    return list;
  }, [workflows, tab, search]);

  const [runsByWorkflow, setRunsByWorkflow] = React.useState<
    Record<string, WorkflowRun | undefined>
  >({});

  // Fetch the latest run for each visible workflow (best-effort).
  React.useEffect(() => {
    let cancelled = false;
    const fetchAll = async () => {
      const entries = await Promise.all(
        visibleWorkflows.map(async (wf) => {
          try {
            const result = await import('@/lib/workflows/data').then((m) =>
              m.listWorkflowRuns(wf.id),
            );
            return [wf.id, result[0]] as const;
          } catch {
            return [wf.id, undefined] as const;
          }
        }),
      );
      if (!cancelled) {
        const next: Record<string, WorkflowRun | undefined> = {};
        entries.forEach(([id, r]) => {
          next[id] = r;
        });
        setRunsByWorkflow(next);
      }
    };
    if (visibleWorkflows.length > 0) void fetchAll();
    return () => {
      cancelled = true;
    };
  }, [visibleWorkflows]);

  const runs = React.useMemo<ReadonlyArray<WorkflowRun>>(
    () =>
      Object.values(runsByWorkflow).filter((r): r is WorkflowRun => Boolean(r)),
    [runsByWorkflow],
  );

  // KPI derivations — must come AFTER `runs` is declared to avoid TDZ.
  const kpis = React.useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayMs = today.getTime();
    const runsToday = runs.filter((r) => {
      const t = r.started_at ? new Date(r.started_at).getTime() : 0;
      return t >= todayMs;
    });
    const succeeded = runsToday.filter((r) => r.status === 'succeeded').length;
    const successRate =
      runsToday.length > 0 ? Math.round((succeeded / runsToday.length) * 100) : null;
    return {
      total: workflows.length,
      runsToday: runsToday.length,
      successRate,
    };
  }, [workflows, runs]);

  const fromScratch = React.useCallback(async () => {
    try {
      const wf = await createWorkflow.mutateAsync({
        name: 'Untitled workflow',
        description: 'Newly created from the gallery.',
        definition: { nodes: [], edges: [], settings: {} },
      });
      router.push(`/workflows/${wf.id}`);
    } catch {
      /* toast handled by the hook */
    }
  }, [createWorkflow, router]);

  const installTemplate = React.useCallback(
    async (template: WorkflowTemplate) => {
      try {
        // Persist the template as a real workflow so the user can
        // edit it (auto-saves go through the same backend).
        const wf = await createWorkflow.mutateAsync({
          name: template.name,
          description: template.description,
          definition: {
            nodes: template.nodes.map((n, i) =>
              canvasToWire({ ...n, id: `${template.id}-${i}` } as never),
            ),
            edges: template.edges.map((e) => ({
              id: e.id,
              source: e.source,
              target: e.target,
            })),
            settings: {},
          },
        });
        router.push(`/workflows/${wf.id}`);
      } catch {
        /* toast handled by the hook */
      }
    },
    [createWorkflow, router],
  );

  const openTemplateInEditor = React.useCallback(
    (template: WorkflowTemplate) => {
      // Local-only open (no backend write). Useful for browsing.
      setDoc({ name: template.name, description: template.description });
      hydrateFromTemplate({
        nodes: template.nodes,
        edges: template.edges,
        name: template.name,
        description: template.description,
      });
      router.push('/workflows');
    },
    [hydrateFromTemplate, setDoc, router],
  );

  return (
    <AdminShell>
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6" data-testid="workflows-center">
        {/* HERO */}
        <section className="hero-border relative overflow-hidden rounded-[var(--radius-xl)]">
          <div className="relative z-10 flex flex-col gap-4 rounded-[var(--radius-xl)] bg-[var(--bg-surface)]/85 px-8 py-7 backdrop-blur-sm md:flex-row md:items-center md:justify-between">
            <div className="flex max-w-2xl flex-col gap-2">
              <p className="text-[10px] font-medium uppercase tracking-widest text-[var(--fg-tertiary)]">
                Center
              </p>
              <div className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] bg-[var(--bg-inset)] text-[var(--accent-primary)]"
                >
                  <WorkflowIcon className="h-4 w-4" strokeWidth={2} />
                </span>
                <h1
                  className="text-[var(--text-3xl)] leading-tight text-[var(--fg-primary)]"
                  style={{ fontWeight: 700 }}
                >
                  Workflows
                </h1>
              </div>
              <p className="max-w-2xl text-[var(--text-sm)] text-[var(--fg-secondary)]">
                Compose multi-step AI workflows. Connect commands, approvals, and custom
                logic into a DAG your team can run, schedule, or trigger from events.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                onClick={fromScratch}
                data-testid="workflows-new"
              >
                <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
                From scratch
              </Button>
            </div>
          </div>
        </section>

        {/* KPI STRIP */}
        <section
          className="grid grid-cols-2 gap-3 md:grid-cols-4"
          data-testid="workflows-kpi"
        >
          <KpiTile
            label="Workflows"
            value={kpis.total}
            tone="indigo"
            icon={WorkflowIcon}
          />
          <KpiTile
            label="Runs today"
            value={kpis.runsToday}
            tone="cyan"
            icon={Zap}
          />
          <KpiTile
            label="Success rate"
            value={kpis.successRate == null ? '—' : `${kpis.successRate}%`}
            tone="emerald"
            icon={CheckCircle2}
          />
          <KpiTile
            label="Avg duration"
            value={avgDurationLabel(runs ?? [])}
            tone="amber"
            icon={Clock}
          />
        </section>

        {/* TABS + SEARCH */}
        <div
          className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3"
          data-testid="workflows-tabs"
        >
          <div className="flex flex-wrap items-center gap-1.5" role="tablist">
            {(
              [
                { v: 'templates', label: 'Templates' },
                { v: 'my', label: 'My workflows' },
                { v: 'shared', label: 'Shared with me' },
                { v: 'drafts', label: 'Drafts' },
              ] as { v: Tab; label: string }[]
            ).map((t) => (
              <button
                key={t.v}
                type="button"
                role="tab"
                aria-selected={tab === t.v}
                onClick={() => setTab(t.v)}
                data-testid={`workflows-tab-${t.v}`}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium',
                  tab === t.v
                    ? 'bg-[var(--bg-elevated)] text-[var(--fg-primary)] shadow-[var(--shadow-sm)]'
                    : 'text-[var(--fg-tertiary)] hover:text-[var(--fg-secondary)]',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          {tab !== 'templates' ? (
            <div className="relative max-w-sm">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--fg-tertiary)]"
                aria-hidden="true"
              />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search workflows…"
                className="h-9 pl-8 text-xs"
                data-testid="workflows-search"
              />
            </div>
          ) : null}
        </div>

        {/* BODY */}
        {error ? (
          <ErrorState
            title="Couldn't load workflows"
            description={error.message}
            onRetry={() => refetch()}
          />
        ) : tab === 'templates' ? (
          <TemplatesGrid
            templates={WORKFLOW_TEMPLATES}
            onInstall={installTemplate}
            onOpen={openTemplateInEditor}
          />
        ) : isLoading ? (
          <GridSkeleton />
        ) : visibleWorkflows.length === 0 ? (
          <EmptyStateV2
            illustration={<Sparkles className="h-10 w-10" strokeWidth={1.5} aria-hidden="true" />}
            title={tab === 'drafts' ? 'No drafts' : 'No workflows yet'}
            description={
              tab === 'drafts'
                ? 'Workflows you start but don’t publish appear here.'
                : 'Create your first workflow or install a template to get started.'
            }
            primaryAction={{
              label: 'From scratch',
              icon: <Plus className="h-4 w-4" aria-hidden="true" />,
              onClick: fromScratch,
            }}
            secondaryAction={{
              label: 'Browse templates',
              icon: <Sparkles className="h-4 w-4" aria-hidden="true" />,
              onClick: () => setTab('templates'),
            }}
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3" data-testid="workflows-grid">
            {visibleWorkflows.map((wf) => (
              <WorkflowCard
                key={wf.id}
                workflow={wf}
                lastRun={pickLastRun(runs, wf.id)}
                onOpen={() => router.push(`/workflows/${wf.id}`)}
                onDelete={() => {
                  if (typeof window !== 'undefined' && window.confirm(`Delete "${wf.name}"?`)) {
                    deleteWorkflow.mutate(wf.id);
                  }
                }}
                onDuplicate={() => duplicateWorkflow.mutate(wf.id)}
                onPublish={() => publishWorkflow.mutate(wf.id)}
              />
            ))}
          </div>
        )}
      </div>
    </AdminShell>
  );
}

/* ---------------- Subcomponents ---------------- */

function KpiTile({
  label,
  value,
  tone,
  icon: Icon,
}: {
  label: string;
  value: number | string;
  tone: 'indigo' | 'cyan' | 'emerald' | 'amber';
  icon: LucideIcon;
}) {
  const toneText: Record<typeof tone, string> = {
    indigo: 'text-[var(--accent-primary)]',
    cyan: 'text-[var(--accent-cyan)]',
    emerald: 'text-[var(--accent-emerald)]',
    amber: 'text-[var(--accent-amber)]',
  };
  return (
    <div
      className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4"
      data-testid={`kpi-${label.toLowerCase().replace(/\s+/g, '-')}`}
    >
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-medium uppercase tracking-widest text-[var(--fg-tertiary)]">
          {label}
        </p>
        <span
          aria-hidden="true"
          className={cn(
            'inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-md)] bg-[var(--bg-inset)]',
            toneText[tone],
          )}
        >
          <Icon className="h-3.5 w-3.5" strokeWidth={2} />
        </span>
      </div>
      <p className={cn('mt-2 text-[var(--text-3xl)] font-bold tabular-nums', toneText[tone])}>
        {value}
      </p>
    </div>
  );
}

function WorkflowCard({
  workflow,
  lastRun,
  onOpen,
  onDelete,
  onDuplicate,
  onPublish,
}: {
  workflow: Workflow;
  lastRun?: WorkflowRun;
  onOpen: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onPublish: () => void;
}) {
  const nodeCount = workflow.definition?.nodes?.length ?? 0;
  const edgeCount = workflow.definition?.edges?.length ?? 0;
  return (
    <article
      className="group flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 transition-colors hover:border-[var(--border-default)]"
      data-testid={`workflow-card-${workflow.id}`}
    >
      <Link
        href={`/workflows/${workflow.id}`}
        className="flex items-start gap-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
      >
        <span
          aria-hidden="true"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--bg-inset)] text-[var(--accent-primary)]"
        >
          <FileCode className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-[var(--fg-primary)]">
            {workflow.name}
          </h3>
          {workflow.description ? (
            <p className="mt-0.5 line-clamp-2 text-xs text-[var(--fg-tertiary)]">
              {workflow.description}
            </p>
          ) : null}
        </div>
        <Badge tone={STATUS_TONE[workflow.status] ?? 'idle'}>{workflow.status}</Badge>
      </Link>

      <dl className="grid grid-cols-3 gap-2 text-[11px] text-[var(--fg-tertiary)]">
        <div>
          <dt className="font-medium uppercase tracking-widest text-[10px]">Nodes</dt>
          <dd className="mt-0.5 text-sm text-[var(--fg-secondary)] tabular-nums">{nodeCount}</dd>
        </div>
        <div>
          <dt className="font-medium uppercase tracking-widest text-[10px]">Edges</dt>
          <dd className="mt-0.5 text-sm text-[var(--fg-secondary)] tabular-nums">{edgeCount}</dd>
        </div>
        <div>
          <dt className="font-medium uppercase tracking-widest text-[10px]">Last run</dt>
          <dd className="mt-0.5 text-sm text-[var(--fg-secondary)]">
            {lastRun ? (
              <Badge tone={RUN_STATUS_TONE[lastRun.status] ?? 'idle'} size="sm">
                {lastRun.status}
              </Badge>
            ) : (
              <span className="text-[var(--fg-tertiary)]">—</span>
            )}
          </dd>
        </div>
      </dl>

      <div className="flex items-center gap-2 border-t border-[var(--border-subtle)] pt-3">
        <Button type="button" size="sm" onClick={onOpen} data-testid="workflow-open">
          Open
        </Button>
        {workflow.status !== 'published' ? (
          <Button type="button" size="sm" variant="outline" onClick={onPublish}>
            Publish
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="ghost" onClick={onDuplicate}>
          Duplicate
        </Button>
        <div className="flex-1" />
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onDelete}
          aria-label="Delete workflow"
          data-testid="workflow-delete"
        >
          <Trash2 className="h-3.5 w-3.5 text-[var(--accent-rose)]" aria-hidden="true" />
        </Button>
      </div>
    </article>
  );
}

function TemplatesGrid({
  templates,
  onInstall,
  onOpen,
}: {
  templates: ReadonlyArray<WorkflowTemplate>;
  onInstall: (t: WorkflowTemplate) => void;
  onOpen: (t: WorkflowTemplate) => void;
}) {
  return (
    <div
      className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3"
      data-testid="workflows-templates"
    >
      {templates.map((t) => {
        const Icon = t.icon;
        return (
          <article
            key={t.id}
            className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4"
            data-testid={`template-card-${t.id}`}
          >
            <div className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--bg-inset)]"
                style={{ color: `var(${t.colorVar})` }}
              >
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-sm font-semibold text-[var(--fg-primary)]">
                  {t.name}
                </h3>
                <p className="mt-0.5 line-clamp-3 text-xs text-[var(--fg-tertiary)]">
                  {t.description}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {t.tags.map((tag) => (
                <Badge key={tag} size="sm" tone="idle">
                  {tag}
                </Badge>
              ))}
            </div>
            <div className="flex items-center gap-2 border-t border-[var(--border-subtle)] pt-3">
              <Button
                type="button"
                size="sm"
                onClick={() => onInstall(t)}
                data-testid="template-install"
              >
                Install
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => onOpen(t)}
              >
                Preview
              </Button>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function GridSkeleton() {
  return (
    <div
      className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3"
      data-testid="workflows-skeleton"
    >
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="h-44 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
        >
          <div className="shimmer h-full w-full rounded-[var(--radius-lg)]" aria-hidden="true" />
        </div>
      ))}
    </div>
  );
}

function pickLastRun(runs: WorkflowRun[] | undefined, workflowId: string): WorkflowRun | undefined {
  if (!runs) return undefined;
  return runs.find((r) => r.workflow_id === workflowId);
}

function avgDurationLabel(runs: ReadonlyArray<WorkflowRun>): string {
  const finished = runs.filter((r) => r.started_at && r.finished_at);
  if (finished.length === 0) return '—';
  const total = finished.reduce((acc, r) => {
    const s = new Date(r.started_at as string).getTime();
    const f = new Date(r.finished_at as string).getTime();
    return acc + Math.max(0, f - s);
  }, 0);
  const avg = total / finished.length;
  if (avg < 1000) return `${Math.round(avg)}ms`;
  const s = avg / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m ${Math.floor(s % 60)}s`;
}
