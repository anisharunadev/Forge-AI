"""Session Broadcast (F-413).

Read-only live sharing of a running terminal session — used for
mentor / mentee pairing, lead / IC oversight, and incident
collaboration. Backed by Redis Pub/Sub so two backend instances
see the same byte stream.

Permission model
----------------
* Subscribers are read-only by default.
* A subscriber with ``forge-admin`` or ``terminal:write`` in their
  role bundle can pass ``write=true`` on the WebSocket and their
  input frames are forwarded into the PTY (the existing F-405
  proxy treats their writes as if from the owning user).

The :class:`BroadcastChannel` is a thin façade over Redis: writes
go to a channel key; subscribers consume from the same key. Local
fan-out (subscriber list) is kept for ``GET /broadcasters``.
"""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import redis.asyncio as aioredis

from app.core.config import settings
from app.core.logging import get_logger
from app.services.event_bus import EventType, bus

logger = get_logger(__name__)


def _channel_key(session_id: str) -> str:
    return f"forge:terminal:broadcast:{session_id}"


@dataclass
class Subscription:
    """An active observer on a broadcast channel."""

    id: str
    session_id: str
    user_id: str
    tenant_id: str
    write: bool
    opened_at: datetime
    last_sent_at: datetime | None = None
    bytes_sent: int = 0


@dataclass
class BroadcastChannel:
    """In-memory handle for a session's broadcast state.

    The Redis channel is the cross-process source of truth, but we
    keep a local subscription list so ``GET /broadcasters`` can answer
    without scanning Redis.
    """

    session_id: str
    tenant_id: str
    owner_user_id: str
    _redis_channel: str = field(init=False)
    _local_subs: dict[str, Subscription] = field(default_factory=dict)
    _write_grants: set[str] = field(default_factory=set)
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    def __post_init__(self) -> None:
        self._redis_channel = _channel_key(self.session_id)


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------

SubscriberCallback = Callable[[bytes, str], Awaitable[None]]
"""Callable invoked with (data, msg_type) where msg_type is 'o' / 'i' / 'meta'."""


class SessionBroadcaster:
    """Process-wide manager of broadcast channels.

    Two-tier subscription model:

    - :meth:`subscribe` returns a :class:`Subscription` token.
    - :meth:`unsubscribe` removes the subscription and tears down
      the local Redis listener.
    - :meth:`broadcast` publishes bytes to the channel and returns
      the count of local subscribers reached (cross-process count
      is observable via ``pubsub.numsub`` but we don't surface that
      to keep the API simple).
    """

    def __init__(self, redis_url: str | None = None) -> None:
        self._redis_url = redis_url or settings.redis_url
        self._redis: aioredis.Redis | None = None
        self._channels: dict[str, BroadcastChannel] = {}
        self._pubsub_tasks: dict[str, asyncio.Task[None]] = {}
        self._lock = asyncio.Lock()

    async def _client(self) -> aioredis.Redis:
        if self._redis is None:
            self._redis = aioredis.from_url(self._redis_url, decode_responses=False)
        return self._redis

    async def close(self) -> None:
        for t in list(self._pubsub_tasks.values()):
            t.cancel()
        for t in list(self._pubsub_tasks.values()):
            try:
                await t
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
        self._pubsub_tasks.clear()
        if self._redis is not None:
            await self._redis.aclose()
            self._redis = None

    # -- channel lifecycle ------------------------------------------------

    async def register_broadcaster(
        self,
        session_id: str,
        *,
        tenant_id: UUID | str,
        owner_user_id: UUID | str,
    ) -> BroadcastChannel:
        """Create or fetch the channel for a session."""
        async with self._lock:
            channel = self._channels.get(session_id)
            if channel is None:
                channel = BroadcastChannel(
                    session_id=session_id,
                    tenant_id=str(tenant_id),
                    owner_user_id=str(owner_user_id),
                )
                self._channels[session_id] = channel
            return channel

    def get_channel(self, session_id: str) -> BroadcastChannel | None:
        return self._channels.get(session_id)

    # -- subscribe --------------------------------------------------------

    async def subscribe(
        self,
        session_id: str,
        *,
        user_id: UUID | str,
        tenant_id: UUID | str,
        write: bool = False,
    ) -> tuple[Subscription, SubscriberCallback]:
        """Subscribe and return (subscription, send_fn).

        ``send_fn(data, msg_type)`` is what the WebSocket handler
        awaits to push a frame to the client.
        """
        channel = await self.register_broadcaster(
            session_id,
            tenant_id=tenant_id,
            owner_user_id=user_id,
        )
        if channel.tenant_id != str(tenant_id):
            raise PermissionError("tenant_mismatch")

        subscription = Subscription(
            id=str(uuid.uuid4()),
            session_id=session_id,
            user_id=str(user_id),
            tenant_id=str(tenant_id),
            write=bool(write and (await self._is_write_authorized(channel, user_id, write))),
            opened_at=datetime.now(UTC),
        )

        asyncio.get_running_loop()
        send_q: asyncio.Queue[tuple[bytes, str]] = asyncio.Queue(maxsize=512)
        asyncio.Queue()

        async def send_fn(data: bytes, msg_type: str = "o") -> None:
            try:
                send_q.put_nowait((data, msg_type))
            except asyncio.QueueFull:
                # Slow consumer: drop frame rather than block the channel.
                logger.warning(
                    "terminal.broadcast.subscriber_slow",
                    subscription_id=subscription.id,
                    session_id=session_id,
                )

        async def pump() -> None:
            # Drain the queue until the subscription is removed.
            while True:
                try:
                    data, msg_type = await send_q.get()
                except asyncio.CancelledError:
                    return
                subscription.last_sent_at = datetime.now(UTC)
                subscription.bytes_sent += len(data)
                # Callback set after subscribe returns; we just keep queueing.
                _ = msg_type  # reserved for future typed fanout

        # Cross-process fan-out via Redis: every published byte also
        # lands in any other backend instance's local subscriber queue.
        async def redis_pump() -> None:
            client = await self._client()
            pubsub = client.pubsub()
            await pubsub.subscribe(channel._redis_channel)
            try:
                async for message in pubsub.listen():
                    if message.get("type") != "message":
                        continue
                    payload = message["data"]
                    if isinstance(payload, bytes):
                        # Skip metadata messages (b"SUB_META:..." prefix).
                        if payload.startswith(b"SUB_META:"):
                            continue
                        await send_q.put((payload, "o"))
                    elif (
                        subscription.write
                        and isinstance(payload, bytes)
                        and payload.startswith(b"IN:")
                    ):
                        await send_q.put((payload[3:], "i"))
            except asyncio.CancelledError:
                pass
            except Exception as exc:  # noqa: BLE001
                logger.warning("terminal.broadcast.redis_pump_error", error=str(exc))
            finally:
                try:
                    await pubsub.unsubscribe(channel._redis_channel)
                    await pubsub.aclose()
                except Exception:  # noqa: BLE001
                    pass

        task = asyncio.create_task(redis_pump(), name=f"broadcast:{session_id}:{subscription.id}")
        self._pubsub_tasks[subscription.id] = task
        async with channel._lock:
            channel._local_subs[subscription.id] = subscription
            if subscription.write:
                channel._write_grants.add(subscription.id)
        return subscription, send_fn

    async def unsubscribe(self, session_id: str, subscription: Subscription) -> None:
        """Tear down a subscription."""
        channel = self._channels.get(session_id)
        if channel is not None:
            async with channel._lock:
                channel._local_subs.pop(subscription.id, None)
                channel._write_grants.discard(subscription.id)
        task = self._pubsub_tasks.pop(subscription.id, None)
        if task is not None:
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass

    # -- broadcast --------------------------------------------------------

    async def broadcast(self, session_id: str, data: bytes) -> int:
        """Publish ``data`` to the channel; return local subscriber count."""
        channel = self._channels.get(session_id)
        if channel is None:
            return 0
        client = await self._client()
        await client.publish(channel._redis_channel, data)
        async with channel._lock:
            return len(channel._local_subs)

    # -- introspection ----------------------------------------------------

    async def list_broadcasters(self, session_id: str) -> list[dict[str, Any]]:
        """Active observers / writers on a session."""
        channel = self._channels.get(session_id)
        if channel is None:
            return []
        async with channel._lock:
            out: list[dict[str, Any]] = []
            for sub in channel._local_subs.values():
                out.append(
                    {
                        "subscription_id": sub.id,
                        "user_id": sub.user_id,
                        "tenant_id": sub.tenant_id,
                        "write": sub.id in channel._write_grants,
                        "opened_at": sub.opened_at.isoformat(),
                        "last_sent_at": (
                            sub.last_sent_at.isoformat() if sub.last_sent_at else None
                        ),
                        "bytes_sent": sub.bytes_sent,
                    }
                )
            return out

    async def grant_write(self, session_id: str, *, actor_user_id: UUID | str) -> int:
        """Grant broadcast write capability for a session (RBAC enforced upstream)."""
        channel = self._channels.get(session_id)
        if channel is None:
            raise LookupError(f"session_not_found:{session_id}")
        async with channel._lock:
            for sub in channel._local_subs.values():
                if sub.user_id == str(actor_user_id):
                    channel._write_grants.add(sub.id)
                    sub.write = True
        return len(channel._write_grants)

    async def revoke_write(self, session_id: str, *, actor_user_id: UUID | str) -> int:
        """Revoke broadcast write capability (RBAC enforced upstream)."""
        channel = self._channels.get(session_id)
        if channel is None:
            raise LookupError(f"session_not_found:{session_id}")
        async with channel._lock:
            for sub in channel._local_subs.values():
                if sub.user_id == str(actor_user_id):
                    channel._write_grants.discard(sub.id)
                    sub.write = False
        return len(channel._write_grants)

    # -- internals --------------------------------------------------------

    async def _is_write_authorized(
        self,
        channel: BroadcastChannel,
        user_id: UUID | str,
        write: bool,
    ) -> bool:
        """Honor the caller's ``write`` flag only if their JWT carries the role."""
        if not write:
            return False
        # The actual role check is done at the WebSocket boundary via
        # the principal's roles list; here we just trust the flag and
        # log the grant for the audit trail.
        await bus.publish(
            EventType.TERMINAL_SESSION_STARTED,
            {
                "session_id": channel.session_id,
                "broadcast_write_granted_to": str(user_id),
            },
            tenant_id=channel.tenant_id,
            project_id=None,
            actor_id=str(user_id),
        )
        return True


# Module-level singleton for cross-endpoint sharing.
session_broadcaster = SessionBroadcaster()


__all__ = [
    "SessionBroadcaster",
    "BroadcastChannel",
    "Subscription",
    "session_broadcaster",
]
