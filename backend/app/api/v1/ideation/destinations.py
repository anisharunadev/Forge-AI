"""Push-destination REST endpoints (F-263, M4-G4).

REST surface over the per-tenant set of configured push targets
(Jira projects, Confluence spaces, Slack channels, the in-app
Architecture preview, Notion-style docs).

The route projects M3's ``connectors`` table into
:class:`PushDestinationRead` — connectors of type ``jira``,
``confluence``, ``slack`` are projected 1:1; the in-app
``arch_preview`` is always present (synthetic, not a connector);
``notion`` connectors are projected when present.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select

from app.api.deps import get_current_principal, require_permission
from app.core.audit import audit
from app.core.logging import get_logger
from app.core.security import AuthenticatedPrincipal
from app.db.models.connector import Connector, ConnectorType
from app.db.session import get_session_factory
from app.schemas.destination import PushDestinationRead

logger = get_logger(__name__)

router = APIRouter(prefix="/ideation/destinations", tags=["ideation"])


# Connector types that count as push destinations for ideation.
_DESTINATION_TYPES: tuple[ConnectorType, ...] = (
    ConnectorType.JIRA,
    ConnectorType.CONFLUENCE,
    ConnectorType.SLACK,
)


def _arch_preview_destination(tenant_id: str, project_id: str | None) -> PushDestinationRead:
    """Always-available architecture-preview slot (synthetic)."""
    return PushDestinationRead(
        id=uuid.UUID("00000000-0000-0000-0000-00000000a4a1"),  # fixed placeholder
        tenant_id=UUID(tenant_id),
        project_id=UUID(project_id) if project_id else None,
        kind="arch_preview",
        config={"path": "/ideation/{idea_id}/architecture"},
        last_pushed_at=None,
        status="healthy",
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )


def _connector_to_destination(connector: Connector) -> PushDestinationRead:
    type_str = connector.type.value if hasattr(connector.type, "value") else str(connector.type)
    return PushDestinationRead(
        id=connector.id,
        tenant_id=connector.tenant_id,
        project_id=connector.project_id,
        kind=type_str,  # type: ignore[arg-type]
        config=dict(connector.config or {}),
        last_pushed_at=connector.last_sync_at,
        status="healthy" if str(connector.status) in {"healthy", "HEALTHY"} else "degraded",
        created_at=connector.created_at,
        updated_at=connector.updated_at,
    )


@router.get("", response_model=list[PushDestinationRead])
@audit(action="ideation.destinations.list", target_type="destination")
async def list_destinations(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    project_id: UUID | None = Query(default=None),
    _perm: AuthenticatedPrincipal = Depends(require_permission("ideation:read")),
) -> list[PushDestinationRead]:
    """List push destinations for the tenant.

    Returns one entry per configured connector of type ``jira`` /
    ``confluence`` / ``slack`` (project-scoped when a project_id is
    supplied), plus the always-available in-app architecture-preview
    slot.
    """
    factory = get_session_factory()
    effective_project_id = str(project_id) if project_id is not None else str(principal.project_id)

    async with factory() as session:
        stmt = select(Connector).where(Connector.tenant_id == str(principal.tenant_id))
        stmt = stmt.where(Connector.project_id == effective_project_id)
        stmt = stmt.where(Connector.type.in_(list(_DESTINATION_TYPES)))
        stmt = stmt.order_by(Connector.created_at.desc())
        rows = list((await session.execute(stmt)).scalars().all())

    destinations = [_connector_to_destination(c) for c in rows]
    destinations.append(
        _arch_preview_destination(
            tenant_id=str(principal.tenant_id),
            project_id=effective_project_id,
        )
    )
    return destinations


__all__ = ["router"]
