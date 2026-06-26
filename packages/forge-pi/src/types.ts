/**
 * Shared types for @forge-ai/forge-pi.
 *
 * Every type that crosses the package boundary carries tenant_id and
 * project_id (Forge Rule 2 — Multi-Tenancy by Default). No optional.
 */

/** Minimum context every forge-pi call needs. */
export interface TenantScopedContext {
  tenant_id: string;
  project_id: string;
  /** Optional user attribution for auditability (Forge Rule 6). */
  user_id?: string;
}

/** A service discovered by the codebase scanner. */
export interface ScannedService {
  id: string;
  name: string;
  language: string;
  path: string;
  dependencies: string[];
  entrypoints: string[];
  /** Detected secrets count (FORA-484 — never the secret values themselves). */
  detected_secrets: number;
  /** Last commit SHA-7 used for cache invalidation. */
  commit_sha: string;
}

/** Aggregate result of a codebase scan. */
export interface CodebaseScanResult extends TenantScopedContext {
  scan_id: string;
  started_at: string;
  completed_at: string;
  services: ScannedService[];
  /** Total LOC across all services (rounded). */
  total_loc: number;
  /** Detector health — e.g. { secrets: 'ok', deps: 'ok' }. */
  detector_health: Record<string, 'ok' | 'degraded' | 'failed'>;
}

/** A node in the Forge knowledge graph. */
export type KnowledgeGraphNodeKind =
  | 'service'
  | 'module'
  | 'ticket'
  | 'doc'
  | 'adr'
  | 'persona'
  | 'connector';

export interface KnowledgeGraphNode extends TenantScopedContext {
  id: string;
  kind: KnowledgeGraphNodeKind;
  label: string;
  /** Free-form attributes that depend on `kind`. */
  attrs: Record<string, string | number | boolean>;
  /** Source URL or path for traceability. */
  source: string;
}

export interface KnowledgeGraphEdge extends TenantScopedContext {
  from: string;
  to: string;
  /** e.g. 'depends_on', 'owns', 'references', 'clusters_with'. */
  relation: string;
  weight: number;
}

export interface KnowledgeGraph extends TenantScopedContext {
  graph_id: string;
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
  built_at: string;
}

export interface ScanOptions {
  /** Limit to a sub-tree — defaults to the whole repo. */
  paths?: string[];
  /** Detectors to skip (defaults to all enabled). */
  skip_detectors?: Array<'services' | 'deps' | 'secrets' | 'tests'>;
  /** Reuse a cached scan if younger than this many seconds. */
  cache_max_age_seconds?: number;
}

/** Output of the idea scorer (RAG + chain-of-thought). */
export interface IdeaScoreReasoning {
  step: string;
  evidence: string;
  confidence: number;
}

export interface IdeaScore extends TenantScopedContext {
  idea_id: string;
  /** 0..100 — calibrated probability the idea is worth building. */
  score: number;
  /** CoT trace — at least one step per evidence source (Forge Rule 6). */
  reasoning: IdeaScoreReasoning[];
  /** 1-line verdict for the Ideation Center UI. */
  verdict: 'strong-build' | 'consider' | 'revisit' | 'deprioritize';
}

/** A cluster of customer feedback tickets (Customer Voice). */
export interface CustomerCluster extends TenantScopedContext {
  cluster_id: string;
  theme: string;
  /** Tickets in this cluster. */
  ticket_ids: string[];
  /** Centroid summary — 1 sentence a human can read. */
  summary: string;
  /** Aggregated severity — 0..10. */
  severity: number;
  /** Optional links back to the codebase. */
  related_services: string[];
}

/** A market signal extracted from a configured source. */
export interface MarketSignal extends TenantScopedContext {
  signal_id: string;
  source: string;
  title: string;
  url: string;
  /** Why this signal matters for the current product. */
  relevance: string;
  /** 0..100. */
  impact: number;
  captured_at: string;
}

/** Typed PRD draft — Rule 4 (Typed Artifacts Only). */
export interface PrdDraft extends TenantScopedContext {
  draft_id: string;
  title: string;
  problem: string;
  proposed_solution: string;
  success_metrics: string[];
  /** Linkage back to the originating input. */
  originated_from:
    | { kind: 'idea'; idea_id: string }
    | { kind: 'cluster'; cluster_id: string }
    | { kind: 'signal'; signal_id: string };
  draft_status: 'draft' | 'review' | 'approved' | 'rejected';
  created_at: string;
}