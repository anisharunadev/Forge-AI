# Phase 2 — Routing & API Hygiene

**Status:** PENDING
**Owner:** TBA
**Depends on:** Phase 1 (tests must run so we can verify)
**Blocks:** Phase 3, Phase 6

---

## Goal

One API transport everywhere. Zero orphan routers. Zero stubs in shipped routers. Documented endpoints either exist or have their docs deleted.

## Why second

- Without a working test runner, refactoring 60+ routers and codemodding API callers would be a guessing game. Phase 1's CI catches regressions.
- The orphan-router footgun (Step-69 memory) means today, adding a new file under `backend/app/api/v1/<bucket>/` silently does nothing. That is the #1 source of "feature shipped but missing in prod" bugs.

## Success Criteria

| ID | Criterion | Verification |
|----|-----------|--------------|
| SC-2.1 | Exactly one frontend API transport is imported in production code | `grep -rn "from ['\"].*lib/api/client\|from ['\"].*forge-api\|from ['\"].*lib/api['\"]" apps/forge/{app,lib,components,hooks}` — only `lib/api/client` matches |
| SC-2.2 | Lint rule blocks new imports from deprecated transports | Add ESLint rule `no-restricted-imports`; CI runs ESLint |
| SC-2.3 | `forgeFetch` and `lib/api.ts` files deleted; re-exports removed | `find apps/forge -name 'forge-api.ts' -o -name 'api.ts' \| grep -v node_modules` returns empty (or only the canonical client) |
| SC-2.4 | Every file under `backend/app/api/v1/<bucket>/` is registered in both `<bucket>/__init__.py` AND `router.py` | `scripts/check-orphan-routers.sh` exits 0 |
| SC-2.5 | `scripts/check-orphan-routers.sh` runs in CI | CI workflow includes it; PR without registration fails |
| SC-2.6 | `forge_phase4.py` either graduates to a real router or is deleted | `grep -rn "forge_phase4" backend/ apps/forge/` shows real usage OR the file is gone |
| SC-2.7 | Documented-but-missing endpoints (`/ideation/sources`, `/destinations`, `/market-signals`, `/voice-clusters`, `/ingest/status`) are either implemented with tests or removed from docs | diff between `docs/litellm/forge-litellm-integration.md` and registered routers shows zero orphans |
| SC-2.8 | WebSocket auth uses `api.ws()` everywhere — no manual `new WebSocket('wss://...?token=')` constructions | grep returns zero matches outside `lib/api/client.ts` |
| SC-2.9 | `phase-2-coverage-baseline.md` records router test coverage ≥ 80% on touched routers | file committed |

## Tasks

### T2.1 — Pick the canonical transport
- T2.1.1 Decision record: `lib/api/client.ts` wins (JWT + tenant header injection + 401 refresh + WS helper).
- T2.1.2 List every importer of `forgeFetch` and `lib/api.ts`:
  `grep -rn "forgeFetch\|from ['\"].*lib/api['\"]" apps/forge/{app,lib,components,hooks} --include='*.ts' --include='*.tsx' > /tmp/deprecated-imports.txt`
- T2.1.3 Estimate blast radius (count of files).

### T2.2 — Codemod all callers to `api`
- T2.2.1 Write a `ts-morph` script (or manual sed per import shape) to swap `forgeFetch(` → `api(` and `from '.../lib/api'` → `from '.../lib/api/client'`.
- T2.2.2 Run the codemod.
- T2.2.3 Fix type errors that surface.
- T2.2.4 Run `pnpm test` — must stay green.

### T2.3 — Delete deprecated transports
- T2.3.1 Remove `apps/forge/lib/forge-api.ts`.
- T2.3.2 Remove `apps/forge/lib/api.ts`.
- T2.3.3 Remove any barrel re-exports.
- T2.3.4 Run `pnpm build` to confirm no broken imports.

### T2.4 — ESLint rule to prevent regression
- T2.4.1 Add to `apps/forge/.eslintrc.json`:
  ```json
  "no-restricted-imports": ["error", {
    "patterns": [
      { "group": ["**/forge-api", "**/lib/api"], "message": "Use lib/api/client (api) instead." }
    ]
  }]
  ```
- T2.4.2 Confirm a test file attempting a deprecated import fails lint.
- T2.4.3 Add `pnpm lint` to CI.

### T2.5 — Orphan router guard
- T2.5.1 Create `scripts/check-orphan-routers.sh`:
  ```bash
  #!/usr/bin/env bash
  # For each router file under backend/app/api/v1/<bucket>/, require registration in
  # <bucket>/__init__.py AND <bucket>/router.py.
  set -euo pipefail
  buckets=($(ls backend/app/api/v1/ | grep -v __init__))
  for bucket in "${buckets[@]}"; do
    init="backend/app/api/v1/${bucket}/__init__.py"
    router="backend/app/api/v1/${bucket}/router.py"
    [ -f "$init" ] || [ -f "$router" ] || continue  # not a sub-bucket
    for f in backend/app/api/v1/${bucket}/*.py; do
      [ "$(basename $f)" = "__init__.py" ] && continue
      [ "$(basename $f)" = "router.py" ] && continue
      name=$(basename "$f" .py)
      in_init=$(grep -c "\b${name}\b" "$init" 2>/dev/null || echo 0)
      in_router=$(grep -c "\b${name}\b" "$router" 2>/dev/null || echo 0)
      if [ "$in_init" -eq 0 ] || [ "$in_router" -eq 0 ]; then
        echo "❌ Orphan router: $f (missing in __init__ or router.py)"
        exit 1
      fi
    done
  done
  echo "✅ All routers registered."
  ```
- T2.5.2 Make executable.
- T2.5.3 Wire into CI.

### T2.6 — Decide each missing endpoint (ship or delete)
For each documented-but-missing endpoint:
- `/ideation/sources`, `/ideation/destinations`, `/ideation/market-signals`, `/ideation/voice-clusters`, `/ideation/ingest/status`
- T2.6.1 Find existing puller services in `backend/app/services/ideation/`.
- T2.6.2 If puller service exists and is functional → wire to router + add tests + add to `__init__` + `router.py`.
- T2.6.3 If puller service is dead code → delete both service and doc references.
- T2.6.4 Each new router file gets ≥ 3 tests (happy path, auth, tenant isolation).

### T2.7 — Eliminate `forge_phase4.py`
- T2.7.1 Open `backend/app/api/v1/forge_phase4.py`. If it has real endpoints → T2.7.2. If stub → T2.7.3.
- T2.7.2 Graduate it: ensure registration in `router.py`, add tests, document in `docs/reference/api-catalog.md`.
- T2.7.3 Delete the file, remove any imports.

### T2.8 — WebSocket auth enforcement
- T2.8.1 grep audit: `grep -rn "new WebSocket" apps/forge --include='*.ts' --include='*.tsx' | grep -v node_modules`.
- T2.8.2 Replace each hit with `api.ws(path)` + message handlers.
- T2.8.3 Add a test that asserts the WS helper is used (mock the helper, assert call).

### T2.9 — Coverage baseline
- T2.9.1 Run `pnpm test --coverage --coverage.include='apps/forge/lib/api/**'`.
- T2.9.2 Record in `docs/plan/phase-2-coverage-baseline.md`.

## Files Touched

| File | Action |
|------|--------|
| `apps/forge/lib/api/client.ts` | edit (final tweaks) |
| `apps/forge/lib/forge-api.ts` | delete |
| `apps/forge/lib/api.ts` | delete |
| `apps/forge/lib/api/**` callers | codemod |
| `apps/forge/.eslintrc.json` | edit (no-restricted-imports) |
| `backend/app/api/v1/ideation/*.py` (5 files) | create or delete |
| `backend/app/api/v1/ideation/__init__.py` | edit (registrations) |
| `backend/app/api/v1/ideation/router.py` | edit (registrations) |
| `backend/app/api/v1/forge_phase4.py` | graduate or delete |
| `apps/forge/{app,components}/**` WS call sites | edit |
| `scripts/check-orphan-routers.sh` | create |
| `docs/litellm/forge-litellm-integration.md` | edit (sync to reality) |
| `docs/plan/phase-2-coverage-baseline.md` | create |

## Risks

| Risk | Mitigation |
|------|-----------|
| Codemod breaks subtle auth/refresh behavior | Codemod mechanically; manual review of every TypeScript error; tests catch regressions |
| Removing a transport breaks a code path we missed | `pnpm build` is the safety net; iterate until clean |
| Orphan router guard false-positives on edge-case layouts (e.g. flat directory) | Script logs the bucket + file path so devs can refine or whitelist |
| Deleting an endpoint that a customer uses | Search docs + call sites first; treat each as a deprecation cycle if real usage exists |

## Out of Scope

- New API surface (only fixing the existing mess).
- Backend test infrastructure (separate from Phase 1 frontend fix).
- OpenAPI schema regeneration (deferred to Phase 3 docs-as-code).

## Definition of Done

- One transport imported everywhere; lint prevents new uses.
- All SC-2.* criteria pass.
- `forge_phase4.py` gone or real.
- 5 missing ideation endpoints: all decided.
- Coverage baseline recorded.
- CI green.