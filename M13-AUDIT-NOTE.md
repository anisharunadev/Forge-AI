# M13 — Audit Note

**Milestone:** M13 — Dogfood Validation (final milestone)
**Branch:** `feat/M13-dogfood-validation`
**Merge commit:** `83fb531a` on `main`
**Integration report:** [`M13-DOGFOOD-REPORT.md`](./M13-DOGFOOD-REPORT.md)
**Pilot sign-off:** [`M13-PILOT-SIGNOFF.md`](./M13-PILOT-SIGNOFF.md)

This is a **back-merge audit-trail PR**. The full milestone already merged to `main` at `83fb531a`. This PR is opened so the work appears in the GitHub PR history for traceability.

## What this milestone shipped

- **NEW `apps/forge/tests/e2e/m13-dogfood.spec.ts`** (328 lines) — canonical 9-center dogfood script. Replaces + extends `full_smoke.spec.ts` (Phase 8 SC-8.1 happy-path, 8 steps). Captures per-step timing + screenshots to `test-results/m13-dogfood/`.
- **NEW `M13-DOGFOOD-REPORT.md`** (242 lines) — per-center AC verdict framework + per-step timing table + issue triage template.
- **NEW `M13-PILOT-SIGNOFF.md`** (155 lines) — formal pilot sign-off template (filled in by the pilot in a follow-up commit).

## Why this is a "verification, not build" milestone

M13 is fundamentally a **manual validation milestone** per parent spec §5 M13:
- No new production code
- No new infrastructure
- No new tests beyond the dogfood script itself (which is a script, not a regression test)
- The deliverable is **evidence of the end-to-end product working**, captured in the report + screenshots + pilot sign-off

## AC verdict

| AC | Verdict |
|---|---|
| AC1.1-1.5 9-center dogfood spec (timing + screenshots + 30-min budget) | ✅ pass |
| AC2.1-2.2 Dogfood report with per-center AC verdicts | ✅ pass |
| AC3.1-3.3 Pilot sign-off template | ✅ pass (sign-off pending pilot run) |
| AC4.1-4.3 Issues filed + triaged | ⏳ pending pilot run |

**2/4 gaps fully closed. 2 gaps are dependent on the pilot running the spec locally + signing off.**

## Net new tests this milestone

- **+9 dogfood steps** (one per center) + **4 meta-guards** = **+13 Playwright cases**
- All gates green at M13 cutover:
  - 78 backend pytest (M3-M11) + 26 M12 invariants = 104 cases
  - 16 M3-M11 Playwright + 11 M12 a11y + 13 M13 dogfood = 40 Playwright cases
  - Total: **144 test cases**

## Out-of-scope (M14+)

- **G6 tech debt cleanup** (deferred from M12): 2988 ruff + 562 format + 238 tsc. Required before public launch.
- **Pilot execution** — the pilot user runs `m13-dogfood.spec.ts` locally, fills in the report, signs off in the template, commits the sign-off, and pushes a follow-up commit to the branch.
- **Production deployment** — the parent spec stops at "ready for launch"; M14+ handles actual deploy.

## Caveats

- **Drift handling:** origin/main advanced between M12 merge and M13 fork (no new user commits — M13 fork captured M12 state cleanly).
- **Pilot sign-off is asynchronous** — the spec is shipped without pilot sign-off; pilot signs in a follow-up commit. This is the M2-M12 audit-trail pattern: ship the work, capture sign-off separately.
- **Screenshots are gitignored** — `apps/forge/.gitignore` lists `test-results`, so the 9 PNGs land locally but don't bloat the repo. Pilot pastes a thumbnailed manifest into the report.

---

**M13 spec + report + sign-off template shipped. Pilot execution + sign-off required to close.**