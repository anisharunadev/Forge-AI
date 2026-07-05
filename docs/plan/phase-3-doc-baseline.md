# Phase 3 — Documentation Drift Baseline

**Captured:** 2026-07-05 (immediately after Phase 3 implementation)

## Floors (post-Phase-3)

| Detector | Threshold | Floor captured |
|---|---|---|
| `gen-api-catalog.py --check` | 0 routes drifted | 0 (635 routes indexed) |
| `gen-db-schema.py --check` | 0 models drifted | 0 (112 models indexed) |
| `check-goal-status.sh` | 0 missing Status headers | 0 (78 primary docs) |
| `check-goal-reality.sh` | 0 'implemented' goals missing code refs | 0 (0 implemented today) |
| `check-plan-links.sh` | 0 broken cross-links | 0 (22 rows, 8 phases) |
| `check-litellm-matrix.sh` | 0 phantom /api/v1/ paths | 0 (0 §2 /api/v1/ refs) |
| `check-doc-links.sh` | 0 broken markdown links | (gated via continue-on-error in CI) |

## Drift found and fixed by Phase 3

| Detector | Pre-Phase-3 drift | Fix |
|---|---|---|
| `gen-api-catalog.py --check` | doc claimed 305 routes; code has 635 | regenerated |
| `gen-db-schema.py --check` | doc claimed 43 files / ~150 tables; code has 61 files / 112 classes | regenerated |
| `check-goal-status.sh` | 66 goal docs lacked `Status:` header | mass-classified (64 cancelled, 14 in-progress; 3 with non-canonical status fixed) |
| `check-goal-reality.sh` | `step-69.md` claimed "Ready to run" but 4 of 5 endpoints ship (per Phase 2 PR-2.6) | updated to `in-progress` with explanatory note (`/ideation/ingest/status` is optional per the doc itself) |

## Files included in the drift scope

- `backend/app/api/v1/**` — source for `gen-api-catalog.py`.
- `backend/app/db/models/*.py` — source for `gen-db-schema.py`.
- `docs/goals/step-*.md` — input to `check-goal-status.sh` and `check-goal-reality.sh`.
- `docs/plan/README.md` + `docs/plan/phase-N.md` — input to `check-plan-links.sh`.
- `docs/litellm/forge-litellm-integration.md` §2 — input to `check-litellm-matrix.sh`.
- `docs/**/*.md`, `docs-site/**/*.md` — input to `check-doc-links.sh`.

## Verification commands

```bash
bash scripts/check-doc-drift.sh
bash scripts/check-goal-status.sh
bash scripts/check-goal-reality.sh
bash scripts/check-plan-links.sh
bash scripts/check-litellm-matrix.sh
bash scripts/check-doc-links.sh
```

A non-zero exit on any of these is a Phase-3 regression and must be fixed
in the same PR that introduced the drift.
