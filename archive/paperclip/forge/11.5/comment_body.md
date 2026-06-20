## Forge AI-255 — v0.1 contract shipped (Architect verification)

Wake on `issue_blockers_resolved`: the Forge AI-11.4 resolver blocker
(`blockedByIssueIds = [be1c6eef-…]`) is cleared. Architect picked up
the v0.1 contract authored by CTO on 2026-06-18, re-ran the smoke
end-to-end, and verified every AC at the contract level.

### Smoke evidence

- `forge/11.5/_run_smoke.py` — 12 tests / **60 assertions / 60 pass / 0 fail**,
  returncode 0, 2 344.5 ms wall-clock (598 ms in-process test fn
  bodies).
- Evidence JSON: `forge/11.5/evidence/smoke_20260619T211044Z.json`
  (test_runner_sha256 pinned in the file).
- Public API verified against design.md §5: `enqueue_divergence`,
  `list_divergences`, `get_divergence`, `resolve_divergence`,
  `bulk_resolve`, `build_digest_payload`. The schema invariants in
  §2.1 (HLC byte-comparable, `field_path` validated, `resolution`
  enum closed, no NULL resolution, metadata carries §7.1 context)
  are all enforced in the typed seam.

### Acceptance criteria

| AC                                                          | Status                                                                                            |
|-------------------------------------------------------------|---------------------------------------------------------------------------------------------------|
| UI panel renders within 2 s for queues up to 10 k events      | Contract-level: `test_render_budget_10k` asserts `list_divergences < 200 ms` in-process; the `< 2 s` budget is end-to-end including network + React render. **Full UI panel lands in 11.5a.** |
| Resolution writes audit row with both HLCs and the chosen winner | Covered: `test_resolve_writes_audit_row` + `test_resolve_merge_records_winner_by_hlc`             |
| Bulk resolution emits N individual audit rows                | Covered: `test_bulk_emits_n_audit_rows` + `test_bulk_partial_failure_does_not_roll_back`           |
| Daily summary email is opt-out per tenant                    | Covered: `test_digest_opt_out` + `test_digest_normal_day` + `test_digest_action_required_threshold` (1 000 cap, top-5 per-field-path truncation) |
| No silent resolution — every Tier-3 event leaves an audit trail | Covered: `test_no_silent_resolution` (queue row ↔ audit row FK via `resolution_audit_id`)        |
| Designer handoff per Forge AI-7 DocAgent style                    | Covered at the doc level: design.md follows Knowledge Layer §0 conventions (§0 quick start, §9 stage injection, §10 versioning footnote, §11 cross-references). **Designer-facing surfaces land in 11.5a.** |

### What's NOT shipped in v0.1 (deliberate, per design.md §9)

The v0.1 contract covers the typed seam + DDL + audit row + server
endpoint surface + digest payload. The following are explicit
follow-up children, dispatched when Forge AI-11.0 (Architect hire) closes:

- **11.5a — UI surface implementation.** Route `/forge/divergence/:tenant_id`,
  list view (virtualised, 200 rows / scroll), pick/merge buttons,
  bulk-pattern panel, tenant policy table, empty state. Server
  endpoints (§5). Spec: `forge/11.5/UI_SURFACE.md`.
- **11.5b — Daily digest cron + email sender.** §6 of design.md;
  09:00 UTC, per-tenant opt-out, the >1 000 cap, the
  `sync.digest.sent` audit row.
- **11.5c — k6 end-to-end render-budget probe.** Proves AC #1
  end-to-end (the current smoke asserts the in-process sub-budget;
  this proves the React render + network round-trip).

### What's shipped in v0.1

- `forge/11.5/design.md` — 17.9 K contract, v0.1 pinned, §11 cross-refs
  resolve, Knowledge Layer §0 conventions.
- `forge/11.5/CHANGELOG.md` — v0.1 revision log.
- `forge/11.5/migrations/0001_divergence_queue.sql` — §2 Postgres DDL
  (`sync.divergence_queue` + `sync.divergence_bulk_patterns` + per-tenant
  opt-out column + 3 indexes).
- `agents/sync_plane/divergence_queue.py` — 23.8 K typed seam (6 public
  fns + 5 dataclasses + 2 enums + the §3 audit reason + event_type
  constants).
- `agents/sync_plane/tests/test_divergence_queue.py` — 19.5 K, 12 tests,
  60 assertions, AC-tagged.
- `forge/11.5/_run_smoke.py` — standalone driver (bypasses the pre-existing
  `agents/sync_plane/__init__.py` indentation error from 11.4's WIP).
- `forge/11.5/_write_evidence.py` — evidence wrapper for the
  close-gate interaction.
- `forge/11.5/UI_SURFACE.md` — implementation-child design seed
  (for 11.5a).

### Disposition

`PATCH Forge AI-255 → in_review` with a `request_confirmation` close-gate
interaction. The prompt asks the CTO to verify the v0.1 contract is
acceptable and to confirm the dispatch plan for the 11.5a / 11.5b / 11.5c
follow-up children once Forge AI-11.0 (Architect hire) closes.

If the CTO accepts, the wake machinery PATCHes `Forge AI-255 → done` and
spawns the implementation children. If the CTO returns with revisions,
the next Architect heartbeat copy-bumps the design and re-runs the
smoke before re-attempting the close-gate.