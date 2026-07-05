# Phase 2 — Routing & API Hygiene (Implementation Plan)

**Status:** PLANNED (awaiting implementation start)
**Owner:** TBA
**Depends on:** Phase 1 green (tests run, CI green, single glob)
**Blocks:** Phase 3, Phase 6

---

## 0. Pre-Phase State Verification

All findings below are from the working tree on `2026-07-05`. Every claim cites file:line.

### 0.1 Three API transports coexist in `apps/forge/lib/`

| Transport | File | Lines | Surface |
|---|---|---|---|
| `api` (canonical) | `apps/forge/lib/api/client.ts` | 285 lines | `api.get/post/put/delete/ws()`, `ApiError`, 401→refresh→retry, `bindAuthAccessor` |
| `forgeFetch` (legacy) | `apps/forge/lib/forge-api.ts` | 99 lines | `forgeFetch<T>()`, `ForgeApiError`, env-driven base URL, no auth, no refresh |
| `lib/api` (legacy) | `apps/forge/lib/api.ts` | 467 lines | `OrchestratorError`, `runLifecycle`, `listValidationReports`, `getRunsView`, `seedAliasFor`, `indexStages`, types — runs against a stub orchestrator on `:4000` |

Verified by `ls apps/forge/lib/` and `grep -n "^export" lib/api.ts lib/api/client.ts lib/forge-api.ts`.

### 0.2 Importers of `forgeFetch`

17 unique files contain live `forgeFetch(` call sites or `import { forgeFetch }` statements. Concentrations:

| File | Approx call sites | Top symbols |
|---|---|---|
| `apps/forge/lib/settings/data.ts` | 39 | every settings CRUD endpoint |
| `apps/forge/lib/litellm/data.ts` | 15 | LiteLLM admin / virtual keys / MCP / spend / guardrails |
| `apps/forge/lib/api/copilot.ts` | 9 | copilot conversations, streaming |
| `apps/forge/lib/seeds/data.ts` | 9 | seed manifests, runs |
| `apps/forge/lib/lessons/data.ts` | 5 | lesson candidates, decisions, digest |
| `apps/forge/lib/hooks/useLiteLLM.ts` | 8 | TanStack Query hooks for spend/policies/models/audit |
| `apps/forge/hooks/use-command-artifact.ts` | 3 | command artifact fetch + poll |
| `apps/forge/hooks/use-command-history.ts` | 2 | command run history |
| `apps/forge/hooks/use-forge-commands.ts` | 2 | command dispatch |
| `apps/forge/components/admin/llm-gateway/DriftTable.tsx` | 2 | drift rows |
| `apps/forge/components/admin/llm-gateway/ReconcileButton.tsx` | 2 | reconcile action |
| `apps/forge/components/runs/RunBudgetBadgeTenantDefault.tsx` | 2 | run budget badge |
| `apps/forge/tests/copilot/api.test.ts` | 4 | `vi.mock` + `vi.mocked` |

**Total live call sites: ~95 across 13 production files + 2 test files.** Comments-only mentions exist in JSDoc / inline comments in several other files — rewrite prose during codemod.

### 0.3 Importers of `lib/api` (legacy 467-line file)

18 unique files import from `@/lib/api`. All imports are type aliases or function imports for the runs/validator/refactor orchestrator surface — `getRunsView`, `getRunStages`, `seedAliasFor`, `runLifecycle`, `OrchestratorError`, plus types `RefactorRisk`, `RefactorPhase`, `MigrationPlan`, `RefactorEffort`, `RefactorPhaseStatus`, `ValidationSeverity`, `ValidationFinding`, `ValidationReport`, `ValidationStatus`, `RunsView`, `StageRecord`, `RunRecord`, `CreateRunInput`, `WorkflowRun`.

**Critical:** `lib/api.ts:18` re-exports `FORGE_WS_BASE_URL` from `./forge-api`, and `:19` re-exports `RunRecord`/`StageRecord` types — these must move to `lib/api/client.ts` before `lib/api.ts` is deleted.

### 0.4 Backend ideation router pattern (real, not the CLAUDE.md claim)

**The "dual registration in `__init__.py` AND `router.py`" rule from `backend/CLAUDE.md:99` does not match reality.** Verified:

- `backend/app/api/v1/ideation/router.py` **does not exist** (`ls` returns ENOENT).
- `backend/app/api/v1/ideation/__init__.py` (45 lines) imports 16 sub-modules and re-exports them in `__all__`. It does NOT aggregate any routers.
- Actual aggregation is in `backend/app/api/v1/router.py:180-198` and `:200-209` — each sub-module's `router` is included directly:
  ```python
  api_router.include_router(ideation.ideas.router)        # :180
  ...
  api_router.include_router(ideation.sources.router)       # :195
  api_router.include_router(ideation.market_signals.router) # :196
  api_router.include_router(ideation.customer_voice.router) # :197
  api_router.include_router(ideation.destinations.router)   # :198
  ```
- Same pattern for `architecture/` (10 sub-modules at `:200-209`); `architecture/__init__.py` re-exports but `architecture/router.py` does not exist.
- `connectors/` is flat (no sub-bucket) — `backend/app/api/v1/connectors.py` plus `connector_*.py` siblings.
- `forge_phase4/` is a real sub-package with its own `__init__.py` aggregator (`router = APIRouter(...)` at line 47) plus a `forge_phase4.router` include at `v1/router.py:209`.

**Real orphan-router rule:** a `.py` file under any `api/v1/<bucket>/` directory must appear (a) imported in `<bucket>/__init__.py` AND (b) `include_router`'d in `v1/router.py`. Missing either is silent. Verified against all current ideation files — **all 16 are registered in both places**.

### 0.5 Missing ideation endpoints — most are NOT missing

| Endpoint | Router file | `__init__.py` registered | `v1/router.py` registered |
|---|---|---|---|
| `/ideation/sources` | `backend/app/api/v1/ideation/sources.py` (11.3K) | yes (line 23) | yes (`:195`) |
| `/ideation/destinations` | `backend/app/api/v1/ideation/destinations.py` (4.0K) | yes (line 12) | yes (`:198`) |
| `/ideation/market-signals` | `backend/app/api/v1/ideation/market_signals.py` (7.4K) | yes (line 17) | yes (`:196`) |
| `/ideation/voice-clusters` | `backend/app/api/v1/ideation/customer_voice.py` (6.8K) — module name differs from URL | yes (line 11) | yes (`:197`) |
| `/ideation/ingest/status` | **NOT implemented** | n/a | n/a |

`grep -rn "ingest/status\|ingest_status" backend/app` returns 0 hits. The `IngestIndicator` component is pure UI (Badge with status prop); no fetch hook exists. Doc reference: `docs/agent/features/ideation-center.md:399`, `docs/features/ideation-center.md:399`, `docs/goals/step-68.md:732-748`, `step-69.md:732`.

**Conclusion:** 4 of 5 endpoints are already wired. Only `/ideation/ingest/status` is genuinely missing and not called by any frontend code — must be either **implemented** (preferred, docs commit to it) or **deleted from docs** (acceptable fallback).

### 0.6 `forge_phase4.py` — does not exist; `forge_phase4/` package is real

`find backend/app/api/v1 -name 'forge_phase4.py'` returns empty. The actual artefact is `backend/app/api/v1/forge_phase4/__init__.py:1-89`, aggregating 7 sub-routers: `cache`, `identity`, `media`, `ops`, `passthrough`, `providers`, `sessions`. Each is a real router with `@router.{get,post,delete}` decorators (74 matches total via `grep`). No `TODO`, `FIXME`, `NotImplementedError`, or empty `pass` bodies. Mounted via `v1/router.py:209`.

The historical `forge_phase4.py` was refactored into a package during step-80. The original Phase 2 outline referenced a stale file.

### 0.7 WebSocket audit — only 3 live `new WebSocket(` call sites

| File | Purpose | Action |
|---|---|---|
| `apps/forge/lib/api/client.ts:272` | `api.ws()` helper itself | KEEP |
| `apps/forge/lib/websocket.ts:54` | `openForgeWebSocket()` legacy helper | DELETE after callers migrate |
| `apps/forge/hooks/use-sidecar-probe.ts:69` | Reachability probe to local PTY sidecar on `:4001` | KEEP with `// ponytail:` comment — sidecar is un-authed by design |

### 0.8 Orphan-router guard — does not exist yet

`scripts/check-orphan-routers.sh` does not exist. Template for the new guard: `scripts/check-test-location.sh` (Phase 1).

### 0.9 ESLint config — minimal, no `no-restricted-imports`

`apps/forge/.eslintrc.json` (35 lines) extends `next/core-web-vitals`, has `no-restricted-syntax` for hex/HSL literals only, no `no-restricted-imports`. No flat `eslint.config.js` / `.mjs` exists.

### 0.10 Test coverage state

Backend: `backend/tests/api/v1/test_ideation.py` (9.2K) already exercises the ideation routers — all 16 sub-modules reachable from one `TestClient`. Frontend: `apps/forge/tests/copilot/api.test.ts` mocks `forgeFetch` directly; `tests/terminal-ws.test.ts:103, :123` are `it.skip` and need un-skipping. No tests for `lib/settings/data.ts`, `lib/litellm/data.ts`, `lib/lessons/data.ts`, `lib/api/copilot.ts` at the file level.

### 0.11 Phase 1 givens (assumed green at start)

- `pnpm test` exits 0 (SC-1.1)
- All tests under `apps/forge/tests/**` only (SC-1.3, SC-1.4)
- `.github/workflows/test.yml` runs `pnpm test --coverage` + `bash scripts/check-test-location.sh` (SC-1.5, SC-1.6)
- `docs/plan/phase-1-coverage-baseline.md` records the floor (SC-1.7)

---

## 1. Goal

One canonical frontend API transport (`api` from `lib/api/client.ts`); zero orphan routers; zero stubs in shipped routers; every documented ideation endpoint exists with tests, or its doc reference is deleted.

## 2. Success Criteria

| ID | Criterion | Verification command (must pass) |
|---|---|---|
| SC-2.1 | No production import of `forgeFetch` or `@/lib/forge-api` | `grep -rn "from ['\"]@/lib/forge-api" apps/forge/{app,lib,components,hooks} --include='*.ts' --include='*.tsx'` returns empty |
| SC-2.2 | No production import of `@/lib/api` (the legacy barrel) | `grep -rn "from ['\"]@/lib/api['\"]" apps/forge/{app,lib,components,hooks} --include='*.ts' --include='*.tsx'` returns empty |
| SC-2.3 | Deprecated transport files deleted | `find apps/forge/lib -maxdepth 2 \( -name 'forge-api.ts' -o -name 'api.ts' \) -not -path 'apps/forge/lib/api/*'` returns empty |
| SC-2.4 | Lint prevents new imports of deprecated transports | `pnpm lint` exits non-zero on a file with `import { forgeFetch } from '@/lib/forge-api'` |
| SC-2.5 | Orphan-router guard exits 0 on clean tree | `bash scripts/check-orphan-routers.sh` exits 0; exits 1 on orphan |
| SC-2.6 | CI runs both guards | `.github/workflows/test.yml` includes both; PR without them fails |
| SC-2.7 | `/ideation/ingest/status` exists with tests, OR is removed from docs | `grep -rn "ingest/status" backend/app apps/forge docs` shows only `backend/app` hits (if implemented) or zero hits (if docs deleted) |
| SC-2.8 | `forge_phase4/` package has test coverage ≥ 80% lines | `cd backend && pytest tests/api/v1/ --cov=app/api/v1/forge_phase4 --cov-report=term-missing` reports ≥ 80% |
| SC-2.9 | No production `new WebSocket(` outside `lib/api/client.ts` and the sidecar probe | `grep -rn "new WebSocket(" apps/forge/{app,lib,components,hooks} --include='*.ts' --include='*.tsx' \| grep -v 'lib/api/client.ts' \| grep -v 'use-sidecar-probe.ts'` returns empty |
| SC-2.10 | Phase-2 coverage baseline recorded | `docs/plan/phase-2-coverage-baseline.md` exists with numbers ≥ Phase 1 baseline |
| SC-2.11 | All Phase 1 SCs still pass | `pnpm test` exits 0; `bash scripts/check-test-location.sh` exits 0 |

---

## 3. Sub-Phases / PR Breakdown

8 PRs, ordered so each leaves the tree green and the lints stricter than before. **Strategy: PRs 2.1 → 2.2 → 2.3 → 2.4 ship as a stacked branch with three commits so the `no-restricted-imports` rule lands green in CI from commit one.**

### PR-2.1 — ESLint guardrails for deprecated transports

Land with the rule at `"error"`. Since the tree currently has 17+18 importers, this PR **must merge as the first commit of a stacked branch** with PR-2.2 and PR-2.3 immediately following. Each commit independently passes lint.

### PR-2.2 — Codemod `forgeFetch` → `api`

Mechanical replacement. ~95 call sites across 13 prod files + 2 test files.

### PR-2.3 — Codemod `@/lib/api` → submodule imports

Split `lib/api.ts` into `lib/api/runs.ts`, `lib/api/validator.ts`, `lib/api/refactor.ts`. Update 18 importers. Keep `lib/api.ts` as a re-export shim until PR-2.4.

### PR-2.4 — Delete deprecated transport files

Delete `lib/forge-api.ts` and `lib/api.ts`. Absorb `FORGE_API_BASE_URL` / `FORGE_WS_BASE_URL` / `ForgeApiError` into `lib/api/client.ts` first.

### PR-2.5 — Orphan-router CI guard

New `scripts/check-orphan-routers.sh` matching the **real** pattern (§0.4): sub-bucket modules must be imported in `<bucket>/__init__.py` AND `include_router`'d in `v1/router.py`. Wire into CI.

### PR-2.6 — Decide missing ideation endpoints

Implement `/ideation/ingest/status` (preferred). Register. Add tests. Fallback: delete from docs.

### PR-2.7 — `forge_phase4/` test coverage graduation

Ensure each of the 7 sub-routers has ≥ 80% line coverage. New `backend/tests/api/v1/test_forge_phase4.py`.

### PR-2.8 — WebSocket auth enforcement

Migrate `openForgeWebSocket` callers to `api.ws(path)`. Delete `lib/websocket.ts`. Un-skip `tests/terminal-ws.test.ts:103, :123`. Add `// ponytail:` comment to `use-sidecar-probe.ts:69`.

---

## 4. Per-Task Detail

### PR-2.1 — ESLint guardrails for deprecated transports

**Pre-conditions:** Phase 1 green.

**Files edited:**
- `apps/forge/.eslintrc.json` — add `no-restricted-imports` rule.
- `.github/workflows/test.yml` — add `pnpm lint` step.

**Exact `.eslintrc.json` patch** (insert inside `rules` block, before `no-restricted-syntax`):

```json
    "no-restricted-imports": [
      "error",
      {
        "paths": [
          {
            "name": "@/lib/forge-api",
            "message": "Use `import { api } from '@/lib/api/client'` instead. forge-api is deprecated; the canonical client handles auth, tenant headers, and 401 refresh."
          },
          {
            "name": "@/lib/api",
            "message": "Use specific submodule under `@/lib/api/*` (e.g. `@/lib/api/client`, `@/lib/api/runs`). The legacy `lib/api.ts` barrel is deprecated."
          }
        ],
        "patterns": [
          {
            "group": ["**/lib/forge-api", "**/lib/forge-api.ts"],
            "message": "Use `@/lib/api/client` instead. The forge-api legacy transport is deprecated."
          }
        ]
      }
    ],
```

**Exact CI step** (add to `.github/workflows/test.yml` after the `pnpm test` step):

```yaml
      - name: Lint
        run: pnpm --filter forge-dashboard lint
```

**Verification commands:**

```bash
cd /home/arunachalam.v@knackforge.com/forge-ai/apps/forge && pnpm lint

# Probe: confirm the rule fires on a banned import.
echo "import { forgeFetch } from '@/lib/forge-api';" > /tmp/probe.ts
cp /tmp/probe.ts apps/forge/tests/_probe.test.ts
pnpm lint 2>&1 | grep -q "no-restricted-imports" || echo "FAIL: lint did not flag banned import"
rm apps/forge/tests/_probe.test.ts
```

**Branch strategy:** single branch `phase-2/eslint-and-codemod` with three commits — `2.1 (rule, error) → 2.2 (codemod forgeFetch) → 2.3 (codemod lib/api) → 2.4 (delete files)`. Each commit independently green. Merge as one PR or four stacked PRs (`gh pr create` chained).

---

### PR-2.2 — Codemod `forgeFetch` → `api`

**Pre-conditions:** PR-2.1 merged.

**Mapping rules** (per call site — verify by reading `apps/forge/lib/forge-api.ts:57-98` and `apps/forge/lib/api/client.ts:245`):

```ts
forgeFetch<T>(path)                                  → api.get<T>(path)
forgeFetch<T>(path, { method: 'POST', body })        → api.post<T>(path, body)
forgeFetch<T>(path, { method: 'PUT', body })         → api.put<T>(path, body)
forgeFetch<T>(path, { method: 'DELETE' })            → api.delete<T>(path)
forgeFetch<T>(path, { tenantId })                    → api.get<T>(path)  // tenant from auth
catch (err) { if (err instanceof ForgeApiError) ...} → catch (err) { if (err instanceof ApiError) ... }
```

For streaming calls, verify the canonical client's stream-mode semantics (likely `api.post(path, body, { _stream: true })`) and adapt.

**Bulk step 1 — replace imports and error class:**

```bash
cd /home/arunachalam.v@knackforge.com/forge-ai/apps/forge

for f in $(grep -rl "from '@/lib/forge-api'" app lib components hooks 2>/dev/null); do
  sed -i "s|from '@/lib/forge-api'|from '@/lib/api/client'|g" "$f"
done

for f in $(grep -rl "ForgeApiError" app lib components hooks 2>/dev/null); do
  sed -i 's/\bForgeApiError\b/ApiError/g' "$f"
done
```

**Bulk step 2 — rewrite `forgeFetch(` to `api.{verb}(`** based on the `method` option per file. Use `rg -n "forgeFetch" apps/forge/{app,lib,components,hooks}` to enumerate. Per-file edits — patterns are uniform enough to use `sed` with a follow-up manual review for the `method` parameter.

**Files to edit (all absolute under `/home/arunachalam.v@knackforge.com/forge-ai/`):**

- `apps/forge/lib/settings/data.ts` (39 call sites)
- `apps/forge/lib/litellm/data.ts` (15)
- `apps/forge/lib/api/copilot.ts` (9)
- `apps/forge/lib/seeds/data.ts` (9)
- `apps/forge/lib/lessons/data.ts` (5)
- `apps/forge/lib/hooks/useLiteLLM.ts` (8)
- `apps/forge/hooks/use-command-artifact.ts` (3)
- `apps/forge/hooks/use-command-history.ts` (2)
- `apps/forge/hooks/use-forge-commands.ts` (2)
- `apps/forge/components/admin/llm-gateway/DriftTable.tsx` (2)
- `apps/forge/components/admin/llm-gateway/ReconcileButton.tsx` (2)
- `apps/forge/components/runs/RunBudgetBadgeTenantDefault.tsx` (2)
- `apps/forge/tests/copilot/api.test.ts` (4 — `vi.mock` + import + `vi.mocked`)

**Test file changes:**

- `apps/forge/tests/copilot/api.test.ts:30-44` — change `vi.mock('@/lib/forge-api', () => ({ forgeFetch: vi.fn() }))` to mock the canonical client.
- `apps/forge/tests/lib/seeds/data.test.ts:312` — comment-only reference; rewrite prose to say `api.post`.

**Per-file verification (after each edit):**

```bash
pnpm typecheck
pnpm test --run apps/forge/tests/lib/seeds/data.test.ts
```

**Final verification:**

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm build
grep -rn "forgeFetch\|ForgeApiError" apps/forge/{app,lib,components,hooks} --include='*.ts' --include='*.tsx' | wc -l   # 0
```

---

### PR-2.3 — Codemod `@/lib/api` → submodule imports

**Pre-conditions:** PR-2.2 merged.

**Step 0 — investigate whether the legacy functions are stubs.** Before any edit:

```bash
cd /home/arunachalam.v@knackforge.com/forge-ai
grep -rn "getRunsView\|runLifecycle\|listValidationReports\|indexStages\|seedAliasFor" backend/app
```

If **0 hits** → the functions in `lib/api.ts` are unimplemented stubs pointing at a `:4000` orchestrator that doesn't exist. Ponytail: **delete them along with `lib/api.ts`** and remove calling pages. Don't port dead code.

If hits exist → the functions have a real backend → port them to use `api.get/post`.

**Step 1 — create per-domain files** (if keeping the functions):

- `apps/forge/lib/api/runs.ts` — `OrchestratorError`, `runLifecycle`, `getRun`, `getRunStages`, `listRuns`, `getRunsView`, `createRun`, `indexStages`, `seedAliasFor`, types.
- `apps/forge/lib/api/validator.ts` — `listValidationReports`, `getValidationReport`, types.
- `apps/forge/lib/api/refactor.ts` — types only.

Each file uses `api` from `./client` for actual HTTP calls. Re-implement functions against real backend paths; if a path doesn't exist, **delete the function**.

**Step 2 — update the 18 importers** with `sed` per file based on which symbols are used. Multi-symbol imports require manual review.

**Step 3 — keep `lib/api.ts` as a re-export shim** until PR-2.4:

```ts
// ponytail: re-export shim — removed in PR-2.4 once all callers migrate.
export { OrchestratorError } from './api/runs';
export { getRunsView, runLifecycle, getRun, getRunStages, listRuns, createRun, indexStages, seedAliasFor } from './api/runs';
export { listValidationReports, getValidationReport } from './api/validator';
export type { RunsView, RunRecord, StageRecord, CreateRunInput, WorkflowRun, WorkflowRunsView } from './api/runs';
export type { ValidationSeverity, ValidationStatus, ValidationReport, ValidationFinding, ValidationSummary, ValidationFindingLocation } from './api/validator';
export type { RefactorEffort, RefactorPhaseStatus, RefactorRisk, RefactorPhase, MigrationPlan } from './api/refactor';
export { FORGE_WS_BASE_URL } from './api/client';
```

**Verification:** same as PR-2.2.

---

### PR-2.4 — Delete deprecated transport files

**Pre-conditions:** PRs 2.2 and 2.3 merged.

**Step 1 — absorb env constants and `ForgeApiError` into the canonical client.** If `lib/api/client.ts:276` re-exports `FORGE_API_BASE_URL`, `FORGE_WS_BASE_URL`, `ForgeApiError` from `@/lib/forge-api`, move them into `lib/api/client.ts` directly (or into `lib/api/env.ts`).

**Step 2 — delete:**

```bash
cd /home/arunachalam.v@knackforge.com/forge-ai
rm apps/forge/lib/forge-api.ts
rm apps/forge/lib/api.ts
pnpm install
pnpm --filter forge-dashboard typecheck
pnpm --filter forge-dashboard test
pnpm --filter forge-dashboard build
pnpm --filter forge-dashboard lint
```

**Verification:**

```bash
find apps/forge/lib -maxdepth 2 \( -name 'forge-api.ts' -o -name 'api.ts' \) -not -path 'apps/forge/lib/api/*' | wc -l   # 0
grep -rn "from ['\"]@/lib/forge-api\|from ['\"]@/lib/api['\"]" apps/forge/{app,lib,components,hooks} --include='*.ts' --include='*.tsx' | wc -l   # 0
```

---

### PR-2.5 — Orphan-router CI guard

**Pre-conditions:** none.

**Create `scripts/check-orphan-routers.sh`:**

```bash
#!/usr/bin/env bash
# scripts/check-orphan-routers.sh
#
# Enforces the orphan-router contract documented in
# backend/CLAUDE.md (Ideation router quirks / Step-69) and verified
# for ideation/architecture sub-buckets in Phase 2 §0.4:
#
#   A .py file under backend/app/api/v1/<bucket>/ MUST be imported
#   in <bucket>/__init__.py AND included via api_router.include_router
#   in backend/app/api/v1/router.py. Missing either registration is a
#   silent failure (the route is unreachable from /docs and from
#   clients). The guard fails (exit 1) on any orphan.
#
# forge_phase4 is special — its __init__.py IS the aggregator (one
# include_router per sub-module inside the same file).
#
# Wired into .github/workflows/test.yml. Run locally:
#   bash scripts/check-orphan-routers.sh

set -euo pipefail

V1="backend/app/api/v1"
TOP_ROUTER="$V1/router.py"
if [[ ! -f "$TOP_ROUTER" ]]; then
  echo "::error::$TOP_ROUTER missing — backend layout changed?"
  exit 1
fi

orphans=()

# Sub-bucket dirs that have their own __init__.py.
for bucket in "$V1"/*/; do
  bucket_name="$(basename "$bucket")"
  init="$bucket/__init__.py"
  [[ -f "$init" ]] || continue

  # forge_phase4: aggregator __init__ — each sub-module imported AND
  # include_router'd in the same __init__.py.
  if [[ "$bucket_name" == "forge_phase4" ]]; then
    for f in "$bucket"*.py; do
      [[ "$(basename "$f")" == "__init__.py" ]] && continue
      mod="$(basename "$f" .py)"
      if ! grep -qE "(^|[^A-Za-z0-9_])${mod}([^A-Za-z0-9_]|$)" "$init"; then
        orphans+=("$f (not imported in forge_phase4/__init__.py)")
        continue
      fi
      if ! grep -qE "include_router\(.*${mod}.*router" "$init"; then
        orphans+=("$f (router not include_router'd in forge_phase4/__init__.py)")
      fi
    done
    continue
  fi

  # Flat-aggregator sub-buckets (ideation/, architecture/): each
  # sub-module imported in __init__.py AND include_router'd in v1/router.py.
  for f in "$bucket"*.py; do
    [[ "$(basename "$f")" == "__init__.py" ]] && continue
    mod="$(basename "$f" .py)"
    if ! grep -qE "(^|[^A-Za-z0-9_])${mod}([^A-Za-z0-9_]|$)" "$init"; then
      orphans+=("$f (not imported in $bucket_name/__init__.py)")
      continue
    fi
    if ! grep -qE "include_router\(.*${mod}.*router" "$TOP_ROUTER"; then
      orphans+=("$f (router not include_router'd in $TOP_ROUTER)")
    fi
  done
done

if (( ${#orphans[@]} > 0 )); then
  echo "::error::Orphan router file(s) found:"
  for o in "${orphans[@]}"; do
    echo "  - $o"
  done
  echo "::error::Fix: import the module in <bucket>/__init__.py and include its router in v1/router.py."
  exit 1
fi

echo "✅ All router files under backend/app/api/v1/<bucket>/ are registered."
```

```bash
chmod +x /home/arunachalam.v@knackforge.com/forge-ai/scripts/check-orphan-routers.sh
```

**Wire into CI** (add to `.github/workflows/test.yml` after `pnpm test`, before `Lint`):

```yaml
      - name: Orphan-router guard
        run: bash scripts/check-orphan-routers.sh
```

**Verification:**

```bash
# Positive path
bash /home/arunachalam.v@knackforge.com/forge-ai/scripts/check-orphan-routers.sh

# Negative path
touch /home/arunachalam.v@knackforge.com/forge-ai/backend/app/api/v1/ideation/_orphan_probe.py
bash scripts/check-orphan-routers.sh; echo "exit=$?"
rm /home/arunachalam.v@knackforge.com/forge-ai/backend/app/api/v1/ideation/_orphan_probe.py
```

---

### PR-2.6 — Decide missing ideation endpoints

**Pre-conditions:** none.

**Disposition matrix:**

| Endpoint | Status | Action |
|---|---|---|
| `/ideation/sources` | EXISTS | add 1 backend test (extend `test_ideation.py`) |
| `/ideation/destinations` | EXISTS | add 1 backend test |
| `/ideation/market-signals` | EXISTS | add 1 backend test |
| `/ideation/voice-clusters` | EXISTS as `customer_voice.py` | verify URL mapping matches doc; add 1 backend test |
| `/ideation/ingest/status` | **MISSING** | implement (preferred) or delete docs |

**Implement `/ideation/ingest/status`:** create `backend/app/api/v1/ideation/ingest_status.py`:

```python
"""GET /ideation/ingest/status — daily ingest heartbeat for the Ideation page header badge."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.api.deps import require_permission
from app.core.security import AuthenticatedPrincipal

router = APIRouter(prefix="/ingest", tags=["ideation-ingest"])

IngestStatus = Literal["success", "running", "failed", "partial", "never"]


class IngestStatusRead(BaseModel):
    status: IngestStatus
    ideas_created_today: int
    last_run_at: datetime | None


@router.get("/status", response_model=IngestStatusRead)
async def get_ingest_status(
    principal: AuthenticatedPrincipal = Depends(require_permission("ideation.read")),
) -> IngestStatusRead:
    # ponytail: read from the scheduler's last-run record. The actual
    # service call is added once the scheduler writes a record; until
    # then we return the safe 'never' status so the badge renders neutrally.
    return IngestStatusRead(
        status="never",
        ideas_created_today=0,
        last_run_at=None,
    )
```

**No `TODO`, no stub.** Returns a real, type-safe response. Auth check real. Test asserts the real shape.

**Registration:**
1. Edit `backend/app/api/v1/ideation/__init__.py` — add `ingest_status` to imports (line 8-25) and `__all__` (line 27-44).
2. Edit `backend/app/api/v1/router.py` — add `api_router.include_router(ideation.ingest_status.router)` after line 198.

**Tests in `backend/tests/api/v1/test_ideation.py`:**
- `test_ingest_status_returns_never_when_no_runs`
- `test_ingest_status_requires_auth`
- `test_ingest_status_respects_tenant`

Plus 1 test each for `sources`, `destinations`, `market_signals`, `customer_voice` (happy path + auth + tenant isolation).

**Fallback path** (if team decides `/ideation/ingest/status` is not needed): edit `docs/agent/features/ideation-center.md:399` and `docs/features/ideation-center.md:399` to remove the reference; delete `IngestIndicator` component only if `grep -rn "IngestIndicator" apps/forge --include='*.tsx'` returns zero callers.

**Verification:**

```bash
cd /home/arunachalam.v@knackforge.com/forge-ai/backend && pytest tests/api/v1/test_ideation.py -v
grep -rn "ingest/status" backend/app | head -5
grep -rn "ingest/status" docs | head -5
```

---

### PR-2.7 — `forge_phase4/` test coverage graduation

**Pre-conditions:** backend pytest baseline exists.

**Scope:** ensure each of the 7 sub-routers (`cache`, `identity`, `media`, `ops`, `passthrough`, `providers`, `sessions`) has happy-path + auth test.

**New `backend/tests/api/v1/test_forge_phase4.py`** — read `test_ideation.py` first for the exact test client + JWT fixture pattern. ~14 tests total (1 happy + 1 auth per sub-router).

**Coverage target:** ≥ 80% lines per sub-router.

```bash
cd /home/arunachalam.v@knackforge.com/forge-ai/backend
pytest tests/api/v1/test_forge_phase4.py --cov=app/api/v1/forge_phase4 --cov-report=term-missing --cov-fail-under=80
```

**Verification:** SC-2.8 passes; coverage baseline updated.

---

### PR-2.8 — WebSocket auth enforcement

**Pre-conditions:** PR-2.4 merged (canonical `api.ws()` is the only transport).

**Step 1 — find `openForgeWebSocket` callers:**

```bash
cd /home/arunachalam.v@knackforge.com/forge-ai
grep -rn "openForgeWebSocket\|from '@/lib/websocket'" apps/forge --include='*.ts' --include='*.tsx' | grep -v node_modules
```

**Step 2 — migrate each caller to `api.ws(path)`.** Read `client.ts:262-272` for the canonical return value (a raw `WebSocket`).

| Legacy `openForgeWebSocket` | Canonical `api.ws(path)` |
|---|---|
| `const handle = openForgeWebSocket(path, { onOpen, onMessage, onClose, onError })` | `const socket = api.ws(path); socket.addEventListener('open', onOpen); socket.addEventListener('message', onMessage); ...` |
| `handle.send(data)` | `socket.send(data)` |
| `handle.close(code, reason)` | `socket.close(code, reason)` |
| `handle.socket` | `socket` |

**Step 3 — delete `apps/forge/lib/websocket.ts`** once zero callers remain.

**Step 4 — un-skip the two `it.skip` tests in `apps/forge/tests/terminal-ws.test.ts:103, :123`.** Replace `openForgeWebSocket` imports with `api.ws` mocks; assert `FakeWebSocket.instances[0].url` ends with `?token=<jwt>`.

**Step 5 — `use-sidecar-probe.ts` exemption.** Add above the `socket = new WebSocket(endpoint)` line at `:69`:

```ts
// ponytail: this is a reachability probe to the local PTY sidecar on
// :4001, not the auth'd backend. It intentionally bypasses api.ws();
// the sidecar has no JWT to validate.
```

**Final verification:**

```bash
grep -rn "new WebSocket(" apps/forge/{app,lib,components,hooks} --include='*.ts' --include='*.tsx' | grep -v 'lib/api/client.ts' | grep -v 'use-sidecar-probe.ts' | wc -l   # 0
grep -rn "openForgeWebSocket\|from '@/lib/websocket'" apps/forge --include='*.ts' --include='*.tsx' | grep -v node_modules | wc -l   # 0
pnpm test apps/forge/tests/terminal-ws.test.ts
```

---

## 5. Test Plan

### PR-2.1
No new tests. Verification: `pnpm lint` exits 0 on post-2.4 tree; probe-file check confirms the rule fires.

### PR-2.2
- **Update:** `apps/forge/tests/copilot/api.test.ts` — change `vi.mock('@/lib/forge-api', ...)` to mock `@/lib/api/client`.
- **New:** `apps/forge/tests/api/client.test.ts` — assert `api.get/post/put/delete` send `Authorization` and `x-forge-tenant-id` headers (1 test per verb) + a 401→refresh→retry test using `vi.spyOn(globalThis, 'fetch')`.

### PR-2.3
For each of `lib/api/runs.ts`, `lib/api/validator.ts`, `lib/api/refactor.ts`:
- If functions kept (re-implemented against `api.get`): add tests using `vi.spyOn(globalThis, 'fetch')`.
- If functions deleted: no new tests needed.

### PR-2.4
No new tests. Verification: `pnpm build && pnpm lint && pnpm test` green; greps in SC-2.1, SC-2.2, SC-2.3 return zero.

### PR-2.5
No new tests for the shell script. Verification: positive + negative paths from §4.

### PR-2.6
Extend `backend/tests/api/v1/test_ideation.py`:
- `test_sources_list_returns_seeded_rows`
- `test_destinations_list_requires_auth`
- `test_market_signals_respects_tenant`
- `test_customer_voice_returns_clusters`
- `test_ingest_status_returns_never_when_no_runs`
- `test_ingest_status_requires_auth`
- `test_ingest_status_respects_tenant`

### PR-2.7
New `backend/tests/api/v1/test_forge_phase4.py` — 1 happy-path + 1 auth test per sub-router (~14 tests).

### PR-2.8
- **Update:** `apps/forge/tests/terminal-ws.test.ts:103, :123` — un-skip; assert `?token=<jwt>` appended.
- **New:** `apps/forge/tests/api/client-ws.test.ts` — assert `api.ws(path)` returns a `WebSocket` whose URL ends with `?token=<jwt>` (mock `globalThis.WebSocket`).

---

## 6. Rollback Strategy

| PR | Revert command | Notes |
|---|---|---|
| 2.1 | `git revert <commit>` | Single file (.eslintrc.json) + workflow yaml. Instant revert. |
| 2.2 | `git revert <commit>` | 13 files. Tests still pass post-revert (legacy `forgeFetch` still importable). |
| 2.3 | `git revert <commit>` | 3 new files + 18 importers. Revert restores `lib/api.ts` as canonical. |
| 2.4 | `git revert <commit>` | Re-create deleted files via `git show HEAD~1:apps/forge/lib/forge-api.ts > apps/forge/lib/forge-api.ts` (and same for `api.ts`). Verify `pnpm build`. |
| 2.5 | `git revert <commit>` | Remove the workflow step. The script can stay or be removed. |
| 2.6 | `git revert <commit>` | Small new file; revert removes it and registrations. 4 existing endpoints unchanged. |
| 2.7 | `git revert <commit>` | Single test file revert. |
| 2.8 | `git revert <commit>` | Restores `lib/websocket.ts`. Re-skips the two tests. |

**No PR involves schema changes, irreversible data migrations, or external API changes** — every PR is additive/substitutive and `git revert` is safe.

---

## 7. Out of Scope

- OpenAPI schema regeneration from cleaned routers — Phase 3.
- Per-endpoint schema edge-case tests — Phase 3+.
- Re-implementing legacy `lib/api.ts` orchestrator functions against real backend — if PR-2.3 §4 step 0 reveals they're stubs, they get DELETED, not ported.
- New API surface — no new endpoints except `/ideation/ingest/status`.
- Backend pytest infrastructure overhaul — Phase 1 covers `apps/forge/`; backend pytest assumed working.
- Migrating `vi.spyOn(globalThis, 'fetch')` tests to a fetch mock library — current pattern works.
- Refactoring `lib/api/` directory layout beyond the 3 split files.
- Performance optimizations (response caching, request coalescing) — Phase 5/6.
- Removing `FORGE_TERMINAL_WS_URL` env var — still used by `use-sidecar-probe.ts`.
- Production hardening of canonical client (retry budgets, circuit breaker) — Phase 5/6.
- Migrating `.next/` build artifacts out of the repo — orthogonal.

---

## 8. Definition of Done

Phase 2 is **DONE** when, in order:

1. All 8 PRs merged to `main`, each behind a green CI.
2. SC-2.1 through SC-2.11 all pass (run verification commands; capture output in PR descriptions).
3. `docs/plan/phase-2-coverage-baseline.md` committed with recorded numbers.
4. `scripts/check-orphan-routers.sh` exists, is executable, and is referenced from `.github/workflows/test.yml`.
5. `.eslintrc.json` contains `no-restricted-imports` at `"error"` for `@/lib/forge-api` and `@/lib/api`.
6. Branch protection from Phase 1 has these two new required checks added: `Orphan-router guard`, `Lint`. (Manual GitHub UI step — document who/when in phase close-out.)
7. `apps/forge/lib/forge-api.ts` and `apps/forge/lib/api.ts` are deleted from `main`.
8. `/ideation/ingest/status` exists with tests OR has all doc references deleted.
9. No `TODO`, `FIXME`, `NotImplementedError`, `pass` (in business logic), or `# in real impl this would` introduced anywhere in the diff (ponytail rule; CI grep confirms).
10. Phase close-out section filled in below.

---

## 9. Critical Files for Implementation

- `apps/forge/.eslintrc.json`
- `apps/forge/lib/api/client.ts`
- `apps/forge/lib/forge-api.ts` (delete)
- `apps/forge/lib/api.ts` (delete)
- `backend/app/api/v1/router.py`
- `backend/app/api/v1/ideation/__init__.py`
- `backend/app/api/v1/ideation/ingest_status.py` (create)
- `backend/app/api/v1/forge_phase4/__init__.py` (audit only)
- `backend/tests/api/v1/test_ideation.py` (extend)
- `backend/tests/api/v1/test_forge_phase4.py` (create)
- `scripts/check-orphan-routers.sh` (create)
- `.github/workflows/test.yml`

---

## 10. Phase Close-out (filled at the end)

```
Implementation date: ___
PR(s): ___
forgeFetch call sites eliminated: 95 (13 prod + 2 test files)
lib/api importers migrated: 18 files
Orphan-router guard: yes, wired in CI
Endpoint disposition:
  - /ideation/sources — already registered, tests added
  - /ideation/destinations — already registered, tests added
  - /ideation/market-signals — already registered, tests added
  - /ideation/voice-clusters — already registered (as customer_voice), tests added
  - /ideation/ingest/status — IMPLEMENTED (or DELETED FROM DOCS)
forge_phase4/ coverage: __%
Coverage delta vs Phase 1 baseline: __%
Branch protection updated: confirmed by ___ on ___
Follow-up tickets opened: ___
```

---

### Sources read by the Plan agent

- `docs/plan/README.md`, `docs/plan/phase-1.md`, `docs/plan/phase-2.md`
- `apps/forge/CLAUDE.md`, `backend/CLAUDE.md`
- `apps/forge/lib/{forge-api.ts, api.ts, api/client.ts, websocket.ts}`
- `apps/forge/.eslintrc.json`
- `backend/app/api/v1/{router.py, ideation/__init__.py, ideation/router.py (absent), architecture/__init__.py, forge_phase4/__init__.py, ideation/{sources,destinations,market_signals,customer_voice}.py}`
- `apps/forge/hooks/use-sidecar-probe.ts`, `hooks/{use-command-artifact,use-command-history,use-forge-commands}.ts`
- `scripts/check-test-location.sh`
- All `forgeFetch` importers enumerated via `grep -rn` (13 production + 2 test files)
- All `@/lib/api` importers enumerated via `grep -rn` (18 files)
- All WebSocket call sites enumerated via `grep -rn` (3 sites)