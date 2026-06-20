"""
Clock monitor — Tier 3 auto-degrade trigger (ADR-0010 §7.1).

The clock monitor watches the event log and emits an `event.clock_skew`
row when it sees a pair of HLCs whose physical_ms fields are
>5s apart (the SKEW_THRESHOLD_MS threshold).  The resolver consumes
the `skew_active` flag and routes affected free-text writes to
Tier 3 (the divergence workbench) instead of LWW.

The monitor is a *sliding-window* check: it scans the last N
events (default 200) and reports the largest pairwise
|physical_ms - physical_ms| delta.  If that delta exceeds
the threshold, `skew_active` flips to True and the resolver
re-routes subsequent writes.  The flag stays True until the
monitor observes a window in which the max delta is below
`SKEW_THRESHOLD_MS / 2` (hysteresis to avoid flapping).

This is the sub-task 11.7 polling backstop in micro-form: in
production, the daily divergence job will call
`monitor.observe(event)` for every event in the replay window
and the monitor's `tick()` is called by the resolver before
each `resolve()` to refresh the flag.

Audit row: `sync.event.clock_skew` (CLOCK_SKEW_EVENT) carries
`metadata.skew_ms` and the two physical_ms values that tripped
the threshold.  See `agents/sync_plane/audit.py`.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from typing import Deque, List, Optional, Tuple

from .audit import (
    CLOCK_SKEW_EVENT,
    AuditRow,
    build_audit_row,
)
from .hlc import HLC, parse
from .resolver import SKEW_THRESHOLD_MS


# Hysteresis: the flag is cleared when the max delta in the
# window drops below half the threshold.  This prevents the
# resolver from flapping between Tier 2 and Tier 3 on the
# boundary value.
DEACTIVATE_SKEW_FLOOR_MS = SKEW_THRESHOLD_MS // 2


@dataclass
class SkewReport:
    """One monitor tick's report.  Carried into the audit row on
    the threshold transition."""
    skew_active: bool
    max_skew_ms: int
    pair: Tuple[str, str]            # the two HLCs that produced max_skew_ms
    actor: str = "system:clock-monitor"


class ClockMonitor:
    """The clock-skew detector.  Stateful; one per resolver process.

    `window` is the deque of HLCs the monitor has observed.  It
    bounds memory and bounds the cost of the O(N²) pairwise scan
    (N=200 → 40k ops, well under 1ms on a hot path).
    """

    def __init__(
        self,
        *,
        tenant_id: str,
        window_size: int = 200,
        threshold_ms: int = SKEW_THRESHOLD_MS,
    ) -> None:
        if window_size < 2:
            raise ValueError("window_size must be >= 2")
        self._window: Deque[HLC] = deque(maxlen=window_size)
        self._tenant_id = tenant_id
        self._threshold_ms = threshold_ms
        self._skew_active = False
        # The most recent threshold-transition report; emitted as
        # the `event.clock_skew` audit row.
        self._last_report: Optional[SkewReport] = None

    @property
    def skew_active(self) -> bool:
        return self._skew_active

    @property
    def threshold_ms(self) -> int:
        return self._threshold_ms

    def observe(self, hlc: HLC) -> None:
        """Push an HLC into the sliding window.  Does NOT yet
        evaluate the threshold; the resolver calls `tick()` (or
        `evaluate()`) explicitly so the policy decision is in one
        place.  This split lets us batch the window update with
        the audit write."""
        self._window.append(hlc)

    def evaluate(self) -> SkewReport:
        """Scan the window for the largest pairwise |Δphysical_ms|.
        Returns a `SkewReport` and updates `skew_active` with
        hysteresis."""
        if len(self._window) < 2:
            return SkewReport(False, 0, ("", ""), actor="system:clock-monitor")

        max_delta = 0
        pair: Tuple[str, str] = ("", "")
        oldest: Optional[HLC] = None
        for hlc in self._window:
            if oldest is None or hlc.physical_ms < oldest.physical_ms:
                oldest = hlc
        newest: Optional[HLC] = None
        for hlc in self._window:
            if newest is None or hlc.physical_ms > newest.physical_ms:
                newest = hlc
        if oldest is not None and newest is not None:
            delta = newest.physical_ms - oldest.physical_ms
            if delta > max_delta:
                max_delta = delta
                pair = (str(oldest), str(newest))

        # Hysteresis: trip on >threshold, clear on <threshold/2.
        if not self._skew_active and max_delta > self._threshold_ms:
            self._skew_active = True
            self._last_report = SkewReport(
                skew_active=True,
                max_skew_ms=max_delta,
                pair=pair,
            )
        elif self._skew_active and max_delta < DEACTIVATE_SKEW_FLOOR_MS:
            self._skew_active = False
            self._last_report = SkewReport(
                skew_active=False,
                max_skew_ms=max_delta,
                pair=pair,
            )
        return self._last_report or SkewReport(
            skew_active=self._skew_active,
            max_skew_ms=max_delta,
            pair=pair,
        )

    def audit_row_for(
        self, report: SkewReport, *, actor: str = "system:clock-monitor"
    ) -> AuditRow:
        """Build the `event.clock_skew` audit row for a transition.
        Only the *transition* reports are audited; steady-state
        `skew_active=True` rows would flood the chain."""
        if not report.skew_active:
            # Closing the skew window — symmetric audit row so the
            # divergence-detection job can see the recovery.
            return build_audit_row(
                event_type=CLOCK_SKEW_EVENT,
                tenant_id=self._tenant_id,
                actor=actor,
                field="",
                reason="clock_skew_cleared",
                metadata={
                    "skew_ms": report.max_skew_ms,
                    "pair": list(report.pair),
                    "threshold_ms": self._threshold_ms,
                },
            )
        return build_audit_row(
            event_type=CLOCK_SKEW_EVENT,
            tenant_id=self._tenant_id,
            actor=actor,
            field="",
            reason="clock_skew",
            metadata={
                "skew_ms": report.max_skew_ms,
                "pair": list(report.pair),
                "threshold_ms": self._threshold_ms,
            },
        )

    def force(self, skew_active: bool) -> None:
        """Test seam: force the flag.  Used by the smoke test to
        simulate a clock-skew event without having to forge
        200 HLCs across a 5-second window."""
        self._skew_active = skew_active

    def reset(self) -> None:
        self._window.clear()
        self._skew_active = False
        self._last_report = None
