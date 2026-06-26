'use client';

import * as React from 'react';
import {
  Activity,
  ArrowLeft,
  Code2,
  Crosshair,
  Play,
  Plus,
  Settings as SettingsIcon,
  ShieldCheck,
  Terminal as TerminalIcon,
  Trash2,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useWorkflowStore } from './store';
import type { RightTab } from './store';
import type {
  WorkflowInput,
  WorkflowNodeData,
  WorkflowTrigger,
} from '@/lib/workflow/types';

/**
 * WorkflowRightSidebar — Step-23: 440px wide, multi-panel tabs.
 *
 * Top header: Settings | Inspector | Logs tabs.
 * Each tab is independently togglable; multiple can be open at once.
 * When collapsed, only a 56px icon rail is shown.
 */

export interface WorkflowRightSidebarProps {
  readonly className?: string;
}

const TAB_META: Record<RightTab, { label: string; icon: LucideIcon; accentVar: string }> = {
  settings: { label: 'Settings', icon: SettingsIcon, accentVar: '--accent-primary' },
  inspector: { label: 'Inspector', icon: Crosshair, accentVar: '--accent-cyan' },
  logs: { label: 'Log', icon: TerminalIcon, accentVar: '--accent-amber' },
};

const TAB_ORDER: ReadonlyArray<RightTab> = ['settings', 'inspector', 'logs'];

export function WorkflowRightSidebar({ className }: WorkflowRightSidebarProps) {
  const openTabs = useWorkflowStore((s) => s.rightOpenTabs);
  const toggleTab = useWorkflowStore((s) => s.toggleRightTab);
  const collapsed = useWorkflowStore((s) => s.rightCollapsed);
  const setCollapsed = useWorkflowStore((s) => s.setRightCollapsed);

  if (collapsed) {
    return (
      <aside
        className={cn(
          'relative flex h-full w-14 shrink-0 flex-col border-l border-[var(--border-subtle)] bg-[var(--bg-base)]',
          className,
        )}
        data-testid="workflow-right-sidebar"
        data-collapsed="true"
      >
        <button
          type="button"
          aria-label="Expand right panel"
          onClick={() => setCollapsed(false)}
          data-testid="right-rail-toggle"
          className="absolute -left-3 top-3 z-20 inline-flex h-6 w-6 items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--fg-tertiary)] hover:text-[var(--fg-primary)]"
        >
          <span className="block h-3 w-3 rotate-180" aria-hidden="true">‹</span>
        </button>
        <nav className="flex flex-1 flex-col items-center gap-1 px-1 pt-12" aria-label="Right rail">
          {TAB_ORDER.map((t) => {
            const meta = TAB_META[t];
            const Icon = meta.icon;
            const isOpen = openTabs.includes(t);
            return (
              <button
                key={t}
                type="button"
                aria-label={meta.label}
                title={meta.label}
                data-testid={`right-rail-icon-${t}`}
                onClick={() => {
                  toggleTab(t);
                  setCollapsed(false);
                }}
                className={cn(
                  'group relative inline-flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] text-[var(--fg-tertiary)] transition-colors',
                  isOpen ? 'bg-[var(--bg-inset)] text-[var(--accent-primary)]' : 'hover:bg-[var(--bg-inset)] hover:text-[var(--fg-primary)]',
                )}
                style={{ color: isOpen ? `var(${meta.accentVar})` : undefined }}
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
              </button>
            );
          })}
        </nav>
      </aside>
    );
  }

  return (
    <aside
      className={cn(
        'relative flex h-full w-[440px] shrink-0 flex-col border-l border-[var(--border-subtle)] bg-[var(--bg-base)]',
        className,
      )}
      data-testid="workflow-right-sidebar"
      data-collapsed="false"
    >
      <button
        type="button"
        aria-label="Collapse right panel"
        onClick={() => setCollapsed(true)}
        data-testid="right-rail-toggle"
        className="absolute -left-3 top-3 z-20 inline-flex h-6 w-6 items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--fg-tertiary)] hover:text-[var(--fg-primary)]"
      >
        <span className="block h-3 w-3" aria-hidden="true">›</span>
      </button>

      {/* Tab strip */}
      <div role="tablist" className="flex shrink-0 items-center gap-1 border-b border-[var(--border-subtle)] px-3 pt-3" style={{ minHeight: 44 }}>
        {TAB_ORDER.map((t) => {
          const meta = TAB_META[t];
          const Icon = meta.icon;
          const isOpen = openTabs.includes(t);
          return (
            <button
              key={t}
              role="tab"
              aria-selected={isOpen}
              data-testid={`right-tab-${t}`}
              onClick={() => toggleTab(t)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-t-[var(--radius-md)] px-3 py-2 text-sm font-semibold transition-colors',
                isOpen
                  ? 'border-b-2 text-[var(--fg-primary)]'
                  : 'text-[var(--fg-tertiary)] hover:text-[var(--fg-secondary)]',
              )}
              style={{
                borderColor: isOpen ? `var(${meta.accentVar})` : 'transparent',
                color: isOpen ? `var(${meta.accentVar})` : undefined,
              }}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {meta.label}
            </button>
          );
        })}
      </div>

      {/* Stacked panels */}
      <div className="flex min-h-0 flex-1 flex-col">
        {openTabs.includes('inspector') ? (
          <div className={cn('min-h-0 overflow-hidden', openTabs.includes('logs') ? 'flex-[1.2]' : 'flex-1')}>
            <InspectorPanel />
          </div>
        ) : null}
        {openTabs.includes('settings') ? (
          <div className={cn('min-h-0 overflow-y-auto border-b border-[var(--border-subtle)]', openTabs.length > 1 ? 'max-h-[40%]' : 'flex-1')}>
            <SettingsPanel />
          </div>
        ) : null}
        {openTabs.includes('logs') ? (
          <div className={cn('min-h-0 overflow-hidden', openTabs.includes('inspector') ? 'flex-1' : 'flex-1')}>
            <ExecutionLogPanel />
          </div>
        ) : null}
        {openTabs.length === 0 ? (
          <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-[var(--fg-tertiary)]">
            Open a tab above to view settings, inspector, or execution log.
          </div>
        ) : null}
      </div>
    </aside>
  );
}

/* ===========================================================================
 * SettingsPanel — workflow-level settings
 * =========================================================================== */

function SettingsPanel() {
  const doc = useWorkflowStore((s) => s.doc);
  const setDoc = useWorkflowStore((s) => s.setDoc);

  return (
    <div className="flex h-full flex-col overflow-y-auto thin-scrollbar" data-testid="workflow-settings">
      <div className="flex flex-col gap-5 p-6">
        <SectionCard title="General">
          <FloatField label="Name" required>
            <input
              value={doc.name}
              onChange={(e) => setDoc({ name: e.target.value })}
              className="w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--fg-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
              data-testid="settings-name"
            />
          </FloatField>
          <FloatField label="Description">
            <textarea
              value={doc.description}
              onChange={(e) => setDoc({ description: e.target.value })}
              rows={3}
              className="w-full resize-none rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--fg-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
              data-testid="settings-description"
            />
          </FloatField>
          <FloatField label="Tags">
            <input
              value={doc.tags.join(', ')}
              onChange={(e) => setDoc({ tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })}
              placeholder="comma, separated"
              className="w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--fg-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
            />
            <p className="text-xs text-[var(--fg-tertiary)]">Comma-separated. Used to find this workflow later.</p>
          </FloatField>
          <FloatField label="Category">
            <input
              value={doc.category ?? ''}
              onChange={(e) => setDoc({ category: e.target.value })}
              className="w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--fg-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
            />
          </FloatField>
        </SectionCard>

        <SectionCard
          title="Inputs"
          action={
            <button
              type="button"
              onClick={() => setDoc({ inputs: [...doc.inputs, { name: `input_${doc.inputs.length + 1}`, type: 'string', required: false }] })}
              className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-1 text-xs text-[var(--accent-primary)] hover:bg-[var(--bg-inset)]"
            >
              <Plus className="h-3 w-3" aria-hidden="true" /> Add
            </button>
          }
        >
          {doc.inputs.length === 0 ? (
            <p className="text-xs text-[var(--fg-tertiary)]">No inputs defined.</p>
          ) : (
            <ul role="list" className="flex flex-col gap-2">
              {doc.inputs.map((input, i) => (
                <li key={i} className="flex items-center gap-2">
                  <input
                    value={input.name}
                    onChange={(e) => {
                      const next = [...doc.inputs];
                      next[i] = { ...input, name: e.target.value };
                      setDoc({ inputs: next });
                    }}
                    className="flex-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1 font-mono text-xs text-[var(--fg-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
                  />
                  <select
                    value={input.type}
                    onChange={(e) => {
                      const next = [...doc.inputs];
                      next[i] = { ...input, type: e.target.value as WorkflowInput['type'] };
                      setDoc({ inputs: next });
                    }}
                    className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1 text-xs text-[var(--fg-primary)]"
                  >
                    <option value="string">string</option>
                    <option value="number">number</option>
                    <option value="boolean">boolean</option>
                    <option value="json">json</option>
                  </select>
                  <button
                    type="button"
                    aria-label="Remove input"
                    onClick={() => setDoc({ inputs: doc.inputs.filter((_, j) => j !== i) })}
                    className="text-[var(--fg-tertiary)] hover:text-[var(--accent-rose)]"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="Triggers">
          <ul role="list" className="flex flex-col gap-1.5">
            {doc.triggers.map((t, i) => (
              <li key={i} className="flex items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2">
                <span className="flex items-center gap-2">
                  <span className="font-mono text-[11px] uppercase text-[var(--accent-primary)]">{t.kind}</span>
                  <span className="text-xs text-[var(--fg-secondary)]">{t.detail}</span>
                </span>
                <label className="flex cursor-pointer items-center gap-1 text-xs text-[var(--fg-tertiary)]">
                  <input
                    type="checkbox"
                    checked={t.enabled}
                    onChange={(e) => {
                      const next = [...doc.triggers];
                      next[i] = { ...t, enabled: e.target.checked } satisfies WorkflowTrigger;
                      setDoc({ triggers: next });
                    }}
                  />
                  enabled
                </label>
              </li>
            ))}
          </ul>
        </SectionCard>

        <SectionCard title="Permissions">
          <select
            value={doc.permissions.scope}
            onChange={(e) => setDoc({ permissions: { ...doc.permissions, scope: e.target.value as 'all' | 'roles' | 'users' } })}
            className="w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--fg-primary)]"
          >
            <option value="all">All team members</option>
            <option value="roles">Specific roles</option>
            <option value="users">Specific users</option>
          </select>
        </SectionCard>

        <SectionCard title="Sharing">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--border-subtle)] px-3 py-2 text-sm text-[var(--fg-secondary)] hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)]"
          >
            Copy share link
          </button>
        </SectionCard>
      </div>
    </div>
  );
}

/* ===========================================================================
 * InspectorPanel — per-node configuration
 * =========================================================================== */

function InspectorPanel() {
  const selectedId = useWorkflowStore((s) => s.selectedNodeId);
  const nodes = useWorkflowStore((s) => s.nodes);
  const setSelected = useWorkflowStore((s) => s.setSelectedNode);
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const selected = nodes.find((n) => n.id === selectedId);

  if (!selected) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center" data-testid="workflow-inspector">
        <Crosshair className="h-8 w-8 text-[var(--fg-tertiary)]" aria-hidden="true" />
        <p className="text-sm text-[var(--fg-secondary)]">Select a node to inspect it.</p>
      </div>
    );
  }

  const data = selected.data as WorkflowNodeData;
  const error = (data as { error?: string }).error;
  const runState = (data as { runState?: string }).runState;

  return (
    <div className="flex h-full flex-col" data-testid="workflow-inspector">
      {/* Sticky header */}
      <header className="flex shrink-0 flex-col gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-base)] px-6 py-4">
        <button
          type="button"
          onClick={() => setSelected(null)}
          className="inline-flex w-fit items-center gap-1 text-xs text-[var(--fg-tertiary)] hover:text-[var(--fg-secondary)]"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden="true" /> Workflow settings
        </button>
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-[var(--accent-rose)]" aria-hidden="true" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--accent-rose)]">
            {data.kind}
          </span>
        </div>
        <InlineEditableTitle
          value={data.label}
          onCommit={(v) => updateNodeData(selected.id, { label: v })}
        />
        <p className="font-mono text-xs text-[var(--fg-tertiary)]">{selected.id}</p>
      </header>

      <div className="flex-1 overflow-y-auto thin-scrollbar">
        <div className="flex flex-col gap-5 p-6">
          {renderKindConfig(data, (patch) => updateNodeData(selected.id, patch))}

          {/* Behavior */}
          <SectionCard title="Behavior">
            <FloatField label="On timeout">
              <select className="w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--fg-primary)]">
                <option>Auto-approve</option>
                <option>Auto-reject</option>
                <option>Reassign</option>
                <option>Wait forever</option>
              </select>
            </FloatField>
            <ToggleRow label="Send Slack notification" defaultChecked />
            <ToggleRow label="Send email reminder" />
          </SectionCard>

          {/* Test */}
          <SectionCard title="Test">
            <button
              type="button"
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--accent-primary)] px-3 text-sm font-semibold text-white hover:opacity-90"
              data-testid="inspector-test-node"
            >
              <Play className="h-4 w-4" aria-hidden="true" /> Test this node
            </button>
            <div className="text-center text-xs text-[var(--fg-tertiary)]">
              {runState === 'running' ? <span className="text-[var(--accent-cyan)]">Running…</span> : null}
              {runState === 'succeeded' ? <span className="text-[var(--accent-emerald)]">Last run succeeded.</span> : null}
              {runState === 'failed' && error ? (
                <span className="text-[var(--accent-rose)]">{error}</span>
              ) : null}
            </div>
            <details className="group rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
              <summary className="flex cursor-pointer items-center gap-1 px-3 py-2 text-sm font-medium text-[var(--fg-secondary)]">
                <Code2 className="h-3.5 w-3.5" aria-hidden="true" />
                View source JSON
              </summary>
              <pre className="thin-scrollbar overflow-x-auto border-t border-[var(--border-subtle)] p-3 font-mono text-[11px] text-[var(--fg-secondary)]">
                {JSON.stringify(data, null, 2)}
              </pre>
            </details>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

function renderKindConfig(data: WorkflowNodeData, _onChange: (patch: Partial<WorkflowNodeData>) => void) {
  switch (data.kind) {
    case 'command':
      return (
        <SectionCard title="Command">
          <FloatField label="Forge command">
            <input
              value={data.commandName}
              readOnly
              className="w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2 font-mono text-xs text-[var(--fg-secondary)]"
            />
          </FloatField>
          <FloatField label="Input mapping">
            <p className="font-mono text-xs text-[var(--fg-tertiary)]">{`{{input.feature_name}}`}</p>
            <p className="text-xs text-[var(--fg-tertiary)]">References workflow inputs by name.</p>
          </FloatField>
        </SectionCard>
      );
    case 'llmPrompt':
      return (
        <>
          <SectionCard title="Prompt">
            <textarea
              value={data.prompt}
              readOnly
              rows={5}
              className="w-full resize-none rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--fg-primary)]"
              style={{ minHeight: 80 }}
            />
            <p className="text-xs text-[var(--fg-tertiary)]">{data.prompt.length} chars</p>
          </SectionCard>
          <SectionCard title="Model">
            <div className="grid grid-cols-2 gap-3">
              <FloatField label="Model">
                <input
                  value={data.model ?? ''}
                  readOnly
                  className="w-full rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 font-mono text-xs text-[var(--fg-secondary)]"
                />
              </FloatField>
              <FloatField label="Temperature">
                <input
                  value={String(data.temperature ?? '')}
                  readOnly
                  className="w-full rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 font-mono text-xs text-[var(--fg-secondary)]"
                />
              </FloatField>
            </div>
          </SectionCard>
        </>
      );
    case 'apiRequest':
      return (
        <SectionCard title="HTTP">
          <div className="grid grid-cols-[100px_1fr] gap-3">
            <FloatField label="Method">
              <input
                value={data.method}
                readOnly
                className="w-full rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 font-mono text-xs text-[var(--fg-secondary)]"
              />
            </FloatField>
            <FloatField label="URL">
              <input
                value={data.url}
                readOnly
                className="w-full rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 font-mono text-xs text-[var(--fg-secondary)]"
              />
            </FloatField>
          </div>
          <p className="text-xs text-[var(--fg-tertiary)]">Headers: {data.headersCount ?? 0} · Body: {data.hasBody ? 'JSON' : 'none'}</p>
        </SectionCard>
      );
    case 'approval':
      return (
        <SectionCard title="Configuration">
          <FloatField label="Approvers">
            <div className="flex flex-wrap gap-1.5 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2">
              {data.approverIds.map((id, i) => (
                <span
                  key={`${id}-${i}`}
                  className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-inset)] py-0.5 pl-2 pr-1 text-xs text-[var(--fg-secondary)]"
                >
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-[var(--accent-rose)]/30 font-mono text-[9px] text-[var(--accent-rose)]">
                    {id.replace(/^role:/, '').slice(0, 2).toUpperCase()}
                  </span>
                  {id}
                  <button type="button" className="text-[var(--fg-tertiary)] hover:text-[var(--accent-rose)]">
                    <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                </span>
              ))}
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-full border border-dashed border-[var(--border-default)] px-2 py-0.5 text-xs text-[var(--fg-tertiary)] hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)]"
              >
                <Plus className="h-3 w-3" aria-hidden="true" /> Add approver
              </button>
            </div>
          </FloatField>
          <div className="grid grid-cols-[1fr_80px] gap-3">
            <FloatField label="Timeout" required>
              <input
                value={String(data.timeoutHours)}
                readOnly
                className="w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 font-mono text-xs text-[var(--fg-secondary)]"
              />
            </FloatField>
            <FloatField label="Unit">
              <select className="w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--fg-primary)]">
                <option>hours</option>
                <option>days</option>
              </select>
            </FloatField>
          </div>
          <FloatField label="Criteria" required>
            <textarea
              value={data.criteria ?? ''}
              readOnly
              rows={4}
              placeholder="What does the approver need to verify?"
              className="w-full resize-none rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--fg-primary)]"
              style={{ minHeight: 80 }}
            />
            <p className="text-xs text-[var(--fg-tertiary)]">Describe the approval criteria so the approver knows what to check.</p>
          </FloatField>
        </SectionCard>
      );
    case 'condition':
      return (
        <SectionCard title="Configuration">
          <FloatField label="Expression" required>
            <input
              value={data.expression}
              readOnly
              className="w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 font-mono text-sm text-[var(--fg-secondary)]"
            />
            <p className="text-xs text-[var(--fg-tertiary)]">JavaScript expression. Two outputs: <span className="text-[var(--accent-emerald)]">true</span>, <span className="text-[var(--accent-rose)]">false</span>.</p>
          </FloatField>
        </SectionCard>
      );
    case 'wait':
      return (
        <SectionCard title="Configuration">
          <FloatField label="Duration" required>
            <input
              value={String(data.durationSeconds)}
              readOnly
              className="w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 font-mono text-xs text-[var(--fg-secondary)]"
            />
            <p className="text-xs text-[var(--fg-tertiary)]">seconds</p>
          </FloatField>
        </SectionCard>
      );
    case 'trigger':
      return (
        <SectionCard title="Configuration">
          <FloatField label="Type">
            <input
              value={data.triggerType}
              readOnly
              className="w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 font-mono text-xs text-[var(--fg-secondary)]"
            />
          </FloatField>
          {data.triggerDetail ? (
            <FloatField label="Detail">
              <input
                value={data.triggerDetail}
                readOnly
                className="w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 font-mono text-xs text-[var(--fg-secondary)]"
              />
            </FloatField>
          ) : null}
        </SectionCard>
      );
    case 'agent':
      return (
        <SectionCard title="Configuration">
          <FloatField label="Agent">
            <input
              value={data.agentLabel}
              readOnly
              className="w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--fg-secondary)]"
            />
          </FloatField>
          {data.taskDescription ? (
            <FloatField label="Task">
              <textarea
                value={data.taskDescription}
                readOnly
                rows={4}
                className="w-full resize-none rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--fg-secondary)]"
              />
            </FloatField>
          ) : null}
        </SectionCard>
      );
    case 'end':
      return (
        <SectionCard title="Configuration">
          <FloatField label="Outcome" required>
            <input
              value={data.outcome}
              readOnly
              className="w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 font-mono text-sm text-[var(--fg-secondary)]"
            />
            <p className="text-xs text-[var(--fg-tertiary)]">When does this terminator fire? <em>success</em> = clean finish, <em>failure</em> = error path, <em>always</em> = exit on either.</p>
          </FloatField>
        </SectionCard>
      );
  }
}

/* ===========================================================================
 * ExecutionLogPanel — multi-row layout, click to jump
 * =========================================================================== */

function ExecutionLogPanel() {
  const log = useWorkflowStore((s) => s.runLog);
  const nodes = useWorkflowStore((s) => s.nodes);
  const setSelectedNode = useWorkflowStore((s) => s.setSelectedNode);
  const toggleRightTab = useWorkflowStore((s) => s.toggleRightTab);

  const [filter, setFilter] = React.useState<'all' | 'started' | 'completed' | 'failed' | 'skipped'>('all');

  const filtered = React.useMemo(() => {
    if (filter === 'all') return log;
    if (filter === 'started') return log.filter((e) => e.status === 'running' || e.status === 'pending');
    if (filter === 'completed') return log.filter((e) => e.status === 'succeeded');
    if (filter === 'failed') return log.filter((e) => e.status === 'failed');
    if (filter === 'skipped') return log.filter((e) => e.status === 'skipped');
    return log;
  }, [filter, log]);

  const jumpTo = (nodeId: string) => {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;
    setSelectedNode(nodeId);
    if (!useWorkflowStore.getState().rightOpenTabs.includes('inspector')) toggleRightTab('inspector');
  };

  return (
    <div className="flex h-full flex-col" data-testid="workflow-execution-log">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-6 py-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--accent-amber)]">
            Live
          </p>
          <h2 className="text-sm font-semibold text-[var(--fg-primary)]">Execution log</h2>
        </div>
        <Activity className="h-4 w-4 text-[var(--accent-amber)]" aria-hidden="true" />
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-1 border-b border-[var(--border-subtle)] px-6 py-2">
        {(['all', 'started', 'completed', 'failed', 'skipped'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              'rounded-full px-2.5 py-1 text-xs font-medium capitalize transition-colors',
              filter === f
                ? 'bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]'
                : 'text-[var(--fg-tertiary)] hover:bg-[var(--bg-inset)] hover:text-[var(--fg-secondary)]',
            )}
            data-testid={`log-filter-${f}`}
          >
            {f}
          </button>
        ))}
      </div>

      <ul role="list" className="flex-1 overflow-y-auto p-3 thin-scrollbar">
        {filtered.length === 0 ? (
          <li className="flex items-center justify-center py-12 text-xs text-[var(--fg-tertiary)]">
            No events yet. Press Run to start.
          </li>
        ) : null}
        {filtered.map((entry, i) => (
          <li
            key={`${entry.at}-${i}`}
            className="group flex items-center gap-3 rounded-[var(--radius-sm)] border border-transparent px-3 py-2 hover:border-[var(--border-subtle)] hover:bg-[var(--bg-surface)]"
            data-run-status={entry.status}
          >
            <span className="w-[64px] shrink-0 font-mono text-[11px] text-[var(--fg-tertiary)]">
              {new Date(entry.at).toLocaleTimeString()}
            </span>
            <span
              aria-hidden="true"
              className={cn(
                'h-2 w-2 shrink-0 rounded-full',
                entry.status === 'succeeded' && 'bg-[var(--accent-emerald)]',
                entry.status === 'failed' && 'bg-[var(--accent-rose)]',
                entry.status === 'running' && 'bg-[var(--accent-cyan)] ai-thinking-dot',
                entry.status === 'skipped' && 'bg-[var(--fg-tertiary)]',
                entry.status === 'waiting' && 'bg-[var(--accent-amber)]',
                entry.status === 'pending' && 'bg-[var(--fg-tertiary)]',
                entry.status === 'idle' && 'bg-[var(--fg-tertiary)]',
              )}
            />
            <button
              type="button"
              onClick={() => jumpTo(entry.nodeId)}
              className="min-w-0 flex-1 truncate text-left text-sm font-medium text-[var(--fg-primary)] hover:text-[var(--accent-primary)]"
            >
              {entry.message}
            </button>
            <button
              type="button"
              onClick={() => jumpTo(entry.nodeId)}
              className="hidden shrink-0 text-xs text-[var(--accent-primary)] opacity-0 group-hover:opacity-100 hover:underline"
            >
              Jump to node
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ===========================================================================
 * Inline editable title — double click to edit, Esc / Enter to commit
 * =========================================================================== */

function InlineEditableTitle({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (v: string) => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);

  React.useEffect(() => setDraft(value), [value]);

  const commit = () => {
    if (draft.trim() && draft !== value) onCommit(draft.trim());
    else setDraft(value);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') {
            setDraft(value);
            setEditing(false);
          }
        }}
        className="w-full rounded-[var(--radius-sm)] border border-[var(--accent-primary)] bg-[var(--bg-base)] px-2 py-1 text-lg font-semibold text-[var(--fg-primary)] focus:outline-none"
        data-testid="inline-title-input"
      />
    );
  }

  return (
    <h2
      onDoubleClick={() => setEditing(true)}
      className="cursor-text truncate rounded-[var(--radius-sm)] px-1 py-0.5 text-lg font-semibold text-[var(--fg-primary)] hover:bg-[var(--bg-inset)]"
      data-testid="inline-title"
      title="Double-click to rename"
    >
      {value}
    </h2>
  );
}

/* ===========================================================================
 * Reusable section + field
 * =========================================================================== */

function SectionCard({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
      <header className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--fg-primary)]">{title}</h3>
        {action}
      </header>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

function FloatField({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-[11px] font-medium uppercase tracking-widest text-[var(--fg-tertiary)]">
        {label}
        {required ? <span className="ml-0.5 text-[var(--accent-rose)]">*</span> : null}
      </span>
      {children}
    </label>
  );
}

function ToggleRow({ label, defaultChecked }: { label: string; defaultChecked?: boolean }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2">
      <span className="text-sm text-[var(--fg-primary)]">{label}</span>
      <span className="relative inline-flex">
        <input type="checkbox" defaultChecked={defaultChecked} className="peer sr-only" />
        <span className="h-5 w-9 rounded-full bg-[var(--bg-inset)] transition-colors peer-checked:bg-[var(--accent-primary)]" />
        <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform peer-checked:translate-x-4" />
      </span>
    </label>
  );
}