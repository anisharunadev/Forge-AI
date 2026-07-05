# Rate Limiting Standard

> **Status:** Phase 6 SC-6.2 owner
> **Source of truth:** `backend/app/core/rate_limit.py`

## Defaults

- **Per-tenant chat completions:** 60 requests / minute (rolling window).
- **Override per tenant:** `Tenant.settings["rate_limit_overrides"][surface]` (integer).

## Surfaces

Each surface has an independent counter (keyed by `tenant_id`):

- `chat` — `/forge/chat/stream`
- `copilot` — `/copilot/conversations`
- `keys` — `/forge/keys/*`
- `rag` — `/forge/rag/search`

## Storage

- **Redis (preferred):** ZSET sliding window, atomic via pipeline.
- **In-process fallback:** `deque` per `(tenant, surface)`. Used when
  Redis is unreachable and in tests.

## Response

A rate-limited call returns HTTP **429** with the `Retry-After` header
(integer seconds). The body is JSON:

```json
{
  "error": "rate_limit_exceeded",
  "surface": "chat",
  "retry_after_seconds": 12,
  "limit": 60
}
```
