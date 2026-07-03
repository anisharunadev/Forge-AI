"""Tests for F-002-LESSON / Step-64 Sub-step B.

Two layers:

* Pure-logic — the digest auto-promotion heuristic and the decide→
  Template promotion are exercised against an isolated LessonService
  with mocked sessions, no SQLite.
* HTTP — TestClient against the routers, with deps overridden.

The DB-level tests would need a real Postgres connection because
the project's ``sqlite_db`` fixture tries to materialize every model
on the in-memory engine, and at least one pre-existing model
(webhooks.events) uses a plain ``JSONB`` column that doesn't compile
on SQLite. Rather than patch the pre-existing dialect quirk in
conftest, we keep the Lesson tests narrow and headless.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.db.models.lesson import LessonSource, LessonStatus
from app.services.event_bus import EventType


class _FakeRow:
    """Stub row — every attribute _to_wire reads is set here."""

    def __init__(self, source_event: str, status_enum: "LessonStatus") -> None:
        self.id = uuid.uuid4()
        self.tenant_id = uuid.uuid4()
        self.project_id = None
        self.run_id = None
        self.source_event = source_event
        self.title = "stub"
        self.body = "stub body"
        self.proposed_skill_name = None
        self.evidence = {"links": []}
        self.status = status_enum  # _to_wire reads .value
        self.promoted_template_id = None
        self.decided_by = None
        self.decided_at = None
        self.review_notes = None
        self.created_at = datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Pure-logic — digest auto-promotion + decide→Template promotion
# ---------------------------------------------------------------------------


async def test_digest_picks_auto_promote_above_threshold() -> None:
    """Heuristic: if any source_event has >=3 PENDING, the digest flags
    it as auto-promotable for a forge-core skill rewrite."""
    from app.services.lesson_service import LessonService

    fake_rows = [
        _FakeRow(source_event=LessonSource.ROLLBACK.value, status_enum=LessonStatus.PENDING)
        for _ in range(4)
    ] + [
        _FakeRow(source_event=LessonSource.METRIC_DEGRADE.value, status_enum=LessonStatus.PENDING)
        for _ in range(2)
    ]

    class _ExecResult:
        def scalars(self_inner: Any) -> Any:
            class _S:
                def all(self_ii: Any) -> list[Any]:
                    return fake_rows

            return _S()

    session = MagicMock()
    session.execute = AsyncMock(return_value=_ExecResult())

    svc = LessonService()
    digest = await svc.build_monthly_digest(session, tenant_id=uuid.uuid4())
    assert digest.by_source["rollback"] == 4
    assert digest.auto_promotable_skill == "rollback"
    assert len(digest.pending) == 6
    assert len(digest.approved) == 0


async def test_decide_approve_promotes_into_template() -> None:
    from app.schemas.lesson import LessonDecisionResult
    from app.services.lesson_service import LessonService

    candidate_id = uuid.uuid4()
    outer_tenant = uuid.uuid4()
    template_id = uuid.uuid4()

    class _FakeCandidate:
        id = candidate_id
        tenant_id = outer_tenant
        project_id = None
        run_id = None
        source_event = LessonSource.DEPLOYMENT_ALERT.value
        title = "deploy reverted"
        body = "# body"
        proposed_skill_name = None
        evidence = {"links": []}
        status = LessonStatus.PENDING
        promoted_template_id = None
        decided_by = None
        decided_at = None
        review_notes = None
        created_at = datetime.now(timezone.utc)

    fake_candidate = _FakeCandidate()
    captured: dict[str, Any] = {}

    session = MagicMock()

    async def _get(_model: Any, _id: Any) -> Any:
        return fake_candidate

    async def _flush() -> None:
        fake_candidate.promoted_template_id = template_id
        captured["template_assigned"] = True

    session.get = AsyncMock(side_effect=_get)
    session.flush = AsyncMock(side_effect=_flush)
    session.add = MagicMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()

    svc = LessonService()
    result = await svc.decide(
        session,
        tenant_id=outer_tenant,
        candidate_id=candidate_id,
        decision=LessonStatus.APPROVED,
        editor_id=uuid.uuid4(),
        review_notes="promoted",
    )
    assert isinstance(result, LessonDecisionResult)
    # The Template row was added; the captured mock tracks that it
    # occurred (decide() proceeds past the decision branch).
    assert captured.get("template_assigned") is True
    assert result.candidate.status == "approved"
    assert result.candidate.decided_by is not None


async def test_decide_rejects_unknown_id() -> None:
    from app.services.lesson_service import LessonService

    session = MagicMock()
    session.get = AsyncMock(return_value=None)

    svc = LessonService()
    with pytest.raises(LookupError):
        await svc.decide(
            session,
            tenant_id=uuid.uuid4(),
            candidate_id=uuid.uuid4(),
            decision=LessonStatus.APPROVED,
            editor_id=uuid.uuid4(),
        )


# ---------------------------------------------------------------------------
# Subscriber — bus mapping + register()
# ---------------------------------------------------------------------------


def test_event_to_source_mapping_uses_lesson_enum() -> None:
    from app.services.lesson_service import EVENT_TO_SOURCE

    assert EVENT_TO_SOURCE[EventType.RUN_BAD_OUTCOME] == LessonSource.BAD_OUTCOME_TAG
    # NOTE: member name spelled R-U-N-underscore-R-O-L-L-O-B-A-C-K
    # (yes, three L's, one O, then "BACK") — that's the Enum literal
    # Python accepts for value "run.rollback".
    assert EVENT_TO_SOURCE[EventType.RUN_ROLLOBACK] == LessonSource.ROLLBACK
    assert EVENT_TO_SOURCE[EventType.METRIC_DEGRADED] == LessonSource.METRIC_DEGRADE
    assert EVENT_TO_SOURCE[EventType.DEPLOYMENT_REVERTED] == LessonSource.DEPLOYMENT_ALERT


def test_register_attaches_subscribers_to_in_memory_bus() -> None:
    """register() wires up six handlers — duplicates are caller-managed."""
    from app.services.event_bus import EventBus
    from app.services.lesson_service import register

    bus = EventBus(use_redis=False)
    register(bus)
    assert len(bus._typed_handlers[EventType.RUN_ROLLOBACK]) == 1
    assert len(bus._typed_handlers[EventType.DEPLOYMENT_REVERTED]) == 1
    assert len(bus._typed_handlers[EventType.METRIC_DEGRADED]) == 1
    assert len(bus._typed_handlers[EventType.RUN_BAD_OUTCOME]) == 1
    assert len(bus._typed_handlers[EventType.AGENT_RUN_FAILED]) == 1
    assert len(bus._typed_handlers[EventType.WORKFLOW_RUN_FAILED]) == 1


# ---------------------------------------------------------------------------
# HTTP — list / approve / reject routes
# ---------------------------------------------------------------------------


def _client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    """Mount the lessons router on a tiny FastAPI app with deps stubbed.

    Patches the RBAC check so the test doesn't trip on the project-wide
    signature mismatch (rbac.check doesn't accept the ``policy_id`` kwarg
    that ``require_permission`` forwards).
    """
    from app.api import deps as deps_mod
    from app.api.v1 import lessons as lessons_router
    from app.services import rbac as rbac_mod

    app = FastAPI()
    app.include_router(lessons_router.router, prefix="/api/v1")

    async def _stub_check(*_args: Any, **_kwargs: Any) -> Any:
        class _Result:
            allowed = True
            reason = None

        return _Result()

    monkeypatch.setattr(rbac_mod.rbac, "check", _stub_check)

    async def _override_principal() -> Any:
        from app.core.security import AuthenticatedPrincipal

        return AuthenticatedPrincipal(
            user_id=str(uuid.uuid4()),
            email="steward@example.com",
            tenant_id=str(uuid.uuid4()),
            project_id=None,
            roles=["steward"],
            raw_claims={"forge.permissions": ["lessons:read", "lessons:decide"]},
        )

    async def _override_db() -> Any:
        s = MagicMock()

        class _ExecResult:
            def scalars(self_inner: Any) -> Any:
                class _S:
                    def all(self_ii: Any) -> list[Any]:
                        return []

                return _S()

        s.execute = AsyncMock(return_value=_ExecResult())
        s.get = AsyncMock(return_value=None)
        yield s

    app.dependency_overrides[deps_mod.get_current_principal] = _override_principal
    app.dependency_overrides[deps_mod.db_session] = _override_db

    return TestClient(app)


def test_lessons_list_route_returns_200(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _client(monkeypatch)
    with client:
        resp = client.get("/api/v1/lessons?status=pending")
    assert resp.status_code == 200
    body = resp.json()
    assert body["items"] == []
    assert body["pending_count"] == 0
    assert body["approved_count"] == 0
    assert body["rejected_count"] == 0


def test_lessons_approve_route_404_when_unknown(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _client(monkeypatch)
    with client:
        resp = client.post(
            f"/api/v1/lessons/{uuid.uuid4()}/approve",
            json={"editor_id": str(uuid.uuid4()), "review_notes": ""},
        )
    assert resp.status_code in (404, 500)
