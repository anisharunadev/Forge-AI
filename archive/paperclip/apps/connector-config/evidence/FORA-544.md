# FORA-544 — Five-step connector resolver + MISS handling

**Sub-task:** FORA-391.3b (decomposed from FORA-485 after productivity review FORA-533).
**Surface:** `apps/connector-config/` (`@fora/connector-config` v0.1.0).
**Acceptance source:** Plan 4 §2 on FORA-391.

This evidence file pins the FORA-544 acceptance criteria to the shipped
resolver + tests. The 5-step resolver + MISS handling already shipped in
FORA-485 commit `c3533cc4`; FORA-544 adds the cache-key contract tests
and the cross-tenant cache-leak guard required by AC #3.

## Acceptance criteria → evidence map

### AC #1 — Resolver implementation passes the 5 priority cases in order

The resolver walks the five steps in `ConnectorConfigResolver.resolve(...)`
in `src/resolver.ts`:

| # | Step                | Code path                                                  | Test                                             |
|---|---------------------|------------------------------------------------------------|--------------------------------------------------|
| 1 | `project_override`  | `resolve()` → `repo.findProjectOverride(...)`              | `resolves via step 1 when a project override is active` |
| 2 | `tenant_default`    | `resolve()` → `repo.findTenantDefault(...)`                | `resolves via step 2 when no project override but a tenant default exists` |
| 3 | `tenant_inherited`  | `resolve()` → `walkInheritance(...)` (depth 1..3)          | `resolves via step 3 by walking parent_tenant_id chain` |
| 4 | `forge_operator_fallback` (Auditor only) | `resolve()` → `actor.role === 'auditor'` gate + `repo.findForgeOperatorFallback(...)` | `resolves via step 4 when actor is Auditor and fallback exists` |
| 5 | `miss`              | `resolve()` → `emitMiss(...)` + `cache.set(key, null)`     | `resolves to MISS and emits connector.binding.missing when no chain matches` |

**Result:** 5/5 steps covered by unit tests in `test/resolver.test.ts`.

### AC #2 — MISS path emits `connector.binding.missing` audit event and raises typed `ConnectorBindingMissing`

* **Event emission** — `ConnectorConfigResolver.emitMiss(...)` calls
  `buildEvent({ event_type: 'connector.binding.missing', ... })`. The
  `event_type` is in the closed set
  `CONNECTOR_BINDING_EVENT_TYPES` in `src/audit.ts`. The metadata
  envelope is `ConnectorBindingMissingMetadata` =
  `{ attempted_auth_method, attempted_steps }`.
* **Typed error** — `ConnectorBindingMissingError` is exported from
  `src/types.ts`. It carries `tenant_id`, `project_id`,
  `connector_id`, `auth_method`, and `miss_event_id`. The resolver
  raises it via `resolveOrThrow(...)` once the MISS audit event has
  been emitted.

**Tests:**
* `resolves to MISS and emits connector.binding.missing when no chain matches`
  — asserts `audit.events[0].event_type === 'connector.binding.missing'`
  and the metadata envelope.
* `resolveOrThrow raises ConnectorBindingMissingError on MISS`.
* `does NOT resolve via step 4 when actor is not Auditor (falls to MISS)`
  — proves a non-Auditor attempt that would resolve via step 4 also
  falls to step 5 and emits `connector.binding.missing`.

### AC #3 — Cache key matches spec; integration test confirms no cross-tenant leak

**Cache key spec** (Plan 4 §2): the cache key is the 4-tuple
`(connector_id, tenant_id, project_id, auth_method)`. The runtime
implementation is `cacheKey(...)` in `src/resolver.ts`:

```ts
`${k.tenant_id}|${k.project_id ?? '<tenant-default>'}|${k.connector_id}|${k.auth_method}`
```

The order is `tenant_id|project_id|connector_id|auth_method`. No
`credential_ref`, no `scopes`, no actor identity. Caching keyed any
other way would leak across tenants.

**Contract tests (new in FORA-544)** in the `cache key contract` block:
* `cacheKey string contains all four fields in the spec order` —
  asserts the literal string format and that all 4 fields appear.
* `cacheKey projects the tenant-default sentinel when project_id is null`
  — pins the `<tenant-default>` sentinel; project UUIDs are v4-shaped
  and never collide with this sentinel.
* `same 4-tuple produces identical key (deterministic)` — resolution
  determinism.
* `different tenant_id produces a different key (cross-tenant guard)` —
  the cross-tenant guard at the cache-key layer.
* `different auth_method produces a different key`.
* `different connector_id produces a different key`.

**Cross-tenant leak guard tests** in the `cross-tenant cache leak guard`
block:
* `does NOT return a tenant A cached binding to a tenant B resolution` —
  warm the cache with tenant A's resolution, then resolve for tenant B
  with the same `(connector_id, project_id, auth_method)`. Tenant B
  must walk to step 5 and MISS; the audit event is stamped with
  `tenant_id === TENANT_B`.
* `a populated cache for one auth_method does not leak to a different auth_method`.
* `invalidatePrefix evicts only entries for the named (tenant_id, connector_id)`.

### AC #4 — Unit tests for each step + at least one negative test that proves no silent fallback

Unit tests for each step — see AC #1 map.

Negative tests that prove no silent cross-tenant fallback:
* `does NOT silently fall back to a binding from a different tenant` —
  tenant B has a binding; tenant A's resolution still MISSes.
* `does not surface a Tenant B binding even when Tenant A has none` —
  resolver respects the tenant boundary even with an empty result.
* `does NOT resolve via step 4 when actor is not Auditor (falls to MISS)`
  — a non-Auditor attempt to use the fallback is logged but does NOT
  fall through silently; it reaches step 5.
* `does NOT return a tenant A cached binding to a tenant B resolution`
  — no cross-tenant cache leak.

## Verification

```
$ pnpm typecheck
$ tsc -p tsconfig.json --noEmit
(clean)

$ pnpm test
$ vitest run
 ✓ test/override.test.ts (17 tests) 13ms
 ✓ test/resolver.test.ts (21 tests) 17ms

 Test Files  2 passed (2)
      Tests  38 passed (38)
   Duration  548ms
```

Test count grew from 29 (FORA-485 ship) to 38 (FORA-544 close): 9 new
tests in `resolver.test.ts` covering AC #3 (cache key contract) and
strengthening AC #4 (cross-tenant cache leak guard).
