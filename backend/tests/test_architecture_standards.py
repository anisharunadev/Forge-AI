"""Tests for F-308 — Standards Attestation."""

from __future__ import annotations

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


class _StubLLM:
    """Unused for standards tests but kept symmetric with other suites."""

    async def __aenter__(self) -> "_StubLLM":
        return self

    async def __aexit__(self, *_exc: Any) -> None:
        return None

    async def chat(self, messages: list[dict[str, Any]], **_kw: Any) -> dict[str, Any]:
        return {"choices": [{"message": {"content": "{}"}}], "usage": {}}


class _StubRegistry:
    """In-memory artifact registry used to record attestation envelopes."""

    def __init__(self) -> None:
        self.rows: list[dict[str, Any]] = []

    async def create(self, *, tenant_id: Any, project_id: Any, type: str,
                     payload: dict[str, Any], created_by: Any,
                     actor_id: Any | None = None, **_kw: Any) -> dict[str, Any]:
        record = {
            "id": str(uuid.uuid4()),
            "tenant_id": str(tenant_id),
            "project_id": str(project_id),
            "type": type,
            "payload": payload,
            "created_by": str(created_by) if created_by else None,
        }
        self.rows.append(record)
        return record

    async def list(self, *, tenant_id: Any, project_id: Any, type: str,
                   **_kw: Any) -> list[dict[str, Any]]:
        return [
            row
            for row in self.rows
            if row["type"] == type
            and row["tenant_id"] == str(tenant_id)
            and row["project_id"] == str(project_id)
        ]

    async def register(self, *, artifact_type: str, artifact_id: Any,
                       tenant_id: Any, project_id: Any,
                       payload: dict[str, Any] | None = None,
                       **_kw: Any) -> dict[str, Any]:
        """T-A6 stub mirror of ArtifactRegistry.register."""
        record = {
            "node_id": str(uuid.uuid4()),
            "type": artifact_type,
            "artifact_type": artifact_type,
            "artifact_id": str(artifact_id),
            "tenant_id": str(tenant_id),
            "project_id": str(project_id),
            "payload": payload or {},
        }
        self.rows.append(record)
        return record


class _StubAudit:
    """Captures audit events in a list for assertions."""

    def __init__(self) -> None:
        self.events: list[dict[str, Any]] = []

    async def record(self, *, tenant_id: Any, project_id: Any, actor_id: Any,
                     action: str, target_type: str, target_id: str,
                     payload: dict[str, Any] | None = None,
                     occurred_at: Any = None) -> None:
        self.events.append(
            {
                "tenant_id": str(tenant_id),
                "project_id": str(project_id),
                "actor_id": str(actor_id) if actor_id else None,
                "action": action,
                "target_type": target_type,
                "target_id": target_id,
                "payload": payload or {},
            }
        )


@pytest.fixture
def registry() -> _StubRegistry:
    return _StubRegistry()


@pytest.fixture
def audit() -> _StubAudit:
    return _StubAudit()


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
async def test_attest_artifact_appends_to_audit(
    sqlite_db, event_bus, registry, audit
):
    """Attesting an ADR with all-required-fields present should pass and emit an audit row."""
    from app.services.architecture.standards_attestation import (
        StandardsAttestationService,
    )

    # Seed an ADR row so the policy check passes.
    from app.db.models.architecture import ADR
    from app.db.session import get_session_factory

    tenant_id = uuid.uuid4()
    project_id = uuid.uuid4()
    factory = get_session_factory()
    async with factory() as session:
        adr = ADR(
            tenant_id=str(tenant_id),
            project_id=str(project_id),
            number=1,
            title="Pick Postgres",
            status="proposed",
            context="We need OLTP and JSONB.",
            decision="Adopt Postgres 16.",
            consequences={"positive": ["ACID"]},
            alternatives=[],
            related_adrs=[],
            generated_by=str(uuid.uuid4()),
        )
        session.add(adr)
        await session.commit()
        await session.refresh(adr)
        adr_id = adr.id

    service = StandardsAttestationService(
        artifact_registry=registry,
        standard_service=None,
        audit_service=audit,
        event_bus=event_bus,
    )
    payload = await service.attest(
        artifact_type="adr",
        artifact_id=adr_id,
        attestor_id=uuid.uuid4(),
        tenant_id=tenant_id,
        project_id=project_id,
    )

    assert payload["status"] in {"attested", "failed"}
    assert any(
        e["action"] == "architecture.standards.attest" for e in audit.events
    ), "expected an audit row for the attestation"
    assert any(
        e["target_type"] == "adr" and e["target_id"] == str(adr_id)
        for e in audit.events
    )


@pytest.mark.asyncio
async def test_attest_fails_on_standard_violation(
    sqlite_db, event_bus, registry, audit
):
    """An artifact missing the required `title` field should fail attestation."""
    from app.services.architecture.standards_attestation import (
        StandardsAttestationService,
    )

    from app.db.models.architecture import ADR
    from app.db.session import get_session_factory

    tenant_id = uuid.uuid4()
    project_id = uuid.uuid4()
    factory = get_session_factory()
    async with factory() as session:
        adr = ADR(
            tenant_id=str(tenant_id),
            project_id=str(project_id),
            number=1,
            title="",  # <-- empty title, presence policy will fail
            status="proposed",
            context="",
            decision="",
            consequences={},
            alternatives=[],
            related_adrs=[],
            generated_by=str(uuid.uuid4()),
        )
        session.add(adr)
        await session.commit()
        await session.refresh(adr)
        adr_id = adr.id

    service = StandardsAttestationService(
        artifact_registry=registry,
        standard_service=None,
        audit_service=audit,
        event_bus=event_bus,
    )
    payload = await service.attest(
        artifact_type="adr",
        artifact_id=adr_id,
        attestor_id=uuid.uuid4(),
        tenant_id=tenant_id,
        project_id=project_id,
    )

    assert payload["status"] == "failed"
    failed_checks = [c for c in payload["checks"] if not c["passed"]]
    assert failed_checks, "expected at least one failing check"


@pytest.mark.asyncio
async def test_get_standards_for_artifact(
    sqlite_db, event_bus, registry, audit
):
    """`get_standards_for_artifact` should return applicable checks without writing."""
    from app.services.architecture.standards_attestation import (
        StandardsAttestationService,
    )

    from app.db.models.architecture import ADR
    from app.db.session import get_session_factory

    tenant_id = uuid.uuid4()
    project_id = uuid.uuid4()
    factory = get_session_factory()
    async with factory() as session:
        adr = ADR(
            tenant_id=str(tenant_id),
            project_id=str(project_id),
            number=1,
            title="Title",
            status="proposed",
            context="C" * 100,
            decision="D",
            consequences={},
            alternatives=[],
            related_adrs=[],
            generated_by=str(uuid.uuid4()),
        )
        session.add(adr)
        await session.commit()
        await session.refresh(adr)
        adr_id = adr.id

    service = StandardsAttestationService(
        artifact_registry=registry,
        standard_service=None,
        audit_service=audit,
        event_bus=event_bus,
    )
    checks = await service.get_standards_for_artifact(
        artifact_type="adr",
        artifact_id=adr_id,
        tenant_id=tenant_id,
        project_id=project_id,
    )
    assert isinstance(checks, list)
    # At least one default standard applies to ADRs.
    assert checks, "expected at least one default standard"
    assert audit.events == [], "check endpoint must not write audit rows"


@pytest.mark.asyncio
async def test_revoke_attestation_creates_audit(
    sqlite_db, event_bus, registry, audit
):
    """Revoking an attestation writes a fresh audit row and updates the payload."""
    from app.services.architecture.standards_attestation import (
        StandardsAttestationService,
    )

    from app.db.models.architecture import ADR
    from app.db.session import get_session_factory

    tenant_id = uuid.uuid4()
    project_id = uuid.uuid4()
    factory = get_session_factory()
    async with factory() as session:
        adr = ADR(
            tenant_id=str(tenant_id),
            project_id=str(project_id),
            number=1,
            title="Pick Postgres",
            status="proposed",
            context="We need OLTP.",
            decision="Adopt Postgres 16.",
            consequences={},
            alternatives=[],
            related_adrs=[],
            generated_by=str(uuid.uuid4()),
        )
        session.add(adr)
        await session.commit()
        await session.refresh(adr)
        adr_id = adr.id

    service = StandardsAttestationService(
        artifact_registry=registry,
        standard_service=None,
        audit_service=audit,
        event_bus=event_bus,
    )
    payload = await service.attest(
        artifact_type="adr",
        artifact_id=adr_id,
        attestor_id=uuid.uuid4(),
        tenant_id=tenant_id,
        project_id=project_id,
    )

    # Reset audit events to isolate the revoke call.
    audit.events.clear()

    # For tests, we need the registry to surface the attestation via list().
    # The stub's list() filters by tenant_id; the service uses a sentinel
    # zero-uuid for tenant/project during lookup so we mirror that here.
    # Patch the service to use the seeded tenant_id during lookup.
    async def _load(attestation_id: Any) -> dict[str, Any] | None:
        for row in registry.rows:
            if row["payload"].get("id") == str(attestation_id):
                return row["payload"]
        return None

    service._load_attestation = _load  # type: ignore[assignment]

    revoked = await service.revoke_attestation(
        attestation_id=payload["id"],
        reason="manual revocation",
        revoker_id=uuid.uuid4(),
    )
    assert revoked["status"] == "revoked"
    assert revoked["revocation_reason"] == "manual revocation"
    revoke_events = [
        e for e in audit.events if e["action"].endswith(".revoke")
    ]
    assert revoke_events, "expected a revoke audit row"