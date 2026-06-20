"""
Burst-control audit row factory.

ADR-0010 §8.1 catalogues the eight `sync.*` event types; FORA-267 adds the
three burst-control event names below.  They route through the existing
FORA-36 audit forwarder — we do NOT create a second audit pipeline (per
ADR-0010 §8 decision).

Three event types
-----------------
    sync.burst_circuit_open   — breaker transitioned CLOSED/HALF_OPEN → OPEN
    sync.burst_circuit_close  — breaker transitioned HALF_OPEN → CLOSED
    sync.burst_coalesce       — Coalescer merged N>=2 events into one

The row shape mirrors `agents/sync_plane/audit.AuditRow`: tenant_id +
actor + metadata, with `event_id` / `prev_hash` / `record_hash` stamped
by the forwarder.  We do not import that module here so the burst package
stays usable as a standalone (the controller can be wired to either an
in-process or remote forwarder via `audit_sink`).
"""

from __future__ import annotations

import enum
import hashlib
import json
from dataclasses import dataclass, field
from typing import Any, Dict, Optional


BURST_CIRCUIT_OPEN  = "sync.burst_circuit_open"
BURST_CIRCUIT_CLOSE = "sync.burst_circuit_close"
BURST_COALESCE      = "sync.burst_coalesce"


class BurstAuditEvent(str, enum.Enum):
    CIRCUIT_OPEN  = BURST_CIRCUIT_OPEN
    CIRCUIT_CLOSE = BURST_CIRCUIT_CLOSE
    COALESCE      = BURST_COALESCE


_VALID = {BURST_CIRCUIT_OPEN, BURST_CIRCUIT_CLOSE, BURST_COALESCE}


@dataclass
class BurstAuditRow:
    """Same shape contract as `agents/sync_plane/audit.AuditRow`, scoped to
    the burst-control surface.  `metadata` carries the kind-specific fields:

        circuit_open:
            metadata = {"platform": "...", "failure_count": int,
                        "window_ms": int}
        circuit_close:
            metadata = {"platform": "...", "cooldown_ms": int}
        coalesce:
            metadata = {"platform": "...", "remote_issue_id": "...",
                        "event_kind": "...", "merged_count": int,
                        "coalesced_ids": [...]}
    """
    event_type: str
    tenant_id: str
    actor: str
    metadata: Dict[str, Any] = field(default_factory=dict)
    # Stamped by the FORA-36 forwarder.
    event_id: str = ""
    prev_hash: str = ""
    record_hash: str = ""


def build_burst_audit_row(
    *,
    event_type: str,
    tenant_id: str,
    actor: str,
    metadata: Optional[Dict[str, Any]] = None,
) -> BurstAuditRow:
    """Pure factory — raises on bad shape, never does I/O."""
    if event_type not in _VALID:
        raise ValueError(f"unknown burst event_type: {event_type!r}")
    if not tenant_id:
        raise ValueError("tenant_id is required")
    if not actor:
        raise ValueError("actor is required")
    md = dict(metadata or {})
    if "platform" not in md:
        raise ValueError(f"metadata.platform is required for {event_type}")
    if event_type == BURST_CIRCUIT_OPEN:
        if "failure_count" not in md or "window_ms" not in md:
            raise ValueError(
                "circuit_open requires metadata.failure_count and metadata.window_ms"
            )
    if event_type == BURST_CIRCUIT_CLOSE:
        if "cooldown_ms" not in md:
            raise ValueError("circuit_close requires metadata.cooldown_ms")
    if event_type == BURST_COALESCE:
        for k in ("remote_issue_id", "event_kind", "merged_count"):
            if k not in md:
                raise ValueError(f"coalesce requires metadata.{k}")
        if not isinstance(md["merged_count"], int) or md["merged_count"] < 2:
            raise ValueError("coalesce requires merged_count >= 2 (int)")
    return BurstAuditRow(
        event_type=event_type,
        tenant_id=tenant_id,
        actor=actor,
        metadata=md,
    )


def digest_burst_payload(row: BurstAuditRow) -> str:
    """SHA-256 of the canonical payload.  Mirrors `digest_payload()` in
    `agents/sync_plane/audit.py` so the FORA-36 forwarder doesn't need
    burst-specific code."""
    payload = {
        "event_type": row.event_type,
        "tenant_id": row.tenant_id,
        "actor": row.actor,
        "metadata": row.metadata,
    }
    canon = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canon.encode("utf-8")).hexdigest()
