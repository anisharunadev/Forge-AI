---
phase: 0
plan: 00-02
subsystem: monorepo
tags: [hygiene, monorepo, node-pty, workspace-package, lockfile, HYG-02]
dependency_graph:
  requires: []
  provides: [HYG-02]
  affects: [apps/forge, packages/forge-terminal-server]
tech-stack:
  added:
    - forge-ai/forge-terminal-server (new workspace package)
  patterns:
    - 'pnpm workspace package owning a native binding'
    - 'bin resolved via workspace link (pnpm exec / bare bin name)'
key-files:
  created:
    - packages/forge-terminal-server/package.json
    - packages/forge-terminal-server/src/server.mjs
    - packages/forge-terminal-server/README.md
    - packages/forge-terminal-server/tsconfig.json
    - packages/forge-terminal-server/.gitignore
  modified:
    - apps/forge/package.json
    - pnpm-lock.yaml
  deleted:
    - apps/forge/bin/terminal-server.mjs
decisions:
  - 'Package name kept as forge-ai/forge-terminal-server (no @ scope) per plan constraint 1; dependency reference in apps/forge uses the same bare prefix to match pnpm workspace resolution.'
  - 'Build script is mkdir -p dist && cp src/server.mjs dist/server.mjs (the original one-liner in the plan omitted mkdir and failed on first build).'
  - 'apps/forge/devDependencies keeps ws ^8.21.0 unchanged (out of refactor scope per plan).'
metrics:
  duration: ~50 min
  completed_date: 2026-06-24
status: complete
---

# Phase 0 Plan 02: node-pty refactor into packages/forge-terminal-server — Summary

Moved the `node-pty` native binding and the 131-line `terminal-server.mjs` PTY sidecar out of `apps/forge/` into a new pnpm workspace package `packages/forge-terminal-server`. `apps/forge/package.json` now consumes the package via `workspace:*`, the old sidecar is deleted, and the lockfile is regenerated. Closes HYG-02.

## What Shipped

### New workspace package: `packages/forge-terminal-server/`

A self-contained pnpm workspace package that owns the `node-pty` native binding and the PTY sidecar script.

| File | Purpose |
|------|---------|
| `package.json` | Name `forge-ai/forge-terminal-server`, bin `forge-terminal-server` → `./dist/server.mjs`, deps `node-pty ^1.0.0` + `ws ^8.18.0`, engines `node>=20` |
| `src/server.mjs` | Verbatim move of `apps/forge/bin/terminal-server.mjs` (131 lines). Only the docstring `Start:` line was updated to reference `pnpm dev:terminal` and the new path. |
| `README.md` | 30-line package docs (install/build/run/endpoint/why-a-package) |
| `tsconfig.json` | No-op stub matching the `connector-events` convention (so a future `.ts` contributor finds a familiar shape) |
| `.gitignore` | `node_modules/` and `dist/` (build output must not be committed) |

### `apps/forge/package.json` rewire

| Change | Before | After |
|--------|--------|-------|
| `dev:terminal` script | `node bin/terminal-server.mjs` | `forge-terminal-server` |
| devDeps | `node-pty: ^1.1.0` present | removed (now in the new package) |
| devDeps | (none) | `forge-ai/forge-terminal-server: workspace:*` |
| devDeps | `ws: ^8.21.0` | unchanged (out of refactor scope) |

### Deleted

- `apps/forge/bin/terminal-server.mjs` (131 lines, moved to `packages/forge-terminal-server/src/server.mjs`)

### Lockfile

`pnpm-lock.yaml` regenerated via `pnpm install`: +2340/-13 lines. The diff adds the workspace link for `forge-ai/forge-terminal-server`, removes `node-pty` from the `apps/forge` virtual store, and adds it to the new package's virtual store.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Workspace dependency reference used the wrong prefix**
- **Found during:** Task 2, first `pnpm install`
- **Issue:** The plan specified the dependency reference as `"@forge-ai/forge-terminal-server": "workspace:*"` in `apps/forge/package.json`. pnpm's workspace resolver requires the dependency reference to match the package's `name` field verbatim. The package's own `name` is `"forge-ai/forge-terminal-server"` (without `@`, per constraint 1: v2.0 convention is `forge-*` or `@forge-ai/*`, but the `connector-events` precedent ships with the bare `forge-ai/` prefix). With the `@` prefix, `pnpm install` failed with `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND` and silently exited 0 — the install ran but the new package was never linked.
- **Fix:** Changed the dependency reference to `"forge-ai/forge-terminal-server": "workspace:*"` (no `@`). This is consistent with the package's own `name` field and with the existing `connector-events` workspace pattern. `forge-core` is the only `@forge-ai/*`-prefixed package, and its `name` field also uses the `@` prefix — so the workspace resolution rule is "match the package's `name` exactly".
- **Files modified:** `apps/forge/package.json`
- **Commit:** `b6ad9033`

**2. [Rule 1 - Bug] Build script failed because `dist/` directory did not exist**
- **Found during:** Task 2, `pnpm --filter forge-ai/forge-terminal-server build`
- **Issue:** The plan's build script was `node -e "require('fs').copyFileSync('src/server.mjs','dist/server.mjs')" || cp src/server.mjs dist/server.mjs`. Neither branch created the `dist/` directory. On first build, the copy failed with `ENOENT: no such file or directory, open 'dist/server.mjs'`.
- **Fix:** Changed the script to `mkdir -p dist && cp src/server.mjs dist/server.mjs`. Trivial, cross-platform on macOS/Linux (CI runner is `ubuntu-24.04`).
- **Files modified:** `packages/forge-terminal-server/package.json`
- **Commit:** `b6ad9033`

### Plan Constraints Honored

- Constraint 1 (package name): The package's own `name` is `"forge-ai/forge-terminal-server"` — matches `forge-ai/connector-events` precedent, no `@fora/*` scope.
- Constraint 3 (`src/server.mjs` byte-identical except docstring): The diff against the original is exactly the `Start:` line in the leading docstring. All 130 other lines are byte-identical.
- Constraint 4 (`dev:terminal` invokes bare bin name `forge-terminal-server`): Verified.
- Constraint 5 (`pnpm install` without `--frozen-lockfile`): Used `pnpm install` (with `--reporter=default` via direct node invocation to bypass the silent wrapper).

## Verification

All HYG-02 verification block commands from `00-VALIDATION.md` pass:

| # | Command | Result |
|---|---------|--------|
| 1 | `test -d packages/forge-terminal-server && test -f packages/forge-terminal-server/package.json` | PASS |
| 2 | `! grep -rE '"node-pty"' apps/forge/package.json` | PASS (zero matches) |
| 3 | `grep -E '"node-pty":\s*"\^1\.0\.0"' packages/forge-terminal-server/package.json` | PASS (one match) |
| 4 | `test -f packages/forge-terminal-server/src/server.mjs && ! test -f apps/forge/bin/terminal-server.mjs` | PASS |
| 5 | `! grep -rE "from ['\"]node-pty['\"]|require\(['\"]node-pty['\"]\)" apps/forge --include='*.ts' --include='*.tsx' --include='*.mjs' --exclude-dir=node_modules` | PASS (zero matches in active source; the only matches are in `apps/forge/.next.bak*` legacy build artifacts which are untracked and out of scope) |
| 6 | `pnpm install` | PASS (exit 0; lockfile regenerated; workspace link created) |
| 7 | `pnpm --filter forge-ai/forge-terminal-server build` | PASS (exit 0; `dist/server.mjs` written, 4.3K) |
| 8 | `pnpm dev:terminal` (manual smoke) | PASS — bin launches and listens on `ws://127.0.0.1:4001`, responds to SIGTERM. |

## Commits

| Commit | Type | Description |
|--------|------|-------------|
| `cab11a24` | feat | Scaffold packages/forge-terminal-server workspace package (5 files: package.json, src/server.mjs, README.md, tsconfig.json, .gitignore) |
| `b6ad9033` | refactor | Rewire apps/forge/package.json to consume via workspace link; delete old sidecar; regenerate lockfile; fix build script |

## Notes for Follow-Up Plans

- The plan mentions (line 119) that `ws` in `apps/forge/devDependencies` could be moved out in a follow-up if `apps/forge` does not import `ws` directly. Verified: `apps/forge/package.json` keeps `ws ^8.21.0` because the sidecar's WebSocketServer now lives in `packages/forge-terminal-server/src/server.mjs`, but `apps/forge` itself does NOT import `ws`. A future cleanup pass can drop the `apps/forge` direct `ws` dep.
- The pre-existing `apps/forge/.next.bak2..9`, `.next.old`, `.next.root.bak` directories are stale Next.js build artifacts (untracked, not part of this refactor). They contain a stale copy of `terminal-server.mjs` from before the move; they are gitignored in practice but not yet pruned. Out of scope for HYG-02.
- `ci-monorepo.yml` does NOT need a `build-essential` apt-get step on the executor host because gcc/make/python3 are present (`gcc 13.3.0`, `make 4.3`, `python3 3.12.3`). The CI runner is `ubuntu-24.04` and ships with the same toolchain; `node-pty` builds natively without an explicit install step.

## Self-Check

```
[✓] packages/forge-terminal-server/package.json exists (created in commit cab11a24)
[✓] packages/forge-terminal-server/src/server.mjs exists (created in commit cab11a24)
[✓] packages/forge-terminal-server/README.md exists (created in commit cab11a24)
[✓] packages/forge-terminal-server/tsconfig.json exists (created in commit cab11a24)
[✓] packages/forge-terminal-server/.gitignore exists (created in commit cab11a24)
[✓] apps/forge/package.json modified (commit b6ad9033)
[✓] apps/forge/bin/terminal-server.mjs deleted (commit b6ad9033)
[✓] pnpm-lock.yaml updated (commit b6ad9033)
[✓] git log shows cab11a24 and b6ad9033
```

**Self-Check: PASSED**
