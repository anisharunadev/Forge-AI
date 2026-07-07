'use client';

import * as React from 'react';
import {
  ChevronDown,
  GripVertical,
  History,
  Layers,
  LayoutTemplate,
  Search,
  type LucideIcon,
} from 'lucide-react';
import type { Node as RFNode } from '@xyflow/react';

import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/shell/EmptyState';
import { useWorkflowStore } from './store';
import type { LeftPanelTab } from './store';
import {
  NODE_CATEGORIES,
  PALETTE_ITEMS,
  isWorkflowNodeData,
} from '../workflow-nodes';
import type {
  PaletteItem,
  NodeCategory,
  WorkflowTemplate,
  WorkflowNodeData,
} from '@/lib/workflow/types';

void isWorkflowNodeData;

/**
 * WorkflowLeftSidebar — Step-23: collapsible rail (56px ↔ 320px).
 *
 * Collapsed: 56px, icons + count badges, tooltip on hover.
 * Expanded: 320px, full Nodes / Templates / Runs tabs.
 *
 * State persisted to localStorage via `setLeftCollapsed`.
 */

export interface WorkflowLeftSidebarProps {
  readonly onOpenTemplate: (template: WorkflowTemplate) => void;
  readonly className?: string;
}

export function WorkflowLeftSidebar({ onOpenTemplate, className }: WorkflowLeftSidebarProps) {
  const tab = useWorkflowStore((s) => s.leftTab);
  const setLeftTab = useWorkflowStore((s) => s.setLeftTab);
  const collapsed = useWorkflowStore((s) => s.leftCollapsed);
  const setLeftCollapsed = useWorkflowStore((s) => s.setLeftCollapsed);
  const addNode = useWorkflowStore((s) => s.addNode);

  return (
    <aside
      className={cn(
        'relative flex h-full shrink-0 flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-base)] transition-[width] duration-200 ease-out-soft motion-reduce:transition-none',
        collapsed ? 'w-14' : 'w-[320px]',
        className,
      )}
      data-testid="workflow-left-sidebar"
      data-collapsed={collapsed ? 'true' : 'false'}
    >
      <RailToggleButton
        collapsed={collapsed}
        onToggle={() => setLeftCollapsed(!collapsed)}
        testId="left-rail-toggle"
        side="left"
      />

      {collapsed ? (
        <CollapsedRail tab={tab} setTab={setLeftTab} />
      ) : (
        <ExpandedRail tab={tab} setTab={setLeftTab} onOpenTemplate={onOpenTemplate} addNode={addNode} />
      )}
    </aside>
  );
}

/* ---------------------------------------------------------------------------
 * Rail toggle (small chevron button)
 * --------------------------------------------------------------------------- */

function RailToggleButton({
  collapsed,
  onToggle,
  testId,
  side,
}: {
  collapsed: boolean;
  onToggle: () => void;
  testId: string;
  side: 'left' | 'right';
}) {
  return (
    <button
      type="button"
      aria-label={collapsed ? `Expand ${side} panel` : `Collapse ${side} panel`}
      onClick={onToggle}
      data-testid={testId}
      className={cn(
        'absolute top-3 z-20 inline-flex h-6 w-6 items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--fg-tertiary)] hover:text-[var(--fg-primary)]',
        side === 'left' ? '-right-3' : '-left-3',
      )}
    >
      <ChevronDown
        className={cn(
          'h-3 w-3 transition-transform duration-200',
          side === 'left'
            ? collapsed ? '-rotate-90' : 'rotate-90'
            : collapsed ? 'rotate-90' : '-rotate-90',
        )}
        aria-hidden="true"
      />
    </button>
  );
}

/* ---------------------------------------------------------------------------
 * Collapsed rail — 56px, icons + count badges + tooltip on hover
 * --------------------------------------------------------------------------- */

const COLLAPSED_TABS: ReadonlyArray<{ id: LeftPanelTab; label: string; icon: LucideIcon; count: number }> = [
  { id: 'nodes', label: 'Nodes', icon: Layers, count: PALETTE_ITEMS.length },
  { id: 'templates', label: 'Templates', icon: LayoutTemplate, count: 6 },
  // ponytail: backend pending, Day 4+ — no /v1/workflows/runs list endpoint
  { id: 'runs', label: 'Runs', icon: History, count: 0 },
];

function CollapsedRail({
  tab,
  setTab,
}: {
  tab: LeftPanelTab;
  setTab: (t: LeftPanelTab) => void;
}) {
  return (
    <nav className="flex flex-1 flex-col items-center gap-1 px-1 pt-12" aria-label="Left rail">
      {COLLAPSED_TABS.map((t) => {
        const Icon = t.icon;
        const active = tab === t.id;
        return (
          <button
            key={t.id}
            type="button"
            aria-label={t.label}
            title={`${t.label} (${t.count})`}
            data-testid={`left-rail-icon-${t.id}`}
            onClick={() => setTab(t.id)}
            className={cn(
              'group relative inline-flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] text-[var(--fg-tertiary)] transition-colors',
              active
                ? 'bg-[var(--bg-inset)] text-[var(--accent-primary)]'
                : 'hover:bg-[var(--bg-inset)] hover:text-[var(--fg-primary)]',
            )}
          >
            <Icon className="h-5 w-5" aria-hidden="true" />
            <span
              className={cn(
                'absolute -bottom-0.5 right-0 rounded-full px-1 font-mono text-[9px]',
                active ? 'bg-[var(--accent-primary)] text-white' : 'bg-[var(--bg-elevated)] text-[var(--fg-tertiary)]',
              )}
            >
              {t.count}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

/* ---------------------------------------------------------------------------
 * Expanded rail — full tabs (44px tall), Nodes / Templates / Runs
 * --------------------------------------------------------------------------- */

function ExpandedRail({
  tab,
  setTab,
  onOpenTemplate,
  addNode,
}: {
  tab: LeftPanelTab;
  setTab: (t: LeftPanelTab) => void;
  onOpenTemplate: (template: WorkflowTemplate) => void;
  addNode: (n: RFNode<WorkflowNodeData>) => void;
}) {
  return (
    <>
      <div role="tablist" className="flex border-b border-[var(--border-subtle)]" style={{ minHeight: 44 }}>
        {(['nodes', 'templates', 'runs'] as const).map((t) => {
          const active = tab === t;
          const count =
            t === 'nodes' ? PALETTE_ITEMS.length : t === 'templates' ? 6 : 0;
          return (
            <button
              key={t}
              role="tab"
              type="button"
              aria-selected={active}
              data-testid={`left-tab-${t}`}
              onClick={() => setTab(t)}
              className={cn(
                'flex flex-1 items-center justify-center gap-1.5 px-3 text-sm font-semibold capitalize transition-colors',
                active
                  ? 'border-b-2 border-[var(--accent-primary)] text-[var(--fg-primary)]'
                  : 'border-b-2 border-transparent text-[var(--fg-tertiary)] hover:text-[var(--fg-secondary)]',
              )}
              style={{ minHeight: 44 }}
            >
              {t}
              <span
                className={cn(
                  'rounded-full px-1.5 font-mono text-[10px]',
                  active ? 'bg-[var(--bg-inset)] text-[var(--fg-secondary)]' : 'bg-[var(--bg-inset)] text-[var(--fg-tertiary)]',
                )}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto thin-scrollbar">
        {tab === 'nodes' ? <NodesTab addNode={addNode} /> : null}
        {tab === 'templates' ? <TemplatesTab onOpenTemplate={onOpenTemplate} /> : null}
        {tab === 'runs' ? <RunsTab /> : null}
      </div>
    </>
  );
}

/* ---------------------------------------------------------------------------
 * Nodes tab — accordion with sticky headers + 18px icons + p-12px rows
 * --------------------------------------------------------------------------- */

function NodesTab({ addNode }: { addNode: (n: RFNode<WorkflowNodeData>) => void }) {
  const [query, setQuery] = React.useState('');
  const [expanded, setExpanded] = React.useState<Record<NodeCategory, boolean>>({
    triggers: true,
    commands: true,
    ai: false,
    logic: false,
    integrations: false,
    human: false,
    flow: false,
  });

  const items = React.useMemo(() => {
    if (!query.trim()) return PALETTE_ITEMS;
    const q = query.toLowerCase();
    return PALETTE_ITEMS.filter((p) => p.label.toLowerCase().includes(q) || p.description.toLowerCase().includes(q));
  }, [query]);

  const grouped = React.useMemo(() => {
    const map: Record<string, PaletteItem[]> = {};
    for (const it of items) {
      (map[it.category] ??= []).push(it);
    }
    return map;
  }, [items]);

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--fg-tertiary)]"
          aria-hidden="true"
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search nodes..."
          aria-label="Search nodes"
          data-testid="palette-search"
          className="w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-3 pl-9 text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-tertiary)] focus:border-[var(--accent-primary)] focus:outline-none"
          style={{ height: 36 }}
        />
      </div>

      {NODE_CATEGORIES.map((cat) => {
        const catItems = grouped[cat.id] ?? [];
        const isOpen = expanded[cat.id];
        if (catItems.length === 0) return null;
        return (
          <div
            key={cat.id}
            className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
          >
            <button
              type="button"
              aria-expanded={isOpen}
              data-testid={`palette-category-${cat.id}`}
              onClick={() => setExpanded((prev) => ({ ...prev, [cat.id]: !prev[cat.id] }))}
              className="sticky top-0 z-10 flex w-full items-center justify-between bg-[var(--bg-surface)] px-3 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--fg-secondary)] hover:bg-[var(--bg-inset)]"
            >
              <span className="flex items-center gap-2">
                <ChevronDown
                  className={cn('h-3.5 w-3.5 transition-transform duration-200', !isOpen && '-rotate-90')}
                  aria-hidden="true"
                />
                <span style={{ color: `var(${cat.accentVar})` }}>{cat.label}</span>
              </span>
              <span className="rounded-full bg-[var(--bg-inset)] px-1.5 font-mono text-[10px] text-[var(--fg-tertiary)]">
                {catItems.length}
              </span>
            </button>
            {isOpen ? (
              <ul role="list" className="flex flex-col gap-0.5 px-1 pb-1">
                {catItems.map((item, i) => (
                  <li key={`${item.nodeKind}-${item.label}-${i}`}>
                    <PaletteRow item={item} onAdd={addNode} />
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function PaletteRow({ item, onAdd }: { item: PaletteItem; onAdd: (n: RFNode<WorkflowNodeData>) => void }) {
  const Icon = item.icon;
  const accentVar = NODE_CATEGORIES.find((c) => c.id === item.category)?.accentVar ?? '--fg-muted';

  const onDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('application/forge-workflow-node', JSON.stringify({
      nodeKind: item.nodeKind,
      label: item.label,
      category: item.category,
    }));
    e.dataTransfer.effectAllowed = 'move';
  };

  const onClick = () => {
    const data = makeDefaultNodeData(item);
    if (!isWorkflowNodeData(data)) return;
    const id = `${item.nodeKind}-${Math.random().toString(36).slice(2, 8)}`;
    onAdd({
      id,
      type: item.nodeKind,
      position: { x: 240, y: 160 },
      data: data as unknown as WorkflowNodeData,
    });
  };

  return (
    <button
      type="button"
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      data-testid={`palette-item-${item.label}`}
      className={cn(
        'group flex w-full items-center gap-2.5 rounded-[var(--radius-sm)] px-3 py-2 text-left transition-colors',
        'hover:bg-[var(--bg-inset)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)]',
      )}
    >
      <GripVertical className="h-3.5 w-3.5 text-[var(--fg-muted)] opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
      <span
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--bg-inset)]"
        style={{ color: `var(${accentVar})` }}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-[var(--fg-primary)]">{item.label}</span>
        <span className="line-clamp-2 text-xs text-[var(--fg-tertiary)]">{item.description}</span>
      </span>
    </button>
  );
}

function makeDefaultNodeData(item: PaletteItem): WorkflowNodeData {
  const id = Math.random().toString(36).slice(2, 8);
  switch (item.nodeKind) {
    case 'trigger': return { kind: 'trigger', label: item.label, triggerType: 'manual' };
    case 'command': return { kind: 'command', label: item.label, commandName: item.label };
    case 'agent': return { kind: 'agent', label: item.label, agentId: `agent-${id}`, agentLabel: item.label };
    case 'llmPrompt': return { kind: 'llmPrompt', label: item.label, prompt: 'Write a helpful response.', model: 'claude-sonnet', temperature: 0.2 };
    case 'apiRequest': return { kind: 'apiRequest', label: item.label, method: 'POST', url: 'https://api.example.com', headersCount: 1, hasBody: true };
    case 'approval': return { kind: 'approval', label: item.label, approverIds: ['role:engineer'], timeoutHours: 24 };
    case 'condition': return { kind: 'condition', label: item.label, expression: 'value == "ok"' };
    case 'wait': return { kind: 'wait', label: item.label, durationSeconds: 300 };
    case 'end': return { kind: 'end', label: item.label, outcome: 'success' };
  }
}

/* ---------------------------------------------------------------------------
 * Templates tab (compact list)
 * --------------------------------------------------------------------------- */

import { WORKFLOW_TEMPLATES } from '@/lib/workflow/templates';

function TemplatesTab({ onOpenTemplate }: { onOpenTemplate: (template: WorkflowTemplate) => void }) {
  return (
    <ul role="list" className="flex flex-col gap-1.5 p-3">
      {WORKFLOW_TEMPLATES.map((t) => {
        const Icon = t.icon;
        return (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => onOpenTemplate(t)}
              data-testid={`left-template-${t.id}`}
              className="flex w-full items-start gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 text-left transition-colors hover:border-[var(--border-default)]"
            >
              <span
                className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--bg-inset)]"
                style={{ color: `var(${t.colorVar})` }}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-[var(--fg-primary)]">{t.name}</span>
                <span className="block truncate text-xs text-[var(--fg-tertiary)]">{t.nodes.length} nodes · {t.category}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/* ---------------------------------------------------------------------------
 * Runs tab
 * --------------------------------------------------------------------------- */

function RunsTab() {
  // ponytail: backend pending, Day 4+ — no /v1/workflows/runs list endpoint
  return (
    <div className="p-3" data-testid="runs-tab-list">
      <EmptyState
        icon={<History className="h-5 w-5" />}
        title="No runs yet"
        description="Backend integration pending — Day 4+. Recent workflow runs will appear here."
      />
    </div>
  );
}

export { RailToggleButton };