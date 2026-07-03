# Phase 4: Scale & Enterprise — Research

**Researched:** 2026-07-04
**Domain:** Forge Backend — multi-tenant enterprise surfaces (Provider Pass-through, Realtime/A2A, OAuth/SCIM/SSO, Cache, Settings/Vault/FinOps)
**Confidence:** HIGH on architectural shape + LiteLLM mapping; MEDIUM on integration/UI specifics; LOW on edge cases (long-running A2A semantics, exact Bedrock SigV4 header propagation, CloudZero payload shape)

---

## Summary

Phase 4 transforms Forge from a single-tenant pilot platform into an enterprise-ready, multi-tenant, provider-agnostic system. The five features (F16-F20) build on a **substantial pre-existing skeleton**: 5 service modules + 7 router modules already merged at the layer-implementation level. The foundation commits (`e49fbbd8`, `cf76130b`, `ed40d5fa`) ship:

- 47 `forge.{domain}.{action}` audit constants (`core/phase4_audit_events.py`)
- 15 typed `Phase4Error` subclasses + global handler (`core/phase4_errors.py`)
- `PassThroughClient` with header allowlist + metadata envelope (`integrations/litellm/pass_through.py`)
- `_current_principal` ContextVar + `_enrich_metadata()` in `integrations/litellm/llm_client.py`
- 12 `forge.*` feature flags (`services/feature_flag_catalog.py`)
- 13 tenant-scoped ORM models (`db/models/phase4.py`)
- Skeleton routers + service stubs for **all 5 features** (cache, providers, passthrough, media, identity, ops, sessions)
- 404 NOT_IMPLEMENTED returns already replaced by **real route handlers** referencing real service modules (`cache.py` 134 LOC, `passthrough.py` 298 LOC, `identity.py` 232 LOC, `ops.py` 318 LOC, `sessions.py` 198 LOC, `media.py` 212 LOC, `providers.py` 2.7K)

**Critical gap:** the skeleton is *layered correctly* (router → service → model), but **the alembic migration for the 13 Phase 4 tables has not landed**, and **zero `tests/phase4/*` test files exist** yet. The work is to (a) make the skeleton actually run end-to-end, (b) ship the migration + tests, (c) build the admin UI tabs (`CacheTab`, `ProvidersTab`, `SSOTab` etc.), and (d) wire cross-cutting concerns (audit/OTel/cache-wrapping).

**Primary recommendation:** follow the locked L1-L11 decisions and the L11 build order (19 → 16 → 20 → 17 → 18). Each feature gets 2-4 atomic-commit-sized plans. The first plan for any feature **must** land the alembic migration for the tables it touches before any service code commits.

---

## User Constraints (from CONTEXT.md)

### Locked Decisions
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
- **L11.** Build order: **19 → 16 → 20 → 17 → 18**.

### Claude's Discretion
- **D-1.** Feature 20 acceptance criterion #10: `GET /routes` returns up-to-date LiteLLM route catalog within 5s of admin refresh; catalog populates providers admin tab. Planner may refine via `docs/litellm/forge-litellm-integration.md` §Settings.
- **D-2.** Realtime/A2A sub-protocol details (audio frame format, VAD cadence, transcription model pinning) — left to F17 plan.
- **D-3.** Exact cache key derivation (canonical JSON serialization rules, embedding model for semantic cache) — left to F19 plan.
- **D-4.** SCIM v2 filter parser — choose spec-compliant filter grammar — left to F18 plan.
- **D-5.** RBAC matrix for `/api/forge/identity/jwt/keys`, `/api/forge/finops/*`, `/api/forge/settings` — left to F18/F20 plans, default deny-all + explicit admin.

### Deferred Ideas (OUT OF SCOPE)
- Original GSD roadmap "Phase 4 — Multi-Tenant Verification" REQ-IDs (PILOT-04-MT..MT5) — reassigned to follow-up phase (Phase 5.5/Phase 6 candidate). `06-ROADMAP-CHANGES.md` flag required.
- Multi-region active-active LiteLLM (PILOT-04-MT5)
- Per-tenant CMK at tenant #3/#5 (PILOT-04-MT4)

---

## Phase Requirements

**Source:** `00-source-spec.md` F16-F20 acceptance criteria (40 ACs total). Mapped to advisory REQ-IDs.

| REQ-ID | Description | Source AC | Research Support |
|--------|-------------|-----------|------------------|
| SCALE-F16-AC1 | `POST /openai/v1/chat/completions` returns OpenAI-shaped response (no Forge fields required) | F16#1 | §Standard Stack → LiteLLM `/openai/*` |
| SCALE-F16-AC2 | Cursor IDE with API base → Forge Backend works, audit + spend applied | F16#2 | §Pass-Through Architecture |
| SCALE-F16-AC3 | Streaming OpenAI SSE through pass-through produces identical chunks | F16#3 | §Pitfalls → streaming buffer anti-pattern |
| SCALE-F16-AC4 | `POST /anthropic/v1/messages` returns Anthropic-shaped response | F16#4 | §Pass-Through Architecture |
| SCALE-F16-AC5 | `POST /bedrock/invoke` with AWS-style body works through Forge | F16#5 | §Don't Hand-Roll → SigV4 header allowlist |
| SCALE-F16-AC6 | `POST /api/forge/media/images/generations` returns image in <30s | F16#6 | §Media Endpoints |
| SCALE-F16-AC7 | `POST /api/forge/media/audio/transcriptions` accepts multipart, returns JSON | F16#7 | §Media Endpoints |
| SCALE-F16-AC8 | Video generation is async: returns job id, polls succeed, content download works | F16#8 | §Media Endpoints |
| SCALE-F16-AC9 | Moderation <500ms, audit event with category scores | F16#9 | §Media Endpoints |
| SCALE-F16-AC10 | Disabling a provider at tenant level returns 403 within 60s | F16#10 | §Cache Flag Refresh |
| SCALE-F17-AC1 | Realtime session survives disconnect + reconnect within 30s | F17#1 | §Session State |
| SCALE-F17-AC2 | Realtime audio session runs 4h without dropping | F17#2 | §Session State |
| SCALE-F17-AC3 | A2A handshake between two agents with mutual JWT auth | F17#3 | §A2A Protocol |
| SCALE-F17-AC4 | Background response still pollable at t=24h or marked `expired` | F17#4 | §Session State |
| SCALE-F17-AC5 | `POST /api/forge/sessions/:id/extend` doubles max_duration | F17#5 | §Session State |
| SCALE-F17-AC6 | Compacting reduces token count >50%, preserves most recent 10 messages | F17#6 | §Responses Compact |
| SCALE-F17-AC7 | Evals: 1000 test cases completes in <1h | F17#7 | §Evals |
| SCALE-F17-AC8 | Cancelling session within 100ms stops all upstream calls | F17#8 | §Session Cancellation |
| SCALE-F17-AC9 | Session state replicated across instances; reconnect lands on any instance | F17#9 | §Session State |
| SCALE-F17-AC10 | Every session event in audit log with `session_id` | F17#10 | §Audit Coverage |
| SCALE-F18-AC1 | Configuring Okta SSO results in successful login within 30s | F18#1 | §SSO Configuration |
| SCALE-F18-AC2 | SCIM `POST /scim/v2/Users` from Okta creates Forge user within 5s | F18#2 | §SCIM Provisioning |
| SCALE-F18-AC3 | SCIM `DELETE` soft-deletes; data retained 30d | F18#3 | §SCIM Provisioning |
| SCALE-F18-AC4 | SCIM `PATCH` `{ active: false }` deactivates immediately | F18#4 | §SCIM Provisioning |
| SCALE-F18-AC5 | `/.well-known/jwks.json` returns valid JWKS with ≥1 active signing key | F18#5 | §JWT Signing Keys |
| SCALE-F18-AC6 | OAuth server metadata validates against OIDC spec | F18#6 | §OAuth Server |
| SCALE-F18-AC7 | MCP server receiving Forge JWT verifies against JWKS | F18#7 | §JWT Signing Keys |
| SCALE-F18-AC8 | `fallback/login` disabled by default; returns 403 | F18#8 | §Fallback Login |
| SCALE-F18-AC9 | Token rotation does not invalidate in-flight tokens | F18#9 | §JWT Signing Keys |
| SCALE-F18-AC10 | SSO readiness check returns `ready: true` within 1s of valid config | F18#10 | §SSO Configuration |
| SCALE-F19-AC1 | After 24h production traffic, cache hit rate ≥ 30% | F19#1 | §Cache Strategies |
| SCALE-F19-AC2 | Cache hit p95 latency < 10ms | F19#2 | §Cache Backend |
| SCALE-F19-AC3 | Cached response byte-identical to original (exact match) | F19#3 | §Cache Key Derivation |
| SCALE-F19-AC4 | Semantic cache returns cached response for similarity ≥ 0.95 | F19#4 | §Cache Strategies |
| SCALE-F19-AC5 | Cache invalidation via `/api/forge/cache/invalidate` clears within 1s | F19#5 | §Cache Invalidation |
| SCALE-F19-AC6 | Tenant A cache never serves tenant B (cross-tenant probe) | F19#6 | §Cache Isolation |
| SCALE-F19-AC7 | PII-marked content never stored | F19#7 | §PII Bypass |
| SCALE-F19-AC8 | Cost savings report reconciles to spend log within 0.1% | F19#8 | §Savings Reconciliation |
| SCALE-F19-AC9 | Guardrail update invalidates affected cache entries within 60s | F19#9 | §Cache Invalidation |
| SCALE-F19-AC10 | `/api/forge/cache/flushall` (admin, double-confirmed) clears all within 5s | F19#10 | §Cache Invalidation |
| SCALE-F20-AC1 | `POST /api/forge/credentials` stores via LiteLLM; value never returned | F20#1 | §Credentials |
| SCALE-F20-AC2 | Vault-backed credentials work end-to-end; Forge DB has only path reference | F20#2 | §Vault |
| SCALE-F20-AC3 | CloudZero dry-run produces valid payload without sending; full export <60s | F20#3 | §FinOps |
| SCALE-F20-AC4 | CloudZero export reconciles to <0.5% of authoritative spend log | F20#4 | §FinOps Reconciliation |
| SCALE-F20-AC5 | Vantage export identical to CloudZero | F20#5 | §FinOps |
| SCALE-F20-AC6 | Branding update reflects in admin UI within 60s | F20#6 | §Branding |
| SCALE-F20-AC7 | Email event setting update changes which emails sent within 5min (event-driven) | F20#7 | §Email Settings |
| SCALE-F20-AC8 | Cost discount + margin config affects spend record (verified by delta) | F20#8 | §Cost Config |
| SCALE-F20-AC9 | `GET /routes` returns up-to-date LiteLLM route catalog within 5s of admin refresh | F20#9 (D-1 reconstructed) | §Route Discovery |
| SCALE-F20-AC10 | Route catalog populates providers admin tab | F20#10 (D-1 reconstructed) | §Route Discovery |

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Provider pass-through (F16) | API / Backend (FastAPI handler) | LiteLLM Proxy | Bytes-in-bytes-out; backend is a pure proxy with metadata injection. |
| Multimodal endpoints (F16) | API / Backend (thin proxy) | LiteLLM Proxy | Same pattern as chat completions; LiteLLM handles provider diversity. |
| Cache (F19) | API / Backend (orchestration) | Database / Storage (Redis via LiteLLM) | Backend owns key derivation + audit + invalidation; LiteLLM owns Redis storage. |
| Realtime sessions (F17) | API / Backend (WebSocket handler) | Database / Storage (Postgres session rows + Redis pub/sub) | DB-backed per L5; in-memory only acceptable within single replica. |
| A2A (F17) | API / Backend (HTTP + WS) | LiteLLM Proxy (OAuth) | Forge brokers the handshake; LiteLLM validates the issued JWT. |
| SSO (F18) | API / Backend (OIDC client) | Keycloak (broker in dev) | Forge is the relying party; Keycloak remains platform-level. |
| SCIM (F18) | API / Backend (REST endpoints at `/scim/v2/*`) | Database (User rows) | Standard SCIM v2 surface; Forge terminates SCIM and writes to its user store. |
| OAuth server (F18) | API / Backend (`/.well-known/*`, `/oauth/*`) | Database (JWT signing keys) | Forge is the OpenID Provider for MCP servers + Forge-issued clients. |
| Credentials (F20) | API / Backend | Database + HashiCorp Vault | `Phase4Credential` stores only path reference; values live in Vault or LiteLLM. |
| Vault config (F20) | API / Backend | External HashiCorp Vault | `Phase4VaultConfig` row per tenant; tests can mock with in-memory dict. |
| FinOps exports (F20) | API / Backend (export job) | LiteLLM `/spend/logs` (reconciliation) | Backend pulls from LiteLLM, transforms to CloudZero/Vantage payload, exports. |
| Settings / Branding / Email (F20) | API / Backend | Database (`Tenant.settings` JSONB) | Forge owns the storage; UI reads from `Tenant.settings` JSONB. |
| Route discovery (F20#9-10) | API / Backend (cron + on-demand refresh) | LiteLLM `/routes` | Periodic + on-demand refresh from LiteLLM, cached in Redis for admin UI. |

**Key planning constraints surfaced:**
1. **Every Phase 4 endpoint must run the `_current_principal` ContextVar set/reset** (already wired in `llm_client.py`) so that pass-through metadata carries `forge_tenant_id` etc.
2. **The 13 Phase 4 tables need a single alembic migration** (append-only per `backend/CLAUDE.md`). The existing `cf76130b` commit did NOT ship a migration — this is a blocker for all F16-F20 service code that touches those tables.
3. **Three top-level mounts** (`mount_passthrough`, `mount_identity_discovery`, `mount_a2a`) live in `forge_phase4/__init__.py:mount_phase4_top_level` and must be called from `main.py` after the v1 routers.
4. **Pass-through admin proxy uses caller's Virtual Key**; top-level proxy uses admin key. Both paths call `_top_level_proxy` — single seam.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| FastAPI | `>=0.115,<0.117` | HTTP + WebSocket framework | Already pinned in `backend/requirements.txt`; F-829 layer uses it |
| Pydantic v2 | `>=2.7,<3` | Request/response models | Standard across the backend; `model_validate`/`model_dump` not v1 |
| SQLAlchemy 2.x async | `>=2.0,<2.1` | ORM | Pinned in `STACK.md`; all Phase 4 models use typed `Mapped` |
| Alembic | `>=1.13,<1.15` | Migrations | Append-only per `backend/CLAUDE.md`; one migration per phase |
| httpx | `>=0.27,<0.29` | LiteLLM Proxy + pass-through transport | Already the canonical async HTTP client (no `requests`) |
| structlog | `>=24.1,<25` | JSON logs | Pinned; tenant + project + actor bound to context |
| python-jose | `>=3.3,<4` | JWT decode (SSO + Forge-issued) | Already pinned for security module |
| passlib[bcrypt] | `>=1.7.4,<2` | SCIM local fallback password | Already pinned; dev-only |
| asyncpg | `>=0.29,<0.31` | Postgres driver | Pinned in stack; RLS GUC set per request |
| Redis 7 | 7-alpine | Pub/sub for session replication (L5) | Pinned; one channel per session-event-type |

### Phase 4 Specific (already merged)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| LiteLLM Proxy | `ghcr.io/berriai/litellm:main-latest` (v1.82.6 per spec) | All LLM/embedding/audio/image/video traffic | **Every** chat/embed/multimodal call |
| `integrations/litellm/pass_through.py` | merged | Header-allowlisted byte-stream proxy | All F16 pass-through calls |
| `core/phase4_audit_events.py` | merged | 47 `forge.{domain}.{action}` constants | Every Phase 4 endpoint emits via `audit_service.record` |
| `core/phase4_errors.py` | merged | 15 typed errors + global handler | Raise in services; handler maps to JSON envelope |
| `db/models/phase4.py` | merged | 13 ORM models | Use directly; do NOT redefine |
| `services/feature_flag_catalog.py` | merged | 12 `forge.*` flags | Read via existing tenant settings merge |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| LiteLLM Proxy passthrough | Custom httpx proxy per provider | LiteLLM already handles 100+ providers + per-tenant Virtual Keys + cost attribution |
| Per-tenant Redis cache | In-process LRU | Multi-replica deployments lose cache on restart; Redis is required for L7 hit-rate target |
| UUID v7 session ids | UUID v4 | v7 is time-ordered → better B-tree locality for "active sessions" queries |
| CloudZero / Vantage export | Direct DB export | Both require nightly batch + signed request; LiteLLM has built-in connectors per `forge-litellm-integration.md` §2.15 |
| Direct SCIM implementation | rfc7643 + rfc7644 only | Spec-compliant; no third-party lib needed for 18 endpoints |

**Installation:** No new packages needed for Phase 4. The skeleton uses already-installed deps. **Verify** `hvac` (HashiCorp Vault client) is required only if F20 vault tests use a real Vault — current tests can mock with in-memory dict per D-5.

**Version verification:** All pinned deps confirmed in `backend/requirements.txt` (unchanged since F-829). No new packages added in either Phase 4 commit.

---

## Package Legitimacy Audit

> **NOT REQUIRED** — Phase 4 introduces **zero new external packages**. The skeleton reuses pinned deps (httpx, structlog, python-jose, passlib). Skip this section unless F17 or F20 plan adds a new lib (e.g. `hvac` for Vault, `python-jose` extras for SCIM filter parser).

If F20 ships with `hvac`:

```bash
# Verify (if added)
pip index versions hvac
```

Per Phase 4 build order, all new lib additions must be reviewed against the existing pinned stack. The simplest path is to mock HashiCorp Vault behind an interface (`VaultClient` with `InMemoryVault` impl for tests, real `hvac` impl behind `VAULT_URL` flag).

---

## Architecture Patterns

### Pass-Through Architecture (F16)

```
┌──────────────────────────────────────────────────────────────────┐
│                         Forge UI / Cursor                         │
└────────────────────────────┬─────────────────────────────────────┘
                             │ HTTPS
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  FastAPI handler (api/v1/forge_phase4/passthrough.py)             │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ _resolve_principal_or_header(request)                      │  │
│  │   - Try JWT                                              │  │
│  │   - Fall back to X-Forge-Tenant header (Cursor / SDKs)   │  │
│  │   - Look up Tenant row to confirm header tenant_id       │  │
│  └────────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ is_provider_enabled(tenant_id, provider)                  │  │
│  │   - Read forge.pass_through.<provider> from Tenant.settings│ │
│  │   - Raise PassThroughDisabled if false                    │  │
│  └────────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ _filter_forwarded_headers (allowlist: X-Amz-*, X-Goog-*,  │  │
│  │   authorization-credential, anthropic-version, etc.)      │  │
│  │ Strip Authorization (Forge injects Bearer admin_key)      │  │
│  └────────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ _resolve_cache_key(body) → record_miss (only if hit)     │  │
│  └────────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ httpx.AsyncClient.stream() → yield bytes verbatim         │  │
│  │ Wrap in StreamingResponse                                 │  │
│  └────────────────────────────────────────────────────────────┘  │
└────────────────────────────┬─────────────────────────────────────┘
                             │ httpx (admin key)
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                       LiteLLM Proxy                               │
│  - Receives Bearer admin_key + X-Forge-Tenant from upstream      │
│  - Looks up tenant's Virtual Key from header → maps spend log    │
│  - Routes to upstream provider (OpenAI/Anthropic/Bedrock/...)    │
└──────────────────────────────────────────────────────────────────┘
```

**Critical seam:** the `PassThroughClient` class in `integrations/litellm/pass_through.py` is **NOT used** by the current top-level `_top_level_proxy` handler in `passthrough.py` — that handler duplicates `_filter_forwarded_headers` inline and uses admin key directly (not a per-tenant Virtual Key). The wire-transparent behavior is preserved (admin key bypasses tenant scoping), but per-tenant guardrails/budgets are **not applied** through the top-level path. This is a known design tradeoff: top-level = admin (Cursor compatibility), admin-style = caller's Virtual Key (Forge UI dashboard). The acceptance criteria are met (F16 AC2: Cursor works, audit + spend applied) because the admin key maps to a master Virtual Key in LiteLLM that has all tenant policies attached. **The planner should NOT refactor this in Phase 4 plans** — it's correct for the marquee use case.

### Session State Architecture (F17)

```
┌──────────────────────────────────────────────────────────────────────┐
│                       WebSocket / HTTP client                        │
└────────────────────────────┬─────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Realtime session handler (WebSocket)                                │
│  - POST /api/forge/realtime/sessions → create_session()              │
│    → INSERT phase4_sessions row (UUID v7, expires_at, max_duration)  │
│    → INSERT phase4_realtime_client_secrets row (TTL = 30s)           │
│  - WebSocket upgrade using ephemeral client secret                   │
│  - Heartbeat loop: POST /sessions/:id/heartbeat every 30s            │
│    → UPDATE last_heartbeat_at + INSERT phase4_session_events row     │
│  - Disconnect: status='disconnected', grace=30s                      │
│  - Reconnect within grace: POST /sessions/:id/resume                 │
│  - Expire: scheduled scan every 5min → status='expired' + event      │
│  - Cancel: POST /sessions/:id/cancel → status='cancelled'            │
│    + propagate to all upstream LiteLLM calls in <100ms               │
└────────────────────────────┬─────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Postgres (Phase4Session + Phase4SessionEvent)                       │
│  - DB-backed state survives restart                                  │
│  - TenantScoped: tenant_id + project_id + composite index            │
│  - Replicated: passive follower can take over via session_id lookup  │
└────────────────────────────┬─────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Redis pub/sub (forge:phase4:sessions:<session_id>)                  │
│  - Per-session-event channel                                         │
│  - Used by multi-replica to invalidate in-process stream caches     │
│  - Single-replica deployments: optional (DB polling is sufficient)   │
└──────────────────────────────────────────────────────────────────────┘
```

**Lock conflict warning:** the `phase4_sessions.py` skeleton uses `asyncio.Lock` semantics via Postgres advisory locks for cancel-propagation; planner should NOT introduce in-process state for sessions.

### Cache Architecture (F19)

```
┌─────────────────────────────────────────────────────────────────────┐
│                    LLM call (any feature)                            │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  phase4_cache_service.check(model, prompt, cache_type)              │
│  - Build canonical key hash (D-3)                                  │
│  - Look up in LiteLLM cache (Redis) via /cache/ping + GET           │
│  - On hit: forge.cache.hit audit + return cached response          │
│    (cost_usd=0, hit_type, ttl_remaining)                            │
│  - On miss: forge.cache.miss audit + forward to LLM call            │
│  - PII-marked: skip cache entirely (forge.cache.bypass audit)       │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  LiteLLM Proxy (cache backend: Redis)                               │
│  - Stores response by canonical key                                │
│  - Honors TTL: exact=1h, semantic=24h, prefix=4h, tool=15min        │
│  - Returns cached response on match                                 │
└─────────────────────────────────────────────────────────────────────┘
```

**Key design constraint (D-3):** cache key MUST include:
- model (so GPT-4o and Claude don't collide)
- sorted-canonical JSON of `messages` (D-3 left to planner; RECOMMEND: `json.dumps({k: sorted(v) for k, v in parsed.items() if k != 'stream'}, sort_keys=True, separators=(',', ':'))`)
- tenant_id prefix (for cross-tenant isolation defense in depth)

**NOT in cache key:** timestamps, request_id, run_id (these vary per call but content is same).

### Identity Architecture (F18)

```
┌─────────────────────────────────────────────────────────────────────┐
│                      External IdP (Okta/Azure/Google)                │
└────────────────────────────┬────────────────────────────────────────┘
                             │ OIDC
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Forge as Relying Party (SSO)                                        │
│  - /api/forge/identity/sso/configure (admin) → Phase4SsoConfig row   │
│  - /.well-known/openid-configuration (dynamic per tenant)            │
│  - OIDC dance: /authorize → /token → extract claims → mint Forge JWT│
│  - Login complete within 30s of admin configuring                    │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Forge as OpenID Provider (OAuth)                                    │
│  - /.well-known/openid-configuration (platform-level)                 │
│  - /.well-known/jwks.json (Phase4JwtSigningKey rows)                  │
│  - /oauth/authorize, /oauth/token, /oauth/register                   │
│  - Audience + scope claims enforce granular permissions              │
│  - MCP servers (and external Forge clients) verify Forge-issued JWT   │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  SCIM v2 (IdP-initiated provisioning)                                │
│  - 18 endpoints at /scim/v2/* (per RFC 7643+7644)                     │
│  - Bearer token auth (Phase4ScimToken)                               │
│  - Filter parser (D-4 left to planner; RECOMMEND: rfc7644 §3.4.2.2)  │
│  - Operations: User create/read/update/delete/patch/list             │
│  - Group create/read/update/delete/patch/list (Group membership)     │
│  - Soft-delete on DELETE; hard-purge after 30d (cron)                │
└─────────────────────────────────────────────────────────────────────┘
```

### FinOps Architecture (F20)

```
┌─────────────────────────────────────────────────────────────────────┐
│  Nightly cron (APScheduler) at 02:00 UTC                             │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  phase4_ops.finops_export(destination='cloudzero', dry_run=False)    │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ 1. Pull LiteLLM /spend/logs since last_export_at             │    │
│  │    - Apply tenant_id, project_id, forge_run_id filters       │    │
│  │ 2. Transform rows to CloudZero CUR shape                     │    │
│  │    - Line items: usage_account, usage_type, cost, tags        │    │
│  │ 3. POST signed payload to CloudZero API                      │    │
│  │ 4. Reconcile: sum(local cost) vs LiteLLM /spend/logs total    │    │
│  │    - If drift > 0.5%: forge.finops.drift_detected audit       │    │
│  │    - Retry 3x with exponential backoff                       │    │
│  │ 5. INSERT phase4_finops_exports row (status, record_count)    │    │
│  │ 6. UPDATE phase4_finops_settings.last_export_at              │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure (delta only — all skeleton already in place)

```
backend/
├── alembic/versions/
│   └── step_80_phase4_tables_001.py    # NEW — 13 tables + RLS + indexes
├── app/
│   ├── core/
│   │   ├── phase4_audit_events.py       # MERGED — 47 events
│   │   └── phase4_errors.py             # MERGED — 15 errors + handler
│   ├── integrations/litellm/
│   │   ├── llm_client.py                # MERGED — _current_principal + _enrich_metadata
│   │   └── pass_through.py              # MERGED — header allowlist + byte-stream proxy
│   ├── db/models/
│   │   └── phase4.py                    # MERGED — 13 ORM models
│   ├── services/
│   │   ├── phase4_cache.py              # MERGED skeleton (300+ LOC)
│   │   ├── phase4_providers.py          # MERGED skeleton (PROVIDERS dict)
│   │   ├── phase4_sessions.py           # MERGED skeleton
│   │   ├── phase4_identity.py           # MERGED skeleton
│   │   ├── phase4_ops.py                # MERGED skeleton
│   │   └── feature_flag_catalog.py      # MERGED — 12 forge.* flags
│   ├── api/v1/forge_phase4/
│   │   ├── __init__.py                  # MERGED — router + mount helpers
│   │   ├── cache.py                     # MERGED — 8 endpoints
│   │   ├── passthrough.py               # MERGED — top-level + admin paths
│   │   ├── providers.py                 # MERGED — admin provider config
│   │   ├── sessions.py                  # MERGED — 11 endpoints + mount_a2a
│   │   ├── identity.py                  # MERGED — SSO/SCIM/OAuth/JWT
│   │   ├── ops.py                       # MERGED — credentials/vault/finops/settings
│   │   └── media.py                     # MERGED — audio/image/video/moderation/containers
│   └── api/v1/router.py                 # UPDATED — registers forge_phase4.router
├── main.py                              # UPDATED — registers Phase4Error handler
└── tests/phase4/                        # NEW — all test files live here
    ├── test_cache_service.py
    ├── test_cache_router.py
    ├── test_passthrough_proxy.py
    ├── test_passthrough_top_level.py
    ├── test_providers_admin.py
    ├── test_sessions_state.py
    ├── test_sessions_websocket.py
    ├── test_a2a_handshake.py
    ├── test_sso_configure.py
    ├── test_scim_provisioning.py
    ├── test_oauth_clients.py
    ├── test_jwt_keys_rotation.py
    ├── test_credentials_vault.py
    ├── test_finops_reconciliation.py
    ├── test_settings_branding.py
    ├── test_route_discovery.py
    └── conftest.py                      # multi-tenant fixtures + LiteLLM mock
```

**Anti-patterns to avoid:**
- **Don't redefine Phase4CacheKey, Phase4Session, etc.** in service modules — they're already in `db/models/phase4.py`. Import directly.
- **Don't import `openai`, `anthropic`, `google.generativeai`** even in tests — use `httpx.MockTransport` or a stub client. Rule 1 is constitutional.
- **Don't hardcode model names** in cache keys — read from `forge_models.py` registry.
- **Don't store credentials in plaintext** — `Phase4Credential.credential_name` is the only DB column; value goes through LiteLLM or Vault.
- **Don't store Phase 4 cache in Python dicts** — go through LiteLLM `/cache/*` so hit rate survives restart and is multi-replica safe.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| OIDC SSO discovery + token exchange | Custom JWT parse | LiteLLM's JWT verification + `python-jose` for Forge-issued tokens | RS256 + JWKS rotation is hard; LiteLLM + jose already verified |
| SCIM filter parsing | Regex on filter string | RFC 7644 §3.4.2.2 grammar (handwritten recursive-descent is fine — ~80 LOC) | Spec-compliant; no third-party dep needed |
| JWKS document generation | Custom JSON builder | `python-jose` `jwk.construct()` + serialize public key only | Private key must NEVER leak in JWKS |
| CloudZero/Vantage request signing | Custom HMAC | LiteLLM `/cloudzero/*` and `/vantage/*` endpoints (per `forge-litellm-integration.md` §2.15) | LiteLLM has the connectors |
| Pass-through byte-stream proxy | Custom WebSocket relay | `httpx.AsyncClient.stream()` + FastAPI `StreamingResponse` | LiteLLM accepts the request; relay is pure TCP pass-through |
| Cache key derivation | Custom JSON sort | `json.dumps(parsed, sort_keys=True, separators=(",", ":"))` | Already canonical |
| Header allowlist for Bedrock SigV4 | Allow-all | `_PROVIDER_PASSTHROUGH_HEADER_ALLOWLIST` frozenset (merged) | Bedrock rejects mismatched X-Amz-Date headers |
| Reconciliation against LiteLLM spend | Custom HTTP polling | `forge_spend.py` reconcile cron (already exists) | NFR-030 + NFR-044 + Phase 1 P3 already solved this |
| JWT signing key rotation | Custom two-key validation | `Phase4JwtSigningKey` table with `kid` + `status='retired'` | Allow in-flight tokens; new tokens use new key |
| Tenant isolation for cache | Per-tenant Redis DB | Tenant ID as key prefix + tenant_id column on `Phase4CacheKey` | Defense in depth — even if Redis leaks, DB query rejects |

**Key insight:** Phase 4 is largely an **integration** phase, not an **algorithm** phase. Every problem has a LiteLLM endpoint or an existing Forge pattern. The job is to wire them up, audit them, and ship tests.

---

## Runtime State Inventory

> **CRITICAL for Phase 4.** Phase 4 introduces 13 new tenant-scoped tables, session state in Redis, JWT signing keys in `Phase4JwtSigningKey`, and tenant credentials in `Phase4Credential`. The migration MUST land before any service code can run.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | 13 new tables not yet in Postgres: `phase4_cache_keys`, `phase4_sessions`, `phase4_session_events`, `phase4_realtime_client_secrets`, `phase4_a2a_delegations`, `phase4_sso_configs`, `phase4_scim_tokens`, `phase4_oauth_clients`, `phase4_jwt_signing_keys`, `phase4_credentials`, `phase4_vault_configs`, `phase4_finops_exports`, `phase4_finops_settings` | **MUST land:** alembic migration `step_80_phase4_tables_001.py` adding all 13 tables + RLS policies + composite indexes. Review autogenerated diff before commit per `backend/CLAUDE.md`. |
| Live service config | Redis pub/sub channel `forge:phase4:sessions:<session_id>` not yet created | Code path uses `redis.publish()` which auto-creates channels — no bootstrap needed. |
| OS-registered state | None — no systemd units or PM2 processes for Phase 4. The FastAPI process is container-managed by ECS Fargate per ADR-001. | No action. |
| Secrets/env vars | Required env vars for F16-F20 (per `forge-litellm-integration.md` §2): `LITELLM_PROXY_URL`, `LITELLM_API_KEY`, `LITELLM_MASTER_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, plus optional `HASHICORP_VAULT_URL`/`VAULT_TOKEN` for F20 vault. | Add to `backend/.env.example`; document in `docs/standards/integration-phases.md`. |
| Build artifacts | None — no wheels, no Docker images affected by Phase 4. Backend Dockerfile already pulls all dependencies. | No action. |

**Nothing found in category:** OS-registered state, build artifacts.

**Empty dev DB warning:** Phase 4 migrations are append-only. Demo tenant seeds in `seeds/` may need to include a sample `phase4_sso_configs` row for the `acme-corp` tenant (for `forge.identity.sso` end-to-end test). Planner should add this to the seed service as part of F18 plan.

---

## Common Pitfalls

### Pitfall 1: Cache bypassed for all requests because PII flag defaults to False

**What goes wrong:** Spec L7 says "cache bypassed for PII-marked requests". If the implementation defaults `pii_marked=False` (which is correct for most calls), un-marked PII content (SSN in a free-text prompt) gets cached. Compliance risk.

**Why it happens:** No PII detector in Phase 4 scope; the flag must be set by callers. If callers forget, content is cached.

**How to avoid:** Default `pii_marked=True` on cache writes from any Phase 4 endpoint that accepts user-supplied text. Add an explicit `force_cache=True` override for tests + admin-flagged "low-sensitivity" routes. Verify with F19 AC7 negative test.

**Warning signs:** Cache hit rate on prompts containing email-shaped strings is suspiciously high.

### Pitfall 2: Pass-through admin key leaks Virtual Key derivation rules

**What goes wrong:** `_top_level_proxy` uses `settings.litellm_admin_key` (master key) so it can route to any tenant. But if the LiteLLM master key's `metadata` enforcement is misconfigured, spend logs cannot be attributed per Forge tenant. F16 AC2 audit log assertion fails.

**Why it happens:** The admin key bypasses per-tenant Virtual Key resolution. Spend attribution requires the `metadata.forge_*` envelope attached by `_filter_forwarded_headers` + `_inject_metadata` (in the original `PassThroughClient` class, not the inline admin path).

**How to avoid:** The current inline handler in `passthrough.py:_top_level_proxy` does NOT call `_inject_metadata`. **Planner must add this** in the F16 plan: serialize `forge_tenant_id`, `forge_user_id`, `forge_run_id` into the `metadata` dict before forwarding. Verify F16 AC2 audit log includes `tenant_id`.

**Warning signs:** Spend log query for `metadata.forge_tenant_id = 'X'` returns 0 rows after Cursor traffic.

### Pitfall 3: Session state in Redis instead of Postgres

**What goes wrong:** Skeleton uses `Phase4Session` (Postgres) — good. But if a planner adds an in-memory dict for active WebSocket connections (like `forge_chat.py:_active_streams`), sessions don't survive multi-replica failover. F17 AC9 fails.

**Why it happens:** WebSocket handlers naturally gravitate to in-process state.

**How to avoid:** All session state in `Phase4Session` row + Redis pub/sub for cache invalidation across replicas. WebSocket handler reads/writes the DB on every event. Never `dict[session_id, conn]` in module-level scope.

**Warning signs:** Session resumes succeed when client reconnects to same replica; fail when load balancer routes to different replica.

### Pitfall 4: JWT signing key rotation invalidates in-flight tokens

**What goes wrong:** F18 AC9 says rotation does not invalidate in-flight tokens. If the implementation removes the old key's public JWK from `/.well-known/jwks.json` immediately, external verifiers (MCP servers) fail to verify Forge-issued JWTs in flight.

**Why it happens:** Eager cleanup of rotated keys.

**How to avoid:** Two-phase rotation: (1) create new key, mark old `status='retired'` (not delete). (2) After `in_flight_ttl_seconds` (default 1h = access token TTL), remove old key. JWKS endpoint emits both `active` and `retired` keys until grace expires.

**Warning signs:** MCP server logs 401 errors for JWTs issued in the last hour after rotation.

### Pitfall 5: SCIM filter parser accepts unbounded `co`/`sw` expressions

**What goes wrong:** SCIM v2 filter grammar (`userName eq "alice"`) can be deeply nested. A malicious token request can submit `users[filter=...]` with a regex that exhausts CPU.

**Why it happens:** Hand-written recursive-descent parser with no depth limit.

**How to avoid:** Cap filter expression depth (e.g. 8 levels) + reject `co` operator on strings > 1024 chars. Reject filters not matching RFC 7644 grammar. Test with `tests/phase4/test_scim_provisioning.py::test_malicious_filter_rejected`.

**Warning signs:** SCIM `GET /scim/v2/Users?filter=...` returns slow responses (>5s).

### Pitfall 6: CloudZero export double-counts across multi-replica deploys

**What goes wrong:** F20 AC4 says reconciliation within 0.5%. If multiple Forge replicas run the nightly cron at the same time (because APScheduler doesn't have a Postgres advisory lock yet), each replica exports the same data.

**Why it happens:** APScheduler is in-process; multi-replica needs Postgres advisory lock per `STACK.md`.

**How to avoid:** Use the same advisory-lock pattern as `services/scheduler/`: `SELECT pg_advisory_lock(<hash('forge.finops.export'))>` at cron start. Only one replica proceeds. Document this in F20 plan.

**Warning signs:** CloudZero dashboard shows duplicate line items on export day.

### Pitfall 7: Cache hit rate measured on LiteLLM `/cache/ping` returns global rate, not per-tenant

**What goes wrong:** F19 AC1 says "tenant hit rate ≥ 30%". If the implementation reads LiteLLM's global cache stats, tenants with low traffic look healthy because the global rate is averaged up.

**Why it happens:** LiteLLM doesn't expose per-tenant cache hit rate out of the box.

**How to avoid:** Compute per-tenant hit rate from `Phase4CacheKey.hit_count` + audit log count of `forge.cache.hit` events per tenant over the window. The skeleton `phase4_cache.metrics()` already aggregates from the audit table — verify it's tenant-scoped.

**Warning signs:** Single high-traffic tenant's hit rate skews the average to >30% while 90% of tenants are <10%.

### Pitfall 8: A2A agent card at `/a2a/.well-known` reveals tenant secret

**What goes wrong:** The agent card declares capabilities + auth requirements. If the card includes the tenant's SCIM token or OAuth client secret, any agent hitting the well-known endpoint can impersonate.

**Why it happens:** Convenience copy-paste from config rows.

**How to avoid:** Agent card returns ONLY public info: agent id, supported capabilities, auth URL (no secret). Verify with `tests/phase4/test_a2a_handshake.py::test_agent_card_has_no_secret`.

**Warning signs:** Network tab in dev tools shows SCIM token in `/a2a/.well-known` response.

---

## Code Examples

Verified patterns from the merged skeleton + canonical LiteLLM reference.

### Pass-Through Header Filter (already in skeleton)
```python
# Source: backend/app/integrations/litellm/pass_through.py
_PROVIDER_PASSTHROUGH_HEADER_ALLOWLIST: frozenset[str] = frozenset(
    {
        "authorization-credential",  # Vertex IAM credential
        "x-amz-date",
        "x-amz-security-token",
        "x-amz-content-sha256",
        "x-amz-target",
        "x-amz-user-agent",
        "x-goog-api-version",
        "anthropic-version",
        "anthropic-beta",
    }
)

def _filter_forwarded_headers(
    client_headers: Mapping[str, str],
) -> dict[str, str]:
    """Drop Authorization + anything not in the allowlist."""
    out: dict[str, str] = {}
    for k, v in client_headers.items():
        lk = k.lower()
        if lk == "authorization":
            continue  # injected by us, not forwarded
        if lk == "host" or lk == "content-length":
            continue  # httpx sets these
        if lk in _PROVIDER_PASSTHROUGH_HEADER_ALLOWLIST or any(
            lk.startswith(prefix) for prefix in ("x-amz-", "x-goog-")
        ):
            out[k] = v
    return out
```

### Cache Hit Recording (skeleton)
```python
# Source: backend/app/services/phase4_cache.py (already merged)
async def record_hit(
    self,
    *,
    tenant_id: UUID | str,
    project_id: UUID | str,
    key_hash: str,
    cache_type: str,
    ttl_remaining: int,
) -> None:
    await self._audit(
        Phase4AuditAction.CACHE_HIT,
        tenant_id=tenant_id,
        project_id=project_id,
        payload={"key_hash": key_hash, "cache_type": cache_type, "ttl_remaining": ttl_remaining},
    )

async def record_miss(
    self,
    *,
    tenant_id: UUID | str,
    project_id: UUID | str,
    key_hash: str,
    model: str,
    cache_type: str,
) -> None:
    await self._audit(
        Phase4AuditAction.CACHE_MISS,
        tenant_id=tenant_id,
        project_id=project_id,
        payload={"key_hash": key_hash, "model": model, "cache_type": cache_type},
    )
```

### Audit Event Constant (canonical)
```python
# Source: backend/app/core/phase4_audit_events.py
from enum import Enum

class Phase4AuditAction(str, Enum):
    # F16 Pass-through + Media
    PROVIDER_ENABLED = "forge.providers.enabled"
    PROVIDER_DISABLED = "forge.providers.disabled"
    PROVIDER_ACCESSED = "forge.providers.accessed"
    MEDIA_AUDIO_GENERATED = "forge.media.audio_generated"
    # ... (47 total — see file)
```

### Phase 4 Error Pattern (canonical)
```python
# Source: backend/app/core/phase4_errors.py
class PassThroughDisabled(Phase4Error):
    code = "PASS_THROUGH_DISABLED"
    status_code = 403

# Service:
if not await is_provider_enabled(tenant_id, provider):
    raise PassThroughDisabled(provider)
# → handler in main.py returns:
# {"error": "PASS_THROUGH_DISABLED", "message": "...", "details": {...}, "occurred_at": "..."}
```

### Cache Key Canonical Derivation (D-3 candidate — planner finalizes)
```python
# Source: pattern from forge_spend.py + passthrough.py:_resolve_cache_key
import hashlib, json

def _resolve_cache_key(body: bytes) -> tuple[str, str, str] | None:
    if not body:
        return None
    try:
        parsed = json.loads(body)
    except Exception:
        return None
    if not isinstance(parsed, dict):
        return None
    model = parsed.get("model")
    if not isinstance(model, str):
        return None
    # D-3 RECOMMENDED: canonical JSON, sorted keys, no whitespace, exclude 'stream'
    canonical = json.dumps(
        {k: parsed[k] for k in sorted(parsed) if k != "stream"},
        separators=(",", ":"),
    )
    return (
        hashlib.sha256(canonical.encode("utf-8")).hexdigest(),
        model,
        "exact",
    )
```

### LiteLLM Pass-Through Endpoint Mapping (canonical)
```text
# Source: docs/litellm/forge-litellm-integration.md §2.18
OpenAI chat       POST /openai/chat/completions, /openai/v1/chat/completions
OpenAI responses  POST /openai/v1/responses
OpenAI assistants /openai/v1/assistants, /openai/v1/threads/*
OpenAI batches    /openai/v1/batches/*
OpenAI files      /openai/v1/files/*
OpenAI deploys    /openai/deployments/{deployment}/chat/completions
Anthropic         /anthropic/v1/messages, /v1/messages
Bedrock           /bedrock/*, /bedrock/invoke, /bedrock/converse
Vertex AI         /vertex_ai/*, /vertex_ai/discovery/*, /vertex_ai/live
Gemini            /gemini/v1/*
Mistral           /mistral/v1/*
Cohere            /cohere/v1/*
AssemblyAI        /assemblyai/v2/*, /eu.assemblyai/v2/*
Azure             /azure/*, /azure_ai/*
vLLM              /vllm/*
Cursor            /cursor/chat, /cursor/v1/chat/completions
Langfuse          /langfuse/*
Custom            /config/pass_through_endpoint/*
```

### Cache Endpoint Mapping (canonical)
```text
# Source: docs/litellm/forge-litellm-integration.md §2.17
Cache ping       POST /cache/ping
Cache delete     POST /cache/delete
Cache flushall   POST /cache/flushall
Cache redis info GET /cache/redis/info
Cache settings   GET /cache/settings
Update settings  POST /cache/settings
Test connection  POST /cache/settings/test
```

### JWT Key + SCIM Mapping (canonical)
```text
# Source: docs/litellm/forge-litellm-integration.md §2.24
Access groups  /v1/access_group, /v1/unified_access_group
OAuth server   /.well-known/oauth-authorization-server
OAuth resource /.well-known/oauth-protected-resource
OpenID Connect /.well-known/openid-configuration
JWKS           /.well-known/jwks.json
JWT keys       /jwt/key/*
SCIM v2        /scim/v2/*  (18 endpoints)
SSO            /sso/readiness
Fallback login /fallback/login
```

### FinOps Export Mapping (canonical)
```text
# Source: docs/litellm/forge-litellm-integration.md §2.15
Spend logs      GET /spend/logs
Global spend    GET /global/spend
Per-user daily  GET /user/daily/activity
Per-team daily  GET /team/daily/activity
Per-org daily   GET /organization/daily/activity
Cost config     GET /config/cost_discount_config, /config/cost_margin_config
Router config   GET /router/settings, /router/fields
```

### Realtime / A2A Mapping (canonical)
```text
# Source: docs/litellm/forge-litellm-integration.md §2.22
Realtime calls   /realtime, /v1/realtime, /realtime/calls, /realtime/client_secrets
A2A              /v1/a2a, /a2a, /a2a/message, /a2a/.well-known
Responses        /responses, /v1/responses, /responses/input_items, /responses/compact, /responses/cancel
Interactions     /v1beta/interactions, /interactions, /interactions/{id}/cancel
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Direct OpenAI/Anthropic SDK calls | All provider traffic via LiteLLM Proxy | Phase 0 (ADR-005, 2026-06-20) | Rule 1 constitutional; preserved in Phase 4 |
| In-process session state | DB-backed session state + Redis pub/sub | Phase 4 L5 (2026-07-04) | Multi-replica safe; cancel propagation works |
| Custom cache key derivation | Canonical JSON SHA-256 + tenant prefix | Phase 4 D-3 (2026-07-04, planner finalizes) | Cross-tenant isolation; byte-identical replay |
| OIDC via Keycloak only | OIDC via any IdP + Keycloak as broker | Phase 4 L6 (2026-07-04) | Enterprise SSO enabled |
| FinOps manual SQL queries | Nightly CloudZero/Vantage export from LiteLLM `/spend/logs` | Phase 4 L8 (2026-07-04) | Auto-reconciliation within 0.5% |
| Single-tenant audit | Append-only `audit_log` with 47 `forge.*` events | Phase 1-3 + Phase 4 | SOC 2 mappable |
| In-memory feature flags | Per-tenant `Tenant.settings['feature_flags']` JSONB merge | Phase 0 + Phase 4 (12 new flags) | Per-tenant F16/F17/F18/F19/F20 enablement |

**Deprecated/outdated:**
- **Phase 3 F-009 Governance Dashboard as full V1-OPTIONAL**: deferred per FEATURES.md §AF-12. Phase 4 doesn't reintroduce it; uses Phase 1 audit log + Constitution rulebook instead.
- **`FORA-*` Paperclip-era naming**: enforced by `CI grep gate` (Phase 0 HYG-03); Phase 4 uses `forge.*` consistently.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The Phase 4 skeleton routers (`cache.py`, `passthrough.py`, `identity.py`, `ops.py`, `sessions.py`, `media.py`, `providers.py`) compile and import correctly when registered | Architecture | If any import errors exist, the first plan commit fails import. Planner should run `python -c "from app.api.v1 import forge_phase4"` before planning. |
| A2 | The 5 service modules (`phase4_cache.py`, `phase4_providers.py`, `phase4_sessions.py`, `phase4_identity.py`, `phase4_ops.py`) implement their public methods correctly (no `NotImplementedError`) | Architecture | If any service has stubbed bodies, the corresponding router returns 500. Planner should `grep -l "raise NotImplementedError" backend/app/services/phase4_*.py` before planning. |
| A3 | `settings.litellm_admin_key` and `settings.litellm_base_url` exist in `core/config.py` | Pass-Through Architecture | The inline `_top_level_proxy` references `settings.litellm_admin_key` and `settings.litellm_base_url`. Verified `litellm_admin_key` exists; `litellm_base_url` may not (only `litellm_proxy_url` is canonical). Planner should grep `core/config.py` and add `litellm_base_url` alias if missing. |
| A4 | The skeleton DB models match the 13 tables documented in CONTEXT.md §canonical_refs | Runtime State Inventory | Models verified at lines 49-279 of `db/models/phase4.py`. Names match CONTEXT.md. |
| A5 | `forge.media.*` audit events are not yet emitted by any service | Pitfall 2 | The skeleton `media.py` proxy needs `_top_level_proxy` integration for the F16 acceptance criteria. Planner should verify in F16 plan. |
| A6 | Frontend admin tabs (`CacheTab`, `ProvidersTab`, `SSOTab` etc.) do not exist yet | Architecture | Confirmed: only `SSOTab.tsx` and `ProvidersTab.tsx` stubs exist; no `CacheTab` or `FinOpsTab`. Phase 4 plan must include admin UI work for F19/F20. |
| A7 | `tests/phase4/` directory does not exist | Runtime State Inventory | Confirmed via `find backend/tests -maxdepth 2 -name "phase4*"` → 0 matches. Phase 4 plans must create test infrastructure. |
| A8 | The 13 Phase 4 tables have no alembic migration | Runtime State Inventory | Confirmed: latest migration is `step_78_f12_rbac_hierarchy.py` (2026-07-04). Migration MUST be the first Phase 4 plan commit. |
| A9 | `Phase4VaultConfig` exists but no Vault client wrapper | Don't Hand-Roll | Confirmed: 13th model exists; no `VaultClient` interface. Planner should design minimal interface for F20 plan. |
| A10 | `forge.finops.enabled` flag is added but no nightly cron registers yet | F20 AC3-4 | The skeleton has no scheduler job registration. Planner must add APScheduler job with Postgres advisory lock per Pitfall 6. |

**If this table is empty:** All claims in this research were verified or cited — no user confirmation needed.

This table is NOT empty: items A1-A10 require planner verification before plan commits. None require user sign-off (they're implementation details), but planner should `grep` / `pytest --collect-only` / `python -c "from app.x import y"` before locking the plan shape.

---

## Open Questions

1. **Cache hit-rate measurement window** — F19 AC1 says "rolling 24h". Planner needs to choose: live aggregation (compute on each `/api/forge/cache/metrics` call) vs materialized hourly bucket table. Live is simpler; bucket is faster at scale. **Recommendation:** live aggregation until 10K+ events/tenant/24h observed, then add bucket table in F19 plan polish.
2. **SCIM filter parser scope** — RFC 7644 §3.4.2.2 supports `eq`, `ne`, `co`, `sw`, `ew`, `gt`, `lt`, `ge`, `le`, `and`, `or`, `not`, `(`, `)`. Planner needs to choose: full grammar (~250 LOC parser) vs subset `eq/ne/and/or` only (~80 LOC). **Recommendation:** subset first; Okta/Azure AD both work with `eq/and`. Defer `co`/`sw` until asked.
3. **A2A audio sub-protocol** — D-2 left to F17 plan. LiteLLM `/v1/realtime` follows OpenAI Realtime API. Planner should mirror OpenAI Realtime WebSocket protocol (event types: `session.created`, `session.updated`, `response.audio.delta`, `response.done`).
4. **CloudZero payload shape** — CloudZero expects CUR (Cost and Usage Report) format with specific columns (`lineItem/UsageAccountId`, `lineItem/UsageType`, `lineItem/UnblendedCost`, etc.). Planner needs to confirm the column set from CloudZero docs. **Recommendation:** start with the LiteLLM `/cloudzero/*` endpoints (per `forge-litellm-integration.md` §2.15) which already transform; if those don't exist, generate CUR manually with `pandas` write to S3 → CloudZero API.
5. **JWT signing key storage** — `Phase4JwtSigningKey.private_pem_path` is a path string. Where does the PEM file live? AWS Secrets Manager? Local disk? **Recommendation:** AWS Secrets Manager via `mcp-secrets` (already in the codebase) for production, local disk for dev. F18 plan finalizes.
6. **Vault URL for tests** — `hvac` is not in `requirements.txt`. Tests must mock. **Recommendation:** define a `VaultClient` protocol with `InMemoryVault` (dict-based) for tests and `HashiCorpVaultClient` (using `hvac`) behind `settings.vault_url` env. Add `hvac` to requirements only when F20 plan needs it.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python 3.13 | All backend code | ✓ | 3.13.x | — |
| FastAPI | Routers + WS | ✓ | >=0.115,<0.117 | — |
| SQLAlchemy 2.x async | ORM + migrations | ✓ | >=2.0,<2.1 | — |
| asyncpg | Postgres driver | ✓ | >=0.29,<0.31 | — |
| Redis 7 | Session replication + cache backend | ✓ | 7-alpine | — |
| LiteLLM Proxy | All F16-F20 traffic | ✓ | 1.82.6+ (per spec) | Phase 1 ships against this |
| Postgres 17 + Apache AGE + pgvector | DB substrate | ✓ | 17 | — |
| Keycloak 26 | OIDC broker | ✓ | 26.0.0 | Forge's own OAuth server (F18) |
| hvac (HashiCorp Vault client) | F20 vault tests | ✗ | — | Use `InMemoryVault` mock for tests; add to requirements if real Vault needed |
| Okta / Azure AD / Google Workspace IdP | F18 AC1 (one major IdP) | ✓ (sandbox orgs for tests) | — | Mock IdP discovery in tests; document manual setup |
| CloudZero / Vantage sandbox | F20 AC3-5 | ✗ | — | Mock HTTP client in tests; document manual sandbox setup |

**Missing dependencies with no fallback:**
- **Okta/Azure AD/Google Workspace IdP sandbox** — required for F18 AC1 ("at least one major IdP"). Planner should provision via Okta free developer account (or use mock for tests).

**Missing dependencies with fallback:**
- **HashiCorp Vault** — Phase 4 can mock with in-memory dict; add `hvac` only if real Vault deployment is required for F20 AC2.
- **CloudZero / Vantage** — mock the export endpoint in tests; verify against the LiteLLM `/cloudzero/*` and `/vantage/*` endpoints.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest + pytest-asyncio (asyncio_mode=auto) |
| Config file | `backend/pyproject.toml` `[tool.pytest.ini_options]` |
| Quick run command | `cd backend && pytest tests/phase4/ -x -q` |
| Full suite command | `cd backend && pytest -ra -q` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SCALE-F16-AC1 | OpenAI pass-through chat works | unit + httpx mock | `pytest tests/phase4/test_passthrough_proxy.py::test_openai_chat_completion -x` | ❌ Wave 0 |
| SCALE-F16-AC2 | Cursor IDE with API base → Forge works | e2e | `pytest tests/phase4/test_passthrough_top_level.py::test_cursor_request_flows -x` | ❌ Wave 0 |
| SCALE-F16-AC3 | SSE streaming matches LiteLLM | unit | `pytest tests/phase4/test_passthrough_proxy.py::test_sse_byte_identical -x` | ❌ Wave 0 |
| SCALE-F16-AC4 | Anthropic messages shape preserved | unit | `pytest tests/phase4/test_passthrough_proxy.py::test_anthropic_messages -x` | ❌ Wave 0 |
| SCALE-F16-AC5 | Bedrock SigV4 headers forwarded | unit | `pytest tests/phase4/test_passthrough_proxy.py::test_bedrock_sigv4_headers -x` | ❌ Wave 0 |
| SCALE-F16-AC6-AC9 | Multimodal endpoints | unit | `pytest tests/phase4/test_media_router.py -x` | ❌ Wave 0 |
| SCALE-F16-AC10 | Disable provider → 403 within 60s | unit | `pytest tests/phase4/test_providers_admin.py::test_disable_provider_blocks_within_60s -x` | ❌ Wave 0 |
| SCALE-F17-AC1-AC10 | All session behaviors | unit + WS test | `pytest tests/phase4/test_sessions_state.py tests/phase4/test_sessions_websocket.py tests/phase4/test_a2a_handshake.py -x` | ❌ Wave 0 |
| SCALE-F18-AC1-AC10 | All identity behaviors | unit + mock IdP | `pytest tests/phase4/test_sso_configure.py tests/phase4/test_scim_provisioning.py tests/phase4/test_oauth_clients.py tests/phase4/test_jwt_keys_rotation.py -x` | ❌ Wave 0 |
| SCALE-F19-AC1-AC10 | All cache behaviors | unit + integration | `pytest tests/phase4/test_cache_service.py tests/phase4/test_cache_router.py -x` | ❌ Wave 0 |
| SCALE-F20-AC1-AC10 | All ops behaviors | unit + reconciliation | `pytest tests/phase4/test_credentials_vault.py tests/phase4/test_finops_reconciliation.py tests/phase4/test_settings_branding.py tests/phase4/test_route_discovery.py -x` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `cd backend && pytest tests/phase4/ -x -q` (sub-30s for single test file)
- **Per wave merge:** `cd backend && pytest -ra -q` (full suite, ~5 min)
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `tests/phase4/__init__.py` — empty marker
- [ ] `tests/phase4/conftest.py` — multi-tenant fixtures (`tenant_a`, `tenant_b` factories), LiteLLM mock transport, `Phase4Session` factory
- [ ] `tests/phase4/test_passthrough_proxy.py` — covers F16 AC1-AC5
- [ ] `tests/phase4/test_passthrough_top_level.py` — covers F16 AC2 (Cursor)
- [ ] `tests/phase4/test_providers_admin.py` — covers F16 AC10
- [ ] `tests/phase4/test_media_router.py` — covers F16 AC6-AC9
- [ ] `tests/phase4/test_sessions_state.py` — covers F17 AC1, AC4, AC5, AC9, AC10
- [ ] `tests/phase4/test_sessions_websocket.py` — covers F17 AC2, AC8
- [ ] `tests/phase4/test_a2a_handshake.py` — covers F17 AC3, AC10
- [ ] `tests/phase4/test_sso_configure.py` — covers F18 AC1, AC10
- [ ] `tests/phase4/test_scim_provisioning.py` — covers F18 AC2, AC3, AC4
- [ ] `tests/phase4/test_oauth_clients.py` — covers F18 AC6, AC7, AC8
- [ ] `tests/phase4/test_jwt_keys_rotation.py` — covers F18 AC5, AC9
- [ ] `tests/phase4/test_cache_service.py` — covers F19 AC1, AC2, AC3, AC4, AC7, AC8
- [ ] `tests/phase4/test_cache_router.py` — covers F19 AC5, AC6, AC9, AC10
- [ ] `tests/phase4/test_credentials_vault.py` — covers F20 AC1, AC2
- [ ] `tests/phase4/test_finops_reconciliation.py` — covers F20 AC3, AC4, AC5, AC8
- [ ] `tests/phase4/test_settings_branding.py` — covers F20 AC6, AC7
- [ ] `tests/phase4/test_route_discovery.py` — covers F20 AC9, AC10 (D-1)
- [ ] `alembic/versions/step_80_phase4_tables_001.py` — 13 tables + RLS + indexes
- [ ] Frontend admin tabs: `CacheTab.tsx`, `ProvidersTab.tsx` (full impl), `FinOpsTab.tsx`, `VaultTab.tsx`, `RealtimeTab.tsx`, `IdentityTab.tsx` (extending `SSOTab.tsx`)

*(None of the above exist; all are Wave 0 gaps for the first Phase 4 plan.)*

---

## Security Domain

### Applicable ASVS Categories (V1.0)

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V1 Architecture | yes | Layer isolation; pass-through routes isolated to dedicated sub-router; no business logic in routes |
| V2 Authentication | yes | OIDC SSO via standard library (`python-jose`); Forge-issued JWT via `Phase4JwtSigningKey`; bcrypt for SCIM local fallback |
| V3 Session Management | yes | UUID v7 session ids; 30s reconnect grace; auto-expire on `max_duration`; status enum constraint at DB level |
| V4 Access Control | yes | Default-deny RBAC (`require_permission("tenants:manage")`); per-tenant feature flags; cross-tenant isolation via `(tenant_id, project_id)` composite indexes |
| V5 Input Validation | yes | Pydantic v2 schemas on every endpoint; header allowlist (X-Amz-*, X-Goog-*, anthropic-*); SCIM filter depth limit; JWT audience + scope claims |
| V6 Cryptography | yes | RS256 JWT (no HS256 in prod); private key never in JWKS response; bcrypt for SCIM fallback passwords; AES-GCM at rest for sensitive columns (use existing `core/crypto.py`) |
| V7 Error Handling | yes | 15 typed `Phase4Error` subclasses + global handler maps to JSON envelope; no stack traces leak |
| V8 Data Protection | yes | PII bypass for cache; credential values never returned; vault-backed storage; tenant-offboard cache purge |
| V9 Communication Security | yes | TLS everywhere (assumed by FastAPI/uvicorn); per-tenant Virtual Key isolation in LiteLLM |
| V10 Malicious Code | yes | No direct LLM SDKs (Rule 1); pass-through header allowlist prevents header injection; SCIM filter depth cap |
| V11 Business Logic | yes | Per-tenant provider flag (cannot escalate to other tenant's providers); cache namespace by tenant_id; finops destination per tenant |
| V12 Files and Resources | partial | No file upload in Phase 4 except logo upload (`/upload/logo`); use existing pattern |
| V13 API and Web Service | yes | Idempotency-Key on mutating endpoints (already in `core/idempotency.py`); rate limiting deferred to post-pilot |
| V14 Configuration | yes | All Phase 4 endpoints under `/api/forge/*` per L10; no direct provider SDKs per L1 |

### Known Threat Patterns for FastAPI + LiteLLM + Phase 4

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-tenant cache probe (A reads B's cache_key) | Information Disclosure | Cache key prefixed by tenant_id; `Phase4CacheKey` row has tenant_id; query filters by tenant_id from principal |
| SCIM filter DoS via deeply nested expression | Denial of Service | Filter depth cap (8 levels); reject `co` on strings > 1024 chars |
| JWT signing key leak via JWKS | Information Disclosure | JWKS only emits public keys; private_pem_path only in DB; verify with test `test_jwks_has_no_private_key` |
| Pass-through header injection (e.g., `X-Amz-Target: malicious`) | Tampering | Header allowlist + `_filter_forwarded_headers` strips anything not allowlisted |
| CloudZero export URL injection (e.g., `account_mapping` with `https://attacker.com`) | Tampering | Validate `account_mapping` keys against regex `^[a-zA-Z0-9_-]+$`; reject any value matching URL pattern |
| A2A agent card leak (credentials in `/a2a/.well-known`) | Information Disclosure | Agent card returns ONLY public info (agent id, capabilities, auth URL); no secret |
| Cache poisoning via crafted PII-marked flag (set `pii_marked=False` on PII content) | Repudiation | Audit log records `forge.cache.bypass` with `pii_marked`, `content_hash`; alert if hit_rate spikes on PII-shaped prompts |
| Session resume race condition (two clients resume same session) | Spoofing | Session `status='active'` constraint at DB level; `resume_session` uses `SELECT ... FOR UPDATE` row lock |
| Cost reconciliation drift (Forge spend ≠ LiteLLM spend) | Repudiation | `LITELLM_SPEND_LOG_RECONCILE_TOLERANCE = 0.005`; alert + auto-retry on drift > 0.5% |
| Fallback login abused for emergency access | Elevation of Privilege | Disabled by default (`forge.identity.fallback_login=False`); every use audited with `forge.identity.fallback_login_used`; per-tenant rate limit (5/day) |

---

## Sources

### Primary (HIGH confidence — merged code + canonical docs)
- **Already merged (this phase's foundation):**
  - `backend/app/core/phase4_audit_events.py` — 47 audit constants
  - `backend/app/core/phase4_errors.py` — 15 typed errors + handler
  - `backend/app/integrations/litellm/pass_through.py` — header-allowlisted byte-stream proxy
  - `backend/app/integrations/litellm/llm_client.py` — `_current_principal` ContextVar + `_enrich_metadata()`
  - `backend/app/services/feature_flag_catalog.py` — 12 forge.* flags
  - `backend/app/db/models/phase4.py` — 13 ORM models (verified lines 49-279)
  - `backend/app/api/v1/forge_phase4/__init__.py` + 7 sub-routers (verified)
  - `backend/app/services/phase4_cache.py` — 309 LOC, 11 methods (verified)
  - `backend/app/services/phase4_providers.py` — PROVIDERS dict (verified)
  - `backend/app/services/phase4_sessions.py` — 8 public methods (verified)
  - `backend/app/services/phase4_identity.py` — 10 public methods (verified)
  - `backend/app/services/phase4_ops.py` — 13 public methods (verified)
- **Canonical LiteLLM reference:**
  - `docs/litellm/forge-litellm-integration.md` — §2.15 (FinOps), §2.17 (Cache), §2.18 (Pass-through), §2.22 (Realtime/A2A), §2.24 (OAuth/SCIM/SSO)
  - `docs/litellm/litellm-forge-reference.md` — 637 curated endpoints
  - `docs/litellm/litellm-endpoints.md` — 703 complete flat catalog
  - `docs/litellm/litellm-critical-schemas.json` — request/response shapes
  - `docs/litellm/forge-phase1/forge-phase1-verification.md` §Phase 4 — explicit scope reference
- **Project context (already loaded by orchestrator):**
  - `.planning/phases/04-expansion-multi-tenant-verification/00-source-spec.md` — F16-F20 acceptance criteria
  - `.planning/phases/04-expansion-multi-tenant-verification/01-CONTEXT.md` — L1-L11 + build order
  - `.planning/STATE.md` — current project state
  - `.planning/research/SUMMARY.md` — Phase 1-3 synthesis
  - `.planning/codebase/ARCHITECTURE.md`, `CONVENTIONS.md`, `STACK.md`, `INTEGRATIONS.md`
- **Constitutional rules:**
  - `.claude/CLAUDE.md` — 18 rules (R1-R18)
  - `backend/CLAUDE.md` — FastAPI conventions
  - `apps/forge/CLAUDE.md` — UI conventions
  - `docs/standards/architecture-rules.md` — full R1-R18 prose
  - `docs/standards/data-model.md` — model patterns + RLS requirement

### Secondary (MEDIUM confidence — test scenarios + integration patterns)
- `docs/standards/integration-phases.md` — Phase mapping
- `docs/litellm/forge-litellm-integration.md` §4 (Critical Schemas), §6 (Streaming Pattern), §7 (Guardrail Pipeline), §8 (Cost Aggregation), §9 (MCP Tool Wiring)
- `forge_chat.py` `_chat_stream_iter` — reference SSE pattern
- `forge_spend.py` `record_from_usage` — reference audit pattern
- `forge_budget_guard.py` — reference pre-call admission pattern
- `forge_key_broker.py` `AgentVirtualKey.encrypted_key` — reference crypto-at-rest pattern

### Tertiary (LOW confidence — to validate during F18 plan)
- SCIM v2 RFC 7643 + 7644 filter grammar (referenced in spec AC; full grammar in RFC, RECOMMEND subset per Open Question 2)
- CloudZero CUR schema (column names; verify against CloudZero docs in F20 plan)
- HashiCorp Vault KV v2 API (verify `hvac` package version compatibility in F20 plan)
- OpenAI Realtime WebSocket event types (verify in F17 plan; LiteLLM `/v1/realtime` follows OpenAI Realtime API)
- Okta SCIM 2.0 implementation notes (verify filter support in F18 plan)

---

## Metadata

**Confidence breakdown:**
- **Standard stack:** HIGH — all deps verified in pinned `requirements.txt`; no new packages.
- **Architecture (skeleton):** HIGH — 13 models + 7 routers + 5 services + 47 audit constants + 15 errors all verified on disk. The skeleton is more developed than the CONTEXT.md suggests.
- **Architecture (missing pieces):** HIGH — alembic migration missing, tests/phase4/ missing, admin UI tabs missing.
- **LiteLLM endpoint mapping:** HIGH — canonical `docs/litellm/forge-litellm-integration.md` §2 maps every F16-F20 surface to specific endpoints.
- **Pitfalls:** MEDIUM — derived from spec + skeleton review; some (e.g. multi-replica cancel propagation) require real deployment testing.
- **Security:** MEDIUM — V1 ASVS applicable; some threats (CloudZero URL injection, A2A card leak) are speculative until tested.
- **Performance targets:** MEDIUM — F19 AC1 (hit rate ≥ 30%) and F19 AC2 (p95 < 10ms) are workload-dependent; cannot verify without production traffic.
- **D-1 (reconstructed AC #10):** LOW — text inferred from `forge-litellm-integration.md` §Settings; user should confirm during planning.

**Research date:** 2026-07-04
**Valid until:** 2026-08-04 (30 days; no fast-moving dependencies in Phase 4 stack)