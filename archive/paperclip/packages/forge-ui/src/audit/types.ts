/**
 * Audit Center typed artifacts — FORA-393 Plan 1 §3.12 + Plan 4 §3.9.
 *
 * `AuditQuery` and `SavedAuditQuery` are the renderer-side mirror of the audit
 * query shapes the runtime will eventually persist server-side. The renderer
 * side owns only the shape + storage contract; the runtime (Audit Spine /
 * FORA-399) is the source of truth for the eventual API contract.
 *
 * All shapes are `readonly` so a consumer cannot mutate a typed artifact
 * through its DOM contract — same invariant as the other renderer-side
 * mirrors (`AuditEntry`, `Connector`, etc.).
 */

import type { AuditEntry, AuditActorKind } from "../typed-artifacts/types";

/** ISO 8601 timestamp string (e.g. `2026-06-20T12:00:00.000Z`). */
export type IsoTimestamp = string;

/**
 * AuditQuery — typed artifact for an audit-log filter.
 *
 * Each axis is nullable. A null axis = "no filter on this axis." The empty
 * query (`{}`) matches every audit entry within the tenant scope enforced by
 * the tenant-scoped fetcher; the cross-tenant isolation guarantee lives in
 * {@link tenantScopedAuditFetcher}, not here.
 */
export interface AuditQuery {
  /** Free-text search across tool name + query hash + response hash. */
  readonly text?: string;
  /** Restrict to these stages (e.g. `ideation`, `architect`, `dev`). */
  readonly stages?: ReadonlyArray<string>;
  /** Restrict to these tool names. */
  readonly tools?: ReadonlyArray<string>;
  /** Restrict to these actor kinds. */
  readonly actorKinds?: ReadonlyArray<AuditActorKind>;
  /** Restrict to these specific actor ids. */
  readonly actorIds?: ReadonlyArray<string>;
  /** Inclusive start of the time window. */
  readonly since?: IsoTimestamp;
  /** Exclusive end of the time window. */
  readonly until?: IsoTimestamp;
  /** Lower bound on `costUsd` — Plan 1 §3.12 `cost_usd > X` filter. */
  readonly minCostUsd?: number;
  /** Pin a specific tenant. The tenant-scoped fetcher rejects cross-tenant. */
  readonly tenantId?: string;
}

/**
 * SavedAuditQuery — a query the user has pinned, plus a stable id, label,
 * and the user-local creation timestamp. The share-link path on the runtime
 * is a v1.1 follow-up; the renderer-side shape is forward-compatible.
 */
export interface SavedAuditQuery {
  readonly id: string;
  readonly label: string;
  readonly query: AuditQuery;
  /** Per-user creation timestamp — when the user saved this query. */
  readonly createdAt: IsoTimestamp;
  /** Optional share-link target (v1.1). */
  readonly shareLink?: string;
}

/** A audit entry that has been narrowed by a query. */
export interface FilteredAuditEntry {
  readonly entry: AuditEntry;
  /** True iff this entry matches every non-null axis of the query. */
  readonly matches: boolean;
}

/** Pinned filter — set when the user clicks an actor/tenant in the timeline. */
export interface PinnedAuditFilter {
  readonly kind: "actor" | "tenant";
  readonly id: string;
  readonly label?: string;
}
