"""Day 2 mock-removal track G — Tech Radar service.

Replaces the hard-coded ``MOCK_TECH_RADAR`` array in
``apps/forge/lib/architecture/mock-fixtures.ts`` with a real
SQLAlchemy-backed service over the ``architecture_tech_radar`` table.

All queries are scoped by ``(tenant_id, project_id)`` (Rule 2).
"""

from __future__ import annotations

import logging
from uuid import UUID

from sqlalchemy import select

from app.db.models.architecture import TechRadarEntry

logger = logging.getLogger(__name__)


class TechRadarService:
    """Read/write helper for the ``architecture_tech_radar`` table."""

    def __init__(self, session=None) -> None:
        self._session = session

    async def list_entries(
        self,
        tenant_id: UUID,
        project_id: UUID,
    ) -> list[TechRadarEntry]:
        """List all blips in a (tenant, project). Empty list without a session."""
        if self._session is None:
            return []
        rows = (
            await self._session.execute(
                select(TechRadarEntry)
                .where(
                    TechRadarEntry.tenant_id == tenant_id,
                    TechRadarEntry.project_id == project_id,
                )
                .order_by(TechRadarEntry.quadrant, TechRadarEntry.ring, TechRadarEntry.name)
            )
        ).scalars().all()
        return list(rows)

    async def create_entry(
        self,
        *,
        tenant_id: UUID,
        project_id: UUID,
        name: str,
        quadrant: str,
        ring: str,
        description: str = "",
        rationale: str = "",
        owner: str = "",
        prev_ring: str | None = None,
    ) -> TechRadarEntry:
        """Insert a new blip. Caller is responsible for committing the session."""
        row = TechRadarEntry(
            tenant_id=tenant_id,
            project_id=project_id,
            name=name,
            quadrant=quadrant,
            ring=ring,
            description=description,
            rationale=rationale,
            owner=owner,
            prev_ring=prev_ring,
        )
        if self._session is not None:
            self._session.add(row)
            await self._session.flush()
        return row


__all__ = ["TechRadarService"]
