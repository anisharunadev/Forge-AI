"""Discovery phase node.

Runs the project-intelligence GSD commands (``forge-intel-summarize``,
``forge-intel-discover``) to produce a typed ``discovery_report``
artifact. The phase is read-only — no file mutation, no LLM-side
generation — and never blocks on approval.
"""

from __future__ import annotations

import hashlib
import json
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

from app.agents.nodes.base import BasePhaseNode
from app.agents.sdlc_state import ArtifactRef, SDLCPhase, SDLCState
from app.agents.tools.gsd_wrapper import GSDWrapper, build_default_wrapper
from app.agents.tools.repomix_wrapper import RepomixTool, build_default_repomix_tool
from app.services.artifact_registry import ArtifactRegistry
from app.services.event_bus import EventType, bus as default_bus


ARTIFACT_TYPE_DISCOVERY = "discovery_report"


class DiscoveryNode(BasePhaseNode):
    """Produce the discovery report that anchors the rest of the run."""

    phase_name = SDLCPhase.DISCOVERY
    requires_approval = False
    max_cost_usd = Decimal("0.25")
    max_duration_seconds = 600
    tools: list[Any] = []

    def __init__(
        self,
        *,
        gsd_wrapper: GSDWrapper | None = None,
        artifact_registry: ArtifactRegistry | None = None,
        repomix: RepomixTool | None = None,
        event_bus: Any | None = None,
    ) -> None:
        super().__init__(event_bus=event_bus)
        self._gsd = gsd_wrapper or build_default_wrapper()
        self._registry = artifact_registry or ArtifactRegistry(bus=self._bus)
        self._repomix = repomix or build_default_repomix_tool()

    async def execute(self, state: SDLCState) -> SDLCState:
        repo_path = str(state.context.get("repo_path", "/"))
        tenant_id = str(state.tenant_id)
        project_id = str(state.project_id)
        user_id = str(state.actor_id)

        # 1. Run the GSD intel commands through the white-label wrapper.
        summarize = self._gsd.execute(
            "forge-intel-summarize",
            {"repo_path": repo_path},
            tenant_id=tenant_id,
            project_id=project_id,
            user_id=user_id,
        )
        discover = self._gsd.execute(
            "forge-intel-scan-repo",
            {"repo_path": repo_path},
            tenant_id=tenant_id,
            project_id=project_id,
            user_id=user_id,
        )
        if not summarize.ok:
            raise RuntimeError(
                f"forge-intel-summarize failed: {summarize.error}"
            )
        if not discover.ok:
            raise RuntimeError(
                f"forge-intel-scan-repo failed: {discover.error}"
            )

        # 2. Pack the repo with repomix (read-only) for LLM context.
        repo_pack = await self._repomix.pack_repo_async(repo_path, "xml")

        # 3. Compose the typed discovery payload.
        payload = {
            "summary": summarize.output,
            "discovery": discover.output,
            "repo_pack_excerpt": repo_pack[:4000],
            "phases_planned": [
                SDLCPhase.PLANNING.value,
                SDLCPhase.ARCHITECTURE.value,
                SDLCPhase.IMPLEMENTATION.value,
                SDLCPhase.TESTING.value,
                SDLCPhase.SECURITY.value,
                SDLCPhase.REVIEW.value,
                SDLCPhase.DEPLOYMENT.value,
            ],
        }
        canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
        content_hash = hashlib.sha256(canonical.encode("utf-8")).hexdigest()

        # 4. Persist via ArtifactRegistry (so events fire).
        await self._bus.publish(
            EventType.ARTIFACT_CREATED,
            {"type": ARTIFACT_TYPE_DISCOVERY, "phase": self.phase_name.value},
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=user_id,
        )
        artifact = await self._registry.create(
            tenant_id=tenant_id,
            project_id=project_id,
            type=ARTIFACT_TYPE_DISCOVERY,
            payload=payload,
            created_by=user_id,
            status="active",
            actor_id=user_id,
        )

        ref = ArtifactRef(
            artifact_id=artifact.id,
            type=ARTIFACT_TYPE_DISCOVERY,
            version=artifact.version,
            phase=self.phase_name,
            content_hash=content_hash,
            summary=str(payload.get("summary", ""))[:200],
        )
        return state.add_artifact(ARTIFACT_TYPE_DISCOVERY, ref)


__all__ = ["DiscoveryNode", "ARTIFACT_TYPE_DISCOVERY"]
