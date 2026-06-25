# Forge ↔ LiteLLM Integration Layer (F-829)

This package is the **thin integration layer** that makes [LiteLLM](https://github.com/BerriAI/litellm)
the AI gateway for every LLM call Forge makes, while keeping Forge
authoritative for domain concerns (artifacts, knowledge graph,
governance, audit).

> **What this is.** A per-tenant Virtual Key + per-tenant Budget +
> per-tenant Guardrail flow over the LiteLLM Proxy, plus the hot-path
> `ForgeLLMClient` that every Forge caller now goes through.
>
> **What this is not.** This package is *not* a re-implementation of
> LiteLLM. It does not embed model SDKs, does not proxy provider HTTP
> directly, and does not store chat history. LiteLLM owns routing,
> retry, fall-back, and spend logs. Forge owns tenant identity, audit
> correlation, governance, and UI.

## Why (F-829 in one paragraph)

Forge previously routed all LLM traffic through a single LiteLLM
master key in `backend/app/services/litellm_client.py`. That
worked, but it broke three rules:

1. **Rule 1 (model-provider agnosticism)** was still intact, but cost
   attribution was unattributable — every call charged the same
   global bucket.
2. **Rule 2 (multi-tenancy by default)** — there was no notion of
   *per-tenant* LLM budget, no per-tenant key, and no per-tenant
   guardrail assignment.
3. **Rule 6 (auditability)** — there was no reliable correlation
   between a `forge_trace_id` and the LiteLLM call that produced a
   response.

F-829 fixes all three by replacing the master-key path with a
1:1 `Forge tenant ↔ LiteLLM Team ↔ Virtual Key` mapping, mirroring
budgets into LiteLLM (with `workflow_budget.py` becoming a thin
adapter), assigning guardrails per team, and propagating
`X-Forge-Trace-Id` on every chat call so `litellm_call_records` can be
joined back to Forge audit events.

## Architecture

```
                     Forge UI / API
                          |
                          v
        +-----------------------------+
        |  ForgeLLMClient (F-829j)   |  <- every chat/embed call
        |  - resolve model           |
        |  - fetch tenant Virtual Key|
        |  - X-Forge-Trace-Id header |
        |  - check budget pre-call   |
        +-------------+---------------+
                      |
                      v
        +-----------------------------+
        |  LiteLLMBaseClient (httpx)  |
        |  - admin_client (admin key) |
        |  - chat_client (tenant key) |
        +-------------+---------------+
                      |
                      v
                LiteLLM Proxy
                (config.yaml)
                /          \
       Bedrock         OpenAI   Anthropic
       OpenAI          Azure    Vertex
```

**Read this diagram top-down.** The Forge caller (chat, embed, agent
node) only ever talks to `ForgeLLMClient`. `ForgeLLMClient` is the
sole consumer of `LiteLLMBaseClient`. `LiteLLMBaseClient` is the sole
HTTP surface to the LiteLLM Proxy. The Proxy is the sole consumer of
upstream provider SDKs. There is no other path.

**Supporting modules (out of band):**

```
TenantSync (F-829a)        -- 1:1 Forge tenant  <-> LiteLLM Team
KeyManager (F-829b)        -- Virtual Keys in AWS Secrets Manager
BudgetSync (F-829c)        -- per-tenant Budget in LiteLLM
GuardrailSync (F-829d)     -- per-tenant Guardrail assignment
ModelAssignment (F-829g)   -- per-call model resolution
TraceCorrelator (F-829k)   -- forge_trace_id <-> litellm call_id
HealthMonitor (F-829l)     -- 30s probe; powers LLMUnavailableBanner
```

These run **out of band** of the hot path. They are called from API
handlers, event subscribers, and APScheduler jobs — never from inside
`ForgeLLMClient.chat()` (which only does HTTP).

## Module reference

### `__init__.py` — public API surface

Re-exports the symbols that external code is allowed to import. If
you add a new module, add its public class to `__all__`.

### `litellm_base_client.py` — shared httpx async client (F-829)

One `LiteLLMBaseClient` opens a single `httpx.AsyncClient` against
the proxy URL but exposes two surfaces:

| Attribute | Auth | Use for |
|---|---|---|
| `admin_client` | `Authorization: Bearer <settings.litellm_admin_key>` | Team / Key / Budget / Guardrail admin operations |
| `chat_client(api_key, trace_id=None)` | `Authorization: Bearer <tenant Virtual Key>` plus optional `X-Forge-Trace-Id` | Chat, embed, completion |

**Public API:**

```python
async with LiteLLMBaseClient() as client:
    await client.admin_client.post("/team/new", json={...})
    await client.chat_client(api_key="sk-forge-...", trace_id=trace_id).post(
        "/v1/chat/completions", json={"model": "...", "messages": [...]}
    )
```

**Quirks:**

- Always use `async with`. The connection pool is closed deterministically on exit.
- Never instantiate both `admin_client` and `chat_client` as standalone — they share state.
- `chat_client` returns a *new* `httpx.AsyncClient` per call. The auth and trace header are baked in. Do not reuse across tenants.

### `secrets_manager_client.py` — AWS Secrets Manager wrapper

Wraps `boto3.client("secretsmanager")` with the same shape as
`app/services/aws_transform_client.py`.

**Public API:**

```python
client = SecretsManagerClient()
if await client.available():
    await client.put_secret("forge/tenants/acme-corp/keys/main",
                            json.dumps({"key": "sk-..."}),
                            kms_key_id="alias/forge-tenant-keys")
    payload = await client.get_secret("forge/tenants/acme-corp/keys/main")
```

**Quirks:**

- All public methods are `async def`; the synchronous boto3 call runs inside `asyncio.to_thread`.
- `Boto3ClientFactory` Protocol (same shape as `aws_transform_client.py:46-54`) is injectable so tests can swap a mock.
- `available` property returns `True` only if boto3 + AWS creds work. When `False`, every method raises `SecretsManagerUnavailable` (mapped to `503` in the API layer).
- Secret values are **never** logged. The `_redact` helper scrubs them from any `repr` or `str` that might end up in a log line.

### `tenant_sync.py` — Forge tenant ↔ LiteLLM Team (F-829a)

Maintains 1:1 mapping between `tenants` rows and LiteLLM Teams.

**Public API:**

```python
await tenant_sync.on_tenant_created(tenant_id, tenant_name)
await tenant_sync.on_tenant_renamed(tenant_id, new_name)
await tenant_sync.on_tenant_archived(tenant_id)
await tenant_sync.reconcile()  # nightly; surfaces drift
```

**Quirks:**

- `on_tenant_created` is **idempotent**. Re-running it on an existing tenant is a no-op.
- `on_tenant_archived` posts `/team/delete` to LiteLLM **and** revokes all Virtual Keys for that tenant in Secrets Manager. Spend logs are preserved (LiteLLM does not delete spend data on Team delete).
- `on_tenant_renamed` updates both Forge metadata and the LiteLLM Team `team_alias`.
- Failures are non-fatal: tenant creation in Forge never blocks on LiteLLM being unreachable. A reconciliation job repairs drift within 24h.

### `key_manager.py` — Virtual Key provisioning (F-829b)

Provisions and rotates per-tenant Virtual Keys.

**Public API:**

```python
key = await key_manager.provision_key(tenant_id, model_alias="default")
# Returns key metadata (key_id, alias, models, created_at).
# The key VALUE is stored in Secrets Manager and never returned to the caller.

await key_manager.rotate_key(tenant_id, key_id)
await key_manager.revoke_key(tenant_id, key_id)
keys = await key_manager.list_keys(tenant_id)
```

**Quirks:**

- `provision_key` is auto-called from `TenantSync.on_tenant_created` when `settings.litellm_auto_provision_keys=True` (default in dev, controlled per env in prod).
- `provision_key` caches the key metadata for `settings.litellm_key_cache_ttl_seconds` (default 300). The **value** is fetched fresh from Secrets Manager on every `get_key_value` call.
- The key value is **never** in any API response. The CI grep test `tests/ci/test_no_key_in_response.py` enforces this.
- `rotate_key` mints a new key, swaps it atomically in Secrets Manager, then revokes the old one. Brief (~1s) window where both keys are valid.

### `budget_sync.py` — per-tenant LiteLLM Budgets (F-829c)

Mirrors Forge-side budget concepts onto LiteLLM Budgets API.

**Public API:**

```python
await budget_sync.set_tenant_budget(tenant_id, usd=Decimal("500.00"), period="monthly")
status = await budget_sync.get_tenant_budget(tenant_id)  # {spent, ceiling, period, projected}
await budget_sync.check_budget(tenant_id, projected_cost)  # raises BudgetExceededError
await budget_sync.record_spend(tenant_id, usd, call_id)
```

**Quirks:**

- `workflow_budget.py` is now a thin adapter — its `check_budget` first consults `BudgetSync` for the latest, then falls back to the local SQL cache.
- `set_tenant_budget` is idempotent on `(tenant_id, period)`. Re-setting the same ceiling is a no-op; changing the ceiling triggers a `PUT /budget/{team_id}` call.
- `record_spend` writes both to LiteLLM's spend log (via the chat completion response) and to Forge's `cost_ledger` (via the existing `audit_service` flow). The two are reconciled nightly.
- When `settings.litellm_budget_hard_limit=True` (default), `check_budget` raises before the call is made. When `False`, the call is allowed and the overage is recorded (audit-only mode).

### `model_assignment.py` — per-call model resolution (F-829g)

Resolves which model to use for a given call (tenant + command + persona).

**Public API:**

```python
model = model_assignment.resolve(tenant_id=..., command="forge-arch-new")
# Returns "bedrock/anthropic.claude-4-sonnet" or similar.
```

**Quirks:**

- Resolves from `litellm_model_assignments` table, falling back to a per-tenant default, then to a global default.
- The model string is **LiteLLM's** model identifier format (`provider/model`), not the upstream provider's. LiteLLM does the translation.

### `llm_client.py` — `ForgeLLMClient` (F-829j)

The hot path. This is what every existing call site should now use.

**Public API:**

```python
async with ForgeLLMClient(tenant_id=..., trace_id=forge_trace_id) as client:
    response = await client.chat(model="...", messages=[...])
    embedding = await client.embed(model="...", input=[...])
```

**Quirks:**

- Adds `X-Forge-Trace-Id` to every chat call (read from `trace_id` argument or generated).
- Consults `BudgetSync.check_budget` before each call when `litellm_budget_hard_limit=True`.
- On LiteLLM unreachable: raises `LLMUnavailableError` after 3 retries with exponential backoff. Existing `litellm_client.py` falls through to a degraded mode (the old master-key path).
- `ForgeLLMClient` does **not** depend on `litellm` SDK (Rule 1). It uses `LiteLLMBaseClient`.

### `trace_correlator.py` — forge_trace_id ↔ LiteLLM call_id (F-829k)

Persists the mapping between Forge's `forge_trace_id` and the
LiteLLM-internal call id so `litellm_call_records` can be joined back
to Forge audit events.

**Public API:**

```python
await trace_correlator.record_call(trace_id=..., litellm_call_id=...,
                                   tenant_id=..., model=..., tokens=..., cost_usd=...)
record = await trace_correlator.lookup_by_trace(trace_id)
records = await trace_correlator.lookup_by_tenant(tenant_id, since=...)
```

**Quirks:**

- Writes to `litellm_call_records` table.
- Read path is uncached; the table is the source of truth. (Caching is added at the UI layer via `apps/forge/hooks/use-litellm-status.ts`.)

### `health_monitor.py` — 30s probe (F-829l)

Background loop started from `app/main.py` lifespan.

**Public API:**

```python
status = health_monitor.current_status()
# {"healthy": bool, "last_check": datetime, "consecutive_failures": int, "detail": str}
```

**Quirks:**

- Probes `GET /health/liveliness` on the LiteLLM Proxy every `settings.litellm_health_check_interval_seconds` (default 30).
- Flips to `unhealthy` after 3 consecutive failures (90s total).
- Flips back to `healthy` on first successful probe (30s recovery).
- The UI's `LLMUnavailableBanner` reads `current_status()` via `useLiteLLMStatus` hook with 30s refetch.

### `guardrail_sync.py`, `mcp_server_registry.py`, `skill_sync.py`, `usage_query.py`, `compliance_feed.py` — see appendix A

These modules are stubbed in Phase A and fleshed out in Phases B–D.
See the [Implementation Plan §Phase B–D](../../../../../.claude/plans/zippy-sprouting-haven.md#phase-b--admin-ui)
for their public APIs and quirks.

## Configuration

All LiteLLM-related settings live in `backend/app/core/config.py`.

| Env var | Setting | Default | Required by prod | Used by |
|---|---|---|---|---|
| `LITELLM_PROXY_URL` | `litellm_proxy_url` | (none) | yes | `LiteLLMBaseClient` |
| `LITELLM_API_KEY` | `litellm_api_key` | (none) | yes | legacy `litellm_client.py` master-key path |
| `LITELLM_ADMIN_KEY` | `litellm_admin_key` | (none) | yes | `LiteLLMBaseClient.admin_client` |
| `LITELLM_BUDGET_DEFAULT_USD` | `litellm_budget_default_usd` | `500.00` | n/a | `BudgetSync.set_tenant_budget` (OQ-32) |
| `LITELLM_BUDGET_DEFAULT_PERIOD` | `litellm_budget_default_period` | `monthly` | n/a | `BudgetSync.set_tenant_budget` |
| `LITELLM_HEALTH_CHECK_INTERVAL_SECONDS` | `litellm_health_check_interval_seconds` | `30` | n/a | `HealthMonitor` loop interval |
| `LITELLM_USAGE_CACHE_TTL_SECONDS` | `litellm_usage_cache_ttl_seconds` | `60` | n/a | `usage_query` cache |
| `LITELLM_KEY_CACHE_TTL_SECONDS` | `litellm_key_cache_ttl_seconds` | `300` | n/a | `key_manager` metadata cache |
| `LITELLM_INTEGRATION_ENABLED` | `litellm_integration_enabled` | `true` | prod flips via env | master toggle for the whole layer |
| `LITELLM_AUTO_PROVISION_KEYS` | `litellm_auto_provision_keys` | `true` | n/a | auto-mint Virtual Key on tenant create |
| `LITELLM_BUDGET_HARD_LIMIT` | `litellm_budget_hard_limit` | `true` | n/a | `BudgetSync.check_budget` raises vs audit-only |
| `LITELLM_GUARDRAIL_PII_DEFAULT` | `litellm_guardrail_pii_default` | `true` | n/a | default guardrail on new tenant |
| `LITELLM_GUARDRAIL_CONTENT_DEFAULT` | `litellm_guardrail_content_default` | `true` | n/a | default guardrail on new tenant |
| `LITELLM_GUARDRAIL_INJECTION_DEFAULT` | `litellm_guardrail_injection_default` | `true` | n/a | default guardrail on new tenant |
| `AWS_SECRETS_MANAGER_PREFIX` | `aws_secrets_manager_prefix` | `forge/tenants/` | n/a | `SecretsManagerClient` path prefix |
| `AWS_SECRETS_MANAGER_KMS_KEY_ID` | `aws_secrets_manager_kms_key_id` | (empty) | n/a (optional) | KMS CMK for `put_secret` |

See [`.env.example`](../../../../../.env.example) for the canonical list with comments.

**Production rule of thumb.** All keys marked `Required by prod: yes`
must be present in AWS Secrets Manager and wired into the
`forge-backend` task definition. They are **never** in plaintext env
files in prod.

## Local development

```bash
# 1. Boot the stack
docker compose up -d postgres redis floci litellm keycloak backend

# 2. Verify the proxy is up
curl -fsS http://localhost:4000/health/liveliness
# {"status":"healthy"}

# 3. Verify Forge sees the proxy as healthy
curl -fsS http://localhost:8000/api/v1/health/litellm
# {"healthy":true,"last_check":"...","consecutive_failures":0}

# 4. Smoke-test the integration layer
cd backend
python -c "from app.integrations.litellm import ForgeLLMClient; print('ok')"
```

### Port reference

| Service | Port | Container |
|---|---|---|
| LiteLLM Proxy | `4000` | `litellm` |
| Forge Backend (FastAPI) | `8000` | `backend` |
| Forge UI (Next.js) | `3000` | `forge-dashboard` |
| PostgreSQL 17 | `5432` | `postgres` |
| Redis 7 | `6379` | `redis` |
| floci (AWS emulation) | `4566` | `floci` |
| Keycloak 26 | `8080` | `keycloak` |

### Health checks

| Endpoint | What it tells you |
|---|---|
| `GET http://localhost:4000/health/liveliness` | Proxy is up |
| `GET http://localhost:4000/health/readiness` | Proxy + DB + Redis are ready |
| `GET http://localhost:8000/api/v1/health/litellm` | Forge-side cached health (via `HealthMonitor`) |
| `GET http://localhost:8000/health/ready` | Forge backend ready |

## Adding a new integration module

1. **Create the file** at `backend/app/integrations/litellm/<name>.py`.
2. **Use the base client** for any HTTP traffic:

   ```python
   from app.integrations.litellm.litellm_base_client import LiteLLMBaseClient

   async with LiteLLMBaseClient() as client:
       resp = await client.admin_client.post("/endpoint", json={...})
   ```

3. **Mirror the patterns above**:
   - Lazy init for any optional SDK (boto3, etc.).
   - `Boto3ClientFactory` Protocol for testability.
   - `async def` everywhere.
   - `get_logger(__name__)` from `app.core.logging` for structured logs.
   - `get_tracer(__name__)` from `app.core.telemetry` for OpenTelemetry spans.
   - Module-level singleton via `get_default_client()`.
4. **Register the public symbol** in `__init__.py` (move out of the commented block, add to `__all__`).
5. **Add a unit test** at `backend/tests/integrations/litellm/test_<name>.py`. Use the mock client pattern in `tests/integrations/litellm/conftest.py`.
6. **If you must `import litellm` SDK** (rare), add the file path to the CI hygiene grep allowlist in `.github/workflows/ci-hygiene-grep.yml`. The current allowlist covers `backend/app/services/litellm_client.py` only.

## Testing

```bash
cd backend

# Unit tests (mocked httpx + boto3)
pytest tests/integrations/litellm/ -v

# Integration tests (require a running LiteLLM container)
pytest tests/integration/litellm/ -v

# The CI hygiene gate (no `import litellm` outside the allowlist)
grep -rEn '^\s*(import\s+litellm\b|from\s+litellm\b)' backend --include='*.py'
# Expected: only backend/app/services/litellm_client.py appears.

# The "no key value in API response" gate
pytest tests/ci/test_no_key_in_response.py -v
```

### What to mock

| Module | Mock |
|---|---|
| `LiteLLMBaseClient` | `httpx.MockTransport` or `respx` |
| `SecretsManagerClient` | A `Boto3ClientFactory` Protocol implementation |
| `BudgetSync` | `respx` against `/budget/{team_id}` |
| `HealthMonitor` | Patch `asyncio.sleep` + return canned responses |
| `TraceCorrelator` | The DB session is mocked at the SQLAlchemy layer |

### What *not* to mock

- The `ForgeLLMClient.chat` happy path. It should hit a real (test) LiteLLM container and assert the response shape.
- The 30s health loop. It should run for at least 90s in one of the integration tests to prove the 3-strikes-unhealthy logic.

## Troubleshooting

### `LLMUnavailableError: LiteLLM returned 503`

**Cause.** LiteLLM is unreachable.
**Fix.** Check `docker compose ps litellm`, then `docker compose logs litellm --tail=100`. Common causes: OOM, bad `config.yaml`, network partition. See [docs/runbooks/litellm-downtime.md](../../../../runbooks/litellm-downtime.md).

### `SecretsManagerUnavailable`

**Cause.** boto3 cannot reach AWS (or floci in dev).
**Fix.** Verify `AWS_REGION`, `AWS_ENDPOINT_URL` (dev only), and IAM permissions. In dev, restart `floci`. In prod, check the IAM role on the `forge-backend` task.

### `BudgetExceededError`

**Cause.** Tenant has hit 100% of its LiteLLM Budget.
**Fix.** Raise the budget via `/admin/llm-gateway/tenants/{id}`. See [docs/runbooks/budget-exhausted.md](../../../../runbooks/budget-exhausted.md).

### `BudgetThresholdReachedWarning`

**Cause.** Tenant has hit 80% of its LiteLLM Budget.
**Fix.** No action required; the UI's `BudgetGauge` will turn yellow. Plan to raise the budget before the next billing cycle.

### Key value appearing in logs

**Cause.** Someone called `repr(key)` or `print(key)`.
**Fix.** This should be impossible — `SecretsManagerClient` redacts values. If you see it, the offending log line is missing a `[key_value]` filter. File a bug; do not commit the key.

### Trace correlation missing

**Cause.** The chat call was made without a `forge_trace_id` (legacy code path through `litellm_client.py`).
**Fix.** Migrate the call site to `ForgeLLMClient(trace_id=...)`. The CI gate at `tests/ci/test_trace_correlation.py` flags new call sites that don't pass a trace id.

## Related docs

| Topic | Doc |
|---|---|
| Operations: LiteLLM down | [docs/runbooks/litellm-downtime.md](../../../../runbooks/litellm-downtime.md) |
| Operations: Budget exhausted | [docs/runbooks/budget-exhausted.md](../../../../runbooks/budget-exhausted.md) |
| Pilot onboarding | [docs/pilot/llm-gateway-setup.md](../../../../pilot/llm-gateway-setup.md) |
| Pilot checklist (printed) | [docs/pilot/checklist.md](../../../../pilot/checklist.md) |
| On-call runbook (general) | [docs/operations/oncall-runbook.md](../../../../operations/oncall-runbook.md) |
| Rollback procedures | [docs/operations/rollback-procedures.md](../../../../operations/rollback-procedures.md) |
| Implementation plan | [.claude/plans/zippy-sprouting-haven.md](../../../../../../.claude/plans/zippy-sprouting-haven.md) |

---

## Appendix A — Stubbed modules (Phase B–D)

These modules exist as skeletons in Phase A; the public APIs and
behavior below are *committed* in their respective phases.

| Module | Phase | Public API sketch |
|---|---|---|
| `guardrail_sync.py` | B | `assign_guardrail(tenant_id, guardrail)`, `list_assigned(tenant_id)`, `remove(tenant_id, guardrail)` |
| `mcp_server_registry.py` | B | `list_servers()`, `describe(name)` |
| `skill_sync.py` | D | `sync_from_litellm()`, `register_to_litellm(skill)`, bidirectional |
| `usage_query.py` | C | `tenant_spend(tenant_id, since, until)`, `workflow_spend(run_id)`, `by_model(...)`, cached 60s |
| `compliance_feed.py` | C | `poll_violations()`, `mark_resolved(violation_id)` |