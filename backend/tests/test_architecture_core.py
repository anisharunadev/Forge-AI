"""Tests for the Architecture Accelerator core (F-301 + F-302 + F-303)."""

from __future__ import annotations

import json
import uuid
from typing import Any

import pytest
import pytest_asyncio

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


class _FakeLLM:
    """Drop-in async-context-manager LiteLLM client with a canned response."""

    def __init__(self, payload: dict[str, Any] | str) -> None:
        self._payload = payload
        self.calls: list[list[dict[str, Any]]] = []

    async def __aenter__(self) -> _FakeLLM:
        return self

    async def __aexit__(self, *_exc: Any) -> None:
        return None

    async def chat(
        self,
        messages: list[dict[str, Any]],
        **_kwargs: Any,
    ) -> dict[str, Any]:
        self.calls.append(messages)
        body = self._payload
        if isinstance(body, dict):
            return {
                "choices": [{"message": {"content": json.dumps(body)}}],
                "usage": {"prompt_tokens": 10, "completion_tokens": 20},
            }
        return {
            "choices": [{"message": {"content": str(body)}}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 20},
        }


def _openapi_payload() -> dict[str, Any]:
    return {
        "openapi": "3.0.3",
        "info": {"title": "Test API", "version": "0.1.0"},
        "paths": {
            "/items": {
                "get": {
                    "responses": {"200": {"description": "ok"}},
                }
            }
        },
    }


@pytest_asyncio.fixture
async def sqlite_db(sqlite_db):  # type: ignore[no-untyped-def]
    """Reuse the in-memory sqlite fixture from conftest.py."""
    from app.db.models import architecture  # noqa: F401  (register models)

    return sqlite_db


@pytest_asyncio.fixture
async def event_bus(event_bus):  # type: ignore[no-untyped-def]
    return event_bus


@pytest_asyncio.fixture
async def captured_events(event_bus):  # type: ignore[no-untyped-def]
    """Subscribe a recorder to every event on the in-memory bus."""
    from app.services.event_bus import Event

    captured: list[Event] = []
    event_bus.subscribe_all(captured.append)
    return captured


# ---------------------------------------------------------------------------
# F-301 — ADR Generator
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_adr_generator_creates_with_madr_format(sqlite_db, event_bus, captured_events):
    from app.services.architecture.adr_generator import ADRGenerator

    llm = _FakeLLM(
        {
            "title": "Use Postgres for primary store",
            "status": "proposed",
            "context": "We need ACID transactions and JSONB support.",
            "decision": "Adopt Postgres 16 as the primary OLTP store.",
            "consequences": {"positive": ["Strong consistency"], "negative": []},
            "alternatives": [
                {"name": "MySQL", "summary": "...", "rejected_because": "weaker JSON"}
            ],
        }
    )
    gen = ADRGenerator(
        litellm_client=llm,
        artifact_registry=None,
        event_bus=event_bus,
    )
    adr = await gen.generate_adr(
        tenant_id=uuid.uuid4(),
        project_id=uuid.uuid4(),
        context={
            "title": "DB choice",
            "problem": "Pick OLTP",
            "forces": ["JSON support"],
            "constraints": ["on-prem"],
            "related_adrs": [],
            "related_artifacts": [],
        },
        actor_id=uuid.uuid4(),
    )

    assert adr.id is not None
    assert adr.number == 1
    assert adr.title == "Use Postgres for primary store"
    assert adr.status == "proposed"
    assert "ACID" in adr.context
    assert "Postgres 16" in adr.decision
    assert adr.consequences["positive"] == ["Strong consistency"]
    assert adr.alternatives[0]["name"] == "MySQL"
    assert any(e.event_type.value == "artifact.created" for e in captured_events)


@pytest.mark.asyncio
async def test_adr_generator_numbers_sequentially(sqlite_db, event_bus, captured_events):
    from app.services.architecture.adr_generator import ADRGenerator

    llm = _FakeLLM(
        lambda: {  # type: ignore[arg-type]
            "title": "T",
            "status": "proposed",
            "context": "C",
            "decision": "D",
            "consequences": {},
            "alternatives": [],
        }
    )
    # Make the canned response vary by call so we can assert ordering.
    counter = {"n": 0}

    async def chat(messages, **kwargs):
        counter["n"] += 1
        body = {
            "title": f"T{counter['n']}",
            "status": "proposed",
            "context": "C",
            "decision": "D",
            "consequences": {},
            "alternatives": [],
        }
        return {
            "choices": [{"message": {"content": json.dumps(body)}}],
            "usage": {},
        }

    llm.chat = chat  # type: ignore[assignment]
    gen = ADRGenerator(
        litellm_client=llm,
        artifact_registry=None,
        event_bus=event_bus,
    )
    tenant = uuid.uuid4()
    project = uuid.uuid4()
    adr1 = await gen.generate_adr(
        tenant_id=tenant,
        project_id=project,
        context={"title": "x", "problem": "p"},
        actor_id=uuid.uuid4(),
    )
    adr2 = await gen.generate_adr(
        tenant_id=tenant,
        project_id=project,
        context={"title": "x", "problem": "p"},
        actor_id=uuid.uuid4(),
    )
    adr3 = await gen.generate_adr(
        tenant_id=tenant,
        project_id=project,
        context={"title": "x", "problem": "p"},
        actor_id=uuid.uuid4(),
    )
    assert (adr1.number, adr2.number, adr3.number) == (1, 2, 3)


@pytest.mark.asyncio
async def test_adr_generator_emits_event(sqlite_db, event_bus, captured_events):
    from app.services.architecture.adr_generator import ADRGenerator
    from app.services.event_bus import EventType

    llm = _FakeLLM(
        {
            "title": "T",
            "status": "proposed",
            "context": "C",
            "decision": "D",
            "consequences": {},
            "alternatives": [],
        }
    )
    gen = ADRGenerator(
        litellm_client=llm,
        artifact_registry=None,
        event_bus=event_bus,
    )
    actor = uuid.uuid4()
    await gen.generate_adr(
        tenant_id=uuid.uuid4(),
        project_id=uuid.uuid4(),
        context={"title": "x", "problem": "p"},
        actor_id=actor,
    )
    matches = [e for e in captured_events if e.event_type == EventType.ARTIFACT_CREATED]
    assert matches, "expected at least one ARTIFACT_CREATED event"
    assert matches[-1].actor_id == actor
    assert matches[-1].payload["artifact_type"] == "adr"


@pytest.mark.asyncio
async def test_adr_supersede_chains_history(sqlite_db, event_bus, captured_events):
    from app.services.architecture.adr_generator import ADRGenerator

    canned = {
        "title": "T",
        "status": "proposed",
        "context": "C",
        "decision": "D",
        "consequences": {},
        "alternatives": [],
    }
    llm = _FakeLLM(canned)
    gen = ADRGenerator(
        litellm_client=llm,
        artifact_registry=None,
        event_bus=event_bus,
    )
    tenant = uuid.uuid4()
    project = uuid.uuid4()
    old = await gen.generate_adr(
        tenant_id=tenant,
        project_id=project,
        context={"title": "old", "problem": "p"},
        actor_id=uuid.uuid4(),
    )
    new = await gen.generate_adr(
        tenant_id=tenant,
        project_id=project,
        context={"title": "new", "problem": "p"},
        actor_id=uuid.uuid4(),
    )
    replacement = await gen.supersede_adr(adr_id=old.id, new_adr_id=new.id)
    assert str(old.id) in replacement.related_adrs
    # Old ADR should now be marked superseded.
    refreshed_old = await gen.get_adr(old.id)
    assert refreshed_old is not None
    assert refreshed_old.status == "superseded"


# ---------------------------------------------------------------------------
# F-302 — API Contract Generator
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_api_contract_generate_openapi(sqlite_db, event_bus, captured_events):
    from app.services.architecture.api_contract_generator import APIContractGenerator

    llm = _FakeLLM(_openapi_payload())
    gen = APIContractGenerator(
        litellm_client=llm,
        artifact_registry=None,
        event_bus=event_bus,
    )
    contract = await gen.generate_from_description(
        tenant_id=uuid.uuid4(),
        project_id=uuid.uuid4(),
        description="CRUD for items",
        contract_type="openapi",
        actor_id=uuid.uuid4(),
    )
    assert contract.id is not None
    assert contract.spec_type == "openapi"
    assert contract.spec_content["parsed"]["openapi"] == "3.0.3"
    assert contract.status == "draft"


@pytest.mark.asyncio
async def test_api_contract_validate_spec(sqlite_db, event_bus, captured_events):
    from app.services.architecture.api_contract_generator import APIContractGenerator

    llm = _FakeLLM(_openapi_payload())
    gen = APIContractGenerator(
        litellm_client=llm,
        artifact_registry=None,
        event_bus=event_bus,
    )
    contract = await gen.generate_from_description(
        tenant_id=uuid.uuid4(),
        project_id=uuid.uuid4(),
        description="Items CRUD",
        contract_type="openapi",
        actor_id=uuid.uuid4(),
    )
    report = await gen.validate_spec(contract.id)
    assert report["valid"] is True
    assert report["errors"] == []


# ---------------------------------------------------------------------------
# F-303 — Task Breakdown Generator
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_task_breakdown_from_adr(sqlite_db, event_bus, captured_events):
    from app.services.architecture.adr_generator import ADRGenerator
    from app.services.architecture.task_breakdown import TaskBreakdownGenerator

    adr_llm = _FakeLLM(
        {
            "title": "T",
            "status": "proposed",
            "context": "C",
            "decision": "D",
            "consequences": {},
            "alternatives": [],
        }
    )
    adr_gen = ADRGenerator(
        litellm_client=adr_llm,
        artifact_registry=None,
        event_bus=event_bus,
    )
    adr = await adr_gen.generate_adr(
        tenant_id=uuid.uuid4(),
        project_id=uuid.uuid4(),
        context={"title": "x", "problem": "p"},
        actor_id=uuid.uuid4(),
    )

    breakdown_llm = _FakeLLM(
        {
            "name": "Implementation plan",
            "tasks": [
                {
                    "id": "TASK-1",
                    "title": "Stand up the schema",
                    "description": "Initial migration",
                    "estimate_hours": 4.0,
                    "dependencies": [],
                    "skills_required": ["sql"],
                    "agents_suggested": ["backend-engineer"],
                    "acceptance_criteria": ["migration applied"],
                },
                {
                    "id": "TASK-2",
                    "title": "Wire the API",
                    "description": "CRUD endpoints",
                    "estimate_hours": 6.0,
                    "dependencies": ["TASK-1"],
                    "skills_required": ["python"],
                    "agents_suggested": ["backend-engineer"],
                    "acceptance_criteria": ["200 on /items"],
                },
            ],
        }
    )
    breakdown_gen = TaskBreakdownGenerator(
        litellm_client=breakdown_llm,
        artifact_registry=None,
        event_bus=event_bus,
    )
    breakdown = await breakdown_gen.generate_from_adr(adr_id=adr.id, actor_id=uuid.uuid4())
    assert breakdown.id is not None
    assert breakdown.parent_artifact_type == "adr"
    assert breakdown.parent_artifact_id == adr.id
    assert len(breakdown.tasks) == 2
    assert breakdown.total_estimate_hours == pytest.approx(10.0)
    assert breakdown.tasks[1]["dependencies"] == ["TASK-1"]


@pytest.mark.asyncio
async def test_task_breakdown_update_task(sqlite_db, event_bus, captured_events):
    from app.services.architecture.adr_generator import ADRGenerator
    from app.services.architecture.task_breakdown import TaskBreakdownGenerator

    adr_gen = ADRGenerator(
        litellm_client=_FakeLLM(
            {
                "title": "T",
                "status": "proposed",
                "context": "C",
                "decision": "D",
                "consequences": {},
                "alternatives": [],
            }
        ),
        artifact_registry=None,
        event_bus=event_bus,
    )
    adr = await adr_gen.generate_adr(
        tenant_id=uuid.uuid4(),
        project_id=uuid.uuid4(),
        context={"title": "x", "problem": "p"},
        actor_id=uuid.uuid4(),
    )

    breakdown_gen = TaskBreakdownGenerator(
        litellm_client=_FakeLLM(
            {
                "name": "n",
                "tasks": [
                    {
                        "id": "TASK-1",
                        "title": "t1",
                        "description": "d",
                        "estimate_hours": 2.0,
                    }
                ],
            }
        ),
        artifact_registry=None,
        event_bus=event_bus,
    )
    breakdown = await breakdown_gen.generate_from_adr(adr_id=adr.id, actor_id=uuid.uuid4())
    updated = await breakdown_gen.update_task(
        breakdown_id=breakdown.id,
        task_id="TASK-1",
        updates={"estimate_hours": 5.0, "status": "in_progress"},
    )
    task = next(t for t in updated.tasks if t["id"] == "TASK-1")
    assert task["estimate_hours"] == 5.0
    assert task["status"] == "in_progress"
    assert updated.total_estimate_hours == pytest.approx(5.0)


__all__ = [
    "test_adr_generator_creates_with_madr_format",
    "test_adr_generator_numbers_sequentially",
    "test_adr_generator_emits_event",
    "test_adr_supersede_chains_history",
    "test_api_contract_generate_openapi",
    "test_api_contract_validate_spec",
    "test_task_breakdown_from_adr",
    "test_task_breakdown_update_task",
]
