# Forge AI-11.5 (Tier-3 Divergence Workbench) — Changelog

This file tracks the design contract revisions for the Tier-3
workbench.  The current rev is pinned in the doc header
(`forge/11.5/design.md`); bump it here whenever a copy + bump
revision lands.

## v0.1 — 2026-06-18 — CTO first rev

- First cut of the §2 Postgres DDL
  (`forge/11.5/migrations/0001_divergence_queue.sql`).
- First cut of the §3 audit row shape
  (`event.divergence_resolved_by_human` in
  `agents/sync_plane/divergence_queue.py`).
- First cut of the §4 UI panel contract (list, pick, merge,
  bulk-pattern, tenant policy).
- First cut of the §5 server endpoint surface
  (`/api/forge/sync/divergence/list` +
  `get` + `resolve` + `bulk`).
- First cut of the §6 daily digest payload
  (`build_digest_payload()` with the 1 000 cap and the top-5
  per-`field_path` truncation).
- First cut of the §8 test plan
  (`agents/sync_plane/tests/test_divergence_queue.py`).
- Cross-references: §0 + §11 of the design doc cover them.
