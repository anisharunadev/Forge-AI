/**
 * Typed-artifact contracts — FORA-393 Plan 4 §3.
 * Each renderer consumes one of these shapes (or a subset). The Handoff
 * Contract (memory/architecture.md §7) is the authoritative source; these
 * types are the renderer-side mirror.
 */

export type RequirementStatus = "draft" | "review" | "accepted" | "out-of-scope";

export interface Requirement {
  readonly id: string;
  readonly title: string;
  readonly source?: string;
  readonly schemaVersion?: string;
  readonly sections: {
    problem?: string;
    targetUsers?: string;
    successMetrics?: string;
    outOfScope?: string;
    openQuestions?: ReadonlyArray<OpenQuestion>;
  };
  readonly status: RequirementStatus;
}

export interface OpenQuestion {
  readonly id: string;
  readonly prompt: string;
  readonly owner?: string;
  readonly blocks?: ReadonlyArray<string>;
  readonly dueBy?: string;
}

export interface Adr {
  readonly id: string;
  readonly number: string;
  readonly title: string;
  readonly status: "proposed" | "accepted" | "superseded" | "deprecated";
  readonly decisionDate?: string;
  readonly deciders?: ReadonlyArray<string>;
  readonly context?: string;
  readonly decision?: string;
  readonly consequences?: string;
  readonly supersedes?: ReadonlyArray<string>;
  readonly supersededBy?: ReadonlyArray<string>;
}

export interface TaskArtifact {
  readonly id: string;
  readonly identifier: string;
  readonly title: string;
  readonly status: string;
  readonly priority: "critical" | "high" | "medium" | "low";
  readonly owner?: { readonly displayName: string; readonly id: string };
  readonly blockedBy?: ReadonlyArray<string>;
  readonly blocks?: ReadonlyArray<string>;
  readonly stage?: string;
  readonly runId?: string;
  readonly lastActivityAt?: string;
}

export interface SecurityFinding {
  readonly id: string;
  readonly severity: "critical" | "high" | "medium" | "low" | "info";
  readonly title: string;
  readonly exploitPath?: string;
  readonly fixRecommendation?: string;
  readonly affectedModules?: ReadonlyArray<string>;
}

export interface SecurityReport {
  readonly id: string;
  readonly stage: string;
  readonly findings: ReadonlyArray<SecurityFinding>;
  readonly threatModelLink?: string;
  readonly secretsInventoryLink?: string;
}

export type RendererVariant = "card" | "panel" | "row" | "summary";

export interface BaseRendererProps<T> {
  readonly artifact: T;
  readonly variant?: RendererVariant;
  readonly className?: string;
}