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
* ``GET /api/v1/governance/violations`` — list LiteLLM request logs that
  represent guardrail/budget failures for the caller's tenant.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query

from app.api.deps import Principal
from app.core.audit import audit
from app.services.litellm_admin import list_spend_logs

router = APIRouter(prefix="/governance", tags=["governance"])


@router.get("/violations")
@audit(action="governance.violations.list", target_type="tenant")
async def list_violations(
    principal: Principal,
    severity: str = Query(default="all"),  # all / high / medium
    days: int = Query(default=7, le=90),
) -> list[dict]:
    """Violations = LiteLLM requests that failed guardrails or over-budget.

    Per recon: `principal.tenant_id` (a string) is used directly as the
    LiteLLM `team_id` for this tenant. No DB model is consulted; the
    canonical record is in LiteLLM, surfaced through ``list_spend_logs``.
    """
    start = (datetime.utcnow() - timedelta(days=days)).isoformat()

    logs = await list_spend_logs(
        team_id=principal.tenant_id,
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
                    "severity": (
                        "high"
                        if status in (403, 429, "403", "429")
                        else "medium"
                    ),
                    "kind": guardrail_action or "unknown",
                    "description": metadata.get(
                        "guardrail_reason",
                        "Guardrail blocked or budget exceeded",
                    ),
                    "actor": log.get("user"),
                    "key_alias": log.get("key_alias"),
                }
            )

    # Apply severity filter — when severity is "high" / "medium", restrict
    # to the matching subset. "all" (and any unknown value) returns the
    # unfiltered list.
    if severity in ("high", "medium"):
        violations = [v for v in violations if v["severity"] == severity]

    return violations


__all__ = ["router"]