# `@forge-ai/forge-pi`

> **Forge Product Intelligence** — the intelligence layer of the Forge AI Agent OS.

> _Based on the open-gsd spec-driven methodology, branded and extended for the Forge AI platform._

---

## What it does

`@forge-ai/forge-pi` is the package that makes Forge feel smart. While
`@forge-ai/forge-core` defines *how* an AI agent reasons through a phase,
`forge-pi` defines *what the agent knows* — about your codebase, your tickets,
your customers, and the market you operate in.

It scans codebases into typed artifacts (`ScanReport`), fuses tickets, docs,
and source into a queryable `KnowledgeGraph`, scores ideas with chain-of-thought
reasoning, clusters raw customer feedback into themes, surfaces market signals,
and drafts typed PRDs that flow directly into the Ideation Center.

Every entry point accepts and returns objects carrying `tenant_id` and
`project_id` — multi-tenancy is enforced by construction (Forge Rule 2).

The package is **optional by design**: when not installed, every consumer
(Ideation Center, Project Intelligence, Co-pilot, Architecture Center) falls
back to the in-memory stub data shipped inside `apps/forge`. The system runs
without it, but loses its intelligence layer.

---

## Skills included

| Skill | One-liner |
|---|---|
| `forge-pi-scan` | Scan a codebase into typed `ScanReport` artifacts (services, dependencies, secrets, ownership). |
| `forge-pi-build-graph` | Fuse tickets, docs, and code into a typed `KnowledgeGraph` for Project Intelligence. |
| `forge-pi-score-idea` | Score an idea with RAG + LLM + chain-of-thought, returning confidence + rationale. |
| `forge-pi-cluster-voice` | Cluster raw customer feedback into themes; output typed `VoiceCluster` artifacts. |
| `forge-pi-market-signals` | Mine market signals (competitor mentions, regulatory hints, trend keywords). |
| `forge-pi-draft-prd` | Draft a typed PRD from an idea + supporting context; ready for review. |

---

## Agents included

| Agent | Description |
|---|---|
| `pm-agent` | AI product manager — scans customer feedback, market signals, and existing PRDs to generate quarterly roadmaps. Output: ranked list of features with predicted impact. |

---

## Commands included

| Command | Surface |
|---|---|
| `forge:pi-scan` | Slash-style entry point to `forge-pi-scan`. |
| `forge:pi-build-graph` | Slash-style entry point to `forge-pi-build-graph`. |
| `forge:pi-score-idea` | Slash-style entry point to `forge-pi-score-idea`. |
| `forge:pi-cluster-voice` | Slash-style entry point to `forge-pi-cluster-voice`. |
| `forge:pi-market-signals` | Slash-style entry point to `forge-pi-market-signals`. |
| `forge:pi-draft-prd` | Slash-style entry point to `forge-pi-draft-prd`. |

---

## Usage

```ts
import {
  scanCodebase,
  buildKnowledgeGraph,
  scoreIdea,
  clusterCustomerVoice,
  extractMarketSignals,
  generatePrd,
} from '@forge-ai/forge-pi';
import type { TenantContext, ScanReport } from '@forge-ai/forge-pi';

const ctx: TenantContext = { tenantId: 'acme', projectId: 'forge' };

// 1. Scan a repo into a typed report
const report: ScanReport = await scanCodebase({
  ctx,
  rootDir: process.cwd(),
});

// 2. Fuse tickets + docs + the scan into a knowledge graph
const graph = await buildKnowledgeGraph({
  ctx,
  scanReport: report,
  tickets: await fetchTickets(ctx),
  docs: await fetchDocs(ctx),
});

// 3. Score an idea using the graph as RAG context
const ideaScore = await scoreIdea({
  ctx,
  idea: 'Let PMs pin personas to a roadmap slot',
  graph,
});

// 4. Cluster raw customer feedback
const voices = await clusterCustomerVoice({
  ctx,
  feedback: await fetchRawFeedback(ctx),
});

// 5. Mine the market
const signals = await extractMarketSignals({ ctx, ideaScore });

// 6. Draft a typed PRD
const prd = await generatePrd({ ctx, ideaScore, voices, signals });
```

Each step is auditable — every artifact carries provenance (`source`,
`timestamp`, `model`) and is replayable from the audit timeline.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                       Forge UI (apps/forge)              │
│   Ideation · Project Intelligence · Co-pilot · Architecture│
└──────────┬──────────────────┬────────────────────────────┘
           │                  │
           ▼                  ▼
┌─────────────────┐   ┌─────────────────────┐
│  forge-pi       │   │   forge-browser     │
│  (intelligence) │   │   (visual verify)   │
└────────┬────────┘   └──────────┬──────────┘
         │                       │
         └─────────┬─────────────┘
                   ▼
        ┌─────────────────────────┐
        │   forge-core            │
        │   (spec + skills)       │
        └─────────────────────────┘
```

`forge-pi` depends on `@forge-ai/forge-core` for shared types
(`TenantContext`, `Artifact`, etc.). It is independent of
`@forge-ai/forge-browser` — install either, both, or neither.

---

## Skill manifest

`forge-pi.catalog.json` is the source-of-truth manifest consumed by the
Forge Command Center (`apps/forge/lib/forge-commands-catalog.ts`) to render
the "Product Intelligence" category alongside `forge-core` commands in the
skill picker.

Each entry carries `package: "forge-pi"` metadata so the UI can group
skills by origin package, and the matching icon (`lucide Brain`) + color
(violet) is applied automatically.

---

## License

UNLICENSED — Forge AI internal package.
