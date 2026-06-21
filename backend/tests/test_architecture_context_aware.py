"""Tests for F-309 — Context-Aware Generation."""

from __future__ import annotations

import json
import uuid
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
import pytest_asyncio

# Register models BEFORE the sqlite_db fixture creates the schema.
from app.db.models import architecture  # noqa: F401


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


class _FakeLLM:
    """Drop-in async-context-manager LiteLLM client."""

    def __init__(self, payload: dict[str, Any] | str) -> None:
        self._payload = payload
        self.calls: list[list[dict[str, Any]]] = []

    async def __aenter__(self) -> "_FakeLLM":
        return self

    async def __aexit__(self, *_exc: Any) -> None:
        return None

    async def chat(self, messages: list[dict[str, Any]], **_kw: Any) -> dict[str, Any]:
        self.calls.append(messages)
        body = self._payload
        if isinstance(body, dict):
            return {
                "choices": [{"message": {"content": json.dumps(body)}}],
                "usage": {"prompt_tokens": 1, "completion_tokens": 1},
            }
        return {
            "choices": [{"message": {"content": str(body)}}],
            "usage": {},
        }


@pytest_asyncio.fixture
async def sqlite_db(sqlite_db):  # type: ignore[no-untyped-def]
    return sqlite_db


@pytest_asyncio.fixture
async def event_bus(event_bus):  # type: ignore[no-untyped-def]
    return event_bus


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_gather_context_pulls_standards(
    sqlite_db, event_bus
):
    """gather_context should populate `standards` when standard rows exist."""
    from app.db.models.standard import Standard
    from app.db.session import get_session_factory
    from app.services.architecture.context_aware import ContextAwareGenerator

    tenant_id = uuid.uuid4()
    project_id = uuid.uuid4()
    factory = get_session_factory()
    async with factory() as session:
        session.add(
            Standard(
                tenant_id=str(tenant_id),
                project_id=None,
                name="Required ADR sections",
                content="Title + context + decision are mandatory.",
                status="active",
                version=1,
                metadata_={
                    "policy": "presence",
                    "applies_to": ["adr"],
                },
            )
        )
        await session.commit()

    gen = ContextAwareGenerator(
        litellm_client=_FakeLLM({}),
        standard_service=None,
        template_service=None,
        project_intelligence=MagicMock(),
        event_bus=event_bus,
    )
    ctx = await gen.gather_context(
        tenant_id=tenant_id,
        project_id=project_id,
        artifact_type="adr",
        prompt_inputs={"title": "x"},
    )
    assert "standards" in ctx
    assert isinstance(ctx["standards"], list)
    assert any(
        s.get("name") == "Required ADR sections" for s in ctx["standards"]
    ), ctx["standards"]


@pytest.mark.asyncio
async def test_gather_context_pulls_templates(
    sqlite_db, event_bus
):
    """gather_context should pull Template rows matching the artifact_type."""
    from app.db.models.template import Template
    from app.db.session import get_session_factory
    from app.services.architecture.context_aware import ContextAwareGenerator

    tenant_id = uuid.uuid4()
    project_id = uuid.uuid4()
    factory = get_session_factory()
    async with factory() as session:
        session.add(
            Template(
                tenant_id=str(tenant_id),
                project_id=None,
                type="adr",
                name="MADR 4.0 skeleton",
                content={"sections": ["context", "decision"]},
                variables=[{"name": "title"}],
                version=1,
            )
        )
        await session.commit()

    gen = ContextAwareGenerator(
        litellm_client=_FakeLLM({}),
        standard_service=None,
        template_service=None,
        project_intelligence=MagicMock(),
        event_bus=event_bus,
    )
    ctx = await gen.gather_context(
        tenant_id=tenant_id,
        project_id=project_id,
        artifact_type="adr",
        prompt_inputs={"title": "x"},
    )
    assert ctx["templates"], "expected at least one template"
    assert ctx["templates"][0]["name"] == "MADR 4.0 skeleton"


@pytest.mark.asyncio
async def test_gather_context_pulls_prior_adrs(
    sqlite_db, event_bus
):
    """gather_context should pull prior ADRs for the (tenant, project)."""
    from app.db.models.architecture import ADR
    from app.db.session import get_session_factory
    from app.services.architecture.context_aware import ContextAwareGenerator

    tenant_id = uuid.uuid4()
    project_id = uuid.uuid4()
    factory = get_session_factory()
    async with factory() as session:
        for i in range(2):
            session.add(
                ADR(
                    tenant_id=str(tenant_id),
                    project_id=str(project_id),
                    number=i + 1,
                    title=f"Prior ADR #{i + 1}",
                    status="accepted",
                    context="prior context",
                    decision="prior decision",
                    consequences={},
                    alternatives=[],
                    related_adrs=[],
                    generated_by=str(uuid.uuid4()),
                )
            )
        await session.commit()

    gen = ContextAwareGenerator(
        litellm_client=_FakeLLM({}),
        standard_service=None,
        template_service=None,
        project_intelligence=MagicMock(),
        event_bus=event_bus,
    )
    ctx = await gen.gather_context(
        tenant_id=tenant_id,
        project_id=project_id,
        artifact_type="adr",
        prompt_inputs={"title": "x"},
    )
    assert len(ctx["prior_adrs"]) >= 2


@pytest.mark.asyncio
async def test_generate_with_context_tracks_usage(
    sqlite_db, event_bus
):
    """generate_with_context records which context items were used."""
    from app.services.architecture.context_aware import ContextAwareGenerator

    llm = _FakeLLM(
        {
            "title": "Augmented ADR",
            "status": "proposed",
            "context": "context",
            "decision": "decision",
            "consequences": {},
            "alternatives": [],
        }
    )
    gen = ContextAwareGenerator(
        litellm_client=llm,
        standard_service=None,
        template_service=None,
        project_intelligence=MagicMock(),
        event_bus=event_bus,
    )
    context = {
        "standards": [
            {
                "id": str(uuid.uuid4()),
                "name": "Test standard",
                "content": "All sections required",
                "applies_to": ["adr"],
            }
        ],
        "templates": [],
        "prior_adrs": [],
        "project_context": {"project_id": "abc"},
        "risk_register": [],
        "prompt_inputs": {},
    }
    artifact = await gen.generate_with_context(
        artifact_type="adr",
        prompt="Build an ADR for caching",
        context=context,
        actor_id=uuid.uuid4(),
        tenant_id=uuid.uuid4(),
        project_id=uuid.uuid4(),
    )
    assert artifact["type"] == "adr"
    assert artifact["context_refs"], "context_refs should not be empty"
    kinds = {ref["context_type"] for ref in artifact["context_refs"]}
    assert "standard" in kinds
    assert "project_context" in kinds


@pytest.mark.asyncio
async def test_get_context_usage_returns_list(
    sqlite_db, event_bus
):
    """get_context_usage returns the recorded references for an artifact."""
    from app.services.architecture.context_aware import ContextAwareGenerator

    llm = _FakeLLM(
        {
            "title": "Augmented ADR",
            "status": "proposed",
            "context": "c",
            "decision": "d",
            "consequences": {},
            "alternatives": [],
        }
    )
    gen = ContextAwareGenerator(
        litellm_client=llm,
        standard_service=None,
        template_service=None,
        project_intelligence=MagicMock(),
        event_bus=event_bus,
    )
    artifact = await gen.generate_with_context(
        artifact_type="adr",
        prompt="x",
        context={
            "standards": [
                {"id": "std-1", "name": "S1", "content": "c", "applies_to": ["adr"]}
            ],
            "templates": [],
            "prior_adrs": [],
            "project_context": {},
            "risk_register": [],
        },
        actor_id=uuid.uuid4(),
        tenant_id=uuid.uuid4(),
        project_id=uuid.uuid4(),
    )

    # Stub _load_artifact to return what we just generated.
    async def _load(artifact_id: Any) -> dict[str, Any] | None:
        return artifact if str(artifact_id) == artifact["id"] else None

    gen._load_artifact = _load  # type: ignore[assignment]
    refs = await gen.get_context_usage(artifact["id"])
    assert isinstance(refs, list)
    assert refs, "expected non-empty usage list"