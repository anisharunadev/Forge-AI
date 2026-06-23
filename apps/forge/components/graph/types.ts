/**
 * Typed data shapes for graph node components (Phase 0.5-06).
 *
 * The five node components in `components/graph/` consume these
 * shapes via React Flow's `Node<TData>` generic. Status fields use
 * the canonical enums from `lib/design-system/forge-color-tokens.ts`
 * so tone + glyph + pulse all derive from one source of truth.
 *
 * Per the curated spec (Phase 0.5 amendment, 2026-06-23) §6: nodes
 * carry color + glyph + label together; color is never the only signal.
 */

import type {
  AgentState,
  KGNodeState,
  RunState,
} from '@/lib/design-system/forge-color-tokens';

/** Knowledge graph artifact (ADR, Idea, Risk, Task, Test, etc.). */
export interface NodeArtifactData {
  readonly kind: 'artifact';
  readonly label: string;
  readonly artifactKind: string;
  readonly status: KGNodeState;
  readonly updatedAt: string;
}

/** Single file inside a repository. */
export interface NodeRepoFileData {
  readonly kind: 'repoFile';
  readonly label: string;
  readonly path: string;
  readonly language: string;
  readonly loc?: number;
}

/** Service or datastore in the dependency graph. */
export interface NodeServiceData {
  readonly kind: 'service';
  readonly label: string;
  readonly serviceKind: 'service' | 'datastore' | 'component' | 'external';
  readonly status: 'healthy' | 'degraded' | 'down' | 'idle';
  readonly region?: string;
}

/** A single step inside an agent execution trace. */
export interface NodeAgentStepData {
  readonly kind: 'agentStep';
  readonly label: string;
  readonly agent: string;
  readonly state: AgentState;
  readonly durationMs?: number;
}

/** An approval workflow gate (Architecture / Security / Deployment). */
export interface NodeApprovalData {
  readonly kind: 'approval';
  readonly label: string;
  readonly phase: string;
  readonly runState: RunState;
  readonly requestedBy: string;
}

/** Discriminated union of all graph node data shapes. */
export type GraphNodeData =
  | NodeArtifactData
  | NodeRepoFileData
  | NodeServiceData
  | NodeAgentStepData
  | NodeApprovalData;
