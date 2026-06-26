"""Repos REST endpoints (F-101, F-102)."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query, Response, status

from app.api.deps import Principal, require_permission
from app.core.audit import audit
from app.db.models.repo_ingestion import Repo
from app.db.session import get_session_factory
from app.schemas.project_intelligence import (
    IngestionRunRead,
    IngestionStatusRead,
    RepoCandidate,
    RepoCreate,
    RepoDiscoverRequest,
    RepoDiscoverResponse,
    RepoRead,
    RepoUpdate,
)
from app.services.project_intelligence.repo_ingestion import repo_ingestion_service

router = APIRouter(prefix="/repos", tags=["repos"])


@router.post("", response_model=RepoRead, status_code=status.HTTP_201_CREATED)
@audit(action="repos.create", target_type="repo")
async def create_repo(
    body: RepoCreate,
    principal: Principal,
    _perm: Principal = require_permission("repos:create"),
) -> RepoRead:
    repo = await repo_ingestion_service.create_repo(
        tenant_id=principal.tenant_id,
        project_id=body.project_id,
        source_url=body.source_url,
        actor_id=principal.user_id,
        default_branch=body.default_branch,
        provider=body.provider.value,
        credentials_ref=body.credentials_ref,
    )
    return RepoRead.model_validate(repo)


@router.get("", response_model=list[RepoRead])
@audit(action="repos.list", target_type="repo")
async def list_repos(
    principal: Principal,
    project_id: str | None = Query(default=None),
    _perm: Principal = require_permission("repos:read"),
) -> list[RepoRead]:
    rows = await repo_ingestion_service.list_repos(
        tenant_id=principal.tenant_id,
        project_id=project_id or principal.project_id,
    )
    return [RepoRead.model_validate(r) for r in rows]


@router.get("/{repo_id}", response_model=RepoRead)
@audit(action="repos.get", target_type="repo")
async def get_repo(
    repo_id: str,
    principal: Principal,
    _perm: Principal = require_permission("repos:read"),
) -> RepoRead:
    try:
        repo = await repo_ingestion_service.get_repo(repo_id, tenant_id=principal.tenant_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    return RepoRead.model_validate(repo)


@router.patch("/{repo_id}", response_model=RepoRead)
@audit(action="repos.update", target_type="repo")
async def update_repo(
    repo_id: str,
    body: RepoUpdate,
    principal: Principal,
    _perm: Principal = require_permission("repos:update"),
) -> RepoRead:
    factory = get_session_factory()
    async with factory() as session:
        repo = await session.get(Repo, str(repo_id))
        if repo is None:
            raise HTTPException(status_code=404, detail=f"repo {repo_id} not found")
        if str(repo.tenant_id) != str(principal.tenant_id):
            raise HTTPException(status_code=403, detail="forbidden")
        if body.default_branch is not None:
            repo.default_branch = body.default_branch
        if body.credentials_ref is not None:
            repo.credentials_ref = body.credentials_ref
        await session.commit()
        await session.refresh(repo)
    return RepoRead.model_validate(repo)


@router.post("/{repo_id}/ingest", response_model=IngestionRunRead)
@audit(action="repos.ingest", target_type="repo")
async def trigger_ingestion(
    repo_id: str,
    principal: Principal,
    _perm: Principal = require_permission("repos:ingest"),
) -> IngestionRunRead:
    try:
        repo = await repo_ingestion_service.get_repo(repo_id, tenant_id=principal.tenant_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    summary = await repo_ingestion_service.ingest_repo(
        tenant_id=principal.tenant_id,
        project_id=repo.project_id,
        repo_id=repo.id,
        actor_id=principal.user_id,
    )
    return IngestionRunRead(
        id=summary.run_id,
        repo_id=summary.repo_id,
        started_at=datetime.now(timezone.utc),
        finished_at=None,
        status=summary.status,
        items_processed=0,
        error_message=None,
        artifacts_produced={},
    )


@router.get("/{repo_id}/ingestions", response_model=list[IngestionRunRead])
@audit(action="repos.ingestions", target_type="repo")
async def list_ingestions(
    repo_id: str,
    principal: Principal,
    _perm: Principal = require_permission("repos:read"),
) -> list[IngestionRunRead]:
    runs = await repo_ingestion_service.list_ingestion_runs(
        repo_id=repo_id, tenant_id=principal.tenant_id
    )
    return [
        IngestionRunRead(
            id=r.id,
            repo_id=r.repo_id,
            started_at=r.started_at,
            finished_at=r.finished_at,
            status=r.status,
            items_processed=r.items_processed,
            error_message=r.error_message,
            artifacts_produced=r.artifacts_produced or {},
            started_commit_sha=r.started_commit_sha,
            finished_commit_sha=r.finished_commit_sha,
        )
        for r in runs
    ]


@router.post("/discover", response_model=RepoDiscoverResponse)
@audit(action="repos.discover", target_type="repo")
async def discover_repos(
    body: RepoDiscoverRequest,
    principal: Principal,
    _perm: Principal = require_permission("repos:discover"),
) -> RepoDiscoverResponse:
    candidates = await repo_ingestion_service.discover_repos(
        tenant_id=principal.tenant_id,
        project_id=body.project_id,
        source=body.source.value,
        org=body.org,
        credentials_ref=body.credentials_ref,
    )
    return RepoDiscoverResponse(
        candidates=[
            RepoCandidate(
                external_id=c.external_id,
                full_name=c.full_name,
                default_branch=c.default_branch,
                description=c.description,
                url=c.url,
                private=c.private,
                language=c.language,
                metadata=c.metadata,
            )
            for c in candidates
        ]
    )


@router.get("/{repo_id}/status", response_model=IngestionStatusRead)
@audit(action="repos.status", target_type="repo")
async def get_status(
    repo_id: str,
    principal: Principal,
    _perm: Principal = require_permission("repos:read"),
) -> IngestionStatusRead:
    try:
        repo = await repo_ingestion_service.get_repo(repo_id, tenant_id=principal.tenant_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    runs = await repo_ingestion_service.list_ingestion_runs(
        repo_id=repo.id, tenant_id=principal.tenant_id
    )
    active = runs[0] if runs else None
    return IngestionStatusRead(
        repo_id=repo.id,
        status=repo.ingestion_status,
        last_ingested_at=repo.last_ingested_at,
        last_commit_sha=repo.last_commit_sha,
        active_run=IngestionRunRead(
            id=active.id,
            repo_id=active.repo_id,
            started_at=active.started_at,
            finished_at=active.finished_at,
            status=active.status,
            items_processed=active.items_processed,
            error_message=active.error_message,
            artifacts_produced=active.artifacts_produced or {},
            started_commit_sha=active.started_commit_sha,
            finished_commit_sha=active.finished_commit_sha,
        ) if active else None,
    )


@router.delete(
    "/ingestions/{run_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
    response_class=Response,
)
@audit(action="repos.cancel_ingestion", target_type="ingestion_run")
@audit(action="repos.cancel_ingestion", target_type="ingestion_run")
async def cancel_ingestion(
    run_id: str,
    principal: Principal,
    _perm: Principal = require_permission("repos:ingest"),
):
    try:
        run = await repo_ingestion_service.cancel_ingestion(
            run_id, tenant_id=principal.tenant_id, actor_id=principal.user_id
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return IngestionRunRead(
        id=run.id,
        repo_id=run.repo_id,
        started_at=run.started_at,
        finished_at=run.finished_at,
        status=run.status,
        items_processed=run.items_processed,
        error_message=run.error_message,
        artifacts_produced=run.artifacts_produced or {},
        started_commit_sha=run.started_commit_sha,
        finished_commit_sha=run.finished_commit_sha,
    )


__all__ = ["router"]