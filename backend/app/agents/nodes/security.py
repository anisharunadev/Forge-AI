"""Security phase node.

Runs the security GSD commands (``forge-sec-scan``,
``forge-sec-policy-check``) and produces a ``security_report``
artifact. **Requires approval** (Rule 3) — the gate must be cleared
by ``forge-security`` before review / deployment.
"""

from __future__ import annotations

import hashlib
import json
from decimal import Decimal
from typing import Any

from app.agents.nodes.base import BasePhaseNode
from app.agents.sdlc_state import ArtifactRef, SDLCPhase, SDLCState
from app.agents.tools.gsd_wrapper import GSDWrapper, build_default_wrapper
from app.agents.tools.mcp_client import MCPClient, build_default_mcp_client
from app.services.artifact_registry import ArtifactRegistry
from app.services.litellm_client import LiteLLMClient


ARTIFACT_TYPE_SECURITY_REPORT = "security_report"


class SecurityNode(BasePhaseNode):
    """Security phase — gates on ``forge-security`` approval."""

    phase_name = SDLCPhase.SECURITY
    requires_approval = True
    max_cost_usd = Decimal("5.00")
    max_duration_seconds = 1800
    tools: list[Any] = []

    def __init__(
        self,
        *,
        gsd_wrapper: GSDWrapper | None = None,
        artifact_registry: ArtifactRegistry | None = None,
        mcp_client: MCPClient | None = None,
        litellm: LiteLLMClient | None = None,
        event_bus: Any | None = None,
    ) -> None:
        super().__init__(event_bus=event_bus)
        self._gsd = gsd_wrapper or build_default_wrapper()
        self._registry = artifact_registry or ArtifactRegistry(bus=self._bus)
        self._mcp = mcp_client or build_default_mcp_client()
        self._litellm = litellm

    async def execute(self, state: SDLCState) -> SDLCState:
        tenant_id = str(state.tenant_id)
        project_id = str(state.project_id)
        user_id = str(state.actor_id)

        # 1. SAST / SCA scans.
        scan = self._gsd.execute(
            "forge-sec-scan",
            {},
            tenant_id=tenant_id,
            project_id=project_id,
            user_id=user_id,
        )
        if not scan.ok:
            raise RuntimeError(f"forge-sec-scan failed: {scan.error}")

        # 2. Policy evaluation.
        policy = self._gsd.execute(
            "forge-sec-policy-check",
            {"context": state.context},
            tenant_id=tenant_id,
            project_id=project_id,
            user_id=user_id,
        )
        if not policy.ok:
            raise RuntimeError(
                f"forge-sec-policy-check failed: {policy.error}"
            )

        # 3. Optional: LLM-based threat-model synthesis.
        threat_model = None
        if self._litellm is not None:
            try:
                async with self._litellm as client:
                    response = await client.chat(
                        messages=[
                            {
                                "role": "system",
                                "content": (
                                    "You are a security analyst. Synthesize a "
                                    "threat model from the scan output."
                                ),
                            },
                            {
                                "role": "user",
                                "content": json.dumps(scan.output, default=str)[
                                    :6000
                                ],
                            },
                        ],
                        tenant_id=tenant_id,
                        project_id=project_id,
                        workflow_id=state.run_id,
                        actor_id=user_id,
                    )
                    threat_model = response.get("choices", [{}])[0].get(
                        "message", {}
                    ).get("content", "")
            except Exception:  # noqa: BLE001 — LLM is best-effort
                threat_model = None

        payload = {
            "scan": scan.output,
            "policy": policy.output,
            "threat_model": threat_model,
            "approver_role": "forge-security",
            "context": state.context,
        }
        canonical = json.dumps(
            payload, sort_keys=True, separators=(",", ":"), default=str
        )
        content_hash = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
        artifact = await self._registry.create(
            tenant_id=tenant_id,
            project_id=project_id,
            type=ARTIFACT_TYPE_SECURITY_REPORT,
            payload=payload,
            created_by=user_id,
            status="draft",
            actor_id=user_id,
        )
        return state.add_artifact(
            ARTIFACT_TYPE_SECURITY_REPORT,
            ArtifactRef(
                artifact_id=artifact.id,
                type=ARTIFACT_TYPE_SECURITY_REPORT,
                version=artifact.version,
                phase=self.phase_name,
                content_hash=content_hash,
                summary="Security report awaiting forge-security sign-off",
            ),
        )


__all__ = ["SecurityNode", "ARTIFACT_TYPE_SECURITY_REPORT"]
