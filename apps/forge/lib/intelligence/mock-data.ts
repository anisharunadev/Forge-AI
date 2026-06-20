/**
 * FORA-501 typed mock data for the Project Intelligence center.
 *
 * This is the seam the Project Intelligence pages read from. When the
 * PM-facing typed-artifact browser grows to read from the real
 * orchestrator / Forge KB, swap this module for an async loader that
 * issues the same typed shape; the pages and the TypedTable consumers
 * stay untouched.
 *
 * Source of truth:
 *   * Plan 1 §3.4 — Epic, Story, HandoffContract, RequirementBrief,
 *     DraftPrd are the five primary typed artifacts surfaced here.
 *   * workspace/project/PRD.md — the canonical 11-section PRD body for
 *     `DraftPrd`. Section keys follow the RequirementBriefSectionKey
 *     enum pinned at `lib/intelligence/types.ts`.
 *   * memory/architecture.md §7 — Handoff Contract envelope shape.
 */

import {
  REQUIREMENT_BRIEF_SECTIONS,
  type DraftPrd,
  type Epic,
  type HandoffContract,
  type RequirementBrief,
  type RequirementBriefSection,
  type RequirementBriefSectionKey,
  type Story,
} from "./types";

export const SEED_TENANT_ID = "acme-corp";

/* ------------------------------------------------------------------ */
/* Epics (3)                                                           */
/* ------------------------------------------------------------------ */

export const EPICS: ReadonlyArray<Epic> = [
  {
    id: "epic-forge-393",
    identifier: "FORA-393",
    title: "UI / Visualization Spine (Next.js 15 + React Flow)",
    status: "active",
    owner: "pm",
    subGoalList: ["goal-forge-ui-spine"],
    successMetric:
      "All 8 v1.0 centers ship with the typed-artifact renderers and TypedTable baseline.",
    description:
      "The Forge UI typed-artifact browser on top of the Master Orchestrator's Handoff Contract. Ships 13 centers; v1.0 GA ships the first 8.",
    storyIds: ["story-forge-393-1", "story-forge-393-2", "story-forge-393-3"],
    requirementBriefId: "rb-forge-393",
    draftPrdId: "prd-forge-393",
    createdAt: "2026-06-12T10:00:00Z",
    updatedAt: "2026-06-20T05:30:00Z",
  },
  {
    id: "epic-forge-501",
    identifier: "FORA-501",
    title: "Project Intelligence Center (v1.0 GA)",
    status: "active",
    owner: "pm",
    subGoalList: ["goal-forge-ui-spine"],
    successMetric:
      "PM can manage an Epic end-to-end from the Project Intelligence surface.",
    description:
      "The PM-facing typed-artifact browser for every Epic, every Story, every active run, every open question.",
    storyIds: [
      "story-forge-501-list",
      "story-forge-501-brief",
      "story-forge-501-tabs",
    ],
    requirementBriefId: "rb-forge-501",
    draftPrdId: "prd-forge-501",
    createdAt: "2026-06-19T20:00:00Z",
    updatedAt: "2026-06-20T17:46:00Z",
  },
  {
    id: "epic-forge-578",
    identifier: "FORA-578",
    title: "Connector Center list page (shipped)",
    status: "done",
    owner: "eng-lead",
    subGoalList: ["goal-forge-ui-spine"],
    successMetric:
      "Eng Lead and CTO can audit every MCP integration for the tenant.",
    description:
      "Operator view of every MCP integration Forge uses. Tier-1 + Tier-2 connectors with redacted credentials (FORA-128).",
    storyIds: ["story-forge-578-list"],
    requirementBriefId: "rb-forge-578",
    createdAt: "2026-06-18T10:00:00Z",
    updatedAt: "2026-06-20T17:40:00Z",
  },
];

/* ------------------------------------------------------------------ */
/* Stories (7) — distributed across the 3 stage tabs                  */
/* ------------------------------------------------------------------ */

export const STORIES: ReadonlyArray<Story> = [
  // FORA-393 children
  {
    id: "story-forge-393-1",
    identifier: "FORA-488",
    epicId: "epic-forge-393",
    title: "@fora/forge-ui package skeleton + design tokens + Shadcn primitives",
    acceptanceCriteria: [
      "Package layout matches Plan 4 §2.",
      "All Shadcn primitives render with Plan 3 tokens.",
    ],
    status: "done",
    priority: "high",
    owner: "eng-lead",
    blockedBy: [],
    blocks: ["story-forge-393-2"],
    risk: null,
    handoffContractIds: ["hc-forge-488-509"],
    createdAt: "2026-06-15T10:00:00Z",
    updatedAt: "2026-06-17T20:00:00Z",
  },
  {
    id: "story-forge-393-2",
    identifier: "FORA-508",
    epicId: "epic-forge-393",
    title:
      "Typed graph provider + four React Flow canvases (Knowledge, Architecture, Dependency, Audit Timeline)",
    acceptanceCriteria: [
      "All four canvases render a non-empty fixture.",
      "Nodes are typed (no `any`).",
    ],
    status: "done",
    priority: "high",
    owner: "eng-lead",
    blockedBy: ["story-forge-393-1"],
    blocks: ["story-forge-393-3", "story-forge-501-list"],
    risk: null,
    handoffContractIds: ["hc-forge-508-509"],
    createdAt: "2026-06-15T10:00:00Z",
    updatedAt: "2026-06-18T20:00:00Z",
  },
  {
    id: "story-forge-393-3",
    identifier: "FORA-509",
    epicId: "epic-forge-393",
    title:
      "Ten typed-artifact renderers + shell + charts/trees/tables/forms",
    acceptanceCriteria: [
      "All 10 renderers ship with vitest coverage.",
      "Shell renders the persona switcher + theme switcher.",
    ],
    status: "done",
    priority: "high",
    owner: "eng-lead",
    blockedBy: ["story-forge-393-2"],
    blocks: ["story-forge-501-list"],
    risk: null,
    handoffContractIds: ["hc-forge-509-501"],
    createdAt: "2026-06-16T10:00:00Z",
    updatedAt: "2026-06-20T17:00:00Z",
  },
  // FORA-501 children (the center we're shipping now)
  {
    id: "story-forge-501-list",
    identifier: "FORA-501.list",
    epicId: "epic-forge-501",
    title: "Project Intelligence — Epic + Story lists (TypedTable)",
    acceptanceCriteria: [
      "Epic list renders via TypedTable with sort/filter/pagination.",
      "Story list renders via TypedTable with the same affordances.",
    ],
    status: "dev",
    priority: "high",
    owner: "pm",
    blockedBy: ["story-forge-393-3"],
    blocks: [],
    risk: null,
    handoffContractIds: [],
    runId: "run-fora-501-list",
    createdAt: "2026-06-20T10:00:00Z",
    updatedAt: "2026-06-20T17:46:00Z",
  },
  {
    id: "story-forge-501-brief",
    identifier: "FORA-501.brief",
    epicId: "epic-forge-501",
    title:
      "Project Intelligence — RequirementBrief round-trip + DraftPrd render",
    acceptanceCriteria: [
      "RequirementBrief round-trips schema_version \"1.0\".",
      "DraftPrdView renders all 11 canonical sections.",
    ],
    status: "qa",
    priority: "high",
    owner: "pm",
    blockedBy: ["story-forge-501-list"],
    blocks: [],
    risk:
      "Section-key enumeration must match REQUIREMENT_BRIEF_SECTIONS exactly.",
    handoffContractIds: ["hc-fora-501-brief"],
    runId: "run-fora-501-brief",
    createdAt: "2026-06-20T11:00:00Z",
    updatedAt: "2026-06-20T17:46:00Z",
  },
  {
    id: "story-forge-501-tabs",
    identifier: "FORA-501.tabs",
    epicId: "epic-forge-501",
    title:
      "Project Intelligence — 3 stage tabs (Dev / QA / DevOps) + drill-down",
    acceptanceCriteria: [
      "Stories in Dev / QA / DevOps tabs render their respective story subset.",
      "Drill-down reaches the right center (Dev / Testing / Deployment).",
    ],
    status: "devops",
    priority: "medium",
    owner: "pm",
    blockedBy: ["story-forge-501-brief"],
    blocks: [],
    risk: null,
    handoffContractIds: ["hc-fora-501-tabs"],
    runId: "run-fora-501-tabs",
    createdAt: "2026-06-20T12:00:00Z",
    updatedAt: "2026-06-20T17:46:00Z",
  },
  // FORA-578 child (shipped)
  {
    id: "story-forge-578-list",
    identifier: "FORA-578.list",
    epicId: "epic-forge-578",
    title: "Connector Center — list page (shipped)",
    acceptanceCriteria: [
      "Cards render status pill + health + scope chips.",
      "Credential is always redacted (FORA-128).",
    ],
    status: "done",
    priority: "high",
    owner: "eng-lead",
    blockedBy: [],
    blocks: [],
    risk: null,
    handoffContractIds: [],
    createdAt: "2026-06-18T10:00:00Z",
    updatedAt: "2026-06-20T17:40:00Z",
  },
];

/* ------------------------------------------------------------------ */
/* Handoff Contracts                                                   */
/* ------------------------------------------------------------------ */

export const HANDOFF_CONTRACTS: ReadonlyArray<HandoffContract> = [
  {
    id: "hc-forge-488-509",
    storyId: "story-forge-393-1",
    version: "1.0.0",
    fromStage: "architect",
    toStage: "dev",
    steps: [
      {
        fromStage: "architect",
        toStage: "dev",
        artefactRef: "packages/forge-ui/src/primitives",
        sha256: "sha256:placeholder-488",
      },
    ],
    inputSchemaRef: "schemas/forge-ui/primitives.in.json",
    outputSchemaRef: "schemas/forge-ui/primitives.out.json",
    exampleRef: "examples/forge-ui/primitives.json",
    sla: { p50Ms: 50, p99Ms: 120, maxRetries: 2 },
    createdAt: "2026-06-17T19:00:00Z",
  },
  {
    id: "hc-forge-508-509",
    storyId: "story-forge-393-2",
    version: "1.0.0",
    fromStage: "dev",
    toStage: "qa",
    steps: [
      {
        fromStage: "dev",
        toStage: "qa",
        artefactRef: "packages/forge-ui/src/graph",
        sha256: "sha256:placeholder-508",
      },
    ],
    inputSchemaRef: "schemas/forge-ui/graph.in.json",
    outputSchemaRef: "schemas/forge-ui/graph.out.json",
    exampleRef: "examples/forge-ui/graph.json",
    sla: { p50Ms: 80, p99Ms: 200, maxRetries: 3 },
    createdAt: "2026-06-18T19:00:00Z",
  },
  {
    id: "hc-forge-509-501",
    storyId: "story-forge-393-3",
    version: "1.0.0",
    fromStage: "qa",
    toStage: "dev",
    steps: [
      {
        fromStage: "qa",
        toStage: "dev",
        artefactRef: "packages/forge-ui/src/typed-artifacts",
        sha256: "sha256:placeholder-509",
      },
    ],
    inputSchemaRef: "schemas/forge-ui/typed-artifacts.in.json",
    outputSchemaRef: "schemas/forge-ui/typed-artifacts.out.json",
    exampleRef: "examples/forge-ui/typed-artifacts.json",
    sla: { p50Ms: 80, p99Ms: 200, maxRetries: 3 },
    createdAt: "2026-06-20T16:00:00Z",
  },
  {
    id: "hc-fora-501-brief",
    storyId: "story-forge-501-brief",
    version: "1.0.0",
    fromStage: "dev",
    toStage: "qa",
    steps: [
      {
        fromStage: "dev",
        toStage: "qa",
        artefactRef: "apps/forge/lib/intelligence/parser.ts",
        sha256: "sha256:placeholder-501-brief",
      },
    ],
    inputSchemaRef: "schemas/intelligence/requirement-brief.in.json",
    outputSchemaRef: "schemas/intelligence/requirement-brief.out.json",
    exampleRef: "examples/intelligence/requirement-brief.json",
    sla: { p50Ms: 25, p99Ms: 60, maxRetries: 2 },
    createdAt: "2026-06-20T17:00:00Z",
  },
  {
    id: "hc-fora-501-tabs",
    storyId: "story-forge-501-tabs",
    version: "1.0.0",
    fromStage: "qa",
    toStage: "devops",
    steps: [
      {
        fromStage: "qa",
        toStage: "devops",
        artefactRef: "apps/forge/components/intelligence/StageTabs.tsx",
        sha256: "sha256:placeholder-501-tabs",
      },
    ],
    inputSchemaRef: "schemas/intelligence/stage-tabs.in.json",
    outputSchemaRef: "schemas/intelligence/stage-tabs.out.json",
    exampleRef: "examples/intelligence/stage-tabs.json",
    sla: { p50Ms: 30, p99Ms: 75, maxRetries: 2 },
    createdAt: "2026-06-20T17:30:00Z",
  },
];

/* ------------------------------------------------------------------ */
/* Requirement Briefs — schema_version "1.0", 11 sections each        */
/* ------------------------------------------------------------------ */

function section(
  key: RequirementBrief["sections"][number]["key"],
  title: string,
  body: string,
): RequirementBriefSection {
  return { key, title, body };
}

const FORA_501_BRIEF_SECTIONS: ReadonlyArray<RequirementBriefSection> = [
  section(
    "mission",
    "Mission",
    "Build Forge AI, an enterprise-grade multi-tenant AI Delivery Operating System that transforms software delivery into a connected, governed, auditable, AI-assisted delivery platform. The Project Intelligence center is the PM-facing typed-artifact browser for every Epic, every Story, every active run, every open question.",
  ),
  section(
    "core_vision",
    "Core Vision",
    "Forge optimizes the entire delivery organization, not individual developers. Project Intelligence answers: 'what's next on this Epic, who owns it, what blocks it, what is open?' — without leaving the Forge UI.",
  ),
  section(
    "product_positioning",
    "Product Positioning",
    "Forge is a Delivery Operating System. Project Intelligence is its PM-facing surface — a typed-artifact browser on top of the Master Orchestrator's Handoff Contract.",
  ),
  section(
    "strategic_objective",
    "Strategic Objective",
    "Codify KnackForge delivery methodology into a reusable platform. Project Intelligence codifies the 'Epic end-to-end' loop: see the Epic, see the Stories, drill into the patch / test report / deploy plan, and surface open questions.",
  ),
  section(
    "product_lines",
    "Product Lines",
    "Project Intelligence sits on the SDLC Accelerator line. It is the typed-artifact browser for the Epic Generator output (FORA-225 → FORA-133 chain) and the Master Orchestrator's Handoff Contract.",
  ),
  section(
    "architecture_principles",
    "Architecture Principles",
    "Five principles govern the center: (1) Project Intelligence before automation, (2) human approval gates are mandatory, (3) everything is a typed artifact, (4) every action is auditable, (5) everything is visualized.",
  ),
  section(
    "three_layer_architecture",
    "Three Layer Architecture",
    "Project Intelligence consumes Layer 1 (Organization Knowledge) + Layer 2 (Project Intelligence, tenant-specific) and surfaces them through Layer 3 (the Agent Runtime's typed artifacts).",
  ),
  section(
    "multi_tenant_model",
    "Multi-Tenant Model",
    "Every record carries tenant_id + project_id. The seed tenant is acme-corp; the center renders with the tenant badge in the chrome.",
  ),
  section(
    "gsd_integration_strategy",
    "GSD Integration Strategy",
    "Project Intelligence adopts Open GSD. Do NOT rebuild GSD; use gsd-core for development execution, gsd-pi for project execution, gsd-workbench as the conceptual foundation.",
  ),
  section(
    "agent_runtime_framework",
    "Agent Runtime Framework",
    "The center is engine-agnostic. The Master Orchestrator drives the Handoff Contract; the renderer is the typed boundary between the agent runtime's output and the customer's view.",
  ),
  section(
    "core_ui_modules",
    "Core UI Modules",
    "Project Intelligence is Center #2 (FORA-393-2). Reconciles with Phase 0 (FORA-390) and the Epic Generator (FORA-225 → FORA-133). Owner: PM; BA secondary.",
  ),
];

const FORA_393_BRIEF_SECTIONS: ReadonlyArray<RequirementBriefSection> =
  FORA_501_BRIEF_SECTIONS.map((s) => ({
    ...s,
    body:
      s.body +
      " [FORA-393 spine: " +
      s.key +
      " — see Plan 1 §3 for the per-center reconciliation.]",
  }));

const FORA_578_BRIEF_SECTIONS: ReadonlyArray<RequirementBriefSection> =
  FORA_501_BRIEF_SECTIONS.map((s) => ({
    ...s,
    body:
      s.body +
      " [FORA-578 Connector Center: shipped 2026-06-20; persona-gated to Eng Lead + CTO.]",
  }));

export const REQUIREMENT_BRIEFS: ReadonlyArray<RequirementBrief> = [
  {
    id: "rb-forge-501",
    epicId: "epic-forge-501",
    title: "Project Intelligence — Requirement Brief",
    schema_version: "1.0",
    source: "FORA-501 description",
    sections: FORA_501_BRIEF_SECTIONS,
    createdAt: "2026-06-19T20:00:00Z",
    updatedAt: "2026-06-20T17:46:00Z",
  },
  {
    id: "rb-forge-393",
    epicId: "epic-forge-393",
    title: "UI / Visualization Spine — Requirement Brief",
    schema_version: "1.0",
    source: "FORA-393 master plan",
    sections: FORA_393_BRIEF_SECTIONS,
    createdAt: "2026-06-12T10:00:00Z",
    updatedAt: "2026-06-20T05:30:00Z",
  },
  {
    id: "rb-forge-578",
    epicId: "epic-forge-578",
    title: "Connector Center — Requirement Brief",
    schema_version: "1.0",
    source: "FORA-578 description",
    sections: FORA_578_BRIEF_SECTIONS,
    createdAt: "2026-06-18T10:00:00Z",
    updatedAt: "2026-06-20T17:40:00Z",
  },
];

/* ------------------------------------------------------------------ */
/* Draft PRDs — the canonical 11-section PRD                           */
/* ------------------------------------------------------------------ */

function canonicalPrdMarkdown(): string {
  // The 11 sections are rendered in fixed order; section keys mirror
  // REQUIREMENT_BRIEF_SECTIONS exactly so the lint-pass contract is
  // canonical with the typed `sectionBodies` map below.
  return REQUIREMENT_BRIEF_SECTIONS.map(
    (k, i) => `## ${i + 1}. ${labelForSectionKey(k)}\n\n${bodyForSectionKey(k)}`,
  ).join("\n\n");
}

function canonicalSectionBodies(): Readonly<
  Record<RequirementBriefSectionKey, string>
> {
  const bodies = {} as Record<RequirementBriefSectionKey, string>;
  for (const k of REQUIREMENT_BRIEF_SECTIONS) {
    bodies[k] = bodyForSectionKey(k);
  }
  return bodies;
}

function labelForSectionKey(k: RequirementBriefSectionKey): string {
  switch (k) {
    case "mission":
      return "Mission";
    case "core_vision":
      return "Core Vision";
    case "product_positioning":
      return "Product Positioning";
    case "strategic_objective":
      return "Strategic Objective";
    case "product_lines":
      return "Product Lines";
    case "architecture_principles":
      return "Architecture Principles";
    case "three_layer_architecture":
      return "Three Layer Architecture";
    case "multi_tenant_model":
      return "Multi-Tenant Model";
    case "gsd_integration_strategy":
      return "GSD Integration Strategy";
    case "agent_runtime_framework":
      return "Agent Runtime Framework & Provider Abstraction";
    case "core_ui_modules":
      return "Core UI Modules & Visualization Requirements";
  }
}

function bodyForSectionKey(k: RequirementBriefSectionKey): string {
  switch (k) {
    case "mission":
      return "Build Forge AI, an enterprise-grade multi-tenant AI Delivery Operating System.";
    case "core_vision":
      return "Forge optimizes the entire delivery organization.";
    case "product_positioning":
      return "Forge is a Delivery Operating System, not a Coding Assistant.";
    case "strategic_objective":
      return "Codify KnackForge delivery methodology into a reusable platform.";
    case "product_lines":
      return "Project Intelligence, SDLC Accelerator, Refactor Accelerator.";
    case "architecture_principles":
      return "1. Project Intelligence before automation. 2. Human approval gates. 3. Everything is a typed artifact. 4. Every action is auditable. 5. Everything is visualized.";
    case "three_layer_architecture":
      return "Organization Knowledge + Project Intelligence + Agent Runtime.";
    case "multi_tenant_model":
      return "tenant_id + project_id on every record.";
    case "gsd_integration_strategy":
      return "Adopt Open GSD; use gsd-core, gsd-pi, gsd-workbench.";
    case "agent_runtime_framework":
      return "Provider-agnostic; route all traffic through the Provider Abstraction Layer.";
    case "core_ui_modules":
      return "Thirteen centers: Dashboard, Connector Center, Knowledge Center, Project Intelligence, Organization Knowledge, Agent Center, Development Center, Security Center, Testing Center, Deployment Center, Governance Center, Audit Center, Analytics Center.";
  }
}

export const DRAFT_PRDS: ReadonlyArray<DraftPrd> = [
  {
    id: "prd-forge-501",
    epicId: "epic-forge-501",
    title: "Project Intelligence Center — Draft PRD",
    markdown: canonicalPrdMarkdown(),
    lintPassed: true,
    sectionBodies: canonicalSectionBodies(),
    createdAt: "2026-06-19T20:00:00Z",
    updatedAt: "2026-06-20T17:46:00Z",
  },
  {
    id: "prd-forge-393",
    epicId: "epic-forge-393",
    title: "UI / Visualization Spine — Draft PRD",
    markdown: canonicalPrdMarkdown(),
    lintPassed: true,
    sectionBodies: canonicalSectionBodies(),
    createdAt: "2026-06-12T10:00:00Z",
    updatedAt: "2026-06-20T05:30:00Z",
  },
];

/* ------------------------------------------------------------------ */
/* Loader helpers                                                       */
/* ------------------------------------------------------------------ */

export function listEpics(): ReadonlyArray<Epic> {
  return EPICS;
}

export function getEpic(id: string): Epic | null {
  return EPICS.find((e) => e.id === id) ?? null;
}

export function listStories(): ReadonlyArray<Story> {
  return STORIES;
}

export function getStory(id: string): Story | null {
  return STORIES.find((s) => s.id === id) ?? null;
}

export function listStoriesForEpic(epicId: string): ReadonlyArray<Story> {
  return STORIES.filter((s) => s.epicId === epicId);
}

export function listStoriesByStage(
  stage: "dev" | "qa" | "devops",
): ReadonlyArray<Story> {
  return STORIES.filter((s) => s.status === stage);
}

export function listHandoffContracts(): ReadonlyArray<HandoffContract> {
  return HANDOFF_CONTRACTS;
}

export function getHandoffContract(id: string): HandoffContract | null {
  return HANDOFF_CONTRACTS.find((h) => h.id === id) ?? null;
}

export function listRequirementBriefs(): ReadonlyArray<RequirementBrief> {
  return REQUIREMENT_BRIEFS;
}

export function getRequirementBrief(id: string): RequirementBrief | null {
  return REQUIREMENT_BRIEFS.find((b) => b.id === id) ?? null;
}

export function listDraftPrds(): ReadonlyArray<DraftPrd> {
  return DRAFT_PRDS;
}

export function getDraftPrd(id: string): DraftPrd | null {
  return DRAFT_PRDS.find((p) => p.id === id) ?? null;
}

/** Resolve an internal id (epic/story) to its human-readable
 *  identifier (`FORA-…`). Pages and `BlockedByList` use this so the
 *  chips show the identifier, not the raw id. Unknown ids fall
 *  through to the raw id (the mock seam contract). */
export function resolveIdentifier(id: string): string {
  const epic = EPICS.find((e) => e.id === id);
  if (epic) return epic.identifier;
  const story = STORIES.find((s) => s.id === id);
  if (story) return story.identifier;
  return id;
}