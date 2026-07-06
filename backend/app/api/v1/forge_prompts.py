"""step-78 F11 — `/api/forge/prompts/*` HTTP surface.

Thin HTTP layer over ``prompt_service``. Auth: every endpoint depends
on ``Principal`` + a ``require_permission`` string. Audit events follow
the ``forge.prompts.*`` taxonomy from step-78 §"Audit".
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.agents.approval_gate import require_approval_phase
from app.agents.sdlc_state import SDLCPhase
from app.api.deps import DbSession, require_permission
from app.core.audit import audit
from app.core.logging import get_logger
from app.schemas.common import Page
from app.schemas.prompt import (
    DotpromptImportRequest,
    DotpromptImportResponse,
    PromptCountRequest,
    PromptCountResponse,
    PromptCreate,
    PromptDiffResponse,
    PromptRead,
    PromptRenderRequest,
    PromptRenderResponse,
    PromptTestRequest,
    PromptTestResponse,
    PromptUpdate,
    PromptVersionRead,
)
from app.services.prompt_service import PromptError, prompt_service

router = APIRouter(prefix="/forge/prompts", tags=["forge.prompts"])
logger = get_logger(__name__)


def _tenant_id(principal: object) -> UUID:
    tid = getattr(principal, "tenant_id", None)
    if not tid:
        raise HTTPException(status_code=403, detail="token_missing_tenant_claim")
    return UUID(tid)


def _prompt_error_to_http(exc: PromptError) -> HTTPException:
    code_to_status = {
        "undeclared_variable": status.HTTP_422_UNPROCESSABLE_ENTITY,
        "missing_variable": status.HTTP_422_UNPROCESSABLE_ENTITY,
        "template_syntax_error": status.HTTP_422_UNPROCESSABLE_ENTITY,
        "prompt_not_found": status.HTTP_404_NOT_FOUND,
        "version_not_found": status.HTTP_404_NOT_FOUND,
        "prompt_archived": status.HTTP_409_CONFLICT,
    }
    return HTTPException(
        status_code=code_to_status.get(exc.code, status.HTTP_400_BAD_REQUEST),
        detail=exc.detail,
    )


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------


@router.get("", response_model=Page[PromptRead])
@audit(action="forge.prompts.listed", target_type="prompt")
async def list_prompts(
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("prompts:read"))],
    category: str | None = Query(None),
    tag: str | None = Query(None),
    status_: str | None = Query(None, alias="status"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
) -> Page[PromptRead]:
    items = await prompt_service.list_prompts(
        db,
        tenant_id=_tenant_id(principal),
        category=category,
        tag=tag,
        status=status_,
    )
    return Page(
        items=items,
        total=len(items),
        page=page,
        page_size=page_size,
    )


@require_approval_phase(SDLCPhase.PLANNING)
@router.post("", response_model=PromptRead, status_code=status.HTTP_201_CREATED)
@audit(action="forge.prompts.created", target_type="prompt")
async def create_prompt(
    payload: PromptCreate,
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("prompts:create"))],
) -> PromptRead:
    return await prompt_service.create_prompt(
        db,
        tenant_id=_tenant_id(principal),
        payload=payload,
        created_by=UUID(getattr(principal, "user_id", ""))
        if getattr(principal, "user_id", None)
        else None,
    )


@router.get("/{prompt_id}", response_model=PromptRead)
@audit(action="forge.prompts.read", target_type="prompt")
async def get_prompt(
    prompt_id: UUID,
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("prompts:read"))],
    version: int | None = Query(None, description="Specific version; defaults to current_version."),
) -> PromptRead:
    item = await prompt_service.get_prompt(
        db, tenant_id=_tenant_id(principal), prompt_id=prompt_id, version_number=version
    )
    if item is None:
        raise HTTPException(status_code=404, detail="prompt_not_found")
    return item


@require_approval_phase(SDLCPhase.PLANNING)
@router.patch("/{prompt_id}", response_model=PromptRead)
@audit(action="forge.prompts.updated", target_type="prompt")
async def update_prompt(
    prompt_id: UUID,
    payload: PromptUpdate,
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("prompts:update"))],
) -> PromptRead:
    try:
        item = await prompt_service.update_prompt(
            db,
            tenant_id=_tenant_id(principal),
            prompt_id=prompt_id,
            payload=payload,
            created_by=UUID(getattr(principal, "user_id", ""))
            if getattr(principal, "user_id", None)
            else None,
        )
    except PromptError as exc:
        raise _prompt_error_to_http(exc) from exc
    if item is None:
        raise HTTPException(status_code=404, detail="prompt_not_found")
    return item


@require_approval_phase(SDLCPhase.PLANNING)
@router.post("/{prompt_id}/archive", response_model=PromptRead)
@audit(action="forge.prompts.archived", target_type="prompt")
async def archive_prompt(
    prompt_id: UUID,
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("prompts:update"))],
) -> PromptRead:
    item = await prompt_service.archive_prompt(
        db, tenant_id=_tenant_id(principal), prompt_id=prompt_id
    )
    if item is None:
        raise HTTPException(status_code=404, detail="prompt_not_found")
    return item


# ---------------------------------------------------------------------------
# Versions + diff
# ---------------------------------------------------------------------------


@router.get("/{prompt_id}/versions", response_model=list[PromptVersionRead])
@audit(action="forge.prompts.versions_listed", target_type="prompt")
async def list_versions(
    prompt_id: UUID,
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("prompts:read"))],
) -> list[PromptVersionRead]:
    return await prompt_service.list_versions(
        db, tenant_id=_tenant_id(principal), prompt_id=prompt_id
    )


@router.get("/{prompt_id}/diff", response_model=PromptDiffResponse)
@audit(action="forge.prompts.diff_computed", target_type="prompt")
async def diff_versions(
    prompt_id: UUID,
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("prompts:read"))],
    from_: int = Query(..., alias="from", description="Source version number (1-based)."),
    to: int = Query(..., description="Target version number (1-based)."),
) -> PromptDiffResponse:
    try:
        udiff = await prompt_service.diff_versions(
            db,
            tenant_id=_tenant_id(principal),
            prompt_id=prompt_id,
            from_version=from_,
            to_version=to,
        )
    except PromptError as exc:
        raise _prompt_error_to_http(exc) from exc
    return PromptDiffResponse(
        prompt_id=prompt_id,
        from_version=from_,
        to_version=to,
        unified_diff=udiff,
    )


# ---------------------------------------------------------------------------
# Render / test / count
# ---------------------------------------------------------------------------
@require_approval_phase(SDLCPhase.REVIEW)
@router.post("/{prompt_id}/preview", response_model=PromptRenderResponse)
@audit(action="forge.prompts.rendered", target_type="prompt")
async def render_preview(
    prompt_id: UUID,
    payload: PromptRenderRequest,
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("prompts:read"))],
    version: int | None = Query(None),
) -> PromptRenderResponse:
    try:
        return await prompt_service.render(
            db,
            tenant_id=_tenant_id(principal),
            prompt_id=prompt_id,
            payload=payload,
            version_number=version,
        )
    except PromptError as exc:
        raise _prompt_error_to_http(exc) from exc


@require_approval_phase(SDLCPhase.PLANNING)
@router.post("/{prompt_id}/test", response_model=PromptTestResponse)
@audit(action="forge.prompts.tested", target_type="prompt")
async def test_prompt(
    prompt_id: UUID,
    payload: PromptTestRequest,
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("prompts:test"))],
    version: int | None = Query(None),
) -> PromptTestResponse:
    try:
        return await prompt_service.test(
            db,
            tenant_id=_tenant_id(principal),
            prompt_id=prompt_id,
            payload=payload,
            version_number=version,
        )
    except PromptError as exc:
        raise _prompt_error_to_http(exc) from exc


@require_approval_phase(SDLCPhase.PLANNING)
@router.post("/{prompt_id}/count", response_model=PromptCountResponse)
@audit(action="forge.prompts.counted", target_type="prompt")
async def count_tokens(
    prompt_id: UUID,
    payload: PromptCountRequest,
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("prompts:read"))],
    version: int | None = Query(None),
) -> PromptCountResponse:
    try:
        return await prompt_service.count_tokens(
            db,
            tenant_id=_tenant_id(principal),
            prompt_id=prompt_id,
            payload=payload,
            version_number=version,
        )
    except PromptError as exc:
        raise _prompt_error_to_http(exc) from exc


# ---------------------------------------------------------------------------
# Dotprompt import (acceptance #5)
# ---------------------------------------------------------------------------
@require_approval_phase(SDLCPhase.PLANNING)
@router.post(
    "/import-dotprompt",
    response_model=DotpromptImportResponse,
    status_code=status.HTTP_201_CREATED,
)
@audit(action="forge.prompts.imported", target_type="prompt")
async def import_dotprompt(
    payload: DotpromptImportRequest,
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("prompts:create"))],
) -> DotpromptImportResponse:
    return await prompt_service.import_dotprompt(
        db,
        tenant_id=_tenant_id(principal),
        payload=payload,
        created_by=UUID(getattr(principal, "user_id", ""))
        if getattr(principal, "user_id", None)
        else None,
    )
