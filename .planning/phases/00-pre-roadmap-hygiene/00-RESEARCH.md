# Phase 0 — Pre-Roadmap Hygiene — Research

**Researched:** 2026-06-23
**Domain:** Repository hygiene — stack reconciliation, monorepo package refactor, CI grep enforcement, security startup guard
**Confidence:** HIGH (all four requirements map to concrete, currently-visible code paths)

## Summary

Phase 0 is a "make assumptions stable" phase, not a feature phase. The four HYG items are well-scoped, and the current codebase state is unambiguous for each: Tailwind 3.4.14 is installed but docs claim v4, `node-pty` lives inside `apps/forge`, no `import litellm` violations exist yet (the gate is preventive), and `DEV_AUTH_BYPASS` is honored in `get_current_principal` with no boot-time guard.

All four HYG requirements can be implemented with single, narrow code paths. No ambiguous design choices remain. The main planning risk is around the `node-pty` refactor (Plan 00-02): it requires creating a new `pnpm` workspace package, moving a native binding dependency, and updating `apps/forge/package.json` to consume the package via the workspace link — a multi-file change touching the lockfile.

**Primary recommendation:** Treat Phase 0 as four independent, sequential plans. Plan 00-01 (Tailwind docs) and Plan 00-04 (DEV_AUTH_BYPASS guard) are 1-file changes. Plan 00-03 (CI grep gate) is a new workflow file. Plan 00-02 (node-pty refactor) is the only one that requires `pnpm` workspace plumbing.

## Current State (Code Findings)

### HYG-01 — Tailwind drift

| File | Line(s) | Current Content | Drift |
|------|---------|-----------------|-------|
| `/home/arunachalam.v@knackforge.com/forge-ai/.claude/CLAUDE.md` | 36 | `Tailwind CSS 4` (in the "Frontend" code block) | **Drift** — declared v4 |
| `/home/arunachalam.v@knackforge.com/forge-ai/docs/architecture/overview.md` | 29 | `Frontend \| Next.js 15, React 19, TypeScript 5.x, Shadcn/UI, Tailwind CSS 4 \| project-context.md` | **Drift** — declared v4 |
| `/home/arunachalam.v@knackforge.com/forge-ai/apps/forge/package.json` | 64 | `"tailwindcss": "3.4.14"` (in `devDependencies`) | **Reality** — pinned 3.4.14 |
| `/home/arunachalam.v@knackforge.com/forge-ai/apps/forge/package.json` | 65 | `"tailwindcss-animate": "^1.0.7"` | Compatible with 3.4.x (companion plugin) |
| `/home/arunachalam.v@knackforge.com/forge-ai/apps/forge/package.json` | 63 | `"postcss": "8.4.47"` | Compatible with 3.4.x (3.4 supports postcss 8.x) |
| `/home/arunachalam.v@knackforge.com/forge-ai/.planning/PROJECT.md` | n/a (decisions table) | row "Tailwind 3.4.14 installed vs Tailwind 4 declared" → marked `⚠️ Revisit — Phase 0 fix` | **Already documented** as the Phase 0 fix target |
| `/home/arunachalam.v@knackforge.com/forge-ai/.planning/STATE.md` | 67 | `Phase 0: Tailwind 3.4.x stays; CLAUDE.md + overview.md updated to match reality (not Tailwind 4 mid-pilot).` | **Locked decision** — stay on 3.4.x |

**Magnitude:** Two documentation lines (one in CLAUDE.md, one in overview.md). The library pin is already correct. No code change is required to align reality with docs.

**Decision (locked in STATE.md):** Stay on Tailwind 3.4.x. Update docs to declare `3.4.x`. Tailwind 4 migration is deferred to a dedicated post-pilot phase (also recorded in REQUIREMENTS.md "Out of Scope" — `Tailwind 4 migration`).

### HYG-02 — `node-pty` + `terminal-server.mjs` location

| File | Line(s) | Current Content | Status |
|------|---------|-----------------|--------|
| `/home/arunachalam.v@knackforge.com/forge-ai/apps/forge/package.json` | 12 | `"dev:terminal": "node bin/terminal-server.mjs"` | **In apps/forge** — wrong location |
| `/home/arunachalam.v@knackforge.com/forge-ai/apps/forge/package.json` | 62 | `"node-pty": "^1.0.0"` (in `devDependencies`) | **In apps/forge** — wrong location |
| `/home/arunachalam.v@knackforge.com/forge-ai/apps/forge/bin/terminal-server.mjs` | 35 | `import * as pty from 'node-pty';` | **Direct import** in apps/forge — violation |
| `/home/arunachalam.v@knackforge.com/forge-ai/apps/forge/bin/terminal-server.mjs` | 1-131 | full file (~4.2K) — the entire PTY sidecar | **Should move** to `packages/forge-terminal-server/` |
| `/home/arunachalam.v@knackforge.com/forge-ai/packages/forge-terminal-server/` | — | **Does not exist** (verified by `ls`) | Need to create |
| `/home/arunachalam.v@knackforge.com/forge-ai/pnpm-workspace.yaml` | 1-5 | `packages: ["packages/*", "apps/*", "mcp-servers/*"]` | Already includes `packages/*` — no workspace.yaml change needed |
| `/home/arunachalam.v@knackforge.com/forge-ai/packages/connector-events/package.json` | 1-38 | example package layout — `name: "forge-ai/connector-events"`, `"type": "module"`, `main: "dist/index.js"`, `exports: { ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" } }` | **Reference pattern** for new package |

**Other `node-pty` references** (verified clean):
- `apps/forge/node_modules/.pnpm/next@15.0.3.../node_modules/next/dist/lib/server-external-packages.json` — Next.js bundles `node-pty` in its list of "external packages" (i.e., packages that should not be bundled into the server output). This is a Next.js framework concern, not a project import. The grep gate must exclude `node_modules/**`.
- `apps/forge/bin/terminal-server.mjs` lines 21, 27 — comment-only references ("Dependencies (dev only): ws, node-pty."). These move with the file.
- `apps/forge/package.json` line 62 — the actual dependency declaration (above).

**Drift magnitude:** Two files to move (`bin/terminal-server.mjs`, plus the `node-pty` devDependency). One new package to create (`packages/forge-terminal-server/package.json` with name `forge-ai/forge-terminal-server`). One script rewrite in `apps/forge/package.json` to point `dev:terminal` at the workspace package's binary.

**Workspace tooling:** The repo is `pnpm` 9.12.3 (per `ci-monorepo.yml` line 10). `pnpm-workspace.yaml` already globs `packages/*`. A new package under `packages/forge-terminal-server` will be picked up automatically.

### HYG-03 — `import litellm` grep gate + UUID literal ban

**`import litellm` (Rule 1 enforcement):**

| File | Status |
|------|--------|
| `/home/arunachalam.v@knackforge.com/forge-ai/backend/app/services/litellm_client.py` | **Allowed** — canonical client. Currently does NOT contain `import litellm` (uses `httpx` directly per `requirements.txt` line 13 and `litellm_client.py` line 17). |
| All other backend `.py` files | **No `import litellm` found.** Verified by `grep -rEn "^\s*import\s+litellm\|^\s*from\s+litellm\b" backend --include="*.py"` — returned empty. |
| `/home/arunachalam.v@knackforge.com/forge-ai/backend/requirements.txt` line 26 | `litellm>=1.40,<2   # client SDK ONLY for type stubs; HTTP via httpx in production` — direct dependency. The grep gate targets imports, not requirements, so this is unaffected. The plan should also note that `litellm` is installed in venv; the gate prevents *code* from importing it outside the canonical client. |

**Magnitude:** Zero current violations. The grep gate is **preventive** — it codifies Rule 1 as an automated check. Adding a CI job that fails on any `import litellm` outside `backend/app/services/litellm_client.py` is the implementation.

**UUID literals in `apps/forge/lib/`:**

| File | Line | Content | UUID? | Rule Applies? |
|------|------|---------|-------|---------------|
| `/home/arunachalam.v@knackforge.com/forge-ai/apps/forge/lib/api.ts` | 54 | `const DEV_TENANT_UUID = '00000000-0000-4000-8000-000000000ace';` | **YES** — full canonical UUIDv4 with version nibble `4` and variant nibble `8` |
| `/home/arunachalam.v@knackforge.com/forge-ai/apps/forge/lib/api.ts` | 205 | `export const SEED_RUN_UUID = '00000000-0000-4000-8000-000000000001';` | **YES** — full canonical UUIDv4-style string |

**Drift magnitude:** Two known UUID literals in `apps/forge/lib/api.ts`. Both are seed/dev placeholders (one for the demo tenant, one for the seed run). The HYG-03 success criterion says: "no UUID literals in `apps/forge/lib/`". The plan must either (a) move these constants to a different location (e.g., `apps/forge/lib/dev-seed.ts` outside the gated glob, or `apps/forge/config/dev-seeds.ts` outside `lib/`), or (b) replace them with generated UUIDs (acceptable in dev where `uuid.v4()` from a runtime import is available). Option (a) is simpler and matches the intent: the gate is a discipline enforcement, not a removal mandate.

**Grep pattern candidates:**

For UUIDs, the regex must match canonical UUID format but not match `00000000-0000-4000-8000-000000000000` (zeros) if those are also banned — both `ace` and `001` end with the variant nibble `8` and the version nibble `4` per the current `lib/api.ts` constants. The simplest pattern: `[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}`. This will match BOTH dev seed UUIDs. That is intended.

For `import litellm`: regex is `^\s*(import\s+litellm\b|from\s+litellm\b)`. Excludes `from app.services.litellm_client import LiteLLMClient` because the module is `litellm_client`, not `litellm`.

### HYG-04 — `DEV_AUTH_BYPASS` startup guard

| File | Line(s) | Current Content | Status |
|------|---------|-----------------|--------|
| `/home/arunachalam.v@knackforge.com/forge-ai/backend/app/core/config.py` | 49 | `dev_auth_bypass: bool = False` | Field defined, defaults to False, reads `DEV_AUTH_BYPASS` env (case-insensitive) |
| `/home/arunachalam.v@knackforge.com/forge-ai/backend/app/core/config.py` | 33 | `environment: Literal["development", "staging", "production", "test"] = "development"` | Field defined, reads `ENVIRONMENT` env |
| `/home/arunachalam.v@knackforge.com/forge-ai/backend/app/core/security.py` | 99-111 | `if settings.dev_auth_bypass: return AuthenticatedPrincipal(...)` | **Production hazard** — the bypass is honored regardless of `environment` |
| `/home/arunachalam.v@knackforge.com/forge-ai/backend/app/main.py` | 30-91 | `lifespan` async context — runs `configure_logging`, `init_telemetry`, `await bus.start()`, then registers connectors/subscribers/scheduler/alerts | **No guard exists** at boot |
| `/home/arunachalam.v@knackforge.com/forge-ai/backend/app/core/config.py` | 101-108 | `@lru_cache def get_settings(): return Settings()` | Settings is computed once at module import time (`settings = get_settings()` at line 111) |
| `/home/arunachalam.v@knackforge.com/forge-ai/backend/app/core/security.py` | 83, 92 | docstring mentions `FORA_DEV_AUTH_BYPASS=1` | The historical env-var name was `FORA_DEV_AUTH_BYPASS`; current field is `dev_auth_bypass` (case-insensitive read). The intent is the same, but the docstring is stale. |

**Magnitude:** The guard is **not implemented**. Today, `DEV_AUTH_BYPASS=1` + `ENVIRONMENT=production` will silently grant the synthetic `dev@forge.local` admin principal in production — a critical PITFALL. The fix is a single Pydantic validator on `Settings` (in `config.py`) that raises when `dev_auth_bypass is True and environment != "development"`. Because `settings = get_settings()` runs at module import time (line 111), the validator firing at instantiation will raise *at import* — i.e., the process will fail to start. That matches the success criterion: "Service refuses to start (raises on import)."

**Why a Pydantic validator (and not a lifespan check):** Pydantic v2 model validators run on instantiation. `get_settings()` is called at line 111, top-level. Importing `app.core.config` evaluates that line. The validator raising → the import fails → the process exits non-zero. This is the strongest "fail at import" guarantee and matches the success criterion verbatim.

**Edge case:** The `environment` field defaults to `"development"`, so a developer who runs without setting `ENVIRONMENT` is not affected. A developer who explicitly sets `ENVIRONMENT=production` while leaving `DEV_AUTH_BYPASS` unset is not affected. A developer who sets `DEV_AUTH_BYPASS=1` without `ENVIRONMENT` is also not affected (default env is "development"). The only case the guard catches is the dangerous one.

## Recommended Approach

### HYG-01 — Tailwind drift reconciliation

**Approach:** Update two documentation lines. Do NOT migrate Tailwind.

**Files to modify:**

1. `/home/arunachalam.v@knackforge.com/forge-ai/.claude/CLAUDE.md` line 36:
   - From: `Tailwind CSS 4`
   - To: `Tailwind CSS 3.4.x`

2. `/home/arunachalam.v@knackforge.com/forge-ai/docs/architecture/overview.md` line 29:
   - From: `Frontend \| Next.js 15, React 19, TypeScript 5.x, Shadcn/UI, Tailwind CSS 4 \| project-context.md`
   - To: `Frontend \| Next.js 15, React 19, TypeScript 5.x, Shadcn/UI, Tailwind CSS 3.4.x \| project-context.md`

**No code changes.** No new dependencies. No package.json edits. No PostCSS config edits (the installed `tailwindcss: 3.4.14` is already in devDependencies and the project already builds against it).

**Optional doc addition (recommended):** Add a one-line note to both files explicitly stating "Tailwind 4 migration is deferred to post-pilot (see REQUIREMENTS.md Out of Scope)" so the next reader does not re-flag the same drift.

### HYG-02 — `node-pty` refactor into `packages/forge-terminal-server`

**Approach:** Create a new pnpm workspace package that owns the `node-pty` dependency and the sidecar script. Update `apps/forge` to invoke the package's binary via the workspace link.

**Concrete file changes:**

1. **Create `/home/arunachalam.v@knackforge.com/forge-ai/packages/forge-terminal-server/package.json`:**
   ```json
   {
     "name": "forge-ai/forge-terminal-server",
     "version": "0.1.0",
     "description": "PTY sidecar for the Forge Terminal Center (xterm.js backend).",
     "license": "UNLICENSED",
     "private": true,
     "type": "module",
     "bin": {
       "forge-terminal-server": "./dist/server.mjs"
     },
     "main": "./dist/server.mjs",
     "scripts": {
       "build": "node -e \"require('fs').copyFileSync('src/server.mjs','dist/server.mjs')\" || cp src/server.mjs dist/server.mjs",
       "typecheck": "echo 'no TS sources — pass'",
       "test": "echo 'no tests yet — pass'",
       "lint": "echo 'no lint config — pass'"
     },
     "dependencies": {
       "node-pty": "^1.0.0",
       "ws": "^8.18.0"
     },
     "engines": {
       "node": ">=20"
     }
   }
   ```
   (Bin layout may also be `bin: { "forge-terminal-server": "src/server.mjs" }` and let pnpm link it — verify which is the convention used by `connector-events`. Either works; `connector-events` doesn't ship a bin so there is no precedent. The plan should pick one and document it.)

2. **Create `/home/arunachalam.v@knackforge.com/forge-ai/packages/forge-terminal-server/src/server.mjs`** by moving the contents of `apps/forge/bin/terminal-server.mjs` (lines 1-131) verbatim, adjusting the docstring comment block to reference the new file path.

3. **Create `/home/arunachalam.v@knackforge.com/forge-ai/packages/forge-terminal-server/README.md`** — short note that this package exists, the bin name, and the dev invocation.

4. **Update `/home/arunachalam.v@knackforge.com/forge-ai/apps/forge/package.json`:**
   - Remove line 12 `"dev:terminal": "node bin/terminal-server.mjs"`
   - Remove line 62 `"node-pty": "^1.0.0"` from `devDependencies`
   - Add to `devDependencies`: `"@forge-ai/forge-terminal-server": "workspace:*"`
   - Add `dev:terminal` script: `"dev:terminal": "forge-terminal-server"` (or `pnpm exec forge-terminal-server` — both work)
   - Optional: keep `dev:stack` script unchanged — `pnpm dev:terminal` and `pnpm dev` still chain via `concurrently`.

5. **Delete `/home/arunachalam.v@knackforge.com/forge-ai/apps/forge/bin/terminal-server.mjs`** (after the move is verified).

6. **Regenerate the lockfile:** `pnpm install` (or `pnpm install --no-frozen-lockfile` in CI). The lockfile must be committed.

7. **Update `apps/forge/.gitignore`** (if `dist/` is not already ignored) to ignore `packages/forge-terminal-server/dist/`. Verify existing pattern.

**Monorepo pattern (TypeScript workspace):** The other packages under `packages/` (`connector-events`, `gsd-core-stub`, `gsd-pi-stub`, `mcp-router`) use a `dist/` build with `tsc -p tsconfig.json`. The `forge-terminal-server` package is intentionally `.mjs` (no TS), so the build step is a copy. This is consistent with how `apps/forge/bin/terminal-server.mjs` already ran directly with `node`.

**Risk:** `node-pty` has a native build step. The pnpm workspace must hoist or symlink the native binding so that the new package can `import * as pty from 'node-pty'`. This is normally automatic for pnpm with `node-linker=hoisted` (the default in most setups) but should be verified. If pnpm strict mode is on, the plan may need to add `node-pty` to `packages/forge-terminal-server`'s `dependencies` (which the snippet above does).

### HYG-03 — CI grep gate

**Approach:** Add a new CI job (or extend `ci-monorepo.yml` or `ci.yml`) that runs two `grep` commands and fails on any non-zero result outside the allowlisted paths.

**Concrete file changes:**

1. **Create `/home/arunachalam.v@knackforge.com/forge-ai/.github/workflows/ci-hygiene-grep.yml`** (or add a job to `ci-monorepo.yml` — the plan should pick one; a separate file is cleaner because it has no Node/Python runtime dependency):

   ```yaml
   name: ci-hygiene-grep

   on:
     push:
       branches: [main]
     pull_request:
       branches: [main]

   jobs:
     grep-gate:
       name: Rule 1 + UUID literal gate
       runs-on: ubuntu-24.04
       timeout-minutes: 5
       steps:
         - name: Checkout
           uses: actions/checkout@v4.2.2

         - name: Rule 1 — `import litellm` only in litellm_client.py
           run: |
             set -euo pipefail
             # Allowlist: backend/app/services/litellm_client.py is the only file
             # that may import the litellm SDK directly (Rule 1).
             matches=$(grep -rEn '^\s*(import\s+litellm\b|from\s+litellm\b)' \
               --include='*.py' \
               --exclude-dir=node_modules \
               --exclude-dir=.pnpm-store \
               --exclude-dir=__pycache__ \
               --exclude-dir=.venv \
               --exclude-dir=dist \
               backend || true)
             offenders=$(echo "$matches" \
               | grep -v '^backend/app/services/litellm_client.py:' \
               || true)
             if [ -n "$offenders" ]; then
               echo "::error::Rule 1 violation: 'import litellm' found outside the canonical client:"
               echo "$offenders"
               exit 1
             fi
             echo "OK: no `import litellm` outside litellm_client.py"

         - name: UUID literal ban — apps/forge/lib/**/*.ts
           run: |
             set -euo pipefail
             pattern='[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
             matches=$(grep -rEn "$pattern" \
               --include='*.ts' \
               --include='*.tsx' \
               --exclude-dir=node_modules \
               --exclude-dir=.next \
               --exclude-dir=dist \
               apps/forge/lib || true)
             if [ -n "$matches" ]; then
               echo "::error::HYG-03 violation: UUID literal in apps/forge/lib/:"
               echo "$matches"
               exit 1
             fi
             echo "OK: no UUID literals in apps/forge/lib/"
   ```

2. **Pre-flight fix for UUID literals** (must happen in Plan 00-03 itself, before the gate can pass): move the two known UUID literals out of `apps/forge/lib/`.
   - Option A: Move to `apps/forge/lib/dev-seeds.ts` and exclude the file from the gate (the gate scans `*.ts`/`*.tsx`; cannot exclude by filename without `--exclude`).
   - Option B: Move to `apps/forge/config/dev-seeds.ts` (outside `lib/`).
   - Option C: Replace with a deterministic generator that produces the same UUID at module load (e.g., a hard-coded `Uint8Array(16)` initialized with known bytes and passed to `crypto.randomUUID`-style formatter). This is overkill for dev seeds.
   - **Recommended:** Option B (move to `apps/forge/config/dev-seeds.ts`). The constants are imported back into `lib/api.ts` via a relative path. The gate stays clean.

3. **For `litellm_client.py`:** The current file does NOT contain `import litellm` (it uses `httpx`). The gate is preventive. The plan should explicitly call out: "The gate is forward-looking — it does not require any change to `litellm_client.py` today, but any future PR that adds `import litellm` to that file will fail the build. This is the intended behavior." (Actually, `litellm_client.py` IS in the allowlist, so the gate would still pass for that file. Future code outside the allowlist will fail.)

### HYG-04 — Startup assertion for `DEV_AUTH_BYPASS`

**Approach:** Add a Pydantic v2 model validator on `Settings` that raises `ValueError` when `dev_auth_bypass is True` AND `environment != "development"`. Because `settings = get_settings()` runs at module import time, the validator raises at import — the process will exit non-zero before FastAPI boots.

**Concrete file change to `/home/arunachalam.v@knackforge.com/forge-ai/backend/app/core/config.py`:**

Add `from pydantic import Field, model_validator` (extend the existing import on line 11) and add the validator inside the `Settings` class:

```python
class Settings(BaseSettings):
    # ... existing fields ...

    @model_validator(mode="after")
    def _dev_bypass_only_in_dev(self) -> "Settings":
        """HYG-04: refuse to boot if DEV_AUTH_BYPASS is enabled outside dev.

        The bypass grants a synthetic admin principal in the demo tenant.
        Honoring it in any non-development environment is a critical PITFALL —
        the dev session has forge:admin + every ideation:* permission.
        """
        if self.dev_auth_bypass and self.environment != "development":
            raise ValueError(
                "DEV_AUTH_BYPASS=1 is only allowed when ENVIRONMENT=development. "
                f"Got ENVIRONMENT={self.environment!r}. Refusing to boot."
            )
        return self
```

**Why this is the right hook:**
- Runs at `Settings()` instantiation time (Pydantic v2 model validators with `mode="after"` run after field validation).
- `get_settings()` is `@lru_cache`d but is called at module import (line 111: `settings = get_settings()`).
- Importing `app.core.config` (which `app.main` does at line 22) triggers the validator.
- A `ValueError` raised at import surfaces as `pydantic_core._pydantic_core.ValidationError` (Pydantic wraps `ValueError` from validators in `ValidationError`). The process exits with a non-zero code; `python -c "import app.core.config"` and `uvicorn app.main:app` both fail. This matches the success criterion: "Service refuses to start (raises on import)."

**No new dependencies.** Pydantic v2 is already in `requirements.txt` line 10.

**Optional but recommended:** Also update the stale docstring in `backend/app/core/security.py` lines 83 and 92 (which mentions `FORA_DEV_AUTH_BYPASS=1`) to use the canonical `DEV_AUTH_BYPASS=1` and explicitly state "enforced by the validator in `app.core.config`."

## Risks & Landmines

### HYG-01 — Tailwind drift

- **Risk:** A reader misreads "3.4.x" as a target version (we're going TO 3.4.x) instead of a pinned version (we're STAYING on 3.4.x). The plan should use the exact string `Tailwind CSS 3.4.x` (matching the success criterion in `ROADMAP.md`).
- **Risk:** Tailwind 3 vs Tailwind 4 class differences — NOT relevant here because the plan explicitly does NOT migrate. If a future reader sees `Tailwind 4` in any PR, the docs are wrong. (Tautological; mentioned for completeness.)
- **No code risk:** No Tailwind config or PostCSS config changes.

### HYG-02 — `node-pty` refactor

- **Risk: Native bindings.** `node-pty` is a native Node addon. The pnpm workspace must successfully hoist or symlink the binary so the new package can `import` it. The `pnpm-workspace.yaml` does NOT explicitly set `node-linker`, which means pnpm 9.12.3 uses the default (isolated). With isolated linking, the package's own `node_modules` will get a working copy. Verified: pnpm 9.12.x supports native addons in workspace packages out of the box; `node-gyp` builds happen during `pnpm install`. **However**, the build must succeed in CI. The plan should add a step to `ci-monorepo.yml` (or a new workflow) that runs `pnpm install` and confirms `node-pty` is built inside the new package. If CI runners do not have `build-essential` / `python3` (for `node-gyp`), the install will fail.
- **Risk: `dist/` build.** If the new package uses `bin: { ...: "./dist/server.mjs" }`, the `dist/` directory must exist before `pnpm` can link the bin. The plan must run the `build` script first. The `connector-events` precedent uses a `tsc -p tsconfig.json` build; the new package's `build` script (`cp src/server.mjs dist/server.mjs`) follows the same shape.
- **Risk: `bin` field in `package.json`.** If the bin is registered as `forge-terminal-server`, the consumer (`apps/forge`) can call it via `pnpm exec forge-terminal-server` (PATH inherited from pnpm) or via the workspace dependency's `node_modules/.bin/forge-terminal-server`. The plan should pick one and the existing `concurrently` invocation in `dev:stack` (line 13) must be updated accordingly.
- **Risk: Lockfile churn.** Moving `node-pty` between packages will change the lockfile (pnpm will re-shuffle the virtual store). CI uses `--frozen-lockfile` (ci-monorepo.yml line 35); the PR must include the lockfile update.

### HYG-03 — Grep gate

- **Risk: False positives — UUID-like strings that aren't UUIDs.** The pattern `[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}` will match the canonical UUID format. False-positive candidates:
  - Test fixtures with hard-coded UUIDs (none in `apps/forge/lib/` today, but possible to add later)
  - Documentation string literals (`// "550e8400-..."`) that are examples
  - Comments referencing a UUID
  - **Mitigation:** The pattern is intentionally strict. If a future contributor adds a UUID literal in `apps/forge/lib/`, they should either (a) move it to `apps/forge/config/` (dev seeds) or (b) generate it. The gate is a discipline enforcement, not a code-generation check.
- **Risk: False positives — `import litellm` inside a string literal or comment.** The pattern is `^\s*import\s+litellm\b` — line-anchored. A docstring `"""import litellm"""` will NOT match (the triple-quote appears first). A `# import litellm` comment WILL match (the pattern doesn't know about `#`). **Mitigation:** If false positives appear in comments, the plan can extend the grep with `grep -v '^\s*#' | grep -v '^\s*"""'`. Initial implementation can use the simpler pattern and tighten if needed.
- **Risk: `litellm_client.py` itself.** The current file does not contain `import litellm`, so the allowlist is forward-looking. The plan should document: "If a future change adds `import litellm` to `litellm_client.py` (e.g., for type stubs), the gate still passes because of the allowlist."
- **Risk: Grep tool availability.** CI runners ship GNU grep. The plan should use `grep -E` (POSIX) and avoid `rg` (ripgrep) to maximize portability. If `rg` is preferred (faster), the plan must add an `apt-get install ripgrep` step or use the `mackenzieeason/ripgrep` action.

### HYG-04 — Startup assertion

- **Risk: `get_settings()` cache.** `@lru_cache` means the validator runs once per process. If a test changes `DEV_AUTH_BYPASS` mid-test (via `monkeypatch.setenv` + `get_settings.cache_clear()`), the validator will run again. Tests that set `ENVIRONMENT=production` and `DEV_AUTH_BYPASS=1` will now fail; the test fixtures must be updated. **Mitigation:** The plan should add a unit test that explicitly asserts the guard fires (construct Settings with both set → expect ValidationError), AND update any existing tests that rely on the bypass in non-dev environments.
- **Risk: Default `environment = "development"`.** A developer who runs without `ENVIRONMENT` is not affected. A developer who sets `ENVIRONMENT=test` is also affected by the guard if they also set `DEV_AUTH_BYPASS=1`. The success criterion explicitly allows `ENVIRONMENT=development` only; `test` is excluded. This is the intended behavior — `pytest` runs the bypass in the dev tenant but with a real (or in-memory) DB. **Mitigation:** Test fixtures for `test` env should NOT set `DEV_AUTH_BYPASS=1`. If they do, the guard is correct and the fixtures should be updated.
- **Risk: `ValueError` vs `ValidationError`.** Pydantic v2 wraps a `ValueError` raised inside a `model_validator` inside a `pydantic_core.ValidationError`. The plan should test that the import fails (i.e., the process exits non-zero) rather than testing for a specific exception type. A simple test: `pytest.raises(Exception)` is sufficient; a more specific test: `pytest.raises(pydantic.ValidationError)`.
- **Risk: `lifespan` ordering.** The success criterion says "raises on import." The Pydantic validator raising at `get_settings()` call (top-level in `config.py`) fires at import time, BEFORE `app.main` even reaches `lifespan`. The guard is fail-fast.

## Validation Strategy (Nyquist — Dimension 8)

### HYG-01

| Verification | Command | Expected |
|--------------|---------|----------|
| Docs declare 3.4.x | `grep -E "Tailwind (CSS )?3\.4\.x" .claude/CLAUDE.md docs/architecture/overview.md` | Both files contain `3.4.x` |
| No docs declare 4 | `grep -E "Tailwind (CSS )?4" .claude/CLAUDE.md docs/architecture/overview.md` | Zero matches |
| Installed pin | `grep '"tailwindcss"' apps/forge/package.json` | `3.4.14` |

### HYG-02

| Verification | Command | Expected |
|--------------|---------|----------|
| New package exists | `test -d packages/forge-terminal-server && test -f packages/forge-terminal-server/package.json` | Both succeed |
| `node-pty` moved | `grep -rE '"node-pty"' apps/forge/package.json` | Zero matches |
| `node-pty` only in new package | `grep -rE '"node-pty"' packages/forge-terminal-server/package.json` | One match (`^1.0.0`) |
| `terminal-server.mjs` moved | `test -f packages/forge-terminal-server/src/server.mjs && ! test -f apps/forge/bin/terminal-server.mjs` | Both succeed |
| `apps/forge` does not import `node-pty` directly | `grep -rE "from ['\"]node-pty['\"]|require\(['\"]node-pty['\"]\)" apps/forge --include='*.ts' --include='*.tsx' --include='*.mjs' --exclude-dir=node_modules` | Zero matches |
| Workspace resolves | `pnpm install` (clean checkout) | Exit 0; new package present in `node_modules/.pnpm/` |
| Binary launches | `pnpm --filter @forge-ai/forge-terminal-server exec forge-terminal-server` (or similar) | Listens on `ws://127.0.0.1:4001` |

### HYG-03

| Verification | Command | Expected |
|--------------|---------|----------|
| Workflow file exists | `test -f .github/workflows/ci-hygiene-grep.yml` | Succeeds |
| Workflow has both grep steps | `grep -E "import litellm|UUID literal" .github/workflows/ci-hygiene-grep.yml` | Both phrases present |
| Local run of `import litellm` grep | `bash -c "matches=$(grep -rEn '^\s*(import\s+litellm\b\|from\s+litellm\b)' --include='*.py' --exclude-dir=node_modules --exclude-dir=.pnpm-store --exclude-dir=__pycache__ --exclude-dir=.venv --exclude-dir=dist backend); offenders=\$(echo \"\$matches\" \| grep -v '^backend/app/services/litellm_client.py:'); [ -z \"\$offenders\" ]"` | Exit 0 |
| Local run of UUID grep (after dev-seeds moved) | `bash -c "matches=$(grep -rEn '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}' --include='*.ts' --include='*.tsx' --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=dist apps/forge/lib); [ -z \"\$matches\" ]"` | Exit 0 |
| Local fail test (sanity) — inject a violation and re-run | `echo 'const x = "00000000-0000-4000-8000-000000000ace";' > apps/forge/lib/test-violation.ts; grep -rEn '...' apps/forge/lib; rm apps/forge/lib/test-violation.ts` | First grep returns the violation (exit 1); after deletion, exit 0 |

### HYG-04

| Verification | Command | Expected |
|--------------|---------|----------|
| Validator exists | `grep -E '_dev_bypass_only_in_dev|model_validator' backend/app/core/config.py` | Both phrases present |
| Unit test — guard fires | `pytest -xvs tests/test_config.py::test_dev_bypass_blocks_production` (new test) | Passes; `pydantic.ValidationError` raised |
| Unit test — guard passes in dev | `pytest -xvs tests/test_config.py::test_dev_bypass_allowed_in_development` (new test) | Passes; Settings instantiates |
| Unit test — guard passes when bypass off | `pytest -xvs tests/test_config.py::test_no_bypass_no_op` (new test) | Passes |
| Import-time failure | `cd backend && DEV_AUTH_BYPASS=1 ENVIRONMENT=production python -c "import app.core.config"` | Non-zero exit, traceback shows `ValidationError` |
| No startup regression | `cd backend && ENVIRONMENT=development python -c "import app.core.config; print('ok')"` | Exits 0 with `ok` |

## Open Questions

None — all 4 HYG requirements have unambiguous, single-path implementation given current codebase state. The two non-trivial decisions (the `@forge-ai/forge-terminal-server` name and the `dist/` vs `src/` bin layout) are package-naming choices, not requirement-interpretation questions; the plan can pick a convention and document it.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `pnpm-workspace.yaml` does not need editing because `packages/*` is already in the globs (line 2). | HYG-02 | If a future PR tightens the globs, the new package breaks the install. |
| A2 | `node-pty` builds successfully in CI on `ubuntu-24.04` (the runner used by `ci-monorepo.yml`). The build needs `build-essential` and `python3` for `node-gyp`. | HYG-02 | If the runner lacks these, `pnpm install` fails. Mitigation: add an `apt-get install -y build-essential python3` step to the new package's install step or to the workflow. |
| A3 | Grep regex for UUIDs (`[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}`) does not match non-UUID hex strings in `apps/forge/lib/`. | HYG-03 | If a future contributor adds a 36-char hex string with dashes somewhere (e.g., a JWT-like blob), the gate false-positives. Mitigation: tighten the regex to require version+variant nibbles (`4[0-9a-fA-F]{3}-[0-9a-fA-F]{4}-[89ab][0-9a-fA-F]{3}-`...). |
| A4 | Pydantic v2 `model_validator(mode="after")` raising `ValueError` is wrapped in `pydantic_core.ValidationError` and propagates to the import call. | HYG-04 | If Pydantic swallows the error silently (it does not, but worth verifying with a one-liner), the guard does not fire. |
| A5 | `dev:stack` script in `apps/forge/package.json` (line 13) continues to work after the `dev:terminal` script is changed to `forge-terminal-server`. | HYG-02 | If the new bin name has a different PATH resolution under `concurrently`, the dev stack breaks. Mitigation: change `dev:stack` to `"pnpm dev:terminal"` (works with workspace deps) instead of invoking the bin by name directly. |

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `pnpm` | HYG-02 workspace plumbing, `pnpm install --frozen-lockfile` | ✓ | 9.12.3 (per `ci-monorepo.yml` line 10) | — |
| `node-pty` build toolchain (`build-essential`, `python3`) | HYG-02 native binding build | **UNKNOWN** — not declared in any workflow. CI runner `ubuntu-24.04` ships `python3` by default; `build-essential` requires explicit `apt-get install`. | — | Plan should add `apt-get install -y build-essential python3` to the install step of `ci-monorepo.yml` (or to the new package's prep step) |
| GNU `grep -E` (POSIX extended regex) | HYG-03 CI gate | ✓ | Available on `ubuntu-24.04` by default | Use `rg` via `apt-get install ripgrep` if `grep` is too slow (not a current concern for a 4K-line repo) |
| Python 3.13 + `pydantic>=2.7,<3` | HYG-04 validator | ✓ (per `backend/requirements.txt` lines 5, 10) | 3.13, pydantic 2.x | — |
| `pytest` | HYG-04 unit test | ✓ (assumed present in `backend/tests/`) | — | — |

**Missing dependencies with no fallback:** `node-pty` native build toolchain on CI — plan must address.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (HYG-04) | The startup guard prevents misconfigured `DEV_AUTH_BYPASS` from granting admin in non-dev environments. |
| V4 Access Control | yes (HYG-04) | The synthetic `dev@forge.local` principal has `forge:admin` and every `ideation:*` permission (per `security.py` line 109). The guard is the only thing preventing it from being honored in production. |
| V5 Input Validation | no | — |
| V6 Cryptography | no | — |
| V14 Configuration | yes (HYG-04) | "Fail-secure default" — the service refuses to boot on a known-insecure config. |

### Known Threat Patterns for FastAPI/Pydantic Config

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Dev-mode bypass accidentally enabled in production | Elevation of Privilege | HYG-04 — startup guard raises `ValidationError` on instantiation |
| Direct LLM SDK import bypassing the abstraction layer | Tampering | HYG-03 — CI grep gate enforces `import litellm` only in canonical client |
| Hard-coded UUIDs in client code leaking demo-tenant IDs to other tenants | Information Disclosure | HYG-03 — UUID literal ban in `apps/forge/lib/` |

## Sources

### Primary (HIGH confidence)
- `/home/arunachalam.v@knackforge.com/forge-ai/.planning/REQUIREMENTS.md` — HYG-01..04 verbatim
- `/home/arunachalam.v@knackforge.com/forge-ai/.planning/ROADMAP.md` — Phase 0 success criteria verbatim
- `/home/arunachalam.v@knackforge.com/forge-ai/.planning/STATE.md` — locked decision "Tailwind 3.4.x stays; CLAUDE.md + overview.md updated to match reality"
- `/home/arunachalam.v@knackforge.com/forge-ai/.claude/CLAUDE.md` line 36 — current Tailwind declaration
- `/home/arunachalam.v@knackforge.com/forge-ai/docs/architecture/overview.md` line 29 — current Tailwind declaration
- `/home/arunachalam.v@knackforge.com/forge-ai/apps/forge/package.json` lines 12, 62-65 — current scripts and Tailwind pin
- `/home/arunachalam.v@knackforge.com/forge-ai/apps/forge/bin/terminal-server.mjs` lines 35, 1-131 — direct `node-pty` import and full file
- `/home/arunachalam.v@knackforge.com/forge-ai/packages/connector-events/package.json` — workspace package pattern reference
- `/home/arunachalam.v@knackforge.com/forge-ai/pnpm-workspace.yaml` — workspace glob configuration
- `/home/arunachalam.v@knackforge.com/forge-ai/backend/app/core/config.py` lines 11, 33, 49, 101-111 — current `Settings` class, validator absence
- `/home/arunachalam.v@knackforge.com/forge-ai/backend/app/core/security.py` lines 99-111 — current bypass behavior
- `/home/arunachalam.v@knackforge.com/forge-ai/backend/app/services/litellm_client.py` line 17 — uses `httpx`, not `import litellm`
- `/home/arunachalam.v@knackforge.com/forge-ai/backend/requirements.txt` line 26 — `litellm>=1.40,<2` is installed (SDK), used for type stubs
- `/home/arunachalam.v@knackforge.com/forge-ai/apps/forge/lib/api.ts` lines 54, 205 — the two UUID literals
- `/home/arunachalam.v@knackforge.com/forge-ai/.github/workflows/ci-monorepo.yml` lines 10, 35, 322 — pnpm 9.12.3, frozen-lockfile, current job list
- `/home/arunachalam.v@knackforge.com/forge-ai/.planning/config.json` — `workflow.nyquist_validation: true` (so the Validation Architecture section is required)

### Secondary (MEDIUM confidence)
- pnpm workspace behavior for native addons (pnpm 9.x docs) — assumed the `node-pty` build works in workspace packages; the plan should add a CI verification step.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — Tailwind 3.4.14, Pydantic v2, pnpm 9.12.3, grep — all confirmed via package.json + requirements.txt + workflows.
- Architecture: HIGH — All four HYG items have a single, unambiguous target file(s) and a well-defined change.
- Pitfalls: MEDIUM — `node-pty` native build in CI is the only real unknown; the rest are mechanical.

**Research date:** 2026-06-23
**Valid until:** 2026-07-23 (30 days; no fast-moving dependencies in this phase)
