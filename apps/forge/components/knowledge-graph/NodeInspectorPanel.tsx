'use client';

import * as React from 'react';
import {
  ArrowLeft,
  MoreHorizontal,
  ExternalLink,
  Copy,
  Pin,
  EyeOff,
  ChevronRight,
  UserPlus,
  Sparkles,
  Activity as ActivityIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { EDGE_COLOR, EDGE_LABEL, KIND_COLOR, KIND_ICON } from './graph-palette';
import type {
  EdgeKind,
  SampleEdge,
  SampleNode,
} from '@/src/data/sample-graph';

export interface NodeInspectorPanelProps {
  node: SampleNode | null;
  edges: ReadonlyArray<SampleEdge>;
  allNodes: ReadonlyArray<SampleNode>;
  onClose: () => void;
  onNavigate: (node: SampleNode) => void;
  onFindSimilar: (node: SampleNode) => void;
  onAddRelationship: (node: SampleNode) => void;
  onCopyLink: (node: SampleNode) => void;
  onHide: (node: SampleNode) => void;
  onPin: (node: SampleNode) => void;
}

interface ConnectionGroup {
  kind: EdgeKind;
  rows: Array<{ edge: SampleEdge; other: SampleNode | null; direction: 'out' | 'in' }>;
}

/**
 * Zone 4 — right-side drawer showing the selected node with its full
 * Obsidian-style backlink list. The structure:
 *
 *   HEADER  ←  back arrow + kind + title + 3-dot menu
 *   META    ←  author / dates / tags / status
 *   PREVIEW ←  first 200 chars + "Read full →"
 *   CONNS   ←  outgoing ("References") + incoming ("Referenced by")
 *   ACTIONS ←  Open / Find similar / Add relationship
 */
export function NodeInspectorPanel({
  node,
  edges,
  allNodes,
  onClose,
  onNavigate,
  onFindSimilar,
  onAddRelationship,
  onCopyLink,
  onHide,
  onPin,
}: NodeInspectorPanelProps) {
  const nodeIndex = React.useMemo(() => {
    const m = new Map<string, SampleNode>();
    allNodes.forEach((n) => m.set(n.id, n));
    return m;
  }, [allNodes]);

  // ---- Connections grouped by edge kind, outgoing + incoming --------------

  const groups = React.useMemo<ConnectionGroup[]>(() => {
    if (!node) return [];
    const buckets = new Map<EdgeKind, ConnectionGroup>();
    const ensure = (k: EdgeKind): ConnectionGroup => {
      let g = buckets.get(k);
      if (!g) {
        g = { kind: k, rows: [] };
        buckets.set(k, g);
      }
      return g;
    };
    for (const e of edges) {
      if (e.source === node.id) {
        const g = ensure(e.kind);
        g.rows.push({ edge: e, other: nodeIndex.get(e.target) ?? null, direction: 'out' });
      } else if (e.target === node.id) {
        const g = ensure(e.kind);
        g.rows.push({ edge: e, other: nodeIndex.get(e.source) ?? null, direction: 'in' });
      }
    }
    return Array.from(buckets.values());
  }, [node, edges, nodeIndex]);

  const outTotal = React.useMemo(
    () => groups.reduce((acc, g) => acc + g.rows.filter((r) => r.direction === 'out').length, 0),
    [groups],
  );
  const inTotal = React.useMemo(
    () => groups.reduce((acc, g) => acc + g.rows.filter((r) => r.direction === 'in').length, 0),
    [groups],
  );

  if (!node) return null;

  const kindColor = KIND_COLOR[node.kind];

  return (
    <aside
      role="dialog"
      aria-label={`Inspector — ${node.label}`}
      data-testid="node-inspector-panel"
      className={cn(
        'flex h-full w-full flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)]',
        'lg:w-[440px] xl:w-[480px]',
      )}
    >
      {/* HEADER */}
      <header className="flex items-start gap-2 border-b border-[var(--border-subtle)] p-4">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close inspector"
          className="mt-1 inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-[var(--fg-tertiary)] transition-colors hover:bg-[var(--bg-surface)] hover:text-[var(--fg-primary)]"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-flex h-6 w-6 items-center justify-center rounded text-sm"
              style={{ background: `${kindColor}1a`, color: kindColor }}
            >
              {KIND_ICON[node.kind]}
            </span>
            <span
              className="font-mono text-[10px] uppercase tracking-widest"
              style={{ color: kindColor }}
            >
              {node.kind}
            </span>
          </div>
          <h2 className="mt-1 text-base font-semibold text-[var(--fg-primary)]">
            {node.label}
          </h2>
        </div>
        <details className="relative">
          <summary
            aria-label="More actions"
            className="inline-flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded-[var(--radius-sm)] text-[var(--fg-tertiary)] transition-colors hover:bg-[var(--bg-surface)] hover:text-[var(--fg-primary)]"
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
          </summary>
          <div className="absolute right-0 top-8 z-10 flex w-44 flex-col rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-1 shadow-lg">
            <MenuItem
              icon={<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />}
              label="Open full page"
              onClick={() => onNavigate(node)}
            />
            <MenuItem
              icon={<Copy className="h-3.5 w-3.5" aria-hidden="true" />}
              label="Copy link"
              onClick={() => onCopyLink(node)}
            />
            <MenuItem
              icon={<EyeOff className="h-3.5 w-3.5" aria-hidden="true" />}
              label="Hide from graph"
              onClick={() => onHide(node)}
            />
            <MenuItem
              icon={<Pin className="h-3.5 w-3.5" aria-hidden="true" />}
              label="Pin position"
              onClick={() => onPin(node)}
            />
          </div>
        </details>
      </header>

      {/* BODY */}
      <div className="thin-scrollbar flex-1 space-y-4 overflow-y-auto p-4">
        {/* META CARD */}
        <section className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 text-sm">
          <div className="flex items-center gap-2">
            <div
              aria-hidden="true"
              className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-semibold text-white"
              style={{ background: kindColor }}
            >
              {node.author.initials}
            </div>
            <div>
              <div className="font-medium text-[var(--fg-primary)]">{node.author.name}</div>
              <div className="text-[11px] text-[var(--fg-tertiary)]">{node.author.role}</div>
            </div>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
            <div>
              <dt className="text-[var(--fg-tertiary)]">Created</dt>
              <dd className="font-mono text-[var(--fg-secondary)]">
                {new Date(node.updatedAt).toLocaleDateString()}
              </dd>
            </div>
            {node.status && (
              <div>
                <dt className="text-[var(--fg-tertiary)]">Status</dt>
                <dd className="font-mono text-[var(--fg-secondary)]">{node.status}</dd>
              </div>
            )}
          </dl>
          {node.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1">
              {node.tags.map((t) => (
                <span
                  key={t}
                  className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-0.5 text-[10px] text-[var(--fg-secondary)]"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
        </section>

        {/* PREVIEW CARD */}
        <section className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
          <p className="line-clamp-4 text-xs leading-relaxed text-[var(--fg-secondary)]">
            {node.preview}
          </p>
          <button
            type="button"
            onClick={() => onNavigate(node)}
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-[var(--accent-primary)] hover:underline"
          >
            Read full →
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </button>
        </section>

        {/* CONNECTIONS CARD — Obsidian backlinks */}
        <section
          className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3"
          data-testid="node-connections"
        >
          <header className="mb-2 flex items-baseline justify-between">
            <h3 className="text-sm font-semibold text-[var(--fg-primary)]">Connections</h3>
            <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">
              {outTotal} out · {inTotal} in
            </span>
          </header>

          {/* Outgoing — "References" */}
          <div className="mb-3">
            <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-[var(--fg-tertiary)]">
              References ({outTotal})
            </h4>
            <ConnectionList groups={groups.filter((g) => g.rows.some((r) => r.direction === 'out'))} direction="out" onNavigate={onNavigate} />
          </div>

          {/* Incoming — "Referenced by" (backlinks) */}
          <div>
            <h4 className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-[var(--fg-tertiary)]">
              Referenced by ({inTotal})
              <span aria-hidden="true" className="font-normal normal-case opacity-60">— backlinks</span>
            </h4>
            <ConnectionList groups={groups.filter((g) => g.rows.some((r) => r.direction === 'in'))} direction="in" onNavigate={onNavigate} />
          </div>
        </section>

        {/* ACTIVITY CARD — synthetic for the demo */}
        <section className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-[var(--fg-primary)]">
            <ActivityIcon className="h-3.5 w-3.5 text-[var(--accent-cyan)]" aria-hidden="true" />
            Recent activity
          </h3>
          <ul className="space-y-1.5 text-[11px] text-[var(--fg-secondary)]">
            <li className="flex items-start gap-2">
              <span className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent-emerald)]" aria-hidden="true" />
              <span>
                <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">
                  {new Date(node.updatedAt).toLocaleDateString()}
                </span>{' '}
                — {node.author.name.split(' ')[0]} updated {node.kind.toLowerCase()}
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent-cyan)]" aria-hidden="true" />
              <span>
                <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">3 days ago</span>{' '}
                — 2 new edges linked this node
              </span>
            </li>
          </ul>
        </section>

        {/* ACTIONS CARD */}
        <section className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => onNavigate(node)}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--accent-primary)] text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            Open full page
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onFindSimilar(node)}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-sm text-[var(--fg-secondary)] transition-colors hover:bg-[var(--bg-surface)] hover:text-[var(--fg-primary)]"
            >
              <Sparkles className="h-3.5 w-3.5 text-[var(--accent-violet)]" aria-hidden="true" />
              Find similar
            </button>
            <button
              type="button"
              onClick={() => onAddRelationship(node)}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-sm text-[var(--fg-secondary)] transition-colors hover:bg-[var(--bg-surface)] hover:text-[var(--fg-primary)]"
            >
              <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
              Add relationship
            </button>
          </div>
        </section>
      </div>
    </aside>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-xs text-[var(--fg-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--fg-primary)]"
    >
      <span className="text-[var(--fg-tertiary)]">{icon}</span>
      {label}
    </button>
  );
}

function ConnectionList({
  groups,
  direction,
  onNavigate,
}: {
  groups: ReadonlyArray<ConnectionGroup>;
  direction: 'in' | 'out';
  onNavigate: (node: SampleNode) => void;
}) {
  if (groups.length === 0) {
    return (
      <p className="text-[11px] text-[var(--fg-tertiary)]">No {direction === 'in' ? 'incoming' : 'outgoing'} edges.</p>
    );
  }
  return (
    <ul className="flex flex-col gap-1">
      {groups.flatMap((g) =>
        g.rows
          .filter((r) => r.direction === direction)
          .map((r) => {
            const other = r.other;
            const edgeColor = EDGE_COLOR[g.kind];
            return (
              <li key={r.edge.id}>
                <button
                  type="button"
                  onClick={() => other && onNavigate(other)}
                  disabled={!other}
                  data-testid="connection-row"
                  className={cn(
                    'flex w-full items-center gap-2 rounded-[var(--radius-sm)] border border-transparent px-2 py-1 text-left text-xs',
                    'hover:border-[var(--border-subtle)] hover:bg-[var(--bg-elevated)]',
                    !other && 'cursor-not-allowed opacity-50',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: edgeColor }}
                  />
                  <span className="flex-1 truncate text-[var(--fg-primary)]">
                    {other?.label ?? r.edge.source === r.edge.target ? '(self)' : 'unknown'}
                  </span>
                  <span
                    className="rounded-full border px-1.5 py-0 font-mono text-[9px] uppercase tracking-wider"
                    style={{ color: edgeColor, borderColor: `${edgeColor}55` }}
                  >
                    {EDGE_LABEL[g.kind]}
                  </span>
                  <ChevronRight className="h-3 w-3 text-[var(--fg-tertiary)]" aria-hidden="true" />
                </button>
              </li>
            );
          }),
      )}
    </ul>
  );
}