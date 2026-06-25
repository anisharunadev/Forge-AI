"""F-800 Plan 1 — Forge Co-pilot REST endpoints.

Seven endpoints per spec §7.1, all gated on ``copilot:use`` permission
(or ``forge:admin`` via the RBAC super-user shortcut).

Endpoints:

* ``POST   /api/v1/copilot/conversations``         — create/continue + run a turn
* ``GET    /api/v1/copilot/conversations``         — list the caller's threads
* ``GET    /api/v1/copilot/conversations/{id}``    — fetch one thread + messages
* ``DELETE /api/v1/copilot/conversations/{id}``    — soft-delete
* ``POST   /api/v1/copilot/messages/{id}/feedback``— record thumbs rating
* ``GET    /api/v1/copilot/tools``                 — Steward-facing tool catalog
* ``GET    /api/v1/copilot/conversations/{id}/cost``— running cost + budget

A master toggle (``settings.copilot_enabled``) hides the entire surface
behind 404 when the feature is off.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from app.api.deps import DbSession, Principal, require_permission
from app.core.audit import audit
from app.core.security import AuthenticatedPrincipal
from app.core.config import settings
from app.core.logging import get_logger
from app.schemas.copilot import (
    CopilotChatRequest,
    CopilotChatResponse,
    CopilotConversationRead,
    CopilotConversationSummary,
    CopilotCostRead,
    CopilotFeedbackRequest,
    CopilotToolRead,
)
from app.services._litellm_tools import ToolLoopExhausted
from app.services.audit_service import audit_service
from app.services.copilot_rate_limit import (
    RateLimitExceeded,
    copilot_rate_limiter,
)
from app.services.copilot_service import (
    CopilotBudgetBlocked,
    CopilotService,
)
from app.services.rbac import COPILOT_PERMISSION_USE
from app.services.workflow_budget import BudgetExceeded

logger = get_logger(__name__)

router = APIRouter(prefix="/copilot", tags=["copilot"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _ensure_enabled() -> None:
    """Master toggle — 404 when the Co-pilot feature is off.

    404 (not 403) so the surface looks uninstalled rather than
    forbidden; the frontend uses the same code as "endpoint missing".
    """
    if not settings.copilot_enabled:
        raise HTTPException(status_code=404, detail="copilot_disabled")


def _service(
    principal: Principal, db: DbSession
) -> CopilotService:
    return CopilotService(db=db, principal=principal)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post(
    "/conversations",
    response_model=CopilotChatResponse,
    status_code=status.HTTP_200_OK,
)
@audit(action="copilot.conversation.chat", target_type="copilot_conversation")
async def post_chat(
    request: CopilotChatRequest,
    db: DbSession,
    principal: AuthenticatedPrincipal = Depends(require_permission(COPILOT_PERMISSION_USE)),
) -> CopilotChatResponse:
    """Run one chat turn end-to-end.

    Creates a new conversation when ``request.conversation_id`` is
    omitted; otherwise continues the existing one (must belong to the
    caller).
    """
    _ensure_enabled()

    # Per-user rate limit (Plan 5). Sliding 60s window keyed by
    # (user_id, tenant_id); 429 with Retry-After when the cap is hit.
    try:
        await copilot_rate_limiter.check_and_record(
            principal.user_id, principal.tenant_id
        )
    except RateLimitExceeded as exc:
        # Audit the block so we can detect rate-limit abuse patterns
        # (sudden spikes from a single user, etc.).
        try:
            await audit_service.record(
                tenant_id=principal.tenant_id,
                project_id=principal.project_id,
                actor_id=principal.user_id,
                action="copilot.rate_limit_blocked",
                target_type="copilot_conversation",
                target_id="",
                payload={
                    "retry_after_seconds": exc.retry_after_seconds,
                    "limit": settings.copilot_rate_limit_per_min,
                },
            )
        except Exception:  # noqa: BLE001
            logger.warning("copilot.api.rate_limit_audit_failed")
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "error": "copilot.rate_limit_exceeded",
                "retry_after_seconds": exc.retry_after_seconds,
            },
            headers={"Retry-After": str(exc.retry_after_seconds)},
        ) from exc

    service = _service(principal, db)
    try:
        return await service.chat(request)
    except CopilotBudgetBlocked as exc:
        logger.warning(
            "copilot.api.budget_blocked",
            conversation_id=str(exc.workflow_id),
            spent=exc.spent,
            ceiling=exc.ceiling,
        )
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "error": "copilot.budget_blocked",
                "spent_usd": exc.spent,
                "ceiling_usd": exc.ceiling,
            },
            headers={"Retry-After": "60"},
        ) from exc
    except BudgetExceeded as exc:
        # Defensive: a synthetic subclass above should match first,
        # but the broader class is mapped the same way.
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "error": "copilot.budget_blocked",
                "spent_usd": exc.spent,
                "ceiling_usd": exc.ceiling,
            },
            headers={"Retry-After": "60"},
        ) from exc
    except ToolLoopExhausted as exc:
        logger.warning(
            "copilot.api.tool_loop_exhausted",
            max_turns=exc.max_turns,
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "error": "copilot.tool_loop_exhausted",
                "max_turns": exc.max_turns,
            },
        ) from exc


@router.get(
    "/conversations",
    response_model=list[CopilotConversationSummary],
)
@audit(action="copilot.conversation.list", target_type="copilot_conversation")
async def list_conversations(
    principal: Principal,
    db: DbSession,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    _perm: Principal = require_permission(COPILOT_PERMISSION_USE),
) -> list[CopilotConversationSummary]:
    """List the caller's conversations in the tenant."""
    _ensure_enabled()
    service = _service(principal, db)
    return await service.list_conversations(limit=limit, offset=offset)


@router.get(
    "/conversations/{conversation_id}",
    response_model=CopilotConversationRead,
)
@audit(action="copilot.conversation.get", target_type="copilot_conversation")
async def get_conversation(
    conversation_id: UUID,
    principal: Principal,
    db: DbSession,
    _perm: Principal = require_permission(COPILOT_PERMISSION_USE),
) -> CopilotConversationRead:
    """Fetch a conversation + messages (caller-scoped)."""
    _ensure_enabled()
    service = _service(principal, db)
    try:
        return await service.get_conversation(conversation_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete(
    "/conversations/{conversation_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
@audit(action="copilot.conversation.delete", target_type="copilot_conversation")
async def delete_conversation(
    conversation_id: UUID,
    principal: Principal,
    db: DbSession,
    _perm: Principal = require_permission(COPILOT_PERMISSION_USE),
):
    """Soft-delete (archive) the caller's conversation."""
    _ensure_enabled()
    service = _service(principal, db)
    try:
        await service.delete_conversation(conversation_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/messages/{message_id}/feedback",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
@audit(action="copilot.feedback.submit", target_type="copilot_message")
async def submit_feedback(
    message_id: UUID,
    request: CopilotFeedbackRequest,
    principal: Principal,
    db: DbSession,
    _perm: Principal = require_permission(COPILOT_PERMISSION_USE),
):
    """Record a thumbs-up/down + comment on an assistant message."""
    _ensure_enabled()
    service = _service(principal, db)
    try:
        await service.submit_feedback(message_id, request)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/tools",
    response_model=list[CopilotToolRead],
)
@audit(action="copilot.tools.list", target_type="copilot_tool")
async def list_tools(
    principal: Principal,
    db: DbSession,
    _perm: Principal = require_permission(COPILOT_PERMISSION_USE),
) -> list[CopilotToolRead]:
    """Steward-facing tool catalog."""
    _ensure_enabled()
    service = _service(principal, db)
    return await service.list_tools()


@router.get(
    "/conversations/{conversation_id}/cost",
    response_model=CopilotCostRead,
)
@audit(action="copilot.conversation.get_cost", target_type="copilot_conversation")
async def get_conversation_cost(
    conversation_id: UUID,
    principal: Principal,
    db: DbSession,
    _perm: Principal = require_permission(COPILOT_PERMISSION_USE),
) -> CopilotCostRead:
    """Return running cost + budget status for the conversation."""
    _ensure_enabled()
    service = _service(principal, db)
    try:
        return await service.get_conversation_cost(conversation_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


__all__ = ["router"]