# Changelog

All notable changes to `@forge-ai/forge-pi` are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## [1.0.0] — 2026-06-27 — Initial release under Forge AI

### Added
- Initial release as `@forge-ai/forge-pi` — Forge Product Intelligence.
- `scanCodebase()` — service / dependency / secret scanner that emits typed artifacts (`ScanReport`).
- `buildKnowledgeGraph()` — fuses tickets, docs, and code into a queryable `KnowledgeGraph` (nodes + typed edges).
- `scoreIdea()` — RAG + LLM + chain-of-thought idea scorer with confidence intervals.
- `clusterCustomerVoice()` — feedback clustering over tenant-scoped input.
- `extractMarketSignals()` — market-signal processor.
- `generatePrd()` — typed PRD generator.
- Skill manifest (`forge-pi.catalog.json`) consumed by the Forge Command Center.
- Six skills (`forge-pi-scan`, `forge-pi-build-graph`, `forge-pi-score-idea`, `forge-pi-cluster-voice`, `forge-pi-market-signals`, `forge-pi-draft-prd`) and the `pm-agent` agent definition.
- Multi-tenant by design: every entry point accepts and returns artifacts carrying `tenant_id` and `project_id` (Forge Rule 2).

### Changed
- Package renamed from the v1.x upstream `forge-pi` to the Forge AI `@forge-ai/forge-pi` scope.
- Re-scoped to the Forge Agent OS — every public function now returns typed artifacts only (Forge Rule 4).
