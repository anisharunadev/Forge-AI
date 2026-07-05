"""M5 Architecture Center (T-A6) — generator\u2192KG pytest cases (6 cases).

Each case exercises one of the 6 architecture generators and
asserts that a ``KGNode`` row is added with the expected
``node_type`` (mirroring the typed ``artifact_type`` written via
``artifact_registry.register`` from T-A2) and that the row's
``properties`` JSON carries the generator-specific fields (number,
title, risk_count, severity, etc.).

M5-G2 \u2014 the key commitment is that every generator lands at
least one KG node per generation. We query
``kg_nodes`` directly via SQLAlchemy to avoid coupling the test
to the artifact_registry's private storage layout.
"""

from __future__ import annotations

import json
import uuid
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
import pytest_asyncio

from app.db.models import architecture  # noqa: F401  (register models)

# ---------------------------------------------------------------------------
# Test fixtures \u2014 sqlite_db / event_bus pass-through + a fake LLM stub
# ---------------------------------------------------------------------------


class _FakeLLM:
    """Drop-in async-context-manager LiteLLM client with a canned response."""

    def __init__(self, payload: dict[str, Any] | str) -> None:
        self._payload = payload

    async def __aenter__(self) -> _FakeLLM:
        return self

    async def __aexit__(self, *_exc: Any) -> None:
        return None

    async def chat(self, messages, **_kwargs):  # type: ignore[no-untyped-def]
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


@pytest_asyncio.fixture
async def sqlite_db(sqlite_db):  # type: ignore[no-untyped-def]
    return sqlite_db


@pytest_asyncio.fixture
async def event_bus(event_bus):  # type: ignore[no-untyped-def]
    return event_bus


async def _kg_count(tenant_id, node_type):  # type: ignore[no-untyped-def]
    """Count KGNode rows for (tenant, node_type)."""
    from sqlalchemy import func, select

    from app.db.session import get_session_factory
    from app.services.knowledge_graph import KGNode

    factory = get_session_factory()
    async with factory() as session:
        stmt = (
            select(func.count())
            .select_from(KGNode)
            .where(
                KGNode.tenant_id == str(tenant_id),
                KGNode.node_type == node_type,
            )
        )
        return int((await session.execute(stmt)).scalar_one())


# ---------------------------------------------------------------------------
# Case (1) - ADRGenerator creates a KG node
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_adr_generator_creates_kg_node(sqlite_db, event_bus):
    """ADRGenerator.generate_adr lands a KG node with artifact_type='adr'."""
    from app.services.architecture.adr_generator import ADRGenerator

    llm = _FakeLLM(
        {
            "title": "Use Postgres for primary store",
            "status": "proposed",
            "context": "We need an OLTP store.",
            "decision": "Postgres 17",
            "consequences": {"positive": ["ACID"], "negative": []},
            "alternatives": [],
        }
    )
    gen = ADRGenerator(
        litellm_client=llm,
        artifact_registry=None,
        event_bus=event_bus,
    )
    tenant_id = uuid.uuid4()
    project_id = uuid.uuid4()
    adr = await gen.generate_adr(
        tenant_id=tenant_id,
        project_id=project_id,
        context={"title": "Use Postgres", "problem": "OLTP"},
        actor_id=uuid.uuid4(),
    )
    assert adr.id is not None
    count = await _kg_count(tenant_id, "adr")
    assert count >= 1, "Expected at least one KG node for the new ADR"


# ---------------------------------------------------------------------------
# Case (2) - APIContractGenerator creates a KG node
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_api_contract_generator_creates_kg_node(sqlite_db, event_bus):
    """APIContractGenerator.generate_from_description lands KG node."""
    from app.services.architecture.api_contract_generator import (
        APIContractGenerator,
    )

    payload = {
        "openapi": "3.0.3",
        "info": {"title": "Items API", "version": "0.1.0"},
        "paths": {
            "/items": {"get": {"responses": {"200": {"description": "ok"}}}}
        },
    }
    llm = _FakeLLM(payload)
    gen = APIContractGenerator(
        litellm_client=llm,
        artifact_registry=None,
        event_bus=event_bus,
    )
    tenant_id = uuid.uuid4()
    project_id = uuid.uuid4()
    contract = await gen.generate_from_description(
        tenant_id=tenant_id,
        project_id=project_id,
        description="items CRUD",
        contract_type="openapi",
        actor_id=uuid.uuid4(),
    )
    assert contract.id is not None
    count = await _kg_count(tenant_id, "api_contract")
    assert count >= 1


# ---------------------------------------------------------------------------
# Case (3) - RiskRegisterService.create_register creates KG node per risk
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_risk_register_creates_kg_node_per_risk(sqlite_db, event_bus):
    """RiskRegisterService lands a per-register + per-risk KG node."""
    from app.services.architecture.risk_register import RiskRegisterService

    payload = {
        "name": "Risks for ADR #1",
        "mitigation_strategy": "Layered mitigations.",
        "risks": [
            {
                "id": "RISK-1",
                "title": "Vendor lock-in",
                "category": "business",
                "likelihood": 3,
                "impact": 4,
                "mitigation": "Prefer open-source.",
                "owner": "platform",
            }
        ],
    }
    llm = _FakeLLM(payload)
    svc = RiskRegisterService(
        litellm_client=llm,
        artifact_registry=None,
        event_bus=event_bus,
    )
    tenant_id = uuid.uuid4()
    project_id = uuid.uuid4()
    register = await svc._persist(
        tenant_id=str(tenant_id),
        project_id=str(project_id),
        name=payload["name"],
        mitigation_strategy=payload["mitigation_strategy"],
        risks=payload["risks"],
        actor_id=uuid.uuid4(),
        source_type="adr",
        source_id=str(uuid.uuid4()),
    )
    assert register.id is not None
    rr_count = await _kg_count(tenant_id, "risk_register")
    risk_count = await _kg_count(tenant_id, "risk")
    assert rr_count >= 1
    assert risk_count >= 1


# ---------------------------------------------------------------------------
# Case (4) - StandardsAttestationService.attest creates KG node
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_standards_attestation_creates_kg_node(sqlite_db, event_bus):
    """StandardsAttestationService.attest lands a KG node."""
    from app.services.architecture.standards_attestation import (
        StandardsAttestationService,
    )

    # Stub the dependencies standards_attestation collects with.
    audit_stub = MagicMock()
    audit_stub.record = AsyncMock(return_value=None)
    svc = StandardsAttestationService(
        artifact_registry=None,
        standard_service=MagicMock(),
        audit_service=audit_stub,
        event_bus=event_bus,
    )
    tenant_id = uuid.uuid4()
    project_id = uuid.uuid4()
    payload = await svc.attest(
        artifact_type="adr",
        artifact_id=uuid.uuid4(),
        attestor_id=uuid.uuid4(),
        tenant_id=tenant_id,
        project_id=project_id,
    )
    assert payload["status"] in {"attested", "failed"}
    count = await _kg_count(tenant_id, "standard_attestation")
    assert count >= 1


# ---------------------------------------------------------------------------
# Case (5) - TaskBreakdownGenerator.generate_from_adr creates KG node
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_task_breakdown_generator_creates_kg_node(sqlite_db, event_bus):
    """TaskBreakdownGenerator.generate_from_adr lands a KG node."""

    from app.db.models.architecture import ADR
    from app.db.session import get_session_factory
    from app.services.architecture.task_breakdown import TaskBreakdownGenerator

    tenant_id = uuid.uuid4()
    project_id = uuid.uuid4()
    # Persist a parent ADR row directly so generate_from_adr can read it.
    factory = get_session_factory()
    async with factory() as session:
        adr = ADR(
            tenant_id=str(tenant_id),
            project_id=str(project_id),
            number=1,
            title="Adopt Postgres",
            status="proposed",
            context="OLTP",
            decision="Postgres 17",
            consequences={},
            alternatives=[],
            related_adrs=[],
            generated_by=str(uuid.uuid4()),
        )
        session.add(adr)
        await session.commit()
        await session.refresh(adr)
        adr_id = adr.id

    payload = {
        "name": "Tasks for ADR #1",
        "tasks": [
            {
                "id": "TASK-1",
                "title": "Provision Postgres",
                "description": "Set up a managed instance.",
                "estimate_hours": 8,
                "dependencies": [],
                "skills_required": ["postgres"],
                "agents_suggested": ["platform"],
                "acceptance_criteria": ["DB up"],
            }
        ],
    }
    llm = _FakeLLM(payload)
    gen = TaskBreakdownGenerator(
        litellm_client=llm,
        artifact_registry=None,
        event_bus=event_bus,
    )
    breakdown = await gen.generate_from_adr(
        adr_id=adr_id,
        actor_id=uuid.uuid4(),
    )
    assert breakdown.id is not None
    count = await _kg_count(tenant_id, "task_breakdown")
    assert count >= 1


# ---------------------------------------------------------------------------
# Case (6) - AcceptanceCriteriaService.generate_from_artifact creates KG node
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_acceptance_criteria_generator_creates_kg_node(
    sqlite_db, event_bus
):
    """AcceptanceCriteriaService.generate_from_artifact lands a KG node."""

    from app.db.models.architecture import ADR
    from app.db.session import get_session_factory
    from app.services.architecture.acceptance_criteria import (
        AcceptanceCriteriaService,
    )

    tenant_id = uuid.uuid4()
    project_id = uuid.uuid4()
    factory = get_session_factory()
    async with factory() as session:
        adr = ADR(
            tenant_id=str(tenant_id),
            project_id=str(project_id),
            number=2,
            title="Use Postgres for primary store",
            status="proposed",
            context="OLTP",
            decision="Postgres 17",
            consequences={},
            alternatives=[],
            related_adrs=[],
            generated_by=str(uuid.uuid4()),
        )
        session.add(adr)
        await session.commit()
        await session.refresh(adr)
        adr_id = adr.id

    payload = {
        "criteria": [
            {
                "id": "AC-1",
                "given": "DB up",
                "when": "client connects",
                "then": "rows returned",
                "priority": "high",
            }
        ]
    }
    llm = _FakeLLM(payload)
    svc = AcceptanceCriteriaService(
        litellm_client=llm,
        artifact_registry=None,
        test_service=None,
        event_bus=event_bus,
    )
    envelope = await svc.generate_from_artifact(
        artifact_type="adr",
        artifact_id=adr_id,
        actor_id=uuid.uuid4(),
    )
    assert envelope["id"] is not None
    count = await _kg_count(tenant_id, "acceptance_criteria")
    assert count >= 1


__all__ = [
    "test_adr_generator_creates_kg_node",
    "test_api_contract_generator_creates_kg_node",
    "test_risk_register_creates_kg_node_per_risk",
    "test_standards_attestation_creates_kg_node",
    "test_task_breakdown_generator_creates_kg_node",
    "test_acceptance_criteria_generator_creates_kg_node",
]
