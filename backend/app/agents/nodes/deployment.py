"""Deployment phase node.

Plans + promotes a build via the deploy GSD commands
(``forge-deploy-plan``, ``forge-deploy-stage``, ``forge-deploy-prod``)
and emits a typed ``deployment_plan`` artifact. **Requires approval**
(Rule 3) — the gate must be cleared by ``forge-deployer``.
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


ARTIFACT_TYPE_DEPLOYMENT_PLAN = "deployment_plan"


class DeploymentNode(BasePhaseNode):
    """Deployment phase — gates on ``forge-deployer`` approval."""

    phase_name = SDLCPhase.DEPLOYMENT
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
        event_bus: Any | None = None,
    ) -> None:
        super().__init__(event_bus=event_bus)
        self._gsd = gsd_wrapper or build_default_wrapper()
        self._registry = artifact_registry or ArtifactRegistry(bus=self._bus)
        self._mcp = mcp_client or build_default_mcp_client()

    async def execute(self, state: SDLCState) -> SDLCState:
        tenant_id = str(state.tenant_id)
        project_id = str(state.project_id)
        user_id = str(state.actor_id)

        # 1. Inventory cloud resources via MCP.
        aws_inventory = await self._mcp.call_server("mcp_aws", "list_stacks", {})
        argocd_inventory = await self._mcp.call_server(
            "mcp_argocd", "list_applications", {}
        )
        k8s_inventory = await self._mcp.call_server(
            "mcp_kubernetes", "list_pods", {"namespace": project_id}
        )

        # 2. Deployment GSD commands.
        plan = self._gsd.execute(
            "forge-deploy-plan",
            {
                "context": state.context,
                "aws": aws_inventory.output if aws_inventory.ok else None,
                "argocd": argocd_inventory.output if argocd_inventory.ok else None,
                "k8s": k8s_inventory.output if k8s_inventory.ok else None,
            },
            tenant_id=tenant_id,
            project_id=project_id,
            user_id=user_id,
        )
        if not plan.ok:
            raise RuntimeError(f"forge-deploy-plan failed: {plan.error}")

        stage = self._gsd.execute(
            "forge-deploy-stage",
            {"plan": plan.output},
            tenant_id=tenant_id,
            project_id=project_id,
            user_id=user_id,
        )
        if not stage.ok:
            raise RuntimeError(f"forge-deploy-stage failed: {stage.error}")

        payload = {
            "plan": plan.output,
            "stage": stage.output,
            "approver_role": "forge-deployer",
            "mcp_inventory": {
                "aws": aws_inventory.ok,
                "argocd": argocd_inventory.ok,
                "k8s": k8s_inventory.ok,
            },
        }
        canonical = json.dumps(
            payload, sort_keys=True, separators=(",", ":"), default=str
        )
        content_hash = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
        artifact = await self._registry.create(
            tenant_id=tenant_id,
            project_id=project_id,
            type=ARTIFACT_TYPE_DEPLOYMENT_PLAN,
            payload=payload,
            created_by=user_id,
            status="draft",
            actor_id=user_id,
        )
        return state.add_artifact(
            ARTIFACT_TYPE_DEPLOYMENT_PLAN,
            ArtifactRef(
                artifact_id=artifact.id,
                type=ARTIFACT_TYPE_DEPLOYMENT_PLAN,
                version=artifact.version,
                phase=self.phase_name,
                content_hash=content_hash,
                summary="Deployment plan awaiting forge-deployer sign-off",
            ),
        )


__all__ = ["DeploymentNode", "ARTIFACT_TYPE_DEPLOYMENT_PLAN"]
