"""F-503 — Deterministic Security Gate tests.

Coverage matrix
---------------
1. PASS decision allows commit.
2. FAIL decision blocks commit.
3. LLM is NOT called in the gate decision (NFR-042).
4. Audit row created on both PASS and FAIL (F-005).
5. Remediation ticket created on FAIL (mock Jira MCP).
6. Pre-call admission blocks when cost cap exceeded.
7. Webhook integration returns 200/403 correctly (mock GitHub payload).

All validators / LiteLLM calls are mocked — we never touch the real
``code_validator`` subgraph or the LiteLLM proxy here. The validator is
being built in parallel by another task; this suite is the contract
that task must satisfy.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import uuid
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.core.config import settings
from app.services.merge_gate import (
    GateDecision,
    MergeGate,
)
from app.services.remediation_router import (
    RemediationRouter,
)

# ---------------------------------------------------------------------------
# Fake ValidationReport — duck-types the schema created by F-501.
# ---------------------------------------------------------------------------


class _FakeFinding:
    def __init__(
        self,
        *,
        finding_id: str,
        severity: str,
        rule_id: str,
        file_path: str,
        line: int,
        evidence: str,
        recommended_fix: str = "",
    ) -> None:
        self.finding_id = finding_id
        self.severity = severity
        self.rule_id = rule_id
        self.file_path = file_path
        self.line = line
        self.evidence = evidence
        self.recommended_fix = recommended_fix

    def model_dump(self, mode: str | None = None) -> dict[str, Any]:
        return {
            "finding_id": self.finding_id,
            "severity": self.severity,
            "rule_id": self.rule_id,
            "file_path": self.file_path,
            "line": self.line,
            "evidence": self.evidence,
            "recommended_fix": self.recommended_fix,
        }


class _FakeReport:
    """Duck-typed stand-in for the F-501 ValidationReport."""

    def __init__(
        self,
        *,
        decision: str,
        findings: list[_FakeFinding] | None = None,
        report_id: uuid.UUID | None = None,
        validator_version: str = "test-1.0.0",
    ) -> None:
        self.decision = decision
        self.findings = findings or []
        self.report_id = report_id or uuid.uuid4()
        self.validator_version = validator_version

    def model_dump(self, mode: str | None = None) -> dict[str, Any]:
        return {
            "decision": self.decision,
            "findings": [
                {
                    "finding_id": f.finding_id,
                    "severity": f.severity,
                    "rule_id": f.rule_id,
                    "file_path": f.file_path,
                    "line": f.line,
                    "evidence": f.evidence,
                    "recommended_fix": f.recommended_fix,
                }
                for f in self.findings
            ],
            "report_id": str(self.report_id),
            "validator_version": self.validator_version,
        }


def _pass_report() -> _FakeReport:
    return _FakeReport(decision="PASS")


def _fail_report() -> _FakeReport:
    return _FakeReport(
        decision="FAIL",
        findings=[
            _FakeFinding(
                finding_id="F-001",
                severity="critical",
                rule_id="SECRET-LEAK",
                file_path="backend/app/foo.py",
                line=42,
                evidence="AWS access key hard-coded",
                recommended_fix="Move to env var or secrets manager",
            ),
            _FakeFinding(
                finding_id="F-002",
                severity="high",
                rule_id="SQL-INJECTION",
                file_path="backend/app/bar.py",
                line=10,
                evidence="f-string SQL composition",
                recommended_fix="Use parameterized queries",
            ),
        ],
    )


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def sqlite_db(sqlite_db):
    return sqlite_db


@pytest.fixture
def tenant_id() -> uuid.UUID:
    return uuid.uuid4()


@pytest.fixture
def project_id() -> uuid.UUID:
    return uuid.uuid4()


@pytest.fixture
def mock_jira_create():
    """AsyncMock matching Jira MCP create_issue signature."""
    mock = AsyncMock(
        return_value={"id": "10001", "key": "FORA-501", "self": "http://example/issue/10001"}
    )
    return mock


@pytest.fixture
def remediation_router(mock_jira_create) -> RemediationRouter:
    return RemediationRouter(jira=mock_jira_create, project_key="FORA")


@pytest.fixture
def pass_validator() -> AsyncMock:
    return AsyncMock(return_value=_pass_report())


@pytest.fixture
def fail_validator() -> AsyncMock:
    return AsyncMock(return_value=_fail_report())


# ---------------------------------------------------------------------------
# 1. PASS decision allows commit
# ---------------------------------------------------------------------------


async def test_pass_decision_allows_commit(
    sqlite_db,
    tenant_id,
    project_id,
    pass_validator,
    remediation_router,
):
    gate = MergeGate(
        validator=pass_validator,
        remediation=remediation_router,
    )

    decision = await gate.enforce_security_gate(
        commit_sha="abc123def456",
        project_id=project_id,
        tenant_id=tenant_id,
    )

    assert isinstance(decision, GateDecision)
    assert decision.allowed is True
    assert decision.decision == "PASS"
    assert decision.findings == []
    assert decision.commit_sha == "abc123def456"
    assert decision.tenant_id == tenant_id
    assert decision.project_id == project_id
    pass_validator.assert_awaited_once()


# ---------------------------------------------------------------------------
# 2. FAIL decision blocks commit
# ---------------------------------------------------------------------------


async def test_fail_decision_blocks_commit(
    sqlite_db,
    tenant_id,
    project_id,
    fail_validator,
    remediation_router,
):
    gate = MergeGate(
        validator=fail_validator,
        remediation=remediation_router,
    )

    decision = await gate.enforce_security_gate(
        commit_sha="deadbeefcafe",
        project_id=project_id,
        tenant_id=tenant_id,
    )

    assert decision.allowed is False
    assert decision.decision == "FAIL"
    assert len(decision.findings) == 2
    assert decision.findings[0].rule_id == "SECRET-LEAK"
    assert decision.findings[1].severity == "high"
    fail_validator.assert_awaited_once()


# ---------------------------------------------------------------------------
# 3. LLM is NOT called in the gate decision (NFR-042)
# ---------------------------------------------------------------------------


async def test_llm_is_not_called_during_gate_decision(
    sqlite_db,
    tenant_id,
    project_id,
    pass_validator,
    remediation_router,
):
    """NFR-042 — the gate's PASS/FAIL decision must be rules-based.

    We patch both the LiteLLM client and the in-module references the
    gate could conceivably touch. None of them should be invoked.
    """
    gate = MergeGate(
        validator=pass_validator,
        remediation=remediation_router,
    )

    with (
        patch("app.services.merge_gate.LiteLLMClient", autospec=True) as litellm_cls,
        patch("app.services.litellm_client.LiteLLMClient.chat", autospec=True) as litellm_chat,
        patch("app.services.litellm_client.LiteLLMClient.embed", autospec=True) as litellm_embed,
        patch("app.services.merge_gate.lite_llm_cost_projector") as cost_projector_factory,
    ):
        decision = await gate.enforce_security_gate(
            commit_sha="feedbeef0001",
            project_id=project_id,
            tenant_id=tenant_id,
        )

        assert decision.allowed is True
        litellm_chat.assert_not_called()
        litellm_embed.assert_not_called()
        # We never reach into LiteLLMClient at all in the deterministic path.
        assert not litellm_cls.called or litellm_cls.call_count == 0
        # The optional projector factory is only consulted when callers
        # explicitly inject a LiteLLM-backed projector — we don't, so
        # the factory must not be invoked either.
        cost_projector_factory.assert_not_called()


# ---------------------------------------------------------------------------
# 4. Audit row created on both PASS and FAIL
# ---------------------------------------------------------------------------


async def test_audit_row_created_on_pass(
    sqlite_db,
    tenant_id,
    project_id,
    pass_validator,
    remediation_router,
):
    gate = MergeGate(
        validator=pass_validator,
        remediation=remediation_router,
    )

    audit_mock = AsyncMock()
    with patch.object(gate, "_audit", new=audit_mock) as patched:
        decision = await gate.enforce_security_gate(
            commit_sha="abc11111111",
            project_id=project_id,
            tenant_id=tenant_id,
        )

        patched.assert_awaited_once()
        kwargs = patched.await_args.kwargs
        assert kwargs["actor_id"] is None
        # The decision passed to _audit is the GateDecision returned.
        passed_decision = patched.await_args.args[0]
        assert passed_decision.allowed is True
        assert passed_decision.decision == "PASS"
        assert passed_decision.report_id == decision.report_id


async def test_audit_row_created_on_fail(
    sqlite_db,
    tenant_id,
    project_id,
    fail_validator,
    remediation_router,
):
    gate = MergeGate(
        validator=fail_validator,
        remediation=remediation_router,
    )

    audit_mock = AsyncMock()
    with patch.object(gate, "_audit", new=audit_mock) as patched:
        decision = await gate.enforce_security_gate(
            commit_sha="abc22222222",
            project_id=project_id,
            tenant_id=tenant_id,
        )

        patched.assert_awaited_once()
        passed_decision = patched.await_args.args[0]
        assert passed_decision.allowed is False
        assert passed_decision.decision == "FAIL"
        assert len(passed_decision.findings) == 2
        assert decision.allowed is False


# ---------------------------------------------------------------------------
# 5. Remediation ticket created on FAIL (mock Jira MCP)
# ---------------------------------------------------------------------------


async def test_remediation_ticket_created_on_fail(
    sqlite_db,
    tenant_id,
    project_id,
    fail_validator,
    mock_jira_create,
):
    router = RemediationRouter(jira=mock_jira_create, project_key="FORA")
    gate = MergeGate(
        validator=fail_validator,
        remediation=router,
    )

    decision = await gate.enforce_security_gate(
        commit_sha="deadbeefffff",
        project_id=project_id,
        tenant_id=tenant_id,
        commit_author="alice@example.com",
    )

    assert decision.allowed is False
    mock_jira_create.assert_awaited_once()
    kwargs = mock_jira_create.await_args.kwargs
    assert kwargs["summary"] == "Security gate failure on deadbeefffff"
    assert kwargs["assignee_account_id"] == "alice@example.com"
    assert "security-gate" in kwargs["labels"]
    assert "FORA" in (kwargs["project_key"] or "")
    # Body must include both the report JSON and per-finding fixes.
    assert "SECRET-LEAK" in kwargs["description"]
    assert "Move to env var" in kwargs["description"]
    assert "ValidationReport (JSON)" in kwargs["description"]


async def test_remediation_not_called_on_pass(
    sqlite_db,
    tenant_id,
    project_id,
    pass_validator,
    mock_jira_create,
):
    router = RemediationRouter(jira=mock_jira_create, project_key="FORA")
    gate = MergeGate(
        validator=pass_validator,
        remediation=router,
    )

    decision = await gate.enforce_security_gate(
        commit_sha="abc33333333",
        project_id=project_id,
        tenant_id=tenant_id,
    )

    assert decision.allowed is True
    mock_jira_create.assert_not_called()


# ---------------------------------------------------------------------------
# 6. Pre-call admission blocks when cost cap exceeded
# ---------------------------------------------------------------------------


async def test_pre_call_admission_blocks_when_cost_cap_exceeded(
    sqlite_db,
    tenant_id,
    project_id,
    pass_validator,
    remediation_router,
):
    """A 50-char SHA mapped through the default projector would yield
    well under $0.01, so we explicitly inject a cost projector that
    returns a value above the cap."""
    cap = 0.05
    gate = MergeGate(
        validator=pass_validator,
        remediation=remediation_router,
        cost_projector=lambda commit_sha: 999.0,  # way above any sane cap
        per_commit_cost_cap_usd=cap,
    )

    decision = await gate.enforce_security_gate(
        commit_sha="feedfeedfeed",
        project_id=project_id,
        tenant_id=tenant_id,
    )

    assert decision.allowed is False
    assert decision.decision == "ADMISSION_DENIED"
    assert "exceeds per_commit_cap" in decision.reason
    # Crucially, the validator must NOT have been invoked.
    pass_validator.assert_not_called()


async def test_pre_call_admission_allows_when_under_cap(
    sqlite_db,
    tenant_id,
    project_id,
    pass_validator,
    remediation_router,
):
    gate = MergeGate(
        validator=pass_validator,
        remediation=remediation_router,
        cost_projector=lambda commit_sha: 0.001,
        per_commit_cost_cap_usd=1.0,
    )

    decision = await gate.enforce_security_gate(
        commit_sha="abc44444444",
        project_id=project_id,
        tenant_id=tenant_id,
    )

    assert decision.allowed is True
    pass_validator.assert_awaited_once()


# ---------------------------------------------------------------------------
# 7. Webhook integration: mock GitHub payload, verify 200 / 403 behavior.
# ---------------------------------------------------------------------------


@pytest.fixture
def webhook_app(pass_validator, remediation_router) -> FastAPI:
    """Stand up a tiny FastAPI app wired to the webhook router."""
    from app.api.v1.webhooks import get_gate
    from app.api.v1.webhooks import router as webhooks_router

    gate = MergeGate(
        validator=pass_validator,
        remediation=remediation_router,
    )

    app = FastAPI()
    app.include_router(webhooks_router)
    app.dependency_overrides[get_gate] = lambda: gate
    return app


@pytest_asyncio.fixture
async def webhook_client(webhook_app) -> AsyncClient:
    transport = ASGITransport(app=webhook_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


def _gh_payload(
    *,
    commit_sha: str = "abcd1234ef567890",
    project_id: str | None = None,
    author_login: str = "alice",
) -> bytes:
    body: dict[str, Any] = {
        "repository": "forge-ai",
        "commit_sha": commit_sha,
        "ref": "refs/heads/main",
    }
    if project_id:
        body["project_id"] = project_id
    body["author_login"] = author_login
    return json.dumps(body).encode("utf-8")


async def test_webhook_returns_200_on_pass(sqlite_db, webhook_client, project_id, pass_validator):
    payload = _gh_payload(commit_sha="good1234567890", project_id=str(project_id))
    response = await webhook_client.post("/webhooks/github/pre-commit", content=payload)

    assert response.status_code == 200
    body = response.json()
    assert body["allowed"] is True
    assert body["decision"] == "PASS"
    assert body["commit_sha"] == "good1234567890"
    assert body["report_id"]
    pass_validator.assert_awaited_once()


async def test_webhook_lock_path_returns_403_on_fail(
    sqlite_db, project_id, fail_validator, remediation_router
):
    """The ``/lock`` variant surfaces the block via HTTP status code,
    which is what some GitHub App integrations prefer."""
    from app.api.v1.webhooks import get_gate
    from app.api.v1.webhooks import router as webhooks_router

    gate = MergeGate(
        validator=fail_validator,
        remediation=remediation_router,
    )
    app = FastAPI()
    app.include_router(webhooks_router)
    app.dependency_overrides[get_gate] = lambda: gate

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        payload = _gh_payload(commit_sha="badbadbad1234", project_id=str(project_id))
        response = await client.post("/webhooks/github/pre-commit/lock", content=payload)

    assert response.status_code == 403
    body = response.json()["detail"]
    assert body["allowed"] is False
    assert body["decision"] == "FAIL"
    assert body["findings_count"] == 2


async def test_webhook_signature_verification_when_secret_set(
    sqlite_db, webhook_app, project_id, pass_validator, monkeypatch
):
    """With a non-empty ``github_webhook_secret``, an unsigned request is
    rejected with 401 — the gate never runs."""
    monkeypatch.setattr(settings, "github_webhook_secret", "shh-its-a-secret")

    transport = ASGITransport(app=webhook_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        payload = _gh_payload(commit_sha="signed12345678", project_id=str(project_id))
        response = await client.post("/webhooks/github/pre-commit", content=payload)

    assert response.status_code == 401
    pass_validator.assert_not_called()


async def test_webhook_signature_passes_when_header_matches(
    sqlite_db, webhook_app, project_id, pass_validator, monkeypatch
):
    monkeypatch.setattr(settings, "github_webhook_secret", "shh-its-a-secret")

    payload = _gh_payload(commit_sha="signed12345678", project_id=str(project_id))
    digest = hmac.new(b"shh-its-a-secret", payload, hashlib.sha256).hexdigest()
    headers = {"X-Hub-Signature-256": f"sha256={digest}"}

    transport = ASGITransport(app=webhook_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/webhooks/github/pre-commit", content=payload, headers=headers
        )

    assert response.status_code == 200
    assert response.json()["allowed"] is True


# ---------------------------------------------------------------------------
# Deterministic contract: report_id round-trips on FAIL.
# ---------------------------------------------------------------------------


async def test_gate_decision_carries_report_id_on_fail(
    sqlite_db,
    tenant_id,
    project_id,
    fail_validator,
    remediation_router,
):
    gate = MergeGate(
        validator=fail_validator,
        remediation=remediation_router,
    )
    decision = await gate.enforce_security_gate(
        commit_sha="roundtrip12345",
        project_id=project_id,
        tenant_id=tenant_id,
    )

    assert decision.allowed is False
    expected_report_id = fail_validator.return_value.report_id
    assert decision.report_id == expected_report_id


# ---------------------------------------------------------------------------
# Real-DB audit assertion — end-to-end (F-005 row written on PASS / FAIL).
# ---------------------------------------------------------------------------


async def test_audit_row_persisted_on_pass_and_fail(
    sqlite_db,
    tenant_id,
    project_id,
    pass_validator,
    fail_validator,
    remediation_router,
):
    """Verify the F-005 audit row lands in the DB for both outcomes.

    This complements the unit-level ``_audit`` mock tests above and
    confirms the wired ``audit_service.record`` path actually writes.
    """
    from sqlalchemy import select

    from app.db.models.audit import AuditEvent
    from app.db.session import get_session_factory

    factory = get_session_factory()

    # PASS branch.
    gate_pass = MergeGate(
        validator=pass_validator,
        remediation=remediation_router,
    )
    decision_pass = await gate_pass.enforce_security_gate(
        commit_sha="auditpass0001",
        project_id=project_id,
        tenant_id=tenant_id,
        actor_id=uuid.uuid4(),
    )
    assert decision_pass.allowed is True

    # FAIL branch.
    gate_fail = MergeGate(
        validator=fail_validator,
        remediation=remediation_router,
    )
    decision_fail = await gate_fail.enforce_security_gate(
        commit_sha="auditfail0001",
        project_id=project_id,
        tenant_id=tenant_id,
        actor_id=uuid.uuid4(),
    )
    assert decision_fail.allowed is False

    async with factory() as session:
        rows = (
            (
                await session.execute(
                    select(AuditEvent).where(
                        AuditEvent.action == "merge_gate.evaluate",
                        AuditEvent.target_type == "commit",
                    )
                )
            )
            .scalars()
            .all()
        )

    target_ids = {r.target_id for r in rows}
    assert "auditpass0001" in target_ids
    assert "auditfail0001" in target_ids
    by_target = {r.target_id: r for r in rows}
    assert by_target["auditpass0001"].payload["allowed"] is True
    assert by_target["auditfail0001"].payload["allowed"] is False
    assert by_target["auditfail0001"].payload["findings_count"] == 2
