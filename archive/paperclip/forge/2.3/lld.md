---
version: 0.1.0
last-reviewed-by: cto
last-reviewed-at: 2026-06-17
parent-prd: workspace/project/PRD.md
parent-issue: Forge AI-35
sub-goal: "2.3 — Design generation (design-generator)"
epic: Forge AI-18 (Epic 2 — Architecture Agent)
style-conformance:
  - microservices (0.90) — 5 apps, 0 cross-service file imports
  - hexagonal-clean (0.80) — 3 ports files, 8 adapters
---

# LLD — Per-component contracts, state, errors, observability

**Stage:** Architect (sub-goal 2.3 of [Forge AI-18](/Forge AI/issues/Forge AI-18))
**Owner:** design-generator (CTO on v0.1)
**Last reviewed:** 2026-06-17 (cto)
**Source of truth for component internals:** this file. Updates require CTO sign-off.

This LLD pairs 1:1 with the HLD component diagram (`hld.md` §2). Every box in that diagram has a section below. Conventions:

- **State** is the persistent state and its invariants.
- **Interfaces** are the typed contracts (REST / gRPC / package exports).
- **Error model** is the typed error envelope — `{ code, message, request_id, retry_after_ms? }`. Codes are stable; messages are not.
- **Observability** lists the OTel spans, the audit-log events, and the metric names.
- **Budget** is the per-process cost ceiling (USD/h and tokens/h).

## 1. `apps/orchestrator` — Master Orchestrator + SDLC Agent

**Language / framework:** TypeScript (Node 20 LTS, ESM strict), Fastify 4.x, gRPC server (proto3), BullMQ consumers.
**State:**

- Primary write: `agent_runs`, `agent_run_stages`, `agent_run_events`, `agent_run_idempotency_keys`, `agent_run_approvals` (see ERD).
- Cache: `agent_runs:read:{run_id}` (Redis, 60 s TTL); `approval_dedup:{interaction_id}` (Redis, 24 h TTL).
- Sweeper state: in-process cron tick (every 30 s) backed by `agent_run_approvals_sweep_idx`.

**Interfaces:**

| Port | Wire | Notes |
| --- | --- | --- |
| `Orchestrator` gRPC service | gRPC + proto3 (ADR-0007) | 5 RPCs: `CreateRun`, `AdvanceStage`, `GetRunContext`, `ReportCost`, `HealthCheck` |
| `POST /v1/runs` | REST + OpenAPI 3.1 (`openapi.yaml`) | Idempotency-Key required, returns `Run` + `Location: /v1/runs/{id}` |
| `POST /v1/runs/{id}/transitions` | REST | Body: `{from_stage, to_stage, decision, artefact_ref}` |
| `GET /v1/runs/{id}/context` | REST | The single seam — per architecture memory §7 |
| `POST /v1/approvals/{id}/decisions` | REST | Body: `{decision, decided_by, reason}` |
| `GET /healthz`, `GET /readyz` | REST | Liveness / readiness; readiness checks DB + Redis + NATS |

**State machine (per `apps/orchestrator/src/gates.ts`):**

```
created → running → waiting_approval → running → (paused | aborted | done)
                  ↘ returned (loops back to the prior stage)
```

Each transition is gated by a `gate_kind` row in `agent_run_approvals` (8 kinds, see migration 0004). A re-issue on the same gate increments the Paperclip interaction id and stamps `superseded_interaction_id`.

**Error model:**

- Typed gRPC codes: `INVALID_ARGUMENT`, `NOT_FOUND`, `FAILED_PRECONDITION` (stage mismatch), `PERMISSION_DENIED` (auth boundary), `RESOURCE_EXHAUSTED` (budget), `INTERNAL`.
- Idempotency conflict → HTTP 409 `IDEMPOTENCY_CONFLICT` (body: `{error: {code, request_id}}`).
- Budget breach → `RESOURCE_EXHAUSTED` with `retry_after_ms = 0` and an audit event `run.paused_budget`.

**Observability:**

- OTel spans: `orch.advance_stage`, `orch.gate_evaluate`, `orch.approval_sweep`, `orch.nats_publish`, `orch.audit_append`.
- Audit events: `run.created`, `run.advanced`, `gate.passed`, `gate.rejected`, `gate.returned`, `approval.requested`, `approval.decided`, `run.paused_budget`, `run.aborted`.
- Metrics: `orch_runs_in_flight{stage,tenant}`, `orch_gate_p99_ms{gate_kind}`, `orch_nats_publish_failures_total`, `orch_budget_pauses_total`.

**Budget:** $3 / hour sustained, 50 RPS per app instance, 500 concurrent runs / instance.

## 2. `apps/agent-runtime` — Python agent execution

**Language / framework:** Python 3.12, FastAPI, Anthropic SDK + OpenAI SDK (no LangChain per tech-stack §16), MCP client (Python), Pydantic 2.
**State:**

- Stateless worker. All state is in the Orchestrator (run header) + Postgres (per-stage row) + S3 (artefact bodies).
- In-process: per-stage token bucket + circuit breaker for the model provider (Langfuse for traces, see tech-stack §7).

**Interfaces:**

| Port | Wire | Notes |
| --- | --- | --- |
| `Orchestrator.AdvanceStage` (gRPC client) | gRPC + proto3 | The only call the runtime makes into the platform. |
| MCP `tool/call` (per server) | JSON-RPC over stdio / WS | 9 MCP servers; per-tenant namespace. |
| `GET /healthz`, `GET /readyz` | REST | Readiness checks OIDC + model provider + MCP reachability. |

**State machine (per stage):**

```
plan → validate_plan → execute_tool_calls → report_cost → (advance | return | abort)
```

`validate_plan` is the plan-then-act gate (security memory §5). Tools not in the plan are rejected with `tool_not_in_allow_list` and audited.

**Error model:**

- `PlanInvalid` (retryable, agent rewrites plan).
- `ToolNotInAllowList` (terminal for this tool; audit `denied`).
- `BudgetExceeded` (terminal for this run; orchestrator pauses).
- `ModelProviderError` (circuit-breaker; backoff to backup provider).

**Observability:**

- OTel spans: `agent.plan`, `agent.validate_plan`, `agent.execute_tool`, `agent.cost_report`.
- Langfuse traces: one trace per stage, linked to `run_id` + `stage`.
- Audit events: `agent.plan_emitted`, `agent.tool_called`, `agent.tool_denied`, `agent.cost_reported`, `agent.cost_exceeded`.

**Budget:** $3 / hour sustained, 8 RPS per instance (LLM-bound), 32 concurrent stages / instance.

## 3. `apps/customer-cloud-broker` — AWS / Azure / GCP OIDC broker

**Language / framework:** TypeScript, Fastify 4.x, `@aws-sdk/client-sts` (per service) + Azure AD workload identity + GCP workload identity federation.
**State:**

- Adapter registry (in-process, immutable per boot) indexed by `(tenant_id, provider)`.
- Per-tenant+service `TokenBucket` + `CircuitBreaker` (Forge AI-126.5).
- Probe JWTs (ES256, 60 s TTL, `scope=probe` sentinel) signed by `ProbeProbeSigner` for the canary-assume probe.

**Interfaces:**

| Port | Wire | Notes |
| --- | --- | --- |
| `POST /v1/tenants/{id}/cloud/assume` | REST + OpenAPI 3.1 | Body: `{provider, role_arn, duration_sec, session_tags}`. Returns short-lived creds. |
| `POST /v1/tenants/{id}/cloud/release` | REST | Body: `{handle_id}`. Idempotent. |
| `GET /v1/tenants/{id}/cloud/probe` | REST (system-only) | Internal canary; runs every 5 min. |
| `GET /healthz`, `GET /readyz` | REST | Readiness checks all three provider SDKs. |

**State machine (assume → use → release):**

```
idle → (request) → issuing → ready → (use) → ready → (release) → idle
                  ↘ denied (audit + circuit)
```

The canary probe lives on its own state machine and uses `scope=probe` JWTs that are refused by the real `assume` path (defence in depth).

**Error model:**

- `TENANT_NOT_FOUND`, `PROVIDER_NOT_CONFIGURED`, `ROLE_ASSUME_FAILED` (with the AWS/Azure/GCP error code in the audit).
- `DENY_LIST_HIT` (terminal; admin must clear via 1Password-held override).
- `CIRCUIT_OPEN` (returns 503 with `Retry-After`).

**Observability:**

- OTel spans: `broker.assume`, `broker.release`, `broker.probe`, `broker.circuit_state`.
- Audit events: `cloud.assume`, `cloud.release`, `cloud.probe.ok`, `cloud.probe.fail`, `cloud.deny_list_hit`, `cloud.circuit_open`.
- Metrics: `broker_assume_p99_ms{provider}`, `broker_circuit_state{provider,tenant}`, `cloud_probe_failures_total`.

**Budget:** $0.10 / hour sustained (no LLM), 100 RPS / instance, deny-list checks cached 60 s.

## 4. `apps/identity-broker` — OIDC + IdP revocation webhook

**Language / framework:** TypeScript, Fastify 4.x, `openid-client` v6 (per `packages/oidc-clients`).
**State:**

- Per-tenant IdP config in `tenant_idp_configs` (out of scope for Forge AI-35; documented in ADR-0003 + identity ADR).
- Per-tenant webhook secret (HMAC-SHA256, `X-IdP-Signature: sha256=<hex>`, `tenant_webhook_secrets` map — see Forge AI-161).
- JWKS cache (5 min, refresh on `kid` rotation).

**Interfaces:**

| Port | Wire | Notes |
| --- | --- | --- |
| `GET /v1/oauth/{tenant}/authorize` | REST | OIDC code flow. |
| `POST /v1/oauth/{tenant}/token` | REST | Code exchange + refresh. |
| `POST /v1/webhooks/idp-revoke` | REST | HMAC-signed; idempotent on `(tenant_id, jti)`. |
| `GET /.well-known/jwks.json` | REST (public) | JWKS for the platform JWT. |

**State machine (token lifecycle):**

```
issued → (15 min TTL) → expired
    ↘ revoked (IdP webhook or admin) — denied on next call
    ↘ refreshed (silent) — new jti, old jti in revocation list (5 min window)
```

**Error model:**

- `INVALID_SIGNATURE` (HMAC mismatch; admin alert).
- `TENANT_NOT_FOUND`, `IDP_NOT_CONFIGURED`.
- `TOKEN_REVOKED` (200, with `WWW-Authenticate: error="invalid_token"`).

**Observability:**

- OTel spans: `idp.authorize`, `idp.token_exchange`, `idp.revoke_webhook`, `idp.jwks_refresh`.
- Audit events: `idp.token_issued`, `idp.token_revoked`, `idp.revoke_webhook_received`, `idp.revoke_webhook_invalid`.
- Metrics: `idp_token_issued_total{tenant}`, `idp_revoke_webhook_p99_ms`, `idp_jwks_cache_hit_ratio`.

**Budget:** $0.05 / hour sustained, 200 RPS / instance.

## 5. `apps/event-bus-bridge` — SNS publisher (cross-account audit)

**Language / framework:** TypeScript, Fastify 4.x, `@aws-sdk/client-sns`.
**State:**

- Subscription map: `(tenant_id, event_type) → topic_arn` in `bridge_subscriptions` (out of scope for Forge AI-35).
- Per-event dedupe cache (Redis, 24 h TTL) keyed on `event_id`.

**Interfaces:**

| Port | Wire | Notes |
| --- | --- | --- |
| `POST /v1/events/publish` | REST (cluster-only) | Body: `{event_id, tenant_id, event_type, payload, trace_id}`. |
| `GET /v1/events/{id}/status` | REST | Returns `pending` / `published` / `failed` / `replayed`. |

**State machine:**

```
received → validated → (publishing) → published → audit_ack
                              ↘ failed → (retry with backoff, max 5) → dead_letter
```

**Error model:**

- `VALIDATION_FAILED` (event_id malformed, tenant mismatch).
- `PUBLISH_FAILED` (SNS error; retried with backoff).
- `DEAD_LETTER` (after 5 retries; orchestrator surfaces "audit delivery failed" P2).

**Observability:**

- OTel spans: `bridge.receive`, `bridge.validate`, `bridge.publish`, `bridge.audit_ack`.
- Audit events: `event.received`, `event.published`, `event.dead_lettered`.
- Metrics: `bridge_publish_p99_ms`, `bridge_dead_letter_total{event_type}`, `bridge_dedupe_hits_total`.

**Budget:** $0.10 / hour sustained, 500 RPS / instance.

## 6. Shared packages

### 6.1 `packages/event-bus` (NATS JetStream client)

- Producer confirms required; `Inbox` + `Dedup` envelopes per `envelope.ts`.
- Subject schema: `fora.events.{tenant_id}.{stage}.{event_type}`.
- Replay API: `replay(subject, since)` for backfills and audit-reconstruction.

### 6.2 `packages/db-pool` (pg + RLS + pgvector)

- Per-tenant connection routing via `SET LOCAL app.tenant_id = $1` on every checkout.
- `tenancy-lint` rejects any migration that omits `tenant_id` on a new user table (red fixture fails CI; see `packages/tenancy-lint/test/fixtures/`).
- Two pools: `runtime_pool` (RLS-enforced, BYPASSRLS=false) and `migrator_pool` (BYPASSRLS=true, used only by `db-migrator`).

### 6.3 `packages/cache-broker` (Redis 7)

- Three keyspaces: `session:{tenant_id}:{session_id}` (15 min TTL), `idem:{tenant_id}:{key}` (24 h TTL), `cbucket:{service}:{tenant_id}` (1 min TTL, rate-limit).
- Connection via cluster client; failover to the standby region is handled at the ElastiCache layer.

### 6.4 `packages/object-store` (S3)

- One bucket per environment, KMS-encrypted with the platform CMK; per-tenant prefix `{tenant_id}/`.
- `tenant_isolation` runbook (`docs/runbooks/object-store-tenant-isolation.md`) is the only acceptable response to a leak.

### 6.5 `packages/oidc-clients`, `packages/session-tokens`

- Typed wrappers around `openid-client` (OIDC) and `jose` (JWT). No raw `crypto` calls in app code.

### 6.6 `packages/db-migrator`

- Forward-only; rollback scripts as comments per migration; CI runs `tenancy-lint` + a real Postgres dry-run.
- `BYPASSRLS` audit in `src/bypass-audit.ts` scans `migrations/` and `audit/` and refuses to run if a `BYPASSRLS` grant is added anywhere else.

### 6.7 `packages/tenancy-lint`

- Static + dynamic lint: rejects migrations / app code that omits `tenant_id` on user data, rejects string-concatenated SQL, requires Zod/Pydantic on every API entry point.

## 7. Cross-component error model (the envelope)

```json
{
  "error": {
    "code": "TENANT_NOT_FOUND",
    "message": "Tenant does not exist or you do not have access.",
    "request_id": "req_01J7Z…",
    "retry_after_ms": null
  }
}
```

| Code | HTTP | When |
| --- | --- | --- |
| `TENANT_NOT_FOUND` | 404 | Tenant absent or not in caller's scope. |
| `IDEMPOTENCY_CONFLICT` | 409 | Same Idempotency-Key, different fingerprint. |
| `BUDGET_EXCEEDED` | 402 | Per-run or per-tenant budget ceiling hit. |
| `TOOL_NOT_IN_ALLOW_LIST` | 403 | Plan-then-act rejected the call. |
| `STAGE_MISMATCH` | 409 | `from_stage` ≠ run.current_stage. |
| `INVALID_SIGNATURE` | 401 | IdP webhook HMAC mismatch. |
| `CIRCUIT_OPEN` | 503 | Per-tenant+service breaker is open. |
| `INTERNAL` | 500 | Anything not in this table. |

## 8. Observability cross-cuts

- **Logs:** CloudWatch Logs (v1) with `tenant_id`, `run_id`, `stage`, `request_id` as the canonical MDC keys. Loki in v1.1.
- **Metrics:** Prometheus + Grafana; every service emits RED metrics + the per-app metrics in §1–§5.
- **Traces:** OTel SDK → Grafana Tempo. W3C `traceparent` propagated from the Forge console through every MCP and back.
- **LLM traces:** Langfuse (self-hosted), one trace per stage, linked to `run_id`.
- **Alerting:** Alertmanager → PagerDuty. The runbook for each alert lives in `docs/runbooks/`.

## 9. Versioning and migration

- gRPC package `fora.orchestrator.v1`; additive changes only. Breaking changes bump to `v2` and run parallel for 90 days.
- REST URL prefix `/v1/`. Additive changes are unversioned. Breaking changes bump to `/v2/`.
- DB migrations forward-only. Each migration carries a rollback comment but no `DROP` statements.
- Tenant config changes (`tenant_idp_configs`, `bridge_subscriptions`) are versioned by `revision` column; the active row is the one with `revision = max()`.

## 10. Linked artefacts

- **HLD** — `forge/2.3/hld.md`
- **ADRs** — `forge/2.3/adr/0001-…` …
- **ERD** — `forge/2.3/erd.mmd`
- **Sequence diagrams** — `forge/2.3/sequence/*.mmd`
- **OpenAPI** — `forge/2.3/openapi.yaml`
- **Architecture memory** — `workspace/memory/architecture.md`
- **Security memory** — `workspace/memory/security.md`
- **Existing ADRs** — `docs/architecture/adr-0001…adr-0010`
