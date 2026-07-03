"""HTTP-route test for ``POST /api/v1/workflows/runs/{run_id}/resume``.

Step 66 production hardening: the existing executor unit test
(``tests/test_workflow_executor.py::test_executor_pauses_on_approval_and_resumes_on_grant``)
exercises ``WorkflowExecutor.resume`` directly. This test exercises the
HTTP route that operators actually hit. It's a focused contract test:

  * The route calls into ``WorkflowExecutor.resume`` with the right args.
  * On success: returns 200 with the refreshed ``WorkflowRunRead``.
  * On ``WorkflowApprovalResumeRequired`` (run re-paused at a subsequent
    gate): the route swallows the exception per its contract (line 625-627)
    and still returns 200.
  * The ``@audit`` decorator emits an ``audit.event`` log line with the
    expected action and target_type.

We mock ``WorkflowExecutor.resume`` and ``WorkflowService.get_run`` at the
class-method level so the patched attributes don't drift across tests.
The executor's behavior is owned by the unit test in
``tests/test_workflow_executor.py``.
"""

from __future__ import annotations

import uuid
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_paused_run(
    tenant_id: uuid.UUID | None = None,
    run_id: uuid.UUID | None = None,
    approval_id: uuid.UUID | None = None,
) -> Any:
    """Build a stub WorkflowRun-like object shaped like what
    ``WorkflowService.get_run`` returns for a WAITING_APPROVAL row.

    All fields required by ``WorkflowRunRead`` Pydantic validation are
    set explicitly so MagicMock auto-attributes don't leak through.
    """
    from app.db.models.workflow import WorkflowRunStatus

    rid = run_id or uuid.uuid4()
    tid = tenant_id or uuid.uuid4()
    aid = approval_id or uuid.uuid4()
    triggered_by = uuid.uuid4()

    run = MagicMock()
    run.id = rid
    run.tenant_id = tid
    run.project_id = uuid.uuid4()
    run.workflow_id = uuid.uuid4()
    run.status = WorkflowRunStatus.WAITING_APPROVAL
    run.current_step_id = "a1"
    run.triggered_by = triggered_by
    run.started_at = None
    run.finished_at = None
    run.error = None
    run.state = {
        "stepResults": {
            "a1": {
                "status": "waiting_approval",
                "approval_id": str(aid),
            }
        }
    }
    return run, rid, tid, aid


def _make_succeeded_run(rid: uuid.UUID, tid: uuid.UUID) -> Any:
    """Stub run in terminal SUCCEEDED state — what get_run returns after
    resume() advances the DAG past the approval gate."""
    from datetime import datetime, timezone

    from app.db.models.workflow import WorkflowRunStatus

    run = MagicMock()
    run.id = rid
    run.tenant_id = tid
    run.project_id = uuid.uuid4()
    run.workflow_id = uuid.uuid4()
    run.status = WorkflowRunStatus.SUCCEEDED
    run.current_step_id = None
    run.triggered_by = uuid.uuid4()
    run.started_at = datetime.now(timezone.utc)
    run.finished_at = datetime.now(timezone.utc)
    run.error = None
    run.state = {
        "stepResults": {
            "a1": {"status": "succeeded", "approval_id": str(uuid.uuid4())},
            "c2": {"status": "succeeded"},
        }
    }
    return run


def _client_with_principal(
    tenant_id: uuid.UUID | None = None,
    user_id: uuid.UUID | None = None,
) -> TestClient:
    """Build a TestClient with the workflows router mounted and deps
    overridden. Mirrors the ``_client`` helper in ``test_explainability.py``
    but skips the ``audit_service`` patch — ``workflows.py`` uses the
    ``@audit()`` decorator (logs via ``logger.info``), not
    ``audit_service.record()``.
    """
    from app.api import deps as deps_mod
    from app.api.v1 import workflows as workflows_router
    from app.core.security import AuthenticatedPrincipal

    app = FastAPI()
    app.include_router(workflows_router.router, prefix="/api/v1")

    tid = tenant_id or uuid.uuid4()
    uid = user_id or uuid.uuid4()

    async def _override_principal() -> Any:
        return AuthenticatedPrincipal(
            user_id=str(uid),
            email="tester@example.com",
            tenant_id=str(tid),
            project_id=str(uuid.uuid4()),
            roles=["developer"],
            raw_claims={"forge.permissions": ["workflows:run"]},
        )

    async def _override_db() -> Any:
        # WorkflowService.get_run is patched at the class level below;
        # we never reach the DB. Yield a MagicMock so the dep yields.
        yield MagicMock()

    app.dependency_overrides[deps_mod.get_current_principal] = _override_principal
    app.dependency_overrides[deps_mod.db_session] = _override_db

    return TestClient(app)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_resume_returns_200_when_executor_succeeds(capsys: pytest.CaptureFixture[str]) -> None:
    """Happy path: executor.resume() returns cleanly → route returns 200
    with the refreshed run, and audit log line is emitted."""
    tenant_id = uuid.uuid4()
    user_id = uuid.uuid4()
    client = _client_with_principal(tenant_id=tenant_id, user_id=user_id)
    paused_run, run_id, _tid, _aid = _make_paused_run(tenant_id=tenant_id)
    succeeded_run = _make_succeeded_run(run_id, tenant_id)

    # Make get_run return the paused run once, then the succeeded run.
    get_run_mock = AsyncMock(side_effect=[paused_run, succeeded_run])
    resume_mock = AsyncMock(return_value=succeeded_run)

    with patch("app.services.workflow_service.WorkflowService.get_run", get_run_mock), patch(
        "app.services.workflow_executor.get_executor"
    ) as exec_factory:
        exec_factory.return_value.resume = resume_mock

        response = client.post(f"/api/v1/workflows/runs/{run_id}/resume")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "succeeded"

    # Verify executor.resume was called with the right args.
    # tenant_id comes from the principal as a string (the JWT claim
    # type); run_id and approval_id are UUIDs.
    resume_mock.assert_awaited_once()
    kwargs = resume_mock.await_args.kwargs
    assert kwargs["tenant_id"] == str(tenant_id)
    assert kwargs["run_id"] == run_id
    assert kwargs["approval_id"] == uuid.UUID(str(_aid))
    assert kwargs["decision"] == "granted"

    # @audit decorator emits audit.event via structlog → stdout.
    captured = capsys.readouterr()
    assert "audit.event" in captured.out
    assert "workflows.runs.resume" in captured.out
    assert "outcome=success" in captured.out
    assert str(tenant_id) in captured.out
    assert str(user_id) in captured.out


def test_resume_returns_200_when_run_re_pauses(capsys: pytest.CaptureFixture[str]) -> None:
    """Re-paused path: executor.resume() advances past the current
    approval but raises ``WorkflowApprovalResumeRequired`` at a
    subsequent gate. The route swallows the exception (per its
    documented contract) and returns 200 with the refreshed run."""
    from app.db.models.workflow import WorkflowRunStatus
    from app.services.workflow_executor import WorkflowApprovalResumeRequired

    tenant_id = uuid.uuid4()
    client = _client_with_principal(tenant_id=tenant_id)
    paused_run, run_id, _tid, _aid = _make_paused_run(tenant_id=tenant_id)

    re_paused_run = MagicMock()
    re_paused_run.id = run_id
    re_paused_run.tenant_id = tenant_id
    re_paused_run.project_id = uuid.uuid4()
    re_paused_run.workflow_id = uuid.uuid4()
    re_paused_run.status = WorkflowRunStatus.WAITING_APPROVAL
    re_paused_run.current_step_id = "a2"
    re_paused_run.triggered_by = uuid.uuid4()
    re_paused_run.started_at = None
    re_paused_run.finished_at = None
    re_paused_run.error = None
    re_paused_run.state = {"stepResults": {"a2": {"status": "waiting_approval"}}}

    get_run_mock = AsyncMock(side_effect=[paused_run, re_paused_run])
    resume_mock = AsyncMock(
        side_effect=WorkflowApprovalResumeRequired(
            run_id=run_id, approval_id=uuid.uuid4(), step_id="a2"
        )
    )

    with patch("app.services.workflow_service.WorkflowService.get_run", get_run_mock), patch(
        "app.services.workflow_executor.get_executor"
    ) as exec_factory:
        exec_factory.return_value.resume = resume_mock

        response = client.post(f"/api/v1/workflows/runs/{run_id}/resume")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "waiting_approval"

    # Outcome is still "success" — the route swallowed the exception by design.
    captured = capsys.readouterr()
    assert "audit.event" in captured.out
    assert "outcome=success" in captured.out


def test_resume_returns_409_when_run_not_waiting() -> None:
    """Idempotency check: if the run is already SUCCEEDED / FAILED /
    CANCELLED, the route refuses to resume it (status 409)."""
    from app.db.models.workflow import WorkflowRunStatus

    tenant_id = uuid.uuid4()
    client = _client_with_principal(tenant_id=tenant_id)
    terminal_run, run_id, _tid, _aid = _make_paused_run(tenant_id=tenant_id)
    terminal_run.status = WorkflowRunStatus.SUCCEEDED

    get_run_mock = AsyncMock(return_value=terminal_run)

    with patch("app.services.workflow_service.WorkflowService.get_run", get_run_mock):
        response = client.post(f"/api/v1/workflows/runs/{run_id}/resume")

    assert response.status_code == 409
    body = response.json()
    detail = body.get("detail")
    assert detail and detail.get("error") == "not_waiting_approval"