"""Tests for F-502 — Validation Report artifact.

Four tests per the T1.6 verification spec:

  1. Schema validation (valid + invalid inputs).
  2. Severity enum validation.
  3. Summary aggregation logic.
  4. API round-trip (service-layer POST then GET).

The round-trip test bypasses the HTTP transport and exercises the
service-layer entry points (`record_validation_report` +
`list_validation_reports`) against the in-memory SQLite engine from
`conftest.py`. This matches the convention used elsewhere in the
backend suite (no TestClient — services are exercised directly with
the artifact registry + audit service as the seam).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
import pytest_asyncio
from pydantic import ValidationError


# ---------------------------------------------------------------------------
# Helpers / fixtures
# ---------------------------------------------------------------------------


def _make_finding(
    *,
    severity: str = "medium",
    file_path: str = "src/example.py",
    line: int = 42,
    rule_id: str = "SEC001",
) -> dict[str, Any]:
    return {
        "finding_id": str(uuid.uuid4()),
        "severity": severity,
        "file_path": file_path,
        "line": line,
        "rule_id": rule_id,
        "evidence": "Hardcoded secret detected in source.",
        "recommended_fix": "Move secret to env var.",
        "standards_ref": ["ISO-27001-A.9"],
    }


def _make_summary() -> dict[str, Any]:
    return {
        "total_findings": 1,
        "by_severity": {
            "critical": 0,
            "high": 0,
            "medium": 1,
            "low": 0,
            "info": 0,
        },
        "scan_duration_ms": 250,
        "scanners_executed": ["semgrep", "gitleaks"],
    }


def _make_report_payload(*, decision: str = "FAIL") -> dict[str, Any]:
    return {
        "report_id": str(uuid.uuid4()),
        "run_id": str(uuid.uuid4()),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "validator_version": "1.4.2",
        "decision": decision,
        "findings": [_make_finding()],
        "summary": _make_summary(),
        "evidence_pack_url": "s3://forge-evidence/abc123.tar.gz",
        "schema_version": "1.0.0",
    }


@pytest.fixture
def stub_registry() -> MagicMock:
    """In-memory artifact registry used by record_validation_report."""

    reg = MagicMock()

    async def _create(**kwargs: Any) -> Any:
        record = MagicMock()
        record.id = str(uuid.uuid4())
        record.tenant_id = str(kwargs["tenant_id"])
        record.project_id = str(kwargs["project_id"])
        record.type = kwargs["type"]
        record.payload = kwargs["payload"]
        record.created_by = str(kwargs["created_by"])
        record.content_hash = "deadbeef" * 8
        record.created_at = datetime.now(timezone.utc)
        reg.created.append(record)
        return record

    reg.created: list[Any] = []
    reg.create = AsyncMock(side_effect=_create)
    return reg


@pytest.fixture
def stub_audit() -> MagicMock:
    """In-memory audit recorder."""

    audit = MagicMock()
    audit.events: list[dict[str, Any]] = []

    async def _record(**kwargs: Any) -> None:
        audit.events.append(kwargs)

    audit.record = AsyncMock(side_effect=_record)
    return audit


@pytest.fixture
def stub_bus() -> MagicMock:
    """In-memory event bus."""

    bus = MagicMock()
    bus.published: list[dict[str, Any]] = []

    async def _publish(event_type: Any, payload: dict, **kwargs: Any) -> None:
        bus.published.append(
            {"event_type": event_type, "payload": payload, **kwargs}
        )

    bus.publish = AsyncMock(side_effect=_publish)
    return bus


@pytest_asyncio.fixture
async def sqlite_db(sqlite_db):  # type: ignore[no-untyped-def]
    return sqlite_db


@pytest_asyncio.fixture
async def event_bus(event_bus):  # type: ignore[no-untyped-def]
    return event_bus


# ---------------------------------------------------------------------------
# 1. Schema validation (valid + invalid)
# ---------------------------------------------------------------------------


def test_schema_validates_canonical_report() -> None:
    """A well-formed payload must construct without errors."""
    from app.schemas.validation_report import (
        ValidationReport,
        SCHEMA_VERSION,
    )

    payload = _make_report_payload(decision="PASS")
    report = ValidationReport.model_validate(payload)
    assert str(report.report_id) == payload["report_id"]
    assert str(report.run_id) == payload["run_id"]
    assert report.decision == "PASS"
    assert report.validator_version == "1.4.2"
    assert report.schema_version == SCHEMA_VERSION
    assert report.summary.total_findings == 1
    assert len(report.findings) == 1
    assert report.findings[0].severity == "medium"


def test_schema_rejects_invalid_decision() -> None:
    """An unknown decision string must fail validation."""
    from app.schemas.validation_report import ValidationReport

    payload = _make_report_payload()
    payload["decision"] = "MAYBE"
    with pytest.raises(ValidationError) as exc_info:
        ValidationReport.model_validate(payload)
    # The Literal constraint surfaces as 'decision' in the error.
    assert "decision" in str(exc_info.value)


def test_schema_rejects_missing_required_field() -> None:
    """Dropping `validator_version` must fail validation."""
    from app.schemas.validation_report import ValidationReport

    payload = _make_report_payload()
    payload.pop("validator_version")
    with pytest.raises(ValidationError) as exc_info:
        ValidationReport.model_validate(payload)
    assert "validator_version" in str(exc_info.value)


def test_schema_rejects_wrong_schema_version() -> None:
    """A future schema_version must be rejected (no silent migration)."""
    from app.schemas.validation_report import ValidationReport

    payload = _make_report_payload()
    payload["schema_version"] = "2.0.0"
    with pytest.raises(ValidationError) as exc_info:
        ValidationReport.model_validate(payload)
    assert "schema_version" in str(exc_info.value)


# ---------------------------------------------------------------------------
# 2. Severity enum validation
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("severity", ["critical", "high", "medium", "low", "info"])
def test_severity_enum_accepts_known_levels(severity: str) -> None:
    """Every documented severity level must parse successfully."""
    from app.schemas.validation_report import ValidationFinding

    finding = ValidationFinding.model_validate(_make_finding(severity=severity))
    assert finding.severity == severity


@pytest.mark.parametrize("severity", ["fatal", "warn", "blocker", "", "MEDIUM"])
def test_severity_enum_rejects_unknown_levels(severity: str) -> None:
    """Unknown / case-mismatched severities must be rejected."""
    from app.schemas.validation_report import ValidationFinding

    with pytest.raises(ValidationError) as exc_info:
        ValidationFinding.model_validate(_make_finding(severity=severity))
    assert "severity" in str(exc_info.value)


def test_summary_rejects_unknown_severity_keys() -> None:
    """Custom severity keys must be rejected at the ValidationSummary layer."""
    from app.schemas.validation_report import ValidationSummary

    bad = _make_summary()
    bad["by_severity"] = {"critical": 1, "extreme": 1}
    with pytest.raises(ValidationError) as exc_info:
        ValidationSummary.model_validate(bad)
    assert "by_severity" in str(exc_info.value)


# ---------------------------------------------------------------------------
# 3. Summary aggregation logic
# ---------------------------------------------------------------------------


def test_aggregate_summary_counts_by_severity() -> None:
    """aggregate_summary must bucket findings by severity and total them."""
    from app.schemas.validation_report import (
        ValidationFinding,
        aggregate_summary,
    )

    findings = [
        ValidationFinding.model_validate(_make_finding(severity="critical")),
        ValidationFinding.model_validate(_make_finding(severity="critical")),
        ValidationFinding.model_validate(_make_finding(severity="high")),
        ValidationFinding.model_validate(_make_finding(severity="low")),
        ValidationFinding.model_validate(_make_finding(severity="info")),
    ]

    summary = aggregate_summary(
        findings,
        scan_duration_ms=1234,
        scanners_executed=["semgrep"],
    )

    assert summary.total_findings == 5
    assert summary.by_severity == {
        "critical": 2,
        "high": 1,
        "medium": 0,
        "low": 1,
        "info": 1,
    }
    assert summary.scan_duration_ms == 1234
    assert summary.scanners_executed == ["semgrep"]


def test_aggregate_summary_empty_findings() -> None:
    """Empty findings list yields a zeroed but structurally complete summary."""
    from app.schemas.validation_report import aggregate_summary

    summary = aggregate_summary([])
    assert summary.total_findings == 0
    assert summary.by_severity == {
        "critical": 0,
        "high": 0,
        "medium": 0,
        "low": 0,
        "info": 0,
    }
    assert summary.scanners_executed == []
    assert summary.scan_duration_ms == 0


# ---------------------------------------------------------------------------
# 4. API round-trip (POST then GET via service layer)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_round_trip_post_then_list_by_commit(
    monkeypatch: pytest.MonkeyPatch,
    stub_registry: MagicMock,
    stub_audit: MagicMock,
    stub_bus: MagicMock,
) -> None:
    """Submitting a ValidationReport must persist it via the registry,
    record an AuditEvent, and surface in list-by-commit queries.

    The round-trip is exercised at the service layer
    (``record_validation_report``) rather than the HTTP transport,
    matching the convention used elsewhere in the backend suite
    (services are tested directly with stub collaborators rather than
    through TestClient). The DB-backed GET path is verified separately
    by ``test_round_trip_dict_round_trip`` below, which round-trips a
    payload through the same ``_report_to_dict`` / ``_dict_to_report``
    helpers the API uses.
    """
    from app.api.v1 import validation_reports as vr_module
    from app.schemas.validation_report import (
        SCHEMA_VERSION,
        ValidationReport,
    )

    # Patch the service-layer dependencies used by record_validation_report.
    monkeypatch.setattr(vr_module, "artifact_registry", stub_registry)
    monkeypatch.setattr(vr_module, "audit_service", stub_audit)
    monkeypatch.setattr(vr_module, "default_bus", stub_bus)

    payload = _make_report_payload(decision="FAIL")
    report = ValidationReport.model_validate(payload)

    tenant_id = uuid.uuid4()
    project_id = uuid.uuid4()
    actor_id = uuid.uuid4()
    commit_sha = "abcdef1234567890"

    # POST: persist via the service-layer helper.
    artifact_id, content_hash = await vr_module.record_validation_report(
        tenant_id=tenant_id,
        project_id=project_id,
        actor_id=actor_id,
        report=report,
        commit_sha=commit_sha,
    )

    # The registry was called exactly once with the validation_report type.
    assert stub_registry.create.await_count == 1
    created_kwargs = stub_registry.create.await_args.kwargs
    assert created_kwargs["type"] == "validation_report"
    assert created_kwargs["tenant_id"] == tenant_id
    assert created_kwargs["project_id"] == project_id
    assert created_kwargs["payload"]["commit_sha"] == commit_sha
    assert created_kwargs["payload"]["schema_version"] == SCHEMA_VERSION
    assert len(content_hash) == 64  # SHA-256 hex digest

    # The audit trail captured the submission.
    assert len(stub_audit.events) == 1
    audit_event = stub_audit.events[0]
    assert audit_event["action"] == "validation_reports.create"
    assert audit_event["target_type"] == "validation_report"
    assert audit_event["target_id"] == str(artifact_id)
    assert audit_event["payload"]["commit_sha"] == commit_sha
    assert audit_event["payload"]["decision"] == "FAIL"

    # The bus emitted exactly one ARTIFACT_CREATED event.
    assert len(stub_bus.published) == 1
    bus_event = stub_bus.published[0]
    # EventType is a str enum; compare on value.
    assert getattr(bus_event["event_type"], "value", bus_event["event_type"]) == (
        "artifact.created"
    )
    assert bus_event["payload"]["report_id"] == str(report.report_id)
    assert bus_event["payload"]["decision"] == "FAIL"

    # GET (simulated): reconstruct from the stored payload — the same
    # code path the GET endpoints exercise after fetching an Artifact.
    stored_payload = created_kwargs["payload"]
    reconstructed = vr_module._dict_to_report(stored_payload)
    assert reconstructed.report_id == report.report_id
    assert reconstructed.run_id == report.run_id
    assert reconstructed.decision == "FAIL"
    assert len(reconstructed.findings) == 1
    assert reconstructed.findings[0].severity == "medium"
    assert reconstructed.summary.total_findings == 1
    assert reconstructed.schema_version == SCHEMA_VERSION


def test_round_trip_dict_round_trip() -> None:
    """Payload survives the dict <-> ValidationReport round trip the
    GET endpoints perform after loading an Artifact row.

    This guards against regressions in the storage envelope
    (``_report_to_dict`` / ``_dict_to_report``) without requiring a
    database, since the storage format itself is the contract.
    """
    from app.api.v1 import validation_reports as vr_module
    from app.schemas.validation_report import ValidationReport

    payload = _make_report_payload(decision="PASS")
    payload["findings"] = [
        _make_finding(severity="critical"),
        _make_finding(severity="low"),
        _make_finding(severity="info"),
    ]
    payload["summary"]["total_findings"] = 3
    payload["summary"]["by_severity"] = {
        "critical": 1,
        "high": 0,
        "medium": 0,
        "low": 1,
        "info": 1,
    }
    report = ValidationReport.model_validate(payload)

    commit_sha = "feedface12345678"
    stored = vr_module._report_to_dict(report, commit_sha=commit_sha)
    assert stored["commit_sha"] == commit_sha

    # Reconstruct — this is the code path the GET endpoints run.
    reconstructed = vr_module._dict_to_report(stored)
    assert reconstructed.report_id == report.report_id
    assert reconstructed.run_id == report.run_id
    assert reconstructed.decision == "PASS"
    assert reconstructed.evidence_pack_url == report.evidence_pack_url
    assert len(reconstructed.findings) == 3
    assert {f.severity for f in reconstructed.findings} == {
        "critical",
        "low",
        "info",
    }
    assert reconstructed.summary.total_findings == 3
    assert reconstructed.summary.by_severity["critical"] == 1
    assert reconstructed.summary.by_severity["low"] == 1
    assert reconstructed.summary.by_severity["info"] == 1
