"""Tests for F-310 — Acceptance Criteria."""

from __future__ import annotations

import json
import uuid
from typing import Any

import pytest
import pytest_asyncio

# Register models BEFORE the sqlite_db fixture creates the schema.
from app.db.models import architecture  # noqa: F401


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


class _FakeLLM:
    def __init__(self, payload: dict[str, Any] | str) -> None:
        self._payload = payload

    async def __aenter__(self) -> "_FakeLLM":
        return self

    async def __aexit__(self, *_exc: Any) -> None:
        return None

    async def chat(self, messages: list[dict[str, Any]], **_kw: Any) -> dict[str, Any]:
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


class _StubRegistry:
    """In-memory artifact registry for acceptance tests."""

    def __init__(self) -> None:
        self.rows: list[dict[str, Any]] = []
        self._by_payload_id: dict[str, dict[str, Any]] = {}

    async def create(self, *, tenant_id: Any, project_id: Any, type: str,
                     payload: dict[str, Any], created_by: Any,
                     actor_id: Any | None = None, **_kw: Any) -> dict[str, Any]:
        record = {
            "id": str(uuid.uuid4()),
            "tenant_id": str(tenant_id),
            "project_id": str(project_id),
            "type": type,
            "payload": payload,
        }
        self.rows.append(record)
        self._by_payload_id[str(payload.get("id") or "")] = record
        return record

    async def upsert(self, *, tenant_id: Any, project_id: Any, type: str,
                     key: str, payload: dict[str, Any],
                     created_by: Any, **_kw: Any) -> dict[str, Any]:
        existing = self._by_payload_id.get(key)
        if existing is not None:
            existing["payload"] = payload
            existing["tenant_id"] = str(tenant_id)
            existing["project_id"] = str(project_id)
            return existing
        return await self.create(
            tenant_id=tenant_id,
            project_id=project_id,
            type=type,
            payload=payload,
            created_by=created_by,
        )

    async def list(self, *, tenant_id: Any, project_id: Any, type: str,
                   **_kw: Any) -> list[dict[str, Any]]:
        if str(tenant_id) == "00000000-0000-0000-0000-000000000000":
            return [r for r in self.rows if r["type"] == type]
        return [
            r
            for r in self.rows
            if r["type"] == type
            and r["tenant_id"] == str(tenant_id)
            and r["project_id"] == str(project_id)
        ]


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
async def test_generate_criteria_bdd_format(sqlite_db, event_bus):
    """Generated criteria must include given/when/then + a priority."""
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
            number=1,
            title="Adopt Postgres",
            status="accepted",
            context="We need OLTP.",
            decision="Use Postgres 16.",
            consequences={},
            alternatives=[],
            related_adrs=[],
            generated_by=str(uuid.uuid4()),
        )
        session.add(adr)
        await session.commit()
        await session.refresh(adr)
        adr_id = adr.id

    llm = _FakeLLM(
        {
            "criteria": [
                {
                    "id": "AC-1",
                    "given": "a user with valid credentials",
                    "when": "they POST to /login",
                    "then": "they receive a JWT",
                    "priority": "high",
                },
                {
                    "id": "AC-2",
                    "given": "an expired token",
                    "when": "they call a protected endpoint",
                    "then": "they receive 401",
                    "priority": "critical",
                },
            ]
        }
    )
    registry = _StubRegistry()
    service = AcceptanceCriteriaService(
        litellm_client=llm,
        artifact_registry=registry,
        test_service=None,
        event_bus=event_bus,
    )
    envelope = await service.generate_from_artifact(
        artifact_type="adr",
        artifact_id=adr_id,
        actor_id=uuid.uuid4(),
    )
    assert envelope["source_artifact_type"] == "adr"
    assert envelope["source_artifact_id"] == str(adr_id)
    assert len(envelope["criteria"]) == 2
    for criterion in envelope["criteria"]:
        assert {"given", "when", "then", "priority"} <= set(criterion.keys())


@pytest.mark.asyncio
async def test_link_to_test_updates_coverage(sqlite_db, event_bus):
    """Linking a test to a criterion must be reflected in coverage."""
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
            number=1,
            title="Adopt Postgres",
            status="accepted",
            context="ctx",
            decision="Use Postgres 16.",
            consequences={},
            alternatives=[],
            related_adrs=[],
            generated_by=str(uuid.uuid4()),
        )
        session.add(adr)
        await session.commit()
        await session.refresh(adr)
        adr_id = adr.id

    llm = _FakeLLM(
        {
            "criteria": [
                {
                    "id": "AC-1",
                    "given": "g",
                    "when": "w",
                    "then": "t",
                    "priority": "high",
                },
                {
                    "id": "AC-2",
                    "given": "g2",
                    "when": "w2",
                    "then": "t2",
                    "priority": "low",
                },
            ]
        }
    )
    registry = _StubRegistry()
    service = AcceptanceCriteriaService(
        litellm_client=llm,
        artifact_registry=registry,
        test_service=None,
        event_bus=event_bus,
    )
    envelope = await service.generate_from_artifact(
        artifact_type="adr",
        artifact_id=adr_id,
        actor_id=uuid.uuid4(),
    )
    await service.link_to_test(
        criteria_id=envelope["id"],
        test_id="AC-1:test-login-200",
        actor_id=uuid.uuid4(),
    )

    report = await service.get_coverage(
        tenant_id=tenant_id,
        project_id=project_id,
    )
    assert report["total_criteria"] == 2
    assert report["criteria_with_tests"] >= 1


@pytest.mark.asyncio
async def test_get_coverage_calculates_percentage(sqlite_db, event_bus):
    """Coverage percentage is criteria_with_tests / total_criteria * 100."""
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
            number=1,
            title="Adopt Postgres",
            status="accepted",
            context="ctx",
            decision="Use Postgres 16.",
            consequences={},
            alternatives=[],
            related_adrs=[],
            generated_by=str(uuid.uuid4()),
        )
        session.add(adr)
        await session.commit()
        await session.refresh(adr)
        adr_id = adr.id

    llm = _FakeLLM(
        {
            "criteria": [
                {"id": "AC-1", "given": "g", "when": "w", "then": "t", "priority": "high"},
                {"id": "AC-2", "given": "g", "when": "w", "then": "t", "priority": "low"},
                {"id": "AC-3", "given": "g", "when": "w", "then": "t", "priority": "low"},
                {"id": "AC-4", "given": "g", "when": "w", "then": "t", "priority": "low"},
            ]
        }
    )
    registry = _StubRegistry()
    service = AcceptanceCriteriaService(
        litellm_client=llm,
        artifact_registry=registry,
        test_service=None,
        event_bus=event_bus,
    )
    envelope = await service.generate_from_artifact(
        artifact_type="adr",
        artifact_id=adr_id,
        actor_id=uuid.uuid4(),
    )
    # Link 1 of 4 criteria -> 25% coverage.
    await service.link_to_test(
        criteria_id=envelope["id"],
        test_id="AC-1:test-login-200",
        actor_id=uuid.uuid4(),
    )
    report = await service.get_coverage(
        tenant_id=tenant_id,
        project_id=project_id,
    )
    assert report["total_criteria"] == 4
    assert report["criteria_with_tests"] == 1
    assert report["coverage_pct"] == 25.0


@pytest.mark.asyncio
async def test_validate_against_code(sqlite_db, event_bus):
    """validate_against_code returns matched vs missing criterion steps."""
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
            number=1,
            title="Adopt Postgres",
            status="accepted",
            context="ctx",
            decision="Use Postgres 16.",
            consequences={},
            alternatives=[],
            related_adrs=[],
            generated_by=str(uuid.uuid4()),
        )
        session.add(adr)
        await session.commit()
        await session.refresh(adr)
        adr_id = adr.id

    llm = _FakeLLM(
        {
            "criteria": [
                {"id": "AC-1", "given": "g", "when": "w", "then": "t", "priority": "high"},
                {"id": "AC-2", "given": "g", "when": "w", "then": "t", "priority": "low"},
            ]
        }
    )
    registry = _StubRegistry()
    service = AcceptanceCriteriaService(
        litellm_client=llm,
        artifact_registry=registry,
        test_service=None,
        event_bus=event_bus,
    )
    envelope = await service.generate_from_artifact(
        artifact_type="adr",
        artifact_id=adr_id,
        actor_id=uuid.uuid4(),
    )
    # Link only AC-1 -> validation reports AC-2 missing.
    await service.link_to_test(
        criteria_id=envelope["id"],
        test_id="AC-1:test-1",
        actor_id=uuid.uuid4(),
    )
    result = await service.validate_against_code(
        criteria_id=envelope["id"],
        code_artifact_id=uuid.uuid4(),
    )
    assert result["passed"] is False
    assert "AC-1" in result["matched_steps"]
    assert "AC-2" in result["missing_steps"]