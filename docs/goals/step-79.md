# Forge Backend — Phase 4 Implementation Spec

> **Status:** completed
> **Last classified:** 2026-07-05

> **Phase:** 4 of 4 — Scale & Enterprise
> **Goal of this doc:** spec the 5 features in Phase 4 with explicit goals, contracts, and acceptance criteria — no code, just the contract.
> **Depends on:** Phase 1 (Foundation), Phase 2 (Safety & Tooling), Phase 3 (Productivity).
> **Source API:** LiteLLM `1.82.6` at `https://litellm-api.up.railway.app/` (see `forge-litellm-integration.md` for full endpoint map).

---

## Phase 4 Goal (one sentence)

**Make Forge AI enterprise-ready and scale-ready: clients can talk to LiteLLM in any provider-native format (OpenAI / Anthropic / Bedrock / Vertex / Gemini / multimodal), long-running agents survive hours via Realtime / A2A / background responses, enterprise identity flows through OAuth / SCIM / SSO, response caching cuts cost at scale, and FinOps + provider credentials are first-class operations surfaces.**

After Phase 4 ships, Forge AI is the platform enterprise security teams approve and that engineering teams use for everything from a 30-second chat to a 12-hour autonomous refactor.

---

## Phase 4 Success Criteria (Definition of Done)

Phase 4 is done only when **all** are true:

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

---

## Feature Map

| # | Feature | LiteLLM endpoints | Forge-side module |
|---|---|---|---|
| 16 | **Provider Pass-through + Multimodal Surface** | `/openai/*`, `/openai/v1/*`, `/openai_passthrough/*`, `/openai/deployments/*`, `/anthropic/*`, `/v1/messages`, `/bedrock/*`, `/vertex_ai/*`, `/vertex_ai/discovery/*`, `/vertex_ai/live`, `/gemini/v1/*`, `/mistral/v1/*`, `/cohere/v1/*`, `/assemblyai/v2/*`, `/eu.assemblyai/v2/*`, `/azure/*`, `/azure_ai/*`, `/vllm/*`, `/cursor/*`, `/langfuse/*`, `/config/pass_through_endpoint/*`, `/audio/speech`, `/audio/transcriptions`, `/v1/audio/*`, `/images/generations`, `/images/edits`, `/v1/images/*`, `/videos/*`, `/v1/videos/*`, `/containers/*`, `/v1/containers/*`, `/moderations`, `/v1/moderations` | `forge.providers`, `forge.media` |
| 17 | **Realtime / A2A / Long-running Sessions** | `/realtime`, `/v1/realtime`, `/realtime/calls`, `/realtime/client_secrets`, `/v1/a2a`, `/a2a`, `/a2a/message`, `/a2a/.well-known`, `/v1/responses`, `/responses`, `/responses/{id}/*`, `/v1beta/interactions`, `/interactions`, `/interactions/{id}/cancel`, `/assistants/*`, `/v1/assistants/*`, `/threads/*`, `/v1/threads/*`, `/v1/evals/*` | `forge.realtime`, `forge.a2a` |
| 18 | **OAuth / SCIM / SSO** | `/.well-known/openid-configuration`, `/.well-known/jwks.json`, `/.well-known/oauth-authorization-server`, `/.well-known/oauth-authorization-server/mcp/{name}`, `/.well-known/oauth-protected-resource`, `/scim/v2/*` (18 endpoints), `/jwt/key/*`, `/authorize`, `/token`, `/register`, `/fallback/login`, `/sso/readiness`, `/.well-known/litellm-ui-config` | `forge.identity` |
| 19 | **Cache (cost reduction at scale)** | `/cache/ping`, `/cache/delete`, `/cache/flushall`, `/cache/redis/*`, `/cache/settings`, `/cache/settings/update` | `forge.cache` |
| 20 | **Settings / Credentials / Vault / FinOps** | `/credentials`, `/credentials/by_name`, `/credentials/by_model`, `/config_overrides/hashicorp_vault/*`, `/cloudzero/*`, `/vantage/*`, `/settings`, `/get/*`, `/update/*`, `/upload/logo`, `/email/event_settings`, `/email/event_settings/reset`, `/active/callbacks`, `/callbacks/list`, `/callbacks/configs`, `/debug/asyncio-tasks`, `/routes`, `/fallback/login`, `/litellm/.well-known`, `/robots.txt`, `/config/cost_discount_config`, `/config/cost_margin_config` | `forge.ops`, `forge.finops` |

---

## Feature 16 — Provider Pass-through + Multimodal Surface

### Goal
**Forge Backend becomes a transparent reverse proxy** for any provider-native API surface. A client using the raw OpenAI SDK, the Anthropic SDK, the AWS Bedrock SDK, the Vertex AI SDK, or any multimodal endpoint (audio / image / video / moderation) talks to Forge Backend with zero code change — and Forge still applies Phase 2 guardrails, Phase 3 RBAC, Phase 1 keys + spend.

### Spec

**Why pass-through exists:**
- Enterprise clients have existing code that uses provider-native formats (especially OpenAI Chat Completions and Anthropic Messages).
- Forcing them to adopt a Forge-specific format slows adoption.
- Pass-through lets Forge be a drop-in proxy that adds policy + audit + cost on top of the wire format clients already speak.

**Pass-through principles:**
1. **Wire-format preservation** — bytes in = bytes out (modulo headers Forge adds).
2. **Forge envelope on top** — every request still carries `metadata.{forge_tenant_id, forge_user_id, forge_run_id, forge_agent_id}` and passes through guardrails + policies + RBAC.
3. **Header injection** — Forge injects `Authorization: Bearer <virtual-key>` and strips any client-supplied `Authorization`.
4. **Streaming preserved** — SSE, WebSocket, and HTTP chunked transfer all work.
5. **Provider detection** — Forge identifies the provider from path prefix or request body, applies provider-specific rules (Bedrock SigV4, Vertex IAM, etc.).
6. **No regressions** — when pass-through is enabled for a client, all prior phases' guarantees still apply.

**Per-provider surface:**

| Provider | Pass-through paths | Notes |
|---|---|---|
| OpenAI | `/openai/*`, `/openai/v1/*`, `/openai_passthrough/*`, `/openai/deployments/{dep}/*` | Full wire-compat with OpenAI API v1. Cursor clients work directly. |
| Anthropic | `/anthropic/*`, `/v1/messages` | Full wire-compat with Anthropic Messages API. |
| Bedrock | `/bedrock/*`, `/bedrock/invoke`, `/bedrock/converse` | AWS SigV4 signing handled by LiteLLM. |
| Vertex AI | `/vertex_ai/*`, `/vertex_ai/discovery/*`, `/vertex_ai/live` | GCP IAM handled by LiteLLM. |
| Gemini | `/gemini/v1/*` | Google AI Studio wire format. |
| Mistral | `/mistral/v1/*` | Mistral wire format. |
| Cohere | `/cohere/v1/*` | Cohere v1 wire format. |
| AssemblyAI | `/assemblyai/v2/*`, `/eu.assemblyai/v2/*` | Audio transcription (EU + US endpoints). |
| Azure | `/azure/*`, `/azure_ai/*` | Azure OpenAI + Azure AI Services. |
| vLLM | `/vllm/*` | Self-hosted vLLM pass-through. |
| Cursor | `/cursor/chat`, `/cursor/v1/chat/completions` | Cursor IDE pass-through. |
| Langfuse | `/langfuse/*` | Langfuse observability hooks. |
| Custom | `/config/pass_through_endpoint/*` | Admin-defined pass-through endpoints. |

**Multimodal endpoints (consolidated):**

| Surface | Endpoints | Notes |
|---|---|---|
| Audio speech | `POST /audio/speech`, `POST /v1/audio/speech` | TTS. Returns audio stream. |
| Audio transcription | `POST /audio/transcriptions`, `POST /v1/audio/transcriptions` | STT. Multipart upload. |
| Image generation | `POST /images/generations`, `POST /v1/images/generations` | DALL-E, Stable Diffusion, etc. |
| Image edits | `POST /images/edits` | Inpainting / outpainting. |
| Video generation | `POST /videos`, `POST /v1/videos`, `GET /v1/videos/{id}/content` | Long-running; status polling. |
| Video remix | `POST /videos/remix` | Remix existing videos. |
| Video edits | `POST /videos/edits` | Edit operations. |
| Video extensions | `POST /videos/extensions` | Extend duration. |
| Video characters | `/videos/characters/*` | Character library. |
| Containers | `/containers/*`, `/v1/containers/*`, `/containers/files/*` | OpenAI Containers (stateful execution). |
| Moderation | `POST /moderations`, `POST /v1/moderations` | Content moderation classifier. |

**Multimodal streaming:**
- Audio speech returns `audio/mpeg` (or chosen format) — proxied as binary stream.
- Image generation returns image bytes — proxied as binary or base64 depending on `response_format`.
- Video generation is async — return job id, poll `/v1/videos/{id}` until ready, then fetch content.
- Containers stream via WebSocket or chunked HTTP.

**Pass-through auth chain:**
- Client → Forge Backend with **no auth** (or session cookie).
- Forge Backend → LiteLLM with virtual key + metadata headers.
- Forge Backend never passes the client's bearer token to LiteLLM.

**Pass-through cost:**
- All pass-through calls produce spend records with `metadata.kind = "passthrough:<provider>"`.
- Cost is attributed to the calling user + agent (if `forge_agent_id` is in metadata).

**Pass-through guardrails:**
- Phase 2 guardrails still apply: pre-call on input, post-call on output.
- Streaming output is checked chunk-by-chunk for `during_call` guardrails.
- Multimodal outputs (images, audio, video) are checked at the URL/manifest level, not byte-by-byte.

**Per-tenant enablement:**
- Pass-through is a tenant-level feature flag.
- Disabled by default; enabled by org-admin per tenant.
- Per-tenant allowlist of providers (some tenants may only have OpenAI pass-through, not Bedrock).

**Cursor compatibility (the marquee use case):**
- A user with the Cursor IDE configures their API base to `https://forge.example.com/openai/v1`.
- Cursor sends OpenAI-format requests; Forge Backend transparently proxies.
- The user's existing Cursor skills / commands work; Forge adds policy + audit + spend invisibly.

**Anthropic compatibility:**
- A user with Anthropic SDK points `base_url` at `https://forge.example.com/anthropic` or `/v1/messages`.
- Same story — transparent proxy, Forge envelope on top.

### LiteLLM endpoints used
- `POST /openai/chat/completions`, `POST /openai/v1/chat/completions`, `POST /openai/v1/responses`, `POST /openai/v1/embeddings`
- `GET /openai/v1/models`, `GET /openai/v1/assistants/*`, `POST /openai/v1/threads/*`, `POST /openai/v1/batches/*`, `POST /openai/v1/files/*`
- `POST /openai_passthrough/*`, `POST /openai/deployments/{dep}/chat/completions`
- `POST /anthropic/v1/messages`, `GET /anthropic/v1/models`
- `POST /bedrock/*`, `POST /bedrock/invoke`, `POST /bedrock/converse`
- `POST /vertex_ai/*`, `POST /vertex_ai/discovery/*`, `POST /vertex_ai/live`
- `POST /gemini/v1/*`, `POST /mistral/v1/*`, `POST /cohere/v1/*`, `POST /assemblyai/v2/*`, `POST /eu.assemblyai/v2/*`
- `POST /azure/*`, `POST /azure_ai/*`
- `POST /vllm/*`
- `POST /cursor/chat`, `POST /cursor/v1/chat/completions`
- `POST /langfuse/*`
- `POST /config/pass_through_endpoint/*`
- `POST /audio/speech`, `POST /v1/audio/speech`, `POST /audio/transcriptions`, `POST /v1/audio/transcriptions`
- `POST /images/generations`, `POST /v1/images/generations`, `POST /images/edits`
- `POST /videos`, `POST /v1/videos`, `POST /v1/videos/{id}/content`, `POST /videos/remix`, `POST /videos/edits`, `POST /videos/extensions`, `/videos/characters/*`
- `POST /containers/*`, `POST /v1/containers/*`, `/containers/files/*`
- `POST /moderations`, `POST /v1/moderations`

### Forge Backend contract
- `GET /api/forge/providers` — list enabled pass-through providers
- `GET /api/forge/providers/:name` — provider detail (paths, capabilities, allowed_for_caller)
- `POST /api/forge/providers/:name/enable` — admin: enable for tenant
- `POST /api/forge/providers/:name/disable` — admin
- `POST /openai/{path}` — pass-through proxy (transparent)
- `POST /anthropic/{path}` — pass-through proxy (transparent)
- `POST /bedrock/{path}` — pass-through proxy
- `POST /vertex_ai/{path}` — pass-through proxy
- `POST /gemini/{path}`, `/mistral/{path}`, `/cohere/{path}`, `/assemblyai/{path}`, `/azure/{path}`, `/vllm/{path}` — pass-through
- `POST /cursor/{path}` — pass-through
- `POST /langfuse/{path}` — pass-through
- `POST /api/forge/media/audio/speech` — multimodal proxy
- `POST /api/forge/media/audio/transcriptions` — multimodal proxy
- `POST /api/forge/media/images/generations` — multimodal proxy
- `POST /api/forge/media/images/edits` — multimodal proxy
- `POST /api/forge/media/videos` — async, returns job
- `GET /api/forge/media/videos/:id` — poll
- `GET /api/forge/media/videos/:id/content` — download
- `POST /api/forge/media/moderations` — moderation proxy
- `POST /api/forge/containers` — containers proxy
- `GET /api/forge/containers/:id` — container status

### Acceptance criteria
1. A `curl` to `POST /openai/v1/chat/completions` with a standard OpenAI request body returns a standard OpenAI response — no Forge-specific fields required in the body.
2. A Cursor IDE client with API base pointing at Forge Backend successfully completes a chat with all Forge policy + audit + spend applied (verified via audit log).
3. Streaming OpenAI SSE through pass-through produces identical chunks to direct LiteLLM call (modulo Forge-injected headers).
4. `POST /anthropic/v1/messages` with an Anthropic-format request returns an Anthropic-format response.
5. A `POST /bedrock/invoke` with AWS-style body works through Forge Backend (LiteLLM handles SigV4).
6. Image generation `POST /api/forge/media/images/generations` returns image bytes or URL within 30s for typical size.
7. Audio transcription `POST /api/forge/media/audio/transcriptions` accepts multipart upload and returns JSON transcription.
8. Video generation is async: returns job id immediately, polls succeed, content download works.
9. Moderation call is fast (<500ms) and produces an audit event with category scores.
10. Disabling a provider at the tenant level returns 403 to all pass-through calls within 60 seconds.

---

## Feature 17 — Realtime / A2A / Long-running Sessions

### Goal
**Forge AI runs agents that don't fit in a request/response.** Realtime voice agents, agent-to-agent handshakes, 12-hour refactor jobs, persistent evaluation runs — all need stateful, long-lived sessions that survive disconnects, scale horizontally, and audit every step.

### Spec

**Session taxonomy:**

| Session type | Use case | Protocol | Max duration |
|---|---|---|---|
| Realtime | Voice agents, live transcription, multimodal streaming | WebSocket (`/v1/realtime`) | 4 hours |
| A2A | Agent-to-agent handshakes, delegation | HTTP + WebSocket (`/a2a`, `/v1/a2a`, `/a2a/message`) | 1 hour |
| Background response | Multi-hour agent runs | SSE polling (`/v1/responses`) | 24 hours |
| Interaction | Anthropic-style cross-provider sessions | HTTP (`/v1beta/interactions`) | 12 hours |
| Assistant thread | Legacy OpenAI Assistants API | HTTP (`/assistants`, `/threads`) | 24 hours |
| Eval | Bulk evaluation runs | HTTP (`/v1/evals`) | 48 hours |

**State management:**
- Every session has a `session_id` (UUID v7) issued by Forge Backend.
- Session state stored in Forge DB with: `{ session_id, type, owner_user_id, agent_id, started_at, last_heartbeat_at, expires_at, status, metadata }`.
- State survives Forge Backend restarts (state in DB, not in-memory).
- `last_heartbeat_at` updated every 30s while session is active.
- Sessions auto-expire after `max_duration`; clients can extend via `POST /sessions/:id/extend`.

**Realtime (`/v1/realtime`):**
- WebSocket upgrade to `/v1/realtime`.
- Client sends: realtime events (audio chunks, text, function calls).
- Server streams: model audio responses, transcriptions, function call results.
- Forge Backend injects Phase 2 guardrails on every text chunk; Phase 3 RBAC; Phase 1 spend per audio second.
- Authentication via `?key=<virtual_key>` query param OR `Authorization` header on WebSocket upgrade.
- Client secrets: `/realtime/client_secrets` issues short-lived (1h) tokens for WebSocket auth.

**Realtime calls (`/realtime/calls`):**
- Outbound realtime calls (Forge agent calling a phone number via Twilio/etc.).
- Same WebSocket protocol; LiteLLM handles PSTN bridging.

**A2A (Agent-to-Agent):**
- Forge exposes `/a2a/.well-known` for discovery (agent card: capabilities, auth, endpoint).
- `POST /a2a/message` for inter-agent messages.
- `POST /v1/a2a` for unified agent-to-agent requests.
- Authentication: agents authenticate with their own virtual key + a per-delegation JWT.
- Handshake: agent A sends delegation request → agent B accepts/declines → context shared → result returned.
- All A2A calls audit-logged with both agent ids.

**Background responses (`/v1/responses`):**
- Start: `POST /api/forge/responses` returns `{ id, status: "queued" }`.
- Poll: `GET /api/forge/responses/:id`.
- Stream: `GET /api/forge/responses/:id/stream` (SSE).
- Append input: `POST /api/forge/responses/:id/input_items`.
- Cancel: `POST /api/forge/responses/:id/cancel`.
- Compact: `POST /api/forge/responses/compact` truncates the context window.

**Interactions (`/v1beta/interactions`):**
- Anthropic-compat session format.
- `POST /interactions`, `GET /interactions`, `POST /interactions/{id}/cancel`.

**Assistants / Threads (legacy):**
- `/assistants/*`, `/threads/*`, `/threads/{id}/messages`, `/threads/{id}/runs`.
- LiteLLM supports this; Forge proxies with Phase 2/3 envelope.
- Used for legacy OpenAI Assistants API compatibility.

**Evals (`/v1/evals`):**
- Long-running bulk evaluation runs.
- `POST /v1/evals` to create, `GET /v1/evals/{id}` to poll, `POST /v1/evals/{id}/cancel` to stop.
- `GET /v1/evals/{id}/runs` and `GET /v1/evals/{id}/runs/{run_id}` for run-level detail.

**Connection management:**
- WebSocket pool per Forge Backend instance (configurable max concurrent).
- On disconnect: 30s grace period for reconnect; state retained.
- After grace period: session marked `disconnected`, can be resumed by `POST /sessions/:id/resume`.
- After `max_duration`: session marked `expired`, no resume.

**State replication:**
- For horizontal scaling, session state can be replicated via Redis pub/sub.
- A reconnecting client can land on any instance and resume.

**Session audit:**
- `forge.sessions.started | heartbeat | resumed | paused | cancelled | expired`
- Every event includes `session_id`, `type`, `duration_ms`, `last_heartbeat_at`.

**Spend attribution:**
- Realtime audio seconds → cost via per-second model cost map.
- A2A delegation cost → attributed to the calling agent.
- Background responses → cost attributed per chunk as in Phase 1.

### LiteLLM endpoints used
- `POST /v1/realtime` (WebSocket), `GET /realtime/calls`, `POST /realtime/client_secrets`
- `POST /v1/a2a`, `POST /a2a`, `POST /a2a/message`, `GET /a2a/.well-known`
- `POST /v1/responses`, `GET /v1/responses`, `GET /v1/responses/{id}`, `POST /v1/responses/{id}/cancel`, `POST /v1/responses/{id}/input_items`, `POST /responses/compact`
- `POST /v1beta/interactions`, `GET /v1beta/interactions`, `POST /v1beta/interactions/{id}/cancel`
- `POST /interactions`, `GET /interactions`, `POST /interactions/{id}/cancel`
- `POST /assistants`, `GET /assistants`, `POST /assistants/{id}`, `GET /assistants/{id}`
- `POST /v1/assistants`, `GET /v1/assistants`, `POST /v1/assistants/{id}`, `GET /v1/assistants/{id}`
- `POST /threads`, `GET /threads`, `POST /threads/{id}`, `GET /threads/{id}`
- `POST /v1/threads`, `GET /v1/threads`, `POST /v1/threads/{id}`, `GET /v1/threads/{id}`
- `POST /threads/{id}/messages`, `GET /threads/{id}/messages`, `POST /v1/threads/{id}/messages`
- `POST /threads/{id}/runs`, `POST /v1/threads/{id}/runs`
- `POST /v1/evals`, `GET /v1/evals`, `GET /v1/evals/{id}`, `POST /v1/evals/{id}/cancel`, `GET /v1/evals/{id}/runs`, `GET /v1/evals/{id}/runs/{run_id}`

### Forge Backend contract
- `WS /api/forge/realtime` — realtime session WebSocket
- `POST /api/forge/realtime/client-secret` — issue short-lived client secret
- `GET /a2a/.well-known` — Forge agent card
- `POST /a2a/message` — incoming agent-to-agent message
- `POST /api/forge/responses` — start background response
- `GET /api/forge/responses/:id` — poll
- `GET /api/forge/responses/:id/stream` — SSE stream
- `POST /api/forge/responses/:id/cancel` — cancel
- `POST /api/forge/responses/:id/input_items` — append input
- `POST /api/forge/responses/compact` — truncate
- `GET /api/forge/sessions` — list active sessions (tenant-scoped)
- `GET /api/forge/sessions/:id` — session detail
- `POST /api/forge/sessions/:id/extend` — extend max duration
- `POST /api/forge/sessions/:id/resume` — resume disconnected session
- `POST /api/forge/evals` — start eval run
- `GET /api/forge/evals/:id` — poll
- `POST /api/forge/evals/:id/cancel` — cancel
- `GET /api/forge/assistants/*`, `/api/forge/threads/*` — legacy OpenAI compat

### Acceptance criteria
1. A realtime session survives a client disconnect + reconnect within 30s without losing context.
2. A realtime audio session runs for 4 hours without dropping or losing chunks.
3. A2A handshake completes between two agents with mutual auth via JWT.
4. Background response started at t=0 is still pollable at t=24h (or marked `expired` cleanly).
5. `POST /api/forge/sessions/:id/extend` doubles the max duration; verified by `expires_at` field change.
6. Compacting a long-running response reduces token count by > 50% while preserving the most recent 10 messages.
7. Evals run of 1000 test cases completes within 1 hour with all results returned.
8. Cancelling a running session within 100ms stops all upstream LiteLLM calls.
9. Session state is replicated across Forge Backend instances; reconnect lands on any instance.
10. Every session event (start, heartbeat, resume, cancel, expire) is in the audit log with `session_id`.

---

## Feature 18 — OAuth / SCIM / SSO

### Goal
**Forge becomes a first-class identity citizen.** Enterprise customers can plug their IdP (Okta, Azure AD, Google Workspace, OneLogin) into Forge via OIDC SSO, provision users/teams via SCIM v2, and use Forge as an OAuth/OIDC provider for downstream apps (including MCP servers).

### Spec

**Identity surfaces:**

| Surface | Direction | Purpose |
|---|---|---|
| OIDC SSO (Forge as RP) | Inbound | Users log into Forge with their corporate IdP |
| OAuth server (Forge as OP) | Outbound | MCP servers, downstream apps, agent integrations authenticate against Forge |
| SCIM v2 (Forge as SP) | Inbound | IdP provisions users/teams into Forge |
| JWT signing | Outbound | Forge issues JWTs for outbound MCP / agent calls |
| JWKS publishing | Both | Verification keys published at `/.well-known/jwks.json` |

**OIDC SSO (Forge as Relying Party):**
- Forge exposes `/sso/readiness` to verify SSO configuration is valid.
- On user login: redirect to IdP authorize URL, receive code, exchange for token, fetch user info, provision user.
- `/get/sso_settings` returns current SSO config.
- `/update/sso_settings` (admin) sets IdP URL, client id, client secret, claim mappings.
- Claim mapping: which IdP claim → Forge role (e.g. `groups:["forge-admin"]` → `org_admin`).

**OAuth Server (Forge as OpenID Provider):**
- `GET /.well-known/openid-configuration` — discovery.
- `GET /.well-known/jwks.json` — public keys for JWT verification.
- `GET /.well-known/oauth-authorization-server` — OAuth server metadata.
- `GET /.well-known/oauth-authorization-server/mcp/{name}` — MCP-specific OAuth server metadata.
- `GET /.well-known/oauth-protected-resource` — protected resource metadata.
- `POST /authorize` — authorization endpoint (login flow).
- `POST /token` — token endpoint (exchange code for token).
- `POST /register` — dynamic client registration.
- `POST /fallback/login` — fallback for when SSO is unavailable.

**SCIM v2:**
- 18 endpoints under `/scim/v2/*` per the SCIM 2.0 spec.
- User lifecycle: create, read, update, delete, list, search.
- Group lifecycle: same, with member management.
- Filter support: `GET /scim/v2/Users?filter=userName eq "…"` etc.
- PATCH operations for partial updates.
- Bulk operations for mass provisioning.
- Service-provider config at `/scim/v2/ServiceProviderConfig`.
- Resource types at `/scim/v2/ResourceTypes`.
- Schemas at `/scim/v2/Schemas`.

**JWT signing:**
- Forge issues JWTs for outbound MCP calls.
- `/jwt/key/*` manages signing keys (create, rotate, delete, list).
- `/.well-known/jwks.json` publishes public keys.
- Verification: LiteLLM's MCPJWTSigner validates against JWKS.

**Token lifecycle:**
- Access tokens: 1h TTL.
- Refresh tokens: 30d TTL, rotating.
- Client credentials: long-lived, scoped to specific MCP servers / agents.
- Audience claim required for all tokens.
- Scope claims enforce granular permissions (e.g. `forge.chat`, `forge.rag.read`).

**SSO readiness (`/sso/readiness`):**
- Returns `{ ready, missing_config[], errors[] }` — UI shows admins what's missing.
- Validates: IdP URL reachable, client credentials valid, claim mappings resolve, JWKS accessible.

**Fallback login (`/fallback/login`):**
- Emergency local-auth path when SSO is broken.
- Disabled by default; enabled per tenant.
- All fallback logins audit-logged with `auth_method: "fallback"`.

**Tenant configuration:**
- SSO is per-tenant; some tenants may use SSO, others local auth.
- SCIM requires SSO to be enabled.
- OAuth server is platform-level (one per Forge instance).

**Migration:**
- Existing Forge tenants can opt into SSO without losing users (link local accounts via email verification).
- User de-provisioning via SCIM DELETE → soft-delete in Forge (30-day grace, then hard delete).

### LiteLLM endpoints used
- `GET /.well-known/openid-configuration`
- `GET /.well-known/jwks.json`
- `GET /.well-known/oauth-authorization-server`
- `GET /.well-known/oauth-authorization-server/mcp/{name}`
- `GET /.well-known/oauth-protected-resource`
- `POST /authorize`, `POST /token`, `POST /register`
- `POST /fallback/login`
- `GET /sso/readiness`
- `/scim/v2/*` (18 endpoints: Users, Groups, ServiceProviderConfig, ResourceTypes, Schemas, Bulk, Filter, Search, Patch, etc.)
- `/jwt/key/*`
- `/get/sso_settings`, `/update/sso_settings`
- `GET /.well-known/litellm-ui-config`

### Forge Backend contract
- `GET /api/forge/identity/sso/status` — current SSO config + readiness
- `POST /api/forge/identity/sso/configure` — admin: set SSO
- `POST /api/forge/identity/sso/test` — test IdP connection
- `GET /api/forge/identity/scim/status` — SCIM endpoint info (for IdP config)
- `POST /api/forge/identity/scim/token` — admin: rotate SCIM token
- `GET /.well-known/openid-configuration` — published at root
- `GET /.well-known/jwks.json` — published at root
- `GET /api/forge/identity/oauth/clients` — list registered OAuth clients
- `POST /api/forge/identity/oauth/clients` — register client
- `DELETE /api/forge/identity/oauth/clients/:id` — revoke
- `GET /api/forge/identity/jwt/keys` — list signing keys
- `POST /api/forge/identity/jwt/keys` — admin: create key
- `DELETE /api/forge/identity/jwt/keys/:id` — admin: delete key

### Acceptance criteria
1. Configuring Okta SSO via `/api/forge/identity/sso/configure` results in successful login flow within 30s.
2. SCIM v2 `POST /scim/v2/Users` from Okta creates a Forge user within 5s.
3. SCIM v2 `DELETE /scim/v2/Users/:id` soft-deletes the Forge user; user cannot log in but data retained for 30d.
4. SCIM v2 `PATCH /scim/v2/Users/:id` with `{ active: false }` deactivates the Forge user immediately.
5. `/.well-known/jwks.json` returns a valid JWKS with at least one active signing key.
6. OAuth server metadata at `/.well-known/oauth-authorization-server` validates against the OIDC spec.
7. An MCP server receiving a Forge-issued JWT verifies it against the JWKS successfully.
8. `fallback/login` is disabled by default; attempt to use it returns 403.
9. Token rotation via `/api/forge/identity/jwt/keys` does not invalidate in-flight tokens (signing key rotation supported).
10. SSO readiness check `/api/forge/identity/sso/status` returns `ready: true` within 1s after valid configuration.

---

## Feature 19 — Cache (cost reduction at scale)

### Goal
**Cut LLM cost 30%+ on production workloads** by caching identical or near-identical requests, with predictable invalidation, tenant isolation, and full cost-savings visibility.

### Spec

**Cache strategies (composable):**

| Strategy | Use case | Hit detection |
|---|---|---|
| **Exact match** | Identical prompt + params | Hash of `(model, messages, temperature, tools, …)` |
| **Semantic** | Near-identical prompts (cosine > 0.95) | Embedding similarity |
| **Prefix** | Long system prompts / few-shot | Common prefix across requests |
| **Tool result** | Identical tool calls | Hash of `(tool_name, arguments)` |

**Cache keys:**
- Scoped per `(tenant_id, model, virtual_key_id)`.
- Never shared across tenants (compliance).
- Optional: shared across team within tenant (admin-toggled).

**Cache backend:**
- Redis primary.
- LiteLLM exposes cache config via `/cache/settings` and `/cache/settings/update`.
- Forge Backend uses Redis directly for cache control + metrics; uses LiteLLM for actual caching.
- `/cache/ping` checks connectivity.
- `/cache/redis/info` exposes backend stats.
- `/cache/delete`, `/cache/flushall` for invalidation.

**TTL policies:**
- Default: 1 hour.
- Per-cache-type: configurable (exact 1h, semantic 24h, prefix 4h, tool 15min).
- Per-tenant override.

**Cache invalidation:**
- TTL expiry (automatic).
- Manual: `POST /api/forge/cache/invalidate` (admin) clears specific keys, namespaces, or all.
- Triggered: when a guardrail or policy changes, all matching cache entries are invalidated.
- Triggered: when a model is updated in the cost map, cost-tagged cache entries are invalidated.

**Cache hit behavior:**
- On hit: return cached response, do NOT call upstream LLM.
- Spend record is created with `metadata.kind = "cache_hit"`, `cost_usd = 0`.
- Audit event `forge.cache.hit` with `{ cache_key_hash, hit_type, ttl_remaining }`.
- For semantic cache: store similarity score in audit event for offline analysis.

**Cache miss behavior:**
- Normal LLM call; response cached after completion.
- Audit event `forge.cache.miss` then `forge.cache.stored` with TTL.

**Cache metrics:**
- Hit rate per tenant, per model, per cache type.
- Cost savings per tenant (USD and %).
- p50/p95 hit latency (should be < 10ms).
- Storage size per tenant.
- Eviction rate.

**Cache settings (`/cache/settings`):**
- Enable/disable per cache type.
- TTL per cache type.
- Semantic similarity threshold (default 0.95).
- Max cache size per tenant.
- Namespace isolation mode.

**Compliance:**
- PII-marked content is never cached (Phase 2 guardrail integration).
- Cached responses retain the original cost metadata for audit.
- Tenant-offboard purges all cache entries.

**Cost impact reporting:**
- Dashboard widget: "Cache savings this month: $X (Y% of total spend)".
- Per-tenant breakdown.
- Per-model breakdown (some models benefit more from caching than others).

**Edge cases:**
- Streaming responses: only the final aggregated response is cached (not individual chunks).
- Tool calls: cache the full post-tool-call response, not individual tool calls (unless tool-result cache is enabled).
- Reasoning content: cached along with the response.

### LiteLLM endpoints used
- `POST /cache/ping`
- `POST /cache/delete`
- `POST /cache/flushall`
- `GET /cache/redis/info`
- `GET /cache/settings`, `POST /cache/settings/update`

### Forge Backend contract
- `GET /api/forge/cache/status` — overall cache health
- `GET /api/forge/cache/metrics?tenant_id&since=24h` — hit rate, savings, latency
- `GET /api/forge/cache/settings` — current settings
- `POST /api/forge/cache/settings` — admin: update
- `POST /api/forge/cache/invalidate` — admin: invalidate by key/namespace/all
- `GET /api/forge/cache/savings?tenant_id&since=30d` — savings report
- `GET /api/forge/cache/keys` — admin: list cached keys (paginated, with size)
- `WS /api/forge/cache/events` — real-time cache events for UI

### Acceptance criteria
1. After 24h of production traffic, cache hit rate is ≥ 30% on a representative workload.
2. Cache hit p95 latency is < 10ms.
3. Cached response is byte-identical to original (for exact match).
4. Semantic cache returns the cached response for queries with similarity ≥ 0.95.
5. Cache invalidation via `/api/forge/cache/invalidate` clears specified keys within 1s.
6. Tenant A's cache never serves tenant B's requests (verified by attempting a cross-tenant cache probe).
7. PII-marked content is never stored in cache (verified by attempting to cache a PII-tagged request).
8. Cost savings report reconciles to the spend log difference within 0.1%.
9. Guardrail update invalidates affected cache entries within 60s.
10. `/api/forge/cache/flushall` (admin, double-confirmed) clears all cache within 5s.

---

## Feature 20 — Settings / Credentials / Vault / FinOps

### Goal
**Forge's operational surface is enterprise-grade.** Provider credentials are vault-backed and never in plaintext, FinOps exports feed CloudZero / Vantage for cost allocation, all internal settings are admin-tunable, and the platform supports the full operations lifecycle.

### Spec

**Provider credentials:**
- LiteLLM credentials model: `{ credential_name, credential_values: { api_key, api_base, … }, credential_info: { provider, … } }`.
- CRUD: `/credentials`, `/credentials/by_name`, `/credentials/by_model`.
- Forge Backend NEVER stores raw credentials; references them by `credential_name`.
- LiteLLM-backed credentials can be vault-backed (HashiCorp Vault).

**HashiCorp Vault integration (`/config_overrides/hashicorp_vault/*`):**
- 4 endpoints for Vault config: get, update, test, list.
- LiteLLM reads secrets directly from Vault at request time.
- Forge Backend never sees the raw secret value — only the reference path.
- Vault path format: `secret/data/litellm/{provider}/{key_name}`.

**FinOps — CloudZero (`/cloudzero/*`):**
- 5 endpoints: init, dry-run, export, delete, settings.
- `POST /cloudzero/init` configures CloudZero API key + account mapping.
- `POST /cloudzero/dry-run` previews the export without sending.
- `POST /cloudzero/export` sends cost + usage to CloudZero.
- `DELETE /cloudzero` removes the integration.
- `GET /cloudzero/settings` returns current config.

**FinOps — Vantage (`/vantage/*`):**
- 5 endpoints: init, dry-run, export, delete, settings.
- Same shape as CloudZero but for Vantage.

**Cost allocation:**
- Tag-based cost attribution: Phase 3 tags flow through to CloudZero/Vantage as cost dimensions.
- Per-tenant, per-team, per-project, per-agent, per-user breakdowns.
- Daily granularity (default); hourly optional.

**Settings (`/settings`):**
- Global LiteLLM settings — admin only.
- Includes: default models, allowed providers, rate limits, default policies.

**UI configuration (`/get/*`, `/update/*`):**
- `/get/ui_theme_settings`, `/update/ui_theme_settings` — branding (colors, logo).
- `/get/ui_settings`, `/update/ui_settings` — feature flags for the admin UI.
- `/get/internal_user_settings`, `/update/internal_user_settings` — defaults for new users.
- `/get/default_team_settings`, `/update/default_team_settings` — defaults for new teams.
- `/get/mcp_semantic_filter_settings`, `/update/mcp_semantic_filter_settings` — MCP tool filtering.

**Branding (`/upload/logo`):**
- Logo upload (PNG / SVG / JPEG, max 2MB).
- Used in admin UI, login screen, email templates.

**Email event settings (`/email/event_settings`):**
- 3 endpoints: get, update, reset.
- Configures when Forge sends transactional emails: budget warnings, key rotations, SSO failures, etc.

**Callbacks (`/callbacks/*`):**
- `/active/callbacks` lists active callbacks.
- `/callbacks/list` lists registered callback types.
- `/callbacks/configs` lists callback configurations.
- `/callback` webhook receiver for LiteLLM-emitted events.

**Routing & debug:**
- `/routes` lists all LiteLLM routes (capability discovery — already used in Phase 1).
- `/debug/asyncio-tasks` debug view of async tasks.

**Cost configuration:**
- `/config/cost_discount_config` — discount tiers per customer.
- `/config/cost_margin_config` — margin per model.
- These feed into Phase 1's cost computation.

**Public endpoints:**
- `/litellm/.well-known` — LiteLLM-specific discovery.
- `/robots.txt` — search engine directives.
- `/public/endpoints`, `/public/litellm_model_cost_map`, `/public/litellm_blog_posts`, `/public/providers`, `/public/agents`, `/public/agent_hub`, `/public/mcp_hub` — already used in Phase 1/2; consolidated here.

**Tenant fallback login (`/fallback/login`):**
- Already covered in Feature 18; listed here for completeness.

**Audit:**
- All settings changes emit `forge.settings.updated` with old + new value.
- All credential changes emit `forge.credentials.added | updated | deleted` (without exposing values).
- FinOps exports emit `forge.finops.exported | dry_run_completed | init_changed | deleted` with destination + record count.

### LiteLLM endpoints used
- `GET /credentials`, `POST /credentials`, `/credentials/by_name`, `/credentials/by_model`
- `/config_overrides/hashicorp_vault/*` (4 endpoints)
- `POST /cloudzero/init`, `POST /cloudzero/dry-run`, `POST /cloudzero/export`, `DELETE /cloudzero`, `GET /cloudzero/settings`
- `POST /vantage/init`, `POST /vantage/dry-run`, `POST /vantage/export`, `DELETE /vantage`, `GET /vantage/settings`
- `GET /settings`, `POST /settings`
- `/get/ui_theme_settings`, `/update/ui_theme_settings`, `/get/ui_settings`, `/update/ui_settings`
- `/get/internal_user_settings`, `/update/internal_user_settings`, `/get/default_team_settings`, `/update/default_team_settings`
- `/get/mcp_semantic_filter_settings`, `/update/mcp_semantic_filter_settings`
- `POST /upload/logo`
- `/email/event_settings`, `/email/event_settings/reset`
- `GET /active/callbacks`, `GET /callbacks/list`, `GET /callbacks/configs`, `POST /callback`
- `GET /routes`, `GET /debug/asyncio-tasks`
- `POST /config/cost_discount_config`, `POST /config/cost_margin_config`
- `GET /litellm/.well-known`, `GET /robots.txt`
- `/public/*` (endpoints, model_hub, providers, agents, agent_hub, mcp_hub, litellm_model_cost_map, litellm_blog_posts)
- `POST /fallback/login`

### Forge Backend contract
- `GET /api/forge/credentials` — admin: list (no secrets)
- `POST /api/forge/credentials` — admin: add (write-only — value never returned)
- `GET /api/forge/credentials/:name` — admin: detail (no secrets)
- `DELETE /api/forge/credentials/:name` — admin: remove
- `GET /api/forge/vault/status` — Vault config status
- `POST /api/forge/vault/configure` — admin: configure Vault
- `POST /api/forge/vault/test` — admin: test Vault connection
- `GET /api/forge/finops/cloudzero/settings`
- `POST /api/forge/finops/cloudzero/init`
- `POST /api/forge/finops/cloudzero/dry-run`
- `POST /api/forge/finops/cloudzero/export`
- `DELETE /api/forge/finops/cloudzero`
- `GET /api/forge/finops/vantage/settings`, `POST /api/forge/finops/vantage/init`, `POST /api/forge/finops/vantage/dry-run`, `POST /api/forge/finops/vantage/export`, `DELETE /api/forge/finops/vantage`
- `GET /api/forge/settings` — global settings
- `PATCH /api/forge/settings` — admin: update
- `GET /api/forge/branding` — current branding (logo URL, colors)
- `POST /api/forge/branding/logo` — upload logo
- `PATCH /api/forge/branding/theme` — update theme
- `GET /api/forge/email/settings`, `PATCH /api/forge/email/settings`, `POST /api/forge/email/settings/reset`
- `GET /api/forge/callbacks` — list active callbacks
- `GET /api/forge/cost/config` — discount + margin config
- `PATCH /api/forge/cost/config` — admin: update

### Acceptance criteria
1. Adding a credential via `POST /api/forge/credentials` stores it via LiteLLM; the value is never returned in any subsequent GET.
2. Vault-backed credentials work end-to-end: LiteLLM fetches at request time; Forge DB has only the path reference.
3. CloudZero dry-run produces a valid export payload without sending; full export sends within 60s.
4. CloudZero export reconciles to within 0.5% of authoritative spend log (verified monthly).
5. Vantage export works identically to CloudZero.
6. Branding update reflects in admin UI within 60s.
7. Email event setting update changes which emails are sent within 5min (event-driven, not polled).
8. Cost discount + margin config affects the cost reported in spend records (verified by changing margin and observing delta).
9. `GET /routes` (LiteLLM capability discovery) matches the route counts in `forge-litellm-integration.md` (524 paths).
10. Settings change audit events include old + new values (diffs are computable).

---

## Cross-Cutting Concerns

### Audit events (new in Phase 4)
- `forge.providers.enabled | disabled | accessed`
- `forge.media.audio_generated | transcribed | image_generated | image_edited | video_started | video_completed | moderation_run`
- `forge.sessions.started | heartbeat | resumed | paused | cancelled | expired`
- `forge.a2a.handshake | delegated | received`
- `forge.identity.sso_configured | sso_login | scim_user_provisioned | scim_user_deprovisioned | scim_user_updated | oauth_client_registered | jwt_key_rotated | fallback_login_used`
- `forge.cache.hit | miss | stored | invalidated | settings_changed`
- `forge.credentials.added | updated | deleted | vault_configured`
- `forge.finops.cloudzero_init | cloudzero_dry_run | cloudzero_exported | cloudzero_deleted | vantage_init | vantage_dry_run | vantage_exported | vantage_deleted`
- `forge.settings.updated | branding_updated | email_settings_updated | cost_config_updated`

### Error envelope (additions)
- `PassThroughDisabled` (403) — `{ provider }`
- `RealtimeAuthExpired` (401) — `{ session_id }`
- `RealtimeSessionExpired` (410) — `{ session_id, expired_at }`
- `SessionResumeWindowExpired` (410) — `{ session_id, grace_ended_at }`
- `SSOMisconfigured` (503) — `{ missing[] }`
- `SCIMTokenInvalid` (401)
- `CacheBackendUnreachable` (503) — `{ backend, last_ok_at }`
- `CredentialNotFound` (404) — `{ credential_name }`
- `CloudZeroExportFailed` (502) — `{ run_id, error }`
- `VantageExportFailed` (502) — `{ run_id, error }`
- `VaultUnreachable` (503) — `{ vault_path }`

### Rate limits (additions)
- Realtime connections: 100/tenant (configurable).
- A2A delegations: 1000/hour/agent.
- Background responses: 50 concurrent/tenant.
- SCIM operations: 1000/hour (IdP side).
- Pass-through calls: same as chat (600/min/agent).
- Cache invalidation: 10/min/admin (heavy op).

### Composition: Phase 4 with all prior phases
```
Phase 1 (foundation)        — every Phase 4 call uses virtual keys + models + spend
Phase 2 (safety)            — every Phase 4 call passes through guardrails + policies
Phase 3 (productivity)      — RBAC gates all Phase 4 features
Phase 4 features:
  16. Pass-through + Media  — transparent proxy with full envelope
  17. Realtime / A2A        — stateful sessions, 24h durability
  18. Identity              — SSO / SCIM / OAuth / JWT
  19. Cache                 — cost reduction on prior features
  20. Ops + FinOps          — admin surface + cost export
```

---

## Data Flow (Phase 4 — Realtime example)

```
┌─────────────┐  WebSocket   ┌─────────────────┐  WebSocket    ┌─────────────────┐
│  Forge UI   │ ◄──────────► │  Forge Backend  │ ◄───────────► │  LiteLLM        │
│  (voice UI) │   audio      │  (session mgmt) │   realtime    │  /v1/realtime   │
└─────────────┘              │                 │               └─────────────────┘
                             │  Phase 1-3 envelope:                  │
                             │  · keys · policies · guardrails       │
                             │  · RBAC · spend · audit               │
                             └─────────────────┘
                                       │
                                       ▼
                              ┌──────────────────┐
                              │   Forge DB       │
                              │   sessions table │
                              │   + audit log    │
                              └──────────────────┘
```

---

## Build Order (within Phase 4)

1. **Feature 19: Cache** — biggest immediate ROI; unlocks cost savings on every prior feature.
2. **Feature 16: Provider Pass-through + Media** — biggest adoption unlock; Cursor-compat alone justifies Phase 4.
3. **Feature 18: OAuth / SCIM / SSO** — required for enterprise sale; relatively isolated.
4. **Feature 20: Ops / Credentials / FinOps** — operations maturity; needed by enterprise security review.
5. **Feature 17: Realtime / A2A** — most complex (stateful, long-running); benefits from being last so all prior envelopes are battle-tested.

**Verification gate after each feature:** acceptance criteria met + Phase 1/2/3 regression suite still green.

---

## Anti-Patterns (auto-reject if seen)

- ❌ Pass-through call that skips Phase 2 guardrails.
- ❌ Realtime session with in-memory state (must survive restarts).
- ❌ SCIM token logged or returned in any API response.
- ❌ JWT signing key in plaintext anywhere outside Vault.
- ❌ Cache that crosses tenant boundaries.
- ❌ PII-tagged content stored in cache.
- ❌ Credentials returned in any GET response (only POST write, never read).
- ❌ CloudZero/Vantage export that doesn't reconcile to spend log within 0.5%.
- ❌ Background response running > 24h without explicit extension.
- ❌ Pass-through that strips provider-required headers (Bedrock SigV4, Vertex IAM).

---

## Deliverables for Phase 4

1. `forge-providers.md` — full pass-through matrix, per-provider quirks, Cursor/Anthropic compat
2. `forge-media.md` — audio / image / video / moderation surface
3. `forge-realtime.md` — WebSocket lifecycle, session state, heartbeat, resume
4. `forge-a2a.md` — agent-to-agent protocol, discovery, handshakes
5. `forge-identity.md` — SSO, SCIM v2, OAuth server, JWT signing, JWKS
6. `forge-cache.md` — strategies, invalidation, metrics, tenant isolation, savings
7. `forge-finops.md` — CloudZero + Vantage export, cost allocation tags, reconciliation
8. `forge-ops.md` — credentials, vault, settings, branding, email, callbacks
9. `forge-phase4-audit-events.md` — every new audit event with payload schema
10. `forge-phase4-error-codes.md` — every new error type with retry semantics
11. `forge-phase4-verification.md` — acceptance criteria checklist with evidence per feature
12. `forge-phase4-enterprise-readiness.md` — SOC 2 control mapping, InfoSec checklist, audit log attestation

---

## Out of Scope for Phase 4

**Nothing.** Phase 4 is the last phase. After it ships, the LiteLLM integration is feature-complete against the `1.82.6` spec. Future work would be:
- LiteLLM version upgrades (each new release may add endpoints)
- Provider-specific features not yet in LiteLLM (e.g. new model families)
- Forge-specific extensions that don't have LiteLLM counterparts (e.g. ForgeDB-specific optimizations)

---

## Final State — All 4 Phases Complete

When all 4 phases ship, Forge Backend covers:

| Phase | Features | New LiteLLM endpoints exercised | Cumulative coverage |
|---|---|---|---|
| 1 | Config, Models, Keys, Chat SSE, Spend | ~50 | ~50 |
| 2 | Guardrails, Policies, MCP, Skills, Tools | ~80 | ~130 |
| 3 | Prompts, RBAC, RAG, Async, Audit/Health/Compliance | ~100 | ~230 |
| 4 | Pass-through + Media, Realtime/A2A, Identity, Cache, Ops/FinOps | ~150 | **~380 of 703** |

The remaining ~323 endpoints are:
- Internal LiteLLM admin endpoints not exposed via Forge (debug, asyncio tasks, raw routes)
- OpenAI legacy endpoints (assistants/threads) accessible via Feature 17
- Provider-specific endpoints (Bedrock list-models, Vertex discovery) accessible via Feature 16
- Public endpoints used by Phase 1–4 (cost map, public providers)

This is the right level of coverage for an enterprise-grade AI engineering platform.
