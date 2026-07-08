"""F-800 Plan 5 — Security regression suite.

Covers the cross-user + cross-tenant + budget + audit guarantees that
Plan 5 hardens. Every test creates two users in the same tenant
(``user_a`` and ``user_b``) so we can assert that the *user* boundary
is closed by the service layer in addition to the *tenant* boundary
closed by the DB-level RLS policy.

Why a separate file (not in ``test_copilot_service.py``):
- The Plan 1 service tests cover happy-path orchestration. This file
  is adversarial: the assertions are about *what does NOT happen*
  when an unauthorized principal attempts an operation.
- Security regressions deserve their own run history so a failure
  stands out from general flakiness.

Tests:
  1. ``test_cross_user_conversation_read_returns_404``
  2. ``test_cross_user_conversation_delete_returns_404``
  3. ``test_cross_user_feedback_returns_404``
  4. ``test_cross_tenant_conversation_listing_returns_only_own``
  5. ``test_tool_invocation_writes_audit_row``
  6. ``test_conversation_budget_blocks_after_ceiling``
  7. ``test_service_layer_applies_user_filter``
  8. ``test_rate_limiter_caps_at_configured_threshold``
  9. ``test_rate_limiter_distinguishes_per_user_and_per_tenant``
 10. ``test_rate_limiter_recovers_after_window``
 11. ``test_api_returns_429_with_retry_after_when_rate_limited``
 12. ``test_api_audits_rate_limit_block``
"""

from __future__ import annotations

import uuid
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core.security import AuthenticatedPrincipal
from app.db.models.copilot import CopilotConversation, CopilotMessage
from app.services.copilot_rate_limit import (
    CoPilotRateLimiter,
    RateLimitExceeded,
)
from app.services.copilot_service import CopilotService
from app.services.workflow_budget import BudgetExceeded

# ---------------------------------------------------------------------------
# Test fixtures + helpers
# ---------------------------------------------------------------------------


def _principal(
    *,
    permissions: list[str] | None = None,
    tenant_id: Any = None,
    user_id: Any = None,
    project_id: Any = None,
) -> AuthenticatedPrincipal:
    return AuthenticatedPrincipal(
        user_id=str(user_id or uuid.uuid4()),
        email="t@example.com",
        tenant_id=str(tenant_id or uuid.uuid4()),
        project_id=str(project_id or uuid.uuid4()) if project_id is not None else None,
        roles=[],
        raw_claims={"forge.permissions": list(permissions or [])},
    )


def _seed_conv(
    db: Any,
    *,
    tenant_id: Any,
    user_id: Any,
    project_id: Any | None = None,
    title: str | None = None,
) -> CopilotConversation:
    """Create + flush + commit a conversation in the caller's session."""
    conv = CopilotConversation(
        tenant_id=tenant_id,
        project_id=project_id,
        user_id=user_id,
        title=title,
    )
    db.add(conv)
    return conv


# ---------------------------------------------------------------------------
# 1. Cross-user conversation READ returns 404
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_cross_user_conversation_read_returns_404(sqlite_db):
    """User B receives 404 (not 403) when reading User A's conversation.

    404 — not 403 — to avoid leaking the existence of another user's
    conversation. The principal cannot distinguish "wrong user" from
    "does not exist".
    """
    tenant_id = uuid.uuid4()
    user_a = uuid.uuid4()
    user_b = uuid.uuid4()

    async with sqlite_db() as db:
        conv = _seed_conv(db, tenant_id=tenant_id, user_id=user_a, title="A private thread")
        await db.flush()
        await db.commit()
        conv_id = conv.id

    async with sqlite_db() as db:
        principal_b = _principal(permissions=["copilot:use"], tenant_id=tenant_id, user_id=user_b)
        service = CopilotService(db=db, principal=principal_b)
        with pytest.raises(LookupError):
            await service.get_conversation(conv_id)


# ---------------------------------------------------------------------------
# 2. Cross-user conversation DELETE returns 404
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_cross_user_conversation_delete_returns_404(sqlite_db):
    """User B cannot delete User A's conversation."""
    tenant_id = uuid.uuid4()
    user_a = uuid.uuid4()
    user_b = uuid.uuid4()

    async with sqlite_db() as db:
        conv = _seed_conv(db, tenant_id=tenant_id, user_id=user_a, title="A's thread")
        await db.flush()
        await db.commit()
        conv_id = conv.id

    async with sqlite_db() as db:
        principal_b = _principal(permissions=["copilot:use"], tenant_id=tenant_id, user_id=user_b)
        service = CopilotService(db=db, principal=principal_b)
        with pytest.raises(LookupError):
            await service.delete_conversation(conv_id)

    # Sanity check: A's conversation is still alive.
    async with sqlite_db() as db:
        from sqlalchemy import select

        row = (
            await db.execute(select(CopilotConversation).where(CopilotConversation.id == conv_id))
        ).scalar_one()
        assert row.archived_at is None


# ---------------------------------------------------------------------------
# 3. Cross-user FEEDBACK returns 404
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_cross_user_feedback_returns_404(sqlite_db):
    """User B cannot submit feedback on User A's message.

    The feedback endpoint takes a ``message_id``; the join through
    ``CopilotConversation`` enforces the user filter. B must get 404,
    not silently succeed.
    """
    from app.schemas.copilot import CopilotFeedbackRequest

    tenant_id = uuid.uuid4()
    user_a = uuid.uuid4()
    user_b = uuid.uuid4()

    async with sqlite_db() as db:
        conv = _seed_conv(db, tenant_id=tenant_id, user_id=user_a)
        await db.flush()
        msg = CopilotMessage(
            conversation_id=conv.id,
            tenant_id=tenant_id,
            role="assistant",
            content="hello",
        )
        db.add(msg)
        await db.flush()
        await db.commit()
        msg_id = msg.id

    async with sqlite_db() as db:
        principal_b = _principal(permissions=["copilot:use"], tenant_id=tenant_id, user_id=user_b)
        service = CopilotService(db=db, principal=principal_b)
        with pytest.raises(LookupError):
            await service.submit_feedback(msg_id, CopilotFeedbackRequest(rating="up", comment="hi"))

    # Verify the message's feedback fields are still unset.
    async with sqlite_db() as db:
        from sqlalchemy import select

        row = (
            await db.execute(select(CopilotMessage).where(CopilotMessage.id == msg_id))
        ).scalar_one()
        assert row.feedback_rating is None
        assert row.feedback_comment is None


# ---------------------------------------------------------------------------
# 4. Cross-tenant conversation LISTING returns only own
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_cross_tenant_conversation_listing_returns_only_own(sqlite_db):
    """Tenant B cannot see Tenant A's conversations in the same user namespace."""
    tenant_a = uuid.uuid4()
    tenant_b = uuid.uuid4()
    user_id = uuid.uuid4()

    async with sqlite_db() as db:
        db.add_all(
            [
                CopilotConversation(tenant_id=tenant_a, project_id=None, user_id=user_id),
                CopilotConversation(tenant_id=tenant_b, project_id=None, user_id=user_id),
            ]
        )
        await db.flush()
        await db.commit()

    async with sqlite_db() as db:
        principal_a = _principal(permissions=["copilot:use"], tenant_id=tenant_a, user_id=user_id)
        service = CopilotService(db=db, principal=principal_a)
        rows = await service.list_conversations()
        assert len(rows) == 1
        assert str(rows[0].tenant_id) == str(tenant_a)

    async with sqlite_db() as db:
        principal_b = _principal(permissions=["copilot:use"], tenant_id=tenant_b, user_id=user_id)
        service = CopilotService(db=db, principal=principal_b)
        rows = await service.list_conversations()
        assert len(rows) == 1
        assert str(rows[0].tenant_id) == str(tenant_b)


# ---------------------------------------------------------------------------
# 5. Tool invocation writes audit row
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_tool_invocation_writes_audit_row(sqlite_db):
    """Every successful tool execution writes a ``copilot.tool.executed``
    audit row. Asserts the audit service is called with the right action
    and that the payload carries the tool_call_id + conversation_id.

    We exercise ``CopilotService._execute_tool`` directly (rather than
    the full ``chat()`` pipeline) because the agent_loop mock returns
    pre-built ``(response, calls, results)`` tuples and would skip the
    real executor. The executor is the single point of audit for tool
    invocations.
    """
    from app.services._litellm_tools import ToolCall

    tenant_id = uuid.uuid4()
    user_id = uuid.uuid4()
    principal = _principal(permissions=["copilot:use"], tenant_id=tenant_id, user_id=user_id)

    async with sqlite_db() as db:
        conv = _seed_conv(db, tenant_id=tenant_id, user_id=user_id)
        await db.flush()
        await db.commit()
        conv_id = conv.id

    fake_audit = MagicMock()
    fake_audit.record = AsyncMock()
    fake_bus = MagicMock()
    fake_bus.publish = AsyncMock()

    call = ToolCall(
        id="call_audit_1",
        name="search_knowledge",
        arguments_json='{"query": "auth"}',
    )

    async with sqlite_db() as db:
        service = CopilotService(db=db, principal=principal)
        with (
            patch("app.services.copilot_service.audit_service", fake_audit),
            patch("app.services.copilot_service.default_bus", fake_bus),
            patch(
                "app.services.copilot_service.tool_registry.dispatch",
                AsyncMock(return_value={"nodes": []}),
            ),
        ):
            result = await service._execute_tool(call, conv)

    assert result.is_error is False
    actions = [c.kwargs["action"] for c in fake_audit.record.call_args_list]
    assert "copilot.tool.executed" in actions

    # The tool_call_id must appear in the audit payload for that action.
    tool_executed_calls = [
        c
        for c in fake_audit.record.call_args_list
        if c.kwargs.get("action") == "copilot.tool.executed"
    ]
    assert tool_executed_calls, "expected at least one copilot.tool.executed audit row"
    payload = tool_executed_calls[0].kwargs["payload"]
    assert payload["tool_call_id"] == "call_audit_1"
    assert payload["conversation_id"] == str(conv_id)
    assert payload["args"] == {"query": "auth"}


# ---------------------------------------------------------------------------
# 6. Conversation budget blocks after ceiling
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_conversation_budget_blocks_after_ceiling(sqlite_db):
    """When ``workflow_budget_service.check_budget`` raises ``BudgetExceeded``,
    ``CopilotService.chat`` raises ``CopilotBudgetBlocked`` and the API
    layer maps it to 429 with Retry-After.

    We mock the LLM loop to raise ``BudgetExceeded`` (the synthetic
    budget row is created on conversation creation, so by the time the
    LLM call happens the budget gate is the only thing left to trip).
    """
    from app.services.copilot_service import CopilotBudgetBlocked

    tenant_id = uuid.uuid4()
    user_id = uuid.uuid4()
    principal = _principal(permissions=["copilot:use"], tenant_id=tenant_id, user_id=user_id)

    fake_audit = MagicMock()
    fake_audit.record = AsyncMock()
    fake_bus = MagicMock()
    fake_bus.publish = AsyncMock()

    workflow_id = uuid.uuid4()

    async def _no_op_aenter(self) -> Any:
        return self

    async def _no_op_aexit(self, *args: Any) -> None:
        return None

    with (
        patch("app.services.litellm_client.LiteLLMClient.__aenter__", _no_op_aenter),
        patch("app.services.litellm_client.LiteLLMClient.__aexit__", _no_op_aexit),
        patch(
            "app.services.litellm_client.LiteLLMClient.agent_loop",
            AsyncMock(side_effect=BudgetExceeded(workflow_id=workflow_id, spent=1.0, ceiling=1.0)),
        ),
        patch("app.services.copilot_service.audit_service", fake_audit),
        patch("app.services.copilot_service.default_bus", fake_bus),
    ):
        from app.schemas.copilot import CopilotChatRequest, CopilotPageContext

        async with sqlite_db() as db:
            service = CopilotService(db=db, principal=principal)
            # Phase 4 — null project_id now raises 422 (R2). Give the
            # budget-ceiling test a project_id so it exercises the
            # budget gate, not the project validation gate.
            test_project_id = uuid.uuid4()
            req = CopilotChatRequest(
                conversation_id=None,
                project_id=test_project_id,
                message="x",
                context=CopilotPageContext(
                    current_page="/x",
                    current_center=None,
                    recent_actions=[],
                ),
            )
            with pytest.raises(CopilotBudgetBlocked) as excinfo:
                await service.chat(req)
            assert excinfo.value.spent == 1.0
            assert excinfo.value.ceiling == 1.0

    # The audit must include the budget-blocked event so security/SRE
    # can see the conversation that exhausted its ceiling.
    actions = [c.kwargs["action"] for c in fake_audit.record.call_args_list]
    assert "copilot.budget.blocked" in actions


# ---------------------------------------------------------------------------
# 7. Service layer applies user_id filter (no app.user_id GUC by design)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_service_layer_applies_user_filter(sqlite_db):
    """The service-layer ``WHERE user_id = principal.user_id`` is the
    privacy boundary. Verify a *naive* query (no filter) returns both
    users' rows but the service's ``list_conversations`` returns only
    the caller's.
    """
    from sqlalchemy import select

    tenant_id = uuid.uuid4()
    user_a = uuid.uuid4()
    user_b = uuid.uuid4()

    async with sqlite_db() as db:
        db.add_all(
            [
                CopilotConversation(tenant_id=tenant_id, project_id=None, user_id=user_a),
                CopilotConversation(tenant_id=tenant_id, project_id=None, user_id=user_b),
            ]
        )
        await db.flush()
        await db.commit()

        # Naive query (no user filter) — this is the leak the service
        # layer must close. SQLite in test mode does not run RLS
        # policies, so the leak is real here.
        naive = (await db.execute(select(CopilotConversation))).scalars().all()
        assert len(naive) == 2

    # The service's filter closes the leak: A sees only A's row.
    async with sqlite_db() as db:
        principal_a = _principal(permissions=["copilot:use"], tenant_id=tenant_id, user_id=user_a)
        service = CopilotService(db=db, principal=principal_a)
        rows = await service.list_conversations()
        assert len(rows) == 1
        assert str(rows[0].user_id) == str(user_a)


# ---------------------------------------------------------------------------
# 8. Rate limiter caps at the configured threshold
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_rate_limiter_caps_at_configured_threshold():
    """``check_and_record`` allows ``max_per_minute`` calls then raises."""
    limiter = CoPilotRateLimiter(max_per_minute=3)
    user_id = uuid.uuid4()
    tenant_id = uuid.uuid4()
    try:
        for _ in range(3):
            await limiter.check_and_record(user_id, tenant_id)
        with pytest.raises(RateLimitExceeded) as excinfo:
            await limiter.check_and_record(user_id, tenant_id)
        assert excinfo.value.retry_after_seconds > 0
    finally:
        limiter.reset()


# ---------------------------------------------------------------------------
# 9. Rate limiter distinguishes per-user and per-tenant
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_rate_limiter_distinguishes_per_user_and_per_tenant():
    """User A's quota does not consume User B's; User A in tenant T1 does
    not consume User A's quota in tenant T2.
    """
    limiter = CoPilotRateLimiter(max_per_minute=2)
    user_a = uuid.uuid4()
    user_b = uuid.uuid4()
    tenant_1 = uuid.uuid4()
    tenant_2 = uuid.uuid4()
    try:
        # User A in tenant 1 fills their bucket.
        await limiter.check_and_record(user_a, tenant_1)
        await limiter.check_and_record(user_a, tenant_1)
        with pytest.raises(RateLimitExceeded):
            await limiter.check_and_record(user_a, tenant_1)

        # User B in tenant 1 has their own bucket.
        await limiter.check_and_record(user_b, tenant_1)
        await limiter.check_and_record(user_b, tenant_1)
        with pytest.raises(RateLimitExceeded):
            await limiter.check_and_record(user_b, tenant_1)

        # User A in tenant 2 has their own bucket.
        await limiter.check_and_record(user_a, tenant_2)
        await limiter.check_and_record(user_a, tenant_2)
        with pytest.raises(RateLimitExceeded):
            await limiter.check_and_record(user_a, tenant_2)
    finally:
        limiter.reset()


# ---------------------------------------------------------------------------
# 10. Rate limiter recovers after the window slides
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_rate_limiter_recovers_after_window(monkeypatch):
    """After the rolling window slides past all entries, the user is
    unblocked.

    We freeze ``time.monotonic`` to a known value, record two events,
    advance time past the 60s window, and verify the limiter accepts
    a new event.
    """
    import time as _time

    limiter = CoPilotRateLimiter(max_per_minute=2)
    user_id = uuid.uuid4()
    tenant_id = uuid.uuid4()
    now = [1_000_000.0]

    monkeypatch.setattr(_time, "monotonic", lambda: now[0])
    try:
        await limiter.check_and_record(user_id, tenant_id)
        await limiter.check_and_record(user_id, tenant_id)
        with pytest.raises(RateLimitExceeded):
            await limiter.check_and_record(user_id, tenant_id)

        # Slide past the 60s window.
        now[0] += 61.0
        # After the slide, the bucket has space again.
        await limiter.check_and_record(user_id, tenant_id)
        await limiter.check_and_record(user_id, tenant_id)
        with pytest.raises(RateLimitExceeded):
            await limiter.check_and_record(user_id, tenant_id)
    finally:
        limiter.reset()


# ---------------------------------------------------------------------------
# 11. API returns 429 with Retry-After when rate-limited
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_api_returns_429_with_retry_after_when_rate_limited(sqlite_db, monkeypatch):
    """``POST /copilot/conversations`` returns 429 + Retry-After when the
    rate limit is exceeded, and the body matches the spec.
    """
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from app.api.deps import db_session
    from app.api.v1 import copilot as copilot_module
    from app.core import config
    from app.core.security import get_current_principal

    # Enable the Co-pilot master toggle so the rate limit is what trips.
    monkeypatch.setattr(config.settings, "copilot_enabled", True)

    # Force a fresh, tight limiter for this test.
    fresh_limiter = CoPilotRateLimiter(max_per_minute=1)
    monkeypatch.setattr(copilot_module, "copilot_rate_limiter", fresh_limiter)
    fresh_limiter.reset()

    app = FastAPI()
    app.include_router(copilot_module.router, prefix="/api/v1")
    principal = _principal(permissions=["copilot:use"])

    async def _override_principal() -> Any:
        return principal

    async def _override_session() -> Any:
        async with sqlite_db() as session:
            yield session

    app.dependency_overrides[get_current_principal] = _override_principal  # type: ignore[attr-defined]
    app.dependency_overrides[db_session] = _override_session
    client = TestClient(app)

    # Stub the LLM loop and audit so the first call returns 200.
    async def _no_op_aenter(self) -> Any:
        return self

    async def _no_op_aexit(self, *args: Any) -> None:
        return None

    response_shape: dict[str, Any] = {
        "id": "chatcmpl-rl",
        "model": "gpt-4o-mini",
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": "ok"},
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 1, "completion_tokens": 1, "cost_usd": 0.0},
    }

    body = {
        "message": "hi",
        "context": {
            "current_page": "/x",
            "current_center": None,
            "recent_actions": [],
        },
    }

    with (
        patch("app.services.litellm_client.LiteLLMClient.__aenter__", _no_op_aenter),
        patch("app.services.litellm_client.LiteLLMClient.__aexit__", _no_op_aexit),
        patch(
            "app.services.litellm_client.LiteLLMClient.agent_loop",
            AsyncMock(return_value=(response_shape, [], [])),
        ),
        patch("app.services.copilot_service.audit_service", MagicMock(record=AsyncMock())),
        patch(
            "app.services.copilot_service.default_bus",
            MagicMock(publish=AsyncMock()),
        ),
    ):
        # First call consumes the rate-limit bucket.
        first = client.post("/api/v1/copilot/conversations", json=body)
        # Second call is rate-limited.
        second = client.post("/api/v1/copilot/conversations", json=body)

    # The first call must not be 429 (it may be 200 or fail deeper in
    # the mocked pipeline; the rate limit is the only thing the spec
    # requires here).
    assert first.status_code != 429
    assert second.status_code == 429
    assert "Retry-After" in second.headers
    body_json = second.json()
    assert body_json["detail"]["error"] == "copilot.rate_limit_exceeded"
    assert body_json["detail"]["retry_after_seconds"] > 0


# ---------------------------------------------------------------------------
# 12. API audits the rate-limit block
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_api_audits_rate_limit_block(sqlite_db, monkeypatch):
    """When the rate limiter blocks, the API writes an audit row carrying
    ``copilot.rate_limit_blocked`` so security/SRE can detect abuse
    patterns.
    """
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from app.api.deps import db_session
    from app.api.v1 import copilot as copilot_module
    from app.core import config
    from app.core.security import get_current_principal

    monkeypatch.setattr(config.settings, "copilot_enabled", True)

    fresh_limiter = CoPilotRateLimiter(max_per_minute=1)
    monkeypatch.setattr(copilot_module, "copilot_rate_limiter", fresh_limiter)
    fresh_limiter.reset()

    app = FastAPI()
    app.include_router(copilot_module.router, prefix="/api/v1")
    principal = _principal(permissions=["copilot:use"])

    async def _override_principal() -> Any:
        return principal

    async def _override_session() -> Any:
        async with sqlite_db() as session:
            yield session

    app.dependency_overrides[get_current_principal] = _override_principal  # type: ignore[attr-defined]
    app.dependency_overrides[db_session] = _override_session
    client = TestClient(app)

    fake_audit = MagicMock()
    fake_audit.record = AsyncMock()

    async def _no_op_aenter(self) -> Any:
        return self

    async def _no_op_aexit(self, *args: Any) -> None:
        return None

    response_shape: dict[str, Any] = {
        "id": "chatcmpl-rl",
        "model": "gpt-4o-mini",
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": "ok"},
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 1, "completion_tokens": 1, "cost_usd": 0.0},
    }

    body = {
        "message": "hi",
        "context": {
            "current_page": "/x",
            "current_center": None,
            "recent_actions": [],
        },
    }

    with (
        patch("app.services.litellm_client.LiteLLMClient.__aenter__", _no_op_aenter),
        patch("app.services.litellm_client.LiteLLMClient.__aexit__", _no_op_aexit),
        patch(
            "app.services.litellm_client.LiteLLMClient.agent_loop",
            AsyncMock(return_value=(response_shape, [], [])),
        ),
        patch("app.api.v1.copilot.audit_service", fake_audit),
    ):
        # First call consumes the bucket.
        client.post("/api/v1/copilot/conversations", json=body)
        # Second call trips the limiter.
        client.post("/api/v1/copilot/conversations", json=body)

    actions = [c.kwargs["action"] for c in fake_audit.record.call_args_list]
    assert "copilot.rate_limit_blocked" in actions
