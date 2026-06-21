"""Artifact registry — typed, append-only, versioned (Rule 4 + DL-027).

The only sanctioned way to insert or supersede an Artifact. Updates
and deletes are rejected at the ORM layer (see artifact.py).
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.db.models.artifact import Artifact, ArtifactStatus
from app.db.session import get_session_factory
from app.services.event_bus import EventType, bus as default_bus

logger = get_logger(__name__)


def _content_hash(payload: dict[str, Any]) -> str:
    """SHA-256 of the JSON-canonical payload — deterministic across processes."""
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


class ArtifactRegistry:
    """The only sanctioned writer/reader for Artifacts.

    Direct ORM insert/update on Artifact is forbidden by event listener;
    route everything through this class so supersedes are atomic and
    events are emitted.
    """

    def __init__(self, bus: Any | None = None) -> None:
        self._bus = bus or default_bus

    async def create(
        self,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str,
        type: str,
        payload: dict[str, Any],
        created_by: UUID | str,
        status: ArtifactStatus = ArtifactStatus.DRAFT,
        actor_id: UUID | str | None = None,
    ) -> Artifact:
        """Insert a new Artifact version. Never overwrites."""
        factory = get_session_factory()
        async with factory() as session:
            # Determine next version number for (tenant, project, type).
            version_stmt = (
                select(Artifact)
                .where(
                    Artifact.tenant_id == str(tenant_id),
                    Artifact.project_id == str(project_id),
                    Artifact.type == type,
                )
                .order_by(Artifact.version.desc())
                .limit(1)
            )
            previous = (await session.execute(version_stmt)).scalar_one_or_none()
            next_version = (previous.version + 1) if previous else 1

            artifact = Artifact(
                tenant_id=str(tenant_id),
                project_id=str(project_id),
                type=type,
                version=next_version,
                status=status,
                created_by=str(created_by),
                content_hash=_content_hash(payload),
                payload=payload,
            )
            session.add(artifact)
            await session.commit()
            await session.refresh(artifact)

        await self._bus.publish(
            EventType.ARTIFACT_CREATED,
            {
                "artifact_id": str(artifact.id),
                "type": artifact.type,
                "version": artifact.version,
                "content_hash": artifact.content_hash,
            },
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=actor_id,
        )
        logger.info(
            "artifact.created",
            tenant_id=str(tenant_id),
            type=type,
            version=next_version,
            id=str(artifact.id),
        )
        return artifact

    async def supersede(
        self,
        *,
        artifact_id: UUID | str,
        new_payload: dict[str, Any],
        actor_id: UUID | str | None = None,
    ) -> Artifact:
        """Atomically mark the given artifact SUPERSEDED and insert a new version.

        Updates the previous row's `superseded_by_id` and `superseded_at`
        (only allowed mutation — handled via raw SQL to bypass the
        before_update listener which is wired for general ORM use).
        """
        from sqlalchemy import text

        factory = get_session_factory()
        async with factory() as session:
            current = await session.get(Artifact, str(artifact_id))
            if current is None:
                raise LookupError(f"Artifact {artifact_id} not found")

            new = Artifact(
                tenant_id=current.tenant_id,
                project_id=current.project_id,
                type=current.type,
                version=current.version + 1,
                status=ArtifactStatus.ACTIVE,
                created_by=current.created_by,
                content_hash=_content_hash(new_payload),
                payload=new_payload,
            )
            session.add(new)
            await session.flush()

            # Direct UPDATE: only the supersession pointers change.
            await session.execute(
                text(
                    "UPDATE artifacts SET status = 'superseded', "
                    "superseded_by_id = :new_id, superseded_at = :ts "
                    "WHERE id = :old_id"
                ),
                {
                    "new_id": str(new.id),
                    "old_id": str(current.id),
                    "ts": datetime.now(timezone.utc),
                },
            )
            await session.commit()
            await session.refresh(new)

        await self._bus.publish(
            EventType.ARTIFACT_SUPERSEDED,
            {
                "superseded_id": str(artifact_id),
                "new_id": str(new.id),
                "type": new.type,
                "version": new.version,
            },
            tenant_id=new.tenant_id,
            project_id=new.project_id,
            actor_id=actor_id,
        )
        return new

    async def get_active(
        self,
        *,
        artifact_type: str,
        tenant_id: UUID | str,
        project_id: UUID | str,
    ) -> Artifact | None:
        """Return the current ACTIVE version for (tenant, project, type)."""
        factory = get_session_factory()
        async with factory() as session:
            stmt = (
                select(Artifact)
                .where(
                    Artifact.tenant_id == str(tenant_id),
                    Artifact.project_id == str(project_id),
                    Artifact.type == artifact_type,
                    Artifact.status == ArtifactStatus.ACTIVE,
                )
                .order_by(Artifact.version.desc())
                .limit(1)
            )
            return (await session.execute(stmt)).scalar_one_or_none()

    async def list_versions(
        self,
        *,
        artifact_type: str,
        tenant_id: UUID | str,
        project_id: UUID | str,
    ) -> list[Artifact]:
        """All versions (active + superseded + archived) for (tenant, project, type)."""
        factory = get_session_factory()
        async with factory() as session:
            stmt = (
                select(Artifact)
                .where(
                    Artifact.tenant_id == str(tenant_id),
                    Artifact.project_id == str(project_id),
                    Artifact.type == artifact_type,
                )
                .order_by(Artifact.version.desc())
            )
            return list((await session.execute(stmt)).scalars().all())


artifact_registry = ArtifactRegistry()


__all__ = ["ArtifactRegistry", "artifact_registry"]
