# Standard: API Conventions

> **Status:** ✅ Canonical — every backend route in Forge follows these conventions
> **Doc owner:** Platform team
> **Source of truth:** `~/forge-ai/backend/app/api/` + `backend/app/api/deps.py`
> **Last updated:** 2026-06-30

---

## Purpose

Every Forge backend route speaks the same dialect: same prefixes, same auth, same RBAC pattern, same error envelopes, same pagination, same idempotency. This document codifies the **wire contract** so frontend, mobile, third-party integrations, and tests all stay in sync.

---

## Source of truth

- **This file** — `/workspace/docs/standards/api-conventions.md`
- **Dependency providers** — `backend/app/api/deps.py` (`DbSession`, `Principal`, `require_permission`)
- **Common schemas** — `backend/app/schemas/common.py` (`Page[T]`, `ForgeBaseModel`)
- **Idempotency middleware** — `backend/app/core/idempotency.py`
- **Audit decorator** — `backend/app/core/audit.py`
- **Router aggregator** — `backend/app/api/v1/router.py`
- **OpenAPI spec** — `~/forge-ai/docs/openapi.json` (auto-generated)
- **Full route inventory** — `/workspace/docs/reference/api-catalog.md`

---

## 1. URL structure

### 1.1 — Versioned under `/api/v1`

All routes are versioned under `/api/v1/`. Breaking changes require a new version.

```
/api/v1/auth/login
/api/v1/workflows/{workflow_id}/runs
/api/v1/agents
/api/v1/seeds/{name}/apply
```

### 1.2 — Resource hierarchy

Sub-resources are nested under their parent with `/`:

```
/api/v1/projects/{project_id}/stories
/api/v1/projects/{project_id}/stories/{story_id}
/api/v1/projects/{project_id}/sprints
```

### 1.3 — Action verbs (not nouns)

For non-CRUD operations, use verbs on the resource:

```
POST /api/v1/seeds/{name}/apply
POST /api/v1/seeds/{name}/reset
POST /api/v1/seeds/{name}/rollback
POST /api/v1/refactor/plans/{plan_id}/push-to-jira
POST /api/v1/workflows/{workflow_id}/pause
```

### 1.4 — Plural resource names

```python
# ✅ Plural
GET /api/v1/workflows
GET /api/v1/agents

# ❌ Singular
GET /api/v1/workflow
GET /api/v1/agent
```

---

## 2. HTTP methods

| Method | Use | Idempotent? | RBAC |
|---|---|---|---|
| `GET` | Read | ✅ Yes | Per-resource |
| `POST` | Create / action | ❌ No | `require_permission` |
| `PUT` | Full replace | ✅ Yes | `require_permission` |
| `PATCH` | Partial update | ❌ No | `require_permission` |
| `DELETE` | Soft delete | ✅ Yes | `require_permission` |

**Rules:**
- `POST` and `PATCH` require an `Idempotency-Key` header (see §6)
- `DELETE` is soft — record `deleted_at` + `deleted_by` (R14)
- `GET` is the only method that doesn't need `@audit()` decorator

---

## 3. Auth + RBAC

### 3.1 — JWT principal

Every authenticated request carries a JWT with the tenant + actor claims:

```python
# backend/app/core/security.py
class AuthenticatedPrincipal:
    actor_id: UUID
    tenant_id: UUID
    project_id: UUID | None
    scopes: list[str]
    email: str
```

### 3.2 — Dependency injection pattern

Every route declares `db` + `principal` + optional permission guard:

```python
# backend/app/api/v1/seeds.py
from app.api.deps import DbSession, Principal, require_permission
from app.core.audit import audit

@router.get("/{name}", response_model=SeedManifestRead)
@audit(action="seeds.get", target_type="seed")
async def get_seed(
    name: str = Path(..., min_length=1, max_length=200),
    principal: Principal = ...,                              # auto-injected
    _perm: Principal = require_permission("seeds:view"),    # RBAC check
    db: DbSession = None,                                   # type: ignore[assignment]
) -> SeedManifestRead:
    ...
```

**Aliases (defined in `deps.py`):**

```python
DbSession = Annotated[AsyncSession, Depends(db_session)]
Principal = Annotated[AuthenticatedPrincipal, Depends(get_current_principal)]
```

**Why aliases:** Removes boilerplate. Routes can't forget to inject `principal` or `db` — FastAPI auto-injects.

### 3.3 — `require_permission(permission: str, *, policy_id: UUID | None = None)`

Builds a dependency that asserts the principal has `permission`. Optional `policy_id` adds a policy-engine check on top of RBAC.

```python
@router.post("/{name}/apply")
@audit(action="seeds.apply", target_type="seed")
async def apply_seed(
    name: str,
    body: SeedApplyRequest,
    principal: Principal = ...,
    _perm: Principal = require_permission("seeds:manage"),  # ← RBAC
    db: DbSession = None,
) -> SeedRunRead:
    ...
```

**403 returned when permission missing.** Reason included in `detail`.

### 3.4 — Cross-tenant = 404, not 403

```python
# ✅ Correct: cross-tenant reads return 404 (not 403)
async def get_story(story_id: UUID, principal: Principal, db: DbSession):
    story = await db.get(Story, story_id)  # RLS auto-filters
    if not story:
        raise HTTPException(status_code=404, detail="Story not found")
    return story

# ❌ Wrong: leaks tenant existence
async def get_story(story_id: UUID, principal: Principal, db: DbSession):
    story = await db.execute(
        select(Story).where(Story.id == story_id, Story.tenant_id == principal.tenant_id)
    )
    if not story:
        raise HTTPException(status_code=403, detail="Story belongs to another tenant")
    return story
```

**Why 404:** Returning 403 on cross-tenant reads lets an attacker enumerate which UUIDs belong to which tenants. 404 treats "tenant A's resource" and "non-existent resource" identically.

---

## 4. Pydantic schemas

### 4.1 — `ForgeBaseModel` for everything

```python
# backend/app/schemas/common.py
from pydantic import BaseModel, ConfigDict

class ForgeBaseModel(BaseModel):
    """Base for all Forge Pydantic models."""
    model_config = ConfigDict(
        from_attributes=True,    # ORM mode
        populate_by_name=True,
        str_strip_whitespace=True,
    )
```

**Per-feature models add `extra="forbid"`:**

```python
class MigrationPlan(ForgeBaseModel):
    """The typed migration-plan artifact produced by the Refactor Agent."""
    model_config = ConfigDict(extra="forbid")  # ← Add for strict validation
    ...
```

**Why `extra="forbid"`:**
- LLM responses can drift; rejecting unknown fields catches schema drift early
- Backend → backend contracts get explicit error vs silent pass-through
- Mirrors the wire JSON shape 1:1 (no surprise fields)

### 4.2 — Wire JSON field names

Pydantic `Field(alias=...)` for snake_case wire / camelCase Python is **banned**. Wire JSON is always snake_case to match Python attribute names and the database column names.

```python
# ✅ snake_case everywhere
class MigrationPlan(ForgeBaseModel):
    tenant_id: UUID
    project_id: UUID
    created_at: datetime

# ❌ Aliasing (banned)
class MigrationPlan(ForgeBaseModel):
    tenantId: UUID = Field(alias="tenantId")
```

### 4.3 — `Literal` over `Enum` for enums

`Literal` serializes/deserializes cleanly with JSON Schema. Python `Enum` adds runtime overhead and JSON quirks.

```python
# ✅ Literal
class ValidationReport(ForgeBaseModel):
    decision: Literal["PASS", "FAIL"]
    severity: Literal["critical", "high", "medium", "low", "info"]

# ❌ Python Enum
from enum import Enum
class Severity(str, Enum):
    CRITICAL = "critical"
    HIGH = "high"
    ...
```

### 4.4 — `Field` constraints

Use `Field(...)` for all validation constraints:

```python
class SeedManifestSummary(ForgeBaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    version: int = Field(..., ge=1)
    description: str | None = None
    depends_on: list[str] = Field(default_factory=list)
```

**Common constraints:**
- `min_length` / `max_length` — strings
- `ge` / `le` — numbers (inclusive)
- `gt` / `lt` — numbers (exclusive)
- `default_factory=list` — mutable defaults
- `default=None` — optional fields

### 4.5 — `field_validator` for cross-field validation

```python
class ValidationSummary(ForgeBaseModel):
    by_severity: dict[SeverityLiteral, int] = Field(default_factory=dict)

    @field_validator("by_severity")
    @classmethod
    def _ensure_known_severities(cls, v: dict[str, int]) -> dict[str, int]:
        unknown = set(v.keys()) - set(SEVERITY_LEVELS)
        if unknown:
            raise ValueError(
                f"by_severity contains unknown keys {sorted(unknown)!r}; "
                f"allowed: {list(SEVERITY_LEVELS)!r}"
            )
        return v
```

### 4.6 — `Page[T]` for list endpoints

```python
# backend/app/schemas/common.py
class Page(ForgeBaseModel, Generic[T]):
    items: list[T]
    total: int = Field(default=0, ge=0)
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=20, ge=1, le=100)
    has_more: bool = False
```

**Usage:**

```python
@router.get("", response_model=Page[SeedRunRead])
async def list_seed_runs(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    ...
) -> Page[SeedRunRead]:
    items = await service.list(...)
    return Page(items=items, total=total, page=page, page_size=page_size, has_more=...)
```

---

## 5. Tenant scoping

### 5.1 — `TenantScopedSession` (automatic)

The session factory sets `app.tenant_id` GUC per request, enabling Postgres RLS:

```python
# backend/app/db/session.py
async def get_session() -> AsyncIterator[AsyncSession]:
    async with async_session_factory() as session:
        await session.execute(text(f"SET LOCAL app.tenant_id = '{principal.tenant_id}'"))
        await session.execute(text(f"SET LOCAL app.actor_id = '{principal.actor_id}'"))
        try:
            yield session
        finally:
            await session.rollback()
```

### 5.2 — RLS policies

Every tenant-scoped table has a Postgres RLS policy:

```sql
-- Example from backend/app/db/migrations/versions/0004_ideation_source_signals.py
CREATE POLICY ideation_source_signals_tenant_isolation
  ON ideation_source_signals
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
```

### 5.3 — `TenantScopedModel`

```python
# backend/app/db/models/base.py
class TenantScopedModel:
    """Mixin that adds tenant_id + project_id columns.

    Tables using this mixin are auto-scoped by RLS via the session's
    GUC. Adding this mixin without also adding an RLS policy is a
    code review blocker.
    """
    tenant_id: Mapped[UUID] = mapped_column(GUID(), ForeignKey("tenants.id"), nullable=False, index=True)
    project_id: Mapped[UUID | None] = mapped_column(GUID(), ForeignKey("projects.id"), nullable=True, index=True)
```

---

## 6. Idempotency (R13)

### 6.1 — Header contract

Every `POST` / `PUT` / `PATCH` MUST include:

```
Idempotency-Key: <uuid-v4>
```

### 6.2 — Backend dedup

The middleware stores responses in Redis keyed by `(tenant_id, route, key)`:

```python
# backend/app/core/idempotency.py
def make_idempotency_key(tenant_id: str, route: str, client_key: str) -> str:
    raw = f"{tenant_id}|{route}|{client_key}".encode()
    return "forge:idem:" + hashlib.sha256(raw).hexdigest()
```

**Behavior:**
- First request with a key: execute + cache response (24h TTL)
- Subsequent requests with same key + same body: return cached response
- Subsequent requests with same key + different body: return 409 Conflict

### 6.3 — Frontend key generation

```typescript
// apps/forge/lib/api/client.ts
export async function postMutation<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    idempotencyKey: crypto.randomUUID(),  // fresh per attempt
    body: JSON.stringify(body),
  });
}
```

**Each user-action gets a fresh UUID.** Network retry with new key = new attempt (caller's intent). Network retry with same key = same response.

### Knowledge Graph — route prefix is `/kg/*`

The Knowledge Graph REST surface is mounted at `/api/v1/kg/*` (NOT
`/api/v1/knowledge/*`). See `backend/app/api/v1/knowledge_graph.py`
(`router = APIRouter(prefix="/kg", …)`).

When writing specs or docs, use `/kg/*`. The nine routes are listed
in `docs-site/src/content/docs/integration/phase-6-kg-wiring.md`.

---

## 7. Audit logging (R6)

### 7.1 — `@audit()` decorator

Every mutating route must be decorated:

```python
@router.post("/api-keys", response_model=VirtualKeyMetadata)
@audit(action="admin.llm_gateway.keys.create", target_type="virtual_key")
async def create_virtual_key(...):
    ...
```

**`action` naming convention:** `<domain>.<verb>` — e.g. `seeds.apply`, `admin.llm_gateway.keys.rotate`, `architecture.approval.decide`.

**`target_type`** — the type of resource being acted on (singular): `seed`, `virtual_key`, `approval`, `workflow`, `story`.

### 7.2 — Recorded fields

```python
audit_service.record(
    action=action,                    # "seeds.apply"
    target_type=target_type,          # "seed"
    target_id=result.id,              # UUID
    actor_id=principal.actor_id,      # from JWT
    tenant_id=principal.tenant_id,    # from JWT
    timestamp=datetime.now(timezone.utc),
    before_state=...,                 # optional
    after_state=...,                  # optional
    request_metadata={                # user agent, IP, etc.
        "ip": request.client.host,
        "user_agent": request.headers.get("user-agent"),
    },
)
```

### 7.3 — DB-level immutability

A `_reject_mutation` listener blocks UPDATE/DELETE on `audit_events`:

```python
# backend/app/db/models/audit_event.py
@event.listens_for(AuditEvent, "before_update", propagate=True)
def _reject_update(mapper, connection, target):
    raise ImmutableAuditLogError("Audit events are immutable")

@event.listens_for(AuditEvent, "before_delete", propagate=True)
def _reject_delete(mapper, connection, target):
    raise ImmutableAuditLogError("Audit events are immutable")
```

### 7.4 — SHA-256 hash chain

Each audit row references the previous row's hash, creating a tamper-evident chain:

```python
audit_event.previous_hash = last_event.current_hash if last_event else ZERO_HASH
audit_event.current_hash = sha256(
    audit_event.id + audit_event.payload + audit_event.previous_hash
)
```

---

## 8. Error envelopes

### 8.1 — Standard HTTP exceptions

```python
from fastapi import HTTPException

raise HTTPException(
    status_code=404,
    detail="Story not found",
)

raise HTTPException(
    status_code=403,
    detail="Permission denied: seeds:manage required",
)
```

### 8.2 — Error response shape

```json
{
  "detail": "Story not found"
}
```

**Validation errors (422):**

```json
{
  "detail": [
    {
      "loc": ["body", "name"],
      "msg": "Field required",
      "type": "missing"
    }
  ]
}
```

### 8.3 — Custom error types (rare)

```python
# backend/app/core/errors.py
class SeedProductionGateError(Exception):
    """Raised when a non-prod seed is applied in production without override."""

class IdempotencyConflictError(Exception):
    """Raised when Idempotency-Key reuse with different body."""
```

**Map to HTTP at the boundary:**

```python
def _seed_error_to_http(exc: SeedRunnerError) -> HTTPException:
    if isinstance(exc, SeedNotFoundError):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, SeedProductionGateError):
        return HTTPException(status_code=403, detail=str(exc))
    return HTTPException(status_code=500, detail="Seed runner failure")
```

---

## 9. Caching

### 9.1 — Redis cache key format

```
forge:<domain>:<tenant_id>:<entity_id>[:<secondary_id>]
```

**Examples:**

```
forge:litellm:usage:<tenant_id>:<since_unix>:<until_unix>     # Analytics
forge:idem:<sha256(tenant|route|key)>                         # Idempotency
forge:tenant_slug:<tenant_id>                                 # Slug cache
forge:tenant_health:<tenant_id>                               # Tenant status
```

### 9.2 — TTL conventions

| TTL | Use |
|---|---|
| `60s` | Hot-path aggregations (LLM usage dashboard) |
| `300s` | Tenant directory lookups |
| `86_400s` (24h) | Idempotency response cache |
| `600s` | Drift detection snapshots |

### 9.3 — Graceful degradation

```python
# ✅ Redis down → fall back to SQL
try:
    cached = await redis.get(key)
except redis.RedisError:
    logger.warning("Redis unavailable; serving fresh result")
    cached = None

if cached is None:
    result = await db.execute(...)
    try:
        await redis.setex(key, ttl, json.dumps(result))
    except redis.RedisError:
        pass  # cache miss is logged; query succeeds
    return result
```

---

## 10. Pagination

### 10.1 — Page-based (default)

```python
@router.get("", response_model=Page[Story])
async def list_stories(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    ...
```

### 10.2 — Cursor-based (for streaming)

```python
@router.get("/events", response_model=list[WorkflowEvent])
async def stream_workflow_events(
    workflow_id: UUID,
    after: UUID | None = Query(None, description="Cursor (last event_id)"),
):
    ...
```

### 10.3 — Default limits

| Endpoint type | Default | Max |
|---|---|---|
| List endpoints | 20 | 100 |
| Event streams | 100 | 500 |
| Search results | 10 | 50 |

---

## 11. SSE / WebSocket

### 11.1 — SSE for one-way streams

```
GET /api/v1/workflows/{id}/events
Accept: text/event-stream
```

**Token via query param** (EventSource cannot set headers):

```
GET /api/v1/workflows/{id}/events?token=<jwt>
```

### 11.2 — WebSocket for two-way streams

```
WS /api/v1/terminal/{session_id}?token=<jwt>
```

Same token-via-query-param pattern.

### 11.3 — Event format

```
event: phase.completed
id: <event_id>
data: {"phase_id": "phase-001-1", "duration_ms": 4500}

```

**Typed events:** `phase.started`, `phase.completed`, `phase.failed`, `run.completed`, `run.failed`.

---

## 12. OpenAPI / docs

Every FastAPI app auto-generates `/openapi.json` and `/docs` (Swagger UI). The `/docs` endpoint is gated by environment:

```python
# backend/app/main.py
if settings.environment != "production":
    app.add_middleware(... docs=True ...)
```

The canonical OpenAPI spec lives at `~/forge-ai/docs/openapi.json`.

---

## 13. Forbidden patterns

```python
# ❌ Missing RBAC
@router.post("/api-keys")
async def create_key(...):  # No require_permission

# ❌ Missing audit
@router.delete("/stories/{id}")
async def delete_story(...):  # No @audit

# ❌ Missing tenant filter
.where(Story.id == story_id)  # No tenant_id check (relies on RLS only — code review will flag)

# ❌ Hardcoded tenant
.where(Story.tenant_id == UUID("00000000-0000-4000-8000-000000000001"))

# ❌ Cross-tenant = 403 (should be 404)
if story.tenant_id != principal.tenant_id:
    raise HTTPException(403)

# ❌ Snake_case aliases (banned)
class Story(BaseModel):
    storyId: UUID = Field(alias="storyId")

# ❌ Python Enum for wire
from enum import Enum
class Severity(str, Enum):
    CRITICAL = "critical"

# ❌ Python Enum (in literal position)
class Report(BaseModel):
    decision: Severity  # Use Literal["PASS", "FAIL"] instead

# ❌ Loose dict access
plan = json.loads(response)
phases = plan["phased_plan"]  # No type safety

# ❌ POST without Idempotency-Key (frontend side)
await fetch("/api/v1/workflows", { method: "POST" })  # No Idempotency-Key
```

---

## 14. Verification checklist

- [ ] All routes under `/api/v1/`
- [ ] All mutating routes have `@audit(action="...", target_type="...")`
- [ ] All mutations have `require_permission(...)` dependency
- [ ] All POSTs/PUTs/PATCHes send `Idempotency-Key` (frontend)
- [ ] All Pydantic models extend `ForgeBaseModel`
- [ ] All wire DTOs use `extra="forbid"` (for typed artifacts)
- [ ] All enums are `Literal`, not Python `Enum`
- [ ] All field names are snake_case (no aliases)
- [ ] All list endpoints return `Page[T]`
- [ ] All tenant-scoped tables use `TenantScopedModel` mixin
- [ ] All cross-tenant reads return 404, not 403
- [ ] All Redis caches use `forge:<domain>:<tenant_id>:<entity_id>` key format
- [ ] All Redis operations gracefully degrade (try/except)
- [ ] OpenAPI spec regenerates without errors

---

## Related docs

- [Architecture rules](./architecture-rules.md)
- [Coding standards](./coding-standards.md)
- [Design system](./design-system.md)
- [Data model](./data-model.md)
- [Testing](./testing.md)
- [Git workflow](./git-workflow.md)
- [LiteLLM integration](./litellm-integration.md)
- [API catalog](../reference/api-catalog.md) — full route inventory
- [Auth](../features/auth.md) — OIDC + JWT details
- [Audit](../features/audit.md) — `@audit()` + immutability + hash chain