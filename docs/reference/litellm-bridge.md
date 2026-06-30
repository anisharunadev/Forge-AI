# Reference: LiteLLM Bridge (Endpoint Map)

> **Status:** ✅ Canonical — every LLM call in Forge routes through this bridge
> **Doc owner:** Platform team
> **Source of truth:** `~/forge-ai/backend/app/core/litellm_client.py` + `backend/app/api/v1/admin_llm_gateway.py`
> **Last updated:** 2026-06-30
> **Constitutional rule:** R1 (provider-agnostic LLM access)

---

## Purpose

This document maps **every endpoint** the Forge backend uses to talk to LiteLLM Proxy. The Forge backend never calls Anthropic, OpenAI, Bedrock, etc. directly — it goes through the proxy. This map is the contract.

---

## Source of truth

- **This file** — `/docs/reference/litellm-bridge.md`
- **Client wrapper** — `backend/app/core/litellm_client.py`
- **LLM Gateway admin API** — `backend/app/api/v1/admin_llm_gateway.py` (9 routes)
- **Tenant sync** — `backend/app/integrations/litellm/tenant_sync.py`
- **Usage query** — `backend/app/integrations/litellm/usage_query.py`
- **Standard** — `/docs/standards/litellm-integration.md` (the "why" + patterns)

---

## The bridge topology

```
┌──────────────────────────────────────────────────────────────┐
│ Forge Backend (FastAPI)                                      │
│                                                              │
│  LiteLLMClient (backend/app/core/litellm_client.py)         │
│      ↓                                                       │
│  LLM Gateway Admin API (backend/app/api/v1/admin_llm_gateway.py)│
│      ↓                                                       │
│  HTTP                                                        │
└─────┬────────────────────────────────────────────────────────┘
      │
      ▼
┌──────────────────────────────────────────────────────────────┐
│ LiteLLM Proxy (separate deployment)                          │
│                                                              │
│  Public API:                                                 │
│  - /chat/completions         (chat)                          │
│  - /embeddings               (embeddings)                    │
│  - /v1/models                (model list)                    │
│                                                              │
│  Admin API:                                                  │
│  - /key/generate             (create virtual key)            │
│  - /key/update               (rotate budget)                 │
│  - /key/delete               (revoke)                        │
│  - /key/info                 (key metadata)                  │
│  - /team/new                 (create tenant/team)            │
│  - /global/spend/teams       (cost attribution)              │
│                                                              │
└──────┬───────────────────────────────────────────────────────┘
       │ HTTPS
       ▼
┌──────────────────────────────────────────────────────────────┐
│ LLM Providers (vendor-agnostic via LiteLLM)                  │
│                                                              │
│  Anthropic | OpenAI | Bedrock | Vertex AI | Azure OpenAI    │
│  OpenRouter | Cohere | Mistral | Together AI | ...          │
└──────────────────────────────────────────────────────────────┘
```

---

## Public API endpoints (used by `LiteLLMClient`)

### POST `/chat/completions`

**Used by:** Every LLM chat call (Co-pilot, Validator, Refactor, Ideation, etc.)

```python
# backend/app/core/litellm_client.py
async def acompletion(self, **kwargs) -> dict:
    response = await self._client.post(
        f"{self.base_url}/chat/completions",
        headers={"Authorization": f"Bearer {self.virtual_key}"},
        json=kwargs,  # model, messages, temperature, max_tokens, response_format, ...
    )
    return response.json()
```

**Request body:**
```json
{
  "model": "claude-sonnet-4.5",
  "messages": [{"role": "user", "content": "..."}],
  "temperature": 0.7,
  "max_tokens": 4096,
  "stream": false,
  "response_format": {"type": "json_schema", "json_schema": {...}},
  "user": "tenant:00000000-0000-4000-8000-000000000ace"
}
```

**Response (non-streaming):**
```json
{
  "id": "chatcmpl-abc123",
  "model": "claude-sonnet-4.5",
  "choices": [{
    "index": 0,
    "message": {"role": "assistant", "content": "..."},
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 1234,
    "completion_tokens": 567,
    "total_tokens": 1801
  },
  "cost_usd": 0.0452,
  "created": 1719748800
}
```

### POST `/embeddings`

**Used by:** Knowledge Center ingest, vector search

```python
async def aembeddings(self, *, model: str, input: list[str]) -> dict:
    response = await self._client.post(
        f"{self.base_url}/embeddings",
        headers={"Authorization": f"Bearer {self.virtual_key}"},
        json={"model": model, "input": input},
    )
    return response.json()
```

**Request:**
```json
{"model": "text-embedding-3-small", "input": ["text 1", "text 2"]}
```

**Response:**
```json
{"data": [{"embedding": [0.012, -0.034, ...]}, ...]}
```

### GET `/v1/models`

**Used by:** Frontend model picker (rare)

```python
async def list_models(self) -> list[dict]:
    response = await self._client.get(
        f"{self.base_url}/v1/models",
        headers={"Authorization": f"Bearer {self.virtual_key}"},
    )
    return response.json()["data"]
```

---

## Admin API endpoints (used by LLM Gateway admin routes)

The 9 backend routes in `backend/app/api/v1/admin_llm_gateway.py` map 1:1 to LiteLLM Proxy admin endpoints.

### 1. GET `/api/v1/admin/llm-gateway/tenants/{tenant_id}`

**Maps to:** LiteLLM `GET /team/info`

**Returns:** `TenantLLMConfig`

```python
@router.get("/tenants/{tenant_id}", response_model=TenantLLMConfig)
@audit(action="admin.llm_gateway.tenant.get", target_type="tenant")
async def get_tenant_llm_config(
    tenant_id: UUID,
    principal: Principal,
    _perm: Principal = require_permission("admin:llm_gateway:read"),
):
    """Per-tenant LLM Gateway configuration."""
    team_info = await litellm_proxy.get_team(tenant_id)
    return TenantLLMConfig(...)
```

### 2. GET `/api/v1/admin/llm-gateway/tenants/{tenant_id}/keys`

**Maps to:** LiteLLM `GET /key/list?team_id=...`

**Returns:** `list[VirtualKeyMetadata]`

```python
@router.get("/tenants/{tenant_id}/keys", response_model=list[VirtualKeyMetadata])
@audit(action="admin.llm_gateway.keys.list", target_type="tenant")
async def list_tenant_keys(
    tenant_id: UUID,
    principal: Principal,
    _perm: Principal = require_permission("admin:llm_gateway:read"),
):
    """List virtual keys for a tenant. Returns metadata only (fingerprint, never raw VALUE)."""
    keys = await litellm_proxy.list_keys(team_id=tenant_id)
    return [VirtualKeyMetadata.from_litellm(k) for k in keys]
```

### 3. POST `/api/v1/admin/llm-gateway/tenants/{tenant_id}/keys/rotate`

**Maps to:** LiteLLM `POST /key/update` (with budget change)

```python
@router.post("/tenants/{tenant_id}/keys/rotate", response_model=VirtualKeyMetadata)
@audit(action="admin.llm_gateway.keys.rotate", target_type="virtual_key")
async def rotate_tenant_key(
    tenant_id: UUID,
    body: KeyRotateRequest,
    principal: Principal,
    _perm: Principal = require_permission("admin:llm_gateway:manage"),
):
    """Rotate a tenant's virtual key with new budget."""
    metadata = await litellm_proxy.rotate_key(
        team_id=tenant_id,
        key_id=body.key_id,
        budget_usd=body.budget_usd,
        rate_limit_rpm=body.rate_limit_rpm,
    )
    return VirtualKeyMetadata.from_litellm(metadata)
```

### 4. POST `/api/v1/admin/llm-gateway/tenants/{tenant_id}/keys/{key_id}/revoke`

**Maps to:** LiteLLM `POST /key/delete`

```python
@router.post(
    "/tenants/{tenant_id}/keys/{key_id}/revoke",
    response_model=VirtualKeyMetadata,
)
@audit(action="admin.llm_gateway.keys.revoke", target_type="virtual_key")
async def revoke_tenant_key(
    tenant_id: UUID,
    key_id: UUID,
    principal: Principal,
    _perm: Principal = require_permission("admin:llm_gateway:manage"),
):
    """Revoke a specific virtual key immediately."""
    metadata = await litellm_proxy.revoke_key(team_id=tenant_id, key_id=key_id)
    return VirtualKeyMetadata.from_litellm(metadata)
```

### 5. GET `/api/v1/admin/llm-gateway/mcp-servers`

**Maps to:** LiteLLM `GET /mcp/servers`

```python
@router.get("/mcp-servers", response_model=list[MCPBrowserEntry])
async def list_mcp_servers(principal: Principal, ...):
    """List MCP servers available to the proxy."""
    servers = await litellm_proxy.list_mcp_servers()
    return [MCPBrowserEntry.from_litellm(s) for s in servers]
```

### 6-9. Other admin routes

| Backend route | LiteLLM endpoint | Purpose |
|---|---|---|
| `GET /admin/llm-gateway/health` | `GET /health` | Proxy health |
| `GET /admin/llm-gateway/spend` | `GET /global/spend/teams` | Spend summary |
| `POST /admin/llm-gateway/guardrails` | `POST /guardrails/new` | Create guardrail |
| `GET /admin/llm-gateway/guardrails` | `GET /guardrails/list` | List guardrails |

(Full inventory in `/docs/features/admin-hub.md` and `/docs/reference/api-catalog.md`)

---

## Virtual key fingerprinting

**The raw VALUE of a virtual key is NEVER stored or returned after creation.**

```python
# backend/app/api/v1/admin_llm_gateway.py
@router.post("/tenants/{tenant_id}/keys", response_model=VirtualKeyMetadata)
@audit(action="admin.llm_gateway.keys.create", target_type="virtual_key")
async def create_virtual_key(...):
    # Create via LiteLLM Proxy
    raw_key = await litellm_proxy.create_key(...)  # e.g. "sk-forge-abc123..."

    # Store fingerprint only
    fingerprint = f"sha256:{hashlib.sha256(raw_key.encode()).hexdigest()[:12]}"

    # Return ONCE at creation; never again
    return VirtualKeyMetadata(
        key_id=...,
        fingerprint=fingerprint,  # Only fingerprint shown after creation
        budget_usd=...,
        # raw_key NEVER returned in subsequent reads
    )
```

**`VirtualKeyMetadata` schema:**

```python
class VirtualKeyMetadata(ForgeBaseModel):
    key_id: UUID
    fingerprint: str           # sha256:<12-char-prefix>
    feature: str               # e.g. "validator", "copilot"
    budget_usd: Decimal
    rate_limit_rpm: int
    allowed_models: list[str]
    expires_at: datetime | None
    created_at: datetime
    created_by: UUID
```

**Why:** DB dumps must not leak working keys. Fingerprint is enough for audit; raw key only flows once at creation.

---

## Tenant sync (Forge ↔ LiteLLM)

`backend/app/integrations/litellm/tenant_sync.py` keeps the tenant list in sync between Forge and LiteLLM:

```python
async def sync_tenant_to_litellm(tenant: Tenant) -> None:
    """Ensure a LiteLLM team exists for this Forge tenant.

    Called on tenant creation + every settings update.
    """
    team = await litellm_proxy.upsert_team(
        team_id=str(tenant.id),
        team_alias=tenant.slug,
        max_budget=tenant.settings.get("max_litellm_budget_usd"),
        models=tenant.settings.get("allowed_models", ["claude-sonnet-4.5"]),
    )
    return team
```

**Invariants:**
- Every Forge tenant has exactly one LiteLLM team
- Team ID = tenant UUID
- Team alias = tenant slug (human-readable)
- Budget updated on tenant settings change

---

## Usage query (cost attribution)

`backend/app/integrations/litellm/usage_query.py` aggregates cost data:

### `get_tenant_usage(tenant_id, since, until)`

```python
class UsageQuery:
    """Per-tenant LLM usage aggregate. Cached in Redis at forge:litellm:usage:<tenant_id>:<since>:<until> for 60s."""

    async def get_tenant_usage(self, tenant_id, since, until) -> TenantUsage:
        # 1. Try Redis cache (60s TTL)
        cache_key = f"forge:litellm:usage:{tenant_id}:{int(since.timestamp())}:{int(until.timestamp())}"
        cached = await redis.get(cache_key)
        if cached:
            return TenantUsage.from_dict(json.loads(cached))

        # 2. Aggregate from litellm_call_records
        stmt = select(
            LiteLLMCallRecord.model,
            LiteLLMCallRecord.cost_usd,
            LiteLLMCallRecord.prompt_tokens,
            LiteLLMCallRecord.completion_tokens,
            LiteLLMCallRecord.actor_id,
        ).where(
            LiteLLMCallRecord.tenant_id == tenant_id,
            LiteLLMCallRecord.timestamp >= since,
            LiteLLMCallRecord.timestamp < until,
        )

        rows = await db.execute(stmt)

        # 3. Aggregate
        total_cost = sum(r.cost_usd for r in rows)
        by_model = group_by(rows, key=lambda r: r.model, agg=sum_cost)
        by_user = group_by(rows, key=lambda r: r.actor_id, agg=sum_cost)

        # 4. Cache + return
        payload = TenantUsage(
            total_cost_usd=total_cost,
            by_model=by_model,
            by_user=by_user,
            ...
        ).to_dict()
        await redis.setex(cache_key, 60, json.dumps(payload))
        return payload
```

**Cache key format:** `forge:litellm:usage:<tenant_id>:<since_unix>:<until_unix>`

**TTL:** 60s (matches dashboard 60s polling)

**Graceful degradation:** Redis unavailable → fall back to Postgres + log warning.

### `get_burn_rate(tenant_id, since, until)`

```python
async def get_burn_rate(tenant_id, since, until) -> Decimal:
    """USD per hour for the tenant over the time window."""
    usage = await get_tenant_usage(tenant_id, since, until)
    hours = (until - since).total_seconds() / 3600
    return Decimal(usage.total_cost_usd) / Decimal(hours)
```

**Used by:** Cost Tracker sidebar widget, Steward dashboard burn rate display.

---

## Compliance feed (F-829i)

The Governance Center polls LiteLLM for guardrail firings every 30s:

```python
# backend/app/api/v1/governance.py
@router.get("/compliance-feed", response_model=list[ComplianceEvent])
async def get_compliance_feed(principal: Principal, db: DbSession):
    """Stream guardrail firings from LiteLLM Proxy.

    Maps to LiteLLM `GET /guardrail/events?team_id=<tenant_id>`.
    Dedupe on (team_id, guardrail_id, occurred_at) SHA-256.
    Cap at _MAX_PER_POLL = 500.
    """
    events = await litellm_proxy.get_guardrail_events(
        team_id=principal.tenant_id,
        since=last_seen_at,
        limit=_MAX_PER_POLL,  # 500
    )
    new_events = [e for e in events if not is_duplicate(e)]
    return new_events
```

**Polling cadence:** 30s

**Dedup key:** SHA-256(`team_id + guardrail_id + occurred_at`)

---

## Guardrails (LiteLLM config)

```yaml
# LiteLLM config.yaml
guardrails:
  - id: tenant_acme_corp
    type: pii_detection
    action: block
    settings:
      types: [ssn, credit_card, email, phone]

  - id: prod_global
    type: prompt_injection
    action: block
    settings:
      sensitivity: high

  - id: cost_cap
    type: cost_cap
    action: block
    settings:
      max_usd_per_key: 100
      max_usd_per_team_per_month: 5000
```

---

## Error mapping

```python
# backend/app/api/v1/admin_llm_gateway.py
def _litellm_error_to_http(exc: LiteLLMError) -> HTTPException:
    if isinstance(exc, LiteLLMBudgetExceededError):
        return HTTPException(429, f"LLM budget exceeded: {exc.detail}")
    if isinstance(exc, LiteLLMRateLimitError):
        return HTTPException(429, f"LLM rate limit: {exc.detail}")
    if isinstance(exc, LiteLLMGuardrailBlockedError):
        return HTTPException(451, f"Content blocked by guardrail: {exc.guardrail_id}")
    if isinstance(exc, LiteLLMProviderError):
        return HTTPException(502, f"LLM provider error: {exc.detail}")
    return HTTPException(500, "LLM gateway failure")
```

---

## Auth to LiteLLM Proxy

Forge's admin routes authenticate to LiteLLM using a **master key** (set in `settings.litellm_master_key`):

```python
# backend/app/core/config.py
class Settings(BaseSettings):
    litellm_proxy_url: str = "http://litellm:4000"
    litellm_master_key: str = Field(..., description="Master key for Forge → LiteLLM admin auth")
```

**Master key** is stored in AWS Secrets Manager (per-tenant dev: in `.env`).

**Per-tenant virtual keys** are what the LiteLLMClient uses for actual LLM calls.

---

## Verification checklist

- [ ] Every LLM call goes through `LiteLLMClient` (not direct SDK)
- [ ] Every LLM call uses a virtual key (not raw API key)
- [ ] Virtual key VALUE never returned after creation
- [ ] Fingerprint format: `sha256:<12-char-prefix>`
- [ ] Tenant sync on tenant create + settings update
- [ ] Usage query cached in Redis at `forge:litellm:usage:<tenant_id>:<since>:<until>` (60s TTL)
- [ ] Burn rate computed as USD/hour
- [ ] Compliance feed polls every 30s, dedupes on (team_id, guardrail_id, occurred_at)
- [ ] Error mapping: 429 (budget), 429 (rate), 451 (guardrail), 502 (provider)
- [ ] CI grep passes: no direct SDK imports

---

## Related docs

- [Standards: litellm-integration](../standards/litellm-integration.md) — Full integration patterns
- [Standards: architecture-rules](../standards/architecture-rules.md) — R1 enforcement
- [Product: architecture-summary](../product/architecture-summary.md) — System diagram
- [Features: admin-hub](../features/admin-hub.md) — LLM Gateway UI
- [Features: analytics](../features/analytics.md) — Usage query + cost attribution
- [Features: governance](../features/governance.md) — F-829i compliance feed
- [Features: copilot](../features/copilot.md) — V1 tools + budget enforcement
- [Reference: api-catalog](./api-catalog.md) — Every admin_llm_gateway route
- [Reference: db-schema](./db-schema.md) — `litellm_call_records` + `cost_ledger`