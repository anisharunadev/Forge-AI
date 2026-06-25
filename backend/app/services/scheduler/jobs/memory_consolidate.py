"""Nightly memory consolidation scheduler job (Pillar 1 — Phase 3).

Iterates all tenants and rolls the past 24h of ``persona_memory_history``
rows into the stable per-tenant file under
``tenants/<slug>/workspace/memory/personas/<persona>/<key>.md``.
"""

from __future__ import annotations

from sqlalchemy import select

from app.core.logging import get_logger
from app.db.models.tenant import Tenant
from app.db.session import get_session_factory
from app.services.memory.persona_store import PersonaMemoryStore

logger = get_logger(__name__)


async def nightly_memory_consolidate() -> None:
    """Scheduler entry point — runs once per cron tick, iterates tenants."""
    factory = get_session_factory()
    async with factory() as session:
        tenants = list((await session.execute(select(Tenant))).scalars().all())

    store = PersonaMemoryStore()
    for tenant in tenants:
        try:
            n = await store.consolidate(tenant_id=str(tenant.id))
            logger.info(
                "persona_memory.consolidated",
                tenant_id=str(tenant.id),
                keys_merged=n,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "persona_memory.consolidate_failed",
                tenant_id=str(tenant.id),
                error=str(exc),
            )


__all__ = ["nightly_memory_consolidate"]