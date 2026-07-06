"""Governance violations — derived from LiteLLM spend logs.

Forge AI does NOT maintain its own violations table. LiteLLM logs every
request with:

  - Request payload (truncated for PII)
  - Response payload (truncated)
  - Cost + tokens
  - Whether guardrails blocked the request (status_code != 200)
  - Latency

The Governance Violations view = filter request logs by
status_code != 200 OR metadata.guardrail_action present.

Routes
------
* ``GET    /api/v1/governance/violations``              — list LiteLLM request logs that
  represent guardrail/budget failures for the caller's tenant.
* ``POST   /api/v1/governance/violations/{id}/resolve`` — mark a violation resolved
* ``POST   /api/v1/governance/violations/{id}/reopen``  — re-open a resolved violation
* ``POST   /api/v1/governance/violations/poll``         — manual poll trigger (returns
  any new violations since the last call, keyed by tenant)
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.agents.approval_gate import require_approval_phase
from app.agents.sdlc_state import SDLCPhase
from app.api.deps import get_current_principal, require_permission
from app.core.audit import audit
from app.core.security import AuthenticatedPrincipal
from app.services.litellm_admin import list_spend_logs
from app.services.rbac import GOVERNANCE_PERMISSION_MANAGE, GOVERNANCE_PERMISSION_READ

router = APIRouter(prefix="/governance", tags=["governance"])


# ponytail: in-process state for resolve/reopen. LiteLLM spend logs
# are the canonical source for violations; the resolve flag is a
# steward annotation, ephemeral across restarts. Move to Redis or a
# `violation_resolutions` table when durability is required.
_RESOLUTION_STATE: dict[str, str] = {}  # key: "{tenant_id}:{violation_id}" → "resolved"
_LAST_POLL_AT: dict[str, datetime] = {}  # key: tenant_id


def _state_key(tenant_id: str, violation_id: str) -> str:
    return f"{tenant_id}:{violation_id}"


async def _load_violations(tenant_id: str, severity: str, days: int) -> list[dict]:
    """Derive violations from LiteLLM spend logs (shared by list + poll)."""
    start = (datetime.utcnow() - timedelta(days=days)).isoformat()
    logs = await list_spend_logs(
        team_id=tenant_id,
        start_date=start,
        limit=500,
    )

    violations: list[dict] = []
    for log in logs:
        metadata = log.get("metadata") or {}
        status = log.get("status")
        guardrail_action = metadata.get("guardrail_action")

        if status not in (200, "200", None) or guardrail_action:
            violations.append(
                {
                    "id": log.get("request_id"),
                    "timestamp": log.get("startTime"),
                    "model": log.get("model"),
                    "severity": ("high" if status in (403, 429, "403", "429") else "medium"),
                    "kind": guardrail_action or "unknown",
                    "description": metadata.get(
                        "guardrail_reason",
                        "Guardrail blocked or budget exceeded",
                    ),
                    "actor": log.get("user"),
                    "key_alias": log.get("key_alias"),
                }
            )

    if severity in ("high", "medium", "low"):
        violations = [v for v in violations if v["severity"] == severity]

    # Stamp resolved-state from in-memory annotation table.
    for v in violations:
        v["status"] = (
            "RESOLVED"
            if _RESOLUTION_STATE.get(_state_key(tenant_id, v["id"])) == "resolved"
            else "OPEN"
        )

    return violations


@router.get("/violations")
@audit(action="governance.violations.list", target_type="tenant")
async def list_violations(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission(GOVERNANCE_PERMISSION_READ)),
    severity: str = Query(default="all"),  # all / high / medium / low
    days: int = Query(default=7, le=90),
) -> list[dict]:
    """Violations = LiteLLM requests that failed guardrails or over-budget.

    Per recon: `principal.tenant_id` (a string) is used directly as the
    LiteLLM `team_id` for this tenant. No DB model is consulted; the
    canonical record is in LiteLLM, surfaced through ``list_spend_logs``.
    """
    return await _load_violations(principal.tenant_id, severity, days)


@require_approval_phase(SDLCPhase.ARCHITECTURE)
@router.post("/violations/{violation_id}/resolve")
@audit(action="governance.violation.resolve", target_type="violation")
async def resolve_violation(
    violation_id: str,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission(GOVERNANCE_PERMISSION_MANAGE)),
) -> dict:
    """Mark a violation as resolved. Returns the updated violation summary."""
    _RESOLUTION_STATE[_state_key(principal.tenant_id, violation_id)] = "resolved"
    return {
        "id": violation_id,
        "status": "RESOLVED",
        "resolved_by": principal.user_id,
        "resolved_at": datetime.utcnow().isoformat(),
    }


@require_approval_phase(SDLCPhase.ARCHITECTURE)
@router.post("/violations/{violation_id}/reopen")
@audit(action="governance.violation.reopen", target_type="violation")
async def reopen_violation(
    violation_id: str,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission(GOVERNANCE_PERMISSION_MANAGE)),
) -> dict:
    """Re-open a previously resolved violation."""
    _RESOLUTION_STATE[_state_key(principal.tenant_id, violation_id)] = "reopened"
    return {
        "id": violation_id,
        "status": "REOPENED",
        "reopened_by": principal.user_id,
        "reopened_at": datetime.utcnow().isoformat(),
    }


@require_approval_phase(SDLCPhase.ARCHITECTURE)
@router.post("/violations/poll")
@audit(action="governance.violations.poll", target_type="tenant")
async def poll_violations(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission(GOVERNANCE_PERMISSION_READ)),
    days: int = Query(default=1, le=7),
) -> dict:
    """Manual poll trigger — returns violations since last poll.

    ponytail: full sweep on each call (no diff). The frontend polls
    every 60s; the derivation is bounded by LiteLLM's 500-row limit
    so the cost is negligible. Add diff-from-cursor when poll rate
    goes above 1 req/s.
    """
    items = await _load_violations(principal.tenant_id, "all", days)
    now = datetime.utcnow()
    last = _LAST_POLL_AT.get(principal.tenant_id)
    _LAST_POLL_AT[principal.tenant_id] = now
    return {
        "polled_at": now.isoformat(),
        "previous_poll_at": last.isoformat() if last else None,
        "count": len(items),
        "items": items,
    }


__all__ = ["router"]
