"""Testing phase node.

Runs the test GSD commands (``forge-test-unit``,
``forge-test-integration``, ``forge-test-coverage``) and emits a
typed ``test_report`` artifact. No approval gate.
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

ARTIFACT_TYPE_TEST_REPORT = "test_report"


class TestingNode(BasePhaseNode):
    """Run the test suites and emit a typed report."""

    phase_name = SDLCPhase.TESTING
    requires_approval = False
    max_cost_usd = Decimal("2.00")
    max_duration_seconds = 1800
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

        unit = self._gsd.execute(
            "forge-test-unit",
            {},
            tenant_id=tenant_id,
            project_id=project_id,
            user_id=user_id,
        )
        integration = self._gsd.execute(
            "forge-test-integration",
            {},
            tenant_id=tenant_id,
            project_id=project_id,
            user_id=user_id,
        )
        coverage = self._gsd.execute(
            "forge-test-coverage",
            {},
            tenant_id=tenant_id,
            project_id=project_id,
            user_id=user_id,
        )

        # Tests are non-blocking: a failed suite is reported but does
        # not fail the phase. The reviewer / security nodes decide.
        payload = {
            "unit": _summary("unit", unit),
            "integration": _summary("integration", integration),
            "coverage": _summary("coverage", coverage),
        }
        canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
        content_hash = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
        artifact = await self._registry.create(
            tenant_id=tenant_id,
            project_id=project_id,
            type=ARTIFACT_TYPE_TEST_REPORT,
            payload=payload,
            created_by=user_id,
            status="active",
            actor_id=user_id,
        )
        return state.add_artifact(
            ARTIFACT_TYPE_TEST_REPORT,
            ArtifactRef(
                artifact_id=artifact.id,
                type=ARTIFACT_TYPE_TEST_REPORT,
                version=artifact.version,
                phase=self.phase_name,
                content_hash=content_hash,
                summary=f"unit={payload['unit']['ok']} int={payload['integration']['ok']}",
            ),
        )


def _summary(name: str, result: Any) -> dict[str, Any]:
    return {
        "name": name,
        "ok": bool(getattr(result, "ok", False)),
        "error": getattr(result, "error", None),
        "output": getattr(result, "output", None),
        "duration_ms": getattr(result, "duration_ms", 0),
    }


__all__ = ["TestingNode", "ARTIFACT_TYPE_TEST_REPORT"]
