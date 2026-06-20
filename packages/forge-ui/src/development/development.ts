/**
 * Development Center typed-artifact surface — FORA-393 Plan 1 §3.7.
 *
 * Per the parallel-center-shipping-recipe (FORA-507 memory entry), this
 * file is the per-center type surface, separated from the shared
 * `./types` so the Development Center slice ships independently of the
 * Audit + Governance + Knowledge slices that also touch the shared
 * `typed-artifacts` table.
 *
 * Reconciles with:
 *   - Plan 1 §3.7 (Development Center scope)
 *   - Plan 2 §3.2 (Architecture Graph) + §3.3 (Dependency Graph)
 *   - Plan 4 §3.2 (AdrRenderer) + §3.4 (TaskRenderer) + §3.5 (PatchRenderer)
 *   - FORA-503 acceptance criteria
 */

/** Mirror of the registry row shape in `workspace/project/adr-registry.md`. */
export interface AdrRegistryEntry {
  readonly number: string;
  readonly title: string;
  readonly path: string;
  readonly status: "proposed" | "accepted" | "superseded" | "deprecated";
  readonly date: string;
  readonly architectureArea: string;
  readonly tags?: ReadonlyArray<string>;
  readonly supersedes?: string;
  readonly supersededBy?: string;
}

/** PR review record — distinct from `TaskArtifact` (the issue) and `Patch` (the diff). */
export interface PrReviewRecord {
  readonly id: string;
  readonly prNumber: string;
  readonly url: string;
  readonly title: string;
  readonly author: { readonly displayName: string; readonly id: string };
  readonly state: "open" | "merged" | "closed" | "draft";
  readonly reviewState: "pending" | "approved" | "changes-requested" | "commented";
  readonly linesAdded: number;
  readonly linesDeleted: number;
  readonly filesChanged: number;
  readonly updatedAt: string;
  /** Story the PR is for. */
  readonly storyId?: string;
  /** Linked patch id (PatchRenderer `artifact.id`). */
  readonly patchId?: string;
}

/**
 * Development filter — the per-axis narrowing the composer applies. Mirrors
 * the audit query pattern: nullable axes, empty arrays = "match nothing",
 * absent fields = "no filter on this axis". The empty object `{}` is the
 * "show everything in scope" state.
 */
export interface DevelopmentFilter {
  /** Restrict to these ADR statuses (proposed/accepted/superseded/deprecated). */
  readonly adrStatuses?: ReadonlyArray<AdrRegistryEntry["status"]>;
  /** Restrict to these owner ids (Dependency Graph filter axis). */
  readonly ownerIds?: ReadonlyArray<string>;
  /** Restrict to these package names (Dependency Graph `imports_external`). */
  readonly packageNames?: ReadonlyArray<string>;
  /** Restrict to nodes WITHOUT tests when `true`. Mirrors Plan 2 §3.3. */
  readonly noTestsOnly?: boolean;
  /** Free-text search across ADR titles, PR titles, patch summaries. */
  readonly text?: string;
}

/** Result of the pure blast-radius computation. */
export interface BlastRadiusResult {
  /** The starting module(s) the user picked. */
  readonly sources: ReadonlyArray<string>;
  /** All modules transitively reachable via `imports` edges. */
  readonly reachable: ReadonlyArray<string>;
  /** Edges traversed (subset of the input edges). */
  readonly traversedEdges: ReadonlyArray<{ readonly from: string; readonly to: string }>;
}

/** Cycle entry — mirrors the analyzer's `cycles.json` shape. */
export interface DependencyCycle {
  readonly id: string;
  /** Module ids that form the cycle, in traversal order. */
  readonly modules: ReadonlyArray<string>;
  /** Why the cycle is bad — analyzer's `reason` field. */
  readonly reason?: string;
}

/** Show-in-graph affordance target — drives the architecture/dependency jump. */
export type GraphTarget =
  | { readonly canvas: "architecture"; readonly nodeId: string }
  | { readonly canvas: "dependency"; readonly nodeId: string };

/** Compact + detail variants on the ADR list. */
export type AdrListVariant = "compact" | "detail";
