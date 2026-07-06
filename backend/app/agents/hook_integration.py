"""Hook orchestration integration for SDLC phase transitions.

The :class:`HookIntegration` wires the SDLC supervisor's pre/post phase
events into :class:`~backend.app.services.hook_orchestrator.HookOrchestrator`
(M2 substrate). The orchestrator's hook scripts execute with
``FORGE_HOOK_CONTEXT`` set to a JSON dump of the live state.

Hook points exposed
-------------------
- ``pre_phase``       — before a phase node executes
- ``post_phase``      — after a phase node executes successfully
- ``pre_approval``    — before an approval request is published
- ``post_approval``   — after an approval decision is recorded
- ``pre_artifact``    — before an artifact is registered
- ``post_artifact``   — after an artifact is registered
"""

from __future__ import annotations

from uuid import UUID

from app.agents.nodes.base import PhaseHooks
from app.agents.sdlc_state import SDLCState
from app.services.hook_orchestrator import (
    HookOrchestrator,
)
from app.services.hook_orchestrator import (
    hook_orchestrator as default_orchestrator,
)

# HookPhase is a tiny enum in M1 — use string constants here so this
# module does not pull in the SQLAlchemy metadata when imported in
# test contexts that already register the model.
_PHASE_PRE = "pre"
_PHASE_POST = "post"


class HookIntegration:
    """Bridges SDLC phase lifecycle events to the M2 Hook Orchestrator.

    Hooks are matched on a synthetic ``event_type`` of the form
    ``sdlc.<hook_point>`` (e.g. ``sdlc.pre_phase``). Tenant / project
    scoping is preserved by the underlying orchestrator.
    """

    HOOK_POINTS: tuple[str, ...] = (
        "pre_phase",
        "post_phase",
        "pre_approval",
        "post_approval",
        "pre_artifact",
        "post_artifact",
    )

    def __init__(
        self,
        *,
        orchestrator: HookOrchestrator | None = None,
    ) -> None:
        self._orchestrator = orchestrator or default_orchestrator

    # ---- Per-phase hook construction ----------------------------------

    def hooks_for_phase(
        self,
        *,
        tenant_id: UUID,
        project_id: UUID,
        phase: str,
    ) -> PhaseHooks:
        """Return the PhaseHooks a phase node should attach.

        Two callbacks are returned: a pre-phase hook that fires
        ``sdlc.pre_phase`` and a post-phase hook that fires
        ``sdlc.post_phase``. Hook scripts are looked up per
        (tenant, project, event_type) and run in declared ``run_order``.
        """

        async def _pre(state: SDLCState) -> None:
            await self._orchestrator.fire(
                tenant_id=tenant_id,
                project_id=project_id,
                event_type="sdlc.pre_phase",
                phase=_PHASE_PRE,
                context={
                    "run_id": str(state.run_id),
                    "phase": phase,
                    "current_state_phase": state.current_phase.value,
                    "cost_so_far": str(state.cost_so_far),
                },
            )

        async def _post(state: SDLCState) -> None:
            await self._orchestrator.fire(
                tenant_id=tenant_id,
                project_id=project_id,
                event_type="sdlc.post_phase",
                phase=_PHASE_POST,
                context={
                    "run_id": str(state.run_id),
                    "phase": phase,
                    "current_state_phase": state.current_phase.value,
                    "cost_so_far": str(state.cost_so_far),
                },
            )

        return PhaseHooks(pre_hooks=[_pre], post_hooks=[_post])

    # ---- Approval / artifact hooks ------------------------------------

    async def fire_pre_approval(self, state: SDLCState) -> None:
        await self._orchestrator.fire(
            tenant_id=state.tenant_id,
            project_id=state.project_id,
            event_type="sdlc.pre_approval",
            phase=_PHASE_PRE,
            context={
                "run_id": str(state.run_id),
                "current_phase": state.current_phase.value,
                "approval": state.pending_approval.model_dump(mode="json")
                if state.pending_approval is not None
                else None,
            },
        )

    async def fire_post_approval(
        self,
        state: SDLCState,
        *,
        granted: bool,
        reason: str = "",
    ) -> None:
        await self._orchestrator.fire(
            tenant_id=state.tenant_id,
            project_id=state.project_id,
            event_type="sdlc.post_approval",
            phase=_PHASE_POST,
            context={
                "run_id": str(state.run_id),
                "current_phase": state.current_phase.value,
                "granted": granted,
                "reason": reason,
            },
        )

    async def fire_pre_artifact(
        self,
        state: SDLCState,
        *,
        artifact_type: str,
    ) -> None:
        await self._orchestrator.fire(
            tenant_id=state.tenant_id,
            project_id=state.project_id,
            event_type="sdlc.pre_artifact",
            phase=_PHASE_PRE,
            context={
                "run_id": str(state.run_id),
                "artifact_type": artifact_type,
                "current_phase": state.current_phase.value,
            },
        )

    async def fire_post_artifact(
        self,
        state: SDLCState,
        *,
        artifact_type: str,
        artifact_id: UUID | None,
    ) -> None:
        await self._orchestrator.fire(
            tenant_id=state.tenant_id,
            project_id=state.project_id,
            event_type="sdlc.post_artifact",
            phase=_PHASE_POST,
            context={
                "run_id": str(state.run_id),
                "artifact_type": artifact_type,
                "artifact_id": str(artifact_id) if artifact_id else None,
                "current_phase": state.current_phase.value,
            },
        )


def hook_integration_default() -> HookIntegration:
    return HookIntegration()


__all__ = ["HookIntegration", "hook_integration_default"]
