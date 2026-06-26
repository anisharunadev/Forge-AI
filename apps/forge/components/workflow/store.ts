'use client';

/**
 * Zustand store for the workflow editor.
 *
 * Step-23 additions:
 *   - leftCollapsed / rightCollapsed (persisted to localStorage)
 *   - updateNodeData(id, partial) for autosave debounce
 *   - rightTab (independent of the full panel replacement)
 *   - isExecuting drive opens log tab via beginExecution
 */

import { create } from 'zustand';
import type { Edge, Node, NodeChange } from '@xyflow/react';
import {
  applyNodeChanges,
  applyEdgeChanges,
  type EdgeChange,
} from '@xyflow/react';

import type {
  NodeRunState,
  WorkflowDocument,
  WorkflowNodeData,
} from '@/lib/workflow/types';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export type SidebarPanel = 'settings' | 'inspector' | 'logs';

/** Step-23: tabs in the right rail — multiple can be open. */
export type RightTab = 'settings' | 'inspector' | 'logs';

export type LeftPanelTab = 'nodes' | 'templates' | 'runs';

const LS_KEY = 'forge.workflow.ui.v1';

interface PersistedUI {
  readonly leftCollapsed: boolean;
  readonly rightCollapsed: boolean;
  readonly rightOpenTabs: ReadonlyArray<RightTab>;
}

function loadPersistedUI(): PersistedUI {
  if (typeof window === 'undefined') {
    return { leftCollapsed: true, rightCollapsed: true, rightOpenTabs: ['settings'] };
  }
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return { leftCollapsed: true, rightCollapsed: true, rightOpenTabs: ['settings'] };
    const parsed = JSON.parse(raw) as Partial<PersistedUI>;
    return {
      leftCollapsed: parsed.leftCollapsed ?? true,
      rightCollapsed: parsed.rightCollapsed ?? true,
      rightOpenTabs:
        parsed.rightOpenTabs && parsed.rightOpenTabs.length > 0
          ? parsed.rightOpenTabs
          : ['settings'],
    };
  } catch {
    return { leftCollapsed: true, rightCollapsed: true, rightOpenTabs: ['settings'] };
  }
}

function persistUI(state: PersistedUI): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch {
    /* ignore quota / privacy mode */
  }
}

export interface WorkflowStoreState {
  readonly doc: WorkflowDocument;
  readonly nodes: Node<WorkflowNodeData & { runState?: NodeRunState['status']; error?: string }>[];
  readonly edges: Edge[];
  readonly selectedNodeId: string | null;
  readonly leftTab: LeftPanelTab;
  readonly rightPanel: SidebarPanel;
  readonly rightOpenTabs: ReadonlyArray<RightTab>;
  readonly leftCollapsed: boolean;
  readonly rightCollapsed: boolean;
  readonly saveStatus: SaveStatus;
  readonly lastSavedAt: number | null;
  readonly isExecuting: boolean;
  readonly executionStartedAt: number | null;
  readonly currentExecutingId: string | null;
  readonly runLog: ReadonlyArray<{ nodeId: string; message: string; at: number; status: NodeRunState['status'] }>;

  /* mutators */
  setNodes: (nodes: Node<WorkflowNodeData & { runState?: NodeRunState['status']; error?: string }>[]) => void;
  setEdges: (edges: Edge[]) => void;
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  setSelectedNode: (id: string | null) => void;
  setLeftTab: (tab: LeftPanelTab) => void;
  setRightPanel: (panel: SidebarPanel) => void;
  toggleRightTab: (tab: RightTab) => void;
  setLeftCollapsed: (collapsed: boolean) => void;
  setRightCollapsed: (collapsed: boolean) => void;
  setSaveStatus: (status: SaveStatus) => void;
  setDoc: (doc: Partial<WorkflowDocument>) => void;
  addNode: (node: Node<WorkflowNodeData>) => void;
  removeNode: (id: string) => void;
  updateNodeData: (id: string, partial: Partial<WorkflowNodeData>) => void;
  /* execution */
  setNodeRunState: (id: string, state: Partial<NodeRunState>) => void;
  beginExecution: () => void;
  endExecution: () => void;
  appendRunLog: (entry: { nodeId: string; message: string; status: NodeRunState['status'] }) => void;
  hydrateFromTemplate: (data: {
    nodes: ReadonlyArray<WorkflowNodeData & { position: { x: number; y: number } }>;
    edges: ReadonlyArray<{ id: string; source: string; target: string; label?: string }>;
    name: string;
    description: string;
  }) => void;
}

const DEFAULT_DOC: WorkflowDocument = {
  id: 'wf-untitled',
  name: 'Untitled workflow',
  description: 'Drag nodes from the left or pick a template to get started.',
  status: 'draft',
  tags: [],
  inputs: [],
  outputs: [],
  triggers: [{ kind: 'manual', detail: 'Run manually', enabled: true }],
  permissions: { scope: 'all' },
  versions: [
    { id: 'v1', label: 'v1', createdAt: new Date().toISOString(), createdBy: 'arun' },
  ],
};

export const useWorkflowStore = create<WorkflowStoreState>((set) => {
  const initial = loadPersistedUI();
  return {
    doc: DEFAULT_DOC,
    nodes: [],
    edges: [],
    selectedNodeId: null,
    leftTab: 'nodes',
    rightPanel: 'settings',
    rightOpenTabs: initial.rightOpenTabs,
    leftCollapsed: initial.leftCollapsed,
    rightCollapsed: initial.rightCollapsed,
    saveStatus: 'idle',
    lastSavedAt: null,
    isExecuting: false,
    executionStartedAt: null,
    currentExecutingId: null,
    runLog: [],

    setNodes: (nodes) => set({ nodes }),
    setEdges: (edges) => set({ edges }),

    onNodesChange: (changes) =>
      set((s) => ({
        nodes: applyNodeChanges(changes, s.nodes) as WorkflowStoreState['nodes'],
      })),

    onEdgesChange: (changes) =>
      set((s) => ({
        edges: applyEdgeChanges(changes, s.edges),
      })),

    setSelectedNode: (id) =>
      set((s) => ({
        selectedNodeId: id,
        rightPanel: id ? 'inspector' : 'settings',
        rightOpenTabs: id
          ? s.rightOpenTabs.includes('inspector')
            ? s.rightOpenTabs
            : [...s.rightOpenTabs.filter((t) => t !== 'settings'), 'inspector']
          : s.rightOpenTabs,
      })),

    setLeftTab: (tab) => set({ leftTab: tab }),
    setRightPanel: (panel) => set({ rightPanel: panel }),

    toggleRightTab: (tab) =>
      set((s) => {
        const next = s.rightOpenTabs.includes(tab)
          ? s.rightOpenTabs.filter((t) => t !== tab)
          : [...s.rightOpenTabs, tab];
        const persisted: PersistedUI = {
          leftCollapsed: s.leftCollapsed,
          rightCollapsed: s.rightCollapsed,
          rightOpenTabs: next.length > 0 ? next : ['settings'],
        };
        persistUI(persisted);
        return {
          rightOpenTabs: persisted.rightOpenTabs,
          rightPanel: next.includes('inspector') ? 'inspector' : next.includes('logs') ? 'logs' : 'settings',
        };
      }),

    setLeftCollapsed: (collapsed) =>
      set((s) => {
        const persisted: PersistedUI = {
          leftCollapsed: collapsed,
          rightCollapsed: s.rightCollapsed,
          rightOpenTabs: s.rightOpenTabs,
        };
        persistUI(persisted);
        return { leftCollapsed: collapsed };
      }),

    setRightCollapsed: (collapsed) =>
      set((s) => {
        const persisted: PersistedUI = {
          leftCollapsed: s.leftCollapsed,
          rightCollapsed: collapsed,
          rightOpenTabs: s.rightOpenTabs,
        };
        persistUI(persisted);
        return { rightCollapsed: collapsed };
      }),

    setSaveStatus: (status) =>
      set((s) => ({
        saveStatus: status,
        lastSavedAt: status === 'saved' ? Date.now() : s.lastSavedAt,
      })),

    setDoc: (partial) => set((s) => ({ doc: { ...s.doc, ...partial } })),

    addNode: (node) =>
      set((s) => ({
        nodes: [...s.nodes, node],
        selectedNodeId: node.id,
        rightPanel: 'inspector',
        rightOpenTabs: s.rightOpenTabs.includes('inspector')
          ? s.rightOpenTabs
          : [...s.rightOpenTabs.filter((t) => t !== 'settings'), 'inspector'],
      })),

    removeNode: (id) =>
      set((s) => ({
        nodes: s.nodes.filter((n) => n.id !== id),
        edges: s.edges.filter((e) => e.source !== id && e.target !== id),
        selectedNodeId: s.selectedNodeId === id ? null : s.selectedNodeId,
        rightPanel: s.selectedNodeId === id ? 'settings' : s.rightPanel,
      })),

    updateNodeData: (id, partial) =>
      set((s) => ({
        nodes: s.nodes.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, ...partial } as typeof n.data } : n,
        ),
      })),

    setNodeRunState: (id, partial) =>
      set((s) => ({
        nodes: s.nodes.map((n) =>
          n.id === id
            ? {
                ...n,
                data: {
                  ...n.data,
                  runState: partial.status ?? n.data.runState,
                  ...(partial.durationMs !== undefined ? { durationMs: partial.durationMs } : {}),
                  ...(partial.error !== undefined ? { error: partial.error } : {}),
                },
              }
            : n,
        ),
        currentExecutingId: partial.status === 'running' ? id : s.currentExecutingId === id ? null : s.currentExecutingId,
      })),

    beginExecution: () =>
      set((s) => ({
        isExecuting: true,
        executionStartedAt: Date.now(),
        rightPanel: 'logs',
        rightOpenTabs: s.rightOpenTabs.includes('logs') ? s.rightOpenTabs : [...s.rightOpenTabs, 'logs'],
        runLog: [],
      })),

    endExecution: () =>
      set({
        isExecuting: false,
        currentExecutingId: null,
      }),

    appendRunLog: (entry) =>
      set((s) => ({
        runLog: [...s.runLog, { ...entry, at: Date.now() }],
      })),

    hydrateFromTemplate: ({ nodes: tNodes, edges: tEdges, name, description }) =>
      set((s) => {
        const newNodes: WorkflowStoreState['nodes'] = tNodes.map((n, i) => ({
          id: `${name.toLowerCase().replace(/\s+/g, '-')}-${i}`,
          type: n.kind,
          position: n.position,
          data: { ...n, runState: 'idle' as const },
        }));
        const newEdges: Edge[] = tEdges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          ...(e.label !== undefined ? { label: e.label } : {}),
        }));
        return {
          nodes: newNodes,
          edges: newEdges,
          doc: { ...s.doc, name, description, status: 'draft' },
          selectedNodeId: null,
          rightPanel: 'settings',
          rightOpenTabs: s.rightOpenTabs.includes('settings') ? s.rightOpenTabs : [...s.rightOpenTabs, 'settings'],
          saveStatus: 'saved',
          lastSavedAt: Date.now(),
        };
      }),
  };
});