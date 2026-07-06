"""Push to Delivery REST endpoints (F-213, M4-G5, M4-G20).

Push endpoints honor the ``Idempotency-Key`` HTTP header. The
contract:

* The header is optional. When absent, every push runs end-to-end
  (legacy behaviour).
* When present, the route first queries the ``push_attempts`` table
  for ``(tenant_id, idea_id, idempotency_key)``. A cache hit returns
  the cached :class:`PushResult` immediately — no downstream call.
* A cache miss runs the push end-to-end, then writes a new
  ``push_attempts`` row so subsequent identical requests are also
  cache hits.

The cache lives in the ``ideation_push_attempts`` table (M4-G20).
The schema lives in ``app/schemas/push_attempt.py`` and the ORM
model in ``app/db/models/ideation.py::PushAttempt``.
"""

from __future__ import annotations

import uuid
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import select

from app.api.deps import get_current_principal, require_permission
from app.core.audit import audit
from app.core.logging import get_logger
from app.core.security import AuthenticatedPrincipal
from app.db.models.ideation import PushAttempt, PushTarget
from app.db.session import get_session_factory
from app.schemas.ideation import (
    PushAllRequest,
    PushHistoryResponse,
    PushRecordRead,
    PushResult,
    PushToConfluenceRequest,
    PushToJiraRequest,
)
from app.services.ideation.push_to_delivery import push_to_delivery_service

logger = get_logger(__name__)

router = APIRouter(prefix="/ideation/ideas", tags=["ideation"])


# ---------------------------------------------------------------------------
# Idempotency helpers
# ---------------------------------------------------------------------------


async def check_idempotency(
    *,
    tenant_id: UUID | str,
    idea_id: UUID | str,
    idempotency_key: str,
) -> PushResult | None:
    """Return a cached :class:`PushResult` for the key, or ``None``.

    Looks up ``ideation_push_attempts`` keyed on the canonical triple
    ``(tenant_id, idea_id, idempotency_key)``. The result is rebuilt
    from the JSONB payload — no separate ORM hydration.
    """
    factory = get_session_factory()
    async with factory() as session:
        stmt = select(PushAttempt).where(
            PushAttempt.tenant_id == str(tenant_id),
            PushAttempt.idea_id == str(idea_id),
            PushAttempt.idempotency_key == idempotency_key,
        )
        row = (await session.execute(stmt)).scalars().first()
    if row is None:
        return None
    payload = dict(row.result or {})
    try:
        target_value = payload.get("target")
        target = PushTarget(target_value) if isinstance(target_value, str) else row.target
        return PushResult(
            target=target,
            success=bool(payload.get("success")),
            external_ref=payload.get("external_ref"),
            error=payload.get("error"),
            record_id=UUID(str(payload.get("record_id") or row.id)),
        )
    except (ValueError, TypeError):
        logger.warning(
            "ideation.push.idempotency.corrupt_payload",
            tenant_id=str(tenant_id),
            idea_id=str(idea_id),
            idempotency_key=idempotency_key,
        )
        return None


async def record_attempt(
    *,
    tenant_id: UUID | str,
    idea_id: UUID | str,
    idempotency_key: str,
    target: PushTarget,
    result: PushResult,
    actor_id: UUID | str,
) -> None:
    """Write a new ``push_attempts`` row.

    Idempotent on ``(tenant_id, idea_id, idempotency_key)`` — a
    second insert with the same triple is a silent no-op (the
    caller already saw the cached result from
    :func:`check_idempotency`).
    """
    payload = {
        "target": target.value if hasattr(target, "value") else str(target),
        "success": bool(result.success),
        "external_ref": result.external_ref,
        "error": result.error,
        "record_id": str(result.record_id),
    }
    factory = get_session_factory()
    async with factory() as session:
        # Upsert by (tenant_id, idea_id, idempotency_key): insert a
        # new row, ignore conflicts. Race-safe: the PK is auto, the
        # unique index makes the second insert a no-op.
        from sqlalchemy.dialects.postgresql import insert as pg_insert  # noqa: PLC0415

        stmt = pg_insert(PushAttempt).values(
            id=uuid.uuid4(),
            tenant_id=str(tenant_id),
            idea_id=str(idea_id),
            idempotency_key=idempotency_key,
            target=target,
            result=payload,
            actor_id=str(actor_id),
        )
        stmt = stmt.on_conflict_do_nothing(
            index_elements=["tenant_id", "idea_id", "idempotency_key"],
        )
        await session.execute(stmt)
        await session.commit()


# ---------------------------------------------------------------------------
# Mapping helper
# ---------------------------------------------------------------------------


def _push_to_read(record: Any) -> PushRecordRead:
    return PushRecordRead(
        id=record.id,
        tenant_id=record.tenant_id,
        project_id=record.project_id,
        idea_id=record.idea_id,
        target=record.target,
        external_ref=record.external_ref,
        config=dict(record.config or {}),
        status=record.status,
        actor_id=record.actor_id,
        error=record.error,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


# ---------------------------------------------------------------------------
# Routes — push endpoints with idempotency wrapping
# ---------------------------------------------------------------------------


@router.post("/{idea_id}/push/jira", response_model=PushResult)
@audit(action="ideation.push.jira", target_type="idea")
async def push_to_jira(
    idea_id: UUID,
    body: PushToJiraRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
    _perm: AuthenticatedPrincipal = Depends(require_permission("ideation:push")),
) -> PushResult:
    cached = (
        await check_idempotency(
            tenant_id=principal.tenant_id,
            idea_id=idea_id,
            idempotency_key=idempotency_key,
        )
        if idempotency_key
        else None
    )
    if cached is not None:
        return cached
    try:
        result = await push_to_delivery_service.push_to_jira(
            idea_id,
            body.project_key,
            tenant_id=principal.tenant_id,
            project_id=principal.project_id,
            actor_id=principal.user_id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    push_result = PushResult(
        target=result.target,
        success=result.success,
        external_ref=result.external_ref,
        error=result.error,
        record_id=result.record_id,
    )
    if idempotency_key:
        await record_attempt(
            tenant_id=principal.tenant_id,
            idea_id=idea_id,
            idempotency_key=idempotency_key,
            target=PushTarget.JIRA,
            result=push_result,
            actor_id=principal.user_id,
        )
    return push_result


@router.post("/{idea_id}/push/confluence", response_model=PushResult)
@audit(action="ideation.push.confluence", target_type="idea")
async def push_to_confluence(
    idea_id: UUID,
    body: PushToConfluenceRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
    _perm: AuthenticatedPrincipal = Depends(require_permission("ideation:push")),
) -> PushResult:
    cached = (
        await check_idempotency(
            tenant_id=principal.tenant_id,
            idea_id=idea_id,
            idempotency_key=idempotency_key,
        )
        if idempotency_key
        else None
    )
    if cached is not None:
        return cached
    try:
        result = await push_to_delivery_service.push_to_confluence(
            idea_id,
            body.space_key,
            tenant_id=principal.tenant_id,
            project_id=principal.project_id,
            actor_id=principal.user_id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    push_result = PushResult(
        target=result.target,
        success=result.success,
        external_ref=result.external_ref,
        error=result.error,
        record_id=result.record_id,
    )
    if idempotency_key:
        await record_attempt(
            tenant_id=principal.tenant_id,
            idea_id=idea_id,
            idempotency_key=idempotency_key,
            target=PushTarget.CONFLUENCE,
            result=push_result,
            actor_id=principal.user_id,
        )
    return push_result


@router.post("/{idea_id}/push/architecture", response_model=PushResult)
@audit(action="ideation.push.architecture", target_type="idea")
async def push_to_architecture(
    idea_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
    _perm: AuthenticatedPrincipal = Depends(require_permission("ideation:push")),
) -> PushResult:
    cached = (
        await check_idempotency(
            tenant_id=principal.tenant_id,
            idea_id=idea_id,
            idempotency_key=idempotency_key,
        )
        if idempotency_key
        else None
    )
    if cached is not None:
        return cached
    try:
        result = await push_to_delivery_service.push_to_architecture(
            idea_id,
            tenant_id=principal.tenant_id,
            project_id=principal.project_id,
            actor_id=principal.user_id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    push_result = PushResult(
        target=result.target,
        success=result.success,
        external_ref=result.external_ref,
        error=result.error,
        record_id=result.record_id,
    )
    if idempotency_key:
        await record_attempt(
            tenant_id=principal.tenant_id,
            idea_id=idea_id,
            idempotency_key=idempotency_key,
            target=PushTarget.ARCHITECTURE,
            result=push_result,
            actor_id=principal.user_id,
        )
    return push_result


@router.post("/{idea_id}/push/all", response_model=list[PushResult])
@audit(action="ideation.push.all", target_type="idea")
async def push_all(
    idea_id: UUID,
    body: PushAllRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
    _perm: AuthenticatedPrincipal = Depends(require_permission("ideation:push")),
) -> list[PushResult]:
    """Push to every configured target.

    For the bulk endpoint, the idempotency cache is keyed on the
    *individual* target (jira/confluence/architecture), not on the
    aggregate — so a retry with the same key replays each push
    individually rather than collapsing to a single cache hit.
    """
    try:
        results = await push_to_delivery_service.push_all(
            idea_id,
            config={
                "jira_project": body.jira_project,
                "confluence_space": body.confluence_space,
                "architecture": body.architecture,
            },
            tenant_id=principal.tenant_id,
            project_id=principal.project_id,
            actor_id=principal.user_id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    out: list[PushResult] = []
    for r in results:
        push_result = PushResult(
            target=r.target,
            success=r.success,
            external_ref=r.external_ref,
            error=r.error,
            record_id=r.record_id,
        )
        if idempotency_key:
            target_value = r.target.value if hasattr(r.target, "value") else str(r.target)
            target_enum = r.target if isinstance(r.target, PushTarget) else PushTarget(target_value)
            await record_attempt(
                tenant_id=principal.tenant_id,
                idea_id=idea_id,
                idempotency_key=f"{idempotency_key}:{target_value}",
                target=target_enum,
                result=push_result,
                actor_id=principal.user_id,
            )
        out.append(push_result)
    return out


@router.get("/{idea_id}/push/history", response_model=PushHistoryResponse)
@audit(action="ideation.push.history", target_type="idea")
async def push_history(
    idea_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    limit: int = Query(default=50, ge=1, le=500),
    _perm: AuthenticatedPrincipal = Depends(require_permission("ideation:read")),
) -> PushHistoryResponse:
    try:
        rows = await push_to_delivery_service.push_history(
            idea_id, tenant_id=principal.tenant_id, limit=limit
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    items = [_push_to_read(r) for r in rows]
    return PushHistoryResponse(items=items, total=len(items))


__all__ = ["router", "check_idempotency", "record_attempt"]
