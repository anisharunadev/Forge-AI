"""TestAgentAssignment — round_robin, capability_match, manual_pin."""

from __future__ import annotations

import uuid

import pytest

from app.db.models.agent import AgentType
from app.services.agent_assignment import AgentAssignment
from app.services.agent_registry import AgentRegistry


@pytest.fixture
async def assignment(sqlite_db):
    return AgentAssignment(registry=AgentRegistry())


async def _seed_three_agents(reg: AgentRegistry, tenant_id: str, project_id: str | None):
    await reg.create_agent(
        tenant_id=tenant_id,
        project_id=project_id,
        name="a-python",
        type=AgentType.CLAUDE_CODE,
        capabilities={"languages": ["python"]},
    )
    await reg.create_agent(
        tenant_id=tenant_id,
        project_id=project_id,
        name="b-go",
        type=AgentType.CLAUDE_CODE,
        capabilities={"languages": ["go"]},
    )
    await reg.create_agent(
        tenant_id=tenant_id,
        project_id=project_id,
        name="c-polyglot",
        type=AgentType.CODEX,
        capabilities={"languages": ["python", "go", "rust"]},
    )


async def test_round_robin_cycles(assignment, sqlite_db):
    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    await _seed_three_agents(assignment._registry, tenant_id, project_id)

    picks = []
    for _ in range(6):
        a = await assignment.assign_agent(
            task_type="review",
            tenant_id=tenant_id,
            project_id=project_id,
            strategy="round_robin",
        )
        picks.append(a.name)

    # Should cycle through the three candidates at least twice.
    assert set(picks[:3]) == {"a-python", "b-go", "c-polyglot"}
    assert picks[0] == picks[3]
    assert picks[1] == picks[4]
    assert picks[2] == picks[5]


async def test_capability_match(assignment, sqlite_db):
    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    await _seed_three_agents(assignment._registry, tenant_id, project_id)

    a = await assignment.assign_agent(
        task_type="python_review",
        tenant_id=tenant_id,
        project_id=project_id,
        strategy="capability_match",
        required_capabilities={"languages": ["python"]},
    )
    assert a.name in {"a-python", "c-polyglot"}

    a2 = await assignment.assign_agent(
        task_type="polyglot_review",
        tenant_id=tenant_id,
        project_id=project_id,
        strategy="capability_match",
        required_capabilities={"languages": ["python", "go"]},
    )
    # c-polyglot has both, a-python only python; the ranker should pick c-polyglot.
    assert a2.name == "c-polyglot"


async def test_manual_pin(assignment, sqlite_db):
    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    await _seed_three_agents(assignment._registry, tenant_id, project_id)
    agents = await assignment._registry.list_agents(tenant_id, project_id=project_id)
    pinned = next(a for a in agents if a.name == "b-go")

    picked = await assignment.assign_agent(
        task_type="any",
        tenant_id=tenant_id,
        project_id=project_id,
        strategy="manual_pin",
        pinned_agent_id=pinned.id,
    )
    assert picked.id == pinned.id


async def test_unknown_strategy(assignment, sqlite_db):
    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    await _seed_three_agents(assignment._registry, tenant_id, project_id)
    with pytest.raises(ValueError):
        await assignment.assign_agent(
            task_type="any",
            tenant_id=tenant_id,
            project_id=project_id,
            strategy="not-a-strategy",
        )
