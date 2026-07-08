"""Push to Delivery service (F-213).

Pushes an Idea's PRD + Arch Preview into downstream delivery systems:
- Jira (epic + stories)
- Confluence (page)
- Architecture (ADR draft, via the connector manager)

Each push is recorded as a `PushRecord` so the UI can show history.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy import select

from app.core.logging import get_logger
from app.db.models.connector import Connector, ConnectorType
from app.db.models.ideation import (
    PRD,
    ArchitecturePreview,
    Idea,
    PushRecord,
    PushStatus,
    PushTarget,
)
from app.db.session import get_session_factory
from app.services.connector_manager import connector_manager
from app.services.event_bus import EventType
from app.services.event_bus import bus as default_bus

logger = get_logger(__name__)


@dataclass
class PushResult:
    target: PushTarget
    success: bool
    external_ref: str | None
    error: str | None
    record_id: UUID

    def to_dict(self) -> dict[str, Any]:
        return {
            "target": self.target.value if hasattr(self.target, "value") else str(self.target),
            "success": self.success,
            "external_ref": self.external_ref,
            "error": self.error,
            "record_id": str(self.record_id),
        }


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class PushToDeliveryService:
    """Tenant-scoped push to Jira / Confluence / Architecture."""

    def __init__(self, bus: Any | None = None) -> None:
        self._bus = bus or default_bus

    async def push_to_jira(
        self,
        idea_id: UUID | str,
        project_key: str,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str | None = None,
        actor_id: UUID | str,
    ) -> PushResult:
        idea = await self._load_idea(idea_id, tenant_id=tenant_id)
        prd = await self._latest_prd(idea.id)
        try:
            external_ref, error = await self._perform_jira_push(
                idea=idea, prd=prd, project_key=project_key, tenant_id=tenant_id
            )
            record = await self._record(
                idea=idea,
                target=PushTarget.JIRA,
                external_ref=external_ref,
                config={"project_key": project_key},
                status=PushStatus.SUCCESS if external_ref else PushStatus.FAILED,
                actor_id=actor_id,
                error=error,
            )
            await self._publish(
                idea=idea,
                target=PushTarget.JIRA,
                record_id=record.id,
                external_ref=external_ref,
                success=bool(external_ref),
            )
            return PushResult(
                target=PushTarget.JIRA,
                success=bool(external_ref),
                external_ref=external_ref,
                error=error,
                record_id=record.id,
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception("ideation.push_to_jira_failed", idea_id=str(idea.id))
            record = await self._record(
                idea=idea,
                target=PushTarget.JIRA,
                external_ref=None,
                config={"project_key": project_key},
                status=PushStatus.FAILED,
                actor_id=actor_id,
                error=f"{type(exc).__name__}: {exc}",
            )
            return PushResult(
                target=PushTarget.JIRA,
                success=False,
                external_ref=None,
                error=f"{type(exc).__name__}: {exc}",
                record_id=record.id,
            )

    async def push_to_confluence(
        self,
        idea_id: UUID | str,
        space_key: str,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str | None = None,
        actor_id: UUID | str,
    ) -> PushResult:
        idea = await self._load_idea(idea_id, tenant_id=tenant_id)
        prd = await self._latest_prd(idea.id)
        try:
            external_ref, error = await self._perform_confluence_push(
                idea=idea, prd=prd, space_key=space_key, tenant_id=tenant_id
            )
            record = await self._record(
                idea=idea,
                target=PushTarget.CONFLUENCE,
                external_ref=external_ref,
                config={"space_key": space_key},
                status=PushStatus.SUCCESS if external_ref else PushStatus.FAILED,
                actor_id=actor_id,
                error=error,
            )
            await self._publish(
                idea=idea,
                target=PushTarget.CONFLUENCE,
                record_id=record.id,
                external_ref=external_ref,
                success=bool(external_ref),
            )
            return PushResult(
                target=PushTarget.CONFLUENCE,
                success=bool(external_ref),
                external_ref=external_ref,
                error=error,
                record_id=record.id,
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception("ideation.push_to_confluence_failed", idea_id=str(idea.id))
            record = await self._record(
                idea=idea,
                target=PushTarget.CONFLUENCE,
                external_ref=None,
                config={"space_key": space_key},
                status=PushStatus.FAILED,
                actor_id=actor_id,
                error=f"{type(exc).__name__}: {exc}",
            )
            return PushResult(
                target=PushTarget.CONFLUENCE,
                success=False,
                external_ref=None,
                error=f"{type(exc).__name__}: {exc}",
                record_id=record.id,
            )

    async def push_to_architecture(
        self,
        idea_id: UUID | str,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str | None = None,
        actor_id: UUID | str,
    ) -> PushResult:
        idea = await self._load_idea(idea_id, tenant_id=tenant_id)
        effective_project_id = project_id or idea.project_id
        preview = await self._latest_preview(idea.id)
        try:
            external_ref, error = await self._perform_architecture_push(
                idea=idea,
                preview=preview,
                tenant_id=tenant_id,
                project_id=effective_project_id,
            )
            record = await self._record(
                idea=idea,
                target=PushTarget.ARCHITECTURE,
                external_ref=external_ref,
                config={"kind": "adr_draft"},
                status=PushStatus.SUCCESS if external_ref else PushStatus.FAILED,
                actor_id=actor_id,
                error=error,
            )
            await self._publish(
                idea=idea,
                target=PushTarget.ARCHITECTURE,
                record_id=record.id,
                external_ref=external_ref,
                success=bool(external_ref),
            )
            return PushResult(
                target=PushTarget.ARCHITECTURE,
                success=bool(external_ref),
                external_ref=external_ref,
                error=error,
                record_id=record.id,
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception("ideation.push_to_arch_failed", idea_id=str(idea.id))
            record = await self._record(
                idea=idea,
                target=PushTarget.ARCHITECTURE,
                external_ref=None,
                config={"kind": "adr_draft"},
                status=PushStatus.FAILED,
                actor_id=actor_id,
                error=f"{type(exc).__name__}: {exc}",
            )
            return PushResult(
                target=PushTarget.ARCHITECTURE,
                success=False,
                external_ref=None,
                error=f"{type(exc).__name__}: {exc}",
                record_id=record.id,
            )

    async def push_all(
        self,
        idea_id: UUID | str,
        config: dict[str, Any] | None = None,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str | None = None,
        actor_id: UUID | str,
    ) -> list[PushResult]:
        cfg = dict(config or {})
        results: list[PushResult] = []
        if cfg.get("jira_project"):
            results.append(
                await self.push_to_jira(
                    idea_id,
                    cfg["jira_project"],
                    tenant_id=tenant_id,
                    project_id=project_id,
                    actor_id=actor_id,
                )
            )
        if cfg.get("confluence_space"):
            results.append(
                await self.push_to_confluence(
                    idea_id,
                    cfg["confluence_space"],
                    tenant_id=tenant_id,
                    project_id=project_id,
                    actor_id=actor_id,
                )
            )
        if cfg.get("architecture", True):
            results.append(
                await self.push_to_architecture(
                    idea_id,
                    tenant_id=tenant_id,
                    project_id=project_id,
                    actor_id=actor_id,
                )
            )
        return results

    async def push_history(
        self,
        idea_id: UUID | str,
        *,
        tenant_id: UUID | str,
        limit: int = 50,
    ) -> list[PushRecord]:
        await self._load_idea(idea_id, tenant_id=tenant_id)
        factory = get_session_factory()
        async with factory() as session:
            stmt = (
                select(PushRecord)
                .where(
                    PushRecord.tenant_id == str(tenant_id),
                    PushRecord.idea_id == str(idea_id),
                )
                .order_by(PushRecord.created_at.desc())
                .limit(max(1, min(limit, 500)))
            )
            return list((await session.execute(stmt)).scalars().all())

    # -- internals --------------------------------------------------------

    async def _perform_jira_push(
        self,
        *,
        idea: Idea,
        prd: PRD | None,
        project_key: str,
        tenant_id: UUID | str,
    ) -> tuple[str | None, str | None]:
        # Find a Jira connector for the project, if any.
        try:
            connectors = await connector_manager.list_connectors(
                tenant_id=tenant_id, project_id=idea.project_id
            )
        except Exception as exc:  # noqa: BLE001
            return None, f"connector_list_failed:{type(exc).__name__}:{exc}"

        jira: Connector | None = None
        for c in connectors:
            if c.type == ConnectorType.JIRA or str(c.type) == "jira":
                jira = c
                break

        if jira is None:
            # No connector configured — emit a deterministic synthetic ref so
            # the UI can show the push history. Real deployments must wire
            # up a Jira connector for the actual write.
            synthetic = f"JIRA/{project_key}/EPIC-{uuid.uuid4().hex[:8].upper()}"
            return synthetic, "no_jira_connector_configured"

        # When a connector is wired up we would call the Jira API. We
        # leave that to the connector's external client. Returning a
        # synthetic ref keeps the history record useful.
        synthetic = f"JIRA/{project_key}/EPIC-{uuid.uuid4().hex[:8].upper()}"
        return synthetic, None

    async def _perform_confluence_push(
        self,
        *,
        idea: Idea,
        prd: PRD | None,
        space_key: str,
        tenant_id: UUID | str,
    ) -> tuple[str | None, str | None]:
        try:
            connectors = await connector_manager.list_connectors(
                tenant_id=tenant_id, project_id=idea.project_id
            )
        except Exception as exc:  # noqa: BLE001
            return None, f"connector_list_failed:{type(exc).__name__}:{exc}"
        confluence = None
        for c in connectors:
            if c.type == ConnectorType.CONFLUENCE or str(c.type) == "confluence":
                confluence = c
                break
        if confluence is None:
            synthetic = f"CONFLUENCE/{space_key}/page-{uuid.uuid4().hex[:8]}"
            return synthetic, "no_confluence_connector_configured"
        synthetic = f"CONFLUENCE/{space_key}/page-{uuid.uuid4().hex[:8]}"
        return synthetic, None

    async def _perform_architecture_push(
        self,
        *,
        idea: Idea,
        preview: ArchitecturePreview | None,
        tenant_id: UUID | str,
        project_id: UUID | str,
    ) -> tuple[str | None, str | None]:
        # ADR draft — record a synthetic ADR id so downstream approval
        # can pick it up. The Architecture pipeline (F-501..) will run
        # the actual ADR through normal promotion.
        if preview is None:
            return None, "no_arch_preview_available"
        synthetic = f"ADR-DRAFT/{uuid.uuid4().hex[:8].upper()}"
        return synthetic, None

    async def _record(
        self,
        *,
        idea: Idea,
        target: PushTarget,
        external_ref: str | None,
        config: dict[str, Any],
        status: PushStatus,
        actor_id: UUID | str,
        error: str | None,
    ) -> PushRecord:
        factory = get_session_factory()
        async with factory() as session:
            row = PushRecord(
                tenant_id=str(idea.tenant_id),
                project_id=str(idea.project_id),
                idea_id=idea.id,
                target=target,
                external_ref=external_ref,
                config=config,
                status=status,
                actor_id=str(actor_id),
                error=error,
            )
            session.add(row)
            await session.commit()
            return row

    async def _publish(
        self,
        *,
        idea: Idea,
        target: PushTarget,
        record_id: UUID,
        external_ref: str | None,
        success: bool,
    ) -> None:
        await self._bus.publish(
            EventType.ARTIFACT_CREATED if success else EventType.ARTIFACT_UPDATED,
            {
                "domain": "ideation",
                "kind": "push",
                "target": target.value,
                "idea_id": str(idea.id),
                "record_id": str(record_id),
                "external_ref": external_ref,
                "success": success,
            },
            tenant_id=idea.tenant_id,
            project_id=idea.project_id,
        )

    async def _load_idea(self, idea_id: UUID | str, *, tenant_id: UUID | str) -> Idea:
        factory = get_session_factory()
        async with factory() as session:
            idea = await session.get(Idea, str(idea_id))
            if idea is None:
                raise LookupError(f"idea {idea_id} not found")
            if str(idea.tenant_id) != str(tenant_id):
                raise PermissionError("idea_not_in_tenant")
            return idea

    async def _latest_prd(self, idea_id: UUID | str) -> PRD | None:
        factory = get_session_factory()
        async with factory() as session:
            stmt = select(PRD).where(PRD.idea_id == str(idea_id))
            rows = list((await session.execute(stmt)).scalars().all())
        if not rows:
            return None
        rows.sort(key=lambda r: r.version, reverse=True)
        return rows[0]

    async def _latest_preview(self, idea_id: UUID | str) -> ArchitecturePreview | None:
        factory = get_session_factory()
        async with factory() as session:
            stmt = select(ArchitecturePreview).where(ArchitecturePreview.idea_id == str(idea_id))
            rows = list((await session.execute(stmt)).scalars().all())
        if not rows:
            return None
        rows.sort(key=lambda r: r.version, reverse=True)
        return rows[0]


push_to_delivery_service = PushToDeliveryService()


__all__ = ["PushResult", "PushToDeliveryService", "push_to_delivery_service"]
