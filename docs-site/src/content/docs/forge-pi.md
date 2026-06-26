---
title: "forge-pi — Forge Product Intelligence"
description: "Codebase scanning, knowledge graph, idea scoring, customer voice clustering, and PRD generation."
---

# `@forge-ai/forge-pi` — Forge Product Intelligence

`forge-pi` is the **intelligence layer** of the Forge AI Agent OS. It is what
makes Forge feel smart rather than just a workflow tool.

## Capabilities

| Function | Returns |
|---|---|
| `scanCodebase(ctx, options)` | `CodebaseScanResult` — services, dependencies, secrets count, detector health |
| `buildKnowledgeGraph(ctx)` | `KnowledgeGraph` — fused code + tickets + docs |
| `queryKnowledgeGraph(ctx, query)` | `KnowledgeGraph` filtered by `kind` / `label_contains` |
| `scoreIdea(ctx, idea)` | `IdeaScore` — score + chain-of-thought + verdict |
| `clusterCustomerVoice(ctx, tickets)` | `CustomerCluster[]` |
| `extractMarketSignals(ctx)` | `MarketSignal[]` |
| `generatePrd(ctx, input)` | `PrdDraft` (typed artifact) |

Every entry point accepts and returns objects carrying `tenant_id` and
`project_id` — **Forge Rule 2 (Multi-Tenancy by Default)**.

## Where it lives in the app

- **Ideation Center** — Customer Voice, Market Signals, Idea scoring, PRD drafts
- **Project Intelligence** — Artifact tree, knowledge graph view
- **Co-pilot** — `@entity` mention resolution
- **Command Center** — `forge-pi-scan`, `forge-pi-cluster-voice`
- **Architecture Center** — system diagram seed

## Optional by design

`forge-pi` is optional. When the package is not installed, every consumer
falls back to local in-memory data. The system runs without it but loses
its intelligence layer.

## See also

- [3-Package Spec-Driven Stack](/forge/architecture/three-package-stack/)
- [`packages/forge-pi`](/forge/packages/forge-pi/) — source package