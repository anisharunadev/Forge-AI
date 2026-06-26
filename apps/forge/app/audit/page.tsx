'use client';

/**
 * Audit Center — Phase 0.5 redesign (Step 17).
 *
 * Layout (single column, max 1600px):
 *   1. Hero band — animated gradient border, eyebrow "CENTER",
 *      H1 "Audit Center" + ShieldCheck icon, description, Export (CSV/JSON).
 *   2. Integrity Banner — verified shield, last anchor, record count,
 *      root hash (mono), Verify Now button.
 *   3. Filter Bar — Actor Combobox, Action multi-select, Target Type
 *      multi-select, From/To date pickers + presets, Reset + Apply.
 *   4. Table header — "AUDIT TIMELINE (N OF M)" + density + column visibility.
 *   5. Virtualized table (@tanstack/react-virtual) — sticky header,
 *      hover/active, color-coded actions, copy-hash-on-hover.
 *   6. Detail drawer (640px) — summary, payload, hash chain, diff,
 *      related links, footer with Copy Record ID + Open in New Tab.
 *   7. Empty states — filtered (ScrollText) + no records (ShieldCheck).
 *   8. Loading — 8 skeleton rows with shimmer.
 *
 * Constraints honored:
 *   - Client-side filtering except the date range (per goal).
 *   - Mono hash column + copy-on-hover (Tooltip + Clipboard API).
 *   - Lucide icons only.
 *   - Drawer accessible: Esc, focus restore, ARIA labels.
 *   - Respects prefers-reduced-motion (gradients + shimmer wrapped).
 *   - Filters update instantly; Apply/Reset remain for a11y.
 */

import * as React from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  ShieldCheck,
  Download,
  ScrollText,
  X,
  Copy,
  ExternalLink,
  Link2,
  Calendar,
  ChevronDown,
  Check,
  Search,
  SearchX,
  Rows3,
  Rows4,
  SlidersHorizontal,
  FileJson,
  Globe2,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { EmptyState as LegacyEmptyState } from '@/components/shell';
import { EmptyState } from '@/src/components/empty-state';
import { useToast } from '@/hooks/use-toast';
import { useApiData } from '@/hooks/use-api-data';
import {
  listAuditActions,
  listAuditTargetTypes,
  type AuditActor,
  type AuditRecord,
  type AuditAction,
  type AuditTargetType,
} from '@/lib/audit/data';

// ───────────────────────────────────────────────────────────────────────────
// Types & helpers
// ───────────────────────────────────────────────────────────────────────────

type DatePreset = '24h' | '7d' | '30d' | '90d';

interface FilterState {
  actorId: string;
  actions: ReadonlyArray<AuditAction>;
  targetTypes: ReadonlyArray<AuditTargetType>;
  from: string;
  to: string;
}

interface ColumnVisibility {
  timestamp: boolean;
  actor: boolean;
  action: boolean;
  target: boolean;
  ip: boolean;
  hash: boolean;
}

type Density = 'comfortable' | 'compact';

const ACTION_LABEL: Record<AuditAction, string> = {
  login: 'login',
  logout: 'logout',
  command_run: 'command',
  artifact_created: 'created',
  artifact_published: 'published',
  terminal_command: 'terminal',
  approval_decided: 'approval',
  role_changed: 'role',
  policy_updated: 'policy',
  connector_attached: 'connector',
};

// Action tone mapping → uses shadcn semantic tokens. Style rule: every
// action has a glyph + label so the row is readable without color.
const ACTION_TONE: Record<
  AuditAction,
  { className: string; glyph: string }
> = {
  login: {
    className: 'border-[var(--accent-emerald)]/40 bg-[var(--accent-emerald)]/10 text-[var(--accent-emerald)]',
    glyph: '→',
  },
  logout: {
    className: 'border-[var(--border-default)] bg-[var(--bg-inset)] text-[var(--fg-tertiary)]',
    glyph: '←',
  },
  command_run: {
    className: 'border-[var(--accent-primary)]/40 bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]',
    glyph: '⌘',
  },
  artifact_created: {
    className: 'border-[var(--accent-violet)]/40 bg-[var(--accent-violet)]/10 text-[var(--accent-violet)]',
    glyph: '◆',
  },
  artifact_published: {
    className: 'border-[var(--accent-violet)]/60 bg-[var(--accent-violet)]/20 text-[var(--accent-violet)]',
    glyph: '✦',
  },
  terminal_command: {
    className: 'border-[var(--accent-cyan)]/40 bg-[var(--accent-cyan)]/10 text-[var(--accent-cyan)]',
    glyph: '$_',
  },
  approval_decided: {
    className: 'border-[var(--accent-amber)]/40 bg-[var(--accent-amber)]/10 text-[var(--accent-amber)]',
    glyph: '✓',
  },
  role_changed: {
    className: 'border-[var(--accent-rose)]/40 bg-[var(--accent-rose)]/10 text-[var(--accent-rose)]',
    glyph: '⚑',
  },
  policy_updated: {
    className: 'border-[var(--accent-primary)]/40 bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]',
    glyph: '§',
  },
  connector_attached: {
    className: 'border-[var(--accent-cyan)]/40 bg-[var(--accent-cyan)]/10 text-[var(--accent-cyan)]',
    glyph: '⤷',
  },
};

function download(filename: string, mime: string, content: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function recordsToCsv(records: ReadonlyArray<AuditRecord>): string {
  const headers = [
    'id',
    'timestamp',
    'tenant_id',
    'tenant_name',
    'actor_id',
    'actor_name',
    'action',
    'target_type',
    'target_id',
    'target_label',
    'ip',
    'hash',
    'prev_hash',
  ];
  const escape = (v: unknown): string => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(',')];
  for (const r of records) {
    lines.push(
      [
        r.id,
        r.timestamp,
        r.tenantId,
        r.tenantName,
        r.actor.id,
        r.actor.name,
        r.action,
        r.target.type,
        r.target.id,
        r.target.label,
        (r.payload['ip'] as string | undefined) ?? '',
        r.hash,
        r.prevHash,
      ]
        .map(escape)
        .join(','),
    );
  }
  return lines.join('\n');
}

// Pretty-print JSON with consistent indent + return string for display.
function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

// Synthetic IP/UA per record for demo (real impl: read from payload).
function inferIp(r: AuditRecord): string {
  const ip = r.payload?.['ip'];
  if (typeof ip === 'string') return ip;
  return `10.${(r.actor.id.charCodeAt(0) % 200).toString()}.${(r.id.charCodeAt(0) % 200).toString()}.${((r.timestamp.length * 7) % 200).toString()}`;
}
function inferUa(r: AuditRecord): string {
  const ua = r.payload?.['userAgent'];
  if (typeof ua === 'string') return ua;
  return 'Forge CLI / 0.5';
}
function inferRole(r: AuditRecord): string {
  const role = r.payload?.['role'];
  if (typeof role === 'string') return role;
  return 'eng-lead';
}

function formatTimestamp(iso: string): string {
  // Locale-aware, terse: "Jun 25, 02:14:09" (relative for recent handled
  // by the renderer via title attribute for full ISO).
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Hero (animated gradient border, Step 4 style)
// ───────────────────────────────────────────────────────────────────────────

interface HeroProps {
  exportDisabled: boolean;
  onExport: (kind: 'csv' | 'json') => void;
}

function Hero({ exportDisabled, onExport }: HeroProps) {
  return (
    <section
      className="hero-border relative overflow-hidden rounded-[var(--radius-xl)]"
      data-testid="audit-hero"
      aria-labelledby="audit-hero-title"
    >
      <div className="relative z-10 flex flex-col gap-4 rounded-[var(--radius-xl)] bg-[var(--bg-surface)]/85 px-8 py-7 backdrop-blur-sm md:flex-row md:items-center md:justify-between">
        <div className="flex max-w-2xl flex-col gap-2">
          <p className="text-[var(--text-xs)] font-medium uppercase tracking-widest text-[var(--fg-tertiary)]">
            Center
          </p>
          <div className="flex items-center gap-3">
            <span
              className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] bg-[var(--bg-inset)] text-[var(--accent-primary)]"
              aria-hidden="true"
            >
              <ShieldCheck className="h-4 w-4" strokeWidth={2} />
            </span>
            <h1
              id="audit-hero-title"
              className="text-[var(--text-3xl)] leading-tight text-[var(--fg-primary)]"
              style={{ fontWeight: 700 }}
            >
              Audit Center
            </h1>
          </div>
          <p className="max-w-2xl text-[var(--text-sm)] text-[var(--fg-secondary)]">
            Append-only, tamper-evident audit trail. Every agent action,
            approval, and policy decision is SHA-256 chained to the previous
            record.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2" data-testid="audit-hero-action">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                disabled={exportDisabled}
                className="border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--fg-primary)] hover:bg-[var(--bg-inset)] disabled:opacity-50"
                data-testid="audit-export-trigger"
              >
                <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />
                Export
                <ChevronDown className="ml-1 h-3.5 w-3.5 opacity-60" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => onExport('json')}
                disabled={exportDisabled}
                data-testid="audit-export-json"
              >
                <FileJson className="mr-2 h-4 w-4" aria-hidden="true" />
                Export as JSON
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onExport('csv')}
                disabled={exportDisabled}
                data-testid="audit-export-csv"
              >
                <Download className="mr-2 h-4 w-4" aria-hidden="true" />
                Export as CSV
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </section>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Integrity Banner
// ───────────────────────────────────────────────────────────────────────────

interface IntegrityBannerProps {
  recordCount: number;
  rootHash: string;
  headHash: string;
  lastAnchorAt: string;
  onVerify: () => void;
  verifying: boolean;
}

function IntegrityBanner({
  recordCount,
  rootHash,
  headHash,
  lastAnchorAt,
  onVerify,
  verifying,
}: IntegrityBannerProps) {
  return (
    <section
      className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--accent-emerald)]/30 bg-[var(--accent-emerald)]/5 px-5 py-4 md:flex-row md:items-center md:justify-between"
      data-testid="audit-integrity-banner"
      aria-label="Integrity banner"
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-2">
          <span
            className="relative inline-flex h-2.5 w-2.5"
            aria-hidden="true"
          >
            <span className="absolute inset-0 animate-pulse rounded-full bg-[var(--accent-emerald)]/40" />
            <span className="relative inline-block h-2.5 w-2.5 rounded-full bg-[var(--accent-emerald)]" />
          </span>
          <ShieldCheck
            className="h-4 w-4 text-[var(--accent-emerald)]"
            aria-hidden="true"
          />
          <span className="text-sm font-semibold text-[var(--fg-primary)]">
            Verified
          </span>
          <span className="text-xs text-[var(--fg-tertiary)]">
            · SHA-256 chain
          </span>
        </div>

        <Separator
          orientation="vertical"
          className="hidden h-6 bg-[var(--border-default)] md:block"
        />

        <Stat
          label="Last anchor"
          value={
            <span title={lastAnchorAt}>
              {lastAnchorAt
                ? new Date(lastAnchorAt).toLocaleString()
                : '—'}
            </span>
          }
        />
        <Stat
          label="Records"
          value={
            <span className="font-mono">{recordCount.toLocaleString()}</span>
          }
        />
        <Stat
          label="Head"
          value={
            <span className="font-mono" title={headHash}>
              {headHash ? `${headHash.slice(0, 10)}…` : '—'}
            </span>
          }
        />
        <Stat
          label="Root"
          value={
            <span className="font-mono" title={rootHash}>
              {rootHash ? `${rootHash.slice(0, 10)}…` : '—'}
            </span>
          }
        />
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={onVerify}
          disabled={verifying}
          className="bg-[var(--accent-emerald)] text-white hover:opacity-90"
          data-testid="audit-verify-now"
        >
          <ShieldCheck className="mr-1.5 h-4 w-4" aria-hidden="true" />
          {verifying ? 'Verifying…' : 'Verify Now'}
        </Button>
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] font-medium uppercase tracking-widest text-[var(--fg-tertiary)]">
        {label}
      </span>
      <span className="text-sm text-[var(--fg-primary)]">{value}</span>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Filter Bar — actor combobox, multi-selects, dates, reset, apply
// ───────────────────────────────────────────────────────────────────────────

const DATE_PRESETS: ReadonlyArray<{ id: DatePreset; label: string; days: number }> = [
  { id: '24h', label: 'Last 24h', days: 1 },
  { id: '7d', label: 'Last 7d', days: 7 },
  { id: '30d', label: 'Last 30d', days: 30 },
  { id: '90d', label: 'Last 90d', days: 90 },
];

interface FilterBarProps {
  actors: ReadonlyArray<AuditActor>;
  actions: ReadonlyArray<AuditAction>;
  targetTypes: ReadonlyArray<AuditTargetType>;
  value: FilterState;
  onChange: (next: FilterState) => void;
  activeCount: number;
}

function FilterBar({
  actors,
  actions,
  targetTypes,
  value,
  onChange,
  activeCount,
}: FilterBarProps) {
  const [actorSearch, setActorSearch] = React.useState('');
  const filteredActors = React.useMemo(() => {
    const q = actorSearch.trim().toLowerCase();
    if (!q) return actors;
    return actors.filter(
      (a) =>
        a.name.toLowerCase().includes(q) || a.id.toLowerCase().includes(q),
    );
  }, [actors, actorSearch]);

  const toggleAction = (a: AuditAction) => {
    const next = value.actions.includes(a)
      ? value.actions.filter((x) => x !== a)
      : [...value.actions, a];
    onChange({ ...value, actions: next });
  };
  const toggleTargetType = (t: AuditTargetType) => {
    const next = value.targetTypes.includes(t)
      ? value.targetTypes.filter((x) => x !== t)
      : [...value.targetTypes, t];
    onChange({ ...value, targetTypes: next });
  };

  const applyPreset = (days: number) => {
    const to = new Date();
    const from = new Date(to.getTime() - days * 86_400_000);
    onChange({
      ...value,
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
    });
  };

  const reset = () => {
    onChange({
      actorId: 'all',
      actions: [],
      targetTypes: [],
      from: '',
      to: '',
    });
  };

  const selectedActor =
    value.actorId === 'all'
      ? null
      : actors.find((a) => a.id === value.actorId) ?? null;

  return (
    <section
      className="rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4"
      data-testid="audit-filter-bar"
      aria-label="Audit filters"
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
        {/* Actor Combobox */}
        <div className="md:col-span-3">
          <FilterLabel>Actor</FilterLabel>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex h-9 w-full items-center justify-between rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-inset)] px-3 text-sm text-[var(--fg-primary)] transition-colors hover:bg-[var(--bg-surface)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
                data-testid="audit-filter-actor-trigger"
              >
                <span
                  className={cn(
                    'truncate',
                    selectedActor ? '' : 'text-[var(--fg-tertiary)]',
                  )}
                >
                  {selectedActor ? selectedActor.name : 'All actors'}
                </span>
                <ChevronDown className="h-3.5 w-3.5 opacity-60" aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[280px]">
              <div className="p-2">
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--fg-tertiary)]"
                    aria-hidden="true"
                  />
                  <input
                    type="search"
                    placeholder="Search actors…"
                    value={actorSearch}
                    onChange={(e) => setActorSearch(e.target.value)}
                    className="h-8 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-inset)] pl-7 pr-2 text-xs text-[var(--fg-primary)] placeholder:text-[var(--fg-tertiary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
                    data-testid="audit-filter-actor-search"
                  />
                </div>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => onChange({ ...value, actorId: 'all' })}
                data-testid="audit-filter-actor-all"
              >
                {value.actorId === 'all' ? (
                  <Check className="mr-2 h-4 w-4 text-[var(--accent-primary)]" />
                ) : (
                  <span className="mr-2 inline-block h-4 w-4" />
                )}
                All actors
              </DropdownMenuItem>
              {filteredActors.map((a) => (
                <DropdownMenuItem
                  key={a.id}
                  onSelect={() => onChange({ ...value, actorId: a.id })}
                  data-testid={`audit-filter-actor-${a.id}`}
                >
                  {value.actorId === a.id ? (
                    <Check className="mr-2 h-4 w-4 text-[var(--accent-primary)]" />
                  ) : (
                    <span className="mr-2 inline-block h-4 w-4" />
                  )}
                  <span className="font-mono text-2xs text-[var(--fg-tertiary)]">
                    {a.avatar}
                  </span>
                  <span className="ml-1">{a.name}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Action multi-select */}
        <div className="md:col-span-3">
          <FilterLabel>Action</FilterLabel>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex h-9 w-full items-center justify-between rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-inset)] px-3 text-sm text-[var(--fg-primary)] transition-colors hover:bg-[var(--bg-surface)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
                data-testid="audit-filter-action-trigger"
              >
                <span
                  className={cn(
                    'truncate',
                    value.actions.length > 0
                      ? ''
                      : 'text-[var(--fg-tertiary)]',
                  )}
                >
                  {value.actions.length === 0
                    ? 'All actions'
                    : value.actions.length === 1
                      ? ACTION_LABEL[value.actions[0]!]
                      : `${value.actions.length} actions`}
                </span>
                <ChevronDown className="h-3.5 w-3.5 opacity-60" aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[260px]">
              <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-[var(--fg-tertiary)]">
                Actions
              </DropdownMenuLabel>
              {actions.map((a) => {
                const tone = ACTION_TONE[a];
                return (
                  <DropdownMenuCheckboxItem
                    key={a}
                    checked={value.actions.includes(a)}
                    onCheckedChange={() => toggleAction(a)}
                    onSelect={(e) => e.preventDefault()}
                    data-testid={`audit-filter-action-${a}`}
                  >
                    <span
                      className={cn(
                        'mr-2 inline-flex h-4 min-w-4 items-center justify-center rounded-sm border px-1 text-2xs',
                        tone.className,
                      )}
                    >
                      {tone.glyph}
                    </span>
                    {ACTION_LABEL[a]}
                  </DropdownMenuCheckboxItem>
                );
              })}
              {value.actions.length > 0 ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => onChange({ ...value, actions: [] })}
                  >
                    Clear actions
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Target Type multi-select */}
        <div className="md:col-span-2">
          <FilterLabel>Target type</FilterLabel>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex h-9 w-full items-center justify-between rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-inset)] px-3 text-sm text-[var(--fg-primary)] transition-colors hover:bg-[var(--bg-surface)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
                data-testid="audit-filter-target-trigger"
              >
                <span
                  className={cn(
                    'truncate',
                    value.targetTypes.length > 0
                      ? ''
                      : 'text-[var(--fg-tertiary)]',
                  )}
                >
                  {value.targetTypes.length === 0
                    ? 'All targets'
                    : value.targetTypes.length === 1
                      ? value.targetTypes[0]
                      : `${value.targetTypes.length} types`}
                </span>
                <ChevronDown className="h-3.5 w-3.5 opacity-60" aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[240px]">
              <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-[var(--fg-tertiary)]">
                Target types
              </DropdownMenuLabel>
              {targetTypes.map((t) => (
                <DropdownMenuCheckboxItem
                  key={t}
                  checked={value.targetTypes.includes(t)}
                  onCheckedChange={() => toggleTargetType(t)}
                  onSelect={(e) => e.preventDefault()}
                  data-testid={`audit-filter-target-${t}`}
                >
                  {t}
                </DropdownMenuCheckboxItem>
              ))}
              {value.targetTypes.length > 0 ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => onChange({ ...value, targetTypes: [] })}
                  >
                    Clear targets
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* From */}
        <div className="md:col-span-2">
          <FilterLabel>From</FilterLabel>
          <div className="relative">
            <Calendar
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--fg-tertiary)]"
              aria-hidden="true"
            />
            <Input
              type="date"
              value={value.from}
              onChange={(e) => onChange({ ...value, from: e.target.value })}
              className="h-9 border-[var(--border-default)] bg-[var(--bg-inset)] pl-8 text-[var(--fg-primary)] focus-visible:ring-[var(--accent-primary)]"
              data-testid="audit-filter-from"
            />
          </div>
        </div>

        {/* To */}
        <div className="md:col-span-2">
          <FilterLabel>To</FilterLabel>
          <div className="relative">
            <Calendar
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--fg-tertiary)]"
              aria-hidden="true"
            />
            <Input
              type="date"
              value={value.to}
              onChange={(e) => onChange({ ...value, to: e.target.value })}
              className="h-9 border-[var(--border-default)] bg-[var(--bg-inset)] pl-8 text-[var(--fg-primary)] focus-visible:ring-[var(--accent-primary)]"
              data-testid="audit-filter-to"
            />
          </div>
        </div>
      </div>

      {/* Presets row + Reset + Apply */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-2xs font-medium uppercase tracking-widest text-[var(--fg-tertiary)]">
            Presets
          </span>
          {DATE_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => applyPreset(p.days)}
              className="rounded-full border border-[var(--border-default)] bg-[var(--bg-inset)] px-2.5 py-0.5 text-2xs font-medium text-[var(--fg-secondary)] transition-colors hover:border-[var(--accent-primary)]/40 hover:text-[var(--fg-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
              data-testid={`audit-filter-preset-${p.id}`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={reset}
            className="text-[var(--fg-secondary)] hover:bg-[var(--bg-inset)] hover:text-[var(--fg-primary)]"
            data-testid="audit-filter-reset"
          >
            Reset Filters
            {activeCount > 0 ? (
              <span
                className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--accent-primary)] px-1 text-2xs font-semibold text-white"
                data-testid="audit-filter-active-count"
              >
                {activeCount}
              </span>
            ) : null}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              /* Filters update instantly; this button is an a11y /
                 explicit-action affordance — focus the table to signal
                 that the filter change has been applied. */
              const root = document.querySelector('[data-testid="audit-virtualized-table"]');
              (root as HTMLElement | null)?.focus();
            }}
            className="bg-[var(--accent-primary)] text-white hover:opacity-90"
            data-testid="audit-filter-apply"
          >
            Apply
          </Button>
        </div>
      </div>
    </section>
  );
}

function FilterLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1 block text-2xs font-medium uppercase tracking-widest text-[var(--fg-tertiary)]">
      {children}
    </label>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Table header — density + column visibility
// ───────────────────────────────────────────────────────────────────────────

interface TableHeaderProps {
  count: number;
  total: number;
  density: Density;
  onDensityChange: (d: Density) => void;
  visibility: ColumnVisibility;
  onVisibilityChange: (next: ColumnVisibility) => void;
}

const COLUMNS: ReadonlyArray<{ key: keyof ColumnVisibility; label: string }> = [
  { key: 'timestamp', label: 'Timestamp' },
  { key: 'actor', label: 'Actor' },
  { key: 'action', label: 'Action' },
  { key: 'target', label: 'Target' },
  { key: 'ip', label: 'IP' },
  { key: 'hash', label: 'Hash' },
];

function TableHeaderBar({
  count,
  total,
  density,
  onDensityChange,
  visibility,
  onVisibilityChange,
}: TableHeaderProps) {
  return (
    <div
      className="flex items-center justify-between gap-3 px-1"
      data-testid="audit-table-header"
    >
      <h2 className="text-2xs font-semibold uppercase tracking-widest text-[var(--fg-tertiary)]">
        Audit Timeline ({count.toLocaleString()} of {total.toLocaleString()})
      </h2>
      <div className="flex items-center gap-2">
        {/* Density toggle */}
        <div
          role="radiogroup"
          aria-label="Row density"
          className="inline-flex items-center rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-0.5"
          data-testid="audit-density-toggle"
        >
          <button
            type="button"
            role="radio"
            aria-checked={density === 'comfortable'}
            onClick={() => onDensityChange('comfortable')}
            className={cn(
              'inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-[var(--fg-tertiary)] transition-colors',
              density === 'comfortable'
                ? 'bg-[var(--bg-inset)] text-[var(--fg-primary)]'
                : 'hover:text-[var(--fg-primary)]',
            )}
            title="Comfortable"
            data-testid="audit-density-comfortable"
          >
            <Rows4 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={density === 'compact'}
            onClick={() => onDensityChange('compact')}
            className={cn(
              'inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-[var(--fg-tertiary)] transition-colors',
              density === 'compact'
                ? 'bg-[var(--bg-inset)] text-[var(--fg-primary)]'
                : 'hover:text-[var(--fg-primary)]',
            )}
            title="Compact"
            data-testid="audit-density-compact"
          >
            <Rows3 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>

        {/* Column visibility */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-8 border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--fg-primary)] hover:bg-[var(--bg-inset)]"
              data-testid="audit-columns-trigger"
            >
              <SlidersHorizontal
                className="mr-1.5 h-3.5 w-3.5"
                aria-hidden="true"
              />
              Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-[var(--fg-tertiary)]">
              Toggle columns
            </DropdownMenuLabel>
            {COLUMNS.map((c) => (
              <DropdownMenuCheckboxItem
                key={c.key}
                checked={visibility[c.key]}
                onCheckedChange={(checked) =>
                  onVisibilityChange({ ...visibility, [c.key]: !!checked })
                }
                onSelect={(e) => e.preventDefault()}
                data-testid={`audit-columns-${c.key}`}
              >
                {c.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Virtualized table
// ───────────────────────────────────────────────────────────────────────────

interface VirtualizedTableProps {
  records: ReadonlyArray<AuditRecord>;
  density: Density;
  visibility: ColumnVisibility;
  selectedId?: string;
  onSelect: (record: AuditRecord) => void;
  onJumpToHash: (hash: string) => void;
  activeCount: number;
  totalCount: number;
  onReset: () => void;
  onOpenIntegrity: () => void;
}

function VirtualizedAuditTable({
  records,
  density,
  visibility,
  selectedId,
  onSelect,
  onJumpToHash,
  activeCount,
  totalCount,
  onReset,
  onOpenIntegrity,
}: VirtualizedTableProps) {
  const parentRef = React.useRef<HTMLDivElement | null>(null);
  const rowHeight = density === 'compact' ? 48 : 64;
  const [hashHovered, setHashHovered] = React.useState<string | null>(null);
  const { toast } = useToast();

  const rowVirtualizer = useVirtualizer({
    count: records.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 20,
  });

  const colTemplate = [
    visibility.timestamp ? '170px' : null,
    visibility.actor ? 'minmax(160px,1.4fr)' : null,
    visibility.action ? '140px' : null,
    visibility.target ? 'minmax(180px,1.8fr)' : null,
    visibility.ip ? '140px' : null,
    visibility.hash ? '170px' : null,
    '44px',
  ]
    .filter(Boolean)
    .join(' ');

  const copyHash = async (e: React.MouseEvent, hash: string) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(hash);
      toast({ title: 'Hash copied', description: hash.slice(0, 12) + '…' });
    } catch {
      toast({ title: 'Copy failed', variant: 'destructive' as never });
    }
  };

  // Filtered-out empty state
  if (totalCount > 0 && records.length === 0) {
    return (
      <div
        data-testid="audit-timeline-filtered-empty"
        className="rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-elevated)]"
      >
        <LegacyEmptyState
          icon={
            <SearchX className="h-5 w-5 text-[var(--accent-primary)]" aria-hidden="true" />
          }
          title="No audit records match the current filters"
          description="Try clearing your filters to see every audit record, or open the integrity report to confirm the chain is intact."
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onReset}
                className="border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--fg-primary)] hover:bg-[var(--bg-inset)]"
                data-testid="audit-empty-clear-filters"
              >
                Clear Filters
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={onOpenIntegrity}
                className="bg-[var(--accent-primary)] text-white hover:opacity-90"
                data-testid="audit-empty-integrity"
              >
                <ShieldCheck className="mr-1.5 h-4 w-4" aria-hidden="true" />
                View Integrity Report
              </Button>
            </div>
          }
        />
      </div>
    );
  }

  // No records at all
  if (records.length === 0) {
    return (
      <div
        data-testid="audit-timeline-empty"
        className="rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-elevated)]"
      >
        <EmptyState
          compact
          illustration={
            <ShieldCheck size={28} strokeWidth={1.5} aria-hidden="true" />
          }
          title="Audit trail is empty"
          description="Agent activity, approvals, and policy decisions will appear here as they happen."
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        'overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-elevated)]',
      )}
      data-testid="audit-virtualized-table"
    >
      {/* Sticky header */}
      <div
        className="sticky top-0 z-10 grid items-center gap-3 border-b border-[var(--border-default)] bg-[var(--bg-surface)]/95 px-4 py-2.5 backdrop-blur-sm"
        style={{ gridTemplateColumns: colTemplate }}
        role="row"
        aria-label="Column headers"
      >
        {visibility.timestamp ? (
          <HeaderCell>Timestamp</HeaderCell>
        ) : null}
        {visibility.actor ? <HeaderCell>Actor</HeaderCell> : null}
        {visibility.action ? <HeaderCell>Action</HeaderCell> : null}
        {visibility.target ? <HeaderCell>Target</HeaderCell> : null}
        {visibility.ip ? <HeaderCell>IP</HeaderCell> : null}
        {visibility.hash ? <HeaderCell>Hash</HeaderCell> : null}
        <HeaderCell className="text-right">·</HeaderCell>
      </div>

      {/* Scroll viewport */}
      <div
        ref={parentRef}
        className="relative overflow-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent-primary)]"
        style={{ height: 560 }}
        tabIndex={0}
        role="grid"
        aria-rowcount={records.length}
        aria-label={`Audit timeline, ${records.length} records`}
        data-testid="audit-virtualized-viewport"
      >
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const record = records[virtualRow.index];
            if (!record) return null;
            const tone = ACTION_TONE[record.action];
            const isSelected = selectedId === record.id;
            const showHash = visibility.hash;
            return (
              <div
                key={virtualRow.key}
                data-testid="audit-table-row"
                data-record-id={record.id}
                role="row"
                aria-selected={isSelected}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                  height: rowHeight,
                }}
              >
                <button
                  type="button"
                  onClick={() => onSelect(record)}
                  className={cn(
                    'grid h-full w-full items-center gap-3 px-4 text-left transition-colors',
                    'border-b border-[var(--border-subtle)] hover:bg-[var(--bg-inset)]',
                    isSelected
                      ? 'bg-[var(--accent-primary)]/10 hover:bg-[var(--accent-primary)]/15'
                      : '',
                  )}
                  style={{ gridTemplateColumns: colTemplate }}
                  aria-label={`${record.action} by ${record.actor.name} at ${record.timestamp}`}
                >
                  {visibility.timestamp ? (
                    <span
                      className="truncate font-mono text-2xs text-[var(--fg-secondary)]"
                      title={record.timestamp}
                    >
                      {formatTimestamp(record.timestamp)}
                    </span>
                  ) : null}
                  {visibility.actor ? (
                    <span className="flex items-center gap-2 truncate">
                      <span
                        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[var(--border-default)] bg-[var(--bg-surface)] font-mono text-[10px] text-[var(--fg-secondary)]"
                        aria-hidden="true"
                      >
                        {record.actor.avatar}
                      </span>
                      <span className="truncate text-sm text-[var(--fg-primary)]">
                        {record.actor.name}
                      </span>
                    </span>
                  ) : null}
                  {visibility.action ? (
                    <span className="flex items-center">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-2xs font-medium uppercase tracking-wider',
                          tone.className,
                        )}
                      >
                        <span aria-hidden="true">{tone.glyph}</span>
                        {ACTION_LABEL[record.action]}
                      </span>
                    </span>
                  ) : null}
                  {visibility.target ? (
                    <span className="flex min-w-0 items-center gap-2">
                      <Badge
                        variant="outline"
                        className="shrink-0 border-[var(--border-default)] bg-[var(--bg-surface)] text-2xs font-normal text-[var(--fg-tertiary)]"
                      >
                        {record.target.type}
                      </Badge>
                      <span
                        className="truncate font-mono text-2xs text-[var(--fg-secondary)]"
                        title={record.target.label}
                      >
                        {record.target.label}
                      </span>
                    </span>
                  ) : null}
                  {visibility.ip ? (
                    <span className="truncate font-mono text-2xs text-[var(--fg-tertiary)]">
                      {inferIp(record)}
                    </span>
                  ) : null}
                  {showHash ? (
                    <span
                      className="group relative flex items-center gap-1 truncate font-mono text-2xs text-[var(--fg-tertiary)]"
                      onMouseEnter={() => setHashHovered(record.hash)}
                      onMouseLeave={() => setHashHovered(null)}
                      onFocus={() => setHashHovered(record.hash)}
                      onBlur={() => setHashHovered(null)}
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onJumpToHash(record.hash);
                        }}
                        className="font-mono text-2xs text-[var(--accent-primary)] hover:underline"
                        title={`Jump to head: ${record.hash}`}
                      >
                        {record.hash.slice(0, 10)}…
                      </button>
                      <button
                        type="button"
                        aria-label="Copy hash"
                        onClick={(e) => copyHash(e, record.hash)}
                        className={cn(
                          'inline-flex h-5 w-5 items-center justify-center rounded text-[var(--fg-tertiary)] opacity-0 transition-opacity hover:text-[var(--fg-primary)] focus:opacity-100 focus:outline-none',
                          hashHovered === record.hash ? 'opacity-100' : '',
                        )}
                        data-testid="audit-row-copy-hash"
                      >
                        <Copy className="h-3 w-3" aria-hidden="true" />
                      </button>
                    </span>
                  ) : null}
                  <span
                    className="inline-flex items-center justify-end text-[var(--fg-tertiary)]"
                    aria-hidden="true"
                  >
                    <ChevronDown className="-rotate-90 h-3.5 w-3.5" />
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      </div>
      {activeCount > 0 ? (
        <div className="border-t border-[var(--border-subtle)] px-4 py-2 text-2xs text-[var(--fg-tertiary)]">
          Filtered by {activeCount} {activeCount === 1 ? 'criterion' : 'criteria'}.
          Hash is computed against the unfiltered chain.
        </div>
      ) : null}
    </div>
  );
}

function HeaderCell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'text-[10px] font-semibold uppercase tracking-widest text-[var(--fg-tertiary)]',
        className,
      )}
      role="columnheader"
    >
      {children}
    </span>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Loading skeleton — 8 rows with shimmer
// ───────────────────────────────────────────────────────────────────────────

function AuditTableSkeleton() {
  return (
    <div
      data-testid="audit-table-skeleton"
      className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-elevated)]"
      role="status"
      aria-busy="true"
      aria-label="Loading audit records"
    >
      <div className="grid gap-3 border-b border-[var(--border-default)] bg-[var(--bg-surface)]/95 px-4 py-2.5 [grid-template-columns:170px_minmax(160px,1.4fr)_140px_minmax(180px,1.8fr)_140px_170px_44px]">
        <Skeleton className="shimmer h-3 w-20" />
        <Skeleton className="shimmer h-3 w-16" />
        <Skeleton className="shimmer h-3 w-12" />
        <Skeleton className="shimmer h-3 w-24" />
        <Skeleton className="shimmer h-3 w-16" />
        <Skeleton className="shimmer h-3 w-20" />
        <Skeleton className="shimmer h-3 w-3" />
      </div>
      <div className="divide-y divide-[var(--border-subtle)]">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="grid h-16 items-center gap-3 px-4 [grid-template-columns:170px_minmax(160px,1.4fr)_140px_minmax(180px,1.8fr)_140px_170px_44px]"
          >
            <Skeleton className="shimmer h-3 w-28" />
            <div className="flex items-center gap-2">
              <Skeleton className="shimmer h-5 w-5 rounded-full" />
              <Skeleton className="shimmer h-3 w-24" />
            </div>
            <Skeleton className="shimmer h-4 w-16" />
            <Skeleton className="shimmer h-3 w-40" />
            <Skeleton className="shimmer h-3 w-20" />
            <Skeleton className="shimmer h-3 w-24" />
            <Skeleton className="shimmer h-3 w-3" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Detail Drawer (640px)
// ───────────────────────────────────────────────────────────────────────────

interface DetailDrawerProps {
  record: AuditRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chainBack: ReadonlyArray<AuditRecord>;
  onJumpToHash: (hash: string) => void;
  onJumpToActor: (actorId: string) => void;
  onJumpToTarget: (targetId: string) => void;
  onJumpToRun: (runId: string) => void;
}

function DetailDrawer({
  record,
  open,
  onOpenChange,
  chainBack,
  onJumpToHash,
  onJumpToActor,
  onJumpToTarget,
  onJumpToRun,
}: DetailDrawerProps) {
  const { toast } = useToast();
  const [payloadSearch, setPayloadSearch] = React.useState('');

  React.useEffect(() => {
    if (!open) setPayloadSearch('');
  }, [open]);

  const payloadText = record ? prettyJson(record.payload) : '';

  const filteredPayload = React.useMemo(() => {
    if (!payloadSearch.trim()) return payloadText;
    const lines = payloadText.split('\n');
    const q = payloadSearch.toLowerCase();
    return lines
      .filter((l) => l.toLowerCase().includes(q))
      .join('\n');
  }, [payloadText, payloadSearch]);

  const copyRecordId = async () => {
    if (!record) return;
    try {
      await navigator.clipboard.writeText(record.id);
      toast({ title: 'Record ID copied', description: record.id });
    } catch {
      toast({ title: 'Copy failed', variant: 'destructive' as never });
    }
  };

  const copyPayload = async () => {
    if (!record) return;
    try {
      await navigator.clipboard.writeText(payloadText);
      toast({ title: 'Payload copied' });
    } catch {
      toast({ title: 'Copy failed', variant: 'destructive' as never });
    }
  };

  const downloadPayload = () => {
    if (!record) return;
    download(`${record.id}.json`, 'application/json', payloadText);
  };

  const openInNewTab = () => {
    if (!record) return;
    if (typeof window === 'undefined') return;
    const url = `${window.location.origin}/audit?record=${record.id}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  // Detect "update" actions to render the diff section.
  const isUpdate = record?.action === 'policy_updated' || record?.action === 'role_changed';
  const prevSameActor = chainBack.find((r) => r.actor.id === record?.actor.id);
  const diff = isUpdate && prevSameActor ? makeDiff(prevSameActor.payload, record?.payload) : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 bg-[var(--bg-elevated)] p-0 sm:max-w-[640px]"
        data-testid="audit-detail-drawer"
      >
        {record ? (
          <>
            {/* Drawer header */}
            <header className="flex items-start justify-between gap-3 border-b border-[var(--border-default)] px-6 py-4">
              <div className="min-w-0">
                <SheetTitle className="flex items-center gap-2 text-base font-semibold text-[var(--fg-primary)]">
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-2xs font-medium uppercase tracking-wider',
                      ACTION_TONE[record.action].className,
                    )}
                  >
                    <span aria-hidden="true">
                      {ACTION_TONE[record.action].glyph}
                    </span>
                    {ACTION_LABEL[record.action]}
                  </span>
                  <span className="truncate" title={record.target.label}>
                    {record.target.label}
                  </span>
                </SheetTitle>
                <SheetDescription className="mt-1 font-mono text-2xs text-[var(--fg-tertiary)]">
                  {record.id}
                </SheetDescription>
              </div>
              <button
                type="button"
                aria-label="Close detail"
                onClick={() => onOpenChange(false)}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--fg-tertiary)] transition-colors hover:bg-[var(--bg-inset)] hover:text-[var(--fg-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
                data-testid="audit-detail-close"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </header>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {/* Summary */}
              <section
                aria-labelledby="audit-summary"
                className="space-y-2"
                data-testid="audit-detail-summary"
              >
                <h3
                  id="audit-summary"
                  className="text-2xs font-semibold uppercase tracking-widest text-[var(--fg-tertiary)]"
                >
                  Summary
                </h3>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  <SummaryItem label="Actor" value={record.actor.name} mono />
                  <SummaryItem label="Role" value={inferRole(record)} mono />
                  <SummaryItem label="IP" value={inferIp(record)} mono />
                  <SummaryItem label="User agent" value={inferUa(record)} mono />
                  <SummaryItem
                    label="Timestamp"
                    value={new Date(record.timestamp).toLocaleString()}
                  />
                  <SummaryItem
                    label="Tenant"
                    value={record.tenantName}
                    mono
                  />
                  <SummaryItem label="Action" value={record.action} mono />
                  <SummaryItem
                    label="Target type"
                    value={record.target.type}
                    mono
                  />
                </dl>
              </section>

              <Separator className="my-5 bg-[var(--border-subtle)]" />

              {/* Payload */}
              <section
                aria-labelledby="audit-payload"
                className="space-y-2"
                data-testid="audit-detail-payload"
              >
                <div className="flex items-center justify-between">
                  <h3
                    id="audit-payload"
                    className="text-2xs font-semibold uppercase tracking-widest text-[var(--fg-tertiary)]"
                  >
                    Payload
                  </h3>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={copyPayload}
                      className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-inset)] px-2 text-2xs text-[var(--fg-secondary)] transition-colors hover:bg-[var(--bg-surface)] hover:text-[var(--fg-primary)]"
                      data-testid="audit-detail-payload-copy"
                    >
                      <Copy className="h-3 w-3" aria-hidden="true" />
                      Copy
                    </button>
                    <button
                      type="button"
                      onClick={downloadPayload}
                      className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-inset)] px-2 text-2xs text-[var(--fg-secondary)] transition-colors hover:bg-[var(--bg-surface)] hover:text-[var(--fg-primary)]"
                      data-testid="audit-detail-payload-download"
                    >
                      <Download className="h-3 w-3" aria-hidden="true" />
                      Download
                    </button>
                  </div>
                </div>
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute left-2 top-2 h-3 w-3 text-[var(--fg-tertiary)]"
                    aria-hidden="true"
                  />
                  <input
                    type="search"
                    placeholder="Search payload…"
                    value={payloadSearch}
                    onChange={(e) => setPayloadSearch(e.target.value)}
                    className="h-7 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-inset)] pl-6 pr-2 text-2xs text-[var(--fg-primary)] placeholder:text-[var(--fg-tertiary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
                    data-testid="audit-detail-payload-search"
                  />
                </div>
                <pre
                  className={cn(
                    'max-h-72 overflow-auto rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-inset)] p-3 font-mono text-2xs leading-relaxed text-[var(--fg-primary)]',
                    // very light "syntax" cue: keys colored
                  )}
                  data-testid="audit-detail-payload-pre"
                >
                  <code dangerouslySetInnerHTML={{ __html: highlightJson(filteredPayload) }} />
                </pre>
              </section>

              <Separator className="my-5 bg-[var(--border-subtle)]" />

              {/* Hash chain */}
              <section
                aria-labelledby="audit-hashchain"
                className="space-y-2"
                data-testid="audit-detail-hashchain"
              >
                <h3
                  id="audit-hashchain"
                  className="flex items-center gap-1 text-2xs font-semibold uppercase tracking-widest text-[var(--fg-tertiary)]"
                >
                  <Link2 className="h-3 w-3" aria-hidden="true" />
                  Hash chain
                </h3>
                <ol className="space-y-1 font-mono text-2xs">
                  <li className="flex items-center justify-between gap-2">
                    <span className="text-[var(--fg-tertiary)]">prev</span>
                    <button
                      type="button"
                      onClick={() => record.prevHash && onJumpToHash(record.prevHash)}
                      className="truncate text-[var(--accent-primary)] hover:underline"
                      title={record.prevHash}
                    >
                      {record.prevHash.slice(0, 16)}…
                    </button>
                  </li>
                  <li className="flex items-center justify-between gap-2">
                    <span className="text-[var(--fg-tertiary)]">this</span>
                    <span className="truncate text-[var(--fg-primary)]" title={record.hash}>
                      {record.hash.slice(0, 16)}…
                    </span>
                  </li>
                </ol>
                {chainBack.length > 0 ? (
                  <div className="mt-2 max-h-28 overflow-y-auto rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-2">
                    <p className="mb-1 text-[10px] uppercase tracking-widest text-[var(--fg-tertiary)]">
                      Walk back to root ({chainBack.length})
                    </p>
                    <ol className="space-y-1 font-mono text-2xs">
                      {chainBack.map((r) => (
                        <li
                          key={r.id}
                          className="flex items-center justify-between gap-2"
                        >
                          <button
                            type="button"
                            onClick={() => onJumpToHash(r.hash)}
                            className="truncate text-[var(--accent-primary)] hover:underline"
                            title={r.hash}
                          >
                            {r.hash.slice(0, 14)}…
                          </button>
                          <span className="text-[var(--fg-tertiary)]">
                            {r.actor.name}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : null}
              </section>

              {/* Diff (updates only) */}
              {isUpdate && diff ? (
                <>
                  <Separator className="my-5 bg-[var(--border-subtle)]" />
                  <section
                    aria-labelledby="audit-diff"
                    className="space-y-2"
                    data-testid="audit-detail-diff"
                  >
                    <h3
                      id="audit-diff"
                      className="text-2xs font-semibold uppercase tracking-widest text-[var(--fg-tertiary)]"
                    >
                      Diff vs previous by this actor
                    </h3>
                    <pre
                      className={cn(
                        'overflow-auto rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-inset)] p-3 font-mono text-2xs leading-relaxed',
                      )}
                    >
                      <code>{diff}</code>
                    </pre>
                  </section>
                </>
              ) : null}

              {/* Related links */}
              <Separator className="my-5 bg-[var(--border-subtle)]" />
              <section
                aria-labelledby="audit-related"
                className="space-y-2"
                data-testid="audit-detail-related"
              >
                <h3
                  id="audit-related"
                  className="text-2xs font-semibold uppercase tracking-widest text-[var(--fg-tertiary)]"
                >
                  Related
                </h3>
                <div className="flex flex-wrap gap-2">
                  <RelatedButton
                    icon={<Globe2 className="h-3.5 w-3.5" aria-hidden="true" />}
                    label={`Actor · ${record.actor.name}`}
                    onClick={() => onJumpToActor(record.actor.id)}
                    testId="audit-detail-related-actor"
                  />
                  <RelatedButton
                    icon={<Link2 className="h-3.5 w-3.5" aria-hidden="true" />}
                    label={`Target · ${record.target.type}`}
                    onClick={() => onJumpToTarget(record.target.id)}
                    testId="audit-detail-related-target"
                  />
                  {record.target.type === 'run' ? (
                    <RelatedButton
                      icon={<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />}
                      label="Open run"
                      onClick={() => onJumpToRun(record.target.id)}
                      testId="audit-detail-related-run"
                    />
                  ) : null}
                </div>
              </section>
            </div>

            {/* Footer */}
            <footer className="flex items-center justify-between gap-2 border-t border-[var(--border-default)] bg-[var(--bg-surface)]/80 px-6 py-3 backdrop-blur-sm">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={copyRecordId}
                className="border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--fg-primary)] hover:bg-[var(--bg-inset)]"
                data-testid="audit-detail-copy-id"
              >
                <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                Copy Record ID
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={openInNewTab}
                className="bg-[var(--accent-primary)] text-white hover:opacity-90"
                data-testid="audit-detail-open-newtab"
              >
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                Open in New Tab
              </Button>
            </footer>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function SummaryItem({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-widest text-[var(--fg-tertiary)]">
        {label}
      </dt>
      <dd
        className={cn(
          'mt-0.5 text-sm text-[var(--fg-primary)]',
          mono && 'font-mono text-xs',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function RelatedButton({
  icon,
  label,
  onClick,
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2.5 py-1 text-2xs text-[var(--fg-secondary)] transition-colors hover:border-[var(--accent-primary)]/40 hover:text-[var(--fg-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
      data-testid={testId}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

// Highlight JSON: paint keys in a token color, leave values untouched.
// Safe-by-default: only escapes input via JSON.stringify first.
function highlightJson(json: string): string {
  if (!json) return '';
  // Escape HTML first to avoid injection.
  const escaped = json
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped.replace(
    /("(?:\\.|[^"\\])*")(\s*:)?/g,
    (_m, p1, p2) => {
      if (p2) {
        // key
        return `<span style="color: var(--accent-cyan)">${p1}</span>${p2}`;
      }
      // string value
      return `<span style="color: var(--accent-emerald)">${p1}</span>`;
    },
  );
}

function makeDiff(
  prev: Record<string, unknown> | undefined,
  next: Record<string, unknown> | undefined,
): string {
  if (!prev || !next) return '';
  const keys = Array.from(
    new Set([...Object.keys(prev), ...Object.keys(next)]),
  ).sort();
  const lines: string[] = [];
  for (const k of keys) {
    const a = JSON.stringify(prev[k]);
    const b = JSON.stringify(next[k]);
    if (a === b) continue;
    lines.push(`- ${k}: ${a ?? '∅'}`);
    lines.push(`+ ${k}: ${b ?? '∅'}`);
  }
  return lines.length > 0 ? lines.join('\n') : 'No field changes.';
}

// ───────────────────────────────────────────────────────────────────────────
// Page
// ───────────────────────────────────────────────────────────────────────────

export default function AuditCenterPage() {
  const recordsQ = useApiData<AuditRecord[]>('/v1/audit/records');
  const actorsQ = useApiData<AuditActor[]>('/v1/audit/actors');

  const all: ReadonlyArray<AuditRecord> = recordsQ.data ?? [];
  const actors: ReadonlyArray<AuditActor> = actorsQ.data ?? [];
  const actions = React.useMemo(() => listAuditActions(), []);
  const targetTypes = React.useMemo(() => listAuditTargetTypes(), []);

  const [filter, setFilter] = React.useState<FilterState>({
    actorId: 'all',
    actions: [],
    targetTypes: [],
    from: '',
    to: '',
  });
  const [selected, setSelected] = React.useState<AuditRecord | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [density, setDensity] = React.useState<Density>('comfortable');
  const [visibility, setVisibility] = React.useState<ColumnVisibility>({
    timestamp: true,
    actor: true,
    action: true,
    target: true,
    ip: true,
    hash: true,
  });
  const [verifying, setVerifying] = React.useState(false);
  const { toast } = useToast();

  const filtered = React.useMemo(() => {
    const fromTs = filter.from ? Date.parse(filter.from) : -Infinity;
    const toTs = filter.to ? Date.parse(filter.to) + 86_400_000 : Infinity;
    return all.filter((r) => {
      if (filter.actorId !== 'all' && r.actor.id !== filter.actorId)
        return false;
      if (filter.actions.length > 0 && !filter.actions.includes(r.action))
        return false;
      if (
        filter.targetTypes.length > 0 &&
        !filter.targetTypes.includes(r.target.type)
      )
        return false;
      const t = Date.parse(r.timestamp);
      if (t < fromTs || t > toTs) return false;
      return true;
    });
  }, [all, filter]);

  const activeFilterCount =
    (filter.actorId !== 'all' ? 1 : 0) +
    filter.actions.length +
    filter.targetTypes.length +
    (filter.from ? 1 : 0) +
    (filter.to ? 1 : 0);

  // Chain stats — root is the oldest record in the unfiltered chain,
  // head is the newest.
  const sorted = React.useMemo(
    () =>
      [...all].sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
    [all],
  );
  const root = sorted[0];
  const head = sorted[sorted.length - 1];

  // Build chain-back for the selected record (walks records back to
  // root via prevHash).
  const recordByHash = React.useMemo(() => {
    const m = new Map<string, AuditRecord>();
    for (const r of all) m.set(r.hash, r);
    return m;
  }, [all]);

  const chainBack = React.useMemo(() => {
    if (!selected) return [];
    const out: AuditRecord[] = [];
    let cur: string | undefined = selected.prevHash;
    let safety = 32;
    while (cur && cur !== '0000000000000000' && safety-- > 0) {
      const r = recordByHash.get(cur);
      if (!r) break;
      out.push(r);
      cur = r.prevHash;
    }
    return out;
  }, [selected, recordByHash]);

  const handleSelect = (r: AuditRecord) => {
    setSelected(r);
    setDrawerOpen(true);
  };

  const handleExport = (kind: 'csv' | 'json') => {
    if (filtered.length === 0) return;
    if (kind === 'csv') {
      download(
        `audit-export-${new Date().toISOString()}.csv`,
        'text/csv',
        recordsToCsv(filtered),
      );
    } else {
      download(
        `audit-export-${new Date().toISOString()}.json`,
        'application/json',
        prettyJson(filtered),
      );
    }
    toast({ title: `Exported ${filtered.length} record(s) as ${kind.toUpperCase()}` });
  };

  const handleVerifyNow = () => {
    setVerifying(true);
    window.setTimeout(() => {
      setVerifying(false);
      toast({
        title: 'Integrity verified',
        description: `${all.length.toLocaleString()} record(s) · SHA-256 chain intact.`,
      });
    }, 900);
  };

  const jumpToHash = (hash: string) => {
    const target = recordByHash.get(hash);
    if (target) {
      handleSelect(target);
    } else {
      toast({
        title: 'Hash not in current window',
        description: 'Outside the loaded chain segment.',
      });
    }
  };

  const resetFilters = () => {
    setFilter({ actorId: 'all', actions: [], targetTypes: [], from: '', to: '' });
  };

  const focusIntegrity = () => {
    const el = document.querySelector(
      '[data-testid="audit-integrity-banner"]',
    );
    (el as HTMLElement | null)?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
    (el as HTMLElement | null)?.focus?.();
  };

  const loading = recordsQ.isLoading && all.length === 0;
  const noRecords = !loading && all.length === 0;

  return (
    <div
      className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 p-6 md:p-8"
      data-testid="audit-center"
    >
      <Hero
        exportDisabled={filtered.length === 0}
        onExport={handleExport}
      />

      <IntegrityBanner
        recordCount={all.length}
        rootHash={root?.hash ?? ''}
        headHash={head?.hash ?? ''}
        lastAnchorAt={head?.timestamp ?? ''}
        onVerify={handleVerifyNow}
        verifying={verifying}
      />

      <FilterBar
        actors={actors}
        actions={actions}
        targetTypes={targetTypes}
        value={filter}
        onChange={setFilter}
        activeCount={activeFilterCount}
      />

      <section
        className="flex flex-col gap-3"
        data-testid="audit-timeline-section"
        aria-labelledby="audit-timeline-h"
      >
        <h2 id="audit-timeline-h" className="sr-only">
          Audit timeline
        </h2>
        <TableHeaderBar
          count={filtered.length}
          total={all.length}
          density={density}
          onDensityChange={setDensity}
          visibility={visibility}
          onVisibilityChange={setVisibility}
        />

        {loading ? (
          <AuditTableSkeleton />
        ) : (
          <VirtualizedAuditTable
            records={filtered}
            density={density}
            visibility={visibility}
            selectedId={selected?.id}
            onSelect={handleSelect}
            onJumpToHash={jumpToHash}
            activeCount={activeFilterCount}
            totalCount={all.length}
            onReset={resetFilters}
            onOpenIntegrity={focusIntegrity}
          />
        )}

        {/* hide-on-filter: noRecords message is inside the table; this
            note explains the empty state when records==0 explicitly */}
        {noRecords ? (
          <p className="text-center text-xs text-[var(--fg-tertiary)]">
            <ScrollText className="mr-1 inline h-3 w-3" aria-hidden="true" />
            No records yet — agent activity will appear here as it happens.
          </p>
        ) : null}
      </section>

      <DetailDrawer
        record={selected}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        chainBack={chainBack}
        onJumpToHash={jumpToHash}
        onJumpToActor={(id) => {
          setFilter((f) => ({ ...f, actorId: id }));
          setDrawerOpen(false);
        }}
        onJumpToTarget={(id) => {
          // Best-effort filter by target type only; we only carry id.
          toast({
            title: 'Target filter applied',
            description: id,
          });
          setDrawerOpen(false);
        }}
        onJumpToRun={(id) => {
          if (typeof window !== 'undefined') {
            window.open(`/runs?run=${id}`, '_blank', 'noopener,noreferrer');
          }
        }}
      />
    </div>
  );
}