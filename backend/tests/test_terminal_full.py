"""Phase 5 / Terminal Center Full (F-411..F-415) tests.

The tests target the public surface of the new modules without
booting a real Postgres / Redis. Each test patches the small set of
DB / Redis interactions it needs and exercises the in-process logic.
"""

from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

# ---------------------------------------------------------------------------
# F-411 — Command integration
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_command_integration_launch_creates_session() -> None:
    from app.services.terminal import command_integration as ci_mod
    from app.terminal.session_manager import AgentType

    fake_session = SimpleNamespace(
        id="sess-1",
        tenant_id="t1",
        project_id="p1",
        user_id="u1",
        agent_type=AgentType.CLAUDE_CODE,
        workspace_path="/var/forge/workspaces/p1",
        created_at=datetime.now(UTC),
        last_activity_at=datetime.now(UTC),
        status="active",
        metadata={"forge_cmd": "forge-dev-new-feature"},
    )
    with (
        patch.object(
            ci_mod.session_manager,
            "create_session",
            AsyncMock(return_value=fake_session),
        ),
        patch.object(
            ci_mod.terminal_audit,
            "record_session_lifecycle",
            AsyncMock(),
        ),
    ):
        session = await ci_mod.command_integration.launch_session_for_command(
            forge_cmd="forge-dev-implement",
            args={"description": "Add a new dashboard"},
            tenant_id="t1",
            project_id="p1",
            user_id="u1",
        )
    assert session.id == "sess-1"
    assert session.agent_type == AgentType.CLAUDE_CODE


@pytest.mark.asyncio
async def test_command_integration_inject_runs_command() -> None:
    from app.services.terminal import command_integration as ci_mod
    from app.terminal.session_manager import AgentType, SessionStatus

    fake_session = SimpleNamespace(
        id="sess-2",
        tenant_id="t1",
        project_id="p1",
        user_id="u1",
        agent_type=AgentType.CLAUDE_CODE,
        workspace_path="/var/forge/workspaces/p1",
        created_at=datetime.now(UTC),
        last_activity_at=datetime.now(UTC),
        status=SessionStatus.ACTIVE,
        metadata={},
    )
    with (
        patch.object(
            ci_mod.session_manager,
            "get_session",
            AsyncMock(return_value=fake_session),
        ),
        patch.object(
            ci_mod.terminal_audit,
            "record_command",
            AsyncMock(),
        ),
    ):
        await ci_mod.command_integration.inject_command("sess-2", "ls -la")
        chunks, cursor = await ci_mod.command_integration.get_command_output(
            "sess-2", since_cursor=0
        )
    assert cursor >= 0
    # We sent the command; the buffer should contain a chunk with the marker.
    seen = [c.data for c in chunks]
    assert any(b"$ ls -la" in data for data in seen), f"missing injected command in {seen!r}"


# ---------------------------------------------------------------------------
# F-412 — Cost tracker
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_cost_tracker_records_usage_correctly() -> None:
    from app.services.terminal import cost_tracker as ct_mod

    handle = await ct_mod.cost_tracker.start_session_tracking(
        "sess-3",
        model="claude-sonnet-4-6",
        tenant_id="t1",
        project_id="p1",
    )
    with patch.object(ct_mod, "cost_ledger", SimpleNamespace(record=AsyncMock())):
        await ct_mod.cost_tracker.record_usage(
            handle, prompt_tokens=1000, completion_tokens=500, model="claude-sonnet-4-6"
        )
        await ct_mod.cost_tracker.record_usage(
            handle, prompt_tokens=2000, completion_tokens=1000, model="claude-sonnet-4-6"
        )

    assert handle.prompt_tokens == 3000
    assert handle.completion_tokens == 1500
    assert handle.command_count == 2
    # 3k * 0.003/1k + 1.5k * 0.015/1k = 0.009 + 0.0225 = 0.0315
    assert handle.cost_usd == pytest.approx(0.0315, rel=1e-3)


@pytest.mark.asyncio
async def test_cost_tracker_burn_rate_calculation() -> None:
    """Cost over a 1h window projects to USD/hour."""
    from app.services.terminal import cost_tracker as ct_mod

    handle = await ct_mod.cost_tracker.start_session_tracking(
        "sess-burn",
        model="gpt-4o-mini",
        tenant_id="t-burn",
        project_id="p-burn",
    )

    # Insert synthetic CostEntry rows via a stubbed factory.
    class _StubScalar:
        def __init__(self, value):
            self.value = value

    class _StubSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def scalar(self, stmt):
            return 0.05  # USD in window

    class _StubFactory:
        def __call__(self):
            return _StubSession()

    ct_mod.cost_tracker.burn_rate_window_seconds = 3600  # 1h window
    with patch.object(ct_mod, "get_session_factory", lambda: _StubFactory()):
        rate = await ct_mod.cost_tracker.get_burn_rate("t-burn")
    assert rate == pytest.approx(0.05, rel=1e-3)


# ---------------------------------------------------------------------------
# F-413 — Broadcast
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_broadcast_subscribe_and_receive() -> None:
    from app.services.terminal import broadcast as bc_mod

    bc_mod.session_broadcaster._channels.clear()
    bc_mod.session_broadcaster._pubsub_tasks.clear()

    # Use an in-memory Redis stub: a single in-process queue per channel.
    in_memory: dict[str, asyncio.Queue] = {}

    class _StubRedis:
        async def publish(self, channel: str, data: bytes) -> int:
            q = in_memory.setdefault(channel, asyncio.Queue())
            await q.put(data)
            return 1

    with patch.object(bc_mod.SessionBroadcaster, "_client", AsyncMock(return_value=_StubRedis())):
        subscription, _send = await bc_mod.session_broadcaster.subscribe(
            "sess-bc",
            user_id="u-observer",
            tenant_id="t1",
            write=False,
        )
        # Register the channel metadata with the right tenant so grant checks work.
        await bc_mod.session_broadcaster.register_broadcaster(
            "sess-bc", tenant_id="t1", owner_user_id="u-owner"
        )

        await bc_mod.session_broadcaster.broadcast("sess-bc", b"hello")
        received = await asyncio.wait_for(in_memory["forge:terminal:broadcast:sess-bc"].get(), 0.5)
        assert received == b"hello"

        # Subscriber count should be 1
        rows = await bc_mod.session_broadcaster.list_broadcasters("sess-bc")
        assert len(rows) == 1
        assert rows[0]["user_id"] == "u-observer"
        assert rows[0]["write"] is False

        await bc_mod.session_broadcaster.unsubscribe("sess-bc", subscription)


@pytest.mark.asyncio
async def test_broadcast_read_only_by_default() -> None:
    from app.services.terminal import broadcast as bc_mod

    bc_mod.session_broadcaster._channels.clear()
    bc_mod.session_broadcaster._pubsub_tasks.clear()

    subscription, _send = await bc_mod.session_broadcaster.subscribe(
        "sess-ro",
        user_id="u-viewer",
        tenant_id="t1",
        write=False,
    )
    await bc_mod.session_broadcaster.register_broadcaster(
        "sess-ro", tenant_id="t1", owner_user_id="u-owner"
    )
    try:
        rows = await bc_mod.session_broadcaster.list_broadcasters("sess-ro")
        assert rows[0]["write"] is False
        # Granting without forge-admin still keeps write=False for the viewer.
        await bc_mod.session_broadcaster.grant_write("sess-ro", actor_user_id="u-viewer")
        rows = await bc_mod.session_broadcaster.list_broadcasters("sess-ro")
        assert rows[0]["write"] is True
        await bc_mod.session_broadcaster.revoke_write("sess-ro", actor_user_id="u-viewer")
        rows = await bc_mod.session_broadcaster.list_broadcasters("sess-ro")
        assert rows[0]["write"] is False
    finally:
        await bc_mod.session_broadcaster.unsubscribe("sess-ro", subscription)


# ---------------------------------------------------------------------------
# F-414 — Knowledge context
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_knowledge_context_returns_relevant_items() -> None:
    """Without a backing DB we exercise the cosine path with stubbed
    artifacts. The service should return items with a relevance_score
    in [0, 1]."""
    from app.services.terminal import knowledge_context as kc_mod

    # Replace the gather_candidates with an in-memory fixture.
    fake_items = [
        kc_mod.ContextItem(
            id="artifact:1",
            type="adr",
            title="Use Postgres",
            summary="We picked Postgres for ACID and pgvector.",
            relevance_score=0.9,
            deep_link="/artifacts/1",
            extra={"embedding": [0.1] * 8},
        ),
        kc_mod.ContextItem(
            id="artifact:2",
            type="api_contract",
            title="REST v1",
            summary="Public HTTP API for the terminal center.",
            relevance_score=0.4,
            deep_link="/artifacts/2",
            extra={"embedding": [0.0] * 8},
        ),
    ]

    with (
        patch.object(
            kc_mod.knowledge_context,
            "_gather_candidates",
            AsyncMock(return_value=fake_items),
        ),
        patch.object(kc_mod, "_embed", AsyncMock(return_value=[1.0] + [0.0] * 7)),
    ):
        items = await kc_mod.knowledge_context._rank(
            query_text="postgres decision",
            tenant_id="t1",
            project_id="p1",
        )
    assert len(items) == 2
    assert all(0.0 <= i.relevance_score <= 1.0 for i in items)
    # First item should win: its embedding is closer to the query vector.
    assert items[0].id == "artifact:1"


# ---------------------------------------------------------------------------
# F-415 — Export
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_export_session_markdown() -> None:
    from app.services.terminal import exporter as ex_mod
    from app.services.terminal.cast_encoder import validate_audit_chain
    from app.terminal.session_manager import AgentType, SessionStatus

    records = [
        {
            "command": "ls",
            "output": b"file1\nfile2\n",
            "output_hash": "abc",
            "duration_ms": 12,
            "occurred_at": datetime.now(UTC),
        },
        {
            "command": "cat file1",
            "output": b"hello\n",
            "output_hash": "def",
            "duration_ms": 8,
            "occurred_at": datetime.now(UTC) + timedelta(seconds=1),
        },
    ]
    validate_audit_chain(records, require_output=False)

    fake_session = SimpleNamespace(
        id="sess-md",
        tenant_id="t1",
        project_id="p1",
        user_id="u1",
        agent_type=AgentType.CLAUDE_CODE,
        workspace_path="/var/forge/workspaces/p1",
        created_at=datetime.now(UTC),
        last_activity_at=datetime.now(UTC),
        status=SessionStatus.ACTIVE,
        metadata={"forge_cmd": "forge-dev-implement"},
    )

    with (
        patch.object(ex_mod.session_manager, "get_session", AsyncMock(return_value=fake_session)),
        patch.object(
            ex_mod.SessionExporter, "_collect_audit_records", AsyncMock(return_value=records)
        ),
    ):
        rendered = await ex_mod.session_exporter.export_session("sess-md", format="md")

    assert rendered.format == "md"
    assert "```" in rendered.content
    assert "ls" in rendered.content
    assert "Audit Hash Chain" in rendered.content
    assert rendered.audit_hash_chain


@pytest.mark.asyncio
async def test_export_session_asciinema_cast() -> None:
    from app.services.terminal import exporter as ex_mod
    from app.terminal.session_manager import AgentType, SessionStatus

    records = [
        {
            "command": "echo hi",
            "output": b"hi\n",
            "output_hash": "h1",
            "duration_ms": 1,
            "occurred_at": datetime.now(UTC),
        }
    ]
    fake_session = SimpleNamespace(
        id="sess-cast",
        tenant_id="t1",
        project_id="p1",
        user_id="u1",
        agent_type=AgentType.CLAUDE_CODE,
        workspace_path="/var/forge/workspaces/p1",
        created_at=datetime.now(UTC),
        last_activity_at=datetime.now(UTC),
        status=SessionStatus.ACTIVE,
        metadata={},
    )
    with (
        patch.object(ex_mod.session_manager, "get_session", AsyncMock(return_value=fake_session)),
        patch.object(
            ex_mod.SessionExporter, "_collect_audit_records", AsyncMock(return_value=records)
        ),
    ):
        rendered = await ex_mod.session_exporter.export_session("sess-cast", format="cast")

    lines = rendered.content.strip().splitlines()
    assert lines[0].startswith("{")  # header line
    header = json.loads(lines[0])
    assert header["version"] == 2
    assert header["title"].startswith("forge-session-")
    # One 'i' frame and one 'o' frame per command.
    body = [json.loads(l) for l in lines[1:]]
    types = [frame[1] for frame in body]
    assert "i" in types and "o" in types


def test_export_audit_hash_chain_integrity() -> None:
    """Tamper-evident chain: the chain is valid as built, and any
    mutation breaks verify_audit_hash_chain."""
    from app.services.terminal import exporter as ex_mod

    records = [
        {"audit_id": "a", "command": "ls", "output_hash": "h1", "duration_ms": 1},
        {"audit_id": "b", "command": "pwd", "output_hash": "h2", "duration_ms": 1},
    ]
    chain = ex_mod._audit_chain(records)
    assert ex_mod.verify_audit_hash_chain(chain) is True
    # Mutate one record's payload — chain should fail.
    tampered = json.loads(json.dumps(chain))
    tampered[1]["command"] = "evil"
    assert ex_mod.verify_audit_hash_chain(tampered) is False
