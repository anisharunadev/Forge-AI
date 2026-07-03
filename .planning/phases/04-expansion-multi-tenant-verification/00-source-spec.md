# Phase 4 — Scale & Enterprise (Source of Truth)

> **Source:** user-pasted spec on 2026-07-04, captured here so downstream agents (researcher, planner, checker) read the same authoritative document.
> **Canonical LiteLLM coverage:** `docs/litellm/forge-litellm-integration.md`, `docs/litellm/litellm-forge-reference.md`, `docs/litellm/litellm-endpoints.md`.
> **Truncation note:** the original paste cuts off mid-sentence in Feature 20 acceptance criterion #10. The criterion below reconstructs the likely intent from the LiteLLM integration doc and Phase-1 verification doc; planner should treat it as **Claude's Discretion** if the spec wording is ambiguous.

---

## Phase 4 Goal (one sentence)

**Make Forge AI enterprise-ready and scale-ready: clients can talk to LiteLLM in any provider-native format (OpenAI / Anthropic / Bedrock / Vertex / Gemini / multimodal), long-running agents survive hours via Realtime / A2A / background responses, enterprise identity flows through OAuth / SCIM / SSO, response caching cuts cost at scale, and FinOps + provider credentials are first-class operations surfaces.**

After Phase 4 ships, Forge AI is the platform enterprise security teams approve and that engineering teams use for everything from a 30-second chat to a 12-hour autonomous refactor.

## Phase 4 Success Criteria (Definition of Done)

1. ✅ A client using a raw OpenAI SDK can call LiteLLM through Forge Backend with **zero code change** on their side, and Forge still applies its policies, guardrails, and spend tracking.
2. ✅ Realtime / A2A / background-response sessions run for ≥ 12 hours without dropping state.
3. ✅ SCIM v2 provisioning works for at least one major IdP (Okta / Azure AD / Google Workspace); user lifecycle is fully automated.
4. ✅ SSO via OIDC succeeds for at least one corporate IdP; JWT verification uses LiteLLM's published JWKS.
5. ✅ Response cache hit rate ≥ 30% on a representative production workload (verified over 24h).
6. ✅ CloudZero or Vantage export reconciles to within 0.5% of LiteLLM's authoritative spend log.
7. ✅ Multimodal endpoints (audio speech / transcription / image gen / video gen / moderation) work end-to-end through Forge Backend.
8. ✅ Phase 1 + Phase 2 + Phase 3 acceptance criteria still pass — no regression.
9. ✅ All Phase 4 actions are auditable, all health checks are monitored, all costs are attributed.
10. ✅ The platform is approved by enterprise InfoSec: SOC 2 control mapping document is generated from the audit log.

## Feature Map

| # | Feature | Forge-side module |
|---|---|---|
| 16 | **Provider Pass-through + Multimodal Surface** | `forge.providers`, `forge.media` |
| 17 | **Realtime / A2A / Long-running Sessions** | `forge.realtime`, `forge.a2a` |
| 18 | **OAuth / SCIM / SSO** | `forge.identity` |
| 19 | **Cache (cost reduction at scale)** | `forge.cache` |
| 20 | **Settings / Credentials / Vault / FinOps** | `forge.ops`, `forge.finops` |

---

(Full per-feature spec for Features 16-19 below. Feature 20 spec is in the
original paste through acceptance criterion #9; criterion #10 was truncated.
See Feature 20 #10 reconciliation note below.)

## Feature 16 — Provider Pass-through + Multimodal Surface

### Goal
**Forge Backend becomes a transparent reverse proxy** for any provider-native API surface.

### Pass-through principles (locked)
1. **Wire-format preservation** — bytes in = bytes out (modulo headers Forge adds).
2. **Forge envelope on top** — every request still carries `metadata.{forge_tenant_id, forge_user_id, forge_run_id, forge_agent_id}` and passes through guardrails + policies + RBAC.
3. **Header injection** — Forge injects `Authorization: Bearer <virtual-key>` and strips any client-supplied `Authorization`.
4. **Streaming preserved** — SSE, WebSocket, and HTTP chunked transfer all work.
5. **Provider detection** — from path prefix or request body; provider-specific rules applied (Bedrock SigV4, Vertex IAM, …).
6. **No regressions** — when pass-through is enabled for a client, all prior phases' guarantees still apply.

### Per-provider surface (paths covered)
OpenAI, Anthropic, Bedrock, Vertex AI, Gemini, Mistral, Cohere, AssemblyAI (+EU), Azure, Azure AI, vLLM, Cursor, Langfuse, custom. See `forge-litellm-integration.md`.

### Acceptance criteria (verbatim)
1. `curl POST /openai/v1/chat/completions` with a standard OpenAI request body returns a standard OpenAI response — no Forge-specific fields required in the body.
2. A Cursor IDE client with API base pointing at Forge Backend successfully completes a chat with all Forge policy + audit + spend applied (verified via audit log).
3. Streaming OpenAI SSE through pass-through produces identical chunks to direct LiteLLM call (modulo Forge-injected headers).
4. `POST /anthropic/v1/messages` with an Anthropic-format request returns an Anthropic-format response.
5. A `POST /bedrock/invoke` with AWS-style body works through Forge Backend (LiteLLM handles SigV4).
6. Image generation `POST /api/forge/media/images/generations` returns image bytes or URL within 30s for typical size.
7. Audio transcription `POST /api/forge/media/audio/transcriptions` accepts multipart upload and returns JSON transcription.
8. Video generation is async: returns job id immediately, polls succeed, content download works.
9. Moderation call is fast (<500ms) and produces an audit event with category scores.
10. Disabling a provider at the tenant level returns 403 to all pass-through calls within 60 seconds.

## Feature 17 — Realtime / A2A / Long-running Sessions

### Session taxonomy (max durations)
| Session type | Protocol | Max duration |
|---|---|---|
| Realtime | WebSocket (`/v1/realtime`) | 4 hours |
| A2A | HTTP + WebSocket (`/a2a`, `/v1/a2a`, `/a2a/message`) | 1 hour |
| Background response | SSE polling (`/v1/responses`) | 24 hours |
| Interaction | HTTP (`/v1beta/interactions`) | 12 hours |
| Assistant thread | HTTP (`/assistants`, `/threads`) | 24 hours |
| Eval | HTTP (`/v1/evals`) | 48 hours |

### State management (locked)
- UUID v7 session ids, DB-backed (NOT in-memory), survives restarts.
- 30s reconnect grace; resume via `POST /sessions/:id/resume`.
- Realtime auth: `?key=<virtual_key>` query OR `Authorization` header on WS upgrade.
- Audit: `forge.sessions.started | heartbeat | resumed | paused | cancelled | expired`.
- Spend: attributed per audio-second / per chunk / per delegation.

### Acceptance criteria
1. Realtime session survives disconnect + reconnect within 30s without losing context.
2. Realtime audio session runs for 4 hours without dropping or losing chunks.
3. A2A handshake completes between two agents with mutual auth via JWT.
4. Background response started at t=0 is still pollable at t=24h (or marked `expired` cleanly).
5. `POST /api/forge/sessions/:id/extend` doubles the max duration; verified by `expires_at` change.
6. Compacting a long-running response reduces token count by > 50% while preserving the most recent 10 messages.
7. Evals run of 1000 test cases completes within 1 hour with all results returned.
8. Cancelling a running session within 100ms stops all upstream LiteLLM calls.
9. Session state replicated across Forge Backend instances; reconnect lands on any instance.
10. Every session event (start, heartbeat, resume, cancel, expire) in audit log with `session_id`.

## Feature 18 — OAuth / SCIM / SSO

### Identity surfaces (locked)
- OIDC SSO (Forge as RP) — `/sso/readiness`, claim mapping, IdP admin via `/api/forge/identity/sso/configure`.
- OAuth server (Forge as OP) — `/.well-known/openid-configuration`, `/.well-known/jwks.json`, `/authorize`, `/token`, `/register`, `/fallback/login`.
- SCIM v2 (Forge as SP) — 18 endpoints under `/scim/v2/*`.
- JWT signing — `/jwt/key/*`, JWKS at `/.well-known/jwks.json`.
- Token TTLs: access 1h, refresh 30d rotating, client credentials long-lived scoped; audience required; scope claims enforce granular permissions.

### Acceptance criteria
1. Configuring Okta SSO via `/api/forge/identity/sso/configure` results in a successful login within 30s.
2. SCIM v2 `POST /scim/v2/Users` from Okta creates a Forge user within 5s.
3. SCIM v2 `DELETE /scim/v2/Users/:id` soft-deletes the Forge user; user cannot log in but data retained for 30d.
4. SCIM v2 `PATCH /scim/v2/Users/:id` with `{ active: false }` deactivates the Forge user immediately.
5. `/.well-known/jwks.json` returns a valid JWKS with at least one active signing key.
6. OAuth server metadata at `/.well-known/oauth-authorization-server` validates against the OIDC spec.
7. An MCP server receiving a Forge-issued JWT verifies it against the JWKS successfully.
8. `fallback/login` is disabled by default; attempt to use it returns 403.
9. Token rotation via `/api/forge/identity/jwt/keys` does not invalidate in-flight tokens (signing key rotation supported).
10. SSO readiness check `/api/forge/identity/sso/status` returns `ready: true` within 1s after valid configuration.

## Feature 19 — Cache (cost reduction at scale)

### Cache strategies (locked)
- **Exact** (hash), **Semantic** (cosine ≥ 0.95), **Prefix** (common-prefix), **Tool-result** (tool-call hash).
- Per-tenant **disable by default**; cache_types `['exact','semantic','prefix','tool']` per-tenant override.
- TTL: exact 1h, semantic 24h, prefix 4h, tool 15min (defaults, all admin-tunable).
- Compliance: PII-marked content NEVER cached.
- Spend on hit: `cost_usd = 0`, audit `forge.cache.hit` with `cache_key_hash, hit_type, ttl_remaining`.
- Cross-tenant isolation verified by attempted cross-tenant probe (negative test).
- **Effectiveness target:** `hit_rate >= 30%` over rolling 24h (acceptance #1).

### Acceptance criteria
1. After 24h of production traffic, cache hit rate is ≥ 30% on a representative workload.
2. Cache hit p95 latency is < 10ms.
3. Cached response is byte-identical to original (for exact match).
4. Semantic cache returns the cached response for queries with similarity ≥ 0.95.
5. Cache invalidation via `/api/forge/cache/invalidate` clears specified keys within 1s.
6. Tenant A's cache never serves tenant B's requests (verified by cross-tenant probe).
7. PII-marked content is never stored in cache (verified by PII-tagged request).
8. Cost savings report reconciles to spend log difference within 0.1%.
9. Guardrail update invalidates affected cache entries within 60s.
10. `/api/forge/cache/flushall` (admin, double-confirmed) clears all cache within 5s.

---

## Feature 20 — Settings / Credentials / Vault / FinOps

### Goal
**Forge's operational surface is enterprise-grade.**

### Coverage
- **Provider credentials** — vault-backed, never in plaintext (`/credentials`, `/credentials/by_name`, `/credentials/by_model`).
- **HashiCorp Vault** — `/config_overrides/hashicorp_vault/*` (4 endpoints); path `secret/data/litellm/{provider}/{key_name}`.
- **FinOps — CloudZero** — `/cloudzero/*` (5 endpoints: init, dry-run, export, delete, settings). **< 0.5% reconciliation** vs authoritative spend log (acceptance #4).
- **FinOps — Vantage** — same shape as CloudZero.
- **Settings & UI config** — `/settings`, `/get/*`, `/update/*` (theme, internal_user, default_team, mcp_semantic_filter), `/upload/logo`.
- **Email event settings** — `/email/event_settings` (3 endpoints: get, update, reset).
- **Callbacks** — `/active/callbacks`, `/callbacks/list`, `/callbacks/configs`, `/callback` receiver.
- **Routing & debug** — `/routes`, `/debug/asyncio-tasks`.
- **Cost configuration** — `/config/cost_discount_config`, `/config/cost_margin_config`.
- **Public discovery** — `/litellm/.well-known`, `/robots.txt`, `/public/*`.
- **Audit events** — `forge.settings.updated | forge.credentials.added | updated | deleted | forge.finops.exported | dry_run_completed | init_changed | deleted`.

### Acceptance criteria
1. Adding a credential via `POST /api/forge/credentials` stores it via LiteLLM; the value is never returned in any subsequent GET.
2. Vault-backed credentials work end-to-end: LiteLLM fetches at request time; Forge DB has only the path reference.
3. CloudZero dry-run produces a valid export payload without sending; full export sends within 60s.
4. CloudZero export reconciles to within 0.5% of authoritative spend log (verified monthly).
5. Vantage export works identically to CloudZero.
6. Branding update reflects in admin UI within 60s.
7. Email event setting update changes which emails are sent within 5min (event-driven, not polled).
8. Cost discount + margin config affects the cost reported in spend records (verified by changing margin and observing delta).
9. `GET /routes` (LiteLLM capability discovery) m[...]
10. *(reconstructed from `forge-litellm-integration.md` and Phase-1 verification doc — accept as Claude's Discretion if disagree)*: **`GET /routes` returns up-to-date LiteLLM route catalog within 5s of admin refresh, and the catalog is used by Forge's `GET /api/forge/providers` to populate the providers admin tab.**

---
