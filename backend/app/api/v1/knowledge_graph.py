"""Knowledge graph REST endpoints (F-115)."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query

from app.agents.approval_gate import require_approval_phase
from app.agents.sdlc_state import SDLCPhase
from app.api.deps import get_current_principal, require_permission
from app.core.audit import audit
from app.core.security import AuthenticatedPrincipal
from app.schemas.project_intelligence import (
    CypherQueryRequest,
    HybridQueryRequest,
    KGEdgeRead,
    KGFreshnessInfo,
    KGNodeRead,
    KGStats,
    SQLQueryRequest,
    VectorSearchRequest,
)
from app.services.knowledge_graph import (
    GraphStatus,
    knowledge_graph_service,
)

router = APIRouter(prefix="/kg", tags=["knowledge-graph"])


@router.get("/nodes", response_model=list[KGNodeRead])
@audit(action="kg.list_nodes", target_type="kg_node")
async def list_nodes(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    project_id: str | None = Query(default=None),
    type: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=1000),
    _perm: AuthenticatedPrincipal = Depends(require_permission("kg:read")),
) -> list[KGNodeRead]:
    nodes = await knowledge_graph_service.list_nodes(
        tenant_id=principal.tenant_id,
        project_id=project_id or principal.project_id,
        node_type=type,
        limit=limit,
    )
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


@router.get("/nodes/{node_id}", response_model=KGNodeRead)
@audit(action="kg.get_node", target_type="kg_node")
async def get_node(
    node_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("kg:read")),
) -> KGNodeRead:
    node = await knowledge_graph_service.get_node(node_id, tenant_id=principal.tenant_id)
    if node is None:
        raise HTTPException(status_code=404, detail=f"node {node_id} not found")
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


@router.get("/nodes/{node_id}/backlinks", response_model=list[KGNodeRead])
@audit(action="kg.list_backlinks", target_type="kg_node")
async def list_backlinks(
    node_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    limit: int = Query(default=100, ge=1, le=1000),
    _perm: AuthenticatedPrincipal = Depends(require_permission("kg:read")),
) -> list[KGNodeRead]:
    target = await knowledge_graph_service.get_node(node_id, tenant_id=principal.tenant_id)
    if target is None:
        raise HTTPException(status_code=404, detail=f"node {node_id} not found")

    nodes = await knowledge_graph_service.backlinks_for(
        node_id,
        tenant_id=principal.tenant_id,
        limit=limit,
    )
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


@router.get("/edges", response_model=list[KGEdgeRead])
@audit(action="kg.list_edges", target_type="kg_edge")
async def list_edges(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    project_id: str | None = Query(default=None),
    from_: str | None = Query(default=None, alias="from"),
    to: str | None = Query(default=None),
    type: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=1000),
    _perm: AuthenticatedPrincipal = Depends(require_permission("kg:read")),
) -> list[KGEdgeRead]:
    edges = await knowledge_graph_service.list_edges(
        tenant_id=principal.tenant_id,
        project_id=project_id or principal.project_id,
        from_node_id=from_,
        to_node_id=to,
        edge_type=type,
        limit=limit,
    )
    return [
        KGEdgeRead(
            id=e.id,
            from_node_id=e.from_node_id,
            to_node_id=e.to_node_id,
            edge_type=e.edge_type,
            properties=e.properties,
            created_at=e.created_at,
            updated_at=e.updated_at,
        )
        for e in edges
    ]


@require_approval_phase(SDLCPhase.PLANNING)
@router.post("/query/cypher")
@audit(action="kg.query_cypher", target_type="kg")
async def query_cypher(
    body: CypherQueryRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("kg:query")),
) -> dict[str, object]:
    rows = await knowledge_graph_service.query_cypher(body.query, body.params)
    return {"rows": rows}


@require_approval_phase(SDLCPhase.PLANNING)
@router.post("/query/sql")
@audit(action="kg.query_sql", target_type="kg")
async def query_sql(
    body: SQLQueryRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("kg:query")),
) -> dict[str, object]:
    rows = await knowledge_graph_service.query_sql(body.query, body.params)
    return {"rows": rows}


@require_approval_phase(SDLCPhase.PLANNING)
@router.post("/query/hybrid")
@audit(action="kg.query_hybrid", target_type="kg")
async def query_hybrid(
    body: HybridQueryRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("kg:query")),
) -> dict[str, object]:
    rows = await knowledge_graph_service.hybrid_query(
        cypher_part=body.cypher,
        sql_part=body.sql,
        params=body.params,
    )
    return {"rows": rows}


@require_approval_phase(SDLCPhase.PLANNING)
@router.post("/search/vector", response_model=list[KGNodeRead])
@audit(action="kg.vector_search", target_type="kg")
async def vector_search(
    body: VectorSearchRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("kg:query")),
) -> list[KGNodeRead]:
    nodes = await knowledge_graph_service.vector_search(
        embedding=body.embedding,
        top_k=body.top_k,
        tenant_id=principal.tenant_id,
        project_id=body.project_id or principal.project_id,
        node_type=body.node_type,
    )
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


@router.get("/stats", response_model=KGStats)
@audit(action="kg.stats", target_type="kg")
async def stats(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    project_id: str | None = Query(default=None),
    _perm: AuthenticatedPrincipal = Depends(require_permission("kg:read")),
) -> KGStats:
    s = await knowledge_graph_service.stats(
        tenant_id=principal.tenant_id,
        project_id=project_id or principal.project_id,
    )
    return KGStats(
        node_count=s.node_count,
        edge_count=s.edge_count,
        node_types=s.node_types,
        edge_types=s.edge_types,
    )


@router.get(
    "/nodes/{node_id}/freshness",
    response_model=KGFreshnessInfo,
)
@audit(action="kg.freshness", target_type="kg_node")
async def freshness(
    node_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("kg:read")),
) -> KGFreshnessInfo:
    info = await knowledge_graph_service.get_node_freshness(node_id, tenant_id=principal.tenant_id)
    return KGFreshnessInfo(
        node_id=info.node_id,
        status=info.status.value if isinstance(info.status, GraphStatus) else str(info.status),
        freshness_at=info.freshness_at,
        freshness_source=info.freshness_source,
        age_seconds=info.age_seconds,
    )


__all__ = ["router"]
