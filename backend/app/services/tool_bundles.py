"""F-505 — Per-Stage Tool Bundle Guardrails.

A ToolBundle pins the set of tools an agent may invoke while it is
operating inside a given SDLC stage. Bundles are declarative
(shipped defaults + Steward overrides) and enforced at the
agent-runtime tool-invocation boundary.

Bundles are loaded from the F-003 Governance Policy Engine when
present; otherwise we fall back to the immutable defaults baked
into this module. Every enforcement decision is written to the
F-005 audit log so a violation can be traced end-to-end.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, TypedDict
from uuid import uuid4

from app.core.logging import get_logger
from app.schemas.tool_bundles import (
    STAGES,
    Stage,
    ToolBundleDecision,
    ToolBundleUpdate,
)
from app.services.audit_service import audit_service

logger = get_logger(__name__)


class ToolBundleViolation(PermissionError):
    """Raised when an agent attempts to invoke a tool outside its bundle."""

    def __init__(
        self,
        *,
        stage: Stage,
        tool: str,
        agent_id: str | None,
        reason: str,
    ) -> None:
        super().__init__(reason)
        self.stage = stage
        self.tool = tool
        self.agent_id = agent_id
        self.reason = reason


class ToolBundle(TypedDict):
    """Typed bundle row used by the registry."""

    stage: Stage
    permitted_tools: list[str]
    denied_tools: list[str]
    rationale: str | None


# ---------------------------------------------------------------------------
# Shipped defaults — these are the constitutional tool permissions per stage.
# A Steward override replaces the entire row in the registry, but these
# defaults are the starting point and the canonical reference.
# ---------------------------------------------------------------------------

DEFAULT_BUNDLES: dict[Stage, ToolBundle] = {
    "ideation": ToolBundle(
        stage="ideation",
        permitted_tools=["idea_intake", "opportunity_scoring", "push_to_delivery"],
        denied_tools=["code_write", "deploy", "security_scan"],
        rationale="Idea intake, scoring, and handoff to delivery. No write/deploy/scan.",
    ),
    "architecture": ToolBundle(
        stage="architecture",
        permitted_tools=["adr_generator", "api_contract_generator"],
        denied_tools=["code_write", "deploy"],
        rationale="ADR + API contract generation only. No production code or deploys.",
    ),
    "development": ToolBundle(
        stage="development",
        permitted_tools=["code_write", "code_review"],
        denied_tools=["deploy", "security_scan"],
        rationale="Code authoring + peer review. Deploy and security scan gated.",
    ),
    "testing": ToolBundle(
        stage="testing",
        permitted_tools=["test_runner", "test_generator"],
        denied_tools=["code_write", "deploy"],
        rationale="Test execution + generation only. Cannot edit source or deploy.",
    ),
    "security": ToolBundle(
        stage="security",
        permitted_tools=["security_scan", "validator"],
        denied_tools=["deploy", "code_write"],
        rationale="Security scans + validators. No deploys or production code writes.",
    ),
    "deployment": ToolBundle(
        stage="deployment",
        permitted_tools=["deploy", "iac_apply"],
        denied_tools=["code_write"],
        rationale="Deploy + IaC apply only. Code writes are read-only at this stage.",
    ),
}


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------


@dataclass
class _OverrideRow:
    """In-memory record of a Steward override."""

    stage: Stage
    permitted_tools: list[str]
    denied_tools: list[str]
    rationale: str | None
    updated_at: str
    updated_by: str | None = None


@dataclass
class ToolBundleRegistry:
    """Loads + caches per-stage bundles, applies Steward overrides.

    The registry is process-local (mirrors a tool/policy cache).
    Override rows survive across requests for the lifetime of the
    process; in a future milestone the same rows can be persisted
    alongside Policies and re-loaded on startup.
    """

    _overrides: dict[Stage, _OverrideRow] = field(default_factory=dict)

    # -- lookup -------------------------------------------------------------

    def get_bundle(self, stage: Stage) -> ToolBundle:
        """Return the effective bundle for `stage` (default or override)."""
        if stage not in STAGES:
            raise ValueError(f"unknown_stage:{stage}")
        override = self._overrides.get(stage)
        if override is not None:
            return ToolBundle(
                stage=stage,
                permitted_tools=list(override.permitted_tools),
                denied_tools=list(override.denied_tools),
                rationale=override.rationale,
            )
        return ToolBundle(
            stage=stage,
            permitted_tools=list(DEFAULT_BUNDLES[stage]["permitted_tools"]),
            denied_tools=list(DEFAULT_BUNDLES[stage]["denied_tools"]),
            rationale=DEFAULT_BUNDLES[stage]["rationale"],
        )

    def list_bundles(self) -> list[ToolBundle]:
        return [self.get_bundle(s) for s in STAGES]

    def has_override(self, stage: Stage) -> bool:
        return stage in self._overrides

    def override_row(self, stage: Stage) -> _OverrideRow | None:
        return self._overrides.get(stage)

    # -- write --------------------------------------------------------------

    def override(
        self,
        stage: Stage,
        payload: ToolBundleUpdate,
        *,
        actor_id: str | None,
    ) -> ToolBundle:
        """Apply a Steward override for `stage`.

        Missing fields inherit from the previous effective row (override
        or default) so partial updates don't accidentally widen the
        bundle beyond the existing baseline.
        """
        if stage not in STAGES:
            raise ValueError(f"unknown_stage:{stage}")

        current = self.get_bundle(stage)
        new_permitted = (
            list(payload.permitted_tools)
            if payload.permitted_tools is not None
            else list(current["permitted_tools"])
        )
        new_denied = (
            list(payload.denied_tools)
            if payload.denied_tools is not None
            else list(current["denied_tools"])
        )
        new_rationale = (
            payload.rationale if payload.rationale is not None else current["rationale"]
        )

        # Sanity: no tool can be both permitted and denied.
        overlap = set(new_permitted) & set(new_denied)
        if overlap:
            raise ValueError("tool_in_both_lists:" + ",".join(sorted(overlap)))

        self._overrides[stage] = _OverrideRow(
            stage=stage,
            permitted_tools=new_permitted,
            denied_tools=new_denied,
            rationale=new_rationale,
            updated_at=datetime.now(timezone.utc).isoformat(),
            updated_by=actor_id,
        )

        logger.info(
            "tool_bundle.overridden",
            stage=stage,
            permitted=new_permitted,
            denied=new_denied,
            actor_id=actor_id,
        )
        return self.get_bundle(stage)

    def reset(self, stage: Stage) -> None:
        """Drop any override and revert to the shipped default."""
        self._overrides.pop(stage, None)

    # -- enforcement --------------------------------------------------------

    async def enforce(
        self,
        *,
        agent_state: dict[str, Any],
        current_stage: Stage,
        attempted_tool: str,
        tenant_id: str | None = None,
        project_id: str | None = None,
        actor_id: str | None = None,
    ) -> ToolBundleDecision:
        """Check `attempted_tool` against the bundle for `current_stage`.

        Raises `ToolBundleViolation` when the tool is not permitted. Always
        writes an audit row capturing the agent, stage, attempted tool,
        and decision — both allows and denials are recorded (Rule 6).
        """
        bundle = self.get_bundle(current_stage)
        permitted = set(bundle["permitted_tools"])
        denied = set(bundle["denied_tools"])

        agent_id = (
            agent_state.get("agent_id")
            or agent_state.get("agent")
            or agent_state.get("id")
        )
        agent_id_str = str(agent_id) if agent_id is not None else None

        # Decide: denied-list always wins (deny takes precedence over allow).
        if attempted_tool in denied:
            allowed = False
            reason = f"tool:{attempted_tool} denied in stage:{current_stage}"
        elif attempted_tool in permitted:
            allowed = True
            reason = f"tool:{attempted_tool} permitted in stage:{current_stage}"
        else:
            # Not in either list → conservative default: deny.
            allowed = False
            reason = (
                f"tool:{attempted_tool} not permitted in stage:{current_stage}"
            )

        decision = ToolBundleDecision(
            allowed=allowed,
            stage=current_stage,
            tool=attempted_tool,
            reason=reason,
            agent_id=agent_id_str,
            audit_event_id=None,
        )

        # Always write an audit row (allow + deny). Use a zero-uuid
        # fallback when no tenant/project context is provided so the
        # NOT NULL constraint on project_id is still satisfied.
        eff_tenant = tenant_id or "00000000-0000-0000-0000-000000000000"
        eff_project = project_id or "00000000-0000-0000-0000-000000000000"
        event_uuid = uuid4().hex

        try:
            await audit_service.record(
                tenant_id=eff_tenant,
                project_id=eff_project,
                actor_id=actor_id or agent_id_str,
                action="tool_bundle.allow" if allowed else "tool_bundle.violation",
                target_type="tool_bundle",
                target_id=f"{current_stage}:{attempted_tool}",
                payload={
                    "stage": current_stage,
                    "attempted_tool": attempted_tool,
                    "agent_id": agent_id_str,
                    "decision": "allow" if allowed else "deny",
                    "reason": reason,
                    "permitted": sorted(permitted),
                    "denied": sorted(denied),
                    "event_id": event_uuid,
                },
            )
            decision.audit_event_id = event_uuid
        except Exception as exc:  # noqa: BLE001
            # Audit failures must never mask the enforcement verdict for
            # the caller, but they need to be visible in the log so
            # operators can chase the audit row that didn't land.
            logger.error(
                "tool_bundle.audit_failed",
                stage=current_stage,
                tool=attempted_tool,
                error=str(exc),
            )

        if not allowed:
            raise ToolBundleViolation(
                stage=current_stage,
                tool=attempted_tool,
                agent_id=agent_id_str,
                reason=reason,
            )
        return decision


tool_bundles = ToolBundleRegistry()


__all__ = [
    "DEFAULT_BUNDLES",
    "ToolBundle",
    "ToolBundleRegistry",
    "ToolBundleViolation",
    "tool_bundles",
]