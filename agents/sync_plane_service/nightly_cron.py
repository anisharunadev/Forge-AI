"""
Nightly divergence scan over `sync.divergence_queue` (FORA-438 AC#5).

The daily job walks the unresolved Tier-3 candidates parked
in `sync.divergence_queue` (per ADR-0010 §4) and emits a
`sync.backfill.completed` audit event summarising the
drift per platform (GitHub / Jira / ClickUp). The shared
worker pattern means FORA-406 (Jira) and FORA-438 (GitHub)
divergences go through the same scan — the `loser_platform`
field on each `DivergenceEntry` is the natural group key.

Idempotency: the scan is keyed on a deterministic snapshot
fingerprint (`sha256(sorted(entries))`) so re-running on the
same snapshot yields the same `idempotency_key` and the
`AuditForwarder` rejects the duplicate (per FORA-36
`tool_call` row dedup). The acceptance bar is "re-running on
same snapshot yields no new divergence events" — the worker
is the single call site that owns the daily drift report
that the FORA-204 audit forwarder aggregates.

The worker is **dependency-free** (no Redis / Postgres /
NATS) so the smoke test runs in <10 ms. Production wiring
threads a real `DivergenceQueue` reader (the
`sync.divergence_queue` table) instead of the in-memory
list — the scan logic is unchanged.

The cron entry (per the issue) is `apps/sync-plane-job/
src/nightly_cron.ts` (a thin TypeScript wrapper that calls
`python -m agents.sync_plane_service.nightly_cron`). The
wrapper is a single `pnpm` script with no business logic;
the Python module below is the source of truth for the
drift aggregation.

Spec source: FORA-201 plan §1 AC#5 + §6 smoke #5.
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Sequence

# Make the package importable when invoked as
# `python -m agents.sync_plane_service.nightly_cron` from
# the repo root.
_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.abspath(os.path.join(_HERE, "..", ".."))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from agents.sync_plane_service.audit_forwarder import (  # noqa: E402
    InMemoryAuditForwarder,
)
from agents.sync_plane_service.schema import (  # noqa: E402
    DivergenceEntry,
    now_iso,
)


# The audit event type the cron emits on each run. Per
# ADR-0010 §8.1 the §8.1 list includes both
# `sync.event.divergence_detected` (per-event) and
# `sync.backfill.completed` (per-scan). The nightly cron
# uses the latter — one row per scan, not one row per
# drift entry. The FORA-204 daily drift report aggregates
# over these rows.
NIGHTLY_EVENT_TYPE = "sync.backfill.completed"

# The platforms the worker scans for. Adding a new
# platform is one line in this tuple (the `loser_platform`
# field is the source of truth on the queue row).
SCAN_PLATFORMS: tuple = ("github", "jira", "clickup")


@dataclass
class NightlyScanResult:
    """The cron's per-run output. Persisted as the
    evidence file the close-gate reviewer (CTO) reads.
    `snapshot_fingerprint` is the idempotency key — two
    runs on the same divergence set produce the same
    fingerprint and the same audit row."""
    started_at: str
    duration_ms: int
    tenant_count: int
    total_divergences: int
    per_platform: Dict[str, int] = field(default_factory=dict)
    per_tenant: Dict[str, int] = field(default_factory=dict)
    snapshot_fingerprint: str = ""
    audit_event_id: str = ""
    platforms_scanned: tuple = ()


def _entry_fingerprint(entries: Sequence[DivergenceEntry]) -> str:
    """Stable, order-independent fingerprint of the
    current divergence queue. SHA-256 over the sorted
    JSON form of `(tenant_id, entity_id, field,
    loser_platform, winner_platform)` for each
    `DivergenceEntry`. Two runs on the same queue
    produce the same fingerprint → the audit
    `idempotency_key` is the same → the FORA-36
    `tool_call` store dedupes the row. Re-running on
    the same snapshot yields no new divergence events
    (the AC's idempotency bar)."""
    rows = sorted(
        (
            e.tenant_id,
            e.entity_id,
            e.field,
            e.loser_platform,
            e.winner_platform,
            e.detected_hlc,
        )
        for e in entries
    )
    encoded = json.dumps(
        rows, sort_keys=True, separators=(",", ":"), default=str,
    ).encode("utf-8")
    return "sha256:" + hashlib.sha256(encoded).hexdigest()


def run_nightly_scan(
    *,
    entries: Sequence[DivergenceEntry],
    forwarder: Optional[InMemoryAuditForwarder] = None,
    actor: str = "system:nightly_cron",
) -> NightlyScanResult:
    """Run one nightly scan.

    `entries` is the unresolved Tier-3 queue at scan
    time. Production wiring reads from
    `sync.divergence_queue`; day-one / smoke passes
    an in-memory list. `forwarder` is the
    `AuditForwarder`; the default is a fresh
    in-memory one so the smoke is self-contained.

    The scan emits **one `sync.backfill.completed`
    audit row per tenant** (the FORA-36 `tenant_id`
    field is required, and a per-tenant row is the
    natural shape for the FORA-204 daily drift
    report). The per-tenant snapshot fingerprint is
    the `idempotency_key`; a re-run on the same
    queue produces the same fingerprints and the
    FORA-36 `tool_call` store dedupes the rows
    (the AC's idempotency bar — re-running on the
    same snapshot yields no new divergence events).

    Returns the per-run result; the smoke writes
    the result to evidence JSON for the close-gate
    reviewer."""
    started_at = now_iso()
    t0 = time.time()
    fwd = forwarder or InMemoryAuditForwarder()
    fingerprint = _entry_fingerprint(entries)
    per_platform: Dict[str, int] = {p: 0 for p in SCAN_PLATFORMS}
    per_tenant: Dict[str, int] = {}
    by_tenant: Dict[str, List[DivergenceEntry]] = {}
    for e in entries:
        if e.loser_platform in per_platform:
            per_platform[e.loser_platform] += 1
        per_tenant[e.tenant_id] = per_tenant.get(e.tenant_id, 0) + 1
        by_tenant.setdefault(e.tenant_id, []).append(e)
    audit_event_ids: List[str] = []
    for tenant_id, tenant_entries in sorted(by_tenant.items()):
        per_platform_tenant: Dict[str, int] = {p: 0 for p in SCAN_PLATFORMS}
        for e in tenant_entries:
            if e.loser_platform in per_platform_tenant:
                per_platform_tenant[e.loser_platform] += 1
        tenant_fingerprint = _entry_fingerprint(tenant_entries)
        event_id = fwd.forward(
            event_type=NIGHTLY_EVENT_TYPE,
            tenant_id=tenant_id,
            actor=actor,
            entity_id="",
            hlc=started_at,
            metadata={
                "snapshot_fingerprint": fingerprint,
                "tenant_snapshot_fingerprint": tenant_fingerprint,
                "divergence_count": len(tenant_entries),
                "per_platform": per_platform_tenant,
                "platforms_scanned": list(SCAN_PLATFORMS),
                "idempotency_key": tenant_fingerprint,
                "scan_kind": "nightly_divergence",
                "shared_with": ["FORA-406", "FORA-438"],
            },
        )
        audit_event_ids.append(event_id)
    duration_ms = int((time.time() - t0) * 1000)
    return NightlyScanResult(
        started_at=started_at,
        duration_ms=duration_ms,
        tenant_count=len(per_tenant),
        total_divergences=len(entries),
        per_platform=dict(per_platform),
        per_tenant=dict(per_tenant),
        snapshot_fingerprint=fingerprint,
        audit_event_id=(
            audit_event_ids[0] if audit_event_ids else ""
        ),
        platforms_scanned=SCAN_PLATFORMS,
    )


# -- Cron registration (apps/sync-plane-job) -------------------------------


def register_cron(
    *,
    schedule: str = "0 2 * * *",
    command: Optional[Sequence[str]] = None,
) -> Dict[str, Any]:
    """The cron registration descriptor the
    `apps/sync-plane-job` worker surfaces to the
    orchestrator / k8s CronJob. Pure function — no
    side effects, no DB writes. The smoke asserts
    the returned schedule + command are stable
    across calls (idempotent registration).

    `schedule` is the standard 5-field cron
    expression in UTC. The default is 02:00 daily
    (low-traffic window; close to the
    customer-cloud-broker probe scheduler's 5-min
    cadence — see FORA-194). `command` is the
    argv the worker invokes; production wires the
    `python -m agents.sync_plane_service.nightly_cron`
    entry."""
    cmd = list(command or [
        "python", "-m", "agents.sync_plane_service.nightly_cron",
    ])
    return {
        "name": "sync-plane-nightly-divergence-scan",
        "schedule": schedule,
        "command": cmd,
        "shared_with": ["FORA-406", "FORA-438"],
        "idempotent": True,
        "audit_event_type": NIGHTLY_EVENT_TYPE,
        "registered_at": now_iso(),
    }


# -- CLI entry point ------------------------------------------------------


def main() -> int:
    """CLI: read the unresolved queue from
    `sync.divergence_queue` (production: Postgres;
    day-one: a JSON file at the path in
    `FORA_DIVERGENCE_QUEUE_PATH` or empty), run the
    scan, print the result JSON, and exit 0.

    The smoke test wires its own `forwarder` and
    `entries` via the Python API; the CLI is the
    production entry point the cron invokes."""
    queue_path = os.environ.get("FORA_DIVERGENCE_QUEUE_PATH", "")
    entries: List[DivergenceEntry] = []
    if queue_path and os.path.exists(queue_path):
        try:
            with open(queue_path, "r", encoding="utf-8") as fh:
                raw = json.load(fh)
            for row in raw if isinstance(raw, list) else []:
                entries.append(DivergenceEntry(**{
                    k: v for k, v in row.items()
                    if k in DivergenceEntry.__dataclass_fields__
                }))
        except (OSError, json.JSONDecodeError, TypeError) as exc:
            print(
                f"nightly_cron: failed to read queue "
                f"{queue_path!r}: {exc!r}",
                file=sys.stderr,
            )
    result = run_nightly_scan(entries=entries)
    print(json.dumps(
        {
            "started_at": result.started_at,
            "duration_ms": result.duration_ms,
            "tenant_count": result.tenant_count,
            "total_divergences": result.total_divergences,
            "per_platform": result.per_platform,
            "per_tenant": result.per_tenant,
            "snapshot_fingerprint": result.snapshot_fingerprint,
            "audit_event_id": result.audit_event_id,
        },
        sort_keys=True, default=str,
    ))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
