# Pillar 1 — Alignment Note (Semantic Mapping)

**Date:** 2026-06-22
**Purpose:** Document the semantic mapping between Pillar 1 Deep-Dive (v1.0, May 4, 2026) terminology and the existing Forge AI decomposition. Resolves the "SDLC Agent" naming tension without amending DL-015.

## Background

The Pillar 1 Deep-Dive names an "SDLC Agent" as the user-facing entity that orchestrates the 5-stage build workflow. Forge AI's PRD v2.0 (DL-015) explicitly states: "Forge is an Agent Operating System, not an SDLC agent." This note documents how the two framings coexist.

## Mapping

| Pillar 1 Term | Forge AI Decomposition | Notes |
|---|---|---|
| SDLC Agent | Composition of (a) LangGraph supervisor at `backend/app/agents/sdlc_agent.py`, (b) 9 phase nodes under `backend/app/agents/nodes/`, (c) ideation services at `backend/app/services/ideation/`, (d) architecture services at `backend/app/services/architecture/`, (e) Terminal Center at F-401..F-415 + `backend/app/services/terminal/` | The composition is the SDLC Agent. Forge orchestrates the composition; the SDLC Agent is the user-facing label for the workflow, not a single platform entity. |
| Forge Ideation Agent | F-201..F-213 + `backend/app/services/ideation/*.py` | Named directly in PRD §5.3. |
| Code Validator Agent | F-501 (Tier 1 amendment, pending ratification) | New entity; no existing analog in PRD or code. |
| Refactor Agent | F-601 (Tier 3 amendment, pending ratification) | Promotes Phase 6 from out-of-V1 to in-scope. |
| IDE (Kiro, Cursor, Claude Code) | F-011 Agent Registry (agent execution) + F-510 Kiro MCP Adapter (Tier 2, pending) + DL-031 IDE-via-MCP-only (Tier 1, pending) | Customers pick their IDE; Forge integrates via MCP. |
| 5-stage Build Workflow | DL-021 enumerates the same stages: PI → Ideation → Architecture → Dev → Testing → Security → Deployment. V1 covers 3-of-5 (Ideation + Architecture + Terminal Center). | See OQ-016 for scope decision. |

## Constitutional Posture

- **DL-015 is preserved.** Forge remains the Agent Operating System.
- **Pillar 1 framing is honored.** The "SDLC Agent" is a named composition, not a platform entity.
- **No amendment to DL-015 required.** Future Pillar 1 amendments may reference the SDLC Agent as a composition without conflict.

## Cross-References

- PRD: `docs/planning-artifacts/prds/prd-forge-ai-2026-06-19/prd.md`
- Implementation plan: `implementation_plan.md`
- ADRs: `docs/architecture/decisions/0007-langgraph-sdlc-agent-orchestrator.md`
- Pillar 1 Deep-Dive gap analysis: `pillar1-gap-analysis.md`
- Pillar 1 amendment drafts: `pillar1-prd-amendments.md`