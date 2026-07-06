"""Architecture phase node.

Produces ADR, API contract, and risk register artifacts by running the
architecture GSD commands. **Requires approval** (Rule 3) — the gate
must be cleared by ``forge-architect`` or ``forge-admin`` before the
SDLC proceeds to implementation.
"""

from __future__ import annotations

import hashlib
import json
from decimal import Decimal
from typing import Any

from app.agents.nodes.base import BasePhaseNode
from app.agents.sdlc_state import ArtifactRef, SDLCPhase, SDLCState
from app.agents.tools.gsd_wrapper import GSDWrapper, build_default_wrapper
from app.agents.tools.knowledge_graph import (
    KnowledgeGraphAdapter,
    build_default_kg_adapter,
)
from app.agents.tools.mcp_client import (
    MCPClient,
    build_default_mcp_client,
)
from app.services.artifact_registry import ArtifactRegistry
from app.services.litellm_client import LiteLLMClient

ARTIFACT_TYPE_ADR = "architecture_decision_record"
ARTIFACT_TYPE_API_CONTRACT = "api_contract"
ARTIFACT_TYPE_RISK_REGISTER = "risk_register"


class ArchitectureNode(BasePhaseNode):
    """Architecture phase — gates on ``forge-architect`` approval."""

    phase_name = SDLCPhase.ARCHITECTURE
    requires_approval = True
    max_cost_usd = Decimal("3.00")
    max_duration_seconds = 1200
    tools: list[Any] = []

    def __init__(
        self,
        *,
        gsd_wrapper: GSDWrapper | None = None,
        artifact_registry: ArtifactRegistry | None = None,
        kg_adapter: KnowledgeGraphAdapter | None = None,
        mcp_client: MCPClient | None = None,
        litellm: LiteLLMClient | None = None,
        event_bus: Any | None = None,
    ) -> None:
        super().__init__(event_bus=event_bus)
        self._gsd = gsd_wrapper or build_default_wrapper()
        self._registry = artifact_registry or ArtifactRegistry(bus=self._bus)
        self._kg = kg_adapter or build_default_kg_adapter()
        self._mcp = mcp_client or build_default_mcp_client()
        self._litellm = litellm  # optional; LLM step is skipped when None

    async def execute(self, state: SDLCState) -> SDLCState:
        tenant_id = str(state.tenant_id)
        project_id = str(state.project_id)
        user_id = str(state.actor_id)
        roadmap = state.artifacts.get("roadmap")
        tasks = state.artifacts.get("task_breakdown")

        # 1. Read project context via MCP (best-effort).
        mcp_ctx = await self._mcp.call_server(
            "mcp_code_search",
            "search_code",
            {"query": "module boundaries", "limit": 10},
        )

        # 2. Architecture GSD commands.
        adr_result = self._gsd.execute(
            "forge-arch-adr",
            {"context": state.context, "roadmap_id": str(roadmap.artifact_id) if roadmap else None},
            tenant_id=tenant_id,
            project_id=project_id,
            user_id=user_id,
        )
        if not adr_result.ok:
            raise RuntimeError(f"forge-arch-adr failed: {adr_result.error}")

        contract_result = self._gsd.execute(
            "forge-arch-contract-spec",
            {"roadmap_id": str(roadmap.artifact_id) if roadmap else None},
            tenant_id=tenant_id,
            project_id=project_id,
            user_id=user_id,
        )
        if not contract_result.ok:
            raise RuntimeError(f"forge-arch-contract-spec failed: {contract_result.error}")

        # 3. Compose the three typed artifacts.
        adr_payload = {
            "title": f"Architecture decision for run {state.run_id}",
            "context": state.context,
            "gsd_output": adr_result.output,
            "kg_snapshot": self._kg.query_graph("Component").to_dict(),
            "mcp_context": mcp_ctx.output if mcp_ctx.ok else None,
        }
        contract_payload = {
            "spec": contract_result.output,
            "tasks": tasks.summary if tasks else "",
        }
        risk_payload = {
            "items": [
                {
                    "id": "R-001",
                    "risk": "Cross-cutting refactor",
                    "severity": "medium",
                    "mitigation": "Gate on architecture approval",
                },
                {
                    "id": "R-002",
                    "risk": "External service dependency",
                    "severity": "low",
                    "mitigation": "Use MCP for live queries",
                },
            ],
            "approver_role": "forge-architect",
        }

        adr_ref = await self._persist(
            state, tenant_id, project_id, user_id, ARTIFACT_TYPE_ADR, adr_payload
        )
        contract_ref = await self._persist(
            state,
            tenant_id,
            project_id,
            user_id,
            ARTIFACT_TYPE_API_CONTRACT,
            contract_payload,
            target=adr_ref,
        )
        risk_ref = await self._persist(
            state,
            tenant_id,
            project_id,
            user_id,
            ARTIFACT_TYPE_RISK_REGISTER,
            risk_payload,
            target=adr_ref,
        )
        return (
            state.add_artifact(ARTIFACT_TYPE_ADR, adr_ref)
            .add_artifact(ARTIFACT_TYPE_API_CONTRACT, contract_ref)
            .add_artifact(ARTIFACT_TYPE_RISK_REGISTER, risk_ref)
        )

    async def _persist(
        self,
        state: SDLCState,
        tenant_id: str,
        project_id: str,
        user_id: str,
        artifact_type: str,
        payload: dict[str, Any],
        *,
        target: ArtifactRef | None = None,
    ) -> ArtifactRef:
        canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
        content_hash = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
        artifact = await self._registry.create(
            tenant_id=tenant_id,
            project_id=project_id,
            type=artifact_type,
            payload=payload,
            created_by=user_id,
            status="draft",
            actor_id=user_id,
        )
        return ArtifactRef(
            artifact_id=artifact.id,
            type=artifact_type,
            version=artifact.version,
            phase=self.phase_name,
            content_hash=content_hash,
            summary=artifact_type.replace("_", " "),
        )


__all__ = [
    "ArchitectureNode",
    "ARTIFACT_TYPE_ADR",
    "ARTIFACT_TYPE_API_CONTRACT",
    "ARTIFACT_TYPE_RISK_REGISTER",
]
