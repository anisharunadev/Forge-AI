"""Phase 6 SC-6.7 — pre-call guardrail wrapper enforcement.

Verifies the ForgeLLMClient enforces guardrails before the upstream
call, so callers cannot bypass.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.integrations.litellm.llm_client import (
    ForgeLLMClient,
    LLMUnavailableError,
)


@pytest.mark.asyncio
async def test_blocked_short_circuits_before_upstream(two_tenants) -> None:
    """A guardrail block raises BEFORE the upstream LLM call."""
    ta, _tb, _pa = two_tenants
    client = ForgeLLMClient()

    base_client = MagicMock()
    base_client.chat = AsyncMock(
        return_value=({"choices": [{"message": {"content": "ok"}}]}, {})
    )

    with patch.object(client, "_resolve_base_client", return_value=base_client):
        with patch.object(
            client,
            "_resolve_virtual_key",
            AsyncMock(return_value="vk-test"),
        ):
            with patch.object(
                client,
                "_enforce_pre_call_guardrails",
                AsyncMock(
                    side_effect=LLMUnavailableError("guardrail X blocked: PII")
                ),
            ):
                with pytest.raises(LLMUnavailableError) as exc_info:
                    await client.chat(
                        messages=[{"role": "user", "content": "hi"}],
                        tenant_id=ta.id,
                        project_id=None,
                    )
    # Upstream was NEVER called.
    base_client.chat.assert_not_called()
    assert "PII" in str(exc_info.value)


@pytest.mark.asyncio
async def test_guardrail_called_with_tenant_id(two_tenants) -> None:
    """The guardrail receives the caller's tenant_id."""
    ta, _tb, _pa = two_tenants
    client = ForgeLLMClient()
    base_client = MagicMock()
    base_client.chat = AsyncMock(
        return_value=({"choices": [{"message": {"content": "ok"}}]}, {})
    )

    captured: dict = {}

    async def _capture(*args, **kwargs):
        captured["tenant_id"] = kwargs.get("tenant_id")
        return kwargs.get("messages")

    with patch.object(client, "_resolve_base_client", return_value=base_client):
        with patch.object(
            client,
            "_resolve_virtual_key",
            AsyncMock(return_value="vk-test"),
        ):
            with patch.object(
                client,
                "_enforce_pre_call_guardrails",
                side_effect=_capture,
            ):
                try:
                    await client.chat(
                        messages=[{"role": "user", "content": "hi"}],
                        tenant_id=ta.id,
                        project_id=None,
                    )
                except Exception:  # noqa: BLE001
                    pass
    assert captured.get("tenant_id") == ta.id
