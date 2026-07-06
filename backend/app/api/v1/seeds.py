"""F-821 / F-805 — Seeds API.

Exposes the ``SeedRunner`` over HTTP. RBAC-enforced, audit-decorated.

Endpoints (7 total):

  GET    /seeds                       list seeds (RBAC: seeds:view)
  GET    /seeds/{name}                get manifest (RBAC: seeds:view)
  GET    /seeds/{name}/status         durable state (RBAC: seeds:view)
  GET    /seeds/{name}/diff           expected vs actual (RBAC: seeds:view)
  GET    /seeds/{name}/runs           run history (RBAC: seeds:view)
  POST   /seeds/{name}/apply          apply idempotently (RBAC: seeds:manage)
  POST   /seeds/{name}/reset          reset (RBAC: seeds:reset:demo_only | seeds:reset:all)
  POST   /seeds/{name}/rollback       rollback (RBAC: seeds:manage)

Errors raised by the runner are mapped to HTTP responses by
``_seed_error_to_http`` so callers get a stable error envelope.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Path, status
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.agents.approval_gate import require_approval_phase
from app.agents.sdlc_state import SDLCPhase
from app.api.deps import DbSession, get_current_principal, require_permission
from app.core.audit import audit
from app.core.security import AuthenticatedPrincipal
from app.schemas.seeds import (
    SeedApplyRequest,
    SeedDiffRead,
    SeedManifestRead,
    SeedManifestSummary,
    SeedResetRequest,
    SeedRunRead,
    SeedStatusRead,
)
from app.services.audit_service import AuditService
from app.services.seed_service import SeedService
from seeds.framework.exceptions import (
    ApplyRolledBackError,
    BrokenReferenceError,
    DependencyNotSatisfiedError,
    InvalidManifestError,
    ProductionSeedBlockedError,
    SchemaMismatchError,
    SeedError,
    SeedNotFoundError,
)

router = APIRouter(prefix="/seeds", tags=["seeds"])


# ---------------------------------------------------------------------------
# Error mapping
# ---------------------------------------------------------------------------


_SEED_ERROR_MAP: dict[type[SeedError], tuple[int, str]] = {
    InvalidManifestError: (status.HTTP_400_BAD_REQUEST, "invalid_manifest"),
    SchemaMismatchError: (status.HTTP_400_BAD_REQUEST, "schema_mismatch"),
    BrokenReferenceError: (status.HTTP_400_BAD_REQUEST, "broken_reference"),
    ProductionSeedBlockedError: (status.HTTP_403_FORBIDDEN, "production_blocked"),
    ApplyRolledBackError: (status.HTTP_500_INTERNAL_SERVER_ERROR, "apply_error"),
    DependencyNotSatisfiedError: (
        status.HTTP_422_UNPROCESSABLE_CONTENT,
        "dependency_not_satisfied",
    ),
    SeedNotFoundError: (status.HTTP_404_NOT_FOUND, "seed_not_found"),
}


def _seed_error_to_http(exc: SeedError) -> HTTPException:
    """Translate a :class:`SeedError` into an HTTPException with stable codes."""
    code, label = _SEED_ERROR_MAP.get(type(exc), (500, "seed_error"))
    return HTTPException(
        status_code=code,
        detail={"error": label, "message": str(exc)},
    )


def _service(session_factory: async_sessionmaker) -> SeedService:
    """Build a SeedService bound to the request's session factory + audit."""
    return SeedService(session_factory=session_factory, audit_service=AuditService())


# ---------------------------------------------------------------------------
# GET endpoints
# ---------------------------------------------------------------------------


@router.get("", response_model=list[SeedManifestSummary])
@audit(action="seeds.list", target_type="seed")
async def list_seeds(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("seeds:view")),
    db: DbSession = None,  # type: ignore[assignment]
) -> list[SeedManifestSummary]:
    """List all seed packages visible to the caller (RBAC ``seeds:view``)."""
    factory = db.get_bind()
    service = _service(factory)
    return service.list_seeds()


@router.get("/{name}", response_model=SeedManifestRead)
@audit(action="seeds.get", target_type="seed")
async def get_seed(
    name: str = Path(..., min_length=1, max_length=200),
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)] = ...,
    _perm: AuthenticatedPrincipal = Depends(require_permission("seeds:view")),
    db: DbSession = None,  # type: ignore[assignment]
) -> SeedManifestRead:
    """Return the full manifest for ``name`` (RBAC ``seeds:view``)."""
    factory = db.get_bind()
    service = _service(factory)
    try:
        return await service.get_seed(name)
    except SeedError as exc:
        raise _seed_error_to_http(exc) from exc


@router.get("/{name}/status", response_model=SeedStatusRead)
@audit(action="seeds.status", target_type="seed")
async def get_seed_status(
    name: str = Path(..., min_length=1, max_length=200),
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)] = ...,
    _perm: AuthenticatedPrincipal = Depends(require_permission("seeds:view")),
    db: DbSession = None,  # type: ignore[assignment]
) -> SeedStatusRead:
    """Return durable state + drift for a seed (RBAC ``seeds:view``)."""
    factory = db.get_bind()
    service = _service(factory)
    try:
        return await service.status(name)
    except SeedError as exc:
        raise _seed_error_to_http(exc) from exc


@router.get("/{name}/diff", response_model=SeedDiffRead)
@audit(action="seeds.diff", target_type="seed")
async def get_seed_diff(
    name: str = Path(..., min_length=1, max_length=200),
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)] = ...,
    _perm: AuthenticatedPrincipal = Depends(require_permission("seeds:view")),
    db: DbSession = None,  # type: ignore[assignment]
) -> SeedDiffRead:
    """Compare manifest-declared row counts to live DB (RBAC ``seeds:view``)."""
    factory = db.get_bind()
    service = _service(factory)
    try:
        return await service.diff(name)
    except SeedError as exc:
        raise _seed_error_to_http(exc) from exc


@router.get("/{name}/runs", response_model=list[SeedRunRead])
@audit(action="seeds.runs", target_type="seed")
async def list_seed_runs(
    name: str = Path(..., min_length=1, max_length=200),
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)] = ...,
    _perm: AuthenticatedPrincipal = Depends(require_permission("seeds:view")),
    db: DbSession = None,  # type: ignore[assignment]
) -> list[SeedRunRead]:
    """Return recent run history for a seed (RBAC ``seeds:view``)."""
    factory = db.get_bind()
    service = _service(factory)
    return await service.runs(name)


# ---------------------------------------------------------------------------
# POST endpoints
# ---------------------------------------------------------------------------
@require_approval_phase(SDLCPhase.PLANNING)
@router.post("/{name}/apply", response_model=SeedRunRead)
@audit(action="seeds.apply", target_type="seed")
async def apply_seed(
    body: SeedApplyRequest,
    name: str = Path(..., min_length=1, max_length=200),
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)] = ...,
    _perm: AuthenticatedPrincipal = Depends(require_permission("seeds:manage")),
    db: DbSession = None,  # type: ignore[assignment]
) -> SeedRunRead:
    """Apply a seed idempotently (RBAC ``seeds:manage``).

    The ``allow_in_prod`` flag bypasses the production-safety gate
    for demo seeds — its use is audited.
    """
    factory = db.get_bind()
    service = _service(factory)
    try:
        return await service.apply(
            name=name,
            actor_id=UUID(str(principal.user_id)),
            triggered_by="api",
            allow_in_prod=body.allow_in_prod,
            tenant_id=UUID(str(principal.tenant_id)) if principal.tenant_id else None,
            project_id=UUID(str(principal.project_id)) if principal.project_id else None,
        )
    except SeedError as exc:
        raise _seed_error_to_http(exc) from exc


@require_approval_phase(SDLCPhase.PLANNING)
@router.post("/{name}/reset", response_model=SeedRunRead)
@audit(action="seeds.reset", target_type="seed")
async def reset_seed(
    body: SeedResetRequest,
    name: str = Path(..., min_length=1, max_length=200),
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)] = ...,
    db: DbSession = None,  # type: ignore[assignment]
) -> SeedRunRead:
    """Reset (delete) rows owned by a seed.

    RBAC depends on the requested ``scope``:

    - ``scope=demo_only`` requires ``seeds:reset:demo_only``.
    - ``scope=all`` requires ``seeds:reset:all`` (Steward-only).
    """
    if body.scope == "all":
        perm = require_permission("seeds:reset:all")
    else:
        perm = require_permission("seeds:reset:demo_only")
    # Resolve the dep inline — we can't use it as a default-value param
    # because the choice depends on the request body.
    perm_check = await perm(principal=principal)  # type: ignore[arg-type]

    factory = db.get_bind()
    service = _service(factory)
    try:
        return await service.reset(
            name=name,
            actor_id=UUID(str(principal.user_id)),
            triggered_by="api",
            scope=body.scope,
            tenant_id=UUID(str(principal.tenant_id)) if principal.tenant_id else None,
            project_id=UUID(str(principal.project_id)) if principal.project_id else None,
        )
    except SeedError as exc:
        raise _seed_error_to_http(exc) from exc


@require_approval_phase(SDLCPhase.PLANNING)
@router.post("/{name}/rollback", response_model=SeedRunRead)
@audit(action="seeds.rollback", target_type="seed")
async def rollback_seed(
    name: str = Path(..., min_length=1, max_length=200),
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)] = ...,
    _perm: AuthenticatedPrincipal = Depends(require_permission("seeds:manage")),
    db: DbSession = None,  # type: ignore[assignment]
) -> SeedRunRead:
    """Roll back the most recent apply (RBAC ``seeds:manage``).

    Currently equivalent to ``reset(scope=demo_only)``. Kept as a
    separate endpoint so future migration-aware rollbacks can be
    slotted in without changing the API surface.
    """
    factory = db.get_bind()
    service = _service(factory)
    try:
        return await service.rollback(
            name=name,
            actor_id=UUID(str(principal.user_id)),
            tenant_id=UUID(str(principal.tenant_id)) if principal.tenant_id else None,
            project_id=UUID(str(principal.project_id)) if principal.project_id else None,
        )
    except SeedError as exc:
        raise _seed_error_to_http(exc) from exc


__all__ = ["router"]
