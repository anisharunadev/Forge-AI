---
phase: "04"
name: "Scale & Enterprise"
slug: "expansion-multi-tenant-verification"   # reuse existing GSD slot
gathered: "2026-07-04"
status: "Ready for planning"
source: "Spec captured from user paste; canonical reference is 00-source-spec.md"
---

<domain>

## Phase Boundary

Phase 4 plans **Features 16-20 of the Scale & Enterprise spec** (Provider Pass-through + Multimodal, Realtime / A2A / Long-running Sessions, OAuth / SCIM / SSO, Cache, Settings / Vault / FinOps). Goal-backward from the spec's 10 Definition-of-Done items.

IN scope (5 features, ~40 Forge contract endpoints, ~50 LiteLLM dependencies):
- `/api/forge/{providers,realtime,a2a,sessions,responses,identity,oauth,cache,credentials,vault,finops,settings}`.
- `/openai/{path}`, `/anthropic/{path}`, `/bedrock/{path}`, `/vertex_ai/{path}`, `/gemini/{path}`, etc.
- Realtime WS at `/api/forge/realtime`, A2A at `/a2a/message` + `/a2a/.well-known`.
- SCIM v2 at `/scim/v2/*` plus OIDC well-known, OAuth /authorize, /token, /register.
- Cache admin + observability endpoints.

OUT of scope: original GSD "Phase 4 — Multi-Tenant Verification" REQ-IDs (PILOT-04-MT..MT5) — these are deferred to a follow-up phase (see `<deferred>` below).

</domain>

<decisions>

## Implementation Decisions

### Locked (from spec or .claude/CLAUDE.md)

- **L1.** All provider traffic flows through LiteLLM Proxy — never direct SDK (Rule 1). The `pass_through.py` client (merged) is the only path. Forbidden imports: `openai`, `anthropic`, `google.generativeai`, `langchain_openai`, `cohere`, `ollama`.
- **L2.** Every record in Phase 4 tables carries `tenant_id` + `project_id` (Rule 2). The 13 ORM models already merged (cf76130b) include `TenantScopedMixin` and composite indexes.
- **L3.** Pass-through is **wire-transparent**: bytes in = bytes out, but Forge injects `Authorization: Bearer <virtual-key>`, strips client `Authorization`, and enforces guardrails + spend tracking from Phase 2/3.
- **L4.** Pass-through is a **per-tenant feature flag** (`forge.pass_through.<provider>`); disabled by default; admin-enabled per provider per tenant.
- **L5.** Realtime/A2A session state is **DB-backed (not in-memory)** with UUID v7 ids; 30s reconnect grace; auto-expire on `max_duration`. State replicated via Redis pub/sub for HA.
- **L6.** SSO is **per-tenant**; OAuth server is **platform-level**. SCIM requires SSO enabled. `fallback/login` disabled by default with `auth_method: "fallback"` audit row per use.
- **L7.** Cache hit rate ≥ 30% (24h rolling) is the cost-reduction threshold; cache bypassed for PII-marked requests. Compliance: tenant-offboard purges all keys.
- **L8.** Provider credentials are **vault-backed or never stored in Forge DB**; only path references. FinOps exports reconcile to LiteLLM spend log within 0.5%.
- **L9.** Every Phase 4 action is auditable using the 47 `forge.{domain}.{action}` constants in `core/phase4_audit_events.py` (merged).
- **L10.** All Phase 4 endpoints mount under `/api/forge/...` (prefix shared via `forge_phase4` router) — feature 16 ALSO exposes raw provider paths at `/openai/{path}`, `/anthropic/{path}`, etc., for the pass-through marquee use case (Cursor-compat).
- **L11.** Build order documented in commit `e49fbbd8`: **19 (Cache) first, then 16, then 20, then 17, then 18**. Reason: cache must wrap any feature that issues LLM calls; pass-through needs cache live for cost savings; ops/finops is cross-cutting; realtime+identity are leaf features with the longest build cycles.

### Claude's Discretion

- **D-1.** Feature 20 acceptance criterion #10 was truncated in the source paste. Reconstructed text: "`GET /routes` returns up-to-date LiteLLM route catalog within 5s of admin refresh, and the catalog is used by Forge's `GET /api/forge/providers` to populate the providers admin tab." Planner may refine via `docs/litellm/forge-litellm-integration.md` §Settings; flag any disagreement to user.
- **D-2.** Realtime/A2A exact sub-protocol details (audio frame format, VAD cadence, transcription model pinning) — left to feature 17 plan.
- **D-3.** Exact cache key derivation (canonical JSON serialization rules, embedding model for semantic cache) — left to feature 19 plan.
- **D-4.** SCIM v2 filter parser — choose spec-compliant filter grammar (left to feature 18 plan).
- **D-5.** RBAC matrix for `/api/forge/identity/jwt/keys`, `/api/forge/finops/*`, `/api/forge/settings` — left to feature 18/20 plans, default deny-all + explicit admin.

</decisions>

<canonical_refs>

## Canonical References

**MANDATORY — downstream agents MUST read these before planning.**

### Spec / requirements
- `.planning/phases/04-expansion-multi-tenant-verification/00-source-spec.md` — this phase's source of truth (F16–F20 acceptance criteria).

### LiteLLM coverage (READ BEFORE DESIGNING NEW ROUTES)
- `docs/litellm/forge-litellm-integration.md` — feature → endpoint matrix, anti-patterns, streaming/guardrail/spend/MCP patterns. **§2 is the canonical feature surface map for Forge.**
- `docs/litellm/litellm-forge-reference.md` — curated endpoint catalog (637 of 703 endpoints, P0–P3 priority).
- `docs/litellm/litellm-endpoints.md` — complete flat catalog (703 endpoints, every method+path+summary).
- `docs/litellm/litellm-critical-schemas.json` — request/response shapes Forge Backend must model.
- `docs/litellm/forge-phase1/forge-phase1-verification.md` §Phase 4 — explicitly names this scope (Realtime, OAuth/SCIM/SSO, Provider pass-through).

### Constitutional rules (always-loaded)
- `.claude/CLAUDE.md` — 18 rules (R1-R18). Critical for Phase 4: R1 (LiteLLM-only), R2 (tenant+project on every row), R6/R7 (audit + OTel), R9 (forge-core canonical), R10/R11 (forge-pi / forge-browser canonical).
- `apps/forge/CLAUDE.md` — UI-side conventions (cross-cutting FAB/CommandCenter/ConnectorPicker).
- `backend/CLAUDE.md` — FastAPI conventions (async, sqlalchemy 2.x, Pydantic v2, structlog, alembic append-only, OpenTelemetry).
- `packages/forge-core/CLAUDE.md` · `packages/forge-pi/CLAUDE.md` · `packages/forge-browser/CLAUDE.md` — package boundaries.

### Architectural standards
- `docs/standards/architecture-rules.md` — full prose for R1-R18.
- `docs/standards/tech-stack.md` — pinned deps (FastAPI, SQLAlchemy 2.x async, Alembic, Redis, Pydantic v2, OpenTelemetry, structlog).
- `docs/standards/api-conventions.md` — endpoint conventions.
- `docs/standards/data-model.md` — SQLAlchemy model conventions.
- `docs/standards/ui-patterns.md` — UI patterns (R12-R17 cover Phase 4 admin tabs).
- `docs/standards/mcp-tooling.md` — MCP debugging (relevant to F16 /scim pass-through and F18 MCP-server OAuth).

### Reference inventories (routes / tables / metrics)
- `docs/reference/api-catalog.md` — existing Forge API routes (verify nothing collides).
- `docs/reference/db-schema.md` — existing DB models (the 13 Phase 4 models merged in cf76130b are not yet in this doc — planner must add them).

### Already merged Phase 4 foundation (DO NOT REPLAN)
- `core/phase4_audit_events.py` (74 LOC) — 47 audit-event constants.
- `core/phase4_errors.py` (160 LOC) — 15 Phase4Error subclasses + register_phase4_exception_handlers.
- `integrations/litellm/pass_through.py` (208 LOC) — PassThroughClient with stream_proxy + collect_proxy.
- `integrations/litellm/llm_client.py` (+99 LOC) — `_current_principal` ContextVar + `_enrich_metadata()` envelope.
- `services/feature_flag_catalog.py` (+117 LOC) — 12 forge.* flags.
- `db/models/phase4.py` (294 LOC) — 13 ORM models: `Phase4CacheKey`, `Phase4Session`, `Phase4SessionEvent`, `Phase4RealtimeClientSecret`, `Phase4A2ADelegation`, `Phase4SsoConfig`, `Phase4ScimToken`, `Phase4OAuthClient`, `Phase4JwtSigningKey`, `Phase4Credential`, `Phase4VaultConfig`, `Phase4FinopsExport`, `Phase4FinopsSettings`.
- `api/v1/forge_phase4/__init__.py` — stub router mounted at `/api/forge/*`, returns 501 NOT_IMPLEMENTED.
- `api/v1/router.py` — registers the router under v1.

### Out of scope this phase
- Multi-region active-active LiteLLM (mentioned in PILOT-04-MT5 — see `<deferred>`).
- Per-tenant CMK rollout at tenant #3/#5 (PILOT-04-MT4 — see `<deferred>`).
- Mobile / native client (v3+ per STATE.md).
- Real-time CRDT artifact editing (post-pilot).

</canonical_refs>

<specifics>

## Specific Ideas

- Pass-through marquee use case: **Cursor IDE** sets API base to `https://forge.example.com/openai/v1`; existing code works unchanged; Forge adds policy + audit + spend invisibly.
- Anthropic compatibility: SDK `base_url` → `https://forge.example.com/anthropic` or `/v1/messages`.
- Reactive cache invalidation hooks: guardrail/policy change → cache flush; model cost-map change → cost-tagged entry flush.
- A2A agent card at `/a2a/.well-known` declares Forge capabilities + auth for cross-agent discovery.
- Cache metrics dashboard tile: "Cache savings this month: $X (Y% of total spend)".
- Litellm-budget reconciliation job for FinOps exports (CloudZero/Vantage) — runs nightly, uses `lITELLM_SPEND_LOG_RECONCILE_TOLERANCE = 0.005` (0.5%).
- SOC 2 control mapping auto-generated from audit_log rows (R10 of spec).

## Build Order (locked from commit e49fbbd8)

1. **Feature 19 — Cache** (touches cache.py + cache_settings tabs; cache must wrap any LLM call to deliver cost-reduction claim).
2. **Feature 16 — Provider Pass-through** (largest endpoint surface; marquee Cursor/OpenAI/Anthropic compatibility).
3. **Feature 20 — Settings / Vault / FinOps** (cross-cutting operational surface; admin tabs).
4. **Feature 17 — Realtime / A2A / Long-running Sessions** (WebSocket complexity; lean on pass-through for LLM calls).
5. **Feature 18 — OAuth / SCIM / SSO** (longest cycle; depends on Phase 1 key infrastructure + pass-through patterns).

Some features can ship in parallel waves once foundation is shared (e.g., 18 SCIM endpoints + 19 cache can run alongside each other; 17 Realtime needs 19 cache live).

</specifics>

<deferred>

## Deferred Ideas

### Original GSD roadmap "Phase 4 — Multi-Tenant Verification" REQ-IDs (REASSIGNED)

The user's pasted spec, the recent `feat(phase4): ...` commits on `main`, and
`docs/litellm/forge-phase1-verification.md` §Phase 4 all use the label
**"Phase 4"** for the Scale & Enterprise scope. This displaces the
original GSD roadmap Phase 4 (Multi-Tenant Verification, REQ-IDs
`PILOT-04-MT..MT5`) — those REQs are deferred to a follow-up phase
and should be tracked as such, not dropped silently:

| REQ-ID | Description | New home |
|---|---|---|
| PILOT-04-MT | Tenant-isolation smoke test | Follow-up phase (Phase 5.5 / Phase 6 candidate) |
| PILOT-04-MT2 | Required tenant_id/project_id on ideation/cost/audit signatures | Follow-up (or merged into Phase 4 lint pass since enforcement is already in DB models) |
| PILOT-04-MT3 | `IDEATION_JIRA_PROJECT_KEY` from connector config | Already-shipped warm-fix; close in STATE |
| PILOT-04-MT4 | Per-tenant CMK at tenant #3/#5 (ADR-011) | Deferred (no pilot demand yet) |
| PILOT-04-MT5 | Multi-region active-active LiteLLM; per-tenant rate limit | Deferred (post-pilot) |

**Action required:** planner must add a `06-ROADMAP-CHANGES.md` (or equivalent)
flagging the renumbering and the deferred REQ-IDs above. Decision owner: user.

### Feature 20 acceptance criterion #10

The source paste truncates mid-sentence at "/routes (LiteLLM capability discovery) m[...]".
Reconstructed under D-1 above; planner may refine by reading
`docs/litellm/forge-litellm-integration.md` §Settings. Decision owner: Claude (discretion).

</deferred>

---

*Phase 04 — Scale & Enterprise — Context gathered 2026-07-04.*
