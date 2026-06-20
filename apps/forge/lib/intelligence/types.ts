/**
 * Typed-artifact contracts for the Project Intelligence center
 * (FORA-501, FORA-393 Plan 1 §3.4, Plan 4 §3.1 + §3.4).
 *
 * The Handoff Contract schema (workspace/memory/architecture.md §7) is
 * the authoritative source; these types are the renderer-side mirror
 * the FORA-501 surface consumes. Every shape is `readonly` end-to-end
 * and serialized as JSON over the wire — no `Date` or `Map`.
 *
 * Reconciles with:
 *   * Plan 1 §3.4 — Epic, Story, HandoffContract, RequirementBrief,
 *     DraftPrd are the five primary typed artifacts.
 *   * Plan 4 §3.1 — RequirementRenderer covers `requirement_brief.json`,
 *     `draft_prd.md`, OpenQuestion.
 *   * Plan 4 §3.4 — TaskRenderer covers the Paperclip issue shape used
 *     for Story.linkedTasks.
 *   * memory/architecture.md §7 — the Handoff Contract is the JSON
 *     envelope between stages.
 */

import type { Persona } from "../types";

/** The seven canonical stages from FORA-50 §3.2 (also Plan 1 §4). */
export type Stage =
  | "ideation"
  | "architect"
  | "dev"
  | "qa"
  | "security"
  | "devops"
  | "docs";

export const STAGES_IN_ORDER: ReadonlyArray<Stage> = [
  "ideation",
  "architect",
  "dev",
  "qa",
  "security",
  "devops",
  "docs",
];

/** The three stage tabs surfaced on the Project Intelligence page
 *  (Plan 1 §4 cross-reference matrix). Drill-down targets:
 *    dev → Development Center (Patch + ADR)
 *    qa → Testing Center (Test Report)
 *    devops → Deployment Center (Deployment Plan) */
export type DrillDownStage = "dev" | "qa" | "devops";

export const DRILL_DOWN_STAGES: ReadonlyArray<DrillDownStage> = [
  "dev",
  "qa",
  "devops",
];

/** Stable identifier shape used everywhere in the center. Mirrors the
 *  Paperclip `identifier` field (e.g. `FORA-501`). */
export type ProjectIntelligenceId = string;

/* ------------------------------------------------------------------ */
/* Epic                                                                */
/* ------------------------------------------------------------------ */

export type EpicStatus = "draft" | "active" | "at-risk" | "done" | "cancelled";

export interface Epic {
  readonly id: ProjectIntelligenceId;
  readonly identifier: string;
  readonly title: string;
  readonly status: EpicStatus;
  readonly owner: Persona;
  readonly subGoalList: ReadonlyArray<ProjectIntelligenceId>;
  readonly successMetric: string;
  readonly description: string;
  readonly storyIds: ReadonlyArray<ProjectIntelligenceId>;
  readonly requirementBriefId?: ProjectIntelligenceId;
  readonly draftPrdId?: ProjectIntelligenceId;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/* ------------------------------------------------------------------ */
/* Story                                                               */
/* ------------------------------------------------------------------ */

export type StoryStatus =
  | "backlog"
  | "ideation"
  | "dev"
  | "qa"
  | "security"
  | "devops"
  | "done"
  | "cancelled";

export type StoryPriority = "critical" | "high" | "medium" | "low";

export interface Story {
  readonly id: ProjectIntelligenceId;
  readonly identifier: string;
  readonly epicId: ProjectIntelligenceId;
  readonly title: string;
  readonly acceptanceCriteria: ReadonlyArray<string>;
  readonly status: StoryStatus;
  readonly priority: StoryPriority;
  readonly owner: Persona;
  readonly blockedBy: ReadonlyArray<ProjectIntelligenceId>;
  readonly blocks: ReadonlyArray<ProjectIntelligenceId>;
  readonly risk: string | null;
  readonly handoffContractIds: ReadonlyArray<ProjectIntelligenceId>;
  readonly runId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/* ------------------------------------------------------------------ */
/* Handoff Contract (memory/architecture.md §7)                        */
/* ------------------------------------------------------------------ */

/** A single step inside a handoff contract. Mirrors the §7 envelope. */
export interface HandoffStep {
  readonly fromStage: Stage;
  readonly toStage: Stage;
  readonly artefactRef: string;
  readonly sha256?: string;
}

/** The Handoff Contract JSON envelope between stages. The renderer is
 *  the typed boundary between the agent runtime's output and the
 *  customer's view (Plan 4 §10). */
export interface HandoffContract {
  readonly id: ProjectIntelligenceId;
  readonly storyId: ProjectIntelligenceId;
  readonly version: `${number}.${number}.${number}`;
  readonly fromStage: Stage;
  readonly toStage: Stage;
  readonly steps: ReadonlyArray<HandoffStep>;
  readonly inputSchemaRef: string;
  readonly outputSchemaRef: string;
  readonly exampleRef: string;
  readonly sla: {
    readonly p50Ms: number;
    readonly p99Ms: number;
    readonly maxRetries: number;
  };
  readonly createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Requirement Brief (schema_version "1.0")                           */
/* ------------------------------------------------------------------ */

/** The 11 canonical sections of a Requirement Brief. The schema is
 *  pinned to `schema_version: "1.0"`. The parser in `parser.ts` MUST
 *  preserve this version on round-trip (FORA-501 AC #2). */
export const REQUIREMENT_BRIEF_SECTIONS = [
  "mission",
  "core_vision",
  "product_positioning",
  "strategic_objective",
  "product_lines",
  "architecture_principles",
  "three_layer_architecture",
  "multi_tenant_model",
  "gsd_integration_strategy",
  "agent_runtime_framework",
  "core_ui_modules",
] as const;

export type RequirementBriefSectionKey = (typeof REQUIREMENT_BRIEF_SECTIONS)[number];

/** Each section in a brief. `body` is markdown; `openQuestions` is only
 *  populated for sections that own open questions (none in v1.0 by
 *  convention). */
export interface RequirementBriefSection {
  readonly key: RequirementBriefSectionKey;
  readonly title: string;
  readonly body: string;
  readonly openQuestions?: ReadonlyArray<OpenQuestion>;
}

/** An open question surfaced inside a requirement brief section. */
export interface OpenQuestion {
  readonly id: string;
  readonly prompt: string;
  readonly owner: Persona | null;
  readonly blocks: ReadonlyArray<ProjectIntelligenceId>;
  readonly dueBy: string | null;
}

export interface RequirementBrief {
  readonly id: ProjectIntelligenceId;
  readonly epicId: ProjectIntelligenceId;
  readonly title: string;
  /** Pinned to "1.0". Round-trip MUST preserve this exactly. */
  readonly schema_version: "1.0";
  readonly source: string;
  readonly sections: ReadonlyArray<RequirementBriefSection>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/* ------------------------------------------------------------------ */
/* Draft PRD (markdown, lint-passed)                                   */
/* ------------------------------------------------------------------ */

/** A draft PRD, lint-passed. The `DraftPrdView` renderer (in
 *  `components/intelligence/DraftPrdView.tsx`) MUST render every one
 *  of the 11 canonical sections (FORA-501 AC #1). The typed
 *  `sectionBodies` map is the renderer-side source of truth; the
 *  markdown is the lint-pass contract consumed by a separate tool. */
export interface DraftPrd {
  readonly id: ProjectIntelligenceId;
  readonly epicId: ProjectIntelligenceId;
  readonly title: string;
  /** Markdown for lint-pass contract; the renderer does NOT parse it. */
  readonly markdown: string;
  readonly lintPassed: boolean;
  /** Typed body per section, keyed by `RequirementBriefSectionKey`.
   *  The renderer iterates `REQUIREMENT_BRIEF_SECTIONS` and looks up
   *  the body here. */
  readonly sectionBodies: Readonly<
    Record<RequirementBriefSectionKey, string>
  >;
  readonly createdAt: string;
  readonly updatedAt: string;
}