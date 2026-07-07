"""F-311 — Architecture Diagrams HTTP endpoint.

Day 2 mock-removal track H: ``GET /api/v1/architecture/diagrams``
returns the 3 C4 diagrams that used to live in the frontend
``MOCK_DIAGRAMS`` fixture, now persisted to the
``architecture_diagrams`` / ``_nodes`` / ``_edges`` tables.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from app.api.deps import get_current_principal
from app.core.audit import audit
from app.core.security import AuthenticatedPrincipal
from app.schemas.architecture import (
    C4DiagramListResponse,
    C4DiagramResponse,
)
from app.services.architecture.diagrams import DiagramService

router = APIRouter(prefix="/architecture/diagrams", tags=["architecture:diagrams"])


@router.get("", response_model=C4DiagramListResponse)
@audit(action="architecture.diagram.list", target_type="architecture_diagram")
async def list_diagrams(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    project_id: UUID = Query(...),
) -> C4DiagramListResponse:
    """List every diagram for the principal's tenant + project scope.

    The frontend receives the nested ``{id, name, level, description,
    nodes[], edges[]}`` shape that the existing ``DiagramsExplorer``
    component already consumes (no adapter required).
    """
    service = DiagramService()
    rows = await service.list_diagrams(
        tenant_id=principal.tenant_id,
        project_id=project_id,
    )
    items = [C4DiagramResponse.model_validate(r) for r in rows]
    return C4DiagramListResponse(items=items, total=len(items))


__all__ = ["router"]
