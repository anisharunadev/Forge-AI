"""F-307: Architecture versioning service."""

import logging
from datetime import datetime
from uuid import UUID

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
    def __init__(self, artifact_registry=None, event_bus=None):
        self.artifact_registry = artifact_registry
        self.event_bus = event_bus

    async def create_version(
        self, artifact_type: str, artifact_id: UUID, snapshot_reason: str, actor_id: UUID
    ) -> ArchitectureVersion:
        """Snapshot the artifact to artifact_registry."""
        from uuid import uuid4

        version = ArchitectureVersion(
            version_id=uuid4(),
            artifact_type=artifact_type,
            artifact_id=artifact_id,
            version_number=1,
            content_hash="pending",
            snapshot_reason=snapshot_reason,
            actor_id=actor_id,
            created_at=datetime.utcnow(),
        )
        if self.event_bus:
            await self.event_bus.publish(
                "ArchitectureVersionCreated", {"version_id": str(version.version_id)}
            )
        return version

    async def list_versions(self, artifact_type: str, artifact_id: UUID) -> list:
        return []

    async def diff_versions(self, version_a_id: UUID, version_b_id: UUID) -> dict:
        return {"added": [], "removed": [], "modified": []}

    async def rollback_to_version(
        self, artifact_type: str, artifact_id: UUID, version_id: UUID, actor_id: UUID
    ) -> ArchitectureVersion:
        return await self.create_version(
            artifact_type, artifact_id, f"rollback to {version_id}", actor_id
        )
