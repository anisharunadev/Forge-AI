"""M5 Architecture Center (T-A6) — SecurityReport pytest cases (4 cases).

AC-3 / M5-G3 coverage:

(a) test_create_security_report_writes_row_and_kg_node
    - inserts a row + registers a KGNode with
      artifact_type='security_report'.
(b) test_list_security_reports_filters_by_severity
    - the list filter narrows the result set.
(c) test_compute_deployment_posture_aggregates_correctly
    - the aggregate returns the expected roll-up keys + values.
(d) test_update_status_invalidates_status_transition
    - closed \u2192 open is rejected; closed \u2192 mitigating is allowed and
      stamps mitigated_at.
"""

from __future__ import annotations

import uuid

import pytest
import pytest_asyncio

from app.db.models import security_report as _security_models  # noqa: F401


@pytest_asyncio.fixture
async def sqlite_db(sqlite_db):  # type: ignore[no-untyped-def]
    return sqlite_db


@pytest_asyncio.fixture
async def event_bus(event_bus):  # type: ignore[no-untyped-def]
    return event_bus


# ---------------------------------------------------------------------------
# Case (a) — create_report writes row + KG node
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_security_report_writes_row_and_kg_node(sqlite_db, event_bus):
    from sqlalchemy import func, select

    from app.db.models.security_report import SecurityReport
    from app.db.session import get_session_factory
    from app.services.architecture.security_report import SecurityReportService
    from app.services.knowledge_graph import KGNode

    svc = SecurityReportService(artifact_registry_instance=None, event_bus=event_bus)
    tenant_id = uuid.uuid4()
    project_id = uuid.uuid4()
    row = await svc.create_report(
        tenant_id=tenant_id,
        project_id=project_id,
        title="JWT signed with HS256 upstream",
        severity="critical",
        category="cryptography",
        description=(
            "Tokens are signed at the edge with HS256 but TLS terminates "
            "the secret, leaking key material at load balancer."
        ),
        affected_service="acme-edge-gateway",
        recommendation="Migrate to EdDSA signing with a 32-byte secret.",
        source_adr_id=None,
        generated_by=uuid.uuid4(),
    )
    assert row.id is not None
    assert row.severity == "critical"
    # KG side: a node with node_type='security_report' was added.
    factory = get_session_factory()
    async with factory() as session:
        stmt = (
            select(func.count())
            .select_from(KGNode)
            .where(
                KGNode.tenant_id == str(tenant_id),
                KGNode.node_type == "security_report",
            )
        )
        kg_count = int((await session.execute(stmt)).scalar_one())
    assert kg_count >= 1
    # Row side: persists with status=open by default.
    async with factory() as session:
        row_check = await session.get(SecurityReport, str(row.id))
    assert row_check is not None
    assert row_check.status == "open"


# ---------------------------------------------------------------------------
# Case (b) — list filters by severity
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_security_reports_filters_by_severity(sqlite_db, event_bus):
    from app.services.architecture.security_report import SecurityReportService

    svc = SecurityReportService(artifact_registry_instance=None, event_bus=event_bus)
    tenant_id = uuid.uuid4()
    project_id = uuid.uuid4()
    # Create one critical and one medium finding.
    await svc.create_report(
        tenant_id=tenant_id,
        project_id=project_id,
        title="Critical: EU PII replicate to US",
        severity="critical",
        category="data",
        description="PII leaves EU region via analytics ETL.",
        affected_service="acme-recommendations",
        recommendation="Re-tag Hive table as eu-west-1.",
        generated_by=uuid.uuid4(),
    )
    await svc.create_report(
        tenant_id=tenant_id,
        project_id=project_id,
        title="Medium: audit log redaction whitelist missing",
        severity="medium",
        category="logging",
        description="approver.reason not in redaction whitelist.",
        affected_service="acme-platform",
        recommendation="Add approver.reason to redaction whitelist.",
        generated_by=uuid.uuid4(),
    )
    rows_critical = await svc.list_reports(
        tenant_id=tenant_id,
        project_id=project_id,
        severity="critical",
    )
    rows_all = await svc.list_reports(
        tenant_id=tenant_id,
        project_id=project_id,
    )
    assert len(rows_critical) == 1
    assert rows_critical[0].severity == "critical"
    assert len(rows_all) == 2
    # Filter by category narrows further.
    rows_logging = await svc.list_reports(
        tenant_id=tenant_id,
        project_id=project_id,
        category="logging",
    )
    assert len(rows_logging) == 1
    assert rows_logging[0].category == "logging"


# ---------------------------------------------------------------------------
# Case (c) — compute_deployment_posture aggregates correctly
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_compute_deployment_posture_aggregates_correctly(sqlite_db, event_bus):
    from app.services.architecture.security_report import SecurityReportService

    svc = SecurityReportService(artifact_registry_instance=None, event_bus=event_bus)
    tenant_id = uuid.uuid4()
    project_id = uuid.uuid4()
    # Seed: 1 critical open + 1 high open + 1 medium open + 1 low closed.
    await svc.create_report(
        tenant_id=tenant_id,
        project_id=project_id,
        title="Critical",
        severity="critical",
        category="cryptography",
        description="...",
        affected_service="svc-a",
        recommendation="...",
    )
    await svc.create_report(
        tenant_id=tenant_id,
        project_id=project_id,
        title="High",
        severity="high",
        category="auth",
        description="...",
        affected_service="svc-a",
        recommendation="...",
    )
    await svc.create_report(
        tenant_id=tenant_id,
        project_id=project_id,
        title="Medium",
        severity="medium",
        category="logging",
        description="...",
        affected_service="svc-b",
        recommendation="...",
    )
    closed_row = await svc.create_report(
        tenant_id=tenant_id,
        project_id=project_id,
        title="Low closed",
        severity="low",
        category="configuration",
        description="...",
        affected_service="svc-c",
        recommendation="...",
    )
    # Close the 4th row.
    await svc.update_status(
        tenant_id=tenant_id,
        report_id=closed_row.id,
        target_status="closed",
    )

    posture = await svc.compute_deployment_posture(tenant_id=tenant_id, project_id=project_id)
    assert posture["critical_open"] == 1
    assert posture["high_open"] == 1
    assert posture["medium_open"] == 1
    assert posture["low_open"] == 0
    assert posture["total_open"] == 3  # open + mitigating
    assert posture["total_closed"] == 1
    assert posture["by_category"]["cryptography"] == 1
    assert posture["by_category"]["auth"] == 1
    assert posture["by_category"]["logging"] == 1
    # Top affected services: svc-a (2) > svc-b (1) > svc-c (0).
    assert posture["top_affected_services"][0] == "svc-a"
    # Score: 100 - 25 (critical) - 10 (high) - 3 (medium) + 5 (closed bonus)
    # = 67.
    assert posture["score"] == 67


# ---------------------------------------------------------------------------
# Case (d) — update_status lifecycle + invalid-transition rejection
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_update_status_invalidates_status_transition(sqlite_db, event_bus):
    from app.services.architecture.security_report import SecurityReportService

    svc = SecurityReportService(artifact_registry_instance=None, event_bus=event_bus)
    tenant_id = uuid.uuid4()
    project_id = uuid.uuid4()
    row = await svc.create_report(
        tenant_id=tenant_id,
        project_id=project_id,
        title="Lifecycle test",
        severity="medium",
        category="data",
        description="...",
        affected_service="svc-d",
        recommendation="...",
    )
    # open -> mitigating OK
    updated = await svc.update_status(
        tenant_id=tenant_id,
        report_id=row.id,
        target_status="mitigating",
    )
    assert updated.status == "mitigating"
    assert updated.mitigated_at is None
    # mitigating -> closed OK
    updated2 = await svc.update_status(
        tenant_id=tenant_id,
        report_id=row.id,
        target_status="closed",
    )
    assert updated2.status == "closed"
    assert updated2.mitigated_at is not None
    # closed -> open is NOT in the transition whitelist.
    with pytest.raises(ValueError) as excinfo:
        await svc.update_status(
            tenant_id=tenant_id,
            report_id=row.id,
            target_status="open",
        )
    assert "invalid_status_transition" in str(excinfo.value)
    # closed -> mitigating IS allowed.
    updated3 = await svc.update_status(
        tenant_id=tenant_id,
        report_id=row.id,
        target_status="mitigating",
    )
    assert updated3.status == "mitigating"


__all__ = [
    "test_create_security_report_writes_row_and_kg_node",
    "test_list_security_reports_filters_by_severity",
    "test_compute_deployment_posture_aggregates_correctly",
    "test_update_status_invalidates_status_transition",
]
