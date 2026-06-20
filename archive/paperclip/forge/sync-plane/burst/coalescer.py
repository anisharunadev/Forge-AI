"""
Composite-edit coalescing.

ADR-0010 §7.1 (comment-storm row) — "Burst control: coalesce N consecutive
comments on the same remote into one composite edit; per-tenant configurable".
ADR-0010 §9 sub-task #6 — "composite-edit coalescing"
FORA-267 AC: "multiple edits within a 250 ms window collapse to one outbound
event."

Design
------
The coalescer is a *staging buffer*, not a queue.  When `accept()` is called:

    * If no matching buffer exists for the (tenant, platform, remote_issue,
      event_kind) key, a new buffer opens at `now_ms`.
    * Subsequent events that arrive within `window_ms` are *merged* into the
      open buffer; their `payload` overlay is applied (last-write-wins on
      colliding keys; `comment` events accumulate body lines).
    * `flush_due(now_ms)` returns all buffers whose window has expired.
    * The controller calls `flush_due()` on every tick (and on shutdown).

The merge rule for `event_kind`:
    "comment"      — bodies are joined with '\n\n---\n\n'; the first
                     `enqueued_at_ms` wins; coalesced_ids accumulate
    "field_edit"   — payload keys are merged shallow last-write-wins
    "transition"   — NEVER coalesced (idempotency on transitions is hard);
                     these flush immediately with no merge

Audit
-----
On every merge that increases `coalesced_count` beyond 1, the controller
emits a `sync.burst_coalesce` audit event with the merged_event_id and the
count.  See `audit.py`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from .queue import Lane, OutboundEvent


@dataclass
class CoalesceResult:
    """One flushed buffer.

    `merged_count` is the number of input events that contributed.  When
    `merged_count == 1` the event is passed through unchanged; the
    controller does not emit a `sync.burst_coalesce` audit row in that case.
    """
    event: OutboundEvent
    merged_count: int


CoalesceKey = Tuple[str, str, str, str]   # tenant, platform, remote_issue, event_kind


# Event kinds that are *not* eligible for coalescing.  Transitions are
# domain-sensitive; coalescing two "in_progress → done" into one would
# lose the intermediate state visible to consumers.
NON_COALESCABLE_KINDS = frozenset({"transition"})


class Coalescer:
    """Per (tenant, platform) staging buffer.

    The caller picks the window length (default 250 ms per FORA-267 AC).
    The coalescer is *not* aware of the queue — the controller pulls
    flushed events from the coalescer and enqueues them.
    """

    DEFAULT_WINDOW_MS: int = 250

    def __init__(self, window_ms: int = DEFAULT_WINDOW_MS) -> None:
        if window_ms <= 0:
            raise ValueError("window_ms must be > 0")
        self._window_ms = window_ms
        self._buffers: Dict[CoalesceKey, _Buffer] = {}

    @property
    def window_ms(self) -> int:
        return self._window_ms

    def accept(self, event: OutboundEvent, now_ms: float) -> Optional[CoalesceResult]:
        """Stage an event.

        Returns a `CoalesceResult` immediately if the event is non-coalescable
        (transitions, system events) and should bypass the buffer; otherwise
        returns None and the event is staged.
        """
        # Non-coalescable kinds and the system lane always flush immediately.
        if event.event_kind in NON_COALESCABLE_KINDS or event.lane is Lane.SYSTEM:
            return CoalesceResult(event=event, merged_count=1)

        key: CoalesceKey = (
            event.tenant_id,
            event.platform,
            event.remote_issue_id,
            event.event_kind,
        )
        buf = self._buffers.get(key)
        if buf is None:
            self._buffers[key] = _Buffer(
                key=key,
                event=event,
                opened_at_ms=now_ms,
                count=1,
                contributing_ids=[event.id] if event.id else [],
            )
            return None
        buf.merge(event)
        return None

    def flush_due(self, now_ms: float) -> List[CoalesceResult]:
        """Return and clear every buffer whose window has expired."""
        out: List[CoalesceResult] = []
        expired_keys: List[CoalesceKey] = []
        for key, buf in self._buffers.items():
            if (now_ms - buf.opened_at_ms) >= self._window_ms:
                merged_event = buf.event
                merged_event.coalesced_ids = list(buf.contributing_ids)
                out.append(CoalesceResult(event=merged_event, merged_count=buf.count))
                expired_keys.append(key)
        for key in expired_keys:
            del self._buffers[key]
        return out

    def flush_all(self) -> List[CoalesceResult]:
        """Force-flush every open buffer (used at shutdown)."""
        out = [
            CoalesceResult(event=buf.event, merged_count=buf.count)
            for buf in self._buffers.values()
        ]
        for r in out:
            r.event.coalesced_ids = list(
                self._buffers[
                    (r.event.tenant_id, r.event.platform, r.event.remote_issue_id, r.event.event_kind)
                ].contributing_ids
            )
        self._buffers.clear()
        return out

    @property
    def open_buffer_count(self) -> int:
        return len(self._buffers)


@dataclass
class _Buffer:
    key: CoalesceKey
    event: OutboundEvent
    opened_at_ms: float
    count: int
    contributing_ids: List[str] = field(default_factory=list)

    def merge(self, incoming: OutboundEvent) -> None:
        self.count += 1
        if incoming.id:
            self.contributing_ids.append(incoming.id)
        kind = self.event.event_kind
        if kind == "comment":
            base_body = self.event.payload.get("body", "")
            inc_body = incoming.payload.get("body", "")
            joined = base_body
            if inc_body:
                joined = (
                    inc_body if not joined
                    else f"{joined}\n\n---\n\n{inc_body}"
                )
            self.event.payload["body"] = joined
            # Preserve the first author; record incoming author in metadata.
            authors = self.event.payload.setdefault("coalesced_authors", [])
            inc_author = incoming.payload.get("author")
            if inc_author and inc_author not in authors:
                authors.append(inc_author)
        elif kind == "field_edit":
            # Shallow last-write-wins on the field overlay.
            overlay = self.event.payload.setdefault("fields", {})
            for k, v in incoming.payload.get("fields", {}).items():
                overlay[k] = v
        # else: should not happen — NON_COALESCABLE_KINDS bypass merge.
