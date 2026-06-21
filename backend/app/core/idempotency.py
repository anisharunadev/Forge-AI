"""Idempotency-Key handling for non-idempotent endpoints.

Clients supply `Idempotency-Key` on POST/PUT/PATCH; we cache the response
in Redis keyed by (tenant_id, route, key) so retries don't double-charge
or duplicate artifact writes.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

import redis.asyncio as redis

from app.core.config import settings

_client: redis.Redis | None = None


def _get_client() -> redis.Redis:
    global _client
    if _client is None:
        _client = redis.from_url(settings.redis_url, decode_responses=True)
    return _client


def make_idempotency_key(tenant_id: str, route: str, client_key: str) -> str:
    """Namespace a client-supplied idempotency key by tenant + route."""
    raw = f"{tenant_id}|{route}|{client_key}".encode()
    return "forge:idem:" + hashlib.sha256(raw).hexdigest()


async def get_cached_response(key: str) -> dict[str, Any] | None:
    """Return a cached response body if present, else None."""
    client = _get_client()
    raw = await client.get(key)
    if raw is None:
        return None
    return json.loads(raw)


async def store_response(key: str, body: dict[str, Any], ttl_seconds: int = 86_400) -> None:
    """Cache a response under an idempotency key (default 24h TTL)."""
    client = _get_client()
    await client.set(key, json.dumps(body, default=str), ex=ttl_seconds)
