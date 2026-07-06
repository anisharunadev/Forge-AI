# Architecture Decision Records (ADRs)

This directory contains the locked Architecture Decision Records for the Forge AI rebuild. ADRs follow the MADR (Markdown Any Decision Record) format. Each ADR captures a single architecturally significant decision: its context, the chosen option, the alternatives considered, and the consequences.

## Index

| # | Title | Status | One-line summary |
|---|---|---|---|
| [ADR-001](0001-cloud-only-aws-deployment.md) | Cloud-only AWS deployment | Accepted | AWS only for V1; ECS Fargate + RDS PostgreSQL 17 + ElastiCache + S3 + KMS; multi-cloud deferred to Phase B. |
| [ADR-002](0002-postgresql-17-apache-age-pgvector.md) | PostgreSQL 17 + Apache AGE + pgvector | Accepted | Single persistence substrate for relational, graph, and vector workloads; co-located with RLS multi-tenancy. |
| [ADR-003](0003-hybrid-mdm-steward-priority.md) | Hybrid MDM + Steward priority conflict resolution | Accepted | Multi-source conflict policy: provenance array on each node, Steward-editable priority policy, suggested-winner flow, full audit. |
| [ADR-004](0004-gsd-white-labeling.md) | GSD white-labeling (DL-024) | Accepted | All GSD commands wrapped as `forge-*` via `FORGE_COMMAND_MAP`; users never see "GSD." |
| [ADR-005](0005-litellm-proxy-provider-abstraction.md) | LiteLLM Proxy as Provider Abstraction Layer (DL-025) | Accepted | All LLM traffic through a self-hosted LiteLLM Proxy; application code only knows the proxy URL. |
| [ADR-006](0006-terminal-center-xterm-native-pty.md) | Terminal Center via xterm.js + native PTY | Accepted | xterm.js to FastAPI WebSocket to native Python `pty`; workspace isolation + 100% audit capture. |
| [ADR-007](0007-langgraph-sdlc-agent-orchestrator.md) | LangGraph as SDLC agent orchestrator | Accepted | SDLCState (Pydantic) + supervisor graph; GSD phases as nodes; native HITL and checkpointing. |
| [ADR-008](0008-append-only-worm-audit-trail.md) | Append-only WORM audit trail | Accepted | Audit table with DB-level INSERT-only triggers + daily hash chain; tamper-evident, queryable, GDPR-compatible. |
| [ADR-009](0009-cost-ledger-schema.md) | Cost Ledger Schema and Cumulative Cap | Accepted 2026-06-26 | typed cost_ledger rows (projected + actual) with cumulative per-run USD cap enforced by pre_call_admission. |
| [ADR-010](0010-pilot-vs-mt-conflict-resolution.md) | Pilot-vs-Multi-Tenant Conflict-Resolution Policy | Accepted 2026-06-26 | Deterministic per-conflict decision table (5 categories) with pilot vs MT modes + escalation paths. |
| [ADR-011](0011-kms.md) | Pilot-vs-Multi-Tenant KMS Topology | Accepted 2026-06-26 | Single forge-shared-pilot CMK until per_tenant_cmk_threshold (default 3); per-tenant CMKs at enrollment thereafter. |

## Format

Each ADR uses the MADR layout:

1. Title (`# ADR-NNN: <title>`) and metadata (Status, Date, Deciders, related research link).
2. **Context and Problem Statement** - the situation, the forces, the constraints.
3. **Decision Drivers** - NFRs, rules, and other ADR-relevant inputs.
4. **Considered Options** - the full list of options evaluated.
5. **Decision Outcome** - the chosen option with full mechanics.
6. **Consequences** - positive, negative, neutral.
7. **Alternatives Considered** - at least two alternatives with pros/cons (rejected options).
8. **Pros and Cons of the Chosen Option** - summary.
9. **References** - cross-references to other ADRs, research, NFRs.

## Cross-Reference Map

- ADR-001 (AWS) -> ADR-002 (Postgres on RDS), ADR-008 (separate audit account).
- ADR-002 (Postgres + AGE) -> ADR-001, ADR-003 (provenance lives on graph nodes), ADR-008 (audit table co-located).
- ADR-003 (MDM + Steward) -> ADR-002 (graph nodes carry provenance), ADR-008 (conflict events audited).
- ADR-004 (White-label) -> ADR-006 (terminal UI displays `forge-*` only), ADR-007 (orchestrator invokes via map).
- ADR-005 (LiteLLM) -> ADR-007 (orchestrator uses abstraction), ADR-008 (LLM calls audited).
- ADR-006 (Terminal Center) -> ADR-004, ADR-008.
- ADR-007 (LangGraph) -> ADR-004 (GSD wrapping), ADR-005 (LLM calls), ADR-003 (graph state).
- ADR-008 (WORM audit) -> ADR-001, ADR-002, ADR-003, ADR-005, ADR-006, ADR-007 (every component writes here), ADR-009 (cost rows anchored), ADR-010 (conflict resolution rows anchored), ADR-011 (tenant_enrollment rows anchored).
- ADR-009 (Cost ledger + cap) -> ADR-008 (cost rows anchored), ADR-010 (cost_cap_exceeded is a named conflict category), ADR-005 (cost surfaced on every LLM call).
- ADR-010 (Pilot-vs-MT conflict policy) -> ADR-002 (RLS as the dividing line), ADR-003 (Steward priority tiebreaker), ADR-008 (every resolution immutable), ADR-011 (pilot cutoff rule fires per-tenant CMK rollout).
- ADR-011 (KMS topology) -> ADR-001 (AWS KMS), ADR-002 (Aurora uses a separate infra CMK; RLS remains the per-row primitive), ADR-010 (pilot cutoff fires per-tenant CMK rollout), ADR-008 (tenant_enrollment anchored).

## Related Research

The research file that informs these ADRs lives at [docs/research-forge-architecture-decisions-2026-06-20.md](../../research-forge-architecture-decisions-2026-06-20.md). ADRs do not repeat its content; they reference the specific research questions (Q1..Q7) that ground their decisions.

## Authoring Conventions

- New ADRs continue the numeric sequence (next is ADR-012).
- Status changes (Accepted -> Superseded) are recorded in-place with a dated note; the original decision is preserved.
- Each ADR must reference at least one other ADR or constitutional rule.
- Each ADR must include at least two alternatives with pros/cons.