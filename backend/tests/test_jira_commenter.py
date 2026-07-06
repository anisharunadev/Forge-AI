"""Tests for ``JiraCommenter`` (Pillar 1 — Phase 1)."""

from __future__ import annotations

import uuid
from typing import Any

import pytest

from app.agents.tools.mcp_client import MCPClient, MCPResult
from app.db.models.connector import ConnectorType
from app.services.connector_ingestion.jira_commenter import JiraCommenter


@pytest.fixture
def captured_calls() -> list[tuple[str, str, dict[str, Any]]]:
    return []


def _make_capture_handler(captured):
    async def _handler(server: str, method: str, params: dict[str, Any]) -> MCPResult:
        if method != "__catalog__":
            captured.append((server, method, params))
        if method == "add_comment":
            return MCPResult(server=server, method=method, ok=True, output={"id": "1", "self": "x"})
        if method == "__catalog__":
            from app.agents.tools.mcp_client import DEFAULT_CATALOG

            return MCPResult(
                server=server, method=method, ok=True, output=DEFAULT_CATALOG.get(server, [])
            )
        return MCPResult(server=server, method=method, ok=True, output={})

    return _handler


async def _seed_jira_connector(sqlite_db, *, tenant_id: str, project_id: str) -> str:
    from app.services.connector_manager import connector_manager

    conn = await connector_manager.create_connector(
        tenant_id=tenant_id,
        project_id=project_id,
        name="primary-jira",
        type=ConnectorType.JIRA,
        config={"base_url": "https://x", "email": "a", "api_token": "t", "project_key": "FORA"},
        actor_id=uuid.uuid4(),
    )
    return str(conn.id)


async def test_comment_invokes_mcp_with_expected_body(sqlite_db, captured_calls):
    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    await _seed_jira_connector(sqlite_db, tenant_id=tenant_id, project_id=project_id)

    mcp = MCPClient(server_handlers={"jira": _make_capture_handler(captured_calls)})
    commenter = JiraCommenter(mcp=mcp)

    actor = str(uuid.uuid4())
    ok = await commenter.post(
        issue_key="FORA-42",
        stage="approval",
        outcome="granted",
        actor_id=actor,
        report_link="https://forge/report/42",
        tenant_id=tenant_id,
        project_id=project_id,
        forge_run_id="run-1",
    )
    assert ok is True

    # Find the add_comment call.
    add_calls = [c for c in captured_calls if c[1] == "add_comment"]
    assert len(add_calls) == 1
    server, method, params = add_calls[0]
    assert server == "jira"
    assert params["issueIdOrKey"] == "FORA-42"
    body = params["body"]
    assert "[approval] granted by" in body
    assert actor in body
    assert "https://forge/report/42" in body
    assert "run-1" in body


async def test_comment_without_connector_returns_false(sqlite_db, captured_calls):
    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    # No connector.
    mcp = MCPClient(server_handlers={"jira": _make_capture_handler(captured_calls)})
    commenter = JiraCommenter(mcp=mcp)
    ok = await commenter.post(
        issue_key="FORA-99",
        stage="approval",
        outcome="granted",
        actor_id=str(uuid.uuid4()),
        report_link=None,
        tenant_id=tenant_id,
        project_id=project_id,
    )
    assert ok is False
    assert captured_calls == []  # no MCP call landed
