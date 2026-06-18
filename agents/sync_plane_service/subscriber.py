"""
Subscriber — the bus-side seam (FORA-252 / 11.1).

Per ADR-0010 §3.2 the Sync Plane is a *consumer* of three Forge
domain-event subjects:

    fora.events.<tenant_id>.issue.updated.v1
    fora.events.<tenant_id>.run.status_changed.v1
    fora.events.<tenant_id>.interaction.created.v1

The `Subscriber` protocol is the abstraction over the bus. The
production impl is a `NatsEventConsumer` (using the
`@fora/event-bus` package shipped by FORA-136); the dev / smoke
impl is `InMemorySubscriber` — a small queue the smoke test
pushes events into. The production wiring swaps the impl at
start-up.

The contract is intentionally narrow:

  * `subscribe(tenant_id, durable_name, on_event)` — register a
    callback that the bus invokes on every accepted event. The
    bus is responsible for dedupe (per ADR-0006 §4.2); the
    callback is the unit of "one inbound event, one apply".
  * `ack(event_id)` / `nack(event_id)` — the bus commit
    boundary. The service acks only after the canonical state
    has been persisted; a nack triggers a redelivery.

The smoke test exercises the in-memory impl because the
production impl requires a real NATS server. The protocol
shape is the same.

Per ADR-0006 §3.2 each event carries an idempotency
`event_id`; the JetStream consumer dedupes on it. The
`InMemorySubscriber` enforces the same contract via the
store's `mark_event_seen` helper.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Protocol, runtime_checkable

from .schema import ReceivedEvent


_log = logging.getLogger("fora.sync_plane_service.subscriber")


# The three Forge domain-event subjects per ADR-0010 §3.2. The
# list is closed in v1; a new subject is a new constant and
# a smoke-test addition.
SUBJECT_ISSUE_UPDATED = "issue.updated.v1"
SUBJECT_RUN_STATUS_CHANGED = "run.status_changed.v1"
SUBJECT_INTERACTION_CREATED = "interaction.created.v1"

ALL_SUBJECTS: tuple = (
    SUBJECT_ISSUE_UPDATED,
    SUBJECT_RUN_STATUS_CHANGED,
    SUBJECT_INTERACTION_CREATED,
)

# The subject prefix (the per-tenant part is added at
# subscribe-time). Per ADR-0006 §3.1 the full subject is
# `fora.events.<tenant>.<type>.v1`.
SUBJECT_PREFIX = "fora.events"


# -- protocol -----------------------------------------------------------------


EventCallback = Callable[[ReceivedEvent], None]


@runtime_checkable
class Subscriber(Protocol):
    """The bus-side seam. Two impls: production
    `NatsEventConsumer` (from `@fora/event-bus`) and dev
    `InMemorySubscriber` (smoke test)."""

    def subscribe(
        self,
        tenant_id: str,
        subjects: tuple,
        on_event: EventCallback,
        *,
        durable_name: str,
    ) -> "Subscription":
        """Register a consumer for the given subjects. Returns
        a `Subscription` handle. The callback runs on the
        bus's thread; it must not block (the service is
        async-friendly, but the smoke test runs synchronously).
        """

    def publish(self, event: ReceivedEvent) -> None:
        """Inject an event into the bus. Production: publishes
        to JetStream. Smoke test: pushes into the
        in-memory queue. The smoke test uses this to
        simulate inbound events."""


@dataclass
class Subscription:
    """A live subscription. `close` detaches the consumer; the
    service calls this on shutdown."""
    subscription_id: str
    tenant_id: str
    subjects: tuple
    durable_name: str

    def close(self) -> None:
        # The default no-op is intentional — the production
        # impl overrides this to drop the JetStream
        # consumer. The smoke test closes by
        # `subscription.subscription_id in
        # in_memory._active`.
        return None


@dataclass
class SubscriptionConfig:
    """The per-tenant subscription config. `durable_name` is the
    JetStream durable consumer name; the production impl
    registers a consumer under this name so a Sync Plane
    restart resumes from the last acknowledged offset (per
    ADR-0006 §4.2)."""
    durable_name: str = "sync-plane"
    max_ack_pending: int = 1000
    ack_wait_ms: int = 30_000


# -- in-memory impl -----------------------------------------------------------


class InMemorySubscriber:
    """The dev / smoke-test subscriber. A small FIFO queue the
    smoke test pushes events into; the service drains the
    queue in a single thread (synchronous for the smoke test).

    The `publish` method dedupes on `event_id` — a redelivered
    event is silently dropped, mirroring the JetStream
    per-subject dedupe contract (ADR-0006 §4.2).

    Thread-safety: a single lock guards the queue and the
    subscription map. The smoke test is single-threaded; the
    production impl is the thread-safe path.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._queue: List[ReceivedEvent] = []
        self._active: Dict[str, Subscription] = {}
        self._callbacks: Dict[str, EventCallback] = {}
        self._seen: Dict[str, str] = {}      # event_id -> ts
        self._counter = 0

    # -- Subscriber protocol -------------------------------------------

    def subscribe(
        self,
        tenant_id: str,
        subjects: tuple,
        on_event: EventCallback,
        *,
        durable_name: str,
    ) -> Subscription:
        with self._lock:
            self._counter += 1
            sub_id = f"sub-{self._counter:08d}"
            sub = Subscription(
                subscription_id=sub_id,
                tenant_id=tenant_id,
                subjects=tuple(subjects),
                durable_name=durable_name,
            )
            self._active[sub_id] = sub
            self._callbacks[sub_id] = on_event
            return sub

    def publish(self, event: ReceivedEvent) -> None:
        """Inject one event. Dedupes on `event_id`. Fires the
        callback synchronously for any active subscription
        that matches the subject."""
        with self._lock:
            if event.event_id in self._seen:
                # Redelivery — no-op (per ADR-0006 §4.2).
                return
            self._seen[event.event_id] = "seen"
            self._queue.append(event)
            # For the smoke test, we fire the callback
            # synchronously. The production impl dispatches
            # on the bus's thread.
            subject_type = self._extract_subject_type(event.subject)
            subs = [
                (sub_id, cb)
                for sub_id, sub in self._active.items()
                if sub.tenant_id == event.tenant_id
                and subject_type in sub.subjects
            ]
        for _sub_id, cb in subs:
            cb(event)

    def ack(self, event_id: str) -> None:
        # No-op for the in-memory impl — the callback fired
        # synchronously; ack is the cue to advance the
        # JetStream consumer offset. The smoke test asserts
        # the event was processed (the canonical state was
        # written); the ack is a no-op in the dev path.
        return None

    def nack(self, event_id: str, *, reason: str = "") -> None:
        # The smoke test never nacks; the production impl
        # would log + JetStream nack here.
        return None

    # -- helpers used by the smoke test --------------------------------

    def drain(self) -> List[ReceivedEvent]:
        """Return and clear the in-memory queue. The smoke
        test uses this to assert the subscriber saw every
        event it published."""
        with self._lock:
            out = list(self._queue)
            self._queue.clear()
            return out

    def close(self, subscription_id: str) -> None:
        with self._lock:
            self._active.pop(subscription_id, None)
            self._callbacks.pop(subscription_id, None)

    def seen_count(self) -> int:
        """Test helper: number of unique event_ids the
        subscriber has seen. Used to assert the redelivery
        contract."""
        with self._lock:
            return len(self._seen)

    def _extract_subject_type(self, subject: str) -> str:
        """`fora.events.<tenant>.<type>.v1` → `<type>.v1`. The
        subject type is what the subscription matches on."""
        parts = subject.split(".")
        # Last two parts are `<type>.v<major>`; the type
        # itself can be multi-segment (`run.status_changed`).
        # The ADR §3.1 names the canonical subject
        # `fora.events.<tenant_id>.<event_type>.v<major>`,
        # so we strip the prefix + tenant and rejoin.
        if len(parts) < 5 or parts[0] != "fora" or parts[1] != "events":
            return subject
        tail = ".".join(parts[3:])
        return tail
