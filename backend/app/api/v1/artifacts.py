"""F-010 — Artifacts (typed, append-only)."""

from __future__ import annotations

from fastapi import APIRouter, status

from app.api.deps import Principal, require_permission
from app.core.audit import audit
from app.db.models.artifact import ArtifactStatus
from app.schemas.artifacts import ArtifactCreate, ArtifactRead
from app.services.artifact_registry import artifact_registry

router = APIRouter(prefix="/artifacts", tags=["artifacts"])


@router.get("", response_model=list[ArtifactRead])
@audit(action="artifacts.list", target_type="artifact")
async def list_artifacts(
    principal: Principal,
    _perm: Principal = require_permission("artifacts:read"),
    artifact_type: str | None = None,
) -> list[ArtifactRead]:
    """List active artifacts (optionally filtered by type).

    For version history, use the per-type endpoint.
    """
    if artifact_type:
        versions = await artifact_registry.list_versions(
            artifact_type=artifact_type,
            tenant_id=principal.tenant_id,
            project_id=principal.project_id,
        )
    else:
        # Without a type filter we return the ACTIVE set across types.
        versions = await _list_active_all(principal)
    return [ArtifactRead.model_validate(v) for v in versions]


async def _list_active_all(principal) -> list:
    """Best-effort listing of ACTIVE artifacts across types."""
    from sqlalchemy import select

    from app.db.models.artifact import Artifact
    from app.db.session import get_session_factory

    factory = get_session_factory()
    async with factory() as session:
        stmt = (
            select(Artifact)
            .where(
                Artifact.tenant_id == principal.tenant_id,
                Artifact.status == ArtifactStatus.ACTIVE,
            )
            .order_by(Artifact.type, Artifact.version.desc())
        )
        return list((await session.execute(stmt)).scalars().all())


@router.post("", response_model=ArtifactRead, status_code=status.HTTP_201_CREATED)
@audit(action="artifacts.create", target_type="artifact")
async def create_artifact(
    body: ArtifactCreate,
    principal: Principal,
    _perm: Principal = require_permission("artifacts:create"),
) -> ArtifactRead:
    artifact = await artifact_registry.create(
        tenant_id=principal.tenant_id,
        project_id=principal.project_id,
        type=body.type,
        payload=body.payload,
        created_by=principal.user_id,
        status=ArtifactStatus.DRAFT,
        actor_id=principal.user_id,
    )
    return ArtifactRead.model_validate(artifact)


__all__ = ["router"]
