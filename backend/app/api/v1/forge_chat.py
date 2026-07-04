"""step-75 P5 — `/api/forge/chat*` chat surface (SSE).

Thin HTTP layer over :mod:`app.services.forge_chat`. Three routes:

* ``POST /forge/chat/stream``   — SSE passthrough to LiteLLM.
* ``POST /forge/chat/cancel``   — abort an in-flight stream.
* ``GET  /forge/chat/runs/{id}`` — durable status lookup.

Rule 1: no provider SDKs — the service proxies through LiteLLM.
Rule 2: every call is tenant-scoped via ``principal``.
Rule 6: audit is emitted by the service, not the route.
"""

from __future__ import annotations

import json
from typing import Annotated, AsyncIterator
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse

from app.core.logging import get_logger
from app.core.security import AuthenticatedPrincipal
from app.core.auth import CurrentUser
from app.schemas.forge_chat import (
    ChatCancelRequest,
    ChatCancelResponse,
    ChatStreamChunk,
    ChatStreamRequest,
    ForgeRunStatus,
)
from app.services.forge_chat import Principal, cancel_run, get_run_status, stream_chat
from app.services.forge_chat_errors import (
    AgentBudgetExceededError,
    AuthenticationError,
    ContextLengthExceededError,
    ForgeChatError,
    RateLimitError,
    UpstreamError,
    ValidationError,
)
from app.agents.approval_gate import require_approval_phase
from app.agents.sdlc_state import SDLCPhase

router = APIRouter(prefix="/forge", tags=["forge.chat"])
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


def _principal_from(principal: AuthenticatedPrincipal) -> Principal:
    """Build the TypedDict the chat service expects."""
    return Principal(
        tenant_id=str(principal.tenant_id),
        project_id=str(principal.project_id) if principal.project_id else None,
        user_id=str(principal.user_id),
        team_id=str(principal.team_id) if getattr(principal, "team_id", None) else None,
    )


def _sse_envelope(chunk: ChatStreamChunk) -> bytes:
    """Serialize one ChatStreamChunk as an SSE frame."""
    payload = json.dumps(
        {
            "event": chunk.event,
            "data": chunk.data,
            "run_id": str(chunk.run_id),
            "agent_id": str(chunk.agent_id),
            "model": chunk.model,
            "ts": chunk.ts.isoformat(),
        },
        default=str,
    )
    return f"event: {chunk.event}\ndata: {payload}\n\n".encode("utf-8")


def _sse_error(code: str, message: str) -> bytes:
    """Typed-error envelope for the SSE error channel."""
    payload = json.dumps({"code": code, "message": message})
    return f"event: error\ndata: {payload}\n\n".encode("utf-8")
@require_approval_phase(SDLCPhase.IMPLEMENTATION)


@router.post(
    "/chat/stream",
    summary="SSE stream of a chat completion for an agent",
    response_class=StreamingResponse,
    responses={
        401: {"description": "Authentication failed"},
        402: {"description": "Agent budget exceeded"},
        413: {"description": "Context length exceeded"},
        422: {"description": "Validation error"},
        429: {"description": "Rate limit exceeded"},
        502: {"description": "Upstream LLM error"},
    },
)
async def stream_chat_endpoint(
    body: ChatStreamRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(require_tenant)],
) -> StreamingResponse:
    """Stream Forge SSE envelopes for ``body.agent_id``."""
    agent_id = body.agent_id
    principal_td = _principal_from(principal)

    async def generator() -> AsyncIterator[bytes]:
        try:
            async for chunk in stream_chat(principal_td, agent_id, body):
                yield _sse_envelope(chunk)
        except AuthenticationError as exc:
            logger.info(
                "forge_chat.stream_auth_error",
                run_id=str(getattr(body, "run_id", "")),
                code=exc.code,
            )
            yield _sse_error(exc.code, exc.message)
        except AgentBudgetExceededError as exc:
            yield _sse_error(exc.code, exc.message)
        except ContextLengthExceededError as exc:
            yield _sse_error(exc.code, exc.message)
        except ValidationError as exc:
            yield _sse_error(exc.code, exc.message)
        except RateLimitError as exc:
            yield _sse_error(exc.code, exc.message)
        except UpstreamError as exc:
            yield _sse_error(exc.code, exc.message)
        except ForgeChatError as exc:
            yield _sse_error(exc.code, exc.message)

    headers = {
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
        "Content-Type": "text/event-stream",
    }
    return StreamingResponse(generator(), media_type="text/event-stream", headers=headers)
@require_approval_phase(SDLCPhase.IMPLEMENTATION)


@router.post(
    "/chat/cancel",
    response_model=ChatCancelResponse,
    summary="Cancel an in-flight chat stream",
)
async def cancel_chat_endpoint(
    body: ChatCancelRequest,
    _principal: Annotated[AuthenticatedPrincipal, Depends(require_tenant)],
) -> ChatCancelResponse:
    """Signal the stream registry to abort ``body.run_id``."""
    return await cancel_run(body.run_id)


@router.get(
    "/chat/runs/{run_id}",
    response_model=ForgeRunStatus,
    summary="Durable status for a chat run (live or completed)",
    responses={404: {"description": "Run not found"}},
)
async def get_chat_run_status(
    run_id: UUID,
    _principal: Annotated[AuthenticatedPrincipal, Depends(require_tenant)],
) -> ForgeRunStatus:
    """Live registry first; falls back to the persisted spend record."""
    result = await get_run_status(run_id)
    if result is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="run_not_found",
        )
    return result


__all__ = ["router"]