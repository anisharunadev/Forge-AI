"""Review phase node.

Runs the review GSD commands (``forge-review-diff``,
``forge-review-risk``) and emits a typed ``review_report`` artifact.
No approval gate — the deploy gate downstream collects the final
deployment approval.
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

ARTIFACT_TYPE_REVIEW_REPORT = "review_report"


class ReviewNode(BasePhaseNode):
    """Code review + risk scoring phase."""

    phase_name = SDLCPhase.REVIEW
    requires_approval = False
    max_cost_usd = Decimal("2.00")
    max_duration_seconds = 900
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

        # 1. Read the diff context via MCP.
        diff_ctx = await self._mcp.call_server(
            "mcp_code_search",
            "search_code",
            {"query": "git diff", "limit": 5},
        )

        # 2. Run review GSD commands.
        diff = self._gsd.execute(
            "forge-review-diff",
            {"context": state.context},
            tenant_id=tenant_id,
            project_id=project_id,
            user_id=user_id,
        )
        if not diff.ok:
            raise RuntimeError(f"forge-review-diff failed: {diff.error}")

        risk = self._gsd.execute(
            "forge-review-risk",
            {"context": state.context},
            tenant_id=tenant_id,
            project_id=project_id,
            user_id=user_id,
        )
        if not risk.ok:
            raise RuntimeError(f"forge-review-risk failed: {risk.error}")

        # 3. Optional LLM summary.
        llm_summary = None
        if self._litellm is not None:
            try:
                async with self._litellm as client:
                    response = await client.chat(
                        messages=[
                            {
                                "role": "system",
                                "content": (
                                    "You are a senior code reviewer. Summarize the "
                                    "review diff and risk score."
                                ),
                            },
                            {
                                "role": "user",
                                "content": json.dumps(
                                    {
                                        "diff": diff.output,
                                        "risk": risk.output,
                                    },
                                    default=str,
                                )[:6000],
                            },
                        ],
                        tenant_id=tenant_id,
                        project_id=project_id,
                        workflow_id=state.run_id,
                        actor_id=user_id,
                    )
                    llm_summary = (
                        response.get("choices", [{}])[0].get("message", {}).get("content", "")
                    )
            except Exception:  # noqa: BLE001
                llm_summary = None

        payload = {
            "diff": diff.output,
            "risk": risk.output,
            "mcp_context": diff_ctx.output if diff_ctx.ok else None,
            "llm_summary": llm_summary,
        }
        canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
        content_hash = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
        artifact = await self._registry.create(
            tenant_id=tenant_id,
            project_id=project_id,
            type=ARTIFACT_TYPE_REVIEW_REPORT,
            payload=payload,
            created_by=user_id,
            status="active",
            actor_id=user_id,
        )
        return state.add_artifact(
            ARTIFACT_TYPE_REVIEW_REPORT,
            ArtifactRef(
                artifact_id=artifact.id,
                type=ARTIFACT_TYPE_REVIEW_REPORT,
                version=artifact.version,
                phase=self.phase_name,
                content_hash=content_hash,
                summary="Code review and risk report",
            ),
        )


__all__ = ["ReviewNode", "ARTIFACT_TYPE_REVIEW_REPORT"]
