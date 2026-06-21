"""TestOnboardingWizard — start, advance, cancel, persistence."""

from __future__ import annotations

import uuid

import pytest

from app.services.project_onboarding.wizard import (
    STEP_ORDER,
    WizardError,
    onboarding_wizard,
)


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

    for idx, step in enumerate(STEP_ORDER[:-1]):
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
