"""Planning phase node.

Generates a roadmap + task breakdown by running the ideation GSD
commands. Produces a typed ``roadmap`` artifact that anchors the
subsequent architecture and implementation phases.
"""

from __future__ import annotations

import hashlib
import json
from decimal import Decimal
from typing import Any

from app.agents.nodes.base import BasePhaseNode
from app.agents.sdlc_state import ArtifactRef, SDLCPhase, SDLCState
from app.agents.tools.gsd_wrapper import GSDWrapper, build_default_wrapper
from app.services.artifact_registry import ArtifactRegistry

ARTIFACT_TYPE_ROADMAP = "roadmap"
ARTIFACT_TYPE_TASKS = "task_breakdown"


class PlanningNode(BasePhaseNode):
    """Run ideation commands and emit roadmap + task breakdown artifacts."""

    phase_name = SDLCPhase.PLANNING
    requires_approval = False
    max_cost_usd = Decimal("0.50")
    max_duration_seconds = 600
    tools: list[Any] = []

    def __init__(
        self,
        *,
        gsd_wrapper: GSDWrapper | None = None,
        artifact_registry: ArtifactRegistry | None = None,
        event_bus: Any | None = None,
    ) -> None:
        super().__init__(event_bus=event_bus)
        self._gsd = gsd_wrapper or build_default_wrapper()
        self._registry = artifact_registry or ArtifactRegistry(bus=self._bus)

    async def execute(self, state: SDLCState) -> SDLCState:
        tenant_id = str(state.tenant_id)
        project_id = str(state.project_id)
        user_id = str(state.actor_id)
        repo_path = str(state.context.get("repo_path", "/"))

        # 1. Ideation commands — brainstorm + refine into a roadmap.
        brainstorm = self._gsd.execute(
            "forge-ideate-brainstorm",
            {"context": state.context, "discovery": state.artifacts.get("discovery_report")},
            tenant_id=tenant_id,
            project_id=project_id,
            user_id=user_id,
        )
        if not brainstorm.ok:
            raise RuntimeError(f"forge-ideate-brainstorm failed: {brainstorm.error}")
        refine = self._gsd.execute(
            "forge-ideate-refine",
            {"context": state.context},
            tenant_id=tenant_id,
            project_id=project_id,
            user_id=user_id,
        )
        if not refine.ok:
            raise RuntimeError(f"forge-ideate-refine failed: {refine.error}")

        # 2. Compose roadmap + task breakdown payloads.
        roadmap_payload = {
            "phases": [
                {"name": phase.value, "objective": _phase_objective(phase)}
                for phase in (
                    SDLCPhase.ARCHITECTURE,
                    SDLCPhase.IMPLEMENTATION,
                    SDLCPhase.TESTING,
                    SDLCPhase.SECURITY,
                    SDLCPhase.REVIEW,
                    SDLCPhase.DEPLOYMENT,
                )
            ],
            "brainstorm": brainstorm.output,
            "refine": refine.output,
            "repo_path": repo_path,
        }
        roadmap_canonical = json.dumps(
            roadmap_payload, sort_keys=True, separators=(",", ":"), default=str
        )
        roadmap_hash = hashlib.sha256(roadmap_canonical.encode("utf-8")).hexdigest()
        roadmap_artifact = await self._registry.create(
            tenant_id=tenant_id,
            project_id=project_id,
            type=ARTIFACT_TYPE_ROADMAP,
            payload=roadmap_payload,
            created_by=user_id,
            status="active",
            actor_id=user_id,
        )
        state = state.add_artifact(
            ARTIFACT_TYPE_ROADMAP,
            ArtifactRef(
                artifact_id=roadmap_artifact.id,
                type=ARTIFACT_TYPE_ROADMAP,
                version=roadmap_artifact.version,
                phase=self.phase_name,
                content_hash=roadmap_hash,
                summary=f"Roadmap with {len(roadmap_payload['phases'])} phases",
            ),
        )

        # 3. Task breakdown — one entry per phase.
        tasks_payload = {
            "tasks": [
                {
                    "id": f"task-{i + 1:02d}",
                    "phase": entry["name"],
                    "objective": entry["objective"],
                    "depends_on": ([roadmap_payload["phases"][i - 1]["name"]] if i > 0 else []),
                }
                for i, entry in enumerate(roadmap_payload["phases"])
            ],
            "total_tasks": len(roadmap_payload["phases"]),
        }
        tasks_canonical = json.dumps(
            tasks_payload, sort_keys=True, separators=(",", ":"), default=str
        )
        tasks_hash = hashlib.sha256(tasks_canonical.encode("utf-8")).hexdigest()
        tasks_artifact = await self._registry.create(
            tenant_id=tenant_id,
            project_id=project_id,
            type=ARTIFACT_TYPE_TASKS,
            payload=tasks_payload,
            created_by=user_id,
            status="active",
            actor_id=user_id,
        )
        return state.add_artifact(
            ARTIFACT_TYPE_TASKS,
            ArtifactRef(
                artifact_id=tasks_artifact.id,
                type=ARTIFACT_TYPE_TASKS,
                version=tasks_artifact.version,
                phase=self.phase_name,
                content_hash=tasks_hash,
                summary=f"{tasks_payload['total_tasks']} planned tasks",
            ),
        )


def _phase_objective(phase: SDLCPhase) -> str:
    return {
        SDLCPhase.ARCHITECTURE: "Produce ADR + API contract + risk register.",
        SDLCPhase.IMPLEMENTATION: "Scaffold code and ship feature changes.",
        SDLCPhase.TESTING: "Run unit, integration, and E2E test suites.",
        SDLCPhase.SECURITY: "Run SAST/SCA scanners and emit security report.",
        SDLCPhase.REVIEW: "Review diff, risk-score, and recommend approval.",
        SDLCPhase.DEPLOYMENT: "Plan + execute staging and production promotion.",
    }.get(phase, "Run phase")


__all__ = [
    "PlanningNode",
    "ARTIFACT_TYPE_ROADMAP",
    "ARTIFACT_TYPE_TASKS",
]
