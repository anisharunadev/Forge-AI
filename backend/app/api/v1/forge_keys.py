"""P4 / Phase 4 — `/api/forge/keys*` (spec step-75 §F4).

Thin HTTP layer over ``ForgeKeyBroker``. Per agent-scoped routes
(issue / status / rotate / revoke) live under
``/forge/agents/{agent_id}/key/...``; the flat ``GET /forge/keys``
list is the tenant-scoped rollup.

Rule 1: no provider SDKs — broker itself proxies to LiteLLM.
Rule 2: every query is tenant-scoped; list endpoint filters on
``principal.tenant_id`` and never crosses projects.
Rule 6: audit fires inside the broker (issue / rotate / revoke).
Security: secret key material is NEVER returned — the responses
carry only the fingerprint + alias metadata.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select

from app.agents.approval_gate import require_approval_phase
from app.agents.sdlc_state import SDLCPhase
from app.core.auth import CurrentUser
from app.core.logging import get_logger
from app.core.security import AuthenticatedPrincipal
from app.db.models.agent import Agent
from app.db.session import get_session_factory
from app.schemas.forge_keys import (
    ForgeKeyIssueRequest,
    ForgeKeyIssueResponse,
    ForgeKeyRevokeRequest,
    ForgeKeyRevokeResponse,
    ForgeKeyRotateRequest,
    ForgeKeyRotateResponse,
    ForgeKeyStatus,
    ForgeKeyStatusListResponse,
)
from app.services.forge_key_broker import (
    AgentVirtualKey,
    ForgeKeyBroker,
    forge_key_broker,
)

router = APIRouter(prefix="/forge", tags=["forge.keys"])
logger = get_logger(__name__)


async def require_tenant(
    principal: Annotated[AuthenticatedPrincipal, Depends(CurrentUser)],
) -> AuthenticatedPrincipal:
    """Caller-scoped dep: tenant_id claim must be present (Rule 2)."""
    if not principal.tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="token_missing_tenant_claim",
        )
    return principal


async def require_admin(
    principal: Annotated[AuthenticatedPrincipal, Depends(CurrentUser)],
) -> AuthenticatedPrincipal:
    """Admin dep: owner/admin role required for key lifecycle writes."""
    if not principal.tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="token_missing_tenant_claim",
        )
    roles = {r.lower() for r in principal.roles}
    if not roles.intersection({"owner", "admin"}):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="admin_role_required",
        )
    return principal


async def _load_agent_for_principal(agent_id: UUID, principal: AuthenticatedPrincipal) -> Agent:
    """Fetch the agent and enforce cross-tenant isolation.

    Any attempt by a caller to touch an agent belonging to a different
    tenant returns 404 — never 403 — to avoid leaking the existence
    of the foreign row. (Rule 2.)
    """
    factory = get_session_factory()
    async with factory() as session:
        agent = await session.get(Agent, agent_id)
        if agent is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="agent_not_found",
            )
        if str(agent.tenant_id) != str(principal.tenant_id):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="agent_not_found",
            )
        return agent


def _status_to_issue_response(status_obj: ForgeKeyStatus) -> ForgeKeyIssueResponse:
    """Narrow a ``ForgeKeyStatus`` to the ``Issue`` payload.

    The issue response NEVER carries the secret — only the fingerprint
    and timing metadata.
    """
    return ForgeKeyIssueResponse(
        agent_id=status_obj.agent_id,
        fingerprint=status_obj.fingerprint,
        status=status_obj.status,
        model_scope=list(status_obj.model_scope),
        created_at=status_obj.created_at,
    )


@require_approval_phase(SDLCPhase.IMPLEMENTATION)
@router.post(
    "/agents/{agent_id}/key/issue",
    response_model=ForgeKeyIssueResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Provision a LiteLLM virtual key for an agent (no secret returned)",
    responses={
        404: {"description": "Agent not found or belongs to another tenant"},
    },
)
async def issue_key(
    agent_id: UUID,
    body: ForgeKeyIssueRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(require_tenant)],
) -> ForgeKeyIssueResponse:
    """Mint a virtual key via the broker. Caller-scoped to tenant.

    The secret is returned one-shot over a server-side channel outside
    this surface; the HTTP response only carries the ``fingerprint``
    (non-secret identifier) and metadata.
    """
    if body.agent_id != agent_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="agent_id_mismatch",
        )

    agent = await _load_agent_for_principal(agent_id, principal)
    broker: ForgeKeyBroker = forge_key_broker

    issued = await broker.issue(
        agent=agent,
        model_scope=list(body.model_scope) if body.model_scope else None,
        max_budget_usd=body.max_budget_usd,
        tpm_limit=body.tpm_limit,
        rpm_limit=body.rpm_limit,
        expires_at=body.expires_at,
    )
    return _status_to_issue_response(issued)


@router.get(
    "/agents/{agent_id}/key/status",
    response_model=ForgeKeyStatus,
    summary="Active key status (fingerprint + budget) for an agent",
    responses={404: {"description": "No active key for this agent"}},
)
async def get_key_status(
    agent_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(require_tenant)],
) -> ForgeKeyStatus:
    """Tenant-scoped lookup. 404 when there is no active row."""
    # Even though we don't fetch the agent, enforce tenancy up front.
    await _load_agent_for_principal(agent_id, principal)

    status_obj = await forge_key_broker.get_status(agent_id)
    if status_obj is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="no_active_key",
        )
    return status_obj


@require_approval_phase(SDLCPhase.IMPLEMENTATION)
@router.post(
    "/agents/{agent_id}/key/rotate",
    response_model=ForgeKeyRotateResponse,
    summary="Rotate an agent's virtual key (admin only)",
    responses={
        404: {"description": "Agent not found or no active key to rotate"},
    },
)
async def rotate_key(
    agent_id: UUID,
    body: ForgeKeyRotateRequest,
    _admin: Annotated[AuthenticatedPrincipal, Depends(require_admin)],
) -> ForgeKeyRotateResponse:
    """Mint a new key + block the old upstream alias. Old + new
    fingerprints returned; the secret itself is never returned.
    """
    if body.agent_id != agent_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="agent_id_mismatch",
        )

    try:
        return await forge_key_broker.rotate(agent_id=agent_id, reason=body.reason)
    except LookupError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc


@require_approval_phase(SDLCPhase.IMPLEMENTATION)
@router.post(
    "/agents/{agent_id}/key/revoke",
    response_model=ForgeKeyRevokeResponse,
    summary="Revoke an agent's virtual key (admin only)",
    responses={
        404: {"description": "Agent not found or no active key to revoke"},
    },
)
async def revoke_key(
    agent_id: UUID,
    body: ForgeKeyRevokeRequest,
    _admin: Annotated[AuthenticatedPrincipal, Depends(require_admin)],
) -> ForgeKeyRevokeResponse:
    """Block the upstream key + mark the row revoked. Admin only."""
    if body.agent_id != agent_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="agent_id_mismatch",
        )

    try:
        return await forge_key_broker.revoke(agent_id=agent_id, reason=body.reason)
    except LookupError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc


@router.get(
    "/keys",
    response_model=ForgeKeyStatusListResponse,
    summary="All active keys for the caller's tenant",
)
async def list_keys(
    principal: Annotated[AuthenticatedPrincipal, Depends(require_tenant)],
) -> ForgeKeyStatusListResponse:
    """Tenant-scoped rollup. Returns one ``ForgeKeyStatus`` per agent
    with an active key — never across tenant boundaries (Rule 2).
    """
    tenant_id = UUID(str(principal.tenant_id))
    factory = get_session_factory()

    # ponytail: tenant-scoped query; broker.get_status would re-fetch one
    # at a time with N DB hops, so list directly against the table and
    # build the typed response. Keeps the surface linear in active-keys.
    async with factory() as session:
        rows = (
            await session.scalars(
                select(AgentVirtualKey).where(
                    AgentVirtualKey.tenant_id == tenant_id,
                    AgentVirtualKey.status == "active",
                )
            )
        ).all()

        results: list[ForgeKeyStatus] = []
        for row in rows:
            max_b = float(row.max_budget_usd or 0.0)
            used = 0.0
            pct = 0.0
            if max_b > 0:
                pct = used / max_b
            results.append(
                ForgeKeyStatus(
                    agent_id=row.agent_id,
                    fingerprint=row.fingerprint,
                    status="active",
                    model_scope=list(row.model_scope) if row.model_scope else [],
                    max_budget_usd=max_b,
                    budget_used_usd=used,
                    budget_pct=pct,
                    tpm_limit=row.tpm_limit,
                    rpm_limit=row.rpm_limit,
                    expires_at=row.expires_at,
                    created_at=row.created_at,
                    rotated_at=row.rotated_at,
                    revoked_at=row.revoked_at,
                    litellm_key_alias=row.litellm_key_alias,
                )
            )

    return ForgeKeyStatusListResponse(
        keys=results,
        fetched_at=datetime.now(UTC),
    )


__all__ = ["router"]
