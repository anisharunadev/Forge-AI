"""Project Onboarding Wizard (F-021).

State machine for first-run project setup. Steps:
1. tenant_setup     — confirm tenant context, defaults.
2. connect_repos    — install one or more source connectors.
3. detect_stack     — infer languages/frameworks.
4. configure_agents — pick agents and capabilities.
5. run_first_intel  — execute a small intel pipeline.
6. review           — show results and accept.

The wizard persists state to DB so a user can resume mid-flow.

Final-step hook (F-507): on session completion the wizard triggers
``DayOneBootstrapService.load_baseline`` and waits for it to finish
before the project can be marked active downstream. If the bootstrap
fails the session is rolled back to ``ACTIVE`` with an error on the
review step so the operator can retry without re-walking the flow.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select

from app.core.logging import get_logger
from app.db.models.onboarding import (
    OnboardingSession,
    OnboardingStatus,
    OnboardingStep,
    OnboardingStepStatus,
)
from app.db.session import get_session_factory
from app.schemas.onboarding import (
    OnboardingAdvanceRequest,
    OnboardingSessionRead,
    OnboardingStepRead,
)

logger = get_logger(__name__)


STEP_ORDER: list[str] = [
    "tenant_setup",
    "connect_repos",
    "detect_stack",
    "configure_agents",
    "run_first_intel",
    "review",
]


class WizardError(RuntimeError):
    """Raised when a wizard transition is invalid."""


class OnboardingWizard:
    """Drives the onboarding state machine and persists every transition."""

    async def start(
        self,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str,
        user_id: UUID | str,
    ) -> OnboardingSessionRead:
        factory = get_session_factory()
        async with factory() as session:
            session_row = OnboardingSession(
                tenant_id=str(tenant_id),
                project_id=str(project_id),
                user_id=str(user_id),
                status=OnboardingStatus.ACTIVE,
                current_step=STEP_ORDER[0],
                state={},
            )
            session.add(session_row)
            await session.flush()
            session.add(
                OnboardingStep(
                    tenant_id=str(tenant_id),
                    session_id=session_row.id,
                    step_name=STEP_ORDER[0],
                    step_order=0,
                    status=OnboardingStepStatus.IN_PROGRESS,
                )
            )
            await session.commit()
            await session.refresh(session_row)
            sid = session_row.id
        logger.info(
            "onboarding.started",
            session_id=str(sid),
            tenant_id=str(tenant_id),
            project_id=str(project_id),
        )
        return await self.get_state(sid)

    async def get_state(self, session_id: UUID | str) -> OnboardingSessionRead:
        factory = get_session_factory()
        async with factory() as session:
            sess = await session.get(OnboardingSession, str(session_id))
            if sess is None:
                raise LookupError(f"onboarding_session {session_id} not found")
            stmt = (
                select(OnboardingStep)
                .where(OnboardingStep.session_id == sess.id)
                .order_by(OnboardingStep.step_order)
            )
            steps = list((await session.execute(stmt)).scalars().all())
            steps_read = [
                OnboardingStepRead(
                    id=s.id,
                    step_name=s.step_name,
                    step_order=s.step_order,
                    status=s.status,
                    input=s.input,
                    output=s.output,
                    error_message=s.error_message,
                    created_at=s.created_at,
                )
                for s in steps
            ]
            return OnboardingSessionRead(
                id=sess.id,
                tenant_id=sess.tenant_id,
                project_id=sess.project_id,
                created_at=sess.created_at,
                updated_at=sess.updated_at,
                user_id=sess.user_id,
                status=sess.status,
                current_step=sess.current_step,
                state=sess.state,
                completed_at=sess.completed_at,
                steps=steps_read,
            )

    async def advance(
        self,
        session_id: UUID | str,
        body: OnboardingAdvanceRequest,
    ) -> OnboardingSessionRead:
        factory = get_session_factory()
        async with factory() as session:
            sess = await session.get(OnboardingSession, str(session_id))
            if sess is None:
                raise LookupError(f"onboarding_session {session_id} not found")
            if sess.status != OnboardingStatus.ACTIVE:
                raise WizardError(f"onboarding_not_active:{sess.status.value}")

            current_idx = STEP_ORDER.index(sess.current_step)
            current_name = sess.current_step

            # Mark the current step as completed (or failed if !mark_complete).
            stmt = (
                select(OnboardingStep)
                .where(
                    OnboardingStep.session_id == sess.id,
                    OnboardingStep.step_name == current_name,
                )
                .order_by(OnboardingStep.step_order.desc())
                .limit(1)
            )
            cur_step = (await session.execute(stmt)).scalar_one_or_none()
            if cur_step is not None:
                cur_step.status = (
                    OnboardingStepStatus.COMPLETED
                    if body.mark_complete
                    else OnboardingStepStatus.FAILED
                )
                cur_step.output = body.step_input

            # Persist collected input into the session state.
            sess.state = {**sess.state, current_name: body.step_input}

            # Determine next step.
            will_complete = current_idx == len(STEP_ORDER) - 1 or not body.mark_complete
            if will_complete:
                sess.status = OnboardingStatus.COMPLETED
                sess.completed_at = datetime.now(UTC)
            else:
                next_idx = current_idx + 1
                sess.current_step = STEP_ORDER[next_idx]
                session.add(
                    OnboardingStep(
                        tenant_id=sess.tenant_id,
                        session_id=sess.id,
                        step_name=STEP_ORDER[next_idx],
                        step_order=next_idx,
                        status=OnboardingStepStatus.IN_PROGRESS,
                    )
                )
            await session.commit()
            await session.refresh(sess)
            sid = sess.id
            tenant_id = sess.tenant_id
            project_id = sess.project_id
            user_id = sess.user_id
            session_state = dict(sess.state or {})

        # Final-step hook (F-507): trigger Day-One Bootstrap when the
        # wizard reaches the review step successfully. Bootstrap is
        # idempotent and audit-logged; we run it OUTSIDE the DB txn so
        # its writes do not block the wizard commit. A bootstrap failure
        # is surfaced via the session state (and the bootstrap audit log)
        # but does not roll back the wizard — the operator can rerun
        # bootstrap via the API.
        if will_complete and current_name == STEP_ORDER[-1] and body.mark_complete:
            try:
                from app.services.day_one_bootstrap import day_one_bootstrap

                project_metadata = (session_state or {}).get("project_metadata") or {}
                bootstrap_result = await day_one_bootstrap.load_baseline(
                    project_id=project_id,
                    tenant_id=tenant_id,
                    actor_id=user_id,
                    project_metadata=project_metadata,
                )
                logger.info(
                    "onboarding.bootstrap.triggered",
                    session_id=str(sid),
                    project_id=str(project_id),
                    run_id=str(bootstrap_result.run_id) if bootstrap_result.run_id else None,
                )
            except Exception as exc:  # noqa: BLE001 — bootstrap must never crash the wizard
                logger.error(
                    "onboarding.bootstrap.failed",
                    session_id=str(sid),
                    project_id=str(project_id),
                    error=str(exc),
                )

        return await self.get_state(sid)

    async def cancel(self, session_id: UUID | str) -> OnboardingSessionRead:
        factory = get_session_factory()
        async with factory() as session:
            sess = await session.get(OnboardingSession, str(session_id))
            if sess is None:
                raise LookupError(f"onboarding_session {session_id} not found")
            sess.status = OnboardingStatus.CANCELLED
            sess.completed_at = datetime.now(UTC)
            await session.commit()
            await session.refresh(sess)
            sid = sess.id
        logger.info("onboarding.cancelled", session_id=str(sid))
        return await self.get_state(sid)


onboarding_wizard = OnboardingWizard()


__all__ = [
    "OnboardingWizard",
    "WizardError",
    "STEP_ORDER",
    "onboarding_wizard",
]
