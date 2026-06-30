# Feature: <Name>

> **Status:** Stub — fill in as you implement
> **Route:** `apps/forge/app/<path>/page.tsx`
> **Backend:** `backend/app/api/v1/<file>.py`
> **Doc owner:** TBD

---

## Purpose

One paragraph — what this feature does and why it exists. Reference the constitutional rule it satisfies (R1–R8).

## Routes

### Frontend (Next.js)

| Path | Component | Description |
|---|---|---|
| `/<path>` | `apps/forge/app/<path>/page.tsx` | Main page |

### Backend (FastAPI)

| Method | Path | File | Description |
|---|---|---|---|
| `GET` | `/api/v1/<path>` | `backend/app/api/v1/<file>.py` | List |

## Data touched

### Tables

- `<table_name>` — columns: `id`, `tenant_id`, `project_id`, `created_at`, ...

### Pydantic schemas

- `<SchemaName>` — fields: `id: UUID`, `name: str`, ...

### TypeScript types

- `<TypeName>` (`apps/forge/lib/<domain>/types.ts`) — shape mirror of backend schema

## Edge cases

- Empty state — what shows when API returns `[]`
- Loading state — skeleton + shimmer
- Error state — pattern-recognition header + retry CTA
- Tenant switching — refetch keyed on `tenant_id`
- Permission denied — `require_permission(...)` on backend, hide UI affordance on frontend

## Forbidden patterns

AI agents must NOT:

- ❌ Add new routes without updating `docs/reference/api-catalog.md`
- ❌ Hardcode tenant_id / project_id — always carry from auth context
- ❌ Skip `@audit()` decorator on backend mutations
- ❌ Skip `require_permission(...)` on backend routes
- ❌ Use direct SDK imports — every LLM call through LiteLLM proxy
- ❌ Use `bg-black` — use `--bg-base` (#09090B)
- ❌ Use emoji as UI icons — `lucide-react` only
- ❌ Skip the EmptyState component — every list page must have one
- ❌ Use spinners for async loading — use skeleton with shimmer
- ❌ Skip `prefers-reduced-motion` check on animated components

## Verification checklist

- [ ] Frontend route renders without console errors
- [ ] Backend routes return 200 for happy path
- [ ] `seed_*.py` populates demo data
- [ ] `test_*.py` shows N/N passed
- [ ] Tenant scoping verified (cross-tenant access returns 404)
- [ ] Audit log captures every mutation
- [ ] Empty state renders when API returns `[]`
- [ ] Loading state renders during fetch
- [ ] Error state renders on network failure
- [ ] Works at 1280px, 1440px, 1920px without horizontal scroll

## Related docs

- [Coding standards](../standards/coding-standards.md)
- [Design system](../standards/design-system.md)
- [API conventions](../standards/api-conventions.md)
- [Data model](../standards/data-model.md)
- [The 8 rules](../reference/8-rules.md)
- [API catalog](../reference/api-catalog.md)