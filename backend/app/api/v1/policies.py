"""F-003 — Policies alias for LiteLLM guardrails."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.api.deps import Principal, get_current_tenant, require_permission
from app.core.audit import audit
from app.services.litellm_admin import list_guardrails, update_guardrail

router = APIRouter(prefix="/policies", tags=["policies"])


class PolicyRead(BaseModel):
    """Forge view of a LiteLLM guardrail."""

    id: str
    name: str
    type: str
    config: dict[str, Any]
    enabled: bool
    applies_to: list[str] = Field(default_factory=list)


class PolicyUpdate(BaseModel):
    config: dict[str, Any] | None = None
    enabled: bool | None = None


@router.get("", response_model=list[PolicyRead])
@audit(action="policies.list", target_type="guardrail")
async def list_policies(
    principal: Principal = Depends(get_current_tenant),
    _perm: Principal = require_permission("policies:read"),
) -> list[PolicyRead]:
    """List guardrails — proxied from LiteLLM."""
    raw = await list_guardrails()
    return [
        PolicyRead(
            id=g.get("guardrail_name", g.get("name", "")),
            name=g.get("guardrail_name", g.get("name", "")),
            type=g.get("type", "custom"),
            config=g.get("litellm_params", g.get("config", {})),
            enabled=g.get("enabled", True),
            applies_to=g.get("applies_to", []),
        )
        for g in raw
    ]


@router.patch("/{policy_id}", response_model=PolicyRead)
@audit(action="policies.update", target_type="guardrail")
async def update_policy(
    policy_id: str,
    body: PolicyUpdate,
    principal: Principal = Depends(get_current_tenant),
) -> PolicyRead:
    """Update a guardrail — proxied to LiteLLM."""
    config = body.config or {}
    result = await update_guardrail(policy_id, {"enabled": body.enabled, **config})
    return PolicyRead(
        id=policy_id,
        name=policy_id,
        type=result.get("type", "custom"),
        config=result.get("litellm_params", config),
        enabled=result.get("enabled", body.enabled or True),
    )


__all__ = ["router"]