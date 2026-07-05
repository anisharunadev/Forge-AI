"""Connector Activity REST endpoint (Pillar 1 — M3-G1).

Thin HTTP wrapper over :meth:`ConnectorManager.list_activity`. Routes:

- ``GET /connectors/activity``  RBAC ``connector:read``

A separate file from :mod:`app.api.v1.connector_lifecycle` because the
lifecycle router already handles the mutation verbs (install /
rotate / test / disconnect) and adding the read endpoint here keeps
each file under the 250-LOC ceiling the project conventions follow.
"""

from __future__ import annotations
from datetime import datetime
from typing import Annotated, Literal, Optional

from uuid import UUID

from fastapi import APIRouter, Depends, Query

from app.api.deps import get_current_principal, require_permission
from app.core.audit import audit
from app.core.security import AuthenticatedPrincipal
from app.schemas.connector_activity import ConnectorSyncEventRead
from app.services.connector_manager import connector_manager
from app.agents.approval_gate import require_approval_phase
from app.agents.sdlc_state import SDLCPhase

router = APIRouter(prefix="/connectors", tags=["connectors"])
@require_approval_phase(SDLCPhase.REVIEW)


@router.get("/activity", response_model=list[ConnectorSyncEventRead])
@audit(action="connector.activity.list", target_type="connector")
async def list_connector_activity(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    connector_id: Optional[UUID] = Query(default=None),
    event_type: Optional[
        Literal[
            "sync",
            "webhook",
            "test",
            "install",
            "disconnect",
            "error",
            "reveal",
            "rotate",
        ]
    ] = Query(default=None),
    since: Optional[datetime] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    before_id: Optional[UUID] = Query(default=None),
    _perm: AuthenticatedPrincipal = Depends(require_permission("connector:read"))
) -> list[ConnectorSyncEventRead]:
    """M3-G1 — Activity tab timeline feed.

    Returns activity rows tenant-scoped (Rule 2), ordered
    ``started_at DESC, id DESC`` so the UI can render newest-first and
    page backwards via ``before_id``. Empty list means "no events
    yet" rather than "permission denied" — the permission gate already
    returned 403 by the time we reach this handler.
    """
    rows = await connector_manager.list_activity(
        principal.tenant_id,
        connector_id=connector_id,
        event_type=event_type,
        since=since,
        limit=limit,
        before_id=before_id,
    )
    return [ConnectorSyncEventRead.model_validate(r) for r in rows]


__all__ = ["router"]
