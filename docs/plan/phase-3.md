# Phase 3 — Documentation as Code

**Status:** PENDING
**Owner:** TBA
**Depends on:** Phase 2 (router reality must match code)
**Blocks:** Phase 5 (SLO doc generation depends on this)

---

## Goal

Documentation that cannot drift from code. The CI fails when a doc claim is contradicted by the codebase.

## Why third

- After Phase 2, the routing surface is canonical. We can now generate docs from it.
- `docs/goals/step-69.md` (per memory) reads greenfield when 4 target files already ship — that's the exact drift class Phase 3 prevents.
- Rule 18 says "documentation is part of the product." Enforce it.

## Success Criteria

| ID | Criterion | Verification |
|----|-----------|--------------|
| SC-3.1 | `docs/reference/api-catalog.md` is **generated** from `backend/app/api/v1/**`, not hand-written | a `scripts/gen-api-catalog.py` exists; running it regenerates the file |
| SC-3.2 | `docs/reference/db-schema.md` is **generated** from SQLAlchemy models | `scripts/gen-db-schema.py` exists; output regenerates |
| SC-3.3 | `scripts/check-doc-drift.sh` compares docs to code, exits 1 on any drift, wired into CI | CI step present, blocks merge |
| SC-3.4 | Every `docs/goals/step-*.md` has a "Status" header with one of: `implemented`, `in-progress`, `cancelled` | `scripts/check-goal-status.sh` exits 0 |
| SC-3.5 | Every "implemented" goal links to PR(s) that landed it | grep finds at least one PR reference per implemented goal |
| SC-3.6 | All 10/10 master checklist items in `docs/plan/README.md` link to a phase doc | visual + script |
| SC-3.7 | Any new endpoint documented in `docs/litellm/forge-litellm-integration.md` exists in `backend/app/api/v1/` (Phase 2 fix prevents new orphans; this catches doc-side drift) | script cross-checks |
| SC-3.8 | `docs-site/` builds clean with no broken links | `pnpm --filter docs-site build` exits 0 |

## Tasks

### T3.1 — API catalog generator
- T3.1.1 Write `scripts/gen-api-catalog.py`:
  - parse every `@router.<method>(path, ...)` in `backend/app/api/v1/**/*.py`
  - extract docstring summary
  - group by router file → emit Markdown table
- T3.1.2 Overwrite `docs/reference/api-catalog.md` with generated content.
- T3.1.3 Verify output matches current code.
- T3.1.4 Add a header in the generated file: `<!-- AUTO-GENERATED. DO NOT EDIT. Regenerate via scripts/gen-api-catalog.py -->`

### T3.2 — DB schema generator
- T3.2.1 Write `scripts/gen-db-schema.py`:
  - import every model from `backend/app/db/models/*.py` (in a subprocess to avoid app boot side-effects)
  - emit per-table Markdown: columns, types, indexes, FKs, composite indexes
- T3.2.2 Overwrite `docs/reference/db-schema.md`.
- T3.2.3 Add the auto-gen header.

### T3.3 — Doc drift detector
- T3.3.1 Write `scripts/check-doc-drift.sh`:
  - re-run T3.1 and T3.2 generators into a temp file
  - `diff` against committed `docs/reference/api-catalog.md` and `db-schema.md`
  - exit 1 on any diff
- T3.3.2 Wire into CI.
- T3.3.3 On failure, output the exact path to fix and the command to regenerate.

### T3.4 — Goal doc status enforcement
- T3.4.1 Write `scripts/check-goal-status.sh`:
  - for each `docs/goals/step-*.md`, require a top-of-file header `# Status: <state>` where state ∈ {implemented, in-progress, cancelled}
  - require a "Last verified: <date>" line for `implemented` goals
- T3.4.2 Wire into CI.
- T3.4.3 For each goal currently without status, the phase lead (TBA) decides and updates.

### T3.5 — Goal ↔ code reality check
- T3.5.1 Write `scripts/check-goal-reality.sh`:
  - parse each goal doc for "Targets:" or "Files:" section listing expected paths
  - assert each path exists
  - for `implemented` goals, additionally assert at least one test file references the goal's primary feature
- T3.5.2 Wire into CI.

### T3.6 — Cross-link enforcement
- T3.6.1 Every checklist item in `docs/plan/README.md` table must link to its phase doc (`./phase-N.md`).
- T3.6.2 Every phase doc must list which checklist items it owns.
- T3.6.3 Write `scripts/check-plan-links.sh` that asserts the bidirectional links exist.
- T3.6.4 Wire into CI.

### T3.7 — Broken-link scanner
- T3.7.1 Use `lychee` (or `markdown-link-check`) over `docs-site/**/*.md` and `docs/**/*.md`.
- T3.7.2 Add to CI: any 4xx/5xx link fails the build.

### T3.8 — Phase doc close-out template
- T3.8.1 Ensure each `phase-*.md` ends with the "Phase Close-out" section (already in Phase 1).
- T3.8.2 `scripts/check-phase-docs.sh` verifies the section exists in every phase.

## Files Touched

| File | Action |
|------|--------|
| `scripts/gen-api-catalog.py` | create |
| `scripts/gen-db-schema.py` | create |
| `scripts/check-doc-drift.sh` | create |
| `scripts/check-goal-status.sh` | create |
| `scripts/check-goal-reality.sh` | create |
| `scripts/check-plan-links.sh` | create |
| `scripts/check-phase-docs.sh` | create |
| `docs/reference/api-catalog.md` | regenerate |
| `docs/reference/db-schema.md` | regenerate |
| `docs/goals/step-*.md` | edit (add status header) |
| `.github/workflows/docs.yml` | create (or extend test.yml) |

## Risks

| Risk | Mitigation |
|------|-----------|
| Generator misses a router due to decorator pattern variation | Manual cross-check against existing `api-catalog.md`; iterate parser until 100% match |
| Generated doc is unreadable (raw dump) | Hand-tune the Markdown template; acceptable trade-off is "ugly but correct" over "pretty but stale" |
| Goal docs that are aspirational (not yet implemented) get blocked | `Status: in-progress` and `cancelled` are valid states; only `implemented` triggers strict path checks |
| Phase doc link enforcement rejects valid plans | Bidirectional check is mechanical; if a real exception exists, document it in `phase-decisions.md` |

## Out of Scope

- Migrating `docs-site/` to a new generator.
- Translating docs.
- Archiving old docs.

## Definition of Done

- Catalog + schema are generated, not hand-written.
- CI fails on drift.
- Every goal doc has a status.
- Every checklist item links to a phase doc.
- No broken links in `docs-site/`.