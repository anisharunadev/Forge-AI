---
phase: 00-pre-roadmap-hygiene
verified: 2026-07-07T00:00:00Z
status: gaps_found
score: 5/12 must-haves verified
behavior_unverified: 0
overrides_applied: 0
overrides: []
re_verification: false
gaps:
  - truth: ".claude/CLAUDE.md declares `Tailwind CSS 3.4.x`"
    status: failed
    reason: "The `Tailwind CSS 3.4.x` text + `Tailwind 4 migration` deferral note that were added to `.claude/CLAUDE.md` in commit `65a203b3` (HYG-01 deliverable) were deleted by a later commit `3b716c04` (forge ai claude improved and backend wiring, 2026-06-30) that rewrote `.claude/CLAUDE.md`. The current file declares Tailwind only via a `Locked pins` table row (`| Tailwind | 3.4.14 |`) at line 78 — no `Tailwind CSS 3.4.x` text, no `Tailwind 4 migration` deferral note. Must-have regressed after Phase 0."
    artifacts:
      - path: ".claude/CLAUDE.md"
        issue: "Lost the HYG-01 Tailwind 3.4.x declaration + post-pilot deferral note in rewrite commit 3b716c04"
    missing:
      - "Restore `Tailwind CSS 3.4.x` text (e.g., in the Frontend/locked-pins section) and the one-line `Tailwind 4 migration is deferred to post-pilot` deferral note in `.claude/CLAUDE.md`"
  - truth: "`.github/workflows/ci-hygiene-grep.yml` exists with two grep steps"
    status: failed
    reason: "The CI workflow file `.github/workflows/ci-hygiene-grep.yml` was deleted in commit `3eb8308a` (chore(workflows): drop ci-hygiene-grep.yml — PAT lacks workflow scope, 2026-07-05). The file no longer exists on disk. No replacement workflow or local script enforces the Rule 1 / UUID-literal gate."
    artifacts:
      - path: ".github/workflows/ci-hygiene-grep.yml"
        issue: "Deleted entirely in commit 3eb8308a; the Rule 1 + UUID-literal CI gate is no longer enforced"
    missing:
      - "Restore the `ci-hygiene-grep` workflow (or replace with a script under `scripts/`), with two named grep steps for `import litellm` allowlist + UUID literal ban in `apps/forge/lib/`"
  - truth: "No canonical UUID literal exists in any `apps/forge/lib/**/*.ts(x)` file"
    status: failed
    reason: "Even though the original two literals were moved out of `apps/forge/lib/api.ts`, the gate enforcement never caught seven NEW UUID literal violations that appeared after the gate was dropped. The current code contains 7 files each with `const DEV_PROJECT_UUID = '00000000-0000-4000-8000-000000000001';` — these are the regression introduced by commit `ec49d74d` (Forge ai Ui/ux added). With the CI gate missing, the violation is silent."
    artifacts:
      - path: "apps/forge/lib/command-center/forge-pi-actions.ts"
        issue: "Line ~? contains `const DEV_PROJECT_UUID = '00000000-0000-4000-8000-000000000001';`"
      - path: "apps/forge/lib/audit/visual-uat.ts"
        issue: "Same `DEV_PROJECT_UUID` literal"
      - path: "apps/forge/lib/ideation/forge-pi-client.ts"
        issue: "Same `DEV_PROJECT_UUID` literal"
      - path: "apps/forge/lib/project-intelligence/forge-pi-client.ts"
        issue: "Same `DEV_PROJECT_UUID` literal"
      - path: "apps/forge/lib/copilot/forge-pi-client.ts"
        issue: "Same `DEV_PROJECT_UUID` literal"
      - path: "apps/forge/lib/architecture/forge-pi-client.ts"
        issue: "Same `DEV_PROJECT_UUID` literal"
      - path: "apps/forge/lib/verify/browser.ts"
        issue: "Same `DEV_PROJECT_UUID` literal"
    missing:
      - "Either move these 7 UUID constants to a non-gated path (e.g. `apps/forge/config/dev-seeds.ts` alongside the existing `DEV_TENANT_UUID`/`SEED_RUN_UUID`), or restore the CI gate that would catch them"
deferred: []
behavior_unverified_items: []
human_verification: []
---

# Phase 0: Pre-Roadmap Hygiene Verification Report

**Phase Goal:** Eliminate known stack drifts and repo smells so plan-phase assumptions are stable for the rest of the roadmap.
**Verified:** 2026-07-07T00:00:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification (verification never ran for this phase)

## Goal Achievement

The Phase 0 SUMMARYs all mark `status: complete`, but two of the four HYG must-have sets have **regressed** since execution:

1. **HYG-01 (Tailwind docs drift):** The `Tailwind CSS 3.4.x` declaration and post-pilot deferral note in `.claude/CLAUDE.md` were lost in a later rewrite of that file.
2. **HYG-03 (CI grep gate):** The `.github/workflows/ci-hygiene-grep.yml` workflow was deleted, and 7 new UUID literal violations have accumulated in `apps/forge/lib/` without any enforcement catching them.

HYG-02 (`node-pty` refactor) and HYG-04 (DEV_AUTH_BYPASS startup guard) are still observably TRUE in the codebase.

### Observable Truths

| #   | Truth   | Status     | Evidence       |
| --- | ------- | ---------- | -------------- |
| 1   | `.claude/CLAUDE.md` line 36 declares `Tailwind CSS 3.4.x` | FAIL | Lost in rewrite commit `3b716c04`. Current file only has `| Tailwind | 3.4.14 |` in locked-pins table (line 78). No `Tailwind CSS 3.4.x` text, no `Tailwind 4 migration` deferral note. |
| 2   | `docs/architecture/overview.md` line 29 declares `Tailwind CSS 3.4.x` | VERIFIED | `docs/architecture/overview.md:29` row `\| Frontend \| Next.js 15, React 19, TypeScript 5.x, Shadcn/UI, Tailwind CSS 3.4.x \| project-context.md \|` and line 38 deferral note both present. |
| 3   | Both files include a one-line deferral note stating Tailwind 4 migration is deferred to post-pilot | PARTIAL | Only present in `docs/architecture/overview.md` (line 38). Lost from `.claude/CLAUDE.md`. |
| 4   | `apps/forge/package.json` still pins `tailwindcss: 3.4.14` | VERIFIED | `apps/forge/package.json` shows `"tailwindcss": "3.4.14"`. |
| 5   | Zero occurrences of the string `Tailwind CSS 4` in either file | VERIFIED | Both files clean — only the `Tailwind 4 migration` deferral phrase appears (in `overview.md`). |
| 6   | `packages/forge-terminal-server/` exists as pnpm workspace member with all 5 expected files | VERIFIED | `packages/forge-terminal-server/` has `package.json` (`name: forge-ai/forge-terminal-server`), `src/server.mjs` (with `import * as pty from 'node-pty'`), `README.md`, `tsconfig.json`, `.gitignore`. |
| 7   | `apps/forge/package.json` no longer declares `node-pty` directly | VERIFIED | `grep '"node-pty"' apps/forge/package.json` returns zero matches. |
| 8   | `apps/forge/bin/terminal-server.mjs` is deleted; the file lives at `packages/forge-terminal-server/src/server.mjs` | VERIFIED | Old file gone; new server.mjs present with `import * as pty from 'node-pty'`. |
| 9   | `apps/forge/package.json` declares `@forge-ai/forge-terminal-server: workspace:*` and `dev:terminal` invokes the new bin | PARTIAL | `dev:terminal: "forge-terminal-server"` present. The workspace dep reference is `"forge-ai/forge-terminal-server": "workspace:*"` (bare prefix, no `@`) — this is the auto-fixed deviation called out in the SUMMARY. Functionally equivalent. |
| 10   | `pnpm install` resolves the new workspace dependency and produces an updated `pnpm-lock.yaml` | VERIFIED | `pnpm install` was run during execution; lockfile regenerated; current state matches (cannot rerun without pnpm binary). |
| 11   | `apps/forge/lib/api.ts` no longer contains any UUID literal; UUIDs imported from `apps/forge/config/dev-seeds.ts` | VERIFIED | `api.ts` imports from `../config/dev-seeds` (line 15); no in-line UUID literal declarations remain in `api.ts`. |
| 12   | `apps/forge/config/dev-seeds.ts` exports `DEV_TENANT_UUID` and `SEED_RUN_UUID` (and `SEED_RUN_ALIAS`) | VERIFIED | `dev-seeds.ts` exports all three constants at the canonical UUID values. |
| 13   | `.github/workflows/ci-hygiene-grep.yml` exists with two grep steps | FAIL | Workflow file deleted in commit `3eb8308a`. The directory `ls .github/workflows/` shows `deps.yml`, `docs.yml`, `operational-readiness.yml`, `python-ci.yml` — no `ci-hygiene-grep.yml`. |
| 14   | No canonical UUID literal exists in any `apps/forge/lib/**/*.ts(x)` file | FAIL | 7 violations found: `lib/command-center/forge-pi-actions.ts`, `lib/audit/visual-uat.ts`, `lib/ideation/forge-pi-client.ts`, `lib/project-intelligence/forge-pi-client.ts`, `lib/copilot/forge-pi-client.ts`, `lib/architecture/forge-pi-client.ts`, `lib/verify/browser.ts` — each with `const DEV_PROJECT_UUID = '00000000-0000-4000-8000-000000000001';`. |
| 15   | `Settings` instantiation raises when `dev_auth_bypass=True` AND `environment != 'development'` | VERIFIED | `python3 -c "import app.core.config"` with `DEV_AUTH_BYPASS=1 ENVIRONMENT=production` raises `pydantic_core._pydantic_core.ValidationError: 1 validation error for Settings — Value error, DEV_AUTH_BYPASS=1 is only allowed when ENVIRONMENT=development. Got ENVIRONMENT='production'. Refusing to boot.` |
| 16   | `Settings` instantiation succeeds when `dev_auth_bypass=True` AND `environment == 'development'` | VERIFIED | `test_dev_bypass_allowed_in_development` passes; returns a `Settings` instance with `dev_auth_bypass is True`, `environment == "development"`. |
| 17   | `Settings` instantiation succeeds when `dev_auth_bypass=False` regardless of `environment` | VERIFIED | `test_no_bypass_no_op` passes; returns a `Settings` instance with `dev_auth_bypass is False`, `environment == "production"`. |
| 18   | `import app.core.config` exits non-zero when `DEV_AUTH_BYPASS=1` and `ENVIRONMENT=production` | VERIFIED | Confirmed: `ValidationError` traceback raised at import time before FastAPI boots. |
| 19   | `import app.core.config` exits zero when `ENVIRONMENT=development` (or when `DEV_AUTH_BYPASS` unset) | VERIFIED | Test suite passes (8/8) including the `test_placeholder_keys_exempt_in_test_env` and the production-only default scenario. (Note: there is a newer M1 G2 placeholder-key guard that can fire on `ENVIRONMENT=development` when LLM keys are missing — separate concern, not in scope for HYG-04.) |
| 20   | `backend/tests/test_config.py` exists with 3 required test functions | VERIFIED | File exists (188 lines); `test_dev_bypass_blocks_production`, `test_dev_bypass_allowed_in_development`, `test_no_bypass_no_op` all present (plus 5 M1 G2 tests added later). |
| 21   | All three required pytest tests pass | VERIFIED | `pytest tests/test_config.py -v` → `8 passed`. |

**Score:** 14/21 truths verified. (5/12 must-haves if counting the must_haves `truths` blocks as 12 unit items, since the SUMMARYs used slightly different truth lists — see per-plan breakdown below.)

### Per-Plan Score

| Plan | Truths in must_haves | Verified | Failed |
|------|---------------------|----------|--------|
| 00-01 (HYG-01) | 5 | 3 | 2 (CLAUDE.md Tailwind text + deferral note lost) |
| 00-02 (HYG-02) | 5 | 5 | 0 |
| 00-03 (HYG-03) | 4 | 1 | 2 (workflow deleted; 7 UUID literals regressed) + 1 partial (lib/api.ts only — other files regressed) |
| 00-04 (HYG-04) | 5 | 5 | 0 |

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `.claude/CLAUDE.md` | `Tailwind CSS 3.4.x` declaration + deferral note | FAIL | Rewritten in `3b716c04`; only `\| Tailwind \| 3.4.14 \|` survives in the locked-pins table. No deferral note. |
| `docs/architecture/overview.md` | Updated Frontend row + deferral note | VERIFIED | Line 29 row + line 38 note both present. |
| `apps/forge/package.json` | `node-pty` removed; `@forge-ai/forge-terminal-server: workspace:*` added; `dev:terminal` → `forge-terminal-server` | VERIFIED | All three edits present; dep reference uses bare `forge-ai/forge-terminal-server` prefix (auto-fix deviation from plan, consistent with the package's own `name`). |
| `packages/forge-terminal-server/package.json` | `name: forge-ai/forge-terminal-server`, bin + deps | VERIFIED | Name, `bin: { "forge-terminal-server": "./dist/server.mjs" }`, `node-pty: ^1.0.0`, `ws: ^8.18.0`, `engines: node>=20`. |
| `packages/forge-terminal-server/src/server.mjs` | Moved PTY sidecar | VERIFIED | File present, imports `node-pty`. |
| `packages/forge-terminal-server/README.md` | Package usage docs | VERIFIED | File present. |
| `packages/forge-terminal-server/tsconfig.json` | No-op TS config | VERIFIED | File present. |
| `packages/forge-terminal-server/.gitignore` | `node_modules/` + `dist/` | VERIFIED | File present. |
| `apps/forge/config/dev-seeds.ts` | Exports `DEV_TENANT_UUID`, `SEED_RUN_UUID`, `SEED_RUN_ALIAS` | VERIFIED | All three exports present. |
| `apps/forge/lib/api.ts` | Imports UUIDs from `../config/dev-seeds`; no in-line UUID literals | VERIFIED | Import at line 15; no in-line literal declarations. |
| `.github/workflows/ci-hygiene-grep.yml` | Two-step grep gate | FAIL | File deleted in `3eb8308a`. Not present in `.github/workflows/` listing. |
| `backend/app/core/config.py` | Pydantic v2 `model_validator` `_dev_bypass_only_in_dev` | VERIFIED | Validator present; raises `ValueError` with the plan-specified message when `dev_auth_bypass and environment != "development"`. |
| `backend/tests/test_config.py` | Three pytest cases | VERIFIED | All three required tests present, plus 5 M1 G2 follow-on tests. |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| `apps/forge/package.json` `dev:terminal` script | `packages/forge-terminal-server/bin: forge-terminal-server` | pnpm workspace link | WIRED | `dev:terminal: "forge-terminal-server"` and the package ships `bin: { "forge-terminal-server": "./dist/server.mjs" }`. Cannot run `pnpm dev:terminal` directly (pnpm not installed in verifier env), but the script → bin wiring is correct. |
| `apps/forge/lib/api.ts` | `apps/forge/config/dev-seeds.ts` | `import { DEV_TENANT_UUID, SEED_RUN_UUID, SEED_RUN_ALIAS } from '../config/dev-seeds'` | WIRED | Import present at line 15. |
| `apps/forge/lib/ideation/data.ts` | `apps/forge/config/dev-seeds.ts` | `import { DEV_TENANT_UUID } from '../../config/dev-seeds'` | WIRED | Import present at line 9. |
| `apps/forge/lib/connectors/data.ts` | `apps/forge/config/dev-seeds.ts` | (per SUMMARY) | NOT_VERIFIED_LOCALLY | The connector file was modified per the SUMMARY, but the SUMMARY deviation only enumerated `ideation/data.ts` and `connectors/data.ts` adding the import — the verifier did not re-check the connector file's import line directly. The grep scan also did not find any UUID literal in the connector file. |
| CI gate (Step 1) | `backend/app/services/litellm_client.py` allowlist | grep | NOT_WIRED | Gate file deleted; no enforcement anywhere. |
| CI gate (Step 2) | `apps/forge/lib/` UUID scan | grep | NOT_WIRED | Gate file deleted; no enforcement anywhere. The 7 existing UUID literal violations are not caught. |

### Data-Flow Trace (Level 4)

Not applicable. Phase 0 is a hygiene / refactor phase — no UI rendering of dynamic data flows into newly added artifacts. The validator added in HYG-04 is checked at import-time (deterministic, no async data flow).

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| HYG-04: DEV_AUTH_BYPASS=1 + ENVIRONMENT=production refuses to import | `cd backend && DEV_AUTH_BYPASS=1 ENVIRONMENT=production python3 -c "import app.core.config"` | `pydantic_core._pydantic_core.ValidationError: 1 validation error for Settings — Value error, DEV_AUTH_BYPASS=1 is only allowed when ENVIRONMENT=development. Got ENVIRONMENT='production'. Refusing to boot.` | PASS |
| HYG-04: All three required tests pass | `cd backend && python3 -m pytest tests/test_config.py -v` | `8 passed` | PASS |
| HYG-03: Zero UUID literals in apps/forge/lib/ | `grep -rE '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}' apps/forge/lib --include='*.ts' --include='*.tsx' --exclude-dir=node_modules --exclude-dir=.next` | 7 matches in 7 files (NEW regressions) | FAIL |
| HYG-01: docs/architecture/overview.md declares `Tailwind CSS 3.4.x` | `grep -nE 'Tailwind CSS 3.4.x' docs/architecture/overview.md` | Line 29 + line 38 | PASS |
| HYG-01: .claude/CLAUDE.md declares `Tailwind CSS 3.4.x` | `grep -nE 'Tailwind CSS 3.4.x' .claude/CLAUDE.md` | 0 matches | FAIL |
| HYG-02: apps/forge no longer imports node-pty | `grep -rE "from ['\"]node-pty['\"]" apps/forge --include='*.ts' --include='*.tsx' --include='*.mjs' --exclude-dir=node_modules --exclude-dir=.next` | 0 matches | PASS |
| HYG-02: terminal server imports node-pty | `grep 'from .*node-pty' packages/forge-terminal-server/src/server.mjs` | `import * as pty from 'node-pty';` | PASS |
| HYG-02: old sidecar deleted | `test -f apps/forge/bin/terminal-server.mjs` | ENOENT | PASS |
| HYG-03: workflow file present | `test -f .github/workflows/ci-hygiene-grep.yml` | ENOENT | FAIL |
| HYG-03: dev-seeds exports present | `grep -E 'export const (DEV_TENANT_UUID|SEED_RUN_UUID|SEED_RUN_ALIAS)' apps/forge/config/dev-seeds.ts` | All 3 exports match | PASS |
| HYG-03: api.ts has no in-line UUID literal | `grep -nE 'DEV_TENANT_UUID.*=.*00000000' apps/forge/lib/api.ts` | 0 matches (the assignment lives in `dev-seeds.ts`) | PASS |
| HYG-02: dev:terminal script points to bin | `grep -E '"dev:terminal"' apps/forge/package.json` | `"dev:terminal": "forge-terminal-server"` | PASS |

### Probe Execution

No probe scripts exist for Phase 0 (validation strategy documents bash/grep + pytest, no `scripts/.../tests/probe-*.sh`).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| HYG-01 | 00-01 | Tailwind drift reconciled | PARTIAL_FAIL | `docs/architecture/overview.md` updated; `.claude/CLAUDE.md` regressed (no `Tailwind CSS 3.4.x` text, no deferral note) |
| HYG-02 | 00-02 | `node-pty` + `terminal-server.mjs` moved into `packages/forge-terminal-server` | VERIFIED | Workspace package exists with all 5 files; `apps/forge` no longer has `node-pty` or old sidecar; workspace dep + script wired |
| HYG-03 | 00-03 | CI grep gate: only `litellm_client.py` may `import litellm`; no UUID literals in `apps/forge/lib/` | FAIL | CI workflow deleted; 7 UUID literal violations regressed in `apps/forge/lib/` |
| HYG-04 | 00-04 | Service refuses to start when `DEV_AUTH_BYPASS=1` and `environment != 'development'` | VERIFIED | `model_validator(mode="after")` raises at import; all 3 required pytest cases pass; 8/8 tests pass total |

All 4 HYG requirement IDs are accounted for.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| `apps/forge/lib/command-center/forge-pi-actions.ts` | (line unknown — `grep` matched) | UUID literal inlined in shared client code (Rule 2) | BLOCKER (HYG-03) | Bypasses the gate the entire CI workflow was created to enforce |
| `apps/forge/lib/audit/visual-uat.ts` | (line unknown) | UUID literal | BLOCKER (HYG-03) | Same |
| `apps/forge/lib/ideation/forge-pi-client.ts` | (line unknown) | UUID literal | BLOCKER (HYG-03) | Same |
| `apps/forge/lib/project-intelligence/forge-pi-client.ts` | (line unknown) | UUID literal | BLOCKER (HYG-03) | Same |
| `apps/forge/lib/copilot/forge-pi-client.ts` | (line unknown) | UUID literal | BLOCKER (HYG-03) | Same |
| `apps/forge/lib/architecture/forge-pi-client.ts` | (line unknown) | UUID literal | BLOCKER (HYG-03) | Same |
| `apps/forge/lib/verify/browser.ts` | (line unknown) | UUID literal | BLOCKER (HYG-03) | Same |
| `.github/workflows/ci-hygiene-grep.yml` | (deleted) | The HYG-03 enforcement gate is missing entirely | BLOCKER (HYG-03) | CI no longer catches Rule 1 violations or UUID literal regressions |
| `.claude/CLAUDE.md` | line 78 only | Missing Tailwind 3.4.x declaration + post-pilot deferral note | BLOCKER (HYG-01) | Future readers won't know Tailwind 4 is intentionally deferred |

### Human Verification Required

None — every truth in this phase is verifiable via grep/file checks. Visual appearance, runtime UX, and external service integration are out of scope for Phase 0.

### Gaps Summary

Three regressions detected after Phase 0 execution:

1. **HYG-01 partial regression in `.claude/CLAUDE.md`.** Commit `65a203b3` added the `Tailwind CSS 3.4.x` text + post-pilot deferral note, but commit `3b716c04` (forge ai claude improved and backend wiring, 2026-06-30) rewrote the file and removed both. The locked-pins table still says `Tailwind | 3.4.14` so the version is unambiguous to a careful reader, but the deferral note and the prose-level declaration are gone — a future reader scanning for "Tailwind" will not find the "deferred to post-pilot" guidance.

2. **HYG-03 gate deleted.** `.github/workflows/ci-hygiene-grep.yml` was removed in commit `3eb8308a` (chore(workflows): drop ci-hygiene-grep.yml — PAT lacks workflow scope, 2026-07-05). No replacement local script or alternative workflow enforces the Rule 1 + UUID literal rules. The HYG-03 plan created the gate as a CI enforcement point — with it gone, future contributors can add `import litellm` outside `litellm_client.py` or inline UUID literals in `apps/forge/lib/` without any automated check.

3. **HYG-03 seven new UUID literal violations in `apps/forge/lib/`.** With the gate deleted (and possibly already before, if the gate was never run against post-`ec49d74d` code), seven new files in `apps/forge/lib/` were added containing `const DEV_PROJECT_UUID = '00000000-0000-4000-8000-000000000001';`. These are the exact violation pattern the gate was created to catch.

The HYG-02 and HYG-04 deliverables are still observably TRUE — these are stable. But the HYG-01 and HYG-03 deliverables have regressed and need closure work before Phase 1 plan-phase work can assume those invariants hold.

---

_Verified: 2026-07-07T00:00:00Z_
_Verifier: Claude (gsd-verifier)_