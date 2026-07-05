# Reference: API Catalog (All Backend Routes)

<!-- AUTO-GENERATED. DO NOT EDIT. Regenerate via ./scripts/gen-api-catalog.py -->

> **Status:** ✅ Auto-generated
> **Doc owner:** Platform team
> **Source of truth:** `backend/app/api/v1/`
> **Last regenerated:** 2026-07-06
> **Total routes:** 638
> **Total router files:** 110

---

## Purpose

Canonical inventory of every backend REST route. For per-feature route
semantics, see `docs/features/<feature>.md`.

## Conventions

- All routes under `/api/v1/`
- All mutating routes have `@audit(action=..., target_type=...)`
- All mutations have RBAC permission guards
- All POST/PUT/PATCH send `Idempotency-Key: <uuid-v4>`
- All list endpoints return `Page[T]`

## Routes by file

### `admin.py` — 3 routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/cache/purge` |  |
| `GET` | `/api/v1/health` |  |
| `GET` | `/api/v1/stats` |  |

### `admin_llm_gateway.py` — 12 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/guardrails` | List configured LiteLLM guardrails. |
| `POST` | `/api/v1/guardrails/{name}/disable` | Disable a LiteLLM guardrail by name. |
| `POST` | `/api/v1/guardrails/{name}/enable` | Enable a LiteLLM guardrail by name. |
| `GET` | `/api/v1/health` | Return the cached LiteLLM health snapshot. |
| `GET` | `/api/v1/mcp-servers` | List the LiteLLM MCP servers (read-only). |
| `GET` | `/api/v1/models` | LiteLLM model catalog with per-million-token pricing. |
| `GET` | `/api/v1/spend/models` | Per-model spend breakdown — direct passthrough to /spend/models. |
| `GET` | `/api/v1/spend/teams` | Per-team spend aggregation (LiteLLM /team/list). |
| `GET` | `/api/v1/tenants/{tenant_id}` | Return the tenant's LLM gateway config (model, budget, guardrails). |
| `GET` | `/api/v1/tenants/{tenant_id}/keys` | Return the tenant's Virtual Key metadata. |
| `POST` | `/api/v1/tenants/{tenant_id}/keys/rotate` | Rotate the tenant's Virtual Key and return the new metadata. |
| `POST` | `/api/v1/tenants/{tenant_id}/keys/{key_id}/revoke` | Revoke a specific Virtual Key (by audit row id) for a tenant. |

### `agent_assignments.py` — 2 routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/` |  |
| `GET` | `/api/v1/` |  |

### `agent_config.py` — 3 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/` | List every project-level agent configuration. |
| `GET` | `/api/v1/{agent_id}` | Read the project config for one agent. |
| `PATCH` | `/api/v1/{agent_id}` | Upsert the project config for one agent. |

### `agent_runtimes.py` — 4 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/` |  |
| `POST` | `/api/v1/start` |  |
| `GET` | `/api/v1/{handle_id}/metrics` |  |
| `POST` | `/api/v1/{handle_id}/stop` |  |

### `agents.py` — 6 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/` |  |
| `POST` | `/api/v1/` |  |
| `GET` | `/api/v1/{agent_id}` |  |
| `PATCH` | `/api/v1/{agent_id}` |  |
| `DELETE` | `/api/v1/{agent_id}` |  |
| `POST` | `/api/v1/{agent_id}/test` |  |

### `analytics_usage.py` — 3 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/quota` | Per-tenant quota state for the Billing tab progress bar. |
| `GET` | `/api/v1/usage` | Per-tenant LLM usage aggregate (cost, tokens, calls, by-model, by-user). |
| `GET` | `/api/v1/usage/workflow/{run_id}` | Per-workflow usage drill-down for ``/analytics/usage/workflow/[id]``. |

### `approvals.py` — 3 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/` |  |
| `POST` | `/api/v1/` |  |
| `POST` | `/api/v1/{approval_id}/decide` |  |

### `architecture/acceptance.py` — 6 routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/acceptance/generate` | Produce Given/When/Then criteria from an ADR, contract, or breakdown. |
| `GET` | `/api/v1/acceptance/{criteria_id}` |  |
| `POST` | `/api/v1/acceptance/{criteria_id}/link-test` |  |
| `POST` | `/api/v1/acceptance/{criteria_id}/validate` |  |
| `GET` | `/api/v1/context-usage/{artifact_id}` |  |
| `GET` | `/api/v1/coverage` |  |

### `architecture/adrs.py` — 4 routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/` | Generate a new ADR from the supplied context. |
| `GET` | `/api/v1/` | List ADRs for a project, optionally filtered by status. |
| `GET` | `/api/v1/{adr_id}` |  |
| `POST` | `/api/v1/{adr_id}/supersede` | Chain the old ADR's id into the new one's `related_adrs`. |

### `architecture/approvals.py` — 5 routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/` | Open a new approval request for an artifact. |
| `GET` | `/api/v1/` | List approvals scoped to the caller's tenant. |
| `GET` | `/api/v1/{approval_id}` |  |
| `POST` | `/api/v1/{approval_id}/cancel` |  |
| `POST` | `/api/v1/{approval_id}/decide` |  |

### `architecture/contracts.py` — 5 routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/` |  |
| `GET` | `/api/v1/` |  |
| `GET` | `/api/v1/{contract_id}` |  |
| `POST` | `/api/v1/{contract_id}/publish` |  |
| `POST` | `/api/v1/{contract_id}/validate` |  |

### `architecture/risk_registers.py` — 6 routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/` | Derive a risk register from an ADR, task breakdown, or idea. |
| `GET` | `/api/v1/` |  |
| `GET` | `/api/v1/{register_id}` |  |
| `POST` | `/api/v1/{register_id}/risks` |  |
| `PATCH` | `/api/v1/{register_id}/risks/{risk_id}` |  |
| `GET` | `/api/v1/{register_id}/top` |  |

### `architecture/security_reports.py` — 5 routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/` | Create a deployment-relevant security finding. |
| `GET` | `/api/v1/` | List rows, filtered by severity/category/status when supplied. |
| `GET` | `/api/v1/posture` | Aggregate roll-up used by the SecurityPostureCard. |
| `GET` | `/api/v1/{report_id}` |  |
| `PATCH` | `/api/v1/{report_id}/status` | Move the row through its lifecycle: open → mitigating → closed. |

### `architecture/standards.py` — 4 routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/attest` | Run the standard checks for an artifact and record the outcome. |
| `GET` | `/api/v1/attestations` |  |
| `POST` | `/api/v1/attestations/{attestation_id}/revoke` | Revoke a previously issued attestation (forge-admin only). |
| `GET` | `/api/v1/check/{artifact_type}/{artifact_id}` | List applicable standards and whether they're met (no audit row). |

### `architecture/task_breakdowns.py` — 4 routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/` | Generate a task breakdown from a source artifact (ADR, contract, etc.). |
| `GET` | `/api/v1/` |  |
| `GET` | `/api/v1/{breakdown_id}` |  |
| `PATCH` | `/api/v1/{breakdown_id}/tasks/{task_id}` |  |

### `architecture/traceability.py` — 4 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/breaking-changes/{contract_id}` |  |
| `GET` | `/api/v1/lineage/{artifact_type}/{artifact_id}` |  |
| `GET` | `/api/v1/orphans` |  |
| `GET` | `/api/v1/traceability` |  |

### `architecture/versions.py` — 4 routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/versions` |  |
| `GET` | `/api/v1/versions` |  |
| `GET` | `/api/v1/versions/diff` |  |
| `POST` | `/api/v1/versions/rollback` |  |

### `artifacts.py` — 2 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/` | List active artifacts (optionally filtered by type). |
| `POST` | `/api/v1/` |  |

### `audit.py` — 4 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/` | List audit events for the caller's tenant. |
| `GET` | `/api/v1/integrity` | WORM chain integrity status for the caller's tenant. |
| `GET` | `/api/v1/llm-traffic` | LLM traffic audit — proxied from LiteLLM /spend/logs. |
| `GET` | `/api/v1/settings/{project_id}` | Settings-scoped audit log (members, roles, env vars, agent config). |

### `auth.py` — 8 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/jwks.json` | Expose the backend's RS256 public key as a JWKS document. |
| `POST` | `/api/v1/logout` | Revoke the cached proxy_token (step-65). |
| `GET` | `/api/v1/me` | Return the principal backing the current bearer token. |
| `PATCH` | `/api/v1/me` | Self-service profile update (Settings → Profile). |
| `GET` | `/api/v1/me/tenants` | List every tenant the calling user belongs to (step-61 Zone 1). |
| `POST` | `/api/v1/oidc/callback` | Exchange a Keycloak authorization code for Forge JWTs. |
| `POST` | `/api/v1/refresh` | Trade a Forge refresh token for a fresh access token. |
| `GET` | `/api/v1/sso/config` | Read-only SSO config (Settings → SSO). |

### `auth_sessions.py` — 2 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/` | List the principal's sessions (Settings → Sessions). |
| `DELETE` | `/api/v1/{session_id}` | Revoke a session (Settings → Sessions). |

### `auth_tokens.py` — 3 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/` | List all API tokens for the current user (Settings → API Tokens). |
| `POST` | `/api/v1/` | Issue a new API token. Plaintext secret returned exactly once. |
| `DELETE` | `/api/v1/{token_id}` | Revoke a token. Idempotent — already-revoked rows return 204. |

### `commands.py` — 4 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/{name}/artifact` | Read the SKILL.md for a forge-* command. |
| `PUT` | `/api/v1/{name}/artifact` | Write the SKILL.md for a forge-* command. |
| `POST` | `/api/v1/{name}/run` | Dispatch a single ``forge-*`` command. |
| `GET` | `/api/v1/{name}/runs` | Return recent run records for a single command. |

### `connector_activity.py` — 1 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/activity` | M3-G1 — Activity tab timeline feed. |

### `connector_credentials.py` — 5 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/` |  |
| `POST` | `/api/v1/` |  |
| `DELETE` | `/api/v1/{credential_id}` |  |
| `POST` | `/api/v1/{credential_id}/reveal` |  |
| `POST` | `/api/v1/{credential_id}/rotate` |  |

### `connector_events.py` — 1 routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/observed` | Receive one TS-side connector event and re-publish on the Python bus. |

### `connector_lifecycle.py` — 4 routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/install` | Install a new connector and immediately probe it. |
| `POST` | `/api/v1/{connector_id}/disconnect` | M3-G2 — soft-delete a connector (idempotent). |
| `POST` | `/api/v1/{connector_id}/rotate` | Rotate credentials on an existing connector. |
| `POST` | `/api/v1/{connector_id}/test` | Probe a connector's reachability + record a health-history row. |

### `connector_oauth.py` — 2 routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/oauth/callback` | M3-G4 — Complete an OAuth install. |
| `POST` | `/api/v1/oauth/start` | M3-G3 — Start an OAuth install for a marketplace slug. |

### `connectors.py` — 7 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/` |  |
| `POST` | `/api/v1/` |  |
| `GET` | `/api/v1/{connector_id}` |  |
| `PATCH` | `/api/v1/{connector_id}` |  |
| `DELETE` | `/api/v1/{connector_id}` |  |
| `GET` | `/api/v1/{connector_id}/history` |  |
| `POST` | `/api/v1/{connector_id}/sync` |  |

### `copilot.py` — 8 routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/conversations` | Run one chat turn end-to-end. |
| `GET` | `/api/v1/conversations` | List the caller's conversations in the tenant. |
| `GET` | `/api/v1/conversations/{conversation_id}` | Fetch a conversation + messages (caller-scoped). |
| `DELETE` | `/api/v1/conversations/{conversation_id}` | Soft-delete (archive) the caller's conversation. |
| `GET` | `/api/v1/conversations/{conversation_id}/cost` | Return running cost + budget status for the conversation. |
| `POST` | `/api/v1/conversations:stream` | Stream one chat turn as Server-Sent Events. |
| `POST` | `/api/v1/messages/{message_id}/feedback` | Record a thumbs-up/down + comment on an assistant message. |
| `GET` | `/api/v1/tools` | Steward-facing tool catalog. |

### `dashboard.py` — 15 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/activity` |  |
| `GET` | `/api/v1/alerts` |  |
| `POST` | `/api/v1/alerts/read-all` |  |
| `POST` | `/api/v1/alerts/{alert_id}/read` |  |
| `GET` | `/api/v1/insights` |  |
| `POST` | `/api/v1/insights/{insight_id}/dismiss` |  |
| `POST` | `/api/v1/insights/{insight_id}/read` |  |
| `GET` | `/api/v1/kpis` |  |
| `GET` | `/api/v1/layout` |  |
| `PUT` | `/api/v1/layout` |  |
| `GET` | `/api/v1/pinned` |  |
| `POST` | `/api/v1/pinned` |  |
| `PATCH` | `/api/v1/pinned/reorder` |  |
| `DELETE` | `/api/v1/pinned/{pin_id}` |  |
| `GET` | `/api/v1/top-providers` |  |

### `env_vars.py` — 5 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/` | List env-var metadata. Values are NEVER returned. |
| `POST` | `/api/v1/` | Create a new encrypted env var. |
| `PATCH` | `/api/v1/{env_var_id}` | Update an env var's value / description / scope / visibility. |
| `DELETE` | `/api/v1/{env_var_id}` | Delete an env var (irreversible). |
| `POST` | `/api/v1/{env_var_id}/reveal` | Decrypt and return an env var's value. Audit row written by decorator. |

### `feature_flags.py` — 2 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/` | Merge system + tenant overrides; expose all known keys. |
| `PATCH` | `/api/v1/{key}` | Set a per-tenant override for ``key``. |

### `forge_async.py` — 21 routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/batches` |  |
| `GET` | `/api/v1/batches` |  |
| `GET` | `/api/v1/batches/{batch_id}` |  |
| `POST` | `/api/v1/batches/{batch_id}/cancel` |  |
| `GET` | `/api/v1/batches/{batch_id}/results` |  |
| `POST` | `/api/v1/files` |  |
| `GET` | `/api/v1/files/{file_id}` |  |
| `DELETE` | `/api/v1/files/{file_id}` |  |
| `GET` | `/api/v1/files/{file_id}/content` |  |
| `POST` | `/api/v1/fine-tuning/jobs` |  |
| `GET` | `/api/v1/fine-tuning/jobs` |  |
| `GET` | `/api/v1/fine-tuning/jobs/{job_id}` |  |
| `POST` | `/api/v1/fine-tuning/jobs/{job_id}/cancel` |  |
| `GET` | `/api/v1/health/ws` |  |
| `POST` | `/api/v1/jobs/ws` | ponytail: WS at this path would need a dedicated WebSocket |
| `POST` | `/api/v1/responses` |  |
| `POST` | `/api/v1/responses/compact` |  |
| `GET` | `/api/v1/responses/{response_id}` |  |
| `POST` | `/api/v1/responses/{response_id}/cancel` |  |
| `POST` | `/api/v1/responses/{response_id}/input_items` |  |
| `GET` | `/api/v1/responses/{response_id}/stream` |  |

### `forge_chat.py` — 3 routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/chat/cancel` | Signal the stream registry to abort ``body.run_id``. |
| `GET` | `/api/v1/chat/runs/{run_id}` | Live registry first; falls back to the persisted spend record. |
| `POST` | `/api/v1/chat/stream` | Stream Forge SSE envelopes for ``body.agent_id``. |

### `forge_health.py` — 1 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/health` | Phase 1 trust-root probe — no secrets returned. |

### `forge_keys.py` — 5 routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/agents/{agent_id}/key/issue` | Mint a virtual key via the broker. Caller-scoped to tenant. |
| `POST` | `/api/v1/agents/{agent_id}/key/revoke` | Block the upstream key + mark the row revoked. Admin only. |
| `POST` | `/api/v1/agents/{agent_id}/key/rotate` | Mint a new key + block the old upstream alias. Old + new |
| `GET` | `/api/v1/agents/{agent_id}/key/status` | Tenant-scoped lookup. 404 when there is no active row. |
| `GET` | `/api/v1/keys` | Tenant-scoped rollup. Returns one ``ForgeKeyStatus`` per agent |

### `forge_models.py` — 4 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/models` | Merge caller-allow, master registry, and cost map; cached 5/60/24h. |
| `GET` | `/api/v1/models/groups` | Groups don't intersect with the caller's allow-list — admin surface. |
| `POST` | `/api/v1/models/refresh` | Admin-only cache bust. Audit fires inside the service. |
| `GET` | `/api/v1/models/{model_id}` | Master-key view; caller-scope lives on the list endpoint. |

### `forge_observability.py` — 17 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/alerts/active` |  |
| `GET` | `/api/v1/audit` |  |
| `GET` | `/api/v1/audit/{event_id}` |  |
| `GET` | `/api/v1/budget/{tenant_id}` | Return the tenant's current budget status (Phase 6 SC-6.1). |
| `GET` | `/api/v1/compliance/eu-ai-act` |  |
| `POST` | `/api/v1/compliance/gdpr/delete` |  |
| `GET` | `/api/v1/compliance/gdpr/export` |  |
| `POST` | `/api/v1/event-logging` |  |
| `GET` | `/api/v1/health/extended` | Aggregate /health/{history,latest,backlog,license} from LiteLLM. |
| `GET` | `/api/v1/health/services` |  |
| `GET` | `/api/v1/in-product-nudges` |  |
| `GET` | `/api/v1/metrics/latency` |  |
| `GET` | `/api/v1/metrics/rate-limits` |  |
| `GET` | `/api/v1/metrics/spend-drift` |  |
| `GET` | `/api/v1/orgs/{org_id}/alerts` |  |
| `POST` | `/api/v1/orgs/{org_id}/alerts` |  |
| `POST` | `/api/v1/webhooks/callback` | Receive LiteLLM webhooks (budget exhausted, key blocked, health changed). |

### `forge_phase4/cache.py` — 7 routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/invalidate` |  |
| `GET` | `/api/v1/keys` |  |
| `GET` | `/api/v1/metrics` |  |
| `GET` | `/api/v1/savings` |  |
| `GET` | `/api/v1/settings` |  |
| `POST` | `/api/v1/settings` |  |
| `GET` | `/api/v1/status` |  |

### `forge_phase4/identity.py` — 12 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/jwt/keys` |  |
| `POST` | `/api/v1/jwt/keys` |  |
| `POST` | `/api/v1/jwt/keys/rotate` |  |
| `DELETE` | `/api/v1/jwt/keys/{key_id}` |  |
| `GET` | `/api/v1/oauth/clients` |  |
| `POST` | `/api/v1/oauth/clients` |  |
| `DELETE` | `/api/v1/oauth/clients/{client_id}` |  |
| `GET` | `/api/v1/scim/status` |  |
| `POST` | `/api/v1/scim/token` |  |
| `POST` | `/api/v1/sso/configure` |  |
| `GET` | `/api/v1/sso/status` |  |
| `POST` | `/api/v1/sso/test` |  |

### `forge_phase4/media.py` — 10 routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/audio/speech` |  |
| `POST` | `/api/v1/audio/transcriptions` |  |
| `POST` | `/api/v1/containers` |  |
| `GET` | `/api/v1/containers/{container_id}` |  |
| `POST` | `/api/v1/images/edits` |  |
| `POST` | `/api/v1/images/generations` |  |
| `POST` | `/api/v1/moderations` |  |
| `POST` | `/api/v1/videos` | Async video generation — returns job id immediately. |
| `GET` | `/api/v1/videos/{job_id}` |  |
| `GET` | `/api/v1/videos/{job_id}/content` |  |

### `forge_phase4/ops.py` — 21 routes

| Method | Path | Description |
|---|---|---|
| `PATCH` | `/api/v1/branding/theme` |  |
| `GET` | `/api/v1/callbacks` |  |
| `GET` | `/api/v1/cost/config` |  |
| `PATCH` | `/api/v1/cost/config` |  |
| `GET` | `/api/v1/credentials` |  |
| `POST` | `/api/v1/credentials` |  |
| `GET` | `/api/v1/credentials/{name}` |  |
| `DELETE` | `/api/v1/credentials/{name}` |  |
| `GET` | `/api/v1/email/settings` |  |
| `PATCH` | `/api/v1/email/settings` |  |
| `POST` | `/api/v1/email/settings/reset` |  |
| `DELETE` | `/api/v1/finops/{destination}` |  |
| `POST` | `/api/v1/finops/{destination}/dry-run` |  |
| `POST` | `/api/v1/finops/{destination}/export` |  |
| `POST` | `/api/v1/finops/{destination}/init` |  |
| `GET` | `/api/v1/finops/{destination}/settings` |  |
| `GET` | `/api/v1/settings` |  |
| `PATCH` | `/api/v1/settings` |  |
| `POST` | `/api/v1/vault/configure` |  |
| `GET` | `/api/v1/vault/status` |  |
| `POST` | `/api/v1/vault/test` |  |

### `forge_phase4/providers.py` — 4 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/` |  |
| `GET` | `/api/v1/{name}` |  |
| `POST` | `/api/v1/{name}/disable` |  |
| `POST` | `/api/v1/{name}/enable` |  |

### `forge_phase4/sessions.py` — 10 routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/a2a/message` |  |
| `POST` | `/api/v1/realtime/client-secret` |  |
| `POST` | `/api/v1/realtime/sessions` |  |
| `POST` | `/api/v1/responses` | Start a background response session (Anthropic-compat / OpenAI Responses). |
| `GET` | `/api/v1/sessions` |  |
| `GET` | `/api/v1/sessions/{session_id}` |  |
| `POST` | `/api/v1/sessions/{session_id}/cancel` |  |
| `POST` | `/api/v1/sessions/{session_id}/extend` |  |
| `POST` | `/api/v1/sessions/{session_id}/heartbeat` |  |
| `POST` | `/api/v1/sessions/{session_id}/resume` |  |

### `forge_prompts.py` — 11 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/` |  |
| `POST` | `/api/v1/` |  |
| `POST` | `/api/v1/import-dotprompt` |  |
| `GET` | `/api/v1/{prompt_id}` |  |
| `PATCH` | `/api/v1/{prompt_id}` |  |
| `POST` | `/api/v1/{prompt_id}/archive` |  |
| `POST` | `/api/v1/{prompt_id}/count` |  |
| `GET` | `/api/v1/{prompt_id}/diff` |  |
| `POST` | `/api/v1/{prompt_id}/preview` |  |
| `POST` | `/api/v1/{prompt_id}/test` |  |
| `GET` | `/api/v1/{prompt_id}/versions` |  |

### `forge_rag.py` — 14 routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/embeddings` |  |
| `GET` | `/api/v1/embeddings/models` |  |
| `POST` | `/api/v1/ocr` |  |
| `GET` | `/api/v1/projects/{project_id}/vector-stores` |  |
| `POST` | `/api/v1/projects/{project_id}/vector-stores` |  |
| `POST` | `/api/v1/rag/ingest` |  |
| `POST` | `/api/v1/rag/query` |  |
| `POST` | `/api/v1/rag/rerank` |  |
| `GET` | `/api/v1/rag/stats` |  |
| `GET` | `/api/v1/search-tools` |  |
| `POST` | `/api/v1/search-tools/{tool_id}/test` |  |
| `DELETE` | `/api/v1/vector-stores/{vs_id}` |  |
| `POST` | `/api/v1/vector-stores/{vs_id}/files` |  |
| `GET` | `/api/v1/vector-stores/{vs_id}/search` |  |

### `forge_rbac.py` — 37 routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/admin/bootstrap-tenant` |  |
| `GET` | `/api/v1/customers` |  |
| `POST` | `/api/v1/customers` |  |
| `PATCH` | `/api/v1/customers/{customer_id}` |  |
| `DELETE` | `/api/v1/customers/{customer_id}` |  |
| `POST` | `/api/v1/customers/{customer_id}/block` |  |
| `GET` | `/api/v1/customers/{customer_id}/daily` |  |
| `POST` | `/api/v1/customers/{customer_id}/unblock` |  |
| `GET` | `/api/v1/orgs` |  |
| `POST` | `/api/v1/orgs` |  |
| `GET` | `/api/v1/orgs/{org_id}` |  |
| `PATCH` | `/api/v1/orgs/{org_id}` |  |
| `DELETE` | `/api/v1/orgs/{org_id}` |  |
| `GET` | `/api/v1/orgs/{org_id}/daily` |  |
| `GET` | `/api/v1/projects` |  |
| `POST` | `/api/v1/projects` |  |
| `GET` | `/api/v1/projects/{project_id}` |  |
| `PATCH` | `/api/v1/projects/{project_id}` |  |
| `DELETE` | `/api/v1/projects/{project_id}` |  |
| `GET` | `/api/v1/teams` |  |
| `POST` | `/api/v1/teams` |  |
| `GET` | `/api/v1/teams/{team_id}` |  |
| `POST` | `/api/v1/teams/{team_id}/block` |  |
| `GET` | `/api/v1/teams/{team_id}/daily` |  |
| `GET` | `/api/v1/teams/{team_id}/members` |  |
| `POST` | `/api/v1/teams/{team_id}/members` |  |
| `POST` | `/api/v1/teams/{team_id}/members/bulk` |  |
| `PATCH` | `/api/v1/teams/{team_id}/members/{user_id}` |  |
| `DELETE` | `/api/v1/teams/{team_id}/members/{user_id}` |  |
| `POST` | `/api/v1/teams/{team_id}/model/add` |  |
| `POST` | `/api/v1/teams/{team_id}/model/delete` |  |
| `GET` | `/api/v1/teams/{team_id}/permissions_list` |  |
| `POST` | `/api/v1/teams/{team_id}/permissions_update` |  |
| `POST` | `/api/v1/teams/{team_id}/unblock` |  |
| `GET` | `/api/v1/users` |  |
| `GET` | `/api/v1/users/available` | Invite picker — every user in the tenant that is not already a team member. |
| `GET` | `/api/v1/users/{user_id}/daily` |  |

### `forge_spend.py` — 5 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/spend/agents/{agent_id}` | Per-agent totals. 404 when there are zero rows in the window. |
| `POST` | `/api/v1/spend/backfill` | Admin-only. Idempotent — safe to re-run for the same window. |
| `GET` | `/api/v1/spend/cost-meter/{run_id}` | Lookup the latest spend record for an in-flight/just-finished run. |
| `GET` | `/api/v1/spend/summary` | Dashboard rollup scoped to the caller's tenant (Rule 2). |
| `GET` | `/api/v1/spend/tenants/{tenant_id}` | Admin-only: cross-tenant visibility for billing/ops. |

### `governance_core.py` — 8 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/approvals` |  |
| `POST` | `/api/v1/approvals/{approval_id}/accept` |  |
| `POST` | `/api/v1/approvals/{approval_id}/decline` |  |
| `GET` | `/api/v1/board-confirmations` |  |
| `POST` | `/api/v1/board-confirmations` |  |
| `GET` | `/api/v1/policies` | List compliance policies (projected from the rule table). |
| `POST` | `/api/v1/policies/{policy_id}/accept` |  |
| `GET` | `/api/v1/rbac-roles` | List RBAC roles for the caller's tenant. |

### `governance_violations.py` — 4 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/violations` | Violations = LiteLLM requests that failed guardrails or over-budget. |
| `POST` | `/api/v1/violations/poll` | Manual poll trigger — returns violations since last poll. |
| `POST` | `/api/v1/violations/{violation_id}/reopen` | Re-open a previously resolved violation. |
| `POST` | `/api/v1/violations/{violation_id}/resolve` | Mark a violation as resolved. Returns the updated violation summary. |

### `guardrails.py` — 10 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/` | List the LiteLLM guardrail catalog (read-only). |
| `POST` | `/api/v1/` | Admin register. Idempotent on ``guardrail_name`` (AC #7, #8). |
| `GET` | `/api/v1/submissions` | Submissions log; every row carries ``latency_ms`` (AC #6). |
| `POST` | `/api/v1/test-custom-code` | Validate custom-code guardrail before deploy (AC #5). |
| `GET` | `/api/v1/ui` |  |
| `POST` | `/api/v1/ui` |  |
| `GET` | `/api/v1/ui/{rule_id}` |  |
| `GET` | `/api/v1/{name}` |  |
| `PATCH` | `/api/v1/{name}` | Update via the register path (idempotent on name — AC #7, #8). |
| `POST` | `/api/v1/{name}/test` | Dry-run a guardrail against sample text. |

### `health.py` — 1 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/health` | Liveness + dependency check. |

### `hooks.py` — 6 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/` |  |
| `POST` | `/api/v1/` |  |
| `GET` | `/api/v1/{hook_id}` |  |
| `PATCH` | `/api/v1/{hook_id}` |  |
| `DELETE` | `/api/v1/{hook_id}` |  |
| `POST` | `/api/v1/{hook_id}/test` |  |

### `ideation/approvals.py` — 5 routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/` |  |
| `GET` | `/api/v1/` |  |
| `POST` | `/api/v1/{approval_id}/assign` |  |
| `POST` | `/api/v1/{approval_id}/decide` |  |
| `POST` | `/api/v1/{approval_id}/delegate` |  |

### `ideation/arch_previews.py` — 3 routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/{idea_id}/arch-preview` |  |
| `GET` | `/api/v1/{idea_id}/arch-preview` |  |
| `POST` | `/api/v1/{idea_id}/arch-preview/regenerate` |  |

### `ideation/customer_voice.py` — 1 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/` | List customer-voice clusters for the tenant. |

### `ideation/destinations.py` — 1 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/` | List push destinations for the tenant. |

### `ideation/enhance.py` — 1 routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/{idea_id}/enhance` |  |

### `ideation/ideas.py` — 11 routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/` |  |
| `GET` | `/api/v1/` |  |
| `POST` | `/api/v1/extract-entities` | Lightweight NER endpoint for the intake UI. |
| `POST` | `/api/v1/validate` | Standalone validation pass — useful for the UI before submit. |
| `GET` | `/api/v1/{idea_id}` |  |
| `PATCH` | `/api/v1/{idea_id}` |  |
| `GET` | `/api/v1/{idea_id}/analysis` |  |
| `POST` | `/api/v1/{idea_id}/analyze` |  |
| `POST` | `/api/v1/{idea_id}/archive` |  |
| `POST` | `/api/v1/{idea_id}/artifacts` |  |
| `POST` | `/api/v1/{idea_id}/reanalyze` |  |

### `ideation/impact.py` — 2 routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/impact/compare` |  |
| `GET` | `/api/v1/{idea_id}/impact-graph` |  |

### `ideation/ingest_status.py` — 1 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/status` |  |

### `ideation/kg_graph.py` — 3 routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/ideas/{idea_id}/kg` |  |
| `POST` | `/api/v1/ideas/{idea_id}/related` |  |
| `GET` | `/api/v1/projects/{project_id}/idea-graph` |  |

### `ideation/market_signals.py` — 2 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/` | List market signals for the tenant. |
| `POST` | `/api/v1/synthesize` | Manually trigger the synthesizer for the tenant. |

### `ideation/output_bundles.py` — 3 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/bundles/{bundle_id}` |  |
| `GET` | `/api/v1/bundles/{bundle_id}/export` |  |
| `POST` | `/api/v1/ideas/{idea_id}/bundles` |  |

### `ideation/prds.py` — 5 routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/ideas/{idea_id}/prd` |  |
| `GET` | `/api/v1/ideas/{idea_id}/prd` |  |
| `POST` | `/api/v1/prds/{prd_id}/approve` |  |
| `PATCH` | `/api/v1/prds/{prd_id}/sections/{section}` |  |
| `POST` | `/api/v1/prds/{prd_id}/submit` |  |

### `ideation/push.py` — 5 routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/{idea_id}/push/all` | Push to every configured target. |
| `POST` | `/api/v1/{idea_id}/push/architecture` |  |
| `POST` | `/api/v1/{idea_id}/push/confluence` |  |
| `GET` | `/api/v1/{idea_id}/push/history` |  |
| `POST` | `/api/v1/{idea_id}/push/jira` |  |

### `ideation/roadmaps.py` — 8 routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/` |  |
| `GET` | `/api/v1/` |  |
| `GET` | `/api/v1/{roadmap_id}` |  |
| `PATCH` | `/api/v1/{roadmap_id}` |  |
| `POST` | `/api/v1/{roadmap_id}/approve` |  |
| `POST` | `/api/v1/{roadmap_id}/items` |  |
| `DELETE` | `/api/v1/{roadmap_id}/items/{idea_id}` |  |
| `POST` | `/api/v1/{roadmap_id}/regenerate` |  |

### `ideation/scoring.py` — 4 routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/score/batch` |  |
| `POST` | `/api/v1/{idea_id}/score` |  |
| `GET` | `/api/v1/{idea_id}/score` |  |
| `POST` | `/api/v1/{idea_id}/score/override` |  |

### `ideation/sources.py` — 3 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/` | List configured puller targets for the current tenant. |
| `PATCH` | `/api/v1/{source_id}` | Patch the connector's ``config`` JSON. |
| `POST` | `/api/v1/{source_id}/sync` | Trigger the configured puller for one source. |

### `ideation/workflows.py` — 4 routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/ideas/{idea_id}/start` |  |
| `GET` | `/api/v1/{session_id}` |  |
| `POST` | `/api/v1/{session_id}/complete` |  |
| `POST` | `/api/v1/{session_id}/intervene` |  |

### `knowledge_graph.py` — 10 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/edges` |  |
| `GET` | `/api/v1/nodes` |  |
| `GET` | `/api/v1/nodes/{node_id}` |  |
| `GET` | `/api/v1/nodes/{node_id}/backlinks` |  |
| `GET` | `/api/v1/nodes/{node_id}/freshness` |  |
| `POST` | `/api/v1/query/cypher` |  |
| `POST` | `/api/v1/query/hybrid` |  |
| `POST` | `/api/v1/query/sql` |  |
| `POST` | `/api/v1/search/vector` |  |
| `GET` | `/api/v1/stats` |  |

### `lessons.py` — 4 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/` |  |
| `GET` | `/api/v1/digest` |  |
| `POST` | `/api/v1/{lesson_id}/approve` |  |
| `POST` | `/api/v1/{lesson_id}/reject` |  |

### `marketplace.py` — 3 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/` |  |
| `GET` | `/api/v1/{slug}` |  |
| `POST` | `/api/v1/{slug}/install` |  |

### `mcp.py` — 11 routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/call` |  |
| `GET` | `/api/v1/categories` |  |
| `GET` | `/api/v1/hub` | Public catalog — rate-limited at the upstream proxy. |
| `GET` | `/api/v1/servers` |  |
| `POST` | `/api/v1/servers` | Admin register a new MCP server (spec §"Server registry"). |
| `GET` | `/api/v1/servers/{name}` |  |
| `DELETE` | `/api/v1/servers/{name}` |  |
| `POST` | `/api/v1/servers/{name}/auth/refresh` |  |
| `GET` | `/api/v1/servers/{name}/auth/status` |  |
| `POST` | `/api/v1/servers/{name}/test` |  |
| `GET` | `/api/v1/servers/{name}/tools` |  |

### `members.py` — 4 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/` | List active members and pending invitations for a project. |
| `POST` | `/api/v1/invite` | Invite an email to join the project with a given role. |
| `PATCH` | `/api/v1/{member_id}` | Change a member's role on this project. |
| `DELETE` | `/api/v1/{member_id}` | Remove a member from this project. |

### `model_providers.py` — 7 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/` |  |
| `POST` | `/api/v1/` |  |
| `GET` | `/api/v1/resolve/{model_alias:path}` |  |
| `GET` | `/api/v1/{provider_id}` |  |
| `PATCH` | `/api/v1/{provider_id}` |  |
| `DELETE` | `/api/v1/{provider_id}` |  |
| `POST` | `/api/v1/{provider_id}/test` |  |

### `onboarding.py` — 6 routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/provision` | Kick off the 5-stage provisioning job. |
| `GET` | `/api/v1/provision/status` | Return the latest provisioning job for the calling tenant. |
| `POST` | `/api/v1/sessions` |  |
| `GET` | `/api/v1/sessions/{session_id}` |  |
| `POST` | `/api/v1/sessions/{session_id}/advance` |  |
| `POST` | `/api/v1/sessions/{session_id}/cancel` |  |

### `persona_memory.py` — 2 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/{key}` |  |
| `POST` | `/api/v1/{key}` |  |

### `policies.py` — 16 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/` |  |
| `POST` | `/api/v1/` |  |
| `GET` | `/api/v1/attachments` |  |
| `POST` | `/api/v1/attachments` |  |
| `POST` | `/api/v1/compare` |  |
| `POST` | `/api/v1/resolve` | Spec §Feature 7 ``/policies/resolve`` (AC #1, #2, #4). |
| `GET` | `/api/v1/status` |  |
| `GET` | `/api/v1/templates` |  |
| `POST` | `/api/v1/templates/{template_id}/clone` |  |
| `GET` | `/api/v1/tool-policy` |  |
| `GET` | `/api/v1/tool-policy/options` |  |
| `GET` | `/api/v1/usage` |  |
| `GET` | `/api/v1/{policy_id}` |  |
| `PATCH` | `/api/v1/{policy_id}` |  |
| `POST` | `/api/v1/{policy_id}/archive` |  |
| `POST` | `/api/v1/{policy_id}/test` |  |

### `projects.py` — 9 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/` | List every project in the caller's tenant, newest first. |
| `POST` | `/api/v1/` | Create a new project in the caller's tenant. |
| `GET` | `/api/v1/{project_id}` | Read a single project by id (tenant-scoped). |
| `PATCH` | `/api/v1/{project_id}` | Update a project's editable fields (tenant-scoped). |
| `POST` | `/api/v1/{project_id}/bootstrap` |  |
| `GET` | `/api/v1/{project_id}/bootstrap` |  |
| `POST` | `/api/v1/{project_id}/bootstrap/rerun` |  |
| `GET` | `/api/v1/{project_id}/bootstrap/status` |  |
| `GET` | `/api/v1/{project_id}/settings/counts` | Aggregate counts that drive SettingsSidebar badges. |

### `qa.py` — 3 routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/ask` |  |
| `GET` | `/api/v1/sessions/{session_id}` |  |
| `DELETE` | `/api/v1/sessions/{session_id}` |  |

### `rbac.py` — 2 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/` |  |
| `POST` | `/api/v1/` |  |

### `repos.py` — 9 routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/` |  |
| `GET` | `/api/v1/` |  |
| `POST` | `/api/v1/discover` |  |
| `DELETE` | `/api/v1/ingestions/{run_id}` |  |
| `GET` | `/api/v1/{repo_id}` |  |
| `PATCH` | `/api/v1/{repo_id}` |  |
| `POST` | `/api/v1/{repo_id}/ingest` |  |
| `GET` | `/api/v1/{repo_id}/ingestions` |  |
| `GET` | `/api/v1/{repo_id}/status` |  |

### `roles.py` — 2 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/` | List every role in the caller's tenant. |
| `PATCH` | `/api/v1/{role_id}` | Update a tenant-defined role's name / description / permissions. |

### `runs.py` — 12 routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/` | Start a new SDLC run for a project. |
| `GET` | `/api/v1/` | List runs for the caller's tenant, optionally filtered by project / status. |
| `GET` | `/api/v1/_default_budget` | GET /api/v1/runs/_default_budget — per-tenant default ceiling snapshot. |
| `GET` | `/api/v1/{run_id}` |  |
| `GET` | `/api/v1/{run_id}/artifacts` |  |
| `GET` | `/api/v1/{run_id}/budget` | GET /api/v1/runs/{run_id}/budget — per-RUN cumulative cap snapshot. |
| `POST` | `/api/v1/{run_id}/cancel` |  |
| `GET` | `/api/v1/{run_id}/cost` |  |
| `GET` | `/api/v1/{run_id}/explainability` | GET /api/v1/runs/{id}/explainability — CodeRabbit 5-question bundle. |
| `POST` | `/api/v1/{run_id}/replay` | POST /api/v1/runs/{run_id}/replay — replay a finished run (M6-G1). |
| `POST` | `/api/v1/{run_id}/resume` |  |
| `GET` | `/api/v1/{run_id}/stream` | SSE endpoint: emit one ``data:`` line per state snapshot. |

### `runtime_management.py` — 4 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/agents` |  |
| `POST` | `/api/v1/agents/{handle_id}/restart` |  |
| `POST` | `/api/v1/agents/{handle_id}/stop` |  |
| `GET` | `/api/v1/metrics` |  |

### `scheduler.py` — 2 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/jobs` | Return registered jobs (id, name, next_run_time, trigger). |
| `POST` | `/api/v1/jobs/{job_id}/run` | Run ``job_id`` immediately and return a status payload. |

### `seeds.py` — 8 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/` | List all seed packages visible to the caller (RBAC ``seeds:view``). |
| `GET` | `/api/v1/{name}` | Return the full manifest for ``name`` (RBAC ``seeds:view``). |
| `POST` | `/api/v1/{name}/apply` | Apply a seed idempotently (RBAC ``seeds:manage``). |
| `GET` | `/api/v1/{name}/diff` | Compare manifest-declared row counts to live DB (RBAC ``seeds:view``). |
| `POST` | `/api/v1/{name}/reset` | Reset (delete) rows owned by a seed. |
| `POST` | `/api/v1/{name}/rollback` | Roll back the most recent apply (RBAC ``seeds:manage``). |
| `GET` | `/api/v1/{name}/runs` | Return recent run history for a seed (RBAC ``seeds:view``). |
| `GET` | `/api/v1/{name}/status` | Return durable state + drift for a seed (RBAC ``seeds:view``). |

### `skills.py` — 8 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/` |  |
| `POST` | `/api/v1/` |  |
| `GET` | `/api/v1/hub` |  |
| `POST` | `/api/v1/hub/import` |  |
| `POST` | `/api/v1/preview` |  |
| `GET` | `/api/v1/{skill_id}` |  |
| `PATCH` | `/api/v1/{skill_id}` |  |
| `POST` | `/api/v1/{skill_id}/archive` |  |

### `standards.py` — 2 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/` | Combine LiteLLM guardrails + manual attestations for the tenant. |
| `POST` | `/api/v1/` | Add a new manual attestation (regulatory standard). |

### `steering_rules.py` — 5 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/` | List steering rules for the current project (RLS-scoped). |
| `POST` | `/api/v1/` | Add (or upsert) a steering rule file for the current project. |
| `GET` | `/api/v1/catalog` | Return the in-memory catalog for the current project (if built). |
| `GET` | `/api/v1/inject/{stage}` | Return the rule markdown content to inject before ``stage``. |
| `DELETE` | `/api/v1/{rule_id}` | Remove a steering rule by DB id or rule_id slug. |

### `stories.py` — 17 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/` |  |
| `POST` | `/api/v1/` |  |
| `GET` | `/api/v1/` |  |
| `GET` | `/api/v1/current` |  |
| `GET` | `/api/v1/stories` |  |
| `POST` | `/api/v1/stories` |  |
| `PATCH` | `/api/v1/stories/bulk` |  |
| `GET` | `/api/v1/stories/{story_id}` |  |
| `PATCH` | `/api/v1/stories/{story_id}` |  |
| `DELETE` | `/api/v1/stories/{story_id}` |  |
| `GET` | `/api/v1/stories/{story_id}/comments` |  |
| `POST` | `/api/v1/stories/{story_id}/comments` |  |
| `POST` | `/api/v1/stories/{story_id}/link-jira` |  |
| `GET` | `/api/v1/stories/{story_id}/linked` |  |
| `POST` | `/api/v1/stories/{story_id}/start-implementation` |  |
| `POST` | `/api/v1/stories/{story_id}/sync-jira` |  |
| `POST` | `/api/v1/{sprint_id}/start` |  |

### `system.py` — 1 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/features` | Return the current feature flag set. |

### `templates.py` — 2 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/` |  |
| `POST` | `/api/v1/` |  |

### `tenants.py` — 5 routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/` | Create a new workspace and mirror the caller into it as owner. |
| `GET` | `/api/v1/{tenant_id}` | Minimal read for confirmation UIs (no permission gate — the |
| `GET` | `/api/v1/{tenant_id}/branding` |  |
| `PATCH` | `/api/v1/{tenant_id}/branding` | Replace the branding block atomically. Audit captures before/after |
| `POST` | `/api/v1/{tenant_id}/switch` | Mint a fresh access token scoped to ``tenant_id``. |

### `terminal_broadcast.py` — 3 routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/sessions/{session_id}/broadcast/grant` | Grant broadcast write capability (RBAC: forge-admin). |
| `POST` | `/api/v1/sessions/{session_id}/broadcast/revoke` | Revoke broadcast write capability (RBAC: forge-admin). |
| `GET` | `/api/v1/sessions/{session_id}/broadcasters` | List current observers / writers for a session. |

### `terminal_commands.py` — 3 routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/commands/launch` | Launch a terminal session bound to a forge-* command. |
| `POST` | `/api/v1/sessions/{session_id}/inject` | Pipe a command into a running session. |
| `GET` | `/api/v1/sessions/{session_id}/output` | Poll buffered session output since the given cursor. |

### `terminal_context.py` — 3 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/sessions/{session_id}/context` | Top-N inline context items for a session. |
| `POST` | `/api/v1/sessions/{session_id}/context/refresh` | Force-refresh the inline context cache. |
| `GET` | `/api/v1/sessions/{session_id}/context/{item_id}` | Get a specific context item by id. |

### `terminal_costs.py` — 4 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/burn-rate` | Tenant-level USD/hour burn rate derived from LiteLLM /spend. |
| `GET` | `/api/v1/costs` | Cost entries for the caller's tenant, recent N days. |
| `GET` | `/api/v1/sessions/{session_id}/cost` | Cost summary for a single session. |
| `GET` | `/api/v1/sessions/{session_id}/cost/estimate` | Backward-compatible what-if cost estimate for a session. |

### `terminal_export.py` — 3 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/sessions/{session_id}/export` | Render the session in the requested format and return it as a file. |
| `GET` | `/api/v1/sessions/{session_id}/export/history` | List prior exports for a session. |
| `POST` | `/api/v1/sessions/{session_id}/export/upload` | Render the export and return a (mock) signed URL. |

### `terminal_sessions.py` — 1 routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/sessions` | Mint a new terminal session and return its server-issued id. |

### `tool_bundles.py` — 2 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/` | List every stage's effective bundle (default or override). |
| `PUT` | `/api/v1/{stage}` | Apply a Steward override for a single stage. Audited in F-005. |

### `tools.py` — 8 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/` |  |
| `GET` | `/api/v1/search-tools` |  |
| `POST` | `/api/v1/search-tools/{tool_id}/test` |  |
| `GET` | `/api/v1/{name}` |  |
| `DELETE` | `/api/v1/{name}` |  |
| `GET` | `/api/v1/{name}/logs` |  |
| `GET` | `/api/v1/{name}/overrides` |  |
| `PUT` | `/api/v1/{name}/overrides` |  |

### `users.py` — 2 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/notifications` | Return the principal's notification preferences. |
| `PATCH` | `/api/v1/notifications` | Partial update — only fields explicitly set are written. |

### `validation_reports.py` — 3 routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/` | Submit a ValidationReport. |
| `GET` | `/api/v1/` | List ValidationReports, optionally filtered by commit_sha. |
| `GET` | `/api/v1/{report_id}` | Retrieve a single ValidationReport by its internal artifact id. |

### `webhooks.py` — 2 routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/github/pre-commit` | GitHub pre-commit webhook — returns 200 (allow) or 403 (block). |
| `POST` | `/api/v1/github/pre-commit/lock` | Same as ``/github/pre-commit`` but always returns 403 on FAIL. |

### `webhooks_full.py` — 4 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/` |  |
| `POST` | `/api/v1/` |  |
| `GET` | `/api/v1/{webhook_id}/deliveries` |  |
| `POST` | `/api/v1/{webhook_id}/test` | Record a synthetic test delivery. The actual outbound HTTP call |

### `workflows.py` — 17 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/` |  |
| `POST` | `/api/v1/` |  |
| `GET` | `/api/v1/runs` | Tenant-wide workflow-runs index (used by the Runs Center). |
| `GET` | `/api/v1/runs/{run_id}` |  |
| `POST` | `/api/v1/runs/{run_id}/cancel` |  |
| `GET` | `/api/v1/runs/{run_id}/events` | SSE stream: emit one ``data:`` line per workflow event for this run. |
| `POST` | `/api/v1/runs/{run_id}/resume` | Manually resume a ``WAITING_APPROVAL`` run. |
| `GET` | `/api/v1/{workflow_id}` |  |
| `PATCH` | `/api/v1/{workflow_id}` |  |
| `DELETE` | `/api/v1/{workflow_id}` |  |
| `POST` | `/api/v1/{workflow_id}/budget` |  |
| `GET` | `/api/v1/{workflow_id}/budget` |  |
| `GET` | `/api/v1/{workflow_id}/budget/history` |  |
| `POST` | `/api/v1/{workflow_id}/duplicate` | Clone the workflow with a " (copy)" suffix (Rule 4 typed artifact). |
| `POST` | `/api/v1/{workflow_id}/publish` | Flip a draft workflow to ``published`` (Rule 3: gate implicit). |
| `GET` | `/api/v1/{workflow_id}/runs` |  |
| `POST` | `/api/v1/{workflow_id}/runs` |  |

---

_Generated by `scripts/gen-api-catalog.py` on 2026-07-06._
