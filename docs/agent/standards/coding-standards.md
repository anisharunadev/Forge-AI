# Standard: Coding Standards

> **Status:** ✅ Canonical — every line of code in Forge follows these patterns
> **Doc owner:** Platform team
> **Source of truth:** `~/forge-ai/CLAUDE.md` + `~/forge-ai/forge-design-system.md`
> **Last updated:** 2026-06-30

---

## Purpose

Forge is a TypeScript + Python codebase with strict conventions to keep AI agents and humans on the same page. This document codifies the **naming, file organization, and language-specific patterns** that every contribution must follow.

---

## Source of truth

- **This file** — `/workspace/docs/standards/coding-standards.md`
- **TypeScript style** — `.eslintrc.json` (root) + `apps/forge/tsconfig.json`
- **Python style** — `backend/pyproject.toml` (Ruff config) + `backend/.ruff.toml`
- **TypeScript barrel** — `apps/forge/lib/design-system/tokens.ts`

---

## 1. General principles

### 1.1 — Readability over cleverness

```typescript
// ❌ Clever
const x = arr.filter(a => a.b).map(a => ({ ...a, c: a.c ?? d })).slice(0, n);

// ✅ Readable
const filtered = items.filter((item) => item.isActive);
const enriched = filtered.map((item) => ({
  ...item,
  category: item.category ?? defaultCategory,
}));
const top = enriched.slice(0, MAX_RESULTS);
```

### 1.2 — Explicit > implicit

```python
# ❌ Implicit
def process(data):
    return data.get("results", [])

# ✅ Explicit
def get_results(data: dict[str, Any]) -> list[dict[str, Any]]:
    """Extract results from API response. Returns empty list if missing."""
    return data.get("results", [])
```

### 1.3 — Single responsibility

One module = one purpose. One function = one verb. One class = one noun.

```typescript
// ❌ God object
class Workspace {
  createProject(): Project { ... }
  inviteUser(): void { ... }
  generateReport(): Report { ... }
  calculateBilling(): Billing { ... }
}

// ✅ Bounded contexts
class ProjectService { ... }
class UserService { ... }
class ReportGenerator { ... }
class BillingCalculator { ... }
```

---

## 2. File organization

### 2.1 — Frontend (`apps/forge/`)

```
apps/forge/
├── app/                          # Next.js App Router
│   ├── (auth)/                   # Route group (no URL prefix)
│   │   └── login/page.tsx
│   ├── dashboard/
│   │   ├── page.tsx              # The page
│   │   ├── loading.tsx           # Skeleton (replaces spinner)
│   │   └── error.tsx             # Error boundary
│   └── api/                      # API routes (rare — backend handles)
├── components/                   # React components
│   ├── ui/                       # shadcn primitives (Button, Input, ...)
│   ├── admin/                    # AdminShell + admin chrome
│   ├── shell/                    # Topbar + Sidebar + WorkspaceSwitcher
│   ├── analytics/                # Feature components
│   ├── copilot/
│   ├── workflows/
│   └── ...
├── lib/                          # Framework-free utilities
│   ├── api/                      # API client (only client.ts allowed, no api.ts or forge-api.ts)
│   ├── hooks/                    # TanStack Query hooks
│   ├── auth.ts                   # Auth store
│   ├── design-system/            # Token source of truth
│   └── utils.ts                  # cn() + small helpers
└── config/
    └── dev-seeds.ts              # Dev-only constants (acme-corp)
```

**Rules:**
- **One component per file** — file name matches component name (`MigrationPlanCard.tsx` exports `MigrationPlanCard`)
- **`index.ts` barrel only for folders with 5+ files** — otherwise import directly
- **`page.tsx` is server-rendered unless `'use client'` at top** — explicit client components
- **`loading.tsx` uses skeletons, never spinners** — per R18 (accessibility)
- **`error.tsx` defines `ErrorBoundary`** — typed error messages, not raw stack traces

### 2.2 — Backend (`backend/app/`)

```
backend/app/
├── main.py                       # FastAPI app entry
├── core/                         # Cross-cutting infrastructure
│   ├── config.py                 # Settings (Pydantic BaseSettings)
│   ├── audit.py                  # @audit decorator
│   ├── telemetry.py              # OpenTelemetry setup
│   ├── encryption.py             # Fernet envelope
│   └── idempotency.py            # Idempotency-Key middleware
├── api/
│   └── v1/                       # All REST routes (versioned)
│       ├── router.py             # Aggregator
│       ├── auth.py               # Auth endpoints
│       ├── workflows.py          # Workflow endpoints
│       ├── seeds.py              # Seed endpoints
│       └── ...
├── agents/                       # LangGraph sub-graphs
│   ├── sdlc_agent.py             # Main SDLC supervisor
│   ├── sdlc_state.py             # SDLCState TypedDict
│   ├── refactor_agent.py         # F-601 sub-graph
│   ├── code_validator.py         # F-501 sub-graph
│   └── prompts/                  # Jinja2 templates
│       ├── sdlc_agent.j2
│       ├── refactor_agent.j2
│       └── ...
├── db/
│   ├── models/                   # SQLAlchemy models
│   ├── base.py                   # TenantScopedModel + SoftDeleteMixin
│   └── session.py                # AsyncSession factory
├── schemas/                      # Pydantic models (wire DTOs)
│   ├── common.py                 # ForgeBaseModel + Page[T]
│   ├── workflow.py
│   └── ...
└── services/                     # Business logic (no FastAPI imports)
    ├── workflow_executor.py
    ├── seed_service.py
    └── ...
```

**Rules:**
- **`api/` is thin** — route handlers delegate to `services/`
- **`services/` is framework-free** — no FastAPI imports, no HTTP concerns
- **`schemas/` is the wire DTO layer** — input/output of every route
- **`db/models/` is the persistence layer** — SQLAlchemy, NEVER imported into `api/`
- **`agents/` is LangGraph-specific** — sub-graphs with their own state

---

## 3. TypeScript conventions

### 3.1 — Naming

| Entity | Convention | Example |
|---|---|---|
| Components | `PascalCase` | `MigrationPlanCard`, `WorkspaceSwitcher` |
| Hooks | `camelCase` + `use` prefix | `useValidationReports`, `useTenantId` |
| Functions | `camelCase` | `listMigrationPlans`, `coerceTenantId` |
| Constants | `SCREAMING_SNAKE_CASE` | `MAX_RESULTS`, `SEED_TENANT_SLUG` |
| Types / Interfaces | `PascalCase` | `MigrationPlan`, `RefactorPhase` |
| Enums (union types) | `PascalCase` literal | `'critical' \| 'high' \| 'medium' \| 'low'` |
| Files (components) | `PascalCase.tsx` | `MigrationPlanCard.tsx` |
| Files (utilities) | `camelCase.ts` | `forgeFetch.ts`, `dev-seeds.ts` |
| Folders | `kebab-case/` | `command-center/`, `forge-pi/` |

### 3.2 — `readonly` everywhere

```typescript
// ✅ Immutable by default
interface MigrationPlan {
  readonly planId: string;
  readonly projectId: string;
  readonly phases: ReadonlyArray<RefactorPhase>;
  readonly risks: ReadonlyArray<RefactorRisk>;
}

// ✅ Function signatures
export async function getMigrationPlan(
  planId: string,
): Promise<MigrationPlan> { ... }

// ❌ Mutable (banned in domain types)
interface MigrationPlan {
  planId: string;
  phases: RefactorPhase[];
}
```

### 3.3 — Type imports

```typescript
// ✅ Type-only imports (erased at compile time)
import type { MigrationPlan, RefactorPhase } from "@/lib/api";

// ❌ Mixed imports (pulls runtime code into type-only contexts)
import { MigrationPlan, RefactorPhase } from "@/lib/api";
```

### 3.4 — Pydantic mirror pattern

For every backend Pydantic schema, the frontend has a 1:1 TypeScript mirror.

**Backend:**

```python
# backend/app/schemas/migration_plan.py
class MigrationPhase(ForgeBaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(default_factory=lambda: str(uuid4()))
    order: int = Field(..., ge=0, le=1_000)
    name: str = Field(..., min_length=3, max_length=200)
    status: MigrationPhaseStatus = MigrationPhaseStatus.PLANNED
```

**Frontend mirror:**

```typescript
// apps/forge/lib/api.ts
export interface MigrationPhase {
  readonly id: string;
  readonly order: number;
  readonly name: string;
  readonly status: 'planned' | 'in_progress' | 'completed' | 'blocked' | 'deferred';
}
```

**Mirror rules:**
- **Field names match wire JSON exactly** (snake_case)
- **`readonly` on every field**
- **Union types widen at the UI boundary** (e.g. add `'drift_detected'` if backend literal is `'rolled_back'`)
- **Adapters live in `lib/api/transformers/`** for divergences (status name mismatch, effort bucket heuristic)

### 3.5 — TanStack Query patterns

```typescript
// ✅ Stable query keys + invalidation
export const migrationQueryKeys = {
  all: ['refactor'] as const,
  list: (projectId: string) =>
    [...migrationQueryKeys.all, 'list', projectId] as const,
  detail: (planId: string) =>
    [...migrationQueryKeys.all, 'detail', planId] as const,
};

export function useMigrationPlans(projectId: string) {
  return useQuery({
    queryKey: migrationQueryKeys.list(projectId),
    queryFn: () => listMigrationPlans(projectId),
    enabled: Boolean(projectId),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

// ✅ Mutations invalidate dependent queries
export function useApplySeed(name: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SeedApplyRequest = {}) => seedsApi.applySeed(name, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: seedKeys.status(name) });
      void qc.invalidateQueries({ queryKey: seedKeys.runs(name) });
    },
  });
}
```

**Rules:**
- **Query keys are typed `as const`** — survives HMR / route changes
- **`enabled: Boolean(...)`** — never fetch with empty inputs
- **`refetchInterval` matches backend cache TTL** — no point polling faster
- **Mutations invalidate ALL dependent queries** — never partial invalidation
- **Smart polling predicates** — e.g. detail page polls 10s while running, stops when complete

### 3.6 — `useState` patterns

```typescript
// ✅ Discriminated union for loading state
type State<T> =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'success'; data: T }
  | { kind: 'error'; error: Error };

const [state, setState] = useState<State<T>>({ kind: 'idle' });

// ❌ Multiple booleans (race conditions)
const [isLoading, setIsLoading] = useState(false);
const [data, setData] = useState<T | null>(null);
const [error, setError] = useState<Error | null>(null);
```

### 3.7 — Conditional rendering

```tsx
// ✅ Type-narrowed
{query.isLoading && <Skeleton />}
{query.isError && <ErrorMessage error={query.error} />}
{query.data && <DataView data={query.data} />}

// ❌ Truthy checks (data could be 0 or '')
{query.data && <DataView data={query.data} />}
```

---

## 4. Python conventions

### 4.1 — Naming

| Entity | Convention | Example |
|---|---|---|
| Modules | `snake_case.py` | `seed_service.py`, `litellm_client.py` |
| Classes | `PascalCase` | `MigrationPlan`, `SeedRunner` |
| Functions | `snake_case` | `list_seeds`, `coerce_tenant_id` |
| Constants | `SCREAMING_SNAKE_CASE` | `SCHEMA_VERSION`, `SEVERITY_LEVELS` |
| Variables | `snake_case` | `tenant_id`, `run_status` |
| Type variables | `PascalCase` | `T`, `MigrationPlanT` |
| Pydantic fields | `snake_case` (wire) | `tenant_id`, `project_id` |

### 4.2 — Type hints (mandatory)

```python
# ✅ All function signatures annotated
async def list_migration_plans(
    db: AsyncSession,
    principal: Principal,
    project_id: UUID,
) -> list[MigrationPlan]:
    """List all migration plans for a tenant + project.

    RLS scopes by tenant_id via TenantScopedSession.
    """
    ...

# ❌ Untyped
def list_migration_plans(db, principal, project_id):
    ...
```

### 4.3 — Pydantic v2 patterns

```python
from pydantic import BaseModel, ConfigDict, Field, field_validator

class MigrationPlan(ForgeBaseModel):
    """The typed migration-plan artifact produced by the Refactor Agent."""
    model_config = ConfigDict(extra="forbid")  # Reject unknown fields

    id: UUID = Field(default_factory=uuid4)
    tenant_id: UUID
    project_id: UUID

    # Constraints
    name: str = Field(..., min_length=3, max_length=200)
    order: int = Field(..., ge=0, le=1_000)

    # Enums via Literal (NOT Python Enum — better JSON serialization)
    status: Literal["planned", "in_progress", "completed"] = "planned"

    # Default factories for mutable defaults
    phases: list[MigrationPhase] = Field(default_factory=list)

    # Validators
    @field_validator("status")
    @classmethod
    def _check_status(cls, v: str) -> str:
        if v not in {"planned", "in_progress", "completed"}:
            raise ValueError(f"Unknown status: {v!r}")
        return v
```

**ForgeBaseModel:**

```python
# backend/app/schemas/common.py
from pydantic import BaseModel, ConfigDict

class ForgeBaseModel(BaseModel):
    """Base for all Forge Pydantic models."""
    model_config = ConfigDict(
        extra="forbid",  # Reject unknown fields (R4)
        from_attributes=True,  # Allow ORM mode
        populate_by_name=True,
        str_strip_whitespace=True,
    )
```

### 4.4 — SQLAlchemy 2.0 patterns

```python
# backend/app/db/models/migration_plan.py
from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column
from uuid import UUID

from app.db.base import Base, TenantScopedModel, UUIDPrimaryKeyMixin, TimestampMixin


class MigrationPlan(TenantScopedModel, Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A migration plan for a project."""
    __tablename__ = "migration_plans"

    # Mapped[] is mandatory in 2.0 style
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="draft")

    # FK with proper cascade
    project_id: Mapped[UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
```

**Rules:**
- **Always use `Mapped[T]`** — type-safe column declarations
- **Always use `mapped_column(...)`** — explicit configuration
- **Always use `TenantScopedModel`** for tenant-aware tables
- **Always use `UUIDPrimaryKeyMixin` + `TimestampMixin`** — consistent IDs + audit timestamps
- **FKs specify `ondelete`** — cascade or restrict, never ambiguous

### 4.5 — Async-first

```python
# ✅ Async I/O everywhere
async def list_stories(db: AsyncSession, project_id: UUID) -> list[Story]:
    stmt = select(Story).where(Story.project_id == project_id)
    result = await db.execute(stmt)
    return list(result.scalars())

# ❌ Sync I/O (blocks event loop)
def list_stories(db: Session, project_id: UUID) -> list[Story]:
    return db.query(Story).filter(Story.project_id == project_id).all()
```

### 4.6 — Error handling

```python
# ✅ Typed exceptions with context
class SeedNotFoundError(Exception):
    """Raised when a seed package is absent on disk."""

    def __init__(self, name: str):
        super().__init__(f"Seed package {name!r} not found")
        self.name = name


# ✅ Mapped to HTTP at the boundary
def _seed_error_to_http(exc: SeedRunnerError) -> HTTPException:
    if isinstance(exc, SeedNotFoundError):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, SeedProductionGateError):
        return HTTPException(status_code=403, detail=str(exc))
    return HTTPException(status_code=500, detail="Seed runner failure")

# ❌ Bare exceptions + vague messages
try:
    runner.apply(name)
except Exception as e:
    raise HTTPException(500, "Failed")
```

### 4.7 — Logging (structured)

```python
import structlog

logger = structlog.get_logger(__name__)

# ✅ Structured logs with context
logger.info(
    "seed.apply.completed",
    seed_name=name,
    tenant_id=str(tenant_id),
    rows_affected=sum(row_counts.values()),
    duration_ms=duration,
)

# ❌ String formatting (unstructured)
logger.info(f"Seed {name} applied for tenant {tenant_id}")
```

---

## 5. Import order

```typescript
// 1. React/framework
import * as React from "react";
import { useRouter } from "next/navigation";

// 2. Third-party libraries
import { useQuery } from "@tanstack/react-query";
import { Bot } from "lucide-react";

// 3. Internal — absolute imports (use @/ alias)
import { Button } from "@/components/ui/button";
import { useMigrationPlans } from "@/lib/hooks/useMigrationPlans";

// 4. Relative imports
import { cn } from "../utils";

// 5. Type-only imports (last)
import type { MigrationPlan } from "@/lib/api";
```

```python
# 1. Standard library
from datetime import datetime, timezone
from uuid import UUID, uuid4

# 2. Third-party
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

# 3. Internal — absolute
from app.core.audit import audit
from app.db.models.migration_plan import MigrationPlan

# 4. Type-only
from typing import Literal
```

---

## 6. Comments and docstrings

### 6.1 — Python docstrings (Google style)

```python
async def list_migration_plans(
    db: AsyncSession,
    principal: Principal,
    project_id: UUID,
) -> list[MigrationPlan]:
    """List all migration plans for a tenant + project.

    RLS scopes by tenant_id via TenantScopedSession. Plans are sorted
    newest-first by `created_at`.

    Args:
        db: Async database session (auto-scoped to principal's tenant).
        principal: The authenticated principal (carries tenant_id).
        project_id: Filter to this project.

    Returns:
        List of MigrationPlan instances, newest first.

    Raises:
        HTTPException: 403 if the principal lacks project access.
    """
```

### 6.2 — TypeScript JSDoc (when types aren't enough)

```typescript
/**
 * Compute the effort bucket from estimated hours.
 *
 * Heuristic (per design spec):
 *   < 8h     → 'S'
 *   8-24h    → 'M'
 *   24-72h   → 'L'
 *   > 72h    → 'XL'
 */
export function hoursToEffortBucket(hours: number): RefactorEffort {
  if (hours < 8) return 'S';
  if (hours < 24) return 'M';
  if (hours < 72) return 'L';
  return 'XL';
}
```

### 6.3 — No narrating comments

```python
# ❌ Narrating the obvious
# Loop over each story
for story in stories:
    # Update the status
    story.status = "complete"

# ✅ Explaining the WHY
# Stories stuck in "review" for >7 days are auto-archived to keep
# the kanban scannable. The 7-day threshold is configured in
# settings.stale_story_days (default: 7).
stories_to_archive = [
    s for s in stories
    if s.status == "review" and (now - s.updated_at).days > 7
]
```

---

## 7. Forbidden patterns

### 7.1 — TypeScript

```typescript
// ❌ any (use unknown + narrow)
function process(data: any) { ... }

// ❌ Non-null assertion (!)
const user = users.find(u => u.id === id)!;

// ❌ console.log in production code
console.log("debug:", data);

// ❌ Inline styles for design system tokens
<div style={{ color: '#6366F1' }} />

// ❌ Emoji as UI icons
<span>🚀 Launch</span>

// ❌ Mutation without Idempotency-Key
await fetch("/api/v1/workflows", { method: "POST", body });

// ❌ Direct SDK imports
import OpenAI from "openai";

// ❌ Legacy API transports (P0 consolidation)
import { forgeFetch } from '@/lib/forge-api';  // Use `api` from `lib/api/client.ts`
import { ping } from '@/lib/api';              // Use `api` from `lib/api/client.ts`

// ❌ spinners (use skeletons)
{isLoading && <Spinner />}

// ❌ Mutating domain types
plan.phases.push(newPhase);  // plan is readonly
```

### 7.2 — Python

```python
# ❌ bare except
try:
    runner.apply(name)
except:
    pass

# ❌ print() in production
print("debug:", data)

# ❌ Mutable default args
def process(items=[]):  # shared across calls!
    items.append(...)

# ❌ Direct OpenAI/Anthropic SDK
import openai
client = openai.OpenAI(api_key=...)

# ❌ Hardcoded tenant IDs
.where(Story.tenant_id == UUID("00000000-0000-4000-8000-000000000001"))

# ❌ Cross-tenant queries
.where(Story.id == story_id)  # No tenant filter

# ❌ Missing @audit on mutation
@router.post("/api-keys")
async def create_key(...):  # No audit trail
```

---

## 8. Verification checklist

- [ ] All function signatures have type hints / TypeScript annotations
- [ ] All domain types use `readonly` (TS) and `ForgeBaseModel` (Py)
- [ ] All SQLAlchemy models use `Mapped[T]` 2.0 style
- [ ] All tenant-aware tables extend `TenantScopedModel`
- [ ] All Pydantic models have `extra="forbid"`
- [ ] All mutating routes have `@audit(...)` decorator
- [ ] All frontend POSTs send `Idempotency-Key`
- [ ] No direct SDK imports for LLM providers
- [ ] No `console.log` / `print()` in production code
- [ ] No emoji as UI icons (lucide-react only)
- [ ] No hardcoded tenant IDs
- [ ] No `any` / bare `except`
- [ ] No `bg-black` (use `var(--bg-base)`)
- [ ] All icons have `aria-hidden="true"`
- [ ] All interactive elements have `aria-label` or visible label
- [ ] Lighthouse Accessibility ≥ 90

---

## Related docs

- [Architecture rules](./architecture-rules.md)
- [Design system](./design-system.md)
- [API conventions](./api-conventions.md)
- [Data model](./data-model.md)
- [Testing](./testing.md)
- [Git workflow](./git-workflow.md)
- [LiteLLM integration](./litellm-integration.md)