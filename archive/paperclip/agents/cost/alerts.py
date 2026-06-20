"""
Alert log (FORA-75, 0.6).

Append-only record of every soft/hard threshold breach the
`CeilingMeter` fires.  The log is in-memory in dev and Postgres-backed
in production (a sibling of `audit.events`, in the same database and
in the same append-only posture).  The board read API consumes the
log to render the alert timeline; the `TenantGate` consults the
latest `tenant_paused` / `tenant_resumed` rows to decide whether to
admit a new run.
"""

from __future__ import annotations

import datetime as dt
import logging
import threading
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional


_log = logging.getLogger("fora.cost.alerts")


class AlertKind(str, Enum):
    """The three alert kinds.  Each maps to a typed event the
    board can render; new kinds require a schema bump."""
    SOFT_THRESHOLD = "soft_threshold"            # spend >= soft_threshold_cents
    HARD_THRESHOLD = "hard_threshold"            # spend >= monthly_ceiling_cents
    TENANT_PAUSED = "tenant_paused"              # hard_threshold fired; gate denies new runs
    TENANT_RESUMED = "tenant_resumed"            # an admin lifted the pause


@dataclass
class AlertRecord:
    """One alert.  Carries the snapshot the alert was fired against,
    so the board can show "spend $161 / $200" without recomputing.
    The `alert_key` is the idempotency key: a tenant that crosses
    the soft threshold twice in the same month does not get two
    `soft_threshold` alerts."""
    alert_id: str
    tenant_id: str
    month_key: str
    kind: AlertKind
    spend_cents_at_alert: int
    ceiling_cents: int
    soft_threshold_cents: int
    alert_key: str
    timestamp: str
    metadata: Dict[str, object] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "alertId": self.alert_id,
            "tenantId": self.tenant_id,
            "monthKey": self.month_key,
            "kind": self.kind.value,
            "spendCentsAtAlert": self.spend_cents_at_alert,
            "ceilingCents": self.ceiling_cents,
            "softThresholdCents": self.soft_threshold_cents,
            "alertKey": self.alert_key,
            "timestamp": self.timestamp,
            "metadata": dict(self.metadata),
        }


def _now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


class AlertLog:
    """Append-only alert store.  Thread-safe; idempotent on `alert_key`.

    The `append()` method refuses to insert a second alert with the
    same `alert_key`.  This is the property the `CeilingMeter`
    depends on: the meter fires on every recompute, but the log
    deduplicates by `(tenant_id, month_key, kind)` so a tenant that
    stays above 80% all month does not flood the board with
    notifications.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._by_key: Dict[str, AlertRecord] = {}
        self._by_tenant: Dict[str, List[AlertRecord]] = {}

    def append(self, record: AlertRecord) -> Optional[AlertRecord]:
        """Insert `record` if no alert with the same `alert_key`
        exists.  Returns the inserted record, or None if the key
        was a duplicate (the existing record is unchanged)."""
        with self._lock:
            if record.alert_key in self._by_key:
                return None
            self._by_key[record.alert_key] = record
            self._by_tenant.setdefault(record.tenant_id, []).append(record)
        _log.info(
            "alert_fired tenant=%s kind=%s spend_cents=%d ceiling_cents=%d key=%s",
            record.tenant_id, record.kind.value, record.spend_cents_at_alert,
            record.ceiling_cents, record.alert_key,
        )
        return record

    def for_tenant(self, tenant_id: str) -> List[AlertRecord]:
        with self._lock:
            return list(self._by_tenant.get(tenant_id, []))

    def all(self) -> List[AlertRecord]:
        with self._lock:
            return list(self._by_key.values())

    def latest_for(self, tenant_id: str, kind: AlertKind) -> Optional[AlertRecord]:
        """The most recent alert of `kind` for `tenant_id`, or None."""
        with self._lock:
            records = self._by_tenant.get(tenant_id, [])
        matching = [r for r in records if r.kind == kind]
        if not matching:
            return None
        return max(matching, key=lambda r: r.timestamp)

    def is_paused(self, tenant_id: str) -> bool:
        """True iff the most recent HARD_THRESHOLD or TENANT_PAUSED
        for `tenant_id` is a `pause` and has not been followed by
        a `TENANT_RESUMED`.  This is the gate-side state the
        `TenantGate` reads."""
        with self._lock:
            records = list(self._by_tenant.get(tenant_id, []))
        # walk in chronological order
        records.sort(key=lambda r: r.timestamp)
        paused = False
        for r in records:
            if r.kind == AlertKind.TENANT_PAUSED:
                paused = True
            elif r.kind == AlertKind.TENANT_RESUMED:
                paused = False
        return paused

    @staticmethod
    def make_soft(tenant_id: str, month_key: str, spend_cents: int,
                  ceiling_cents: int, soft_cents: int) -> AlertRecord:
        return AlertRecord(
            alert_id=f"alert-{uuid.uuid4().hex[:16]}",
            tenant_id=tenant_id,
            month_key=month_key,
            kind=AlertKind.SOFT_THRESHOLD,
            spend_cents_at_alert=spend_cents,
            ceiling_cents=ceiling_cents,
            soft_threshold_cents=soft_cents,
            alert_key=f"soft:{tenant_id}:{month_key}",
            timestamp=_now_iso(),
        )

    @staticmethod
    def make_hard(tenant_id: str, month_key: str, spend_cents: int,
                  ceiling_cents: int, soft_cents: int) -> AlertRecord:
        return AlertRecord(
            alert_id=f"alert-{uuid.uuid4().hex[:16]}",
            tenant_id=tenant_id,
            month_key=month_key,
            kind=AlertKind.HARD_THRESHOLD,
            spend_cents_at_alert=spend_cents,
            ceiling_cents=ceiling_cents,
            soft_threshold_cents=soft_cents,
            alert_key=f"hard:{tenant_id}:{month_key}",
            timestamp=_now_iso(),
        )

    @staticmethod
    def make_paused(tenant_id: str, month_key: str, spend_cents: int,
                    ceiling_cents: int, soft_cents: int) -> AlertRecord:
        return AlertRecord(
            alert_id=f"alert-{uuid.uuid4().hex[:16]}",
            tenant_id=tenant_id,
            month_key=month_key,
            kind=AlertKind.TENANT_PAUSED,
            spend_cents_at_alert=spend_cents,
            ceiling_cents=ceiling_cents,
            soft_threshold_cents=soft_cents,
            alert_key=f"paused:{tenant_id}:{month_key}",
            timestamp=_now_iso(),
        )

    @staticmethod
    def make_resumed(tenant_id: str, *, reason: str = "admin_resume") -> AlertRecord:
        return AlertRecord(
            alert_id=f"alert-{uuid.uuid4().hex[:16]}",
            tenant_id=tenant_id,
            month_key="n/a",
            kind=AlertKind.TENANT_RESUMED,
            spend_cents_at_alert=0,
            ceiling_cents=0,
            soft_threshold_cents=0,
            alert_key=f"resumed:{tenant_id}:{uuid.uuid4().hex[:8]}",
            timestamp=_now_iso(),
            metadata={"reason": reason},
        )
