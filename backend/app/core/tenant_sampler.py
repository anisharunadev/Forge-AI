"""Tenant-scoped trace sampler (Phase 5 -- Observability rule O2).

The OTel SDK calls ``TenantSampler.should_sample`` on every root span.
We read the current ``tenant_id`` from a contextvar (set by
``TenantContextMiddleware``) and look up the per-tenant sampling rate
from a small in-process cache that is itself backed by Redis (TTL
30s) so a noisy neighbor's override does not slow the hot path.

The local cache is the *source of truth at sample time* -- the Redis
hit is only consulted when the in-process entry expires. The default
rate is 100% (AlwaysOn behavior preserved for any tenant without a
``tenant_settings`` row).
"""

from __future__ import annotations

import json
import time
import uuid
from typing import Any

import redis.asyncio as aioredis
from opentelemetry.sdk.trace.sampling import (
    Decision,
    ParentBased,
    Sampler,
    SamplingResult,
    TraceIdRatioBased,
)
from opentelemetry.trace import Link, SpanKind
from opentelemetry.trace.span import TraceState
from opentelemetry.util.types import Attributes

from app.core.logging import tenant_id_ctx

_TTL_SECONDS = 30
# ponytail: local dict keyed by tenant_id; updated by TenantSettingsCache.get().
# Shape: (expires_at_monotonic, sampling_rate, debug_force_sample).
_LOCAL: dict[str, tuple[float, float, bool]] = {}


class TenantSettingsCache:
    """Read-through cache for the ``tenant_settings`` row, mirrored to Redis.

    The DB is only consulted on a cache miss; subsequent reads in the
    same process serve from memory for ``_TTL_SECONDS``. Redis is
    used as a side channel so a debug toggle in the Admin UI
    propagates to other workers within a few seconds.
    """

    def __init__(self, redis: aioredis.Redis | None, session_factory: Any) -> None:
        self._redis = redis
        self._session_factory = session_factory

    async def get(self, tenant_id: uuid.UUID | str | None) -> tuple[float, bool]:
        """Return ``(sampling_rate, debug_force_sample)`` for ``tenant_id``.

        Defaults to ``(1.0, False)`` when no row exists; the default
        is the safe choice -- AlwaysOn is what the SDK already does
        when no sampler is configured.
        """
        key = str(tenant_id) if tenant_id is not None else ""
        now = time.monotonic()
        cached = _LOCAL.get(key)
        if cached and cached[0] > now:
            return cached[1], cached[2]

        rate, debug = 1.0, False
        if self._redis is not None and key:
            try:
                raw = await self._redis.get(f"tenset:{key}")
            except Exception:  # noqa: BLE001
                raw = None
            if raw:
                try:
                    data = json.loads(raw)
                    rate = float(data.get("rate", 1.0))
                    debug = bool(data.get("debug", False))
                except (ValueError, TypeError):
                    rate, debug = 1.0, False
            else:
                rate, debug = await self._load_db(tenant_id)
                try:
                    await self._redis.set(
                        f"tenset:{key}",
                        json.dumps({"rate": rate, "debug": debug}),
                        ex=_TTL_SECONDS,
                    )
                except Exception:  # noqa: BLE001
                    pass
        elif key:
            rate, debug = await self._load_db(tenant_id)

        _LOCAL[key] = (now + _TTL_SECONDS, rate, debug)
        return rate, debug

    async def _load_db(self, tenant_id: uuid.UUID | str | None) -> tuple[float, bool]:
        from app.db.models.tenant_settings import TenantSettings

        if tenant_id is None or self._session_factory is None:
            return 1.0, False
        try:
            tid = uuid.UUID(str(tenant_id))
        except (ValueError, TypeError):
            return 1.0, False
        try:
            async with self._session_factory() as session:
                row = await session.get(TenantSettings, tid)
        except Exception:  # noqa: BLE001
            return 1.0, False
        if row is None:
            return 1.0, False
        return float(row.sampling_rate), bool(row.debug_force_sample)

    def invalidate(self, tenant_id: uuid.UUID | str | None) -> None:
        """Drop the in-process entry so the next call reloads from Redis/DB."""
        key = str(tenant_id) if tenant_id is not None else ""
        _LOCAL.pop(key, None)


class TenantSampler(Sampler):
    """Routes sampling decision through ``TenantSettingsCache``.

    Synchronous ``should_sample`` signature is required by the OTel
    SDK. The cache lookup is therefore served from the module-level
    ``_LOCAL`` dict; ``TenantSettingsCache.get`` is the producer.
    """

    def __init__(self, cache: TenantSettingsCache | None = None) -> None:
        self._cache = cache

    def get_description(self) -> str:
        return "TenantSampler(rate-by-tenant)"

    def should_sample(  # type: ignore[override]
        self,
        parent_context: Any,
        trace_id: int,
        name: str,
        kind: SpanKind = SpanKind.INTERNAL,
        attributes: Attributes = None,
        links: list[Link] | None = None,
        trace_state: TraceState | None = None,
    ) -> SamplingResult:
        tenant_id = tenant_id_ctx.get()
        key = str(tenant_id) if tenant_id is not None else ""
        entry = _LOCAL.get(key)
        if entry is None:
            rate, debug = 1.0, False
        else:
            rate, debug = entry[1], entry[2]
        if debug:
            return SamplingResult(Decision.RECORD_AND_SAMPLE)
        # ponytail: per-tenant TraceIdRatioBased is created on every
        # call. Cheap, but if profiling shows it on the hot path we
        # can cache it keyed on (tenant_id, rate).
        inner = TraceIdRatioBased(rate)
        return inner.should_sample(
            parent_context, trace_id, name, kind, attributes, links, trace_state
        )


def make_sampler(cache: TenantSettingsCache | None = None) -> Sampler:
    """Wrap :class:`TenantSampler` in ``ParentBased`` so child spans
    inherit the parent's decision.
    """
    return ParentBased(TenantSampler(cache))


__all__ = [
    "TenantSampler",
    "TenantSettingsCache",
    "make_sampler",
]
