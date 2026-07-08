"""Phase 4 J — Rule 6 audit columns populated on a non-zero turn.

Verifies that ``CopilotService._audit_and_emit`` forwards ``model``,
``prompt_hash``, ``cost_usd``, and ``artifact_ref`` into the
``AuditEvent`` row when the cost-incurred audit fires.
"""

from __future__ import annotations

import uuid
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


def _stub_response(model_name: str = "gpt-4o") -> dict[str, Any]:
    return {
        "id": "chatcmpl-audit-cols",
        "model": model_name,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": "ok"},
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 4, "completion_tokens": 2, "cost_usd": 0.0021},
    }


def _principal(**kwargs: Any) -> Any:
    from app.core.security import AuthenticatedPrincipal

    return AuthenticatedPrincipal(
        user_id=str(kwargs.get("user_id") or uuid.uuid4()),
        email="t@example.com",
        tenant_id=str(kwargs.get("tenant_id") or uuid.uuid4()),
        project_id=str(uuid.uuid4()) if kwargs.get("project_id") is not None else None,
        roles=[],
        raw_claims={"forge.permissions": list(kwargs.get("permissions") or [])},
    )


@pytest.mark.asyncio
async def test_cost_incurred_audit_populates_rule6_columns(sqlite_db):
    """The cost-incurred audit row carries model, prompt_hash, cost_usd,
    and artifact_ref after a non-zero turn."""
    from app.services.copilot_service import CopilotService

    tenant_id = uuid.uuid4()
    user_id = uuid.uuid4()
    principal = _principal(tenant_id=tenant_id, user_id=user_id, permissions=["copilot:use"])

    response_shape = _stub_response()

    async def _no_op_aenter(self: Any) -> Any:
        return self

    async def _no_op_aexit(self: Any, *args: Any) -> None:
        return None

    with (
        patch("app.services.litellm_client.LiteLLMClient.__aenter__", _no_op_aenter),
        patch("app.services.litellm_client.LiteLLMClient.__aexit__", _no_op_aexit),
        patch(
            "app.services.litellm_client.LiteLLMClient.agent_loop",
            AsyncMock(return_value=(response_shape, [], [])),
        ),
        patch(
            "app.services.copilot_service.default_bus",
            MagicMock(publish=AsyncMock()),
        ),
    ):
        # Bind a captured recorder onto the audit_service mock.
        import app.services.copilot_service as cs
        captured: list[dict[str, Any]] = []

        async def _record(**kwargs: Any) -> uuid.UUID:
            captured.append(kwargs)
            return uuid.uuid4()

        cs.audit_service.record = AsyncMock(side_effect=_record)

        async with sqlite_db() as db:
            service = CopilotService(db=db, principal=principal)
            from app.schemas.copilot import CopilotChatRequest, CopilotPageContext

            req = CopilotChatRequest(
                conversation_id=None,
                project_id=uuid.uuid4(),
                message="hello world",
                context=CopilotPageContext(
                    current_page="/x",
                    current_center=None,
                    recent_actions=[],
                ),
            )
            await service.chat(req)

    cost_calls = [c for c in captured if c.get("action") == "copilot.cost.incurred"]
    assert cost_calls, f"no copilot.cost.incurred audit emitted; saw actions: {[c.get('action') for c in captured]}"
    call = cost_calls[-1]
    assert call.get("model"), f"model not populated: {call}"
    assert call.get("prompt_hash"), f"prompt_hash not populated: {call}"
    assert call.get("cost_usd") is not None and call["cost_usd"] > 0, f"cost_usd not populated: {call}"
    assert call.get("artifact_ref"), f"artifact_ref not populated: {call}"
