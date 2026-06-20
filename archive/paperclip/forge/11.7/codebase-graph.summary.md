# Forge AI-268 codebase graph — summary

- **Target**: agents/sync_plane (Python) + forge/sync-plane/src (TypeScript sibling)
- **Generated**: 2026-06-19T21:07:08Z
- **Nodes**: 488  **Edges**: 669  **Total LOC**: 12480
- **Cycles detected**: 0

## Languages

- **python**: 483 nodes
- **typescript**: 5 nodes

## Module breakdown (sync_plane)

| module | LOC | role |
|---|---|---|
| `__init__.py` | 306 | — |
| `alert_wiring.py` | 460 | 60-min OOH alerter for unprocessed `sync.shadow_drift` (AC #4) |
| `alerting.py` | 133 | — |
| `attribution.py` | 424 | — |
| `audit.py` | 179 | audit row model + Forge AI-36 `sync.shadow_drift` event type constant |
| `author_mapping.py` | 382 | — |
| `clock_monitor.py` | 190 | — |
| `cursor.py` | 271 | per-tenant platform cursor (persists across restart) |
| `daily_report.py` | 516 | daily divergence-report renderer, `forge/sync-plane/reports/<tenant>/<YYYY-MM-DD>.md` (AC #3) |
| `divergence.py` | 530 | divergence detection, P0 R-SYNC-05 missing-event alert |
| `divergence_queue.py` | 633 | — |
| `envelope.py` | 575 | — |
| `field_owners.py` | 177 | — |
| `hlc.py` | 163 | Hybrid Logical Clock for shadow_drift deterministic ordering |
| `polling.py` | 595 | 5-min polling backstop, AC #1, idempotent reconciler (AC #2) |
| `__init__.py` | 91 | — |
| `_normalize.py` | 154 | — |
| `md_to_adf.py` | 565 | — |
| `md_to_clickup.py` | 114 | — |
| `md_to_gfm.py` | 41 | — |
| `resolver.py` | 499 | — |
| `service_accounts.py` | 357 | — |
| `shadow_diff.py` | 516 | shadow-log diff poller, emits `sync.shadow_drift` audit row (AC #2) |
| `smoke_test_polling.py` | 719 | 5-AC smoke + property test, deterministic via mocked clock (AC #5) |
| `__init__.py` | 2 | — |
| `test_divergence_queue.py` | 539 | — |
| `test_shadow_diff.py` | 869 | — |
| `test_smoke.py` | 434 | — |
| `test_sync_plane_envelope.py` | 533 | — |
| `threading.py` | 395 | — |

## Top fan-in (core abstractions / entry points)

| symbol | path | in-degree |
|---|---|---|
| `None` | `agents/sync_plane/tests/test_shadow_diff.py` | 31 |
| `None` | `agents/sync_plane/threading.py` | 18 |
| `None` | `agents/sync_plane/daily_report.py` | 16 |
| `None` | `agents/sync_plane/tests/test_divergence_queue.py` | 16 |
| `None` | `agents/sync_plane/tests/test_smoke.py` | 16 |
| `None` | `agents/sync_plane/divergence_queue.py` | 15 |
| `None` | `agents/sync_plane/tests/test_sync_plane_envelope.py` | 15 |
| `None` | `agents/sync_plane/shadow_diff.py` | 14 |
| `None` | `agents/sync_plane/attribution.py` | 13 |
| `None` | `agents/sync_plane/divergence.py` | 13 |

## Top fan-out (coupling hotspots)

| symbol | path | out-degree |
|---|---|---|
| `None` | `agents/sync_plane/tests/test_shadow_diff.py` | 15 |
| `None` | `agents/sync_plane/__init__.py` | 14 |
| `None` | `agents/sync_plane/divergence.py` | 12 |
| `None` | `agents/sync_plane/divergence_queue.py` | 11 |
| `None` | `agents/sync_plane/polling.py` | 11 |
| `None` | `agents/sync_plane/daily_report.py` | 10 |
| `None` | `agents/sync_plane/smoke_test_polling.py` | 10 |
| `None` | `agents/sync_plane/shadow_diff.py` | 9 |
| `None` | `agents/sync_plane/alert_wiring.py` | 9 |
| `None` | `agents/sync_plane/tests/test_sync_plane_envelope.py` | 9 |

## Cycles (strongly connected components)

- **None detected.** The polling/diff/report/alert split is acyclic at the module level: `polling` → `audit`+`cursor`; `shadow_diff` → `audit`+`hlc`; `daily_report` → `audit`; `alert_wiring` → (Slack channel port only). Each entry point is fed by the smoke harness with no back-edges into the production module graph.

## Architecture read

- **Topology**: Library (not service) — `agents/sync_plane/` exposes pure Python modules consumed by `agents/sync_plane_service/leader.py` (gRPC) and the smoke harness. The TypeScript sibling `forge/sync-plane/src/` (`hlc.ts`, `ownership.ts`, `resolver.ts`, `divergence-queue.ts`) is the Tier-1/Tier-2 conflict-resolution surface from ADR-0010 §4; Forge AI-268 lives in the Python service (Tier-3 polling + report).

- **Layering**: `audit`, `cursor`, `hlc` are the bottom layer (storage / clock primitives); `polling`, `shadow_diff`, `divergence` are the orchestrators over those primitives; `daily_report` and `alert_wiring` are the top-layer consumers that produce artefacts / Slack pages. No module in the top layer imports from a sibling top-layer module — no layering violation.

- **Entry-point breadth**: 1 (`smoke_test_polling.py` for now; production entry is the leader.py scheduler). The smoke test is itself a self-contained harness with stub `RemoteStateReader` + in-memory `CursorStore` + `InMemoryAuditLog` — keeps the production graph small and the smoke deterministic.

- **Naming drift**: none observed across the sync_plane surface (`Cursor`, `AuditRow`, `ShadowLog`, `RemoteStateReader`, `SlackChannel`, `OOHPending`, `SlackPage` are all stable across modules).

- **Test-vs-prod balance**: 4 test files (`tests/test_shadow_diff.py`, `tests/test_divergence_queue.py`, `tests/test_sync_plane_envelope.py`, `tests/test_smoke.py`) + the smoke harness; ratio ≈ 0.45 — within the healthy band.

- **External dep fan-in**: `hlc` is the only module imported by 4+ siblings; everything else is local. No third-party `import` outside stdlib (except `yaml` in the TS package only).

## AC-by-AC mapping (Forge AI-268)

| AC | Module(s) | Evidence |
|---|---|---|
| #1 5-min polling per (tenant, platform) | `polling.py`, `cursor.py` | smoke AC #1: tick runs, cursor persists across snapshot restart (16 AC checks). |
| #2 Deterministic `sync.shadow_drift` with old/new + HLC | `shadow_diff.py`, `audit.py`, `hlc.py` | `ShadowDiff.cycle()` emits row with `old_value`, `new_value`, `detected_hlc`, `remote_hlc`, `cycle_hlc`. |
| #3 Daily report at `forge/sync-plane/reports/<tenant>/<YYYY-MM-DD>.md` | `daily_report.py` | smoke AC #3: 7 days clean, all `sample_complete=True`. |
| #4 60-min OOH `shadow_drift` Slack alert via Forge AI-36 | `alert_wiring.py` | `ShadowDriftOOHAlerter.scan()` uses `OOH_THRESHOLD_MINUTES = 60`; `SlackChannel` port is the Forge AI-36 forwarder seam. |
| #5 30+ assertions + 7-day clean-run smoke (deterministic via mocked clock) | `smoke_test_polling.py` | Smoke run `20260619T210708Z`: 14.1 ms, 8/8 checks PASS, evidence at `forge/11.7/polling-and-divergence-smoke.json` + `agents/sync_plane/evidence/smoke_20260619T210708Z/result.json`. |

## Tech-debt markers (TODO/FIXME/XXX density > 1%)

- None. The sync_plane service is TODO/FIXME-clean.


## Hand-off

- `forge/11.7/codebase-graph.json` — full graph (488 nodes / 669 edges).
- `forge/11.7/polling-and-divergence-smoke.json` — smoke evidence (8/8 PASS in 14.1 ms).
- `agents/sync_plane/evidence/smoke_20260619T210708Z/result.json` — full assertion dump.
- Hand-off to design-generator (Forge AI-35) + arch-style-detector (Forge AI-29): `codebase-graph.json` is `schemaVersion: 1` per Epic 2.1 (Forge AI-27) contract.

