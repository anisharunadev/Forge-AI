"""F-829i — Compliance feed API for the Steward governance UI.

Routes
------
* ``GET    /api/v1/governance/violations``        — list (filterable by severity)
* ``POST   /api/v1/governance/violations/{id}/resolve`` — mark resolved
* ``POST   /api/v1/governance/violations/{id}/reopen``   — re-open
* ``POST   /api/v1/governance/violations/poll``  — manual trigger of the
                                                    LiteLLM ingest cycle
                                                    (operational escape hatch)
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.security import require_principal
from app.integrations.litellm.compliance_feed import compliance_feed

router = APIRouter(prefix="/governance", tags=["governance-violations"])


@router.get("/violations", response_model=None)
async def list_violations(
    tenant_id: UUID | str = Query(..., description="Forge tenant id"),
    severity: str | None = Query(
        None,
        description="Optional severity filter: low | medium | high | critical",
    ),
    resolved: bool | None = Query(
        None,
        description="Optional resolved filter",
    ),
    limit: int = Query(100, ge=1, le=1000),
    _principal: Any = Depends(require_principal),
) -> dict[str, Any]:
    """List LiteLLM guardrail violations for the tenant."""
    if severity is not None and severity not in ("low", "medium", "high", "critical"):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid severity: {severity!r}",
        )
    items = await compliance_feed.list_violations(
        tenant_id,
        severity=severity,
        resolved=resolved,
        limit=limit,
    )
    return {
        "items": [v.to_dict() for v in items],
        "count": len(items),
    }


@router.post("/violations/{violation_id}/resolve", response_model=None)
async def resolve_violation(
    violation_id: UUID | str,
    tenant_id: UUID | str = Query(..., description="Forge tenant id"),
    _principal: Any = Depends(require_principal),
) -> dict[str, Any]:
    """Mark a violation resolved (Steward acknowledgment)."""
    ok = await compliance_feed.mark_resolved(
        tenant_id, violation_id, resolved=True
    )
    if not ok:
        raise HTTPException(
            status_code=404,
            detail=f"Violation not found: {violation_id!r}",
        )
    return {"id": str(violation_id), "resolved": True}


@router.post("/violations/{violation_id}/reopen", response_model=None)
async def reopen_violation(
    violation_id: UUID | str,
    tenant_id: UUID | str = Query(..., description="Forge tenant id"),
    _principal: Any = Depends(require_principal),
) -> dict[str, Any]:
    """Re-open a previously resolved violation."""
    ok = await compliance_feed.mark_resolved(
        tenant_id, violation_id, resolved=False
    )
    if not ok:
        raise HTTPException(
            status_code=404,
            detail=f"Violation not found: {violation_id!r}",
        )
    return {"id": str(violation_id), "resolved": False}


@router.post("/violations/poll", response_model=None)
async def trigger_poll(
    _principal: Any = Depends(require_principal),
) -> dict[str, Any]:
    """Manual trigger of the LiteLLM violation ingest cycle.

    Operational escape hatch — the APScheduler job runs every 30s, but
    operators sometimes need a one-shot pull (e.g. during incident
    triage) without waiting for the next tick.
    """
    result = await compliance_feed.poll_violations()
    return {
        "ingested": result.ingested,
        "skipped_duplicates": result.skipped_duplicates,
        "since": result.since.isoformat(),
        "until": result.until.isoformat(),
    }


__all__ = ["router"]
