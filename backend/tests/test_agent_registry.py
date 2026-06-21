"""TestAgentRegistry — create, list_for_task, capability_match."""

from __future__ import annotations

import uuid

import pytest

from app.db.models.agent import AgentStatus, AgentType
from app.services.agent_registry import AgentRegistry


@pytest.fixture
async def reg(sqlite_db):
    return AgentRegistry()


async def test_create_and_list(reg, sqlite_db):
    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    a = await reg.create_agent(
        tenant_id=tenant_id,
        project_id=project_id,
        name="claude-python",
        type=AgentType.CLAUDE_CODE,
        capabilities={"languages": ["python"], "tools": ["shell"]},
    )
    b = await reg.create_agent(
        tenant_id=tenant_id,
        project_id=None,
        name="claude-typescript",
        type=AgentType.CLAUDE_CODE,
        capabilities={"languages": ["typescript"], "tools": ["browser"]},
    )

    assert a.id != b.id

    agents = await reg.list_agents(tenant_id, project_id=project_id)
    assert {a.name for a in agents} == {"claude-python", "claude-typescript"}


async def test_capability_match(reg, sqlite_db):
    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    await reg.create_agent(
        tenant_id=tenant_id,
        project_id=project_id,
        name="py-expert",
        type=AgentType.CLAUDE_CODE,
        capabilities={"languages": ["python"]},
    )
    await reg.create_agent(
        tenant_id=tenant_id,
        project_id=project_id,
        name="polyglot",
        type=AgentType.CODEX,
        capabilities={"languages": ["python", "go", "rust"]},
    )
    await reg.create_agent(
        tenant_id=tenant_id,
        project_id=project_id,
        name="ts-only",
        type=AgentType.GEMINI,
        capabilities={"languages": ["typescript"]},
    )

    matches = await reg.list_agents_for_task(
        tenant_id=tenant_id,
        project_id=project_id,
        required_capabilities={"languages": ["python"]},
    )
    names = {m.name for m in matches}
    assert "py-expert" in names
    assert "polyglot" in names
    assert "ts-only" not in names


async def test_update_and_soft_delete(reg, sqlite_db):
    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    a = await reg.create_agent(
        tenant_id=tenant_id,
        project_id=project_id,
        name="draft",
        type=AgentType.CUSTOM,
        capabilities={},
    )
    updated = await reg.update_agent(a.id, name="renamed", status=AgentStatus.DISABLED)
    assert updated.name == "renamed"
    assert updated.status == AgentStatus.DISABLED

    await reg.delete_agent(a.id)
    fetched = await reg.get_agent(a.id)
    assert fetched.status == AgentStatus.DEPRECATED


async def test_get_unknown_raises(reg, sqlite_db):
    with pytest.raises(LookupError):
        await reg.get_agent(uuid.uuid4())
