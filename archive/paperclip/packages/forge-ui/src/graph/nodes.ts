/**
 * Node + edge types per canvas — FORA-393 Plan 2 §3.
 *
 * Each canvas has its own node family (KnowledgeFile, Component, Module,
 * AuditEntry, etc.). These are the typed shapes the four providers and the
 * four canvases share.
 */

import type { GraphFamily } from "./provider";

/** Common base — every node carries a stable id, family badge, and label. */
export interface BaseGraphNode {
  readonly id: string;
  readonly family: GraphFamily;
  readonly label: string;
  /** Short secondary line under the label. */
  readonly subtitle?: string;
  /** Optional pre-computed size in px; layout uses this when present. */
  readonly sizePx?: { readonly width: number; readonly height: number };
  /** When `true`, the node is collapsed in the graph and its children are hidden. */
  readonly collapsed?: boolean;
}

/** Common base — every edge has a kind that drives its style (Plan 2 §4.3). */
export interface BaseGraphEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  /** Relation kind — drives solid/dashed/animated style. */
  readonly kind: GraphEdgeKind;
  /** Optional human-readable annotation (rendered on hover). */
  readonly annotation?: string;
}

/**
 * Edge kind — Plan 2 §4.3:
 *  - solid = present-tense (`depends_on`, `injects_into`)
 *  - dashed = historical (`supersedes`, `followed_by`)
 *  - animated = live tail (Audit Timeline Graph only, on `followed_by`)
 */
export type GraphEdgeKind =
  | "references"
  | "defines"
  | "injects_into"
  | "supersedes"
  | "depends_on"
  | "implements"
  | "decided_by"
  | "handoff_to"
  | "imports"
  | "imports_external"
  | "owns"
  | "tested_by"
  | "performed_by"
  | "scoped_to"
  | "touches"
  | "followed_by";

/* ---------------------------------------------------------------------- *
 * Knowledge Graph (§3.1)
 * ---------------------------------------------------------------------- */

export type KnowledgeNodeKind =
  | "knowledge_file"
  | "glossary_entry"
  | "stage_injection";

export interface KnowledgeNode extends BaseGraphNode {
  readonly family: "knowledge";
  readonly kind: KnowledgeNodeKind;
  /** Folder the file lives in. Drives the color token. */
  readonly folder?: "memory" | "customer" | "project" | "reference";
  /** Stage name (for `stage_injection` nodes). */
  readonly stage?: string;
  /** Size hint for `glossary_entry` nodes — Plan 2 §3.1 "sized by usage count". */
  readonly usageCount?: number;
}

export type KnowledgeEdgeKind = Extract<
  GraphEdgeKind,
  "references" | "defines" | "injects_into" | "supersedes"
>;
export interface KnowledgeEdge extends BaseGraphEdge {
  readonly kind: KnowledgeEdgeKind;
}

/* ---------------------------------------------------------------------- *
 * Architecture Graph (§3.2)
 * ---------------------------------------------------------------------- */

export type ArchitectureNodeKind = "component" | "contract" | "adr" | "stage";

export interface ArchitectureNode extends BaseGraphNode {
  readonly family: "architecture";
  readonly kind: ArchitectureNodeKind;
  /** Component node — type discriminator. */
  readonly componentType?: "service" | "library" | "data-store" | "queue" | "agent";
  /** ADR node — status, mirrors the ADR shape. */
  readonly adrStatus?: "proposed" | "accepted" | "superseded" | "deprecated";
  /** ADR / contract version. */
  readonly version?: string;
}

export type ArchitectureEdgeKind = Extract<
  GraphEdgeKind,
  "depends_on" | "implements" | "decided_by" | "supersedes" | "handoff_to"
>;
export interface ArchitectureEdge extends BaseGraphEdge {
  readonly kind: ArchitectureEdgeKind;
}

/* ---------------------------------------------------------------------- *
 * Dependency Graph (§3.3)
 * ---------------------------------------------------------------------- */

export type DependencyNodeKind = "module" | "package" | "owner" | "cycle";

export interface DependencyNode extends BaseGraphNode {
  readonly family: "dependency";
  readonly kind: DependencyNodeKind;
  /** Module node — file path. */
  readonly modulePath?: string;
  /** Lines of code (size hint). */
  readonly loc?: number;
  /** Package node — name + version. */
  readonly packageName?: string;
  readonly packageVersion?: string;
}

export type DependencyEdgeKind = Extract<
  GraphEdgeKind,
  "imports" | "imports_external" | "owns" | "tested_by"
>;
export interface DependencyEdge extends BaseGraphEdge {
  readonly kind: DependencyEdgeKind;
  /** Aggregation count — when >1, the edge is an aggregated roll-up (Plan 2 §4.5). */
  readonly aggregatedCount?: number;
}

/* ---------------------------------------------------------------------- *
 * Audit Timeline Graph (§3.4)
 * ---------------------------------------------------------------------- */

export type AuditNodeKind = "audit_entry" | "actor" | "tenant" | "time_bucket";

export interface AuditNode extends BaseGraphNode {
  readonly family: "audit";
  readonly kind: AuditNodeKind;
  /** Audit entry — `tokens_in + tokens_out` drives the size. */
  readonly tokens?: { readonly prompt: number; readonly completion: number };
  /** Audit entry — stage. */
  readonly stage?: string;
  /** Time bucket — ISO start instant. */
  readonly bucketStart?: string;
  /** Time bucket — duration in ms. */
  readonly bucketMs?: number;
}

export type AuditEdgeKind = Extract<
  GraphEdgeKind,
  "performed_by" | "scoped_to" | "touches" | "followed_by"
>;
export interface AuditEdge extends BaseGraphEdge {
  readonly kind: AuditEdgeKind;
  /** When `true`, render the edge with the animated `followed_by` style. */
  readonly live?: boolean;
}
