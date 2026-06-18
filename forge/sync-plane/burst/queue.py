"""
Per-platform adapter queue with priority lanes.

ADR-0010 §7.1 — "Queue in `sync.outbox.<platform>`"
ADR-0010 §9 sub-task #6 — "per-platform adapter queue"

Three priority lanes per platform:
    SYSTEM         — sync.platform.degraded, sync.audit.* — never coalesce, never drop
    AGENT          — comment/edit from a FORA agent
    HUMAN          — write-back from a human-curated UI action; highest comment priority

`HUMAN` is intentionally *highest* of the three (lower numeric value) — when a
human curates an outbound event we never want a routine agent storm to push
it to the back of the queue.  `SYSTEM` outranks both because it carries the
audit / degraded events that the SOC 2 daily-sample (risk_register §3) checks.

FIFO inside each lane; cross-lane order is lane priority.
"""

from __future__ import annotations

import enum
import heapq
import itertools
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple


class Lane(enum.IntEnum):
    """Lane priority — *lower* int is *higher* priority for the heap."""
    SYSTEM = 0   # audit / degraded / circuit events
    HUMAN = 1    # human-curated write-back
    AGENT = 2    # FORA-agent outbound


@dataclass
class OutboundEvent:
    """One outbound event headed for a platform adapter.

    Fields are kept narrow so this can move through JetStream as JSON.
    The controller fills `enqueued_at_ms` on submit; the adapter consumes
    `payload` (opaque to the burst surface).
    """
    tenant_id: str
    platform: str                       # "jira" / "github" / "clickup"
    remote_issue_id: str                # platform-native id; coalescing key
    event_kind: str                     # "comment" / "field_edit" / "transition"
    lane: Lane
    payload: Dict[str, Any] = field(default_factory=dict)
    enqueued_at_ms: float = 0.0
    coalesced_ids: List[str] = field(default_factory=list)
    # Routing key for tests / diagnostics — not part of the wire format.
    id: str = ""


class AdapterQueue:
    """One queue per (tenant_id, platform).

    The queue is a min-heap of `(lane, enqueue_seq, event)` so cross-lane
    order is lane priority and intra-lane order is FIFO insertion.  We use
    `itertools.count` for the tiebreaker because `OutboundEvent` is not
    naturally comparable.
    """

    def __init__(self, max_depth: int = 10_000) -> None:
        if max_depth <= 0:
            raise ValueError("max_depth must be > 0")
        self._max_depth = max_depth
        self._heap: List[Tuple[int, int, OutboundEvent]] = []
        self._seq = itertools.count()
        self._size_by_lane: Dict[Lane, int] = {l: 0 for l in Lane}

    def __len__(self) -> int:
        return len(self._heap)

    @property
    def depth(self) -> int:
        return len(self._heap)

    @property
    def is_empty(self) -> bool:
        return not self._heap

    def lane_size(self, lane: Lane) -> int:
        return self._size_by_lane[lane]

    def enqueue(self, event: OutboundEvent) -> bool:
        """Enqueue an event.  Returns False on overflow (caller must
        treat as 5xx and trip the breaker).  System lane is never
        dropped, even at max_depth — system events are the audit trail."""
        if self.depth >= self._max_depth and event.lane is not Lane.SYSTEM:
            return False
        heapq.heappush(
            self._heap,
            (int(event.lane), next(self._seq), event),
        )
        self._size_by_lane[event.lane] += 1
        return True

    def dequeue(self) -> Optional[OutboundEvent]:
        """Pop the highest-priority event, or None when empty."""
        if not self._heap:
            return None
        _, _, event = heapq.heappop(self._heap)
        self._size_by_lane[event.lane] -= 1
        return event

    def peek_lane(self) -> Optional[Lane]:
        """Return the lane of the next event, without popping."""
        if not self._heap:
            return None
        return Lane(self._heap[0][0])
