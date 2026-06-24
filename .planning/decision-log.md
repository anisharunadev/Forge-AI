# Forge AI — Decision Log

This file is the running ledger of architectural decisions resolved
inline during planning. Entries are appended chronologically and
back-reference the originating phase / plan / OQ (Open Question).

---

## Phase 0.7 — Seed & Demo Data (F-821 + F-805)

### Plan B (commit 5) — Bootstrap ↔ Seed wiring + OQ resolutions

Resolved during Plan B implementation; flagged here for confirmation
by Engineering / Product / Finance leads.

| OQ | Resolution | Owner to confirm |
|----|-----------|------------------|
| **OQ-12** demo seats | YES — 1 billing seat per demo tenant (8 users but one seat). | Finance |
| **OQ-13** kn-base re-apply | YES — idempotent re-apply on each tenant creation via F-507 hook; checksum skips unchanged files. | Assumed (Engineering) |
| **OQ-14** name collision | slug uniqueness required; refuse apply if `slug=acme-corp` exists unless `--force` and existing row is `is_demo=true`. | Engineering |
| **OQ-15** reset permissions | YES for `scope=demo_only`; NO for `scope=all` (Steward only). | Product |
| **OQ-16** banner visibility | YES — always visible, `role="status"` (live region), non-dismissible. | UX |
| **OQ-17** v1→v2 path | V2 deferred; manifest reserves `schema_version` for forward-compat. | Engineering |
| **OQ-18** OTel day-one | YES — `init_telemetry()` is first line of CLI (`backend/app/core/telemetry.py:27`). | Confirmed |
| **OQ-19** seed UI access | Steward-only mutations in non-dev/test; standard users may `GET /seeds` (status). | Confirmed |

### Architectural decisions resolved in Plan B

1. **kn-base seed runs AFTER bootstrap commits** — Failure to apply
   `kn-base` must NOT roll back the day-one bootstrap. The hook is
   implemented in
   `backend/app/services/day_one_bootstrap.py::_apply_kn_base_post_commit`
   and is invoked at the end of `load_baseline` after the
   `day_one_bootstrap.completed` audit event. Failures are caught,
   logged, and surfaced via a `seed.bootstrap.skipped` audit event so
   the operator can re-trigger from `/admin/seeds`.

2. **`tenant_context` GUC `app.include_demo`** — Added in Plan A. The
   runner sets `include_demo=True` while applying demo seeds so the
   RLS predicate `(current_setting('app.include_demo', true) = 'on' OR
   is_demo = FALSE)` allows the UPSERT to insert `is_demo=true` rows.
   Production defaults `include_demo=False`; demo seeds must opt in
   via `--allow-in-prod` or `production_safety.allow_in_prod=true`.

3. **`SeedRun` vs `SeedMigration`** — `SeedRun` is the event log
   (one row per invocation); `SeedMigration` is the durable state
   (one row per successful apply version). The drift detector
   compares the stored checksum on the most recent
   `SeedMigration.checksum` to a freshly-computed checksum.

4. **Reference columns stored as `tenant_id` / `project_id`** — All
   seed tables inherit `TenantScopedMixin` (`tenant_id` +
   `project_id` NOT NULL). The flatten convention rewrites
   `<entity>_id_ref` → `<entity>_id` so cross-seed references resolve
   to the natural FK column. Plan D will populate `kn-base`'s
   manifest with concrete data files; Plan E will exercise the
   cross-seed reference resolution.

### Risks tracked forward

- **R-1**: `SeedRun` table grows unbounded. Mitigation: 90-day cleanup
  cron documented in Plan A commit 3 (future work).
- **R-2**: `is_demo=true` rows visible to non-demo tenants if
  `include_demo` GUC leaks. Mitigation: Plan A commit 4 default to
  `False` at connection time; production-grade migration test in
  Plan A commit 3.

### Sign-off checklist

- [ ] Finance confirms OQ-12 (1 seat / demo tenant)
- [ ] Engineering confirms OQ-13 + OQ-14
- [ ] Product confirms OQ-15 (Steward-only `scope=all`)
- [ ] UX confirms OQ-16 (live-region banner)
- [ ] Engineering confirms OQ-17 (forward-compat)
- [ ] Engineering confirms OQ-18 + OQ-19