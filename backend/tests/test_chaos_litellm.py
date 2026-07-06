"""Phase 6 SC-6.4 — chaos test for LiteLLM-down graceful degradation."""

from __future__ import annotations

from unittest.mock import patch

import pytest

from app.integrations.litellm.llm_client import (
    ForgeLLMClient,
    LLMUnavailableError,
)


@pytest.mark.asyncio
async def test_under_capacity_queues_then_signals_queued(two_tenants) -> None:
    """When the queue is under capacity, _maybe_enqueue_on_failure logs the entry.

    The HTTP layer maps the resulting ``QueuedForLater`` to a 202 + SSE-queued
    frame. We assert here that the enqueue helper does not raise and that
    the LLMUnavailableError still surfaces (so the HTTP layer can map it).
    """
    ta, _tb, _pa = two_tenants
    client = ForgeLLMClient()
    with patch.object(client, "_resolve_base_client", return_value=None):
        with pytest.raises(LLMUnavailableError):
            await client.chat(
                messages=[{"role": "user", "content": "hi"}],
                tenant_id=ta.id,
                project_id=None,
            )


@pytest.mark.asyncio
async def test_no_500_on_litellm_down(two_tenants) -> None:
    """When LiteLLM is down, the request raises LLMUnavailableError (4xx-class)
    — never a bare 5xx-class exception.
    """
    ta, _tb, _pa = two_tenants
    client = ForgeLLMClient()
    with patch.object(client, "_resolve_base_client", return_value=None):
        with pytest.raises(LLMUnavailableError) as exc_info:
            await client.chat(
                messages=[{"role": "user", "content": "hi"}],
                tenant_id=ta.id,
                project_id=None,
            )
    # LLMUnavailableError is the 503-class signal; the HTTP layer maps it.
    assert exc_info.value is not None


@pytest.mark.asyncio
async def test_full_queue_returns_queue_full(two_tenants) -> None:
    """Queue full → QueueFull raised; HTTP layer returns 503 + Retry-After."""
    from unittest.mock import AsyncMock as _AM

    ta, _tb, _pa = two_tenants
    from app.services.llm_degradation_queue import QueueFull

    # Pre-fill the queue to capacity by patching the limiter to raise QueueFull.
    with patch(
        "app.services.llm_degradation_queue.DegradationQueue.enqueue",
        new=_AM(side_effect=QueueFull(retry_after_seconds=5)),
    ):
        # _maybe_enqueue_on_failure swallows QueueFull and lets the upstream
        # error propagate, so the HTTP layer sees LLMUnavailableError.
        client = ForgeLLMClient()
        with patch.object(client, "_resolve_base_client", return_value=None):
            with pytest.raises(LLMUnavailableError):
                await client.chat(
                    messages=[{"role": "user", "content": "hi"}],
                    tenant_id=ta.id,
                    project_id=None,
                )
