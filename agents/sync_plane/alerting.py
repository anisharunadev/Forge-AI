"""
Alert channel port for sync-plane P0/P1 events (FORA-257).

Per ADR-0010 §8.2 R-SYNC-05 the daily-audit-divergence canary MUST
page on-call within 5 min.  Production wires the alert channel to
PagerDuty via the existing FORA-36 audit forwarder
(`audit.daily_sample` → PagerDuty); the smoke test uses an
in-memory channel that records every page.

This module is pure-Python.  The protocol below is the single
seam the rest of the sync plane talks to; swapping the
in-memory channel for the production PagerDuty channel is a
one-line substitution in the wiring.

Reference: ADR-0010 §7.2 #4 (audit divergence), §8.2 R-SYNC-05
(daily divergence P0), risk register `forge/sync-plane/risk_register.md`
§7.2 (P0 pages on-call within 5 min).
"""

from __future__ import annotations

import datetime as dt
import threading
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional, Protocol


class Severity(str, Enum):
    P0 = "P0"   # page on-call; production targets < 5 min
    P1 = "P1"   # create a ticket; on-call reviews next business day
    P2 = "P2"   # log only; surface in the workbench (11.5)


@dataclass
class PagePayload:
    """A single page request.  Production wires this to PagerDuty;
    the in-memory channel records it for the smoke test."""
    title: str
    severity: Severity
    tenant_id: str
    summary: str
    details: Dict[str, str] = field(default_factory=dict)
    fired_at: dt.datetime = field(default_factory=lambda: dt.datetime.now(dt.timezone.utc))

    def to_dict(self) -> Dict:
        return {
            "title": self.title,
            "severity": self.severity.value,
            "tenant_id": self.tenant_id,
            "summary": self.summary,
            "details": dict(self.details),
            "fired_at": self.fired_at.isoformat(),
        }


class AlertChannel(Protocol):
    """The single seam the sync plane pages through."""

    def page(self, payload: PagePayload) -> None: ...
    def count(self, severity: Severity) -> int: ...
    def history(self) -> List[PagePayload]: ...


class InMemoryAlertChannel:
    """Records every page for the smoke test.  Thread-safe."""

    def __init__(self) -> None:
        self._pages: List[PagePayload] = []
        self._lock = threading.Lock()

    def page(self, payload: PagePayload) -> None:
        with self._lock:
            # Store a defensive copy so external mutations don't
            # poison the in-memory history.
            d = payload.to_dict()
            self._pages.append(PagePayload(
                title=d["title"],
                severity=Severity(d["severity"]),
                tenant_id=d["tenant_id"],
                summary=d["summary"],
                details=dict(d["details"]),
                fired_at=dt.datetime.fromisoformat(d["fired_at"]),
            ))

    def count(self, severity: Severity) -> int:
        with self._lock:
            return sum(1 for p in self._pages if p.severity is severity)

    def history(self) -> List[PagePayload]:
        with self._lock:
            return [
                PagePayload(
                    title=p.title, severity=p.severity, tenant_id=p.tenant_id,
                    summary=p.summary, details=dict(p.details),
                    fired_at=p.fired_at,
                )
                for p in self._pages
            ]


class PagerDutyAlertChannel:
    """The production channel stub.  Posts to PagerDuty Events API v2
    via the `pd_routing_key` (per-tenant in the FORA-125 IAM policy).

    This class is the seam future SRE work wires; the smoke test
    does NOT exercise it.  The reason it lives in this module
    (and not in a separate `pd_client.py`) is that the seam
    surface is intentionally small and the smoke test is the only
    call site for now.
    """

    def __init__(self, *, routing_key: str, pd_endpoint: str = "https://events.pagerduty.com/v2/enqueue") -> None:
        if not routing_key:
            raise ValueError("routing_key is required (per-tenant FORA-125 IAM policy)")
        self._routing_key = routing_key
        self._endpoint = pd_endpoint
        self._sent: List[PagePayload] = []

    def page(self, payload: PagePayload) -> None:
        # Production: HTTP POST `payload.to_dict()` with
        # `routing_key` + `event_action: "trigger"`.  Out of scope
        # for the smoke test; the smoke test uses the in-memory
        # channel and asserts the *contract* (severity, title,
        # tenant_id, summary) not the wire format.
        self._sent.append(payload)

    def count(self, severity: Severity) -> int:
        return sum(1 for p in self._sent if p.severity is severity)

    def history(self) -> List[PagePayload]:
        return list(self._sent)
