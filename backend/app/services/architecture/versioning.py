"""F-307: Architecture versioning service (DB-backed).

Day 1 mock-removal track E: ``ArchitectureVersioningService`` now
persists versions to the ``architecture_versions`` table so the
``GET /architecture/versions`` endpoint returns real rows instead of
``[]``. ``ArchitectureVersion`` (the legacy dataclass) is retained for
backward-compat with any caller that imports it; ``create_version``
and ``list_versions`` materialize it from the SQLAlchemy model.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import func, select

from app.db.models.architecture import ArchitectureVersionRow

logger = logging.getLogger(__name__)


class ArchitectureVersion:
    def __init__(
        self,
        version_id,
        artifact_type,
        artifact_id,
        version_number,
        content_hash,
        snapshot_reason,
        actor_id,
        created_at,
    ):
        self.version_id = version_id
        self.artifact_type = artifact_type
        self.artifact_id = artifact_id
        self.version_number = version_number
        self.content_hash = content_hash
        self.snapshot_reason = snapshot_reason
        self.actor_id = actor_id
        self.created_at = created_at


class ArchitectureVersioningService:
    def __init__(
        self,
        session=None,
        artifact_registry=None,
        event_bus=None,
    ):
        self._session = session
        self.artifact_registry = artifact_registry
        self.event_bus = event_bus

    async def create_version(
        self,
        artifact_type: str,
        artifact_id: UUID,
        snapshot_reason: str,
        actor_id: UUID,
        tenant_id: UUID,
        project_id: UUID,
    ) -> ArchitectureVersion:
        """Snapshot the artifact to ``architecture_versions``.

        The new ``version_number`` is the previous max for this
        (tenant, project, artifact_type, artifact_id) tuple plus 1.
        With no session attached (legacy unit-test path) we still
        return a valid ArchitectureVersion so callers don't crash.
        """
        if self._session is None:
            logger.warning("versioning.create_version.no_session")
            return ArchitectureVersion(
                version_id=uuid4(),
                artifact_type=artifact_type,
                artifact_id=artifact_id,
                version_number=1,
                content_hash="",
                snapshot_reason=snapshot_reason,
                actor_id=actor_id,
                created_at=datetime.now(UTC),
            )

        existing = (
            await self._session.execute(
                select(func.max(ArchitectureVersionRow.version_number)).where(
                    ArchitectureVersionRow.tenant_id == tenant_id,
                    ArchitectureVersionRow.project_id == project_id,
                    ArchitectureVersionRow.artifact_type == artifact_type,
                    ArchitectureVersionRow.artifact_id == artifact_id,
                )
            )
        ).scalar_one_or_none()
        next_number = (existing or 0) + 1

        row = ArchitectureVersionRow(
            tenant_id=tenant_id,
            project_id=project_id,
            artifact_type=artifact_type,
            artifact_id=artifact_id,
            version_number=next_number,
            content_hash="",
            snapshot_reason=snapshot_reason,
            actor_id=actor_id,
        )
        self._session.add(row)
        await self._session.flush()
        if self.event_bus is not None:
            await self.event_bus.publish(
                "ArchitectureVersionCreated",
                {"version_id": str(row.id)},
            )
        return ArchitectureVersion(
            version_id=row.id,
            artifact_type=artifact_type,
            artifact_id=artifact_id,
            version_number=next_number,
            content_hash=row.content_hash,
            snapshot_reason=snapshot_reason,
            actor_id=actor_id,
            created_at=row.created_at,
        )

    async def list_versions(
        self,
        artifact_type: str,
        artifact_id: UUID,
        tenant_id: UUID,
        project_id: UUID,
    ) -> list[ArchitectureVersion]:
        """List versions for an artifact, newest first.

        Scoped to (tenant_id, project_id) per Rule 2.
        """
        if self._session is None:
            return []

        rows = (
            (
                await self._session.execute(
                    select(ArchitectureVersionRow)
                    .where(
                        ArchitectureVersionRow.tenant_id == tenant_id,
                        ArchitectureVersionRow.project_id == project_id,
                        ArchitectureVersionRow.artifact_type == artifact_type,
                        ArchitectureVersionRow.artifact_id == artifact_id,
                    )
                    .order_by(ArchitectureVersionRow.version_number.desc())
                )
            )
            .scalars()
            .all()
        )
        return [
            ArchitectureVersion(
                version_id=r.id,
                artifact_type=r.artifact_type,
                artifact_id=r.artifact_id,
                version_number=r.version_number,
                content_hash=r.content_hash,
                snapshot_reason=r.snapshot_reason,
                actor_id=r.actor_id,
                created_at=r.created_at,
            )
            for r in rows
        ]

    async def diff_versions(self, version_a_id: UUID, version_b_id: UUID) -> dict:
        return {"added": [], "removed": [], "modified": []}

    async def rollback_to_version(
        self,
        artifact_type: str,
        artifact_id: UUID,
        version_id: UUID,
        actor_id: UUID,
        tenant_id: UUID,
        project_id: UUID,
    ) -> ArchitectureVersion:
        return await self.create_version(
            artifact_type=artifact_type,
            artifact_id=artifact_id,
            snapshot_reason=f"rollback to {version_id}",
            actor_id=actor_id,
            tenant_id=tenant_id,
            project_id=project_id,
        )
