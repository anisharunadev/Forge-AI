---
plan: 5-03
phase: 5
wave: 3
depends_on: ["5-02"]
files_modified:
  - .planning/REQUIREMENTS.md
  - .planning/STATE.md
  - .planning/ROADMAP.md
  - apps/forge/components/shell/Sidebar.tsx
  - .claude/CLAUDE.md
autonomous: true
requirements: [F-018, Rule-2, Rule-3, Rule-4, Rule-6]
---

<objective>
Close out the custom-workflows workstream: full E2E round-trip verification (real Postgres + real executor + real approvals), security audit on the script sandbox + workflow API authorization, UI audit on the editor + run-history drawer, and documentation updates to `REQUIREMENTS.md`, `STATE.md`, `ROADMAP.md`, and `CLAUDE.md`.

Purpose: PITFALL-1/2/5 closures for F-018 — make sure every audit row is captured, every cross-tenant query is denied, and the editor hits the 6-pillar UI bar. Also: remove the "Backend unreachable — simulated success" stub from `useForgeCommands` (PILOT-02 dependency) by confirming the new `/commands/{name}/run` route replaces it.

Output:
- A passing E2E test (real backend) that walks: editor → save → run → approval pending → decide → run succeeded → re-run → run history shows 2 rows.
- `gsd-secure-phase` report: no high-severity findings on the script sandbox (seccomp verified, RLIMIT verified, audit row per script execution) and on the workflow API (cross-tenant denial, RLS policy enforced).
- `gsd-ui-review` report: editor + drawer + status bar score ≥ 4/6 on the 6-pillar rubric.
- Updated `REQUIREMENTS.md` (F-018 lines), `STATE.md` (Phase 5 complete), `ROADMAP.md` (Phase 5 plans checked), `CLAUDE.md` (Testing Rules — integration vs unit boundary for DAG executors).
- `Sidebar.tsx` updated to surface the new `Custom Workflows` center.
- Verification: every plan's `must_haves` is green; the e2e round-trip in dev passes; `use-forge-commands.ts` no longer has the simulated-success fallback path.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
@$HOME/.claude/gsd-core/workflows/verify-phase.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/REQUIREMENTS.md
@/home/arunachalam.v@claude/plans/jaunty-leaping-hamming.md
@apps/forge/hooks/use-forge-commands.ts
@apps/forge/components/shell/Sidebar.tsx
@apps/forge/components/custom-workflows/
@backend/app/services/workflow_executor.py
@backend/app/services/script_sandbox.py
@backend/app/services/workflow_service.py
@backend/app/api/v1/workflows.py
@.claude/CLAUDE.md
</context>

<must_haves>
truths:
  - "`docker compose up -d backend redis postgres && pnpm --filter forge-dashboard test:e2e -- custom-workflow-roundtrip` passes end-to-end against a real backend"
  - "`gsd-secure-phase 5` produces SECURITY.md with no high-severity findings (seccomp + RLIMIT + audit row + cross-tenant denial all verified)"
  - "`gsd-ui-review 5` produces UI-REVIEW.md with editor + drawer + status bar scoring ≥ 4/6 on the 6-pillar rubric"
  - "`grep -RIn 'Backend unreachable' apps/forge/` returns nothing — the stub is gone"
  - "`require headroom the 'Integration vs unit boundary' note for DAG executors is added to .claude/CLAUDE.md under 'Testing Rules'"
  - "`.planning/STATE.md` shows Phase 5 with 3/3 plans complete and a 'Phase 5 closed' note in the recent-trend section"
  - "`.planning/ROADMAP.md` Phase 5 plans 5-01/5-02/5-03 are all checked off"
  - "`.planning/REQUIREMENTS.md` has a new F-018 section under the v2.0 requirements list (custom workflow builder, DAG executor, script sandbox)"

artifacts:
  - path: .planning/REQUIREMENTS.md
    contains: ["F-018", "Custom Workflows", "DAG executor", "script sandbox"]
  - path: .planning/STATE.md
    contains: ["Phase 5", "5/5", "custom-workflows"]
  - path: .planning/ROADMAP.md
    contains: ["[x] 5-01", "[x] 5-02", "[x] 5-03"]
  - path: .claude/CLAUDE.md
    contains: ["Testing Rules", "DAG executors", "integration vs unit"]
  - path: apps/forge/components/shell/Sidebar.tsx
    contains: ["custom-workflows", "Custom Workflows"]
</must_haves>

<verification>
1. `cd backend && pytest` — full backend suite green.
2. `cd apps/forge && pnpm test && pnpm test:e2e` — frontend unit + Playwright green.
3. `gsd-secure-phase 5` — read SECURITY.md, confirm zero high-severity findings.
4. `gsd-ui-review 5` — read UI-REVIEW.md, confirm editor scores ≥ 4/6 per pillar.
5. `grep -RIn "Backend unreachable" apps/forge/` returns nothing.
6. `git status` clean; all plan SUMMARY.md files exist in `.planning/phases/05-custom-workflows-*/`.
</verification>

<notes>
- The detailed sub-plan is in `/home/arunachalam.v@claude/plans/jaunty-leaping-hamming.md` under "Phase E". Cross-reference; do not duplicate.
- `gsd-secure-phase` is the security-auditor subagent. It cross-references `PLAN.md` threat model + code. Run it BEFORE marking this plan complete.
- `gsd-ui-review` is the ui-auditor subagent (6-pillar rubric: hierarchy, density, color, motion, language, accessibility).
- E2E requires `docker compose up -d` first; if docker is unavailable in the executor's sandbox, fall back to the SQLite-based pytest suite and document the limitation in the SUMMARY.
- The "Backend unreachable" stub is in `apps/forge/hooks/use-forge-commands.ts` per the conversation summary — verify it's actually gone (not just renamed).
</notes>
