"""Tenant directory helpers (Pillar 1 — Phase 3).

Single source of truth for ``tenant_id → slug`` lookups. The persona
memory stable files live under
``tenants/<slug>/workspace/memory/personas/<persona>/<key>.md`` so
every read/write needs the slug resolved first.

The lookup is cached in-process for the lifetime of one request;
tests can monkeypatch the module-level cache or the
``get_tenant_slug`` function directly.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import select

from app.core.logging import get_logger
from app.db.models.tenant import Tenant
from app.db.session import get_session_factory

logger = get_logger(__name__)


# Process-local cache. Bounded by tenant count; cleared by tests
# via ``_reset_cache()``.
_TENANT_SLUG_CACHE: dict[str, str | None] = {}


def _reset_cache() -> None:
    """Clear the in-process slug cache. Used by tests."""
    _TENANT_SLUG_CACHE.clear()


async def get_tenant_slug(tenant_id: UUID | str | None) -> str | None:
    """Resolve ``tenant_id`` to its slug. Returns None when unknown."""
    if tenant_id is None or tenant_id == "":
        return None
    key = str(tenant_id)
    if key in _TENANT_SLUG_CACHE:
        return _TENANT_SLUG_CACHE[key]
    factory = get_session_factory()
    async with factory() as session:
        stmt = select(Tenant).where(Tenant.id == key)
        tenant: Any | None = (await session.execute(stmt)).scalars().first()
    slug = str(tenant.slug) if tenant is not None else None
    _TENANT_SLUG_CACHE[key] = slug
    return slug


def get_tenant_slug_sync(tenant_id: UUID | str | None) -> str | None:
    """Best-effort sync lookup. Returns the cached value or None.

    Use this only on the synchronous read path (e.g. inside
    ``PersonaMemoryStore.read`` where we cannot await). The cache is
    populated by the next ``await get_tenant_slug(...)`` call.
    """
    if tenant_id is None or tenant_id == "":
        return None
    return _TENANT_SLUG_CACHE.get(str(tenant_id))


__all__ = ["get_tenant_slug", "get_tenant_slug_sync", "_reset_cache"]