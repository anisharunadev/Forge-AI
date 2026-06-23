---
phase: 0
slug: pre-roadmap-hygiene
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-23
---

# Phase 0 — Pre-Roadmap Hygiene — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 8.x (backend) + bash/grep (CI hygiene gate) + pnpm exec (workspace) |
| **Config file** | `backend/tests/conftest.py` (existing) + `.github/workflows/ci-hygiene-grep.yml` (new) |
| **Quick run command** | `cd backend && pytest -xvs tests/test_config.py` |
| **Full suite command** | `cd backend && pytest -x && bash .github/workflows/ci-hygiene-grep.sh` (or workflow simulation) |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run the per-task automated command from the verification map
- **After every plan wave:** Run the full suite (4 HYG items × 2 verification checks each)
- **Before `/gsd-verify-work`:** All four HYG success criteria must show green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 00-01-01 | 01 | 1 | HYG-01 | — | N/A (docs only) | grep | `grep -E "Tailwind (CSS )?3\.4\.x" .claude/CLAUDE.md docs/architecture/overview.md` | ✅ exists | ⬜ pending |
| 00-01-02 | 01 | 1 | HYG-01 | — | N/A (docs only) | grep | `grep -E "Tailwind (CSS )?4" .claude/CLAUDE.md docs/architecture/overview.md` (expect no output) | ✅ exists | ⬜ pending |
| 00-02-01 | 02 | 2 | HYG-02 | — | N/A (monorepo refactor) | filesystem | `test -d packages/forge-terminal-server && test -f packages/forge-terminal-server/package.json` | ❌ W0 | ⬜ pending |
| 00-02-02 | 02 | 2 | HYG-02 | — | N/A | grep | `grep -rE '"node-pty"' apps/forge/package.json` (expect no output) | ✅ exists | ⬜ pending |
| 00-02-03 | 02 | 2 | HYG-02 | — | N/A | filesystem | `test -f packages/forge-terminal-server/src/server.mjs && ! test -f apps/forge/bin/terminal-server.mjs` | ❌ W0 | ⬜ pending |
| 00-02-04 | 02 | 2 | HYG-02 | — | N/A | grep | `grep -rE "from ['\"]node-pty['\"]" apps/forge --include='*.ts' --include='*.tsx' --include='*.mjs' --exclude-dir=node_modules` (expect no output) | ✅ exists | ⬜ pending |
| 00-03-01 | 03 | 3 | HYG-03 | T-1 (Rule 1 enforcement) | Block `import litellm` outside canonical client | CI workflow | `bash .github/workflows/ci-hygiene-grep.sh` (or simulate) | ❌ W0 | ⬜ pending |
| 00-03-02 | 03 | 3 | HYG-03 | T-2 (UUID leak) | Block UUID literals in `apps/forge/lib/` | CI workflow | Same as above | ❌ W0 | ⬜ pending |
| 00-03-03 | 03 | 3 | HYG-03 | — | Dev-seeds moved to `apps/forge/config/` | grep | `grep -rE '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}' apps/forge/lib` (expect no output) | ✅ exists | ⬜ pending |
| 00-04-01 | 04 | 4 | HYG-04 | T-3 (auth bypass in prod) | Refuse boot when DEV_AUTH_BYPASS=1 and ENVIRONMENT!=development | pytest | `cd backend && DEV_AUTH_BYPASS=1 ENVIRONMENT=production python -c "import app.core.config"` (expect non-zero exit) | ❌ W0 | ⬜ pending |
| 00-04-02 | 04 | 4 | HYG-04 | T-3 | Validator present in code | grep | `grep -E '_dev_bypass_only_in_dev' backend/app/core/config.py` | ✅ exists | ⬜ pending |
| 00-04-03 | 04 | 4 | HYG-04 | T-3 | Guard allows dev | pytest | `cd backend && ENVIRONMENT=development python -c "import app.core.config; print('ok')"` (expect `ok`) | ✅ exists | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/forge-terminal-server/package.json` — new workspace package manifest (Plan 02 W0)
- [ ] `packages/forge-terminal-server/src/server.mjs` — moved terminal server source (Plan 02 W0)
- [ ] `apps/forge/config/dev-seeds.ts` — moved UUID literals (Plan 03 W0)
- [ ] `.github/workflows/ci-hygiene-grep.yml` — new CI hygiene gate (Plan 03 W0)
- [ ] `backend/tests/test_config.py` — new tests for HYG-04 guard (Plan 04 W0)
- [ ] `backend/app/core/config.py` — add Pydantic validator (Plan 04 deliverable, not W0)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `node-pty` native binding builds in CI | HYG-02 | Native build is environment-dependent; CI runner may lack `build-essential` | Run `pnpm install --frozen-lockfile` in CI runner with `build-essential` and `python3` installed; verify `node_modules/.pnpm/node-pty@*/node_modules/node-pty/build/Release/pty.node` exists |
| Workspace link resolves `forge-terminal-server` bin | HYG-02 | pnpm workspace symlinks are runtime-resolved | Run `pnpm --filter @forge-ai/forge-terminal-server build` then `pnpm --filter forge exec forge-terminal-server --help` (or invoke via `dev:stack`); verify it listens on `ws://127.0.0.1:4001` |

*If none: "All phase behaviors have automated verification."*

---

## Validation Sign-Off

- [ ] All tasks have automated verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
