"""TestOnboardingWizard — start, advance, cancel, persistence."""

from __future__ import annotations

import uuid

import pytest

from app.services.event_bus import EventType
from app.services.project_onboarding.sample_data import (
    SAMPLE_KINDS,
    load_sample_data,
)
from app.services.project_onboarding.wizard import (
    STEP_ORDER,
    WizardError,
    onboarding_wizard,
)


def _advance_body(step_input, *, mark_complete=True):
    """Build the duck-typed OnboardingAdvanceRequest the wizard expects."""
    return type(
        "_",
        (),
        {"step_input": step_input, "mark_complete": mark_complete},
    )()


async def test_start_creates_active_session(sqlite_db):
    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    user_id = str(uuid.uuid4())

    state = await onboarding_wizard.start(
        tenant_id=tenant_id, project_id=project_id, user_id=user_id
    )
    assert state.status.value == "active"
    assert state.current_step == STEP_ORDER[0]
    assert len(state.steps) == 1
    assert state.steps[0].step_name == STEP_ORDER[0]


async def test_advance_walks_full_flow(sqlite_db):
    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    user_id = str(uuid.uuid4())

    state = await onboarding_wizard.start(
        tenant_id=tenant_id, project_id=project_id, user_id=user_id
    )
    sid = state.id

    for idx, _step in enumerate(STEP_ORDER[:-1]):
        state = await onboarding_wizard.advance(
            sid,
            type(
                "_",
                (),
                {
                    "step_input": {"answer": idx},
                    "mark_complete": True,
                },
            )(),
        )
        assert state.current_step == STEP_ORDER[idx + 1]

    # Last advance completes the session.
    state = await onboarding_wizard.advance(
        sid,
        type(
            "_",
            (),
            {"step_input": {"answer": "done"}, "mark_complete": True},
        )(),
    )
    assert state.status.value == "completed"
    assert state.completed_at is not None


async def test_cancel_marks_session_cancelled(sqlite_db):
    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    user_id = str(uuid.uuid4())

    state = await onboarding_wizard.start(
        tenant_id=tenant_id, project_id=project_id, user_id=user_id
    )
    cancelled = await onboarding_wizard.cancel(state.id)
    assert cancelled.status.value == "cancelled"


async def test_advance_after_complete_raises(sqlite_db):
    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    user_id = str(uuid.uuid4())

    state = await onboarding_wizard.start(
        tenant_id=tenant_id, project_id=project_id, user_id=user_id
    )
    sid = state.id
    # Mark the only step as failed -> ends flow.
    state = await onboarding_wizard.advance(
        sid,
        type(
            "_",
            (),
            {"step_input": {"x": 1}, "mark_complete": False},
        )(),
    )
    assert state.status.value == "completed"

    with pytest.raises(WizardError):
        await onboarding_wizard.advance(
            sid,
            type(
                "_",
                (),
                {"step_input": {}, "mark_complete": True},
            )(),
        )


async def test_persistence_across_get(sqlite_db):
    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    user_id = str(uuid.uuid4())

    state = await onboarding_wizard.start(
        tenant_id=tenant_id, project_id=project_id, user_id=user_id
    )
    state = await onboarding_wizard.advance(
        state.id,
        type(
            "_",
            (),
            {"step_input": {"repos": ["forge/forge-ai"]}, "mark_complete": True},
        )(),
    )

    fetched = await onboarding_wizard.get_state(state.id)
    assert fetched.current_step == STEP_ORDER[1]
    assert fetched.state.get(STEP_ORDER[0]) == {"repos": ["forge/forge-ai"]}


# ---------------------------------------------------------------------------
# M9 T-A2 (a) — perf floor: full bootstrap completes well under 30 min (G5)
# ---------------------------------------------------------------------------


async def test_full_bootstrap_completes_under_30_min_floor(sqlite_db, monkeypatch):
    """Fast-forward the wizard through all 6 advance calls and assert the
    wall-clock delta between session start and completion is < 30 min.

    The 30-min ceiling is the M9 acceptance criterion (AC-5) for a new
    internal pilot; the wizard itself does no LLM work so this is a floor
    that must hold trivially — it guards against a regression that would
    block completion or stall a transition.
    """
    # Mock the bus so no real Redis fan-out / side effect happens when the
    # final step triggers Day-One Bootstrap.
    published: list = []

    async def _fake_publish(event_type, payload, *a, **k):
        published.append((event_type, payload))

    import app.services.event_bus as event_bus_mod

    monkeypatch.setattr(event_bus_mod.bus, "publish", _fake_publish)

    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    user_id = str(uuid.uuid4())

    state = await onboarding_wizard.start(
        tenant_id=tenant_id, project_id=project_id, user_id=user_id
    )
    sid = state.id
    started_at = state.created_at
    assert started_at is not None

    # Fast-forward through all 6 steps (one advance per step; the last
    # advance completes the session).
    for idx in range(len(STEP_ORDER)):
        state = await onboarding_wizard.advance(sid, _advance_body({"answer": idx}))

    assert state.status.value == "completed"
    completed_at = state.completed_at
    assert completed_at is not None

    elapsed = (completed_at - started_at).total_seconds()
    assert 0 <= elapsed < 1800, f"bootstrap wall-clock {elapsed}s exceeded 30 min floor"


# ---------------------------------------------------------------------------
# M9 T-A2 (b) — sample data loaded on completion (G2)
# ---------------------------------------------------------------------------


class _CapturingBus:
    """Minimal async bus stand-in that records every publish call."""

    def __init__(self) -> None:
        self.events: list = []

    async def publish(self, event_type, payload, tenant_id, project_id, actor_id=None):
        self.events.append((event_type, payload))


async def test_sample_data_loaded_on_completion(sqlite_db):
    """On bootstrap completion the sample seed loads 1 connector + 1 ADR +
    1 idea and emits BOOTSTRAP_SAMPLE_DATA_LOADED with the expected payload.

    This exercises the exact on-completion callback body
    (``load_sample_data``) that ``DayOneBootstrapService.load_baseline``
    invokes post-commit. The full wizard→bootstrap chain is not driven here
    because the bootstrap service pulls in the optional agent runtime
    (LangGraph) which is absent in the sandbox; the callback itself is
    LangGraph-free and is the unit under test.
    """
    from sqlalchemy import func, select

    from app.db.models.artifact import Artifact
    from app.db.models.connector import Connector
    from app.db.models.ideation import Idea
    from app.db.session import get_session_factory

    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    run_id = str(uuid.uuid4())
    actor_id = str(uuid.uuid4())

    bus = _CapturingBus()
    summary = await load_sample_data(
        tenant_id=tenant_id,
        project_id=project_id,
        run_id=run_id,
        actor_id=actor_id,
        bus=bus,
    )
    assert summary["loaded"] == SAMPLE_KINDS

    # Event published exactly once with the expected payload shape.
    assert len(bus.events) == 1
    event_type, payload = bus.events[0]
    assert event_type == EventType.BOOTSTRAP_SAMPLE_DATA_LOADED
    assert payload["tenant_id"] == tenant_id
    assert payload["project_id"] == project_id
    assert payload["run_id"] == run_id
    assert payload["sample_kinds"] == ["connector", "adr", "idea"]

    # Exactly 3 sample rows landed in the new tenant/project.
    factory = get_session_factory()
    async with factory() as session:
        conn_count = (
            await session.execute(
                select(func.count())
                .select_from(Connector)
                .where(
                    Connector.tenant_id == uuid.UUID(tenant_id),
                    Connector.project_id == uuid.UUID(project_id),
                )
            )
        ).scalar()
        adr_count = (
            await session.execute(
                select(func.count())
                .select_from(Artifact)
                .where(
                    Artifact.tenant_id == uuid.UUID(tenant_id),
                    Artifact.project_id == uuid.UUID(project_id),
                    Artifact.type == "adr",
                )
            )
        ).scalar()
        idea_count = (
            await session.execute(
                select(func.count())
                .select_from(Idea)
                .where(
                    Idea.tenant_id == uuid.UUID(tenant_id),
                    Idea.project_id == uuid.UUID(project_id),
                )
            )
        ).scalar()

    assert conn_count == 1
    assert adr_count == 1
    assert idea_count == 1

    # Idempotent: a rerun (bootstrap re-invocation) inserts nothing new.
    summary2 = await load_sample_data(
        tenant_id=tenant_id,
        project_id=project_id,
        run_id=run_id,
        actor_id=actor_id,
        bus=bus,
    )
    assert summary2["skipped"] == SAMPLE_KINDS
    async with factory() as session:
        conn_count2 = (
            await session.execute(select(func.count()).select_from(Connector))
        ).scalar()
    assert conn_count2 == 1
