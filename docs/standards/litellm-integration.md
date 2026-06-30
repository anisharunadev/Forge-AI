# Standard: LiteLLM Integration

> **Status:** ✅ Canonical — every LLM call in Forge flows through LiteLLM Proxy
> **Doc owner:** Platform team
> **Source of truth:** `~/forge-ai/backend/app/core/litellm_client.py` + `backend/app/integrations/litellm/`
> **Last updated:** 2026-06-30
> **Constitutional rule:** R1 (provider-agnostic LLM access)

---

## Purpose

**All LLM traffic in Forge flows through the LiteLLM Proxy.** Never direct SDK imports. This document codifies the wire contract between Forge backend and the LiteLLM Proxy: virtual keys, model naming, cost attribution, audit integration, and guardrails.

---

## Source of truth

- **This file** — `/workspace/docs/standards/litellm-integration.md`
- **Client wrapper** — `backend/app/core/litellm_client.py`
- **LLM Gateway API** — `backend/app/api/v1/admin_llm_gateway.py`
- **Usage query** — `backend/app/integrations/litellm/usage_query.py`
- **Tenant sync** — `backend/app/integrations/litellm/tenant_sync.py`
- **Bridge reference** — `/workspace/docs/reference/litellm-bridge.md`

---

## 1. Why LiteLLM Proxy (R1)

### 1.1 — The problem

Without a proxy:
- Every service makes direct SDK calls (OpenAI, Anthropic, Bedrock, etc.)
- No unified cost tracking
- No unified rate limiting
- No unified audit
- Vendor lock-in (switching providers = code changes everywhere)

### 1.2 — The solution

Forge → LiteLLM Proxy → LLM Providers (Anthropic, OpenAI, Bedrock, Vertex AI, etc.)

**Benefits:**
- **Single integration point** — switch providers via LiteLLM config, not code
- **Cost governance** — every call metered, attributed, capped
- **Audit** — every call logged to `litellm_call_records`
- **Rate limiting** — per-tenant, per-key, per-model
- **Guardrails** — content filtering, PII detection, prompt injection defenses
- **Virtual keys** — per-feature keys with scoped budgets

---

## 2. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│ Forge Backend                                                │
│                                                              │
│  ┌─────────────────────┐      ┌─────────────────────┐       │
│  │  LiteLLMClient      │      │  LLM Gateway API    │       │
│  │  (chat, embed)      │      │  (admin_llm_gateway)│       │
│  └──────────┬──────────┘      └──────────┬──────────┘       │
│             │                              │                  │
│             │ HTTP                         │ HTTP             │
└─────────────┼──────────────────────────────┼──────────────────┘
              │                              │
              ▼                              ▼
┌──────────────────────────────────────────────────────────────┐
│ LiteLLM Proxy (separate deployment)                          │
│                                                              │
│  - /chat/completions       - /v1/keys (virtual key mgmt)    │
│  - /embeddings             - /v1/teams                       │
│  - /v1/models              - audit log endpoint              │
│                                                              │
└──────────┬───────────────────────────────────────────────────┘
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

## 3. The LiteLLMClient wrapper

### 3.1 — Location

```python
# backend/app/core/litellm_client.py
from app.core.litellm_client import LiteLLMClient
```

### 3.2 — Virtual key pattern

Every LLM call uses a **virtual key** scoped to a feature + tenant. Never the raw provider API key.

```python
client = LiteLLMClient(
    virtual_key="forge_validator_<tenant_uuid>",
    tenant_id=tenant_uuid,
    feature="validator",  # for cost attribution
)
```

**Virtual key prefix conventions:**

| Prefix | Used by |
|---|---|
| `forge_copilot_*` | Co-pilot conversations |
| `forge_validator_*` | Code Validator (F-501) |
| `forge_refactor_*` | Refactor Agent (F-601) |
| `forge_ideation_*` | Ideation Center (PRD generation) |
| `forge_architecture_*` | Architecture Center (ADR synthesis) |
| `forge_knowledge_*` | Knowledge Center (entity extraction) |

### 3.3 — Chat completions

```python
async def stream_response(prompt: str, virtual_key: str) -> AsyncIterator[str]:
    client = LiteLLMClient(virtual_key=virtual_key)
    async for chunk in client.acompletion(
        model="anthropic/claude-sonnet-4.5",  # provider/model format
        messages=[{"role": "user", "content": prompt}],
        temperature=0.7,
        max_tokens=4096,
        stream=True,
    ):
        yield chunk.choices[0].delta.content or ""
```

### 3.4 — Embeddings

```python
async def embed_texts(texts: list[str]) -> list[list[float]]:
    client = LiteLLMClient(virtual_key="forge_knowledge_*")
    response = await client.aembeddings(
        model="text-embedding-3-small",
        input=texts,
    )
    return [item.embedding for item in response.data]
```

### 3.5 — JSON schema enforcement (typed outputs, R4)

```python
response = await client.acompletion(
    model="anthropic/claude-sonnet-4.5",
    messages=[{"role": "user", "content": prompt}],
    response_format={
        "type": "json_schema",
        "json_schema": MigrationPlan.model_json_schema(),
    },
)

# Parse via Pydantic (NEVER raw dict access)
plan = MigrationPlan.model_validate(json.loads(response.choices[0].message.content))
```

**Why JSON schema:** LLM outputs are typed artifacts (R4). `response_format=json_schema` constrains the LLM to emit valid JSON matching the schema.

---

## 4. Model naming

### 4.1 — `provider/model` format

```python
# ✅ Correct: provider/model
model="anthropic/claude-sonnet-4.5"
model="openai/gpt-4o"
model="bedrock/anthropic.claude-3-sonnet"
model="vertex_ai/gemini-1.5-pro"

# ❌ Wrong: bare model name
model="claude-sonnet-4.5"  # Which provider? Which region? Which key?
```

### 4.2 — Model aliases (in LiteLLM config)

```yaml
# LiteLLM config.yaml
model_name: claude-sonnet
  litellm_params:
    model: anthropic/claude-sonnet-4.5
  model_info:
    cost_per_token: 0.00003

model_name: gpt-4o
  litellm_params:
    model: openai/gpt-4o
  model_info:
    cost_per_token: 0.00001
```

Forge code references the alias:

```python
model="claude-sonnet"  # resolves via LiteLLM config
```

**Benefits:**
- Change provider without code change (edit LiteLLM config)
- Per-tenant model overrides (Enterprise tier gets a different model)
- Cost-per-token updated centrally

### 4.3 — Default model per feature

| Feature | Default model | Rationale |
|---|---|---|
| Co-pilot | `claude-sonnet-4.5` | Fast + good reasoning |
| Validator | `claude-sonnet-4.5` | Code reasoning |
| Refactor | `claude-sonnet-4.5` | Long context + reasoning |
| Ideation | `claude-sonnet-4.5` | Creative + structured |
| Knowledge (embeddings) | `text-embedding-3-small` | Cost-effective |

---

## 5. Cost attribution

### 5.1 — `litellm_call_records` table

Every LLM call (success or failure) writes a row to `litellm_call_records`:

```python
class LiteLLMCallRecord(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "litellm_call_records"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    project_id: Mapped[UUID | None] = mapped_column(GUID(), nullable=True, index=True)

    virtual_key: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    feature: Mapped[str] = mapped_column(String(64), nullable=False, index=True)

    model: Mapped[str] = mapped_column(String(100), nullable=False)
    provider: Mapped[str] = mapped_column(String(64), nullable=False)

    prompt_tokens: Mapped[int] = mapped_column(Integer, nullable=False)
    completion_tokens: Mapped[int] = mapped_column(Integer, nullable=False)
    total_tokens: Mapped[int] = mapped_column(Integer, nullable=False)
    cost_usd: Mapped[float] = mapped_column(Numeric(12, 6), nullable=False)

    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    success: Mapped[bool] = mapped_column(Boolean, nullable=False, index=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)

    actor_id: Mapped[UUID | None] = mapped_column(GUID(), nullable=True)
    forge_trace_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
```

### 5.2 — 60s Redis cache

```python
# backend/app/integrations/litellm/usage_query.py
def _cache_key(tenant_id, since, until) -> str:
    return f"forge:litellm:usage:{tenant_id}:{int(since.timestamp())}:{int(until.timestamp())}"
```

**TTL:** 60s (matches dashboard polling). Miss → Postgres aggregation → cache write.

### 5.3 — Cost ledger writes

Every call also writes to `cost_ledger` for billing:

```python
class CostLedgerEntry(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "cost_ledger"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    project_id: Mapped[UUID | None] = mapped_column(GUID(), nullable=True, index=True)
    actor_id: Mapped[UUID | None] = mapped_column(GUID(), nullable=True)
    feature: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    amount_usd: Mapped[Decimal] = mapped_column(Numeric(12, 6), nullable=False)
    source: Mapped[str] = mapped_column(String(32), nullable=False)  # "litellm" | "cli"
```

---

## 6. Virtual keys

### 6.1 — Key lifecycle

```
1. Admin calls POST /api/v1/admin/llm-gateway/tenants/{tenant_id}/keys
   ├── Creates virtual key via LiteLLM Proxy
   ├── Sets budget, rate limits, allowed models
   └── Returns {key_id, fingerprint, budget_usd, expires_at}

2. Forge services use the virtual key for LLM calls
   └── LiteLLM enforces budget + rate limits

3. Periodic sync: LiteLLM usage → Forge cost_ledger (every 5 min)

4. Admin can rotate: POST /tenants/{tenant_id}/keys/{key_id}/revoke
   └── Old key stops working immediately
```

### 6.2 — Key fingerprint (never display VALUE)

```python
# backend/app/api/v1/admin_llm_gateway.py
@router.post("/tenants/{tenant_id}/keys", response_model=VirtualKeyMetadata)
@audit(action="admin.llm_gateway.keys.create", target_type="virtual_key")
async def create_virtual_key(...):
    # Create via LiteLLM Proxy
    raw_key = await litellm_proxy.create_key(...)
    # Store fingerprint only
    fingerprint = f"sha256:{hashlib.sha256(raw_key.encode()).hexdigest()[:12]}"
    metadata = VirtualKeyMetadata(
        key_id=...,
        fingerprint=fingerprint,  # Only fingerprint shown
        budget_usd=...,
        # NEVER store or return raw_key after creation
    )
    # Return ONCE at creation; never again
    return metadata
```

**Why:** DB dumps must not leak working keys. The fingerprint is enough for audit; the raw key only flows once at creation.

### 6.3 — Per-feature budget

```python
metadata = VirtualKeyMetadata(
    key_id=key_id,
    feature="validator",
    budget_usd=Decimal("100.00"),  # $100/month cap
    rate_limit_rpm=60,  # 60 requests/minute
    allowed_models=["claude-sonnet-4.5"],  # restricted to specific model
)
```

When budget hit, LiteLLM returns `429 Budget exceeded`. Forge surfaces this as a typed error.

---

## 7. Guardrails

### 7.1 — LiteLLM guardrail types

| Type | Purpose | Examples |
|---|---|---|
| `pii_detection` | Block PII in prompts/responses | SSN, credit cards |
| `prompt_injection` | Block prompt injection attacks | "Ignore previous instructions" |
| `content_filter` | Block harmful content | Violence, hate speech |
| `jailbreak` | Block jailbreak attempts | "DAN mode", etc. |
| `secrets_detection` | Block leaked secrets in responses | API keys, passwords |
| `cost_cap` | Per-key budget enforcement | $100/month |

### 7.2 — Per-tenant guardrail config

```yaml
# LiteLLM config
guardrails:
  - id: tenant_acme_corp
    type: pii_detection
    action: block  # block | redact | log
    settings:
      types: [ssn, credit_card, email, phone]
```

### 7.3 — F-829i compliance feed

The Governance Center polls LiteLLM for guardrail firings every 30s:

```python
# backend/app/api/v1/governance.py
@router.get("/compliance-feed", response_model=list[ComplianceEvent])
async def get_compliance_feed(principal: Principal, db: DbSession):
    events = await litellm_proxy.get_guardrail_events(
        team_id=principal.tenant_id,
        since=last_seen_at,
    )
    # Dedupe on (team_id, guardrail_id, occurred_at) SHA-256
    new_events = [e for e in events if not is_duplicate(e)]
    return new_events
```

---

## 8. Error handling

### 8.1 — LiteLLM error types

```python
from app.core.errors import (
    LiteLLMBudgetExceededError,
    LiteLLMRateLimitError,
    LiteLLMGuardrailBlockedError,
    LiteLLMProviderError,
)
```

### 8.2 — Mapping to HTTP

```python
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

## 9. The 3 forbidden patterns (R1 enforcement)

### 9.1 — Direct SDK imports

```python
# ❌ FORBIDDEN — direct OpenAI SDK
import openai
client = openai.OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
client.chat.completions.create(...)

# ❌ FORBIDDEN — direct Anthropic SDK
import anthropic
client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
client.messages.create(...)

# ❌ FORBIDDEN — direct HTTP to provider
import httpx
await httpx.post("https://api.openai.com/v1/chat/completions", ...)

# ❌ FORBIDDEN — direct Bedrock SDK
import boto3
client = boto3.client("bedrock-runtime")
client.invoke_model(...)
```

**All of these bypass the proxy → no cost tracking → no audit → no rate limit → no guardrails.**

### 9.2 — Hardcoded API keys

```python
# ❌ FORBIDDEN
api_key = "sk-ant-..."

# ✅ Correct: virtual key from LLM Gateway
api_key = await get_tenant_virtual_key(tenant_id, feature="copilot")
```

### 9.3 — Provider names in code

```python
# ❌ FORBIDDEN — provider-specific code
if provider == "anthropic":
    response = anthropic_client.messages.create(...)
elif provider == "openai":
    response = openai_client.chat.completions.create(...)

# ✅ Correct: model alias
response = await LiteLLMClient(...).acompletion(model="claude-sonnet-4.5", ...)
```

---

## 10. CI enforcement

A grep check runs on every PR:

```yaml
# .github/workflows/lint.yml
- name: R1 enforcement — no direct SDK imports
  run: |
    if grep -rE "from openai|from anthropic|from google\.generativeai|from cohere|from mistralai" backend/app/; then
      echo "❌ R1 violation: direct SDK imports found"
      exit 1
    fi
    echo "✅ R1 compliance: no direct SDK imports"
```

**Any PR that fails this check is auto-rejected.**

---

## 11. Verification checklist

- [ ] Every LLM call uses `LiteLLMClient` (not direct SDK)
- [ ] Every LLM call uses a virtual key (not raw API key)
- [ ] Every virtual key has a feature prefix (`forge_copilot_*`, etc.)
- [ ] Every LLM call writes to `litellm_call_records` (auto via LiteLLM)
- [ ] Every typed artifact uses `response_format=json_schema` (R4)
- [ ] No `os.getenv("OPENAI_API_KEY")` or similar
- [ ] No provider-specific code paths (`if provider == "anthropic":`)
- [ ] No direct SDK imports (CI grep passes)
- [ ] Error types are mapped to HTTP (`_litellm_error_to_http`)
- [ ] Budget exceeded → 429 (not 500)
- [ ] Guardrail blocked → 451 (Unavailable for Legal Reasons)
- [ ] Provider error → 502 (Bad Gateway)

---

## Related docs

- [Architecture rules](./architecture-rules.md) — R1 enforcement
- [Coding standards](./coding-standards.md)
- [Design system](./design-system.md)
- [API conventions](./api-conventions.md)
- [Data model](./data-model.md)
- [Testing](./testing.md)
- [Git workflow](./git-workflow.md)
- [LiteLLM bridge](../reference/litellm-bridge.md) — endpoint map
- [Admin Hub](../features/admin-hub.md) — virtual key lifecycle
- [Analytics](../features/analytics.md) — usage query + cost attribution
- [Governance](../features/governance.md) — F-829i compliance feed
- [Copilot](../features/copilot.md) — V1 tools + budget enforcement