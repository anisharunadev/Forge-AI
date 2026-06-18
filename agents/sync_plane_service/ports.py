"""
Architectural seams — the 6 ports per ADR-0010 §"Architectural seams".

The Sync Plane service skeleton (FORA-252 / 11.1) defines the
*protocols* the other 11.x sub-tasks implement. Two of them ship
with default in-memory implementations on day one (BurstControl and
AuditForwarder, per the day-one coupling called out in ADR-0010
§9). The other four ship as `Protocol` types only — the sub-tasks
that own them (`PlatformAdapter` 11.2 / `ConflictResolver` 11.4 /
`DivergenceWorkbench` 11.5 / `PollingBackstop` 11.7) implement
them in their own modules and the runtime wires them in at
service-start.

The `PortRegistry` is the wiring seam: the service holds one
`PortRegistry` per tenant and looks up the platform-specific port
implementations by name. The registry is intentionally trivial —
the complexity lives in the adapters themselves, not in the
wiring.

Design note (per CTO engineering standards): every port is a
`Protocol` with a small, focused method set. A port that does too
many things is a port that does nothing well. The shape mirrors
the `AuditStore` protocol in `agents/audit/store.py` — same
`@runtime_checkable` style, same ABC-free Python typing.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Protocol, runtime_checkable

from .schema import (
    CanonicalComment,
    DivergenceEntry,
    ReceivedEvent,
    SyncEntity,
)


# The 6 ports — string identifiers the `PortRegistry` keys on.
# The platform adapter port has three concrete implementations
# (jira / github / clickup) registered under distinct names; the
# others are one-implementation-per-port.
PORT_PLATFORM_JIRA = "platform.jira"
PORT_PLATFORM_GITHUB = "platform.github"
PORT_PLATFORM_CLICKUP = "platform.clickup"
PORT_CONFLICT_RESOLVER = "conflict_resolver"     # 11.4
PORT_DIVERGENCE_WORKBENCH = "divergence_workbench"  # 11.5
PORT_BURST_CONTROL = "burst_control"             # 11.6 (day-one, default impl ships)
PORT_POLLING_BACKSTOP = "polling_backstop"       # 11.7
PORT_AUDIT_FORWARDER = "audit_forwarder"         # 11.8 (day-one, default impl ships)


# -- PlatformAdapter (11.2) ---------------------------------------------------


@runtime_checkable
class PlatformAdapter(Protocol):
    """One remote platform. Per ADR-0010 §3.2 the adapter is the
    **only writer** to the remote; OAuth tokens, rate-limits, and
    remote API quirks are encapsulated here.

    The adapter receives canonical state from the service (already
    Tier-1 / Tier-2 resolved) and is responsible for translating
    it to the platform's wire form and submitting the API call.
    The service does not know or care about HTTP, OAuth, or
    rate-limit details.

    The contract is intentionally **synchronous-return** —
    `apply_mirror` returns a `MirrorResult` describing what
    happened. The BurstControl port is the *gate* (allow / deny
    before the call); the adapter is the *action*. The service
    checks the gate first, calls `apply_mirror`, and records the
    result for the audit log.
    """

    name: str  # e.g. "jira" / "github" / "clickup"

    def apply_mirror(
        self,
        tenant_id: str,
        entity: SyncEntity,
        *,
        comment: Optional[CanonicalComment] = None,
    ) -> "MirrorResult":
        """Apply one mirror write to the remote. The entity is the
        canonical state post-resolution; the optional comment is
        the canonical comment envelope (or None for entity-only
        writes). Returns the result with the platform's id for
        the new/updated resource."""

    def health(self) -> "AdapterHealth":
        """Return the adapter's current health — used by the
        PollingBackstop (11.7) to decide whether to bypass a
        degraded platform and queue the writes instead."""


@dataclass
class MirrorResult:
    """The result of one platform mirror write. `remote_id` is the
    platform-issued id of the new/updated resource; `ok` is False
    on a transient failure (5xx, rate-limit, network) so the
    BurstControl can decide whether to retry."""
    ok: bool
    platform: str
    remote_id: str = ""
    response_code: int = 0
    error: str = ""
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class AdapterHealth:
    """Snapshot of an adapter's health. `degraded` is True when the
    circuit breaker is open; the PollingBackstop (11.7) will route
    writes to the divergence queue instead of the live API."""
    platform: str
    degraded: bool = False
    consecutive_5xx: int = 0
    rate_limit_remaining: Optional[int] = None
    last_check_at: str = ""


# -- ConflictResolver (11.4) --------------------------------------------------


@runtime_checkable
class ConflictResolver(Protocol):
    """Tier 1 / Tier 2 / Tier 3 conflict policy (ADR-0010 §4).

    The default implementation in this skeleton raises
    `NotImplementedError`; the real implementation ships in
    sub-task 11.4 (FORA-254, the existing `agents/sync_plane/`
    conflict-resolver module). The service wires the real impl in
    at start-up.

    The method takes the incoming event, the current canonical
    state (None if the entity is new), and returns a
    `Resolution` describing what to do: accept the write, reject
    it (Tier 1 — we own the field), accept via Tier 2 LWW, or
    route to Tier 3 (divergence queue).
    """

    def resolve(
        self,
        event: ReceivedEvent,
        current: Optional[SyncEntity],
    ) -> "Resolution":
        """Resolve the conflict for `event` against `current`. The
        return value is the action the service should take."""


@dataclass
class Resolution:
    """The resolver's verdict. `action` is the enum value; the
    other fields are populated as needed."""
    action: str                    # "accept" | "reject" | "tier2_lww" | "tier3_park"
    field: str = ""
    winner_platform: str = ""      # populated for tier2_lww
    loser_platform: str = ""
    winner_hlc: str = ""
    loser_hlc: str = ""
    reason: str = ""               # "hlc_lww" | "field_owner" | "free_text" | "clock_skew"


# -- DivergenceWorkbench (11.5) -----------------------------------------------


@runtime_checkable
class DivergenceWorkbench(Protocol):
    """The human-facing UI for unresolved Tier-3 candidates
    (ADR-0010 §4). The workbench reads the
    `sync.divergence_queue` table, renders the candidates, and
    applies human resolutions (which the audit forwarder records
    as `event.divergence_resolved_by_human`).

    Day-one default: raise NotImplementedError; the workbench
    ships in sub-task 11.5.
    """

    def list_pending(self, tenant_id: str) -> List[DivergenceEntry]:
        """List the unresolved divergence entries for a tenant."""

    def resolve(
        self,
        tenant_id: str,
        entry_id: str,
        *,
        resolution: str,
        resolver: str,
    ) -> DivergenceEntry:
        """Apply a human resolution. The store marks the entry
        resolved; the audit forwarder emits
        `event.divergence_resolved_by_human`."""


# -- BurstControl (11.6, DAY-ONE) ---------------------------------------------


@runtime_checkable
class BurstControl(Protocol):
    """Per-tenant token bucket + per-platform circuit breaker
    (ADR-0010 §7.1, day-one P0 per ADR-0010 §9 because the Board's
    `every_event` write-back default makes it a ship-with-11.1
    requirement, not a follow-up).

    `decide` is the gate: given an outbound mirror event, return a
    `BurstDecision` (allow / deny / queue). The service checks the
    gate before calling the platform adapter; a denied event is
    either queued (in `sync.outbox.<platform>`) or, on persistent
    degradation, parked in `sync.divergence_queue`.

    Day-one default ships in `agents/sync_plane_service/burst.py`;
    sub-task 11.6 may replace it with a Redis-backed token bucket
    + circuit breaker without changing the protocol.
    """

    def decide(
        self,
        tenant_id: str,
        platform: str,
        *,
        event_kind: str,
        weight: int = 1,
    ) -> "BurstDecision":
        """Decide whether to allow the outbound event. `weight` is
        the per-event cost (default 1; comment-coalesced edits
        may report weight=1 for a batch)."""


@dataclass
class BurstDecision:
    """The gate's verdict. `allow=True` lets the call proceed;
    `allow=False, queue=True` queues it for retry; `allow=False,
    queue=False, park=True` parks it in the divergence queue."""
    allow: bool
    queue: bool = False
    park: bool = False
    reason: str = ""               # "rate_limited" | "circuit_open" | "tenant_quota"
    retry_after_ms: int = 0        # for queue=True; the BurstControl hint


# -- PollingBackstop (11.7) ---------------------------------------------------


@runtime_checkable
class PollingBackstop(Protocol):
    """5-minute polling reconciliation + daily divergence-detection
    job (ADR-0010 §7.1 / §7.2). Catches webhook-delivery gaps and
    surfaces silent cross-platform drift.

    Day-one default: raise NotImplementedError; ships in 11.7.
    The smoke test instantiates a fake that records the
    backfill-completed event so the `sync.backfill.completed`
    audit path is exercised end-to-end.
    """

    def tick(self, tenant_id: str) -> "BackstopResult":
        """Run one polling tick for a tenant. Returns the result
        with the count of backfilled events and any detected
        divergences."""

    def run_daily(self, tenant_id: str) -> "DivergenceSummary":
        """Run the daily divergence detection job."""


@dataclass
class BackstopResult:
    tenant_id: str
    polled_platforms: List[str] = field(default_factory=list)
    backfilled_events: int = 0
    detected_divergences: int = 0
    duration_ms: int = 0
    error: str = ""


@dataclass
class DivergenceSummary:
    tenant_id: str
    divergences: List[DivergenceEntry] = field(default_factory=list)
    audit_divergences: int = 0        # P0 alert if > 0
    duration_ms: int = 0


# -- AuditForwarder (11.8, DAY-ONE) -------------------------------------------


@runtime_checkable
class AuditForwarder(Protocol):
    """Wires the 8 `sync.*` event types (ADR-0010 §8.1) into the
    FORA-36 audit pipeline. Day-one default ships in
    `agents/sync_plane_service/audit_forwarder.py`; sub-task 11.8
    may replace it with the cross-account SQS+SNS bridge without
    changing the protocol.

    The forwarder takes the §8.1 event-type string, the tenant
    id, and a `metadata` dict, and writes the canonical audit
    row shape (`eventType=tool_call, stage=sync_plane,
    tool=sync.<event_type>`) to the underlying audit store.
    """

    def forward(
        self,
        *,
        event_type: str,
        tenant_id: str,
        actor: str,
        entity_id: str = "",
        hlc: str = "",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> str:
        """Forward one sync event. Returns the audit `event_id`
        so the service can correlate the audit row with the
        canonical state update."""


# -- PortRegistry -------------------------------------------------------------


class PortRegistry:
    """The wiring seam. The service holds one `PortRegistry` per
    tenant; the constructor takes the platform-specific adapters
    and the cross-platform ports. Look-ups are by name; missing
    ports raise `KeyError` (the service does not silently fall
    back to a stub — a missing port is a config bug that should
    fail loudly at start-up, not silently at the first
    event).

    The registry is **mutable after construction** because
    sub-tasks 11.2 / 11.4 / 11.5 / 11.7 ship on their own
    timeline and the service must be able to register a late
    arrival without a restart. The mutation API is intentionally
    explicit (`register`) so a misnamed port shows up in code
    review.
    """

    __slots__ = ("_ports",)

    def __init__(self) -> None:
        self._ports: Dict[str, Any] = {}

    def register(self, name: str, port: Any) -> None:
        self._ports[name] = port

    def get(self, name: str) -> Any:
        try:
            return self._ports[name]
        except KeyError as exc:
            raise KeyError(
                f"port {name!r} is not registered; the Sync Plane "
                f"service requires it to be wired at start-up"
            ) from exc

    def has(self, name: str) -> bool:
        return name in self._ports

    def names(self) -> List[str]:
        return list(self._ports.keys())
