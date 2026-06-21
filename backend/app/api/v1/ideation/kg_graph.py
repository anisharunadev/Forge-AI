"""Ideation Knowledge-Graph REST endpoints (F-208).

Exposes:
- POST /ideation/ideas/{id}/kg  — add idea to project KG
- GET  /ideation/projects/{project_id}/idea-graph  — project-wide graph
- POST /ideation/ideas/{id}/related  — find related ideas
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status

from app.api.deps import Principal, require_permission
from app.core.audit import audit
from app.schemas.project_intelligence import KGNodeRead
from app.schemas.ideation import IdeaGraphRead
from app.services.ideation.kg_integration import ideation_kg_service

router = APIRouter(prefix="/ideation", tags=["ideation"])


@router.post(
    "/ideas/{idea_id}/kg",
    response_model=KGNodeRead,
    status_code=status.HTTP_201_CREATED,
)
@audit(action="ideation.kg.add_idea", target_type="kg_node")
async def add_idea_to_kg(
    idea_id: UUID,
    principal: Principal,
    _perm: Principal = require_permission("ideation:kg"),
) -> KGNodeRead:
    try:
        node = await ideation_kg_service.add_idea_to_kg(
            idea_id,
            tenant_id=principal.tenant_id,
            project_id=principal.project_id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return KGNodeRead(
        id=node.id,
        node_type=node.node_type,
        name=node.name,
        properties=node.properties,
        tenant_id=node.tenant_id,
        project_id=node.project_id,
        repo_id=node.repo_id,
        freshness_at=node.freshness_at,
        freshness_source=node.freshness_source,
        created_at=node.created_at,
        updated_at=node.updated_at,
    )


@router.get("/projects/{project_id}/idea-graph", response_model=IdeaGraphRead)
@audit(action="ideation.kg.get_graph", target_type="idea_graph")
async def get_idea_graph(
    project_id: UUID,
    principal: Principal,
    _perm: Principal = require_permission("ideation:read"),
) -> IdeaGraphRead:
    graph = await ideation_kg_service.get_idea_graph(
        project_id, tenant_id=principal.tenant_id
    )
    return IdeaGraphRead(
        project_id=graph.project_id,
        nodes=[n.to_dict() for n in graph.nodes],
        edges=[e.to_dict() for e in graph.edges],
        generated_at=graph.generated_at,
    )


@router.post("/ideas/{idea_id}/related", response_model=list[KGNodeRead])
@audit(action="ideation.kg.find_related", target_type="kg_node")
async def find_related_ideas(
    idea_id: UUID,
    principal: Principal,
    top_k: int = Query(default=5, ge=1, le=50),
    _perm: Principal = require_permission("ideation:read"),
) -> list[KGNodeRead]:
    try:
        nodes = await ideation_kg_service.find_related_ideas(
            idea_id,
            tenant_id=principal.tenant_id,
            project_id=principal.project_id,
            top_k=top_k,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return [
        KGNodeRead(
            id=n.id,
            node_type=n.node_type,
            name=n.name,
            properties=n.properties,
            tenant_id=n.tenant_id,
            project_id=n.project_id,
            repo_id=n.repo_id,
            freshness_at=n.freshness_at,
            freshness_source=n.freshness_source,
            created_at=n.created_at,
            updated_at=n.updated_at,
        )
        for n in nodes
    ]


__all__ = ["router"]
