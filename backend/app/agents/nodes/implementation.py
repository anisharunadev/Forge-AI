"""Implementation phase node.

Runs the development GSD commands (``forge-dev-scaffold``,
``forge-dev-implement``, ``forge-dev-refactor``) inside the
TerminalCenter via :class:`~backend.app.services.agent_runtime.AgentRuntime`.
Produces a ``code_changes`` artifact summarizing the file writes /
format / lint cycle. No approval gate — architecture was already
cleared upstream.
"""

from __future__ import annotations

import hashlib
import json
from decimal import Decimal
from typing import Any
from uuid import UUID

from app.agents.nodes.base import BasePhaseNode
from app.agents.sdlc_state import ArtifactRef, SDLCPhase, SDLCState
from app.agents.tools.gsd_wrapper import GSDWrapper, build_default_wrapper
from app.services.agent_runtime import AgentRuntime, agent_runtime as default_runtime
from app.services.artifact_registry import ArtifactRegistry


ARTIFACT_TYPE_CODE_CHANGES = "code_changes"


class ImplementationNode(BasePhaseNode):
    """Ship code through the TerminalCenter agent runtime."""

    phase_name = SDLCPhase.IMPLEMENTATION
    requires_approval = False
    max_cost_usd = Decimal("10.00")
    max_duration_seconds = 3600
    tools: list[Any] = []

    def __init__(
        self,
        *,
        gsd_wrapper: GSDWrapper | None = None,
        artifact_registry: ArtifactRegistry | None = None,
        runtime: AgentRuntime | None = None,
        event_bus: Any | None = None,
    ) -> None:
        super().__init__(event_bus=event_bus)
        self._gsd = gsd_wrapper or build_default_wrapper()
        self._registry = artifact_registry or ArtifactRegistry(bus=self._bus)
        self._runtime = runtime or default_runtime

    async def execute(self, state: SDLCState) -> SDLCState:
        tenant_id = str(state.tenant_id)
        project_id = str(state.project_id)
        user_id = str(state.actor_id)
        workspace_path = str(state.context.get("workspace_path", "/tmp/forge-run"))
        contract = state.artifacts.get("api_contract")

        # 1. Reserve a runtime handle for the implementation PTY.
        runtime_agent_id = UUID(int=0)  # placeholder agent id; runtime accepts any UUID
        handle = await self._runtime.start(
            agent_id=runtime_agent_id,
            workspace_path=workspace_path,
            tenant_id=state.tenant_id,
            project_id=state.project_id,
        )

        # 2. Run the dev GSD commands.
        scaffold = self._gsd.execute(
            "forge-dev-scaffold",
            {"contract_id": str(contract.artifact_id) if contract else None},
            tenant_id=tenant_id,
            project_id=project_id,
            user_id=user_id,
        )
        if not scaffold.ok:
            await self._safe_stop(handle.id)
            raise RuntimeError(f"forge-dev-scaffold failed: {scaffold.error}")

        implement = self._gsd.execute(
            "forge-dev-implement",
            {"context": state.context},
            tenant_id=tenant_id,
            project_id=project_id,
            user_id=user_id,
        )
        if not implement.ok:
            await self._safe_stop(handle.id)
            raise RuntimeError(f"forge-dev-implement failed: {implement.error}")

        # 3. Compose the code-changes artifact.
        payload = {
            "scaffold": scaffold.output,
            "implement": implement.output,
            "runtime_handle_id": str(handle.id),
            "workspace_path": workspace_path,
        }
        canonical = json.dumps(
            payload, sort_keys=True, separators=(",", ":"), default=str
        )
        content_hash = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
        artifact = await self._registry.create(
            tenant_id=tenant_id,
            project_id=project_id,
            type=ARTIFACT_TYPE_CODE_CHANGES,
            payload=payload,
            created_by=user_id,
            status="active",
            actor_id=user_id,
        )

        await self._safe_stop(handle.id)

        return state.add_artifact(
            ARTIFACT_TYPE_CODE_CHANGES,
            ArtifactRef(
                artifact_id=artifact.id,
                type=ARTIFACT_TYPE_CODE_CHANGES,
                version=artifact.version,
                phase=self.phase_name,
                content_hash=content_hash,
                summary=f"Implementation via runtime {handle.id}",
            ),
        )

    async def _safe_stop(self, handle_id: UUID) -> None:
        try:
            await self._runtime.stop(handle_id)
        except Exception:  # noqa: BLE001 — never let teardown fail the run
            pass


__all__ = ["ImplementationNode", "ARTIFACT_TYPE_CODE_CHANGES"]
