# Standard: Documentation

> **Status:** ✅ Canonical — every doc follows these rules
> **Doc owner:** Platform team
> **Source of truth:** `scripts/check-doc-drift.sh` + `scripts/check-goal-status.sh` + `scripts/check-goal-reality.sh` + `scripts/check-plan-links.sh` + `scripts/check-litellm-matrix.sh` + `scripts/check-doc-links.sh`

---

## Rules

### D1. Generated docs are auto-generated, not hand-written

Any doc marked `<!-- AUTO-GENERATED. DO NOT EDIT. -->` is regenerated
from code by `./scripts/gen-*.sh`. To change one, edit the generator
and run it; do not edit the file by hand.

**Enforcement:** `scripts/check-doc-drift.sh` runs every `gen-*.sh --check`
in CI and exits 1 on drift.

**Generated files today:**
- `docs/reference/api-catalog.md` — `./scripts/gen-api-catalog.sh`
- `docs/reference/db-schema.md` — `./scripts/gen-db-schema.sh`
- `.claude/CLAUDE.md` Built Features table — `./scripts/generate-built-features.sh`

### D2. Every goal doc has a Status header

Every `docs/goals/step-N.md` (primary, not `-deliverable`/`-v2`/`-rationale`)
MUST have, in the first 10 lines:

```markdown
> **Status:** implemented | in-progress | cancelled
> **Last verified:** YYYY-MM-DD   # required only when 'implemented'
```

Prose synonyms (`Ready to run`, `shipped`, `Complete`) are mapped by
`scripts/check-goal-status.sh`.

**Enforcement:** `scripts/check-goal-status.sh`.

### D3. Every "implemented" goal must reference real code

For every `Status: implemented` goal:
- The doc MUST list `Files:`, `Targets:`, `Routes:`, `Models:`,
  `Endpoints:`, or `Paths:` lines with backtick-quoted paths.
- Each quoted path MUST exist in the repo (file or route).
- The doc MUST reference at least one PR (`#NNNN`) OR a test file
  containing the goal's `step-N` slug.

**Enforcement:** `scripts/check-goal-reality.sh`.

### D4. The master checklist links bidirectionally to phase docs

Every numbered row in `docs/plan/README.md` (rows 1–22) MUST be listed
under "Checklist items owned" in the phase doc that owns it (column 3
of the master table).

**Enforcement:** `scripts/check-plan-links.sh`.

### D5. LiteLLM endpoint matrix names real routes

In `docs/litellm/forge-litellm-integration.md` §2, column 3
("Forge Backend calls"), every `/api/v1/...` path MUST resolve to a
real router in `backend/app/api/v1/`. Paths not starting with
`/api/v1/` are LiteLLM passthroughs and exempt.

**Enforcement:** `scripts/check-litellm-matrix.sh`.

### D6. No broken links in markdown

Every `.md` file under `docs/` and `docs-site/` MUST link only to
resolvable URLs. `lychee` is the scanner; broken-link failures
block merge.

**Enforcement:** `scripts/check-doc-links.sh`.

---

## Adding a new generated doc

1. Write `scripts/gen-<name>.py` (Python, stdlib only) with the
   `--check` / `--dry-run` / no-flag triplet (see
   `scripts/gen-api-catalog.py` for the template).
2. Write `scripts/gen-<name>.sh` wrapper.
3. Add the file to `scripts/check-doc-drift.sh`'s loop.
4. Add the new doc file to `.github/workflows/docs.yml` `paths:`.
5. Update this standard (D1).
