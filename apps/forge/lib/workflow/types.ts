/**
 * Workflow domain types — shared between the canvas, the template
 * gallery, the execution log, and the Zustand store.
 *
 * Per the brief (docs/goals/step-22.md) the page has two modes:
 *   - Mode A: Template Gallery (default landing)
 *   - Mode B: Workflow Canvas (the React Flow editor)
 *
 * The 9 node variants share a single `nodeKind` discriminator so the
 * nodeTypes map can branch on it without a string union escape hatch.
 */

import type { LucideIcon } from 'lucide-react';

/* ===========================================================================
 * Node taxonomy
 * =========================================================================== */

export type WorkflowNodeKind =
  | 'trigger'
  | 'command'
  | 'agent'
  | 'llmPrompt'
  | 'apiRequest'
  | 'approval'
  | 'condition'
  | 'wait'
  | 'end';

export type NodeCategory =
  | 'triggers'
  | 'commands'
  | 'ai'
  | 'logic'
  | 'integrations'
  | 'human'
  | 'flow';

export interface NodeCategorySpec {
  readonly id: NodeCategory;
  readonly label: string;
  /** Tailwind/CSS-variable color key — picked up by both the palette and the node body. */
  readonly accentVar: string;
  readonly order: number;
}

/* ===========================================================================
 * Palette item — the entries in the left Nodes sidebar
 * =========================================================================== */

export interface PaletteItem {
  readonly nodeKind: WorkflowNodeKind;
  readonly label: string;
  readonly description: string;
  readonly icon: LucideIcon;
  readonly category: NodeCategory;
}

/* ===========================================================================
 * Node data — what each custom node renders
 * =========================================================================== */

/** WorkflowNodeData — all variants share a string index signature so
 * they satisfy `Record<string, unknown>` (required by React Flow's
 * `Node<TData>` constraint). */
export type WorkflowNodeData =
  | ({ readonly kind: 'trigger'; readonly triggerType: 'manual' | 'webhook' | 'schedule' | 'event'; readonly triggerDetail?: string; readonly label: string; readonly subtitle?: string; readonly summary?: string; readonly disabled?: boolean } & Record<string, unknown>)
  | ({ readonly kind: 'command'; readonly commandName: string; readonly commandLabel?: string; readonly inputs?: ReadonlyArray<{ name: string; value: string }>; readonly label: string; readonly subtitle?: string; readonly summary?: string; readonly disabled?: boolean } & Record<string, unknown>)
  | ({ readonly kind: 'agent'; readonly agentId: string; readonly agentLabel: string; readonly taskDescription?: string; readonly label: string; readonly subtitle?: string; readonly summary?: string; readonly disabled?: boolean } & Record<string, unknown>)
  | ({ readonly kind: 'llmPrompt'; readonly prompt: string; readonly model?: string; readonly temperature?: number; readonly maxTokens?: number; readonly label: string; readonly subtitle?: string; readonly summary?: string; readonly disabled?: boolean } & Record<string, unknown>)
  | ({ readonly kind: 'apiRequest'; readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; readonly url: string; readonly headersCount?: number; readonly hasBody?: boolean; readonly label: string; readonly subtitle?: string; readonly summary?: string; readonly disabled?: boolean } & Record<string, unknown>)
  | ({ readonly kind: 'approval'; readonly approverIds: ReadonlyArray<string>; readonly timeoutHours: number; readonly criteria?: string; readonly label: string; readonly subtitle?: string; readonly summary?: string; readonly disabled?: boolean } & Record<string, unknown>)
  | ({ readonly kind: 'condition'; readonly expression: string; readonly label: string; readonly subtitle?: string; readonly summary?: string; readonly disabled?: boolean } & Record<string, unknown>)
  | ({ readonly kind: 'wait'; readonly durationSeconds: number; readonly label: string; readonly subtitle?: string; readonly summary?: string; readonly disabled?: boolean } & Record<string, unknown>)
  | ({ readonly kind: 'end'; readonly outcome: 'success' | 'failure' | 'always'; readonly label: string; readonly subtitle?: string; readonly summary?: string; readonly disabled?: boolean } & Record<string, unknown>);

/** Per-variant aliases for ergonomics. */
export type TriggerNodeData = Extract<WorkflowNodeData, { kind: 'trigger' }>;
export type CommandNodeData = Extract<WorkflowNodeData, { kind: 'command' }>;
export type AgentNodeData = Extract<WorkflowNodeData, { kind: 'agent' }>;
export type LLMPromptNodeData = Extract<WorkflowNodeData, { kind: 'llmPrompt' }>;
export type APIRequestNodeData = Extract<WorkflowNodeData, { kind: 'apiRequest' }>;
export type ApprovalNodeData = Extract<WorkflowNodeData, { kind: 'approval' }>;
export type ConditionNodeData = Extract<WorkflowNodeData, { kind: 'condition' }>;
export type WaitNodeData = Extract<WorkflowNodeData, { kind: 'wait' }>;
export type EndNodeData = Extract<WorkflowNodeData, { kind: 'end' }>;

/* ===========================================================================
 * Execution status — overlaid on every node during a run
 * =========================================================================== */

export type NodeRunStatus =
  | 'idle'
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'skipped'
  | 'waiting';

export interface NodeRunState {
  readonly status: NodeRunStatus;
  readonly durationMs?: number;
  readonly error?: string;
  readonly log?: string;
}

/* ===========================================================================
 * Workflow document
 * =========================================================================== */

export type WorkflowStatus = 'draft' | 'published' | 'archived';

export interface WorkflowDocument {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly status: WorkflowStatus;
  readonly tags: ReadonlyArray<string>;
  readonly category?: string;
  readonly inputs: ReadonlyArray<WorkflowInput>;
  readonly outputs: ReadonlyArray<WorkflowOutput>;
  readonly triggers: ReadonlyArray<WorkflowTrigger>;
  readonly permissions: WorkflowPermissions;
  readonly versions: ReadonlyArray<WorkflowVersion>;
}

export interface WorkflowInput {
  readonly name: string;
  readonly type: 'string' | 'number' | 'boolean' | 'json';
  readonly defaultValue?: string;
  readonly required: boolean;
}

export interface WorkflowOutput {
  readonly name: string;
  readonly type: 'string' | 'number' | 'boolean' | 'json';
}

export interface WorkflowTrigger {
  readonly kind: 'manual' | 'webhook' | 'schedule' | 'event';
  readonly detail: string;
  readonly enabled: boolean;
}

export interface WorkflowPermissions {
  readonly scope: 'all' | 'roles' | 'users';
  readonly roles?: ReadonlyArray<string>;
  readonly userIds?: ReadonlyArray<string>;
}

export interface WorkflowVersion {
  readonly id: string;
  readonly label: string;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly notes?: string;
}

/* ===========================================================================
 * Template definition — what powers Mode A (the gallery)
 * =========================================================================== */

export interface WorkflowTemplate {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: string;
  readonly icon: LucideIcon;
  /** CSS var name (e.g. "--accent-indigo"). Used to tint the card icon. */
  readonly colorVar: string;
  readonly nodes: ReadonlyArray<WorkflowNodeData & { readonly position: { readonly x: number; readonly y: number } }>;
  readonly edges: ReadonlyArray<{ readonly id: string; readonly source: string; readonly target: string; readonly label?: string }>;
  readonly tags: ReadonlyArray<string>;
}

/* ===========================================================================
 * User workflow — a workflow the user has saved (or is editing)
 * =========================================================================== */

export interface UserWorkflow {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly status: WorkflowStatus;
  readonly updatedAt: string;
  readonly runCount: number;
  readonly lastRunStatus?: NodeRunStatus;
  readonly ownerId: string;
  readonly ownerName: string;
  readonly ownerAvatar?: string;
  readonly nodes: number;
}

/* ===========================================================================
 * Run history (sidebar "Runs" tab + execution log)
 * =========================================================================== */

export interface WorkflowRunRecord {
  readonly id: string;
  readonly workflowId: string;
  readonly status: NodeRunStatus;
  readonly startedAt: string;
  readonly durationMs?: number;
  readonly stepCount: number;
  readonly triggeredBy: string;
  readonly steps?: ReadonlyArray<WorkflowRunStep>;
}

export interface WorkflowRunStep {
  readonly nodeId: string;
  readonly nodeLabel: string;
  readonly status: NodeRunStatus;
  readonly startedAt: string;
  readonly durationMs?: number;
  readonly message: string;
}

/* ===========================================================================
 * KPI tile — the 4 numbers on top of the gallery
 * =========================================================================== */

export interface WorkflowKPI {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly delta?: string;
  readonly trend?: 'up' | 'down' | 'flat';
  readonly sparkline?: ReadonlyArray<number>;
  readonly accent: 'indigo' | 'cyan' | 'amber' | 'emerald';
}