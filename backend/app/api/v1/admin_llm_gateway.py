"""F-829 — Admin endpoints for the LLM Gateway (Phase B).

Steward-facing REST surface for:
* Per-tenant LLM config (model assignment, budget, guardrails)
* Virtual Key management (list, rotate, revoke)
* LiteLLM MCP server browser (read-only)
* LiteLLM health (cached state from :class:`LiteLLMHealthMonitor`)

The handlers in this module are thin — they call into the
``app.integrations.litellm`` package and shape the response for the
Forge UI. The Virtual Key VALUE never crosses the API boundary:
``GET /tenants/{id}/keys`` returns metadata only.

Permission: every endpoint requires ``admin:read`` (or ``admin:write``
for the mutating rotate/revoke). The principal's tenant scope is
inherited from the JWT and propagated into the request body where
needed.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.api.deps import Principal, require_permission
from app.core.audit import audit
from app.core.logging import get_logger
from app.integrations.litellm import (
    GuardrailSync,
    MCPServerRegistry,
    TenantSync,
    VirtualKeyManager,
    guardrail_sync,
    mcp_server_registry,
    tenant_sync,
    virtual_key_manager,
)
from app.services.litellm_admin import (
    _request,
    list_guardrails,
    list_models,
    list_teams,
    update_guardrail,
)

logger = get_logger(__name__)

router = APIRouter(prefix="/admin/llm-gateway", tags=["admin-llm-gateway"])


# ---------------------------------------------------------------------------
# Response shapes
# ---------------------------------------------------------------------------


class TenantLLMConfig(BaseModel):
    """Per-tenant LLM gateway configuration surface."""

    tenant_id: str
    project_id: str
    litellm_team_id: str | None = None
    litellm_team_status: str | None = None
    has_virtual_key: bool
    last_key_rotated_at: str | None = None
    budget_max_usd: float | None = None
    budget_period: str | None = None
    budget_spend_usd: float | None = None
    guardrail_ids: list[str] = Field(default_factory=list)
    model_alias: str | None = None


class VirtualKeyMetadata(BaseModel):
    """Public-facing Virtual Key metadata — value NEVER exposed."""

    id: str
    tenant_id: str
    alias: str
    created_at: str
    last_used_at: str | None = None
    status: str  # "active" | "rotated" | "revoked"
    fingerprint: str  # sha256 prefix for correlation


class MCPBrowserEntry(BaseModel):
    id: str
    name: str
    transport: str
    command: str
    url: str
    scopes: list[str] = Field(default_factory=list)
    status: str


class HealthReport(BaseModel):
    healthy: bool
    last_check_at: str | None = None
    last_ok_at: str | None = None
    last_fail_at: str | None = None
    consecutive_failures: int
    last_error: str | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _redact_value(value: str) -> str:
    """Best-effort fingerprint for an arbitrary key value.

    Used to populate :attr:`VirtualKeyMetadata.fingerprint` so the
    UI can show a stable correlation token without ever exposing the
    key value itself.
    """
    import hashlib

    return f"sha256:{hashlib.sha256(value.encode()).hexdigest()[:12]}"


async def _collect_tenant_config(
    tid: str,
    pid: str,
    *,
    tenant_sync_svc: TenantSync,
    key_mgr: VirtualKeyManager,
    guardrail_svc: GuardrailSync,
) -> TenantLLMConfig:
    """Compose a :class:`TenantLLMConfig` from the integration layer.

    Each sub-call is best-effort — if any one fails, the rest still
    populate, and the caller can render the partial state.
    """
    team_id: str | None = None
    team_status: str | None = None
    try:
        team_id = await tenant_sync_svc.get_team_id(tid)
    except Exception as exc:  # pragma: no cover — DB path
        logger.warning(
            "admin_llm_gateway.team_lookup_failed",
            tenant_id=tid,
            error=str(exc),
        )

    has_key = False
    try:
        kv = await key_mgr.get_key(tid)
        has_key = kv is not None
    except Exception as exc:  # pragma: no cover — Secrets Manager path
        logger.warning(
            "admin_llm_gateway.key_lookup_failed",
            tenant_id=tid,
            error=str(exc),
        )

    guardrail_ids: list[str] = []
    try:
        guardrail_ids = await guardrail_svc.get_for_tenant(tid)
    except Exception as exc:  # pragma: no cover — DB path
        logger.warning(
            "admin_llm_gateway.guardrails_failed",
            tenant_id=tid,
            error=str(exc),
        )

    return TenantLLMConfig(
        tenant_id=tid,
        project_id=pid,
        litellm_team_id=team_id,
        litellm_team_status=team_status,
        has_virtual_key=has_key,
        budget_max_usd=None,
        budget_period=None,
        budget_spend_usd=None,
        guardrail_ids=guardrail_ids,
        model_alias=None,
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/tenants/{tenant_id}", response_model=TenantLLMConfig)
@audit(action="admin.llm_gateway.tenant.get", target_type="tenant")
async def get_tenant_llm_config(
    tenant_id: UUID,
    principal: Principal,
    _perm: Principal = require_permission("admin:read"),
) -> TenantLLMConfig:
    """Return the tenant's LLM gateway config (model, budget, guardrails)."""
    tid = str(tenant_id)
    return await _collect_tenant_config(
        tid,
        str(principal.project_id),
        tenant_sync_svc=tenant_sync,
        key_mgr=virtual_key_manager,
        guardrail_svc=guardrail_sync,
    )


@router.get("/tenants/{tenant_id}/keys", response_model=list[VirtualKeyMetadata])
@audit(action="admin.llm_gateway.keys.list", target_type="tenant")
async def list_tenant_keys(
    tenant_id: UUID,
    principal: Principal,
    _perm: Principal = require_permission("admin:read"),
) -> list[VirtualKeyMetadata]:
    """Return the tenant's Virtual Key metadata.

    The key VALUE is intentionally not present in the response. The
    only way to obtain a key value is the internal hot path
    (:class:`VirtualKeyManager.get_key`); the API surface never
    returns it (per the F-829 plan, "Critical rules: never display a
    Virtual Key VALUE in any UI surface").
    """
    from datetime import datetime, timezone

    from sqlalchemy import select

    from app.db.models.litellm_key_audit import LiteLLMKeyAction, LiteLLMKeyAudit
    from app.db.rls import tenant_context
    from app.db.session import get_session_factory

    tid = str(tenant_id)
    factory = get_session_factory()

    # Most recent audit row per alias — yields the alias's current state.
    rows: list[dict[str, Any]] = []
    try:
        async with factory() as session:
            async with tenant_context(session, tid):
                result = await session.scalars(
                    select(LiteLLMKeyAudit)
                    .where(LiteLLMKeyAudit.tenant_id == tid)
                    .order_by(LiteLLMKeyAudit.occurred_at.desc())
                )
                seen: set[str] = set()
                for audit_row in result.all():
                    alias = audit_row.litellm_key_alias or ""
                    if alias in seen:
                        continue
                    seen.add(alias)
                    rows.append(
                        {
                            "id": str(audit_row.id),
                            "tenant_id": tid,
                            "alias": alias,
                            "created_at": audit_row.occurred_at.isoformat()
                            if audit_row.occurred_at
                            else datetime.now(timezone.utc).isoformat(),
                            "last_used_at": None,
                            "status": _derive_status(audit_row.action),
                            "fingerprint": (audit_row.litellm_key_hash or "")[:12],
                        }
                    )
    except Exception as exc:  # pragma: no cover — DB path
        logger.warning(
            "admin_llm_gateway.keys_list_failed",
            tenant_id=tid,
            error=str(exc),
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not read key audit log.",
        ) from exc

    return [VirtualKeyMetadata(**row) for row in rows]


def _derive_status(action: LiteLLMKeyAction | str) -> str:
    """Map an audit action to a UI status string."""
    try:
        a = action.value if hasattr(action, "value") else str(action)
    except Exception:  # pragma: no cover — defensive
        a = str(action)
    if a == LiteLLMKeyAction.REVOKED.value:
        return "revoked"
    if a == LiteLLMKeyAction.ROTATED.value:
        return "rotated"
    return "active"


class RotateKeyRequest(BaseModel):
    actor_id: str | None = None
    reason: str | None = None


@router.post(
    "/tenants/{tenant_id}/keys/rotate",
    response_model=VirtualKeyMetadata,
)
@audit(action="admin.llm_gateway.keys.rotate", target_type="tenant")
async def rotate_tenant_key(
    tenant_id: UUID,
    body: RotateKeyRequest,
    principal: Principal,
    _perm: Principal = require_permission("admin:write"),
) -> VirtualKeyMetadata:
    """Rotate the tenant's Virtual Key and return the new metadata.

    The newly minted key VALUE is intentionally discarded; only the
    audit row's fingerprint is returned to the caller.
    """
    tid = str(tenant_id)
    try:
        new_value = await virtual_key_manager.rotate_key(
            tenant_id=tid,
            actor_id=body.actor_id or str(principal.user_id),
        )
    except LookupError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    except Exception as exc:  # pragma: no cover — network path
        logger.warning(
            "admin_llm_gateway.rotate_failed",
            tenant_id=tid,
            error=str(exc),
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="LiteLLM did not accept the rotation request.",
        ) from exc

    fingerprint = _redact_value(new_value)
    return VirtualKeyMetadata(
        id="",
        tenant_id=tid,
        alias=f"forge-{tid}-rotated",
        created_at="",
        last_used_at=None,
        status="active",
        fingerprint=fingerprint,
    )


class RevokeKeyRequest(BaseModel):
    actor_id: str | None = None
    reason: str = Field(..., min_length=1)


@router.post(
    "/tenants/{tenant_id}/keys/{key_id}/revoke",
    response_model=VirtualKeyMetadata,
)
@audit(action="admin.llm_gateway.keys.revoke", target_type="tenant")
async def revoke_tenant_key(
    tenant_id: UUID,
    key_id: str,
    body: RevokeKeyRequest,
    principal: Principal,
    _perm: Principal = require_permission("admin:write"),
) -> VirtualKeyMetadata:
    """Revoke a specific Virtual Key (by audit row id) for a tenant."""
    tid = str(tenant_id)
    try:
        await virtual_key_manager.revoke_key(
            tenant_id=tid,
            actor_id=body.actor_id or str(principal.user_id),
            reason=body.reason,
        )
    except Exception as exc:  # pragma: no cover — network path
        logger.warning(
            "admin_llm_gateway.revoke_failed",
            tenant_id=tid,
            key_id=key_id,
            error=str(exc),
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="LiteLLM did not accept the revoke request.",
        ) from exc

    return VirtualKeyMetadata(
        id=key_id,
        tenant_id=tid,
        alias="",
        created_at="",
        last_used_at=None,
        status="revoked",
        fingerprint="",
    )


@router.get("/mcp-servers", response_model=list[MCPBrowserEntry])
@audit(action="admin.llm_gateway.mcp.list", target_type="platform")
async def list_mcp_servers(
    principal: Principal,
    _perm: Principal = require_permission("admin:read"),
) -> list[MCPBrowserEntry]:
    """List the LiteLLM MCP servers (read-only)."""
    rows = await mcp_server_registry.list_servers()
    return [MCPBrowserEntry(**{k: v for k, v in r.items() if k != "raw"}) for r in rows]


@router.get("/health", response_model=HealthReport)
@audit(action="admin.llm_gateway.health", target_type="platform")
async def get_litellm_health(
    principal: Principal,
    _perm: Principal = require_permission("admin:read"),
) -> HealthReport:
    """Return the cached LiteLLM health snapshot."""
    try:
        from app.integrations.litellm import health_monitor

        snap = health_monitor.snapshot()
    except Exception:  # pragma: no cover — degrade gracefully
        return HealthReport(
            healthy=False,
            last_check_at=None,
            last_ok_at=None,
            last_fail_at=None,
            consecutive_failures=0,
            last_error="health_monitor_unavailable",
        )

    return HealthReport(
        healthy=bool(snap.get("is_healthy", False)),
        last_check_at=snap.get("last_check_at"),
        last_ok_at=snap.get("last_state_change_at"),
        last_fail_at=None,
        consecutive_failures=int(snap.get("consecutive_failures", 0)),
        last_error=None,
    )


# ---------------------------------------------------------------------------
# Zone 10 — Spend / Guardrails / Models (LiteLLM passthrough)
# ---------------------------------------------------------------------------


class SpendByTeam(BaseModel):
    """Per-team spend aggregation."""

    team_id: str | None = None
    team_alias: str | None = None
    spend: float = 0.0
    max_budget: float = 0.0


class ModelInfo(BaseModel):
    """LiteLLM model catalog entry.

    Costs are converted from per-token to per-million-token display.
    """

    name: str
    provider: str
    max_tokens: int | None = None
    max_input_tokens: int | None = None
    input_cost: float = 0.0
    output_cost: float = 0.0


@router.get("/spend/teams", response_model=list[SpendByTeam])
@audit(action="admin.llm_gateway.spend.teams", target_type="platform")
async def spend_by_teams(
    principal: Principal,
    _perm: Principal = require_permission("admin:read"),
) -> list[SpendByTeam]:
    """Per-team spend aggregation (LiteLLM /team/list)."""
    teams = await list_teams()
    return [
        SpendByTeam(
            team_id=t.get("team_id"),
            team_alias=t.get("team_alias"),
            spend=float(t.get("spend", 0) or 0),
            max_budget=float(t.get("max_budget", 0) or 0),
        )
        for t in teams
    ]


@router.get("/spend/models", response_model=list[dict])
@audit(action="admin.llm_gateway.spend.models", target_type="platform")
async def spend_by_models(
    principal: Principal,
    _perm: Principal = require_permission("admin:read"),
) -> list[dict]:
    """Per-model spend breakdown — direct passthrough to /spend/models."""
    result = await _request("GET", "/spend/models")
    if isinstance(result, list):
        return result
    if isinstance(result, dict):
        return [result]
    return []


@router.get("/guardrails", response_model=list[dict])
@audit(action="admin.llm_gateway.guardrails.list", target_type="platform")
async def list_guardrails_endpoint(
    principal: Principal,
    _perm: Principal = require_permission("admin:read"),
) -> list[dict]:
    """List configured LiteLLM guardrails."""
    result = await list_guardrails()
    return list(result) if isinstance(result, list) else []


@router.post("/guardrails/{name}/enable", response_model=dict)
@audit(action="admin.llm_gateway.guardrails.toggle", target_type="guardrail")
async def enable_guardrail(
    name: str,
    principal: Principal,
    _perm: Principal = require_permission("admin:write"),
) -> dict:
    """Enable a LiteLLM guardrail by name."""
    result = await update_guardrail(name, {"enabled": True})
    return result if isinstance(result, dict) else {"enabled": True, "guardrail_name": name}


@router.post("/guardrails/{name}/disable", response_model=dict)
@audit(action="admin.llm_gateway.guardrails.toggle", target_type="guardrail")
async def disable_guardrail(
    name: str,
    principal: Principal,
    _perm: Principal = require_permission("admin:write"),
) -> dict:
    """Disable a LiteLLM guardrail by name."""
    result = await update_guardrail(name, {"enabled": False})
    return result if isinstance(result, dict) else {"enabled": False, "guardrail_name": name}


@router.get("/models", response_model=list[ModelInfo])
@audit(action="admin.llm_gateway.models.list", target_type="platform")
async def list_models_endpoint(
    principal: Principal,
    _perm: Principal = require_permission("admin:read"),
) -> list[ModelInfo]:
    """LiteLLM model catalog with per-million-token pricing."""
    payload = await list_models()
    rows: list[dict[str, Any]] = []
    if isinstance(payload, dict):
        rows = payload.get("data", []) or []
    elif isinstance(payload, list):
        rows = payload

    out: list[ModelInfo] = []
    for m in rows:
        model_id = m.get("id") or m.get("model_name") or ""
        provider = model_id.split("/", 1)[0] if "/" in model_id else "unknown"
        out.append(
            ModelInfo(
                name=model_id,
                provider=provider,
                max_tokens=m.get("max_tokens"),
                max_input_tokens=m.get("max_input_tokens"),
                input_cost=float(m.get("input_cost_per_token", 0) or 0) * 1_000_000,
                output_cost=float(m.get("output_cost_per_token", 0) or 0) * 1_000_000,
            )
        )
    return out


__all__ = ["router"]
