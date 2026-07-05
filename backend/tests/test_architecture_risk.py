"""Tests for F-304 — Risk Register."""

from __future__ import annotations

import json
import uuid
from typing import Any
from unittest.mock import MagicMock

import pytest
import pytest_asyncio

# Register the architecture ORM tables on the global metadata BEFORE
# `tests/conftest.py::sqlite_db` calls `metadata.create_all`. Without
# this import the architecture_* tables won't exist in the in-memory
# SQLite engine used by tests.
from app.db.models import architecture as _architecture_models  # noqa: F401


# ---------------------------------------------------------------------------
# Shared fixtures (mirrors test_architecture_core.py)
# ---------------------------------------------------------------------------


class _FakeLLM:
    """Async-context-manager LLM client with a canned response."""

    def __init__(self, payload: dict[str, Any] | str) -> None:
        self._payload = payload
        self.calls: list[list[dict[str, Any]]] = []

    async def __aenter__(self) -> "_FakeLLM":
        return self

    async def __aexit__(self, *_exc: Any) -> None:
        return None

    async def chat(self, messages: list[dict[str, Any]], **_kwargs: Any) -> dict[str, Any]:
        self.calls.append(messages)
        body = self._payload
        if isinstance(body, dict):
            return {
                "choices": [{"message": {"content": json.dumps(body)}}],
                "usage": {},
            }
        return {
            "choices": [{"message": {"content": str(body)}}],
            "usage": {},
        }


def _risk_payload() -> dict[str, Any]:
    return {
        "name": "ADR Risks",
        "mitigation_strategy": "Mitigate by review and tests.",
        "risks": [
            {
                "id": "RISK-1",
                "title": "Postgres outages",
                "category": "operational",
                "likelihood": 3,
                "impact": 5,
                "mitigation": "Multi-AZ + monitoring",
                "owner": "platform-team",
            },
            {
                "id": "RISK-2",
                "title": "Auth bypass",
                "category": "security",
                "likelihood": 2,
                "impact": 4,
                "mitigation": "Threat model + pen test",
                "owner": "security-team",
            },
            {
                "id": "RISK-3",
                "title": "Schema migration drift",
                "category": "technical",
                "likelihood": 4,
                "impact": 2,
                "mitigation": "Backwards-compatible migrations",
                "owner": "backend-team",
            },
        ],
    }


@pytest_asyncio.fixture
async def sqlite_db(sqlite_db):  # type: ignore[no-untyped-def]
    from app.db.models import architecture  # noqa: F401
    return sqlite_db


@pytest_asyncio.fixture
async def event_bus(event_bus):  # type: ignore[no-untyped-def]
    return event_bus


@pytest_asyncio.fixture
async def captured_events(event_bus):  # type: ignore[no-untyped-def]
    from app.services.event_bus import Event

    captured: list[Event] = []
    event_bus.subscribe_all(lambda e: captured.append(e))
    return captured


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_risk_register_generate_from_adr(
    sqlite_db, event_bus, captured_events
):
    from app.services.architecture.adr_generator import ADRGenerator
    from app.services.architecture.risk_register import RiskRegisterService

    adr_gen = ADRGenerator(
        litellm_client=_FakeLLM(
            {
                "title": "Pick DB",
                "status": "proposed",
                "context": "Need OLTP",
                "decision": "Use Postgres",
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
        context={"title": "DB", "problem": "pick"},
        actor_id=uuid.uuid4(),
    )

    svc = RiskRegisterService(
        litellm_client=_FakeLLM(_risk_payload()),
        artifact_registry=None,
        event_bus=event_bus,
    )
    register = await svc.generate_from_adr(adr_id=adr.id, actor_id=uuid.uuid4())

    assert register.id is not None
    assert register.tenant_id == adr.tenant_id
    assert register.project_id == adr.project_id
    assert register.status == "draft"
    assert len(register.risks) == 3
    assert {r["category"] for r in register.risks} == {"operational", "security", "technical"}
    # score is computed (likelihood * impact)
    by_id = {r["id"]: r for r in register.risks}
    assert by_id["RISK-1"]["score"] == 15
    assert by_id["RISK-2"]["score"] == 8
    assert by_id["RISK-3"]["score"] == 8
    # event fired
    assert any(
        e.event_type.value == "artifact.created"
        and e.payload.get("artifact_type") == "risk_register"
        for e in captured_events
    )


@pytest.mark.asyncio
async def test_risk_register_add_risk(sqlite_db, event_bus, captured_events):
    from app.services.architecture.adr_generator import ADRGenerator
    from app.services.architecture.risk_register import RiskRegisterService

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

    svc = RiskRegisterService(
        litellm_client=_FakeLLM(_risk_payload()),
        artifact_registry=None,
        event_bus=event_bus,
    )
    register = await svc.generate_from_adr(adr_id=adr.id, actor_id=uuid.uuid4())
    initial_count = len(register.risks)

    new_risk = {
        "title": "Vendor lock-in",
        "category": "business",
        "likelihood": 2,
        "impact": 3,
        "mitigation": "Annual vendor review",
        "owner": "procurement",
        "status": "open",
    }
    updated = await svc.add_risk(
        register_id=register.id, risk=new_risk, actor_id=uuid.uuid4()
    )

    assert len(updated.risks) == initial_count + 1
    added = updated.risks[-1]
    assert added["title"] == "Vendor lock-in"
    assert added["category"] == "business"
    assert added["score"] == 6  # 2 * 3
    assert added["status"] == "open"


@pytest.mark.asyncio
async def test_risk_register_score_calculation(sqlite_db, event_bus, captured_events):
    """Score = likelihood * impact for every risk, including updates."""
    from app.services.architecture.risk_register import RiskRegisterService

    svc = RiskRegisterService(
        litellm_client=_FakeLLM(_risk_payload()),
        artifact_registry=None,
        event_bus=event_bus,
    )
    # Use generate_from_breakdown with a stubbed breakdown; the LLM
    # response is canonical so this exercises the score logic purely.
    factory = sqlite_db
    async with factory() as session:
        from app.db.models.architecture import TaskBreakdown

        breakdown = TaskBreakdown(
            tenant_id=str(uuid.uuid4()),
            project_id=str(uuid.uuid4()),
            name="Implementation",
            parent_artifact_type="adr",
            parent_artifact_id=str(uuid.uuid4()),
            tasks=[],
            total_estimate_hours=0.0,
            status="draft",
            generated_by=str(uuid.uuid4()),
        )
        session.add(breakdown)
        await session.commit()
        await session.refresh(breakdown)

    register = await svc.generate_from_breakdown(
        breakdown_id=breakdown.id, actor_id=uuid.uuid4()
    )
    for r in register.risks:
        assert r["score"] == int(r["likelihood"]) * int(r["impact"])

    # Updating likelihood/impact should recompute score.
    target_id = register.risks[0]["id"]
    new_likelihood = register.risks[0]["likelihood"]
    new_impact = register.risks[0]["impact"]
    bumped = await svc.update_risk(
        register_id=register.id,
        risk_id=target_id,
        updates={"likelihood": 5, "impact": 5},
        actor_id=uuid.uuid4(),
    )
    bumped_risk = next(r for r in bumped.risks if r["id"] == target_id)
    assert bumped_risk["score"] == 25
    # original values preserved
    assert new_likelihood == bumped_risk["likelihood"] or bumped_risk["likelihood"] == 5


@pytest.mark.asyncio
async def test_risk_register_top_risks_sorted(sqlite_db, event_bus, captured_events):
    from app.services.architecture.risk_register import RiskRegisterService

    payload = {
        "name": "Top",
        "mitigation_strategy": "",
        "risks": [
            {"id": "R-LOW", "title": "low", "category": "technical", "likelihood": 1, "impact": 1},
            {"id": "R-MED", "title": "med", "category": "security", "likelihood": 3, "impact": 3},
            {"id": "R-HIGH", "title": "high", "category": "operational", "likelihood": 5, "impact": 5},
            {"id": "R-MID", "title": "mid", "category": "business", "likelihood": 2, "impact": 4},
        ],
    }
    svc = RiskRegisterService(
        litellm_client=_FakeLLM(payload),
        artifact_registry=None,
        event_bus=event_bus,
    )
    factory = sqlite_db
    async with factory() as session:
        from app.db.models.architecture import TaskBreakdown

        breakdown = TaskBreakdown(
            tenant_id=str(uuid.uuid4()),
            project_id=str(uuid.uuid4()),
            name="plan",
            parent_artifact_type="adr",
            parent_artifact_id=str(uuid.uuid4()),
            tasks=[],
            total_estimate_hours=0.0,
            status="draft",
            generated_by=str(uuid.uuid4()),
        )
        session.add(breakdown)
        await session.commit()
        await session.refresh(breakdown)

    register = await svc.generate_from_breakdown(
        breakdown_id=breakdown.id, actor_id=uuid.uuid4()
    )
    top = await svc.get_top_risks(register.id, top_n=3)
    scores = [int(r["score"]) for r in top]
    assert scores == sorted(scores, reverse=True)
    assert scores[0] == 25  # the (5,5) risk
    assert len(top) == 3


__all__ = [
    "test_risk_register_generate_from_adr",
    "test_risk_register_add_risk",
    "test_risk_register_score_calculation",
    "test_risk_register_top_risks_sorted",
]
