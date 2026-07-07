'use client';

/**
 * Organization Knowledge — modernized (Step 29).
 *
 * Skill influence:
 *   - Knowledge base / wiki / Obsidian backlink / template-library /
 *     version-control diff / compliance-dashboard UX rules from
 *     `ui-ux-pro-max` — adopted throughout: breadcrumbs, segmented tab
 *     control, hover lifts, semantic color tokens via --accent-*,
 *     prefers-reduced-motion respected on the hero border + animated
 *     transitions.
 *   - URL state preservation: `?tab=…&id=…&scope=…` so deep links work.
 *   - Master-detail editor from Step 12 is REUSED (not rebuilt) per
 *     constraints — `KnowledgeEditorShell` lives in this file but keeps
 *     the same props signature.
 *
 * Structure (14 zones from the brief):
 *   ZONE 1  Header + scope switcher
 *   ZONE 2  Tabs (now 7 — Overview / Standards / Templates / Policies /
 *                 Runbooks / Best practices / Activity / Graph)
 *   ZONE 3  Overview bento
 *   ZONE 4  Standards master-detail (editor reused from Step 12)
 *   ZONE 5  Templates grid
 *   ZONE 6  Policies list + editor + enforcement sidebar
 *   ZONE 7  Runbooks timeline
 *   ZONE 8  Best practices (featured + grid + progress)
 *   ZONE 9  Activity (change log + adoption metrics)
 *   ZONE 10 Graph tab (Obsidian-style for artifacts)
 *   ZONE 11 New artifact modal (3-step)
 *   ZONE 12 Backlinks sidebar (mounted in every editor)
 *   ZONE 13 Smart features (AI suggestions stub, drift detection, gamification)
 *   ZONE 14 Keyboard shortcuts (⌘N / ⌘⇧S / ⌘K / / / ⌘/)
 */

import * as React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronRight,
  Search,
  Plus,
  BookOpen,
  BookText,
  LayoutTemplate,
  ShieldCheck,
  Activity,
  MoreVertical,
  Bold,
  Italic,
  Heading2,
  Link2,
  List as ListIcon,
  Code2,
  Quote,
  CheckCircle2,
  FileDiff,
  Variable,
  Pencil,
  Save,
  Send,
  Archive,
  ChevronDown,
  Clock,
  PlayCircle,
  BookOpenCheck,
  Network,
  Keyboard,
  Sparkles,
  History,
  MessagesSquare,
} from 'lucide-react';
import { toast } from 'sonner';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from 'recharts';

import { AdminShell } from '@/components/admin/AdminShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/src/components/empty-state';

import { useKGNodes } from '@/lib/hooks/useKnowledgeGraph';
import type { KGNode } from '@/lib/knowledge-graph/types';

import {
  type Policy,
  type Standard,
  type Template,
} from '@/lib/org-knowledge/data';

import {
  OverviewTab,
  TemplateGrid,
  RunbookTimeline,
  BestPracticesTab,
  ArtifactGraph,
  BacklinksPanel,
  NewArtifactModal,
  ScopeSwitcher,
  scopeLabel,
  type Scope as ScopeT,
} from '@/src/components/knowledge';
import { ACTIVITY } from '@/src/components/knowledge/sample-data';

type TabId =
  | 'overview'
  | 'standards'
  | 'templates'
  | 'policies'
  | 'runbooks'
  | 'practices'
  | 'activity'
  | 'graph';

type ArtifactStatus = 'draft' | 'published' | 'archived';
type Scope = 'org' | 'project' | 'archived';

const TABS: ReadonlyArray<{
  id: TabId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'overview', label: 'Overview', icon: Sparkles },
  { id: 'standards', label: 'Standards', icon: BookText },
  { id: 'templates', label: 'Templates', icon: LayoutTemplate },
  { id: 'policies', label: 'Policies', icon: ShieldCheck },
  { id: 'runbooks', label: 'Runbooks', icon: PlayCircle },
  { id: 'practices', label: 'Best Practices', icon: BookOpenCheck },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'graph', label: 'Graph', icon: Network },
];

const TAB_CREATE_LABEL: Record<TabId, string> = {
  overview: 'New',
  standards: 'New Standard',
  templates: 'New Template',
  policies: 'New Policy',
  runbooks: 'New Runbook',
  practices: 'New Practice',
  activity: 'New',
  graph: 'New',
};

const SCOPE_FILTERS: ReadonlyArray<{ id: Scope; label: string }> = [
  { id: 'org', label: 'Org-wide' },
  { id: 'project', label: 'Project-scoped' },
  { id: 'archived', label: 'Archived' },
];

function idFor(kind: 'standard' | 'template' | 'policy', index: number): string {
  const prefix = kind === 'standard' ? 'F-001' : kind === 'template' ? 'F-002' : 'F-003';
  return `${prefix}-${String(index + 1).padStart(3, '0')}`;
}

// ---------------------------------------------------------------------------
// KG doc adapter (Step 57 zone 8 — Org Knowledge wired to real backend)
// ---------------------------------------------------------------------------
//
// The Organization Knowledge page reads docs from the knowledge graph
// (`/kg/nodes?type=doc`). Each KG doc node carries a `category` inside
// `properties` that maps it to one of the six org-knowledge zones:
//
//   standards       → F-001 master-detail (zone 4)
//   templates       → F-002 master-detail (zone 5)
//   policies        → F-003 master-detail (zone 6)
//   runbooks        → F-004 timeline       (zone 7)
//   best-practices  → F-005 best practices (zone 8)
//   docs            → general docs / activity (zones 9 / 10 / 13)
//
// Unknown / missing categories fall through into `docs` so the page
// never silently drops rows — surfaces the "uncategorised" bucket
// rather than hiding data (Rule 15 spirit).

type DocCategory =
  | 'standards'
  | 'templates'
  | 'policies'
  | 'runbooks'
  | 'best-practices'
  | 'docs';

const DOC_CATEGORIES: ReadonlyArray<DocCategory> = [
  'standards',
  'templates',
  'policies',
  'runbooks',
  'best-practices',
  'docs',
];

interface GroupedDocs {
  standards: ReadonlyArray<Standard>;
  templates: ReadonlyArray<Template>;
  policies: ReadonlyArray<Policy>;
  runbooks: ReadonlyArray<KGNode>;
  practices: ReadonlyArray<KGNode>;
  docs: ReadonlyArray<KGNode>;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function nodeToStandard(node: KGNode, idx: number): Standard {
  const props = asRecord(node.properties);
  const rawStatus = asString(props.status, 'draft').toLowerCase();
  const status: Standard['status'] =
    rawStatus === 'approved' || rawStatus === 'deprecated'
      ? (rawStatus as Standard['status'])
      : rawStatus === 'in-review'
        ? 'in-review'
        : 'draft';
  return {
    id: node.id,
    title: node.name || 'Untitled standard',
    category: (asString(props.category, 'documentation') as Standard['category']),
    status,
    owner: asString(props.owner, 'Unassigned'),
    body: asString(props.body),
    updatedAt: asString(props.updated_at, node.updated_at) || node.updated_at,
    version: asString(props.version, '1.0.0'),
  };
}

function nodeToTemplate(node: KGNode): Template {
  const props = asRecord(node.properties);
  const rawKind = asString(props.kind, 'prd');
  const allowedKinds: ReadonlyArray<Template['kind']> = ['prd', 'adr', 'contract', 'task', 'risk', 'security'];
  const kind: Template['kind'] = (allowedKinds as ReadonlyArray<string>).includes(rawKind)
    ? (rawKind as Template['kind'])
    : 'prd';
  return {
    id: node.id,
    title: node.name || 'Untitled template',
    kind,
    description: asString(props.description),
    updatedAt: asString(props.updated_at, node.updated_at) || node.updated_at,
    preview: asString(props.preview) || asString(props.body),
    owner: asString(props.owner, 'Unassigned'),
    uses: typeof props.uses === 'number' ? (props.uses as number) : 0,
  };
}

function nodeToPolicy(node: KGNode): Policy {
  const props = asRecord(node.properties);
  const rawEffect = asString(props.effect, 'allow');
  const allowedEffects: ReadonlyArray<Policy['effect']> = ['allow', 'deny', 'require-approval', 'notify'];
  const effect: Policy['effect'] = (allowedEffects as ReadonlyArray<string>).includes(rawEffect)
    ? (rawEffect as Policy['effect'])
    : 'allow';
  const logic = props.logic && typeof props.logic === 'object' && !Array.isArray(props.logic)
    ? (props.logic as Record<string, unknown>)
    : {};
  return {
    id: node.id,
    title: node.name || 'Untitled policy',
    effect,
    scope: asString(props.scope, 'org'),
    logic,
    enabled: props.enabled !== false,
    updatedAt: asString(props.updated_at, node.updated_at) || node.updated_at,
    owner: asString(props.owner, 'Unassigned'),
  };
}

function groupDocsByCategory(nodes: ReadonlyArray<KGNode>): GroupedDocs {
  const buckets: Record<DocCategory, KGNode[]> = {
    standards: [],
    templates: [],
    policies: [],
    runbooks: [],
    'best-practices': [],
    docs: [],
  };
  for (const node of nodes) {
    if (node.node_type !== 'doc') continue;
    const raw = asString(asRecord(node.properties).category).toLowerCase();
    const category: DocCategory = (DOC_CATEGORIES as ReadonlyArray<string>).includes(raw)
      ? (raw as DocCategory)
      : 'docs';
    buckets[category].push(node);
  }
  return {
    standards: buckets.standards.map(nodeToStandard),
    templates: buckets.templates.map(nodeToTemplate),
    policies: buckets.policies.map(nodeToPolicy),
    runbooks: buckets.runbooks,
    practices: buckets['best-practices'],
    docs: buckets.docs,
  };
}

const EMPTY_GROUPED_DOCS: GroupedDocs = {
  standards: [],
  templates: [],
  policies: [],
  runbooks: [],
  practices: [],
  docs: [],
};

// ---------------------------------------------------------------------------
// Per-zone states (Step 57 zone 8)
// ---------------------------------------------------------------------------
//
// Every content zone renders the same three substates:
//   loading  → shimmering skeleton in the master pane + a quiet spinner hint
//   error    → single `EmptyState` with retry; the page-level toast already
//              alerted via `useEffect` above, so the zone itself stays calm
//   empty    → the existing `EmptyState` per kind (Rules 15)
//   ready    → the existing master-detail / timeline / best-practices UI
//
// The wrapper keeps the 14-zone layout untouched: each tab still owns one
// primary panel + one right-hand panel exactly as before.

function ZoneSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div
      className="flex max-h-[calc(100vh-220px)] flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5"
      data-testid="ok-zone-skeleton"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="ml-auto h-3 w-16" />
      </div>
      <div className="flex flex-col gap-2">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-3">
            <Skeleton className="h-4 w-24" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <Skeleton className="h-3 w-12" />
          </div>
        ))}
      </div>
    </div>
  );
}

function ZoneErrorPanel({
  message,
  onRetry,
  testId,
}: {
  message: string;
  onRetry: () => void;
  testId: string;
}) {
  return (
    <div data-testid={testId}>
      <EmptyState
        illustration={<BookOpen size={40} strokeWidth={1.5} />}
        title="Couldn't load this knowledge zone"
        description={message}
        primaryAction={{ label: 'Retry', onClick: onRetry }}
        secondaryAction={{ label: 'Dismiss', onClick: () => toast.info('Retrying on next tab visit') }}
      />
    </div>
  );
}

const STATUS_DOT: Record<ArtifactStatus, string> = {
  draft: 'bg-[var(--accent-amber)]',
  published: 'bg-[var(--accent-emerald)] shadow-[0_0_6px_var(--accent-emerald)]',
  archived: 'bg-[var(--fg-muted)]',
};
const STATUS_LABEL: Record<ArtifactStatus, string> = {
  draft: 'Draft',
  published: 'Published',
  archived: 'Archived',
};

// ---------------------------------------------------------------------------
// Atoms
// ---------------------------------------------------------------------------
function Pill({
  active,
  onClick,
  children,
  testId,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid={testId}
      className={cn(
        'inline-flex items-center gap-1 rounded-[var(--radius-md)] border px-2.5 py-1 text-xs transition-colors duration-150 ease-out-soft',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
        active
          ? 'border-[var(--accent-primary)] bg-[rgba(99,102,241,0.12)] text-[var(--accent-primary)]'
          : 'border-[var(--border-subtle)] bg-[var(--bg-inset)] text-[var(--fg-secondary)] hover:border-[var(--border-default)] hover:text-[var(--fg-primary)]',
      )}
    >
      {children}
    </button>
  );
}

function TabBar({
  active,
  onChange,
  counts,
}: {
  active: TabId;
  onChange: (t: TabId) => void;
  counts: Record<TabId, number>;
}) {
  return (
    <div
      role="tablist"
      aria-label="Organization knowledge sections"
      className="inline-flex w-full items-center gap-1 overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-1"
      data-testid="ok-tabs"
    >
      {TABS.map((t) => {
        const isActive = t.id === active;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={isActive}
            type="button"
            onClick={() => onChange(t.id)}
            data-testid={`ok-tab-${t.id}`}
            className={cn(
              'relative inline-flex shrink-0 items-center gap-2 rounded-[var(--radius-md)] px-3 py-1.5 text-sm font-medium transition-colors duration-150 ease-out-soft',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
              isActive ? 'text-[var(--fg-primary)]' : 'text-[var(--fg-tertiary)] hover:text-[var(--fg-secondary)]',
            )}
          >
            {isActive ? (
              <motion.span
                layoutId="ok-tab-pill"
                className="absolute inset-0 rounded-[var(--radius-md)] bg-[var(--bg-elevated)] shadow-[var(--shadow-sm)]"
                transition={{ type: 'tween', duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                aria-hidden="true"
              />
            ) : null}
            <t.icon className="relative h-3.5 w-3.5" aria-hidden="true" />
            <span className="relative whitespace-nowrap">{t.label}</span>
            <span
              className={cn(
                'relative rounded-[var(--radius-sm)] px-1.5 py-0.5 font-mono text-[10px]',
                isActive ? 'bg-[var(--bg-base)] text-[var(--fg-secondary)]' : 'bg-[var(--bg-base)]/60 text-[var(--fg-tertiary)]',
              )}
            >
              {counts[t.id]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Breadcrumb({ tab, item, scopeName }: { tab: TabId; item?: { label: string }; scopeName: string }) {
  const tabLabel = TABS.find((t) => t.id === tab)?.label ?? tab;
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex flex-wrap items-center gap-1 text-xs text-[var(--fg-tertiary)]"
      data-testid="ok-breadcrumb"
    >
      <span>Knowledge</span>
      <ChevronRight className="h-3 w-3" aria-hidden="true" />
      <span>{scopeName}</span>
      <ChevronRight className="h-3 w-3" aria-hidden="true" />
      <span>{tabLabel}</span>
      {item ? (
        <>
          <ChevronRight className="h-3 w-3" aria-hidden="true" />
          <span className="font-mono text-[var(--fg-secondary)]">{item.label}</span>
        </>
      ) : null}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Markdown renderer (Step 12 — kept intact)
// ---------------------------------------------------------------------------
function renderMarkdown(src: string): React.ReactNode[] {
  const lines = src.split('\n');
  const out: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.startsWith('### ')) {
      out.push(<h3 key={key++} className="mt-3 text-base font-semibold text-[var(--fg-primary)]">{line.slice(4)}</h3>);
      i++;
      continue;
    }
    if (line.startsWith('## ')) {
      out.push(<h2 key={key++} className="mt-4 text-lg font-semibold text-[var(--fg-primary)]">{line.slice(3)}</h2>);
      i++;
      continue;
    }
    if (line.startsWith('# ')) {
      out.push(<h1 key={key++} className="mt-5 text-xl font-bold text-[var(--fg-primary)]">{line.slice(2)}</h1>);
      i++;
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^[-*]\s+/, ''));
        i++;
      }
      out.push(
        <ul key={key++} className="ml-5 list-disc text-sm text-[var(--fg-secondary)]">
          {items.map((t, idx) => <li key={idx}>{inline(t)}</li>)}
        </ul>,
      );
      continue;
    }
    if (line.trim() === '') {
      out.push(<div key={key++} className="h-2" aria-hidden="true" />);
      i++;
      continue;
    }
    out.push(<p key={key++} className="text-sm text-[var(--fg-secondary)]">{inline(line)}</p>);
    i++;
  }
  return out;
}

function inline(text: string): React.ReactNode {
  const nodes: React.ReactNode[] = [];
  let rest = text;
  let key = 0;
  const patterns: Array<{ re: RegExp; render: (m: string) => React.ReactNode }> = [
    { re: /`([^`]+)`/, render: (m) => <code key={key++} className="rounded bg-[var(--bg-inset)] px-1 py-0.5 font-mono text-xs text-[var(--accent-cyan)]">{m.slice(1, -1)}</code> },
    { re: /\*\*([^*]+)\*\*/, render: (m) => <strong key={key++} className="font-semibold text-[var(--fg-primary)]">{m.slice(2, -2)}</strong> },
    { re: /\*([^*]+)\*/, render: (m) => <em key={key++}>{m.slice(1, -1)}</em> },
    { re: /\[([^\]]+)\]\(([^)]+)\)/, render: (m) => {
      const match = m.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (!match) return m;
      return <a key={key++} href={match[2]} className="text-[var(--accent-primary)] underline-offset-2 hover:underline">{match[1]}</a>;
    } },
  ];
  while (rest.length > 0) {
    let matched = false;
    for (const { re, render } of patterns) {
      const m = rest.match(re);
      if (m && m.index !== undefined) {
        if (m.index > 0) nodes.push(rest.slice(0, m.index));
        nodes.push(render(m[0]));
        rest = rest.slice(m.index + m[0].length);
        matched = true;
        break;
      }
    }
    if (!matched) {
      nodes.push(rest);
      break;
    }
  }
  return nodes;
}

function extractVariables(body: string): string[] {
  const matches = body.match(/\{\{\s*([\w.]+)\s*\}\}/g) ?? [];
  return Array.from(new Set(matches.map((m) => m.replace(/[{}\s]/g, ''))));
}

function wordCount(src: string): number {
  return src.trim().length === 0 ? 0 : src.trim().split(/\s+/).length;
}
function readMinutes(words: number): string {
  const m = Math.max(1, Math.round(words / 200));
  return `${m} min read`;
}

// ---------------------------------------------------------------------------
// Toolbar (Step 12)
// ---------------------------------------------------------------------------
function ToolbarButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      data-testid={`md-toolbar-${label.toLowerCase().replace(/\s+/g, '-')}`}
      className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-[var(--fg-tertiary)] transition-colors duration-150 hover:bg-[var(--bg-elevated)] hover:text-[var(--fg-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
    >
      {children}
    </button>
  );
}

function Toolbar({ onInsert }: { onInsert: (snippet: string) => void }) {
  const wrap = (before: string, after = before) => {
    onInsert(before + 'text' + after);
  };
  return (
    <div
      className="flex flex-wrap items-center gap-1 border-b border-[var(--border-subtle)] bg-[var(--bg-base)] p-2"
      data-testid="md-toolbar"
      role="toolbar"
      aria-label="Markdown formatting"
    >
      <ToolbarButton onClick={() => wrap('**')} label="Bold"><Bold className="h-3.5 w-3.5" /></ToolbarButton>
      <ToolbarButton onClick={() => wrap('*')} label="Italic"><Italic className="h-3.5 w-3.5" /></ToolbarButton>
      <ToolbarButton onClick={() => onInsert('\n## Heading\n')} label="Heading"><Heading2 className="h-3.5 w-3.5" /></ToolbarButton>
      <ToolbarButton onClick={() => onInsert('[text](https://forge-ai.dev)')} label="Link"><Link2 className="h-3.5 w-3.5" /></ToolbarButton>
      <ToolbarButton onClick={() => onInsert('\n- item\n- item\n')} label="List"><ListIcon className="h-3.5 w-3.5" /></ToolbarButton>
      <ToolbarButton onClick={() => onInsert('\n```ts\ncode\n```\n')} label="Code"><Code2 className="h-3.5 w-3.5" /></ToolbarButton>
      <ToolbarButton onClick={() => onInsert('\n> quote\n')} label="Quote"><Quote className="h-3.5 w-3.5" /></ToolbarButton>
      <span className="ml-auto inline-flex items-center gap-1">
        <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--fg-tertiary)]">Insert variable</span>
        <button
          type="button"
          onClick={() => onInsert('\n{{project_name}}\n')}
          data-testid="md-insert-variable"
          className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-2 py-0.5 text-[10px] text-[var(--fg-secondary)] hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
        >
          <Variable className="h-2.5 w-2.5" aria-hidden="true" />{' '}
          {`{{project_name}}`} <ChevronDown className="h-2.5 w-2.5" aria-hidden="true" />
        </button>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor shell (Step 12 — extended with sub-tabs, AI suggestions, backlinks)
// ---------------------------------------------------------------------------
type EditorSubTab = 'content' | 'versions' | 'usage' | 'discussions' | 'ai';

function EditableTitle({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  const [savedAt, setSavedAt] = React.useState<Date | null>(new Date());
  const [now, setNow] = React.useState<Date>(new Date());
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 5000);
    return () => clearInterval(t);
  }, []);

  React.useEffect(() => setDraft(value), [value]);

  const commit = (next: string) => {
    if (next === value) return;
    onChange(next);
    setSavedAt(new Date());
  };

  const handleBlur = () => {
    setEditing(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => commit(draft.trim() || value), 0);
  };

  const handleChange = (next: string) => {
    setDraft(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => commit(next.trim() || value), 1500);
  };

  const elapsed = savedAt ? Math.max(1, Math.round((now.getTime() - savedAt.getTime()) / 1000)) : null;

  return (
    <div className="flex flex-col gap-1.5" data-testid="ok-title-row">
      {editing ? (
        <Input
          autoFocus
          value={draft}
          onChange={(e) => handleChange(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
            if (e.key === 'Escape') {
              setDraft(value);
              setEditing(false);
            }
          }}
          aria-label="Title"
          data-testid="ok-title-input"
          className="text-[var(--text-2xl)] font-bold"
        />
      ) : (
        <h1
          onClick={() => setEditing(true)}
          tabIndex={0}
          role="button"
          data-testid="ok-title-display"
          className="cursor-text rounded-[var(--radius-sm)] text-[var(--text-2xl)] font-bold leading-tight text-[var(--fg-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
        >
          {value || 'Untitled'}
        </h1>
      )}
      {savedAt ? (
        <p className="flex items-center gap-1.5 text-xs text-[var(--fg-tertiary)]" data-testid="ok-autosave-indicator">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--accent-emerald)] shadow-[0_0_6px_var(--accent-emerald)]" aria-hidden="true" />
          Saved {elapsed !== null && elapsed < 60 ? `${elapsed}s ago` : 'just now'}
        </p>
      ) : null}
    </div>
  );
}

function AiSuggestionsPanel({ title }: { title: string }) {
  // Stub — shows mock AI suggestions. The real implementation will hit the
  // Forge Provider Abstraction Layer (Rule 1).
  const suggestions = [
    { id: 'a1', text: `Add an explicit "scope" section to ${title || 'this artifact'}.` },
    { id: 'a2', text: 'Reference the linked policy F-003-002 to make this enforceable.' },
    { id: 'a3', text: '3 active projects already use this — surface a code snippet in the body.' },
    { id: 'a4', text: 'Last review was 47 days ago — schedule a refresh.' },
  ];
  return (
    <div className="flex flex-col gap-2 p-4" data-testid="ok-ai-suggestions">
      <header className="flex items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 text-[var(--accent-violet)]" aria-hidden="true" />
        <h3 className="text-xs font-semibold text-[var(--fg-primary)]">AI suggestions</h3>
        <span className="ml-auto font-mono text-[10px] text-[var(--fg-tertiary)]">stub · ready for LLM</span>
      </header>
      <ul className="flex flex-col gap-1.5">
        {suggestions.map((s) => (
          <li
            key={s.id}
            className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2 text-xs text-[var(--fg-secondary)]"
          >
            {s.text}
            <div className="mt-1 flex gap-1">
              <button
                type="button"
                className="rounded-[var(--radius-sm)] border border-[var(--accent-primary)]/40 bg-[var(--accent-primary)]/10 px-2 py-0.5 text-[10px] text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/20"
              >
                Apply
              </button>
              <button
                type="button"
                className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2 py-0.5 text-[10px] text-[var(--fg-tertiary)] hover:text-[var(--fg-primary)]"
              >
                Dismiss
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function VersionsPanel({ id }: { id: string }) {
  // Mock version history with synthetic diffs.
  const versions = [
    { v: '1.4.0', when: '2 days ago', added: 18, removed: 4, by: 'Priya' },
    { v: '1.3.0', when: '2 weeks ago', added: 7, removed: 12, by: 'Diego' },
    { v: '1.2.0', when: '1 month ago', added: 22, removed: 6, by: 'Aisha' },
    { v: '1.1.0', when: '3 months ago', added: 4, removed: 1, by: 'Tom' },
    { v: '1.0.0', when: '6 months ago', added: 80, removed: 0, by: 'Priya' },
  ];
  return (
    <div className="flex flex-col gap-2 p-4" data-testid="ok-versions">
      <header className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-xs font-semibold text-[var(--fg-primary)]">
          <History className="h-3.5 w-3.5" aria-hidden="true" />
          Version history
        </h3>
        <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">{id}</span>
      </header>
      <ol className="flex flex-col gap-1">
        {versions.map((v) => (
          <li
            key={v.v}
            className="flex items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2 text-xs text-[var(--fg-secondary)]"
          >
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-[var(--accent-primary)]">v{v.v}</span>
              <span>{v.when}</span>
              <span className="text-[var(--fg-tertiary)]">· {v.by}</span>
            </div>
            <span className="inline-flex items-center gap-2 font-mono text-[10px]">
              <span className="text-[var(--accent-emerald)]">+{v.added}</span>
              <span className="text-[var(--accent-rose)]">−{v.removed}</span>
              <button className="text-[var(--fg-tertiary)] hover:text-[var(--fg-primary)]">View diff</button>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function UsagePanel() {
  return (
    <div className="flex flex-col gap-2 p-4" data-testid="ok-usage">
      <h3 className="text-xs font-semibold text-[var(--fg-primary)]">Usage & compliance</h3>
      <ul className="flex flex-col gap-1.5 text-xs text-[var(--fg-secondary)]">
        <li className="flex items-center justify-between rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2">
          <span>Forge Platform</span>
          <span className="font-mono text-[10px] text-[var(--accent-emerald)]">96% compliant · 12 references</span>
        </li>
        <li className="flex items-center justify-between rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2">
          <span>Acme Corp Onboarding</span>
          <span className="font-mono text-[10px] text-[var(--accent-emerald)]">88% · 9 references</span>
        </li>
        <li className="flex items-center justify-between rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2">
          <span>Payment Service</span>
          <span className="font-mono text-[10px] text-[var(--accent-amber)]">72% · 5 references</span>
        </li>
      </ul>
    </div>
  );
}

function DiscussionsPanel() {
  return (
    <div className="flex flex-col gap-2 p-4" data-testid="ok-discussions">
      <h3 className="flex items-center gap-2 text-xs font-semibold text-[var(--fg-primary)]">
        <MessagesSquare className="h-3.5 w-3.5" aria-hidden="true" />
        Discussions
      </h3>
      <p className="text-xs text-[var(--fg-secondary)]">
        Threaded comments (markdown) — opens when this artifact is published.
      </p>
      <button
        type="button"
        className="self-start rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1 text-[10px] text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]"
      >
        Start a discussion
      </button>
    </div>
  );
}

function KnowledgeEditorShell({
  id,
  scope,
  status,
  title,
  onTitleChange,
  meta,
  body,
  onBodyChange,
  sidebar,
  linked,
  showBacklinks,
  onSelectBacklink,
  onPublish,
  onSaveDraft,
  onDiscard,
}: {
  id: string;
  scope: Scope;
  status: ArtifactStatus;
  title: string;
  onTitleChange: (next: string) => void;
  meta: { author: string; createdAt: string; updatedAt: string; version: string };
  body: string;
  onBodyChange: (next: string) => void;
  sidebar?: React.ReactNode;
  linked: ReadonlyArray<{ id: string; label: string }>;
  showBacklinks?: boolean;
  onSelectBacklink?: (kind: 'standard' | 'template' | 'policy' | 'runbook' | 'practice', id: string) => void;
  onPublish: () => void;
  onSaveDraft: () => void;
  onDiscard: () => void;
}) {
  const [mode, setMode] = React.useState<'write' | 'preview' | 'split'>('split');
  const [subTab, setSubTab] = React.useState<EditorSubTab>('content');
  const words = wordCount(body);
  const minutes = readMinutes(words);

  const handleInsert = (snippet: string) => {
    onBodyChange(body + snippet);
  };

  return (
    <article
      className="flex max-h-[calc(100vh-220px)] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
      data-testid="ok-editor"
    >
      <header className="flex items-start justify-between gap-3 border-b border-[var(--border-subtle)] p-5">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-[var(--radius-sm)] bg-[var(--bg-inset)] px-2 py-0.5 font-mono text-[10px] text-[var(--fg-primary)]" data-testid="ok-id-badge">
              {id}
            </span>
            <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
              {scope === 'org' ? 'Org-wide' : scope === 'project' ? 'Project-scoped' : 'Archived'}
            </Badge>
            <span className="inline-flex items-center gap-1.5 text-xs text-[var(--fg-tertiary)]" data-testid="ok-status">
              <span className={cn('h-2 w-2 rounded-full', STATUS_DOT[status])} aria-hidden="true" />
              {STATUS_LABEL[status]}
            </span>
          </div>
          <EditableTitle value={title} onChange={onTitleChange} />
          <div className="flex flex-wrap items-center gap-2 text-[10px] text-[var(--fg-tertiary)]">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[var(--bg-inset)] font-mono text-[10px] text-[var(--fg-primary)]">
              {meta.author.slice(0, 1).toUpperCase()}
            </span>
            <span>{meta.author}</span>
            <span>·</span>
            <span>Created {new Date(meta.createdAt).toLocaleDateString()}</span>
            <span>·</span>
            <span>Edited {new Date(meta.updatedAt).toLocaleDateString()}</span>
            <span>·</span>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-1.5 py-0.5 font-mono hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
              data-testid="ok-version-badge"
            >
              v{meta.version} <ChevronDown className="h-2.5 w-2.5" aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="More"
            data-testid="ok-overflow"
            className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--fg-tertiary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--fg-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
          >
            <MoreVertical className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* Editor sub-tabs (Zone 4) */}
      <div className="flex items-center gap-1 border-b border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-1">
        {(['content', 'versions', 'usage', 'discussions', 'ai'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSubTab(s)}
            aria-pressed={subTab === s}
            data-testid={`ok-subtab-${s}`}
            className={cn(
              'inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-1 text-[10px] font-medium uppercase tracking-wide transition-colors',
              subTab === s
                ? 'bg-[var(--bg-elevated)] text-[var(--fg-primary)] shadow-[var(--shadow-sm)]'
                : 'text-[var(--fg-tertiary)] hover:text-[var(--fg-secondary)]',
            )}
          >
            {s === 'ai' ? <Sparkles className="h-2.5 w-2.5" aria-hidden="true" /> : null}
            {s === 'versions' ? <History className="h-2.5 w-2.5" aria-hidden="true" /> : null}
            {s === 'discussions' ? <MessagesSquare className="h-2.5 w-2.5" aria-hidden="true" /> : null}
            {s}
          </button>
        ))}
      </div>

      <div className={cn('flex min-h-0 flex-1', sidebar || showBacklinks ? 'xl:grid xl:grid-cols-[1fr_280px]' : '')}>
        <div className="flex min-h-0 flex-1 flex-col">
          {subTab === 'content' ? (
            <>
              <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-3 py-1.5">
                <div className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--bg-inset)] p-0.5">
                  {(['write', 'split', 'preview'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMode(m)}
                      aria-pressed={mode === m}
                      data-testid={`md-mode-${m}`}
                      className={cn(
                        'rounded-[var(--radius-sm)] px-2 py-0.5 text-[10px] font-medium capitalize transition-colors',
                        mode === m
                          ? 'bg-[var(--bg-elevated)] text-[var(--fg-primary)] shadow-[var(--shadow-sm)]'
                          : 'text-[var(--fg-tertiary)] hover:text-[var(--fg-secondary)]',
                      )}
                    >
                      {m === 'write' ? 'Write' : m === 'split' ? 'Split' : 'Preview'}
                    </button>
                  ))}
                </div>
                <span className="text-[10px] text-[var(--fg-tertiary)]">Markdown · dark theme</span>
              </div>
              <Toolbar onInsert={handleInsert} />
              <div className={cn('flex min-h-0 flex-1', mode === 'split' && 'xl:grid xl:grid-cols-2')}>
                {mode !== 'preview' ? (
                  <textarea
                    value={body}
                    onChange={(e) => onBodyChange(e.target.value)}
                    aria-label="Markdown body"
                    data-testid="ok-body-textarea"
                    className="thin-scrollbar min-h-[280px] flex-1 resize-none border-r border-[var(--border-subtle)] bg-[var(--bg-base)] p-4 font-mono text-xs leading-relaxed text-[var(--fg-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
                  />
                ) : null}
                {mode !== 'write' ? (
                  <div
                    data-testid="ok-body-preview"
                    className="thin-scrollbar min-h-[280px] flex-1 overflow-y-auto p-4"
                  >
                    {body.trim() ? renderMarkdown(body) : <p className="text-xs text-[var(--fg-muted)]">Nothing to preview yet.</p>}
                  </div>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-1.5 border-t border-[var(--border-subtle)] px-5 py-3">
                <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--fg-tertiary)]">Linked</span>
                {linked.length === 0 ? (
                  <span className="text-[10px] text-[var(--fg-muted)]">No linked artefacts</span>
                ) : (
                  linked.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => toast.info(`Open linked ${l.label}`)}
                      className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--fg-secondary)] hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
                    >
                      {l.label}
                    </button>
                  ))
                )}
                <button
                  type="button"
                  onClick={() => toast.info('Open Combobox to link artefact')}
                  data-testid="ok-link-add"
                  className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-dashed border-[var(--border-default)] px-1.5 py-0.5 text-[10px] text-[var(--fg-tertiary)] hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
                >
                  <Plus className="h-2.5 w-2.5" aria-hidden="true" /> Add link
                </button>
              </div>
            </>
          ) : null}

          {subTab === 'versions' ? <VersionsPanel id={id} /> : null}
          {subTab === 'usage' ? <UsagePanel /> : null}
          {subTab === 'discussions' ? <DiscussionsPanel /> : null}
          {subTab === 'ai' ? <AiSuggestionsPanel title={title} /> : null}
        </div>

        {(sidebar || showBacklinks) ? (
          <aside className="hidden border-l border-[var(--border-subtle)] bg-[var(--bg-base)] xl:block">
            {sidebar}
            {showBacklinks && onSelectBacklink ? (
              <BacklinksPanel artifactId={id} onSelect={onSelectBacklink} />
            ) : null}
          </aside>
        ) : null}
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-subtle)] p-4">
        <div className="flex items-center gap-3 text-[10px] text-[var(--fg-tertiary)]">
          <span>{words} words</span>
          <span>·</span>
          <span>{minutes}</span>
          <span>·</span>
          <span className="inline-flex items-center gap-1">
            <Clock className="h-2.5 w-2.5" aria-hidden="true" />
            Autosaved
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onDiscard}
            data-testid="ok-action-discard"
            className="text-[var(--fg-secondary)]"
          >
            Discard changes
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onSaveDraft}
            data-testid="ok-action-save-draft"
          >
            <Save className="mr-1.5 h-3 w-3" aria-hidden="true" /> Save draft
          </Button>
          <Button
            size="sm"
            onClick={onPublish}
            data-testid="ok-action-publish"
            className="bg-[var(--accent-primary)] text-white hover:opacity-90"
          >
            <Send className="mr-1.5 h-3 w-3" aria-hidden="true" /> Publish
          </Button>
        </div>
      </footer>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Sidebars
// ---------------------------------------------------------------------------
function VariablesSidebar({ body }: { body: string }) {
  const vars = extractVariables(body);
  return (
    <div className="flex h-full flex-col gap-3 p-4" data-testid="ok-variables">
      <header>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">
          Variables
        </h3>
        <p className="text-[10px] text-[var(--fg-muted)]">
          {vars.length} detected from the body
        </p>
      </header>
      {vars.length === 0 ? (
        <p className="rounded-[var(--radius-md)] border border-dashed border-[var(--border-subtle)] p-3 text-[10px] text-[var(--fg-muted)]">
          Add <code className="font-mono text-[var(--accent-cyan)]">{'{{name}}'}</code> placeholders in the body.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {vars.map((v) => (
            <li key={v} className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2">
              <p className="inline-flex items-center gap-1 font-mono text-[10px] text-[var(--accent-cyan)]">
                <Variable className="h-2.5 w-2.5" aria-hidden="true" /> {`{{${v}}}`}
              </p>
              <p className="mt-1 text-[10px] text-[var(--fg-tertiary)]">
                Replace with the project-specific value at instantiation.
              </p>
              <p className="mt-1 font-mono text-[10px] text-[var(--fg-secondary)]">
                e.g. <span className="text-[var(--accent-primary)]">sample-{v}</span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EnforcementSidebar({
  scope,
  strictness,
  ackRequired,
  onChange,
}: {
  scope: Scope;
  strictness: 'strict' | 'advisory' | 'off';
  ackRequired: boolean;
  onChange: (next: { scope?: Scope; strictness?: 'strict' | 'advisory' | 'off'; ackRequired?: boolean }) => void;
}) {
  return (
    <div className="flex h-full flex-col gap-3 p-4" data-testid="ok-enforcement">
      <header>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">
          Enforcement
        </h3>
        <p className="text-[10px] text-[var(--fg-muted)]">
          Applies when this policy is published.
        </p>
      </header>
      <div className="space-y-2">
        <Label className="text-[10px] uppercase tracking-wide text-[var(--fg-tertiary)]" htmlFor="ok-policy-scope">
          Scope
        </Label>
        <select
          id="ok-policy-scope"
          value={scope}
          onChange={(e) => onChange({ scope: e.target.value as Scope })}
          data-testid="ok-policy-scope"
          className="w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1.5 text-xs text-[var(--fg-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
        >
          <option value="org">Org</option>
          <option value="project">Project</option>
          <option value="archived">Resource type</option>
        </select>
      </div>
      <div className="space-y-2">
        <Label className="text-[10px] uppercase tracking-wide text-[var(--fg-tertiary)]">
          Strictness
        </Label>
        <div className="flex flex-col gap-1.5">
          {(['strict', 'advisory', 'off'] as const).map((s) => (
            <label
              key={s}
              className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1.5 text-xs text-[var(--fg-primary)] hover:border-[var(--accent-primary)] focus-within:ring-2 focus-within:ring-[var(--accent-primary)]"
            >
              <input
                type="radio"
                name="ok-policy-strictness"
                checked={strictness === s}
                onChange={() => onChange({ strictness: s })}
                data-testid={`ok-strictness-${s}`}
                className="accent-[var(--accent-primary)]"
              />
              <span className="capitalize">{s}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1.5">
        <Label htmlFor="ok-policy-ack" className="text-xs text-[var(--fg-primary)]">
          Acknowledgement required
        </Label>
        <Switch
          id="ok-policy-ack"
          checked={ackRequired}
          onCheckedChange={(v) => onChange({ ackRequired: v })}
          data-testid="ok-policy-ack"
        />
      </div>
      <div>
        <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--fg-tertiary)]">
          Violations (last 30d)
        </p>
        <div className="mt-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2 text-xs text-[var(--fg-secondary)]">
          <div className="flex items-center justify-between">
            <span>No violations ✓</span>
            <span className="font-mono text-[10px] text-[var(--accent-emerald)]">0 / 30d</span>
          </div>
          <div className="mt-2 flex h-8 items-end gap-0.5" aria-hidden="true">
            {Array.from({ length: 30 }).map((_, i) => (
              <span
                key={i}
                className="flex-1 rounded-sm bg-[var(--accent-emerald)]/20"
                style={{ height: `${10 + (i % 4) * 5}%` }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Master-detail list panel
// ---------------------------------------------------------------------------
function ArtifactListPanel<T extends { id: string }>({
  items,
  selectedId,
  onSelect,
  kind,
  query,
  onQueryChange,
  scope,
  onScopeChange,
  empty,
  renderMeta,
}: {
  items: ReadonlyArray<T>;
  selectedId: string | undefined;
  onSelect: (item: T) => void;
  kind: 'standard' | 'template' | 'policy';
  query: string;
  onQueryChange: (next: string) => void;
  scope: Scope;
  onScopeChange: (next: Scope) => void;
  empty: string;
  renderMeta: (item: T, idx: number) => { title: string; subtitle?: string; badge?: string; status?: ArtifactStatus };
}) {
  const filtered = items.filter((it, idx) => {
    const m = renderMeta(it, idx);
    if (query.trim() && !m.title.toLowerCase().includes(query.trim().toLowerCase()) && !idFor(kind, idx).toLowerCase().includes(query.trim().toLowerCase())) {
      return false;
    }
    if (scope === 'archived' && m.status !== 'archived') return false;
    if (scope !== 'archived' && m.status === 'archived') return false;
    return true;
  });

  return (
    <aside className="flex max-h-[640px] flex-col gap-3 lg:sticky lg:top-4 lg:self-start">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--fg-tertiary)]"
          aria-hidden="true"
        />
        <Input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={`Search ${kind === 'standard' ? 'F-001' : kind === 'template' ? 'F-002' : 'F-003'}…`}
          aria-label={`Search ${kind}s`}
          data-testid={`ok-${kind}-search`}
          className="pl-8 text-sm"
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {SCOPE_FILTERS.map((f) => (
          <Pill
            key={f.id}
            active={scope === f.id}
            onClick={() => onScopeChange(f.id)}
            testId={`ok-${kind}-scope-${f.id}`}
          >
            {f.label}
          </Pill>
        ))}
      </div>
      <ul
        role="list"
        className="thin-scrollbar -mr-2 flex max-h-[440px] flex-col gap-1 overflow-y-auto pr-2"
        data-testid={`ok-${kind}-list`}
      >
        {filtered.length === 0 ? (
          <li>
            <div className="flex flex-col items-center gap-2 rounded-[var(--radius-md)] border border-dashed border-[var(--border-subtle)] p-4 text-center text-[10px] text-[var(--fg-muted)]">
              <span>{empty}</span>
              <button
                type="button"
                onClick={() => toast.info(`Open ${TAB_CREATE_LABEL[kind === 'standard' ? 'standards' : kind === 'template' ? 'templates' : 'policies']} dialog`)}
                className="inline-flex items-center gap-1 text-[var(--accent-primary)] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
              >
                <Plus className="h-2.5 w-2.5" aria-hidden="true" /> New
              </button>
            </div>
          </li>
        ) : (
          filtered.map((it) => {
            const idx = items.findIndex((x) => x.id === it.id);
            const m = renderMeta(it, idx);
            const isActive = selectedId === it.id;
            return (
              <li key={it.id}>
                <button
                  type="button"
                  onClick={() => onSelect(it)}
                  aria-pressed={isActive}
                  data-testid={`ok-${kind}-item`}
                  data-item-id={it.id}
                  className={cn(
                    'relative flex w-full flex-col gap-1 rounded-[var(--radius-md)] border p-2.5 text-left text-sm transition-colors duration-150 ease-out-soft',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
                    isActive
                      ? 'border-[var(--accent-primary)]/50 bg-[rgba(99,102,241,0.10)] text-[var(--fg-primary)]'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--fg-secondary)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--fg-primary)]',
                  )}
                >
                  {isActive ? (
                    <span aria-hidden="true" className="absolute inset-y-1 left-0 w-[2px] rounded-full bg-[var(--accent-primary)]" />
                  ) : null}
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">
                      {idFor(kind, idx)}
                    </span>
                    {m.status ? (
                      <span className="inline-flex items-center gap-1 text-[10px] text-[var(--fg-tertiary)]">
                        <span className={cn('h-1.5 w-1.5 rounded-full', STATUS_DOT[m.status])} aria-hidden="true" />
                        {STATUS_LABEL[m.status]}
                      </span>
                    ) : null}
                  </div>
                  <span className="line-clamp-2 text-sm font-medium leading-tight">{m.title}</span>
                  <div className="flex items-center justify-between gap-2 text-[10px] text-[var(--fg-tertiary)]">
                    <span>{m.subtitle}</span>
                    {m.badge ? (
                      <span className="rounded-[var(--radius-sm)] bg-[var(--bg-inset)] px-1.5 py-0.5 font-mono">{m.badge}</span>
                    ) : null}
                  </div>
                </button>
              </li>
            );
          })
        )}
      </ul>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Master-detail wrappers (preserved from Step 12)
// ---------------------------------------------------------------------------
function StandardMasterDetail({
  standards,
  selectedId,
  onSelect,
  draftTitle,
  draftBody,
  onTitleChange,
  onBodyChange,
  onPublish,
  onSaveDraft,
  onDiscard,
  onSelectBacklink,
}: {
  standards: ReadonlyArray<Standard>;
  selectedId: string | undefined;
  onSelect: (s: Standard) => void;
  draftTitle: string;
  draftBody: string;
  onTitleChange: (next: string) => void;
  onBodyChange: (next: string) => void;
  onPublish: () => void;
  onSaveDraft: () => void;
  onDiscard: () => void;
  onSelectBacklink: (kind: 'standard' | 'template' | 'policy' | 'runbook' | 'practice', id: string) => void;
}) {
  const [query, setQuery] = React.useState('');
  const [scope, setScope] = React.useState<Scope>('org');
  const selected = standards.find((s) => s.id === selectedId) ?? null;
  const selectedIdx = selected ? standards.findIndex((s) => s.id === selected.id) : 0;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]" data-testid="standards-master-detail">
      <ArtifactListPanel
        items={standards}
        selectedId={selectedId}
        onSelect={onSelect}
        kind="standard"
        query={query}
        onQueryChange={setQuery}
        scope={scope}
        onScopeChange={setScope}
        empty="No F-001 yet"
        renderMeta={(s, idx) => ({
          title: s.title,
          subtitle: `Edited ${new Date(s.updatedAt).toLocaleDateString()}`,
          badge: s.category,
          status: s.status === 'approved' ? 'published' : s.status === 'deprecated' ? 'archived' : 'draft',
        })}
      />
      <div className="min-w-0">
        {selected ? (
          <KnowledgeEditorShell
            id={idFor('standard', selectedIdx)}
            scope={scope}
            status={selected.status === 'approved' ? 'published' : selected.status === 'deprecated' ? 'archived' : 'draft'}
            title={draftTitle}
            onTitleChange={onTitleChange}
            meta={{
              author: selected.owner,
              createdAt: selected.updatedAt,
              updatedAt: selected.updatedAt,
              version: selected.version,
            }}
            body={draftBody}
            onBodyChange={onBodyChange}
            linked={[
              { id: 't1', label: 'forge-onboarding-template' },
              { id: 'a1', label: 'ADR-0014' },
            ]}
            showBacklinks
            onSelectBacklink={onSelectBacklink}
            onPublish={onPublish}
            onSaveDraft={onSaveDraft}
            onDiscard={onDiscard}
          />
        ) : (
          <EmptyState
            illustration={<BookOpen size={40} strokeWidth={1.5} />}
            title="Select an artefact to edit"
            description="Pick an F-001 standard, F-002 template, or F-003 policy from the list. Or create a new one."
            primaryAction={{ label: 'Create Standard', onClick: () => toast.info('Open Create Standard dialog') }}
          />
        )}
      </div>
    </div>
  );
}

function TemplateMasterDetail({
  templates,
  selectedId,
  onSelect,
  draftTitle,
  draftBody,
  onTitleChange,
  onBodyChange,
  onPublish,
  onSaveDraft,
  onDiscard,
  onSelectBacklink,
}: {
  templates: ReadonlyArray<Template>;
  selectedId: string | undefined;
  onSelect: (t: Template) => void;
  draftTitle: string;
  draftBody: string;
  onTitleChange: (next: string) => void;
  onBodyChange: (next: string) => void;
  onPublish: () => void;
  onSaveDraft: () => void;
  onDiscard: () => void;
  onSelectBacklink: (kind: 'standard' | 'template' | 'policy' | 'runbook' | 'practice', id: string) => void;
}) {
  const [query, setQuery] = React.useState('');
  const [scope, setScope] = React.useState<Scope>('org');
  const selected = templates.find((t) => t.id === selectedId) ?? null;
  const selectedIdx = selected ? templates.findIndex((t) => t.id === selected.id) : 0;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]" data-testid="templates-master-detail">
      <ArtifactListPanel
        items={templates}
        selectedId={selectedId}
        onSelect={onSelect}
        kind="template"
        query={query}
        onQueryChange={setQuery}
        scope={scope}
        onScopeChange={setScope}
        empty="No F-002 yet"
        renderMeta={(t) => ({
          title: t.title,
          subtitle: `Edited ${new Date(t.updatedAt).toLocaleDateString()}`,
          badge: t.kind,
          status: 'published',
        })}
      />
      <div className="min-w-0">
        {selected ? (
          <KnowledgeEditorShell
            id={idFor('template', selectedIdx)}
            scope={scope}
            status="published"
            title={draftTitle}
            onTitleChange={onTitleChange}
            meta={{
              author: selected.owner,
              createdAt: selected.updatedAt,
              updatedAt: selected.updatedAt,
              version: '1.2.0',
            }}
            body={draftBody}
            onBodyChange={onBodyChange}
            sidebar={<VariablesSidebar body={draftBody} />}
            linked={[
              { id: 's1', label: 'F-001-007' },
              { id: 'p1', label: 'F-003-002' },
            ]}
            showBacklinks
            onSelectBacklink={onSelectBacklink}
            onPublish={onPublish}
            onSaveDraft={onSaveDraft}
            onDiscard={onDiscard}
          />
        ) : (
          <EmptyState
            illustration={<LayoutTemplate size={40} strokeWidth={1.5} />}
            title="No F-002 yet"
            description="Templates are reusable scaffolds shared across every project in this tenant."
            primaryAction={{ label: 'Create Template', onClick: () => toast.info('Open Create Template dialog') }}
          />
        )}
      </div>
    </div>
  );
}

function PolicyMasterDetail({
  policies,
  selectedId,
  onSelect,
  draftTitle,
  draftBody,
  onTitleChange,
  onBodyChange,
  onPublish,
  onSaveDraft,
  onDiscard,
  scope,
  strictness,
  ackRequired,
  onEnforcementChange,
  onSelectBacklink,
}: {
  policies: ReadonlyArray<Policy>;
  selectedId: string | undefined;
  onSelect: (p: Policy) => void;
  draftTitle: string;
  draftBody: string;
  onTitleChange: (next: string) => void;
  onBodyChange: (next: string) => void;
  onPublish: () => void;
  onSaveDraft: () => void;
  onDiscard: () => void;
  scope: Scope;
  strictness: 'strict' | 'advisory' | 'off';
  ackRequired: boolean;
  onEnforcementChange: (next: { scope?: Scope; strictness?: 'strict' | 'advisory' | 'off'; ackRequired?: boolean }) => void;
  onSelectBacklink: (kind: 'standard' | 'template' | 'policy' | 'runbook' | 'practice', id: string) => void;
}) {
  const [query, setQuery] = React.useState('');
  const selected = policies.find((p) => p.id === selectedId) ?? null;
  const selectedIdx = selected ? policies.findIndex((p) => p.id === selected.id) : 0;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]" data-testid="policies-master-detail">
      <ArtifactListPanel
        items={policies}
        selectedId={selectedId}
        onSelect={onSelect}
        kind="policy"
        query={query}
        onQueryChange={setQuery}
        scope={scope}
        onScopeChange={(s) => onEnforcementChange({ scope: s })}
        empty="No F-003 yet"
        renderMeta={(p) => ({
          title: p.title,
          subtitle: `Updated ${new Date(p.updatedAt).toLocaleDateString()}`,
          badge: p.effect,
          status: p.enabled ? 'published' : 'archived',
        })}
      />
      <div className="min-w-0">
        {selected ? (
          <KnowledgeEditorShell
            id={idFor('policy', selectedIdx)}
            scope={scope}
            status={selected.enabled ? 'published' : 'archived'}
            title={draftTitle}
            onTitleChange={onTitleChange}
            meta={{
              author: selected.owner,
              createdAt: selected.updatedAt,
              updatedAt: selected.updatedAt,
              version: '0.3.0',
            }}
            body={draftBody}
            onBodyChange={onBodyChange}
            sidebar={
              <EnforcementSidebar
                scope={scope}
                strictness={strictness}
                ackRequired={ackRequired}
                onChange={onEnforcementChange}
              />
            }
            linked={[
              { id: 's2', label: 'F-001-003' },
              { id: 't2', label: 'F-002-001' },
            ]}
            showBacklinks
            onSelectBacklink={onSelectBacklink}
            onPublish={onPublish}
            onSaveDraft={onSaveDraft}
            onDiscard={onDiscard}
          />
        ) : (
          <EmptyState
            illustration={<ShieldCheck size={40} strokeWidth={1.5} />}
            title="No F-003 yet"
            description="Policies encode governance rules. Define one to enforce a tenant-wide contract."
            primaryAction={{ label: 'Create Policy', onClick: () => toast.info('Open Create Policy dialog') }}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Activity tab — change log + adoption metrics
// ---------------------------------------------------------------------------
function ActivityTab() {
  const [subTab, setSubTab] = React.useState<'log' | 'metrics'>('log');
  return (
    <div className="flex flex-col gap-4" data-testid="ok-activity-tab">
      <div className="flex flex-wrap items-center gap-1.5">
        {(['log', 'metrics'] as const).map((s) => (
          <Pill key={s} active={subTab === s} onClick={() => setSubTab(s)} testId={`ok-activity-subtab-${s}`}>
            {s === 'log' ? 'Change log' : 'Adoption metrics'}
          </Pill>
        ))}
      </div>
      {subTab === 'log' ? <ChangeLog /> : <AdoptionMetrics />}
    </div>
  );
}

function ChangeLog() {
  return (
    <div className="flex flex-col gap-3" data-testid="ok-change-log">
      <div className="flex flex-wrap items-center gap-1.5">
        {(['all', 'created', 'updated', 'approved', 'archived'] as const).map((f) => (
          <Pill key={f} active={false} onClick={() => {}} testId={`ok-change-filter-${f}`}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </Pill>
        ))}
      </div>
      <ol className="relative ml-3 border-l border-[var(--border-default)]">
        {ACTIVITY.map((e) => {
          const tone =
            e.action === 'approved'
              ? 'border-[var(--accent-emerald)] bg-[var(--accent-emerald)] text-white'
              : e.action === 'archived'
                ? 'border-[var(--fg-muted)] bg-[var(--bg-surface)] text-[var(--fg-muted)]'
                : 'border-[var(--accent-primary)] bg-[var(--accent-primary)] text-white';
          return (
            <li key={e.id} className="mb-4 ml-6" data-testid="ok-change-item">
              <span
                aria-hidden="true"
                className={cn('absolute -left-[11px] flex h-5 w-5 items-center justify-center rounded-full border', tone)}
              >
                {e.action === 'approved' ? <CheckCircle2 className="h-3 w-3" /> : e.action === 'archived' ? <Archive className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
              </span>
              <article className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 shadow-[var(--shadow-sm)]">
                <header className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[var(--bg-inset)] font-mono text-[10px] text-[var(--fg-primary)]">
                    {e.actor.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="text-[var(--fg-primary)]">{e.actor}</span>
                  <span className="text-[var(--fg-tertiary)]">{e.action}</span>
                  <span className="rounded-[var(--radius-sm)] bg-[var(--bg-inset)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--accent-primary)]">
                    {e.ref.label}
                  </span>
                  <time className="ml-auto font-mono text-[10px] text-[var(--fg-tertiary)]">
                    {new Date(e.when).toLocaleString()}
                  </time>
                </header>
              </article>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

const METRIC_VIEWS = Array.from({ length: 7 }, (_, i) => ({ day: `D${i + 1}`, v: 20 + ((i * 7) % 35) }));
const METRIC_EDITS = Array.from({ length: 30 }, (_, i) => ({ day: `D${i + 1}`, v: 5 + ((i * 3) % 18) }));
const METRIC_FUNNEL = Array.from({ length: 8 }, (_, i) => ({ step: `S${i + 1}`, published: 80 - i * 4, used: 60 - i * 5, ack: 30 - i * 3 }));
const METRIC_COMPLIANCE = Array.from({ length: 12 }, (_, i) => ({ m: `M${i + 1}`, score: 70 + Math.round(Math.sin(i / 1.5) * 8 + i) }));

function AdoptionMetrics() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" data-testid="ok-metrics">
      <ChartCard title="Most viewed this week">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={METRIC_VIEWS}>
            <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="2 4" />
            <XAxis dataKey="day" stroke="var(--fg-tertiary)" tick={{ fontSize: 10 }} />
            <YAxis stroke="var(--fg-tertiary)" tick={{ fontSize: 10 }} />
            <Tooltip
              contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 6, fontSize: 11 }}
            />
            <Bar dataKey="v" fill="var(--accent-primary)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Most edited this month">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={METRIC_EDITS}>
            <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="2 4" />
            <XAxis dataKey="day" stroke="var(--fg-tertiary)" tick={{ fontSize: 10 }} />
            <YAxis stroke="var(--fg-tertiary)" tick={{ fontSize: 10 }} />
            <Tooltip
              contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 6, fontSize: 11 }}
            />
            <Line type="monotone" dataKey="v" stroke="var(--accent-cyan)" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Adoption funnel">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={METRIC_FUNNEL}>
            <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="2 4" />
            <XAxis dataKey="step" stroke="var(--fg-tertiary)" tick={{ fontSize: 10 }} />
            <YAxis stroke="var(--fg-tertiary)" tick={{ fontSize: 10 }} />
            <Tooltip
              contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 6, fontSize: 11 }}
            />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Area type="monotone" dataKey="published" stroke="var(--accent-primary)" fill="var(--accent-primary)" fillOpacity={0.18} />
            <Area type="monotone" dataKey="used" stroke="var(--accent-cyan)" fill="var(--accent-cyan)" fillOpacity={0.18} />
            <Area type="monotone" dataKey="ack" stroke="var(--accent-emerald)" fill="var(--accent-emerald)" fillOpacity={0.18} />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Compliance over time">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={METRIC_COMPLIANCE}>
            <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="2 4" />
            <XAxis dataKey="m" stroke="var(--fg-tertiary)" tick={{ fontSize: 10 }} />
            <YAxis stroke="var(--fg-tertiary)" tick={{ fontSize: 10 }} domain={[60, 100]} />
            <Tooltip
              contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 6, fontSize: 11 }}
            />
            <Line type="monotone" dataKey="score" stroke="var(--accent-violet)" strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex h-[220px] flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
      <p className="text-xs font-semibold text-[var(--fg-primary)]">{title}</p>
      <div className="flex-1">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shortcuts dialog
// ---------------------------------------------------------------------------
function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const rows: Array<[string, string]> = [
    ['⌘N', 'New artifact'],
    ['⌘⇧S', 'Switch scope (org vs project)'],
    ['⌘K', 'Search (semantic)'],
    ['⌘⇧F', 'Toggle favorites filter'],
    ['/', 'Focus search'],
    ['⌘/', 'Show this dialog'],
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="ok-shortcuts">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-4 w-4" aria-hidden="true" /> Keyboard shortcuts
          </DialogTitle>
        </DialogHeader>
        <ul className="grid grid-cols-1 gap-1.5">
          {rows.map(([k, l]) => (
            <li
              key={k}
              className="flex items-center justify-between rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs text-[var(--fg-secondary)]"
            >
              <span>{l}</span>
              <kbd className="rounded border border-[var(--border-subtle)] bg-[var(--bg-base)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--fg-primary)]">
                {k}
              </kbd>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function OrganizationKnowledgePage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Step 57 zone 8 — single KG fetch for all `doc` nodes, grouped by
  // properties.category into the six org-knowledge zones. One query
  // keeps the loading / error state coherent across the page.
  const docsRes = useKGNodes({ kind: 'doc', limit: 1000 });
  const grouped = React.useMemo<GroupedDocs>(
    () => groupDocsByCategory(docsRes.data ?? []),
    [docsRes.data],
  );

  // Surface backend failures as a toast the first time the error arrives.
  // Each zone also renders its own skeleton + empty state below.
  React.useEffect(() => {
    if (docsRes.error) {
      toast.error(`Knowledge graph unreachable: ${docsRes.error.message}`, { duration: 4000 });
    }
  }, [docsRes.error]);

  const standards = grouped.standards;
  const templates = grouped.templates;
  const policies = grouped.policies;

  const tabParam = (searchParams?.get('tab') as TabId | null) ?? 'overview';
  const tab: TabId = TABS.some((t) => t.id === tabParam) ? tabParam : 'overview';
  const idParam = searchParams?.get('id') ?? undefined;
  const scopeParam = (searchParams?.get('scope') as string | null) ?? 'org';

  const [localStandards, setLocalStandards] = React.useState<ReadonlyArray<Standard>>(standards);
  const [localTemplates, setLocalTemplates] = React.useState<ReadonlyArray<Template>>(templates);
  const [localPolicies, setLocalPolicies] = React.useState<ReadonlyArray<Policy>>(policies);

  React.useEffect(() => {
    setLocalStandards(standards);
  }, [standards]);
  React.useEffect(() => {
    setLocalTemplates(templates);
  }, [templates]);
  React.useEffect(() => {
    setLocalPolicies(policies);
  }, [policies]);

  const [scopeSwitcher, setScopeSwitcher] = React.useState<ScopeT>(
    scopeParam === 'org' || scopeParam === 'project' ? { kind: scopeParam, projectId: scopeParam === 'project' ? 'proj-forge-platform' : '' } : { kind: 'org' },
  );
  React.useEffect(() => {
    setScopeSwitcher(scopeParam === 'org' || scopeParam === 'project' ? { kind: scopeParam, projectId: scopeParam === 'project' ? 'proj-forge-platform' : '' } : { kind: 'org' });
  }, [scopeParam]);

  const [newOpen, setNewOpen] = React.useState(false);
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);

  const updateUrl = React.useCallback(
    (next: Partial<{ tab: TabId; id: string; scope: string }>) => {
      const params = new URLSearchParams();
      params.set('tab', next.tab ?? tab);
      if (next.id) params.set('id', next.id);
      else if (idParam) params.set('id', idParam);
      params.set('scope', next.scope ?? scopeSwitcher.kind);
      router.replace(`/organization-knowledge?${params.toString()}`, { scroll: false });
    },
    [router, tab, idParam, scopeSwitcher.kind],
  );

  const counts: Record<TabId, number> = {
    overview: grouped.docs.length + localStandards.length + localTemplates.length + localPolicies.length + grouped.runbooks.length + grouped.practices.length,
    standards: localStandards.length,
    templates: localTemplates.length,
    policies: localPolicies.length,
    runbooks: grouped.runbooks.length,
    practices: grouped.practices.length,
    activity: ACTIVITY.length,
    graph: 0,
  };

  const selectedStandardId = tab === 'standards' ? idParam ?? localStandards[0]?.id : undefined;
  const selectedTemplateId = tab === 'templates' ? idParam ?? localTemplates[0]?.id : undefined;
  const selectedPolicyId = tab === 'policies' ? idParam ?? localPolicies[0]?.id : undefined;

  const selectedStandard = localStandards.find((s) => s.id === selectedStandardId) ?? null;
  const selectedTemplate = localTemplates.find((t) => t.id === selectedTemplateId) ?? null;
  const selectedPolicy = localPolicies.find((p) => p.id === selectedPolicyId) ?? null;

  const [draftTitle, setDraftTitle] = React.useState('');
  const [draftBody, setDraftBody] = React.useState('');
  const [policyScope, setPolicyScope] = React.useState<Scope>('org');
  const [policyStrictness, setPolicyStrictness] = React.useState<'strict' | 'advisory' | 'off'>('advisory');
  const [policyAck, setPolicyAck] = React.useState<boolean>(false);

  React.useEffect(() => {
    if (selectedStandard) {
      setDraftTitle(selectedStandard.title);
      setDraftBody(selectedStandard.body);
    }
  }, [selectedStandard]);
  React.useEffect(() => {
    if (selectedTemplate) {
      setDraftTitle(selectedTemplate.title);
      setDraftBody(selectedTemplate.preview);
    }
  }, [selectedTemplate]);
  React.useEffect(() => {
    if (selectedPolicy) {
      setDraftTitle(selectedPolicy.title);
      setDraftBody(JSON.stringify(selectedPolicy.logic, null, 2));
    }
  }, [selectedPolicy]);

  const [pendingPublish, setPendingPublish] = React.useState<{ id: string; tab: TabId; title: string } | null>(null);

  const handlePublish = () => {
    const title = draftTitle || 'Untitled';
    if (tab === 'standards' && selectedStandard) {
      setPendingPublish({ id: selectedStandard.id, tab, title });
    } else if (tab === 'templates' && selectedTemplate) {
      setPendingPublish({ id: selectedTemplate.id, tab, title });
    } else if (tab === 'policies' && selectedPolicy) {
      setPendingPublish({ id: selectedPolicy.id, tab, title });
    } else {
      toast.info('Pick an artefact to publish');
    }
  };

  const confirmPublish = () => {
    if (!pendingPublish) return;
    if (pendingPublish.tab === 'standards') {
      setLocalStandards((curr) =>
        curr.map((s) =>
          s.id === pendingPublish.id
            ? { ...s, title: draftTitle || s.title, body: draftBody, status: 'approved', updatedAt: new Date().toISOString() }
            : s,
        ),
      );
    } else if (pendingPublish.tab === 'templates') {
      setLocalTemplates((curr) =>
        curr.map((t) =>
          t.id === pendingPublish.id
            ? { ...t, title: draftTitle || t.title, preview: draftBody, updatedAt: new Date().toISOString() }
            : t,
        ),
      );
    } else {
      setLocalPolicies((curr) =>
        curr.map((p) =>
          p.id === pendingPublish.id
            ? { ...p, title: draftTitle || p.title, updatedAt: new Date().toISOString() }
            : p,
        ),
      );
    }
    toast.success(`Published ${pendingPublish.title}`, { duration: 3500 });
    setPendingPublish(null);
  };

  const handleSaveDraft = () => {
    if (!selectedStandard && !selectedTemplate && !selectedPolicy) {
      toast.info('Pick an artefact to save');
      return;
    }
    if (tab === 'standards' && selectedStandard) {
      setLocalStandards((curr) =>
        curr.map((s) =>
          s.id === selectedStandard.id
            ? { ...s, title: draftTitle || s.title, body: draftBody, updatedAt: new Date().toISOString() }
            : s,
        ),
      );
    } else if (tab === 'templates' && selectedTemplate) {
      setLocalTemplates((curr) =>
        curr.map((t) =>
          t.id === selectedTemplate.id
            ? { ...t, title: draftTitle || t.title, preview: draftBody, updatedAt: new Date().toISOString() }
            : t,
        ),
      );
    } else if (tab === 'policies' && selectedPolicy) {
      setLocalPolicies((curr) =>
        curr.map((p) =>
          p.id === selectedPolicy.id
            ? { ...p, title: draftTitle || p.title, updatedAt: new Date().toISOString() }
            : p,
        ),
      );
    }
    toast.success('Draft saved', { duration: 2500 });
  };

  const handleDiscard = () => {
    if (selectedStandard) {
      setDraftTitle(selectedStandard.title);
      setDraftBody(selectedStandard.body);
    } else if (selectedTemplate) {
      setDraftTitle(selectedTemplate.title);
      setDraftBody(selectedTemplate.preview);
    } else if (selectedPolicy) {
      setDraftTitle(selectedPolicy.title);
      setDraftBody(JSON.stringify(selectedPolicy.logic, null, 2));
    }
    toast.info('Reverted to last saved version', { duration: 2000 });
  };

  // Global keyboard shortcuts (Zone 14)
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setNewOpen(true);
      } else if (meta && e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        setScopeSwitcher((s) =>
          s.kind === 'org' ? { kind: 'project', projectId: 'proj-forge-platform' } : { kind: 'org' },
        );
        toast.info('Toggled scope');
      } else if (meta && e.key === '/') {
        e.preventDefault();
        setShortcutsOpen(true);
      } else if (e.key === '/' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        const input = document.querySelector<HTMLInputElement>('[data-testid="ok-templates-search"], [data-testid="ok-standards-search"], [data-testid="ok-policies-search"]');
        if (input) {
          e.preventDefault();
          input.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleBacklinkSelect = (kind: 'standard' | 'template' | 'policy' | 'runbook' | 'practice', id: string) => {
    const tabMap: Record<typeof kind, TabId> = {
      standard: 'standards',
      template: 'templates',
      policy: 'policies',
      runbook: 'runbooks',
      practice: 'practices',
    };
    updateUrl({ tab: tabMap[kind], id });
    toast.info(`Opening ${kind} ${id}`);
  };

  const breadcrumbItem = (() => {
    if (tab === 'standards' && selectedStandard) {
      const idx = localStandards.findIndex((s) => s.id === selectedStandard.id);
      return { label: idFor('standard', idx) };
    }
    if (tab === 'templates' && selectedTemplate) {
      const idx = localTemplates.findIndex((t) => t.id === selectedTemplate.id);
      return { label: idFor('template', idx) };
    }
    if (tab === 'policies' && selectedPolicy) {
      const idx = localPolicies.findIndex((p) => p.id === selectedPolicy.id);
      return { label: idFor('policy', idx) };
    }
    return undefined;
  })();

  return (
    <AdminShell>
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-6" data-testid="organization-knowledge">
        {/* ZONE 1 — Hero + Scope switcher + New */}
        <section
          className="hero-border relative overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-8 py-7"
          data-testid="ok-hero"
        >
          <div className="relative z-10 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex flex-col gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--fg-tertiary)]">
                Center
              </p>
              <h1 className="flex items-center gap-3 text-[var(--text-3xl)] font-bold leading-tight text-[var(--fg-primary)]">
                <BookMarkedGlyph />
                Organization Knowledge
              </h1>
              <p className="max-w-2xl text-[var(--text-sm)] text-[var(--fg-secondary)]">
                Org-level standards (F-001), templates (F-002), and policies (F-003).
                These artefacts are shared across all projects in this tenant. New: runbooks
                (F-004) and best practices (F-005).
              </p>
              <p className="mt-1 inline-flex items-center gap-2 font-mono text-[10px] text-[var(--fg-tertiary)]">
                Scope: <span className="text-[var(--fg-primary)]">{scopeLabel(scopeSwitcher, [])}</span>
                <span>·</span>
                <span data-testid="ok-scope-count">{counts.overview + counts.runbooks + counts.practices + localStandards.length + localTemplates.length + localPolicies.length} artifacts</span>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ScopeSwitcher
                value={scopeSwitcher}
                onChange={(s) => {
                  setScopeSwitcher(s);
                  updateUrl({ scope: s.kind });
                }}
                artifactCount={counts.overview + counts.runbooks + counts.practices + localStandards.length + localTemplates.length + localPolicies.length}
              />
              <Button
                onClick={() => setNewOpen(true)}
                data-testid="ok-hero-create"
                className="bg-[var(--accent-primary)] text-white hover:opacity-90"
              >
                <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> New
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShortcutsOpen(true)}
                data-testid="ok-hero-shortcuts"
                className="text-[var(--fg-secondary)]"
                aria-label="Keyboard shortcuts"
              >
                <Keyboard className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Shortcuts
              </Button>
            </div>
          </div>
        </section>

        <Breadcrumb tab={tab} item={breadcrumbItem} scopeName={scopeLabel(scopeSwitcher, [])} />
        <TabBar
          active={tab}
          onChange={(t) => updateUrl({ tab: t })}
          counts={counts}
        />

        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          >
            {tab === 'overview' ? <OverviewTab /> : null}

            {tab === 'standards' ? (
              docsRes.isLoading ? (
                <ZoneSkeleton rows={5} />
              ) : docsRes.error ? (
                <ZoneErrorPanel
                  message={`Could not load standards: ${docsRes.error.message}`}
                  onRetry={() => void docsRes.refetch()}
                  testId="ok-standards-error"
                />
              ) : (
                <StandardMasterDetail
                  standards={localStandards}
                  selectedId={selectedStandardId}
                  onSelect={(s) => updateUrl({ id: s.id })}
                  draftTitle={draftTitle}
                  draftBody={draftBody}
                  onTitleChange={setDraftTitle}
                  onBodyChange={setDraftBody}
                  onPublish={handlePublish}
                  onSaveDraft={handleSaveDraft}
                  onDiscard={handleDiscard}
                  onSelectBacklink={handleBacklinkSelect}
                />
              )
            ) : null}

            {tab === 'templates' ? (
              docsRes.isLoading ? (
                <ZoneSkeleton rows={4} />
              ) : docsRes.error ? (
                <ZoneErrorPanel
                  message={`Could not load templates: ${docsRes.error.message}`}
                  onRetry={() => void docsRes.refetch()}
                  testId="ok-templates-error"
                />
              ) : (
                <TemplateMasterDetail
                  templates={localTemplates}
                  selectedId={selectedTemplateId}
                  onSelect={(t) => updateUrl({ id: t.id })}
                  draftTitle={draftTitle}
                  draftBody={draftBody}
                  onTitleChange={setDraftTitle}
                  onBodyChange={setDraftBody}
                  onPublish={handlePublish}
                  onSaveDraft={handleSaveDraft}
                  onDiscard={handleDiscard}
                  onSelectBacklink={handleBacklinkSelect}
                />
              )
            ) : null}

            {tab === 'policies' ? (
              docsRes.isLoading ? (
                <ZoneSkeleton rows={3} />
              ) : docsRes.error ? (
                <ZoneErrorPanel
                  message={`Could not load policies: ${docsRes.error.message}`}
                  onRetry={() => void docsRes.refetch()}
                  testId="ok-policies-error"
                />
              ) : (
                <PolicyMasterDetail
                  policies={localPolicies}
                  selectedId={selectedPolicyId}
                  onSelect={(p) => updateUrl({ id: p.id })}
                  draftTitle={draftTitle}
                  draftBody={draftBody}
                  onTitleChange={setDraftTitle}
                  onBodyChange={setDraftBody}
                  onPublish={handlePublish}
                  onSaveDraft={handleSaveDraft}
                  onDiscard={handleDiscard}
                  scope={policyScope}
                  strictness={policyStrictness}
                  ackRequired={policyAck}
                  onEnforcementChange={(next) => {
                    if (next.scope !== undefined) setPolicyScope(next.scope);
                    if (next.strictness !== undefined) setPolicyStrictness(next.strictness);
                    if (next.ackRequired !== undefined) setPolicyAck(next.ackRequired);
                  }}
                  onSelectBacklink={handleBacklinkSelect}
                />
              )
            ) : null}

            {tab === 'runbooks' ? (
              docsRes.isLoading ? (
                <ZoneSkeleton rows={3} />
              ) : docsRes.error ? (
                <ZoneErrorPanel
                  message={`Could not load runbooks: ${docsRes.error.message}`}
                  onRetry={() => void docsRes.refetch()}
                  testId="ok-runbooks-error"
                />
              ) : grouped.runbooks.length === 0 ? (
                <div data-testid="ok-runbooks-empty">
                  <EmptyState
                    illustration={<PlayCircle size={40} strokeWidth={1.5} />}
                    title="No runbooks yet"
                    description={`Runbooks (F-004) capture the steps teams take to recover or operate services. ${grouped.runbooks.length === 0 ? 'Tag an existing doc with category: runbooks during ingestion, or connect the Runbooks connector to populate this zone.' : ''}`}
                    primaryAction={{ label: 'Create Runbook', onClick: () => toast.info('Open Create Runbook dialog') }}
                    secondaryAction={{ label: 'Browse marketplace', onClick: () => toast.info('Open Runbooks connector') }}
                  />
                </div>
              ) : (
                <RunbookTimeline />
              )
            ) : null}

            {tab === 'practices' ? (
              docsRes.isLoading ? (
                <ZoneSkeleton rows={4} />
              ) : docsRes.error ? (
                <ZoneErrorPanel
                  message={`Could not load best practices: ${docsRes.error.message}`}
                  onRetry={() => void docsRes.refetch()}
                  testId="ok-practices-error"
                />
              ) : grouped.practices.length === 0 ? (
                <div data-testid="ok-practices-empty">
                  <EmptyState
                    illustration={<BookOpenCheck size={40} strokeWidth={1.5} />}
                    title="No best practices yet"
                    description="Best practices (F-005) capture lessons learned from teams across the tenant. Tag a doc with `category: best-practices` during ingestion to surface it here."
                    primaryAction={{ label: 'Tag existing doc', onClick: () => toast.info('Open doc tagger') }}
                  />
                </div>
              ) : (
                <BestPracticesTab />
              )
            ) : null}

            {tab === 'activity' ? <ActivityTab /> : null}

            {tab === 'graph' ? (
              <ArtifactGraph
                standards={localStandards}
                templates={localTemplates}
                policies={localPolicies}
                onOpen={(kind, id) => handleBacklinkSelect(kind, id)}
              />
            ) : null}

            {tab === 'templates' && selectedTemplate === null ? (
              <div className="mt-4">
                <TemplateGrid
                  templates={localTemplates}
                  onUse={(t) => toast.success(`Cloning ${t.title}…`)}
                />
              </div>
            ) : null}
          </motion.div>
        </AnimatePresence>

        {/* Publish confirmation */}
        <Dialog open={!!pendingPublish} onOpenChange={(o) => !o && setPendingPublish(null)}>
          <DialogContent data-testid="ok-publish-dialog">
            <DialogHeader>
              <DialogTitle>Publish {pendingPublish?.title}?</DialogTitle>
              <DialogDescription>
                Publishing makes this artefact visible to every project in this tenant. You can roll back later via the version history.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setPendingPublish(null)} data-testid="ok-publish-cancel">
                Cancel
              </Button>
              <Button
                onClick={confirmPublish}
                data-testid="ok-publish-confirm"
                className="bg-[var(--accent-primary)] text-white hover:opacity-90"
              >
                <Send className="mr-1.5 h-3 w-3" aria-hidden="true" /> Publish now
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <NewArtifactModal
          open={newOpen}
          onOpenChange={setNewOpen}
          onCreate={(input) => {
            toast.success(`Created ${input.kind} draft: ${input.title}`);
          }}
        />

        <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      </div>
    </AdminShell>
  );
}

function BookMarkedGlyph() {
  return (
    <span className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-md)] bg-[var(--accent-violet)]/15 text-[var(--accent-violet)]" aria-hidden="true">
      <BookOpen className="h-4 w-4" />
    </span>
  );
}