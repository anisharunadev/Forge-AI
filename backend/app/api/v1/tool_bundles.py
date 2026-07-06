"""F-505 — Tool Bundle Guardrails REST endpoints.

* GET  /api/v1/tool-bundles              — list all stage bundles
* PUT  /api/v1/tool-bundles/{stage}      — Steward override (audited)
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from app.agents.approval_gate import require_approval_phase
from app.agents.sdlc_state import SDLCPhase
from app.api.deps import get_current_principal, require_permission
from app.core.audit import audit
from app.core.security import AuthenticatedPrincipal
from app.schemas.tool_bundles import (
    STAGES,
    Stage,
    ToolBundleRead,
    ToolBundleUpdate,
)
from app.services.audit_service import audit_service
from app.services.tool_bundles import tool_bundles

router = APIRouter(prefix="/tool-bundles", tags=["tool-bundles"])


def _row_to_read(stage: Stage, bundle, row) -> ToolBundleRead:
    """Build the API response from a bundle + optional override row."""
    return ToolBundleRead(
        stage=stage,
        permitted_tools=list(bundle["permitted_tools"]),
        denied_tools=list(bundle["denied_tools"]),
        rationale=bundle["rationale"],
        overridden=row is not None,
        overridden_at=row.updated_at if row is not None else None,
        overridden_by=row.updated_by if row is not None else None,
        tenant_id="00000000-0000-0000-0000-000000000000",
        project_id=None,
        created_at=datetime.now(UTC),
    )


@router.get("", response_model=list[ToolBundleRead])
@audit(action="tool_bundles.list", target_type="tool_bundle")
async def list_tool_bundles(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("tool_bundles:read")),
) -> list[ToolBundleRead]:
    """List every stage's effective bundle (default or override)."""
    out: list[ToolBundleRead] = []
    for stage in STAGES:
        bundle = tool_bundles.get_bundle(stage)
        row = tool_bundles.override_row(stage)
        out.append(_row_to_read(stage, bundle, row))
    return out


@require_approval_phase(SDLCPhase.IMPLEMENTATION)
@router.put("/{stage}", response_model=ToolBundleRead)
@audit(action="tool_bundles.override", target_type="tool_bundle")
async def override_tool_bundle(
    stage: Stage,
    body: ToolBundleUpdate,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("tool_bundles:override")),
) -> ToolBundleRead:
    """Apply a Steward override for a single stage. Audited in F-005."""
    if stage not in STAGES:
        raise HTTPException(status_code=404, detail=f"unknown_stage:{stage}")

    try:
        bundle = tool_bundles.override(
            stage,
            body,
            actor_id=str(principal.user_id) if principal.user_id else None,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # Write the F-005 audit row for the override itself so Steward
    # actions are traceable end-to-end (Rule 6).
    await audit_service.record(
        tenant_id=principal.tenant_id,
        project_id=principal.project_id or "00000000-0000-0000-0000-000000000000",
        actor_id=str(principal.user_id) if principal.user_id else None,
        action="tool_bundle.override",
        target_type="tool_bundle",
        target_id=stage,
        payload={
            "stage": stage,
            "permitted_tools": list(body.permitted_tools or bundle["permitted_tools"]),
            "denied_tools": list(body.denied_tools or bundle["denied_tools"]),
            "rationale": body.rationale or bundle["rationale"],
            "steward_id": str(principal.user_id) if principal.user_id else None,
        },
    )

    row = tool_bundles.override_row(stage)
    return _row_to_read(stage, bundle, row)


__all__ = ["router"]
