'use client';

/**
 * WorkflowCanvas — the React Flow editor.
 *
 * Step-23 layout: TopBar (64px) | collapsible LeftRail (56↔320) | ReactFlow | collapsible RightRail (56↔440) | StatusBar (40).
 *
 * Step-23 additions:
 *   - Fix 8 — Empty canvas card (centered, 480px, three buttons + dashed starter outline)
 *   - Fix 5 — Bottom status bar (zoom / coords / node count / validation)
 *   - Fix 6 — MiniMap sized 200×120; Controls 32×32 vertical stack
 *   - Fix 11 — Edge/handle polish (connection colors, animation hints)
 */

import * as React from 'react';
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Check,
  MousePointerSquareDashed,
  PlayCircle,
  Plus,
  Sparkles,
  Video,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { workflowNodeTypes } from '../workflow-nodes';
import type { WorkflowNodeData } from '@/lib/workflow/types';

import { useWorkflowStore } from './store';
import { useMockExecution } from './useMockExecution';
import { useWorkflowKeyboard } from './useWorkflowKeyboard';
import { WorkflowTopBar } from './WorkflowTopBar';
import { WorkflowLeftSidebar } from './WorkflowLeftSidebar';
import { WorkflowRightSidebar } from './WorkflowRightSidebar';
import { VariableDrawer } from './VariableDrawer';
import { VersionDrawer } from './VersionDrawer';

export interface WorkflowCanvasProps {
  readonly onBack: () => void;
}

export function WorkflowCanvas(props: WorkflowCanvasProps) {
  return (
    <ReactFlowProvider>
      <WorkflowCanvasInner onBack={props.onBack} />
    </ReactFlowProvider>
  );
}

function WorkflowCanvasInner({ onBack }: WorkflowCanvasProps) {
  const nodes = useWorkflowStore((s) => s.nodes);
  const edges = useWorkflowStore((s) => s.edges);
  const onNodesChange = useWorkflowStore((s) => s.onNodesChange);
  const onEdgesChange = useWorkflowStore((s) => s.onEdgesChange);
  const setEdges = useWorkflowStore((s) => s.setEdges);
  const setSelectedNode = useWorkflowStore((s) => s.setSelectedNode);
  const setRightPanel = useWorkflowStore((s) => s.setRightPanel);
  const hydrateFromTemplate = useWorkflowStore((s) => s.hydrateFromTemplate);
  const addNode = useWorkflowStore((s) => s.addNode);
  const saveStatus = useWorkflowStore((s) => s.saveStatus);
  const setSaveStatus = useWorkflowStore((s) => s.setSaveStatus);
  const toggleRightTab = useWorkflowStore((s) => s.toggleRightTab);

  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [variableDrawerOpen, setVariableDrawerOpen] = React.useState(false);
  const [versionDrawerOpen, setVersionDrawerOpen] = React.useState(false);
  const [validationOpen, setValidationOpen] = React.useState(false);

  const { start, stop } = useMockExecution();
  const { screenToFlowPosition, getZoom } = useReactFlow();
  const [zoomPct, setZoomPct] = React.useState(100);
  React.useEffect(() => {
    const id = setInterval(() => setZoomPct(Math.round(getZoom() * 100)), 500);
    return () => clearInterval(id);
  }, [getZoom]);

  const isValidConnection = React.useCallback((conn: Connection | Edge) => {
    const sourceNode = nodes.find((n) => n.id === conn.source);
    const targetNode = nodes.find((n) => n.id === conn.target);
    if (sourceNode && (sourceNode.data as WorkflowNodeData).kind === 'end') return false;
    if (targetNode && (targetNode.data as WorkflowNodeData).kind === 'trigger') return false;
    return true;
  }, [nodes]);

  const onConnect = React.useCallback(
    (params: Connection) => {
      setEdges(addEdge({ ...params, animated: false }, edges));
    },
    [edges, setEdges],
  );

  const onDrop = React.useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData('application/forge-workflow-node');
      if (!raw) return;
      try {
        const { nodeKind, label } = JSON.parse(raw) as { nodeKind: WorkflowNodeData['kind']; label: string };
        const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
        const data = makeDefaultFromKind(nodeKind, label);
        if (!data) return;
        const id = `${nodeKind}-${Math.random().toString(36).slice(2, 8)}`;
        addNode({ id, type: nodeKind, position, data });
      } catch {
        /* ignore malformed drops */
      }
    },
    [addNode, screenToFlowPosition],
  );

  const onDragOver = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleSelectionChange = React.useCallback(
    ({ nodes: sel }: { nodes: Node[]; edges: Edge[] }) => {
      const first = sel[0];
      setSelectedNode(first?.id ?? null);
      if (first) {
        if (!useWorkflowStore.getState().rightOpenTabs.includes('inspector')) {
          toggleRightTab('inspector');
        }
      }
    },
    [setSelectedNode, toggleRightTab],
  );

  React.useEffect(() => {
    if (nodes.length === 0 && edges.length === 0) return;
    setSaveStatus('saving');
    const t = setTimeout(() => setSaveStatus('saved'), 1200);
    return () => clearTimeout(t);
  }, [nodes, edges, setSaveStatus]);

  useWorkflowKeyboard({
    onOpenPalette: () => setPaletteOpen(true),
    onRun: () => {
      const exec = useWorkflowStore.getState().isExecuting;
      if (exec) stop(); else start();
    },
    onForceSave: () => {
      setSaveStatus('saving');
      setTimeout(() => setSaveStatus('saved'), 400);
    },
  });

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash;
    const match = hash.match(/template=([\w-]+)/);
    if (!match) return;
    const id = match[1];
    void import('@/lib/workflow/templates').then(({ WORKFLOW_TEMPLATES }) => {
      const t = WORKFLOW_TEMPLATES.find((x) => x.id === id);
      if (!t) return;
      hydrateFromTemplate({ nodes: t.nodes, edges: t.edges, name: t.name, description: t.description });
    });
  }, [hydrateFromTemplate]);

  const nodeTypes: NodeTypes = React.useMemo(() => workflowNodeTypes as unknown as NodeTypes, []);

  const hasNodes = nodes.length > 0;

  // Validation summary (basic)
  const validation = React.useMemo(() => validate(nodes, edges), [nodes, edges]);

  return (
    <div
      className="flex h-[calc(100vh-3.5rem)] flex-col overflow-hidden bg-[var(--bg-base)]"
      data-testid="workflow-canvas-root"
    >
      <WorkflowTopBar
        onBack={onBack}
        onShowVersions={() => setVersionDrawerOpen(true)}
        onShowVariables={() => setVariableDrawerOpen(true)}
      />
      <div className="flex min-h-0 flex-1">
        <WorkflowLeftSidebar onOpenTemplate={() => onBack()} />

        <div
          className="relative flex-1"
          onDrop={onDrop}
          onDragOver={onDragOver}
          data-testid="workflow-canvas-drop-zone"
        >
          <ReactFlow
            nodes={nodes as unknown as Node[]}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange as unknown as (changes: NodeChange[]) => void}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            onSelectionChange={handleSelectionChange}
            onNodeClick={(_, n) => {
              setSelectedNode(n.id);
              setRightPanel('inspector');
            }}
            onPaneClick={() => {
              setSelectedNode(null);
              setRightPanel('settings');
            }}
            connectionMode={ConnectionMode.Strict}
            snapToGrid
            snapGrid={[20, 20]}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            connectionLineStyle={{ stroke: 'var(--accent-primary)', strokeWidth: 2.5 }}
            defaultEdgeOptions={{
              animated: false,
              style: { stroke: 'var(--border-default)', strokeWidth: 2.5 },
            }}
            proOptions={{ hideAttribution: true }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={20}
              size={1}
              color="rgba(255,255,255,0.06)"
            />
            <MiniMap
              {...({
                position: 'bottom-left',
                width: 200,
                height: 120,
                style: {
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 8,
                  boxShadow: 'var(--shadow-md)',
                },
                maskColor: 'rgba(0,0,0,0.6)',
                nodeColor: (n: { data?: unknown }) => {
                  const kind = (n.data as WorkflowNodeData)?.kind ?? 'command';
                  switch (kind) {
                    case 'trigger': return '#10b981';
                    case 'command': return '#06b6d4';
                    case 'agent': return '#a855f7';
                    case 'llmPrompt': return '#a855f7';
                    case 'apiRequest': return '#f59e0b';
                    case 'approval': return '#f43f5e';
                    case 'condition': return '#94a3b8';
                    case 'wait': return '#94a3b8';
                    case 'end': return '#10b981';
                  }
                },
              } as React.ComponentProps<typeof MiniMap>)}
            />
            <Controls
              position="bottom-right"
              showInteractive={false}
              className="!flex !flex-col !gap-1 !rounded-[var(--radius-md)] !border !border-[var(--border-subtle)] !bg-[var(--bg-elevated)] !p-1 !shadow-[var(--shadow-md)]"
            />
          </ReactFlow>

          {!hasNodes ? <EmptyCanvasCard onPickTemplate={onBack} /> : null}
        </div>

        <WorkflowRightSidebar />
      </div>

      {/* Bottom status bar */}
      <StatusBar
        zoomPct={zoomPct}
        nodeCount={nodes.length}
        edgeCount={edges.length}
        selectedNodeLabel={
          nodes.find((n) => n.selected)?.data?.label ?? null
        }
        validation={validation}
        onOpenValidation={() => setValidationOpen(true)}
      />

      {paletteOpen ? (
        <SpacePalette onClose={() => setPaletteOpen(false)} onPick={(kind, label) => {
          const data = makeDefaultFromKind(kind, label);
          if (!data) return;
          const id = `${kind}-${Math.random().toString(36).slice(2, 8)}`;
          addNode({ id, type: kind, position: { x: 240, y: 200 }, data });
          setPaletteOpen(false);
        }} />
      ) : null}

      {variableDrawerOpen ? <VariableDrawer onClose={() => setVariableDrawerOpen(false)} /> : null}
      {versionDrawerOpen ? <VersionDrawer onClose={() => setVersionDrawerOpen(false)} /> : null}
      {validationOpen ? (
        <ValidationDialog
          issues={validation.issues}
          onClose={() => setValidationOpen(false)}
          onJump={(id) => {
            setSelectedNode(id);
            setValidationOpen(false);
          }}
        />
      ) : null}

      <span data-testid="workflow-save-state" data-status={saveStatus} hidden />
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Empty canvas — Step-23 Fix 8
 * --------------------------------------------------------------------------- */

function EmptyCanvasCard({ onPickTemplate }: { onPickTemplate: () => void }) {
  return (
    <div
      className="pointer-events-none absolute inset-0 flex items-center justify-center p-8"
      data-testid="empty-canvas-card"
    >
      <div className="pointer-events-auto flex w-full max-w-[480px] flex-col items-center gap-4 rounded-[var(--radius-xl)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-8 text-center shadow-[var(--shadow-lg)]">
        <MousePointerSquareDashed
          className="h-12 w-12 text-[var(--accent-primary)] motion-safe:animate-bounce"
          aria-hidden="true"
        />
        <h2 className="text-xl font-bold text-[var(--fg-primary)]">Build your first workflow</h2>
        <p className="text-sm text-[var(--fg-secondary)]">
          Drag a node from the left panel, or pick a template to get started.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={onPickTemplate}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--accent-primary)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
            data-testid="empty-open-templates"
          >
            <Sparkles className="h-4 w-4" aria-hidden="true" /> Open templates
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--border-default)] px-4 py-2 text-sm text-[var(--fg-primary)] hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)]"
            data-testid="empty-add-trigger"
          >
            <Plus className="h-4 w-4" aria-hidden="true" /> Add trigger
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] px-4 py-2 text-sm text-[var(--fg-tertiary)] hover:text-[var(--fg-secondary)]"
            data-testid="empty-watch-tour"
          >
            <Video className="h-4 w-4" aria-hidden="true" /> Watch 30s tour
          </button>
        </div>

        {/* Faint dashed starter outline */}
        <svg
          aria-hidden="true"
          viewBox="0 0 400 80"
          className="mt-2 h-12 w-full text-[var(--border-default)]"
        >
          <rect x="10" y="20" width="80" height="40" rx="8" fill="none" stroke="currentColor" strokeDasharray="4 4" />
          <text x="50" y="44" textAnchor="middle" fontSize="10" fill="currentColor">Trigger</text>
          <line x1="90" y1="40" x2="170" y2="40" stroke="currentColor" strokeDasharray="4 4" />
          <rect x="170" y="20" width="80" height="40" rx="8" fill="none" stroke="currentColor" strokeDasharray="4 4" />
          <text x="210" y="44" textAnchor="middle" fontSize="10" fill="currentColor">Agent</text>
          <line x1="250" y1="40" x2="330" y2="40" stroke="currentColor" strokeDasharray="4 4" />
          <rect x="330" y="20" width="60" height="40" rx="8" fill="none" stroke="currentColor" strokeDasharray="4 4" />
          <text x="360" y="44" textAnchor="middle" fontSize="10" fill="currentColor">End</text>
        </svg>
        <p className="text-xs text-[var(--fg-tertiary)]">Drop here · or any spot on the canvas</p>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Bottom status bar — Step-23 Fix 5
 * --------------------------------------------------------------------------- */

function StatusBar({
  zoomPct,
  nodeCount,
  edgeCount,
  selectedNodeLabel,
  validation,
  onOpenValidation,
}: {
  zoomPct: number;
  nodeCount: number;
  edgeCount: number;
  selectedNodeLabel: string | null;
  validation: { errors: number; warnings: number };
  onOpenValidation: () => void;
}) {
  const ready = validation.errors === 0 && validation.warnings === 0;
  return (
    <div
      className="flex h-10 shrink-0 items-center justify-between border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 text-xs"
      data-testid="workflow-statusbar"
    >
      <div className="flex items-center gap-4 font-mono text-[var(--fg-tertiary)]">
        <span data-testid="status-zoom">Zoom {zoomPct}%</span>
        <span>{nodeCount} nodes · {edgeCount} edges</span>
        {selectedNodeLabel ? (
          <span className="text-[var(--fg-secondary)]">
            <PlayCircle className="mr-1 inline h-3 w-3" aria-hidden="true" />
            {selectedNodeLabel} selected
          </span>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onOpenValidation}
        data-testid="status-validation"
        className={cn(
          'inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1 font-mono text-xs',
          ready
            ? 'text-[var(--accent-emerald)] hover:bg-[var(--bg-inset)]'
            : 'text-[var(--accent-amber)] hover:bg-[var(--bg-inset)]',
        )}
      >
        {ready ? <Check className="h-3 w-3" aria-hidden="true" /> : null}
        {ready ? 'Ready to run' : `${validation.errors} errors, ${validation.warnings} warnings`}
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Validation dialog — Fix 12
 * --------------------------------------------------------------------------- */

function ValidationDialog({
  issues,
  onClose,
  onJump,
}: {
  issues: ReadonlyArray<{ id: string | null; kind: 'error' | 'warning'; message: string }>;
  onClose: () => void;
  onJump: (nodeId: string) => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Validation issues"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] shadow-[var(--shadow-lg)]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-[var(--border-subtle)] px-5 py-4">
          <h2 className="text-sm font-semibold text-[var(--fg-primary)]">Validation</h2>
          <button type="button" onClick={onClose} className="text-[var(--fg-tertiary)] hover:text-[var(--fg-primary)]">
            ✕
          </button>
        </header>
        <ul role="list" className="max-h-80 overflow-y-auto p-3">
          {issues.length === 0 ? (
            <li className="p-6 text-center text-sm text-[var(--fg-tertiary)]">No issues found.</li>
          ) : null}
          {issues.map((iss, i) => (
            <li
              key={i}
              className={cn(
                'flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border px-3 py-2',
                iss.kind === 'error'
                  ? 'border-[rgba(244,63,94,0.4)] bg-[rgba(244,63,94,0.08)]'
                  : 'border-[rgba(245,158,11,0.4)] bg-[rgba(245,158,11,0.08)]',
              )}
            >
              <span
                className={cn(
                  'text-sm',
                  iss.kind === 'error' ? 'text-[var(--accent-rose)]' : 'text-[var(--accent-amber)]',
                )}
              >
                {iss.message}
              </span>
              {iss.id ? (
                <button
                  type="button"
                  onClick={() => onJump(iss.id as string)}
                  className="text-xs text-[var(--accent-primary)] hover:underline"
                >
                  Jump to node
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function validate(nodes: Node[], edges: Edge[]): {
  errors: number;
  warnings: number;
  issues: ReadonlyArray<{ id: string | null; kind: 'error' | 'warning'; message: string }>;
} {
  const issues: Array<{ id: string | null; kind: 'error' | 'warning'; message: string }> = [];

  const triggers = nodes.filter((n) => (n.data as WorkflowNodeData).kind === 'trigger');
  if (nodes.length > 0 && triggers.length === 0) {
    issues.push({ id: null, kind: 'error', message: 'No trigger node found. Workflows need a starting trigger.' });
  }

  const ends = nodes.filter((n) => (n.data as WorkflowNodeData).kind === 'end');
  if (nodes.length > 0 && ends.length === 0) {
    issues.push({ id: null, kind: 'warning', message: 'No end node — workflow will hang.' });
  }

  for (const n of nodes) {
    const incoming = edges.filter((e) => e.target === n.id).length;
    const outgoing = edges.filter((e) => e.source === n.id).length;
    const kind = (n.data as WorkflowNodeData).kind;
    if (kind === 'trigger' && incoming > 0) {
      issues.push({ id: n.id, kind: 'error', message: `Trigger "${(n.data as { label?: string }).label}" should not have incoming edges.` });
    }
    if (kind === 'end' && outgoing > 0) {
      issues.push({ id: n.id, kind: 'error', message: `End "${(n.data as { label?: string }).label}" should not have outgoing edges.` });
    }
    if (kind !== 'trigger' && incoming === 0 && nodes.length > 1) {
      issues.push({ id: n.id, kind: 'warning', message: `"${(n.data as { label?: string }).label ?? n.id}" is disconnected (no incoming).` });
    }
  }

  return {
    errors: issues.filter((i) => i.kind === 'error').length,
    warnings: issues.filter((i) => i.kind === 'warning').length,
    issues,
  };
}

/* ---------------------------------------------------------------------------
 * Space palette (Cmd-K style popover)
 * --------------------------------------------------------------------------- */

import { NODE_CATEGORIES, PALETTE_ITEMS } from '../workflow-nodes';
import type { WorkflowNodeData as WND } from '@/lib/workflow/types';

function SpacePalette({ onClose, onPick }: { onClose: () => void; onPick: (kind: WND['kind'], label: string) => void }) {
  const [q, setQ] = React.useState('');
  const items = React.useMemo(() => {
    if (!q.trim()) return PALETTE_ITEMS;
    const lq = q.toLowerCase();
    return PALETTE_ITEMS.filter((p) => p.label.toLowerCase().includes(lq) || p.description.toLowerCase().includes(lq));
  }, [q]);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add node"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[12vh]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-[var(--shadow-lg)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-2">
          <Plus className="h-4 w-4 text-[var(--fg-tertiary)]" aria-hidden="true" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search nodes…"
            className="w-full bg-transparent text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-tertiary)] focus:outline-none"
          />
          <kbd className="rounded-[var(--radius-sm)] bg-[var(--bg-inset)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--fg-tertiary)]">Esc</kbd>
        </div>
        <ul role="list" className="max-h-80 overflow-y-auto p-2 thin-scrollbar">
          {items.length === 0 ? (
            <li className="p-4 text-center text-xs text-[var(--fg-tertiary)]">No nodes match “{q}”</li>
          ) : null}
          {items.map((p, i) => {
            const cat = NODE_CATEGORIES.find((c) => c.id === p.category);
            const Icon = p.icon;
            return (
              <li key={`${p.nodeKind}-${p.label}-${i}`}>
                <button
                  type="button"
                  onClick={() => onPick(p.nodeKind, p.label)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left hover:bg-[var(--bg-inset)]',
                  )}
                >
                  <span
                    className="inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--bg-inset)]"
                    style={{ color: `var(${cat?.accentVar ?? '--fg-muted'})` }}
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-[var(--fg-primary)]">{p.label}</span>
                    <span className="block truncate text-[10px] text-[var(--fg-tertiary)]">{p.description}</span>
                  </span>
                  <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">{cat?.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Default-data helper (shared between palette click + drop)
 * --------------------------------------------------------------------------- */

function makeDefaultFromKind(kind: WND['kind'], label: string): WND | null {
  const id = Math.random().toString(36).slice(2, 8);
  switch (kind) {
    case 'trigger': return { kind: 'trigger', label, triggerType: 'manual' } as unknown as WND;
    case 'command': return { kind: 'command', label, commandName: label.startsWith('forge-') ? label : `forge-${label.toLowerCase().replace(/\s+/g, '-')}` } as unknown as WND;
    case 'agent': return { kind: 'agent', label, agentId: `agent-${id}`, agentLabel: label } as unknown as WND;
    case 'llmPrompt': return { kind: 'llmPrompt', label, prompt: 'Write a helpful response.', model: 'claude-sonnet', temperature: 0.2 } as unknown as WND;
    case 'apiRequest': return { kind: 'apiRequest', label, method: 'POST', url: 'https://api.example.com', headersCount: 1, hasBody: true } as unknown as WND;
    case 'approval': return { kind: 'approval', label, approverIds: ['role:engineer'], timeoutHours: 24 } as unknown as WND;
    case 'condition': return { kind: 'condition', label, expression: 'value == "ok"' } as unknown as WND;
    case 'wait': return { kind: 'wait', label, durationSeconds: 300 } as unknown as WND;
    case 'end': return { kind: 'end', label, outcome: 'success' } as unknown as WND;
  }
  return null;
}