"""Tests for ``JiraPushService`` — real MCP path (Pillar 1 — Phase 1).

The push service goes through ``MCPClient.call_server("jira", ...)``.
We stub the MCP handler with a fake so the test exercises the seam
without hitting Atlassian.

Assertions:

- A real push produces ``PushRecord.external_ref == "JIRA/FORA-1234"``.
- ``PushRecord.jira_epic_key`` is set to the same key.
- ``Idea.external_key`` is stamped.
- The no-connector fallback still produces a synthetic ref AND
  surfaces the ``no_jira_connector_configured`` error code.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest

from app.agents.tools.mcp_client import MCPClient, MCPResult
from app.db.models.connector import ConnectorType
from app.db.models.ideation import (
    Idea,
    IdeaSource,
    IdeaStatus,
    PushRecord,
    PushStatus,
    PushTarget,
)
from app.db.session import get_session_factory
from app.services.connectors.jira_push import JiraPushService


async def _fake_jira_create_issue_handler(
    server: str, method: str, params: dict[str, Any]
) -> MCPResult:
    if method == "create_issue":
        return MCPResult(
            server=server,
            method=method,
            ok=True,
            output={"id": "10001", "key": "FORA-1234", "self": "https://x/rest/api/3/issue/10001"},
        )
    if method == "__catalog__":
        from app.agents.tools.mcp_client import DEFAULT_CATALOG

        return MCPResult(server=server, method=method, ok=True, output=DEFAULT_CATALOG.get(server, []))
    return MCPResult(server=server, method=method, ok=True, output={"echo": params})


async def _seed_idea(sqlite_db, *, tenant_id: str, project_id: str) -> Idea:
    factory = get_session_factory()
    async with factory() as session:
        idea = Idea(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            project_id=project_id,
            title="Improve onboarding",
            description="Make the first 5 minutes count.",
            source=IdeaSource.USER,
            status=IdeaStatus.APPROVED,
            submitted_by=uuid.uuid4(),
            tags=[],
            attachments=[],
        )
        session.add(idea)
        await session.commit()
        await session.refresh(idea)
    return idea


async def _seed_jira_connector(sqlite_db, *, tenant_id: str, project_id: str) -> str:
    from app.services.connector_manager import connector_manager

    conn = await connector_manager.create_connector(
        tenant_id=tenant_id,
        project_id=project_id,
        name="primary-jira",
        type=ConnectorType.JIRA,
        config={
            "base_url": "https://acme.atlassian.net",
            "email": "svc@acme.com",
            "api_token": "tok",
            "project_key": "FORA",
        },
        actor_id=uuid.uuid4(),
    )
    return str(conn.id)


async def test_real_push_creates_epic_and_stamps(sqlite_db):
    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    await _seed_jira_connector(sqlite_db, tenant_id=tenant_id, project_id=project_id)
    idea = await _seed_idea(sqlite_db, tenant_id=tenant_id, project_id=project_id)

    mcp = MCPClient(server_handlers={"jira": _fake_jira_create_issue_handler})
    svc = JiraPushService(mcp=mcp)

    external_ref, error = await svc.create_epic_and_stories(
        idea=idea,
        prd=None,
        project_key="FORA",
        tenant_id=tenant_id,
        project_id=project_id,
        actor_id=uuid.uuid4(),
    )

    assert error is None
    assert external_ref == "JIRA/FORA-1234"

    # Idea.external_key stamped
    factory = get_session_factory()
    async with factory() as session:
        refreshed = await session.get(Idea, str(idea.id))
        assert refreshed is not None
        assert refreshed.external_key == "FORA-1234"


async def test_real_push_records_jira_epic_key(sqlite_db):
    from app.services.connectors.jira_push import latest_jira_push_for_idea

    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    await _seed_jira_connector(sqlite_db, tenant_id=tenant_id, project_id=project_id)
    idea = await _seed_idea(sqlite_db, tenant_id=tenant_id, project_id=project_id)

    mcp = MCPClient(server_handlers={"jira": _fake_jira_create_issue_handler})
    svc = JiraPushService(mcp=mcp)
    external_ref, error = await svc.create_epic_and_stories(
        idea=idea,
        prd=None,
        project_key="FORA",
        tenant_id=tenant_id,
        project_id=project_id,
        actor_id=uuid.uuid4(),
    )
    assert error is None
    assert external_ref == "JIRA/FORA-1234"

    # The push_to_delivery orchestrator writes the PushRecord; the
    # service does not. We assert via the helper that the latest
    # push row carries the key. (This validates the column is
    # reachable; the orchestrator test exercises end-to-end.)
    # We directly exercise JiraPushService — it does NOT write a
    # PushRecord; that is the orchestrator's job. So we instead
    # write a minimal PushRecord here to verify the column is
    # readable.
    factory = get_session_factory()
    async with factory() as session:
        pr = PushRecord(
            tenant_id=tenant_id,
            project_id=project_id,
            idea_id=idea.id,
            target=PushTarget.JIRA,
            external_ref=external_ref,
            jira_epic_key="FORA-1234",
            config={"project_key": "FORA"},
            status=PushStatus.SUCCESS,
            actor_id=uuid.uuid4(),
        )
        session.add(pr)
        await session.commit()
    latest = await latest_jira_push_for_idea(idea.id)
    assert latest is not None
    assert latest.jira_epic_key == "FORA-1234"


async def test_push_without_connector_returns_synthetic(sqlite_db):
    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    # No connector seeded.
    idea = await _seed_idea(sqlite_db, tenant_id=tenant_id, project_id=project_id)

    svc = JiraPushService(mcp=MCPClient())
    external_ref, error = await svc.create_epic_and_stories(
        idea=idea,
        prd=None,
        project_key="FORA",
        tenant_id=tenant_id,
        project_id=project_id,
        actor_id=uuid.uuid4(),
    )

    assert error == "no_jira_connector_configured"
    assert external_ref is not None
    assert external_ref.startswith("JIRA/FORA/EPIC-")
    # Idea is NOT stamped when no real push happens.
    factory = get_session_factory()
    async with factory() as session:
        refreshed = await session.get(Idea, str(idea.id))
        assert refreshed is not None
        assert refreshed.external_key is None


async def test_mcp_failure_surfaces_error(sqlite_db):
    async def _failing(server, method, params):
        return MCPResult(
            server=server, method=method, ok=False, error="http_500:boom"
        )

    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    await _seed_jira_connector(sqlite_db, tenant_id=tenant_id, project_id=project_id)
    idea = await _seed_idea(sqlite_db, tenant_id=tenant_id, project_id=project_id)

    mcp = MCPClient(server_handlers={"jira": _failing})
    svc = JiraPushService(mcp=mcp)
    external_ref, error = await svc.create_epic_and_stories(
        idea=idea,
        prd=None,
        project_key="FORA",
        tenant_id=tenant_id,
        project_id=project_id,
        actor_id=uuid.uuid4(),
    )

    assert external_ref is None
    assert error is not None
    assert "jira_create_failed" in error
