"""Co-pilot tool: ``run_command``.

**Does NOT execute the command.** This tool validates that a
``forge-*`` command exists, that the principal has the RBAC
permission to run it, and that the workflow budget would permit the
estimated cost — then returns a confirmation envelope the user (or
a downstream gate) must approve before :func:`app.services.workflow_executor`
ever calls :func:`route_to_gsd`.

This is the constitutional Rule 3 enforcement point for command
execution from Co-pilot. The model can never reach an executing path
without an explicit human approval captured outside the model loop.

Side-effects list, cost, and duration are *estimates* — surfaced for
the user's review at the gate, not as a contract.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any
from uuid import UUID

from app.core.logging import get_logger
from app.core.security import AuthenticatedPrincipal
from app.copilot.tools.base import Tool
from app.copilot.tools.exceptions import (
    ToolArgumentInvalid,
    ToolDenied,
)
from app.copilot.tools.registry import tool_registry
from app.services.forge_commands import (
    UnknownForgeCommand,
    get_forge_command,
)
from app.services.rbac import (
    COPILOT_PERMISSION_TOOL_RUN_COMMAND,
    rbac,
)
from app.services.workflow_budget import workflow_budget_service

logger = get_logger(__name__)


_TIER_COST_ESTIMATE_USD: dict[str, Decimal] = {
    "user": Decimal("0.10"),
    "admin": Decimal("1.00"),
    "system": Decimal("5.00"),
}

_TIER_DURATION_ESTIMATE_SECONDS: dict[str, int] = {
    "user": 30,
    "admin": 120,
    "system": 300,
}


class RunCommandTool:
    """Validate + estimate a forge-* command run. Never executes."""

    name = "run_command"
    description = (
        "Propose running a forge-* command (e.g. forge-arch-adr, "
        "forge-dev-lint). Returns a confirmation envelope the user "
        "must approve. The command is NEVER executed from this tool — "
        "approval is required so the model loop cannot cross "
        "Architecture / Security / Deployment boundaries unilaterally."
    )
    permission = COPILOT_PERMISSION_TOOL_RUN_COMMAND
    rate_limit_per_min = 10
    parameters_schema: dict[str, Any] = {
        "type": "object",
        "properties": {
            "command_id": {
                "type": "string",
                "pattern": "^forge-[a-z][a-z0-9-]*$",
            },
            "inputs": {
                "type": "object",
                "additionalProperties": True,
                "default": {},
            },
        },
        "required": ["command_id"],
        "additionalProperties": False,
    }

    async def execute(
        self,
        args: dict[str, Any],
        *,
        principal: AuthenticatedPrincipal,
        tenant_id: UUID,
        project_id: UUID | None,
    ) -> dict[str, Any]:
        command_id = args.get("command_id")
        if not isinstance(command_id, str) or not command_id.strip():
            raise ToolArgumentInvalid(
                self.name, "command_id is required", field="command_id"
            )
        inputs = args.get("inputs") or {}
        if not isinstance(inputs, dict):
            raise ToolArgumentInvalid(
                self.name, "inputs must be an object", field="inputs"
            )

        try:
            cmd = get_forge_command(command_id)
        except UnknownForgeCommand as exc:
            raise ToolArgumentInvalid(
                self.name,
                f"unknown command_id: {command_id!r}",
                field="command_id",
            ) from exc

        # Per-command RBAC: ``forge:run:<forge_cmd>``. Tenant admins
        # already have it via the forge:admin / tenant:admin shortcut.
        run_perm = f"forge:run:{cmd.forge_cmd}"
        if not rbac.has_permission(principal, run_perm):
            raise ToolDenied(self.name, run_perm)

        # Cost / duration estimate is tier-based. We deliberately do
        # NOT call :func:`route_to_gsd` (would execute) or any
        # side-effecting estimator that hits the proxy.
        estimated_cost = _TIER_COST_ESTIMATE_USD.get(cmd.tier, Decimal("0.10"))
        estimated_duration = _TIER_DURATION_ESTIMATE_SECONDS.get(cmd.tier, 60)

        # Budget check is best-effort and informational. If the tenant
        # has no workflow budget declared, check_budget returns
        # ALLOWED with reason=no_budget_declared — we surface that to
        # the gate rather than failing here.
        try:
            budget_decision = await workflow_budget_service.check_budget(
                workflow_id=_budget_workflow_id(tenant_id, project_id, cmd.forge_cmd),
                projected_cost_usd=float(estimated_cost),
                actor_id=principal.user_id,
            )
            budget_state = {
                "decision": budget_decision.decision.value,
                "ceiling_usd": budget_decision.ceiling_usd,
                "spent_usd": budget_decision.spent_usd,
                "projected_cost_usd": budget_decision.projected_cost_usd,
                "reason": budget_decision.reason,
            }
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "copilot.tool.run_command.budget_check_failed",
                command=cmd.forge_cmd,
                error=str(exc),
            )
            budget_state = {"decision": "unknown", "reason": "budget_check_failed"}

        side_effects = _side_effects_for(cmd.category)

        logger.info(
            "copilot.tool.run_command.proposed",
            tenant_id=str(tenant_id),
            project_id=str(project_id) if project_id else None,
            principal=principal.user_id,
            command=cmd.forge_cmd,
            tier=cmd.tier,
            estimated_cost_usd=float(estimated_cost),
        )

        return {
            "confirmation_required": True,
            "command_id": cmd.forge_cmd,
            "internal_command_id": cmd.internal_cmd,
            "category": cmd.category,
            "tier": cmd.tier,
            "requires_approval": cmd.requires_approval,
            "inputs": dict(inputs),
            "estimated_cost_usd": float(estimated_cost),
            "estimated_duration_seconds": estimated_duration,
            "side_effects": side_effects,
            "approval_required": cmd.requires_approval,
            "budget": budget_state,
            "message": (
                "Command NOT executed. Approve at the confirmation gate "
                "to dispatch this forge-* command."
            ),
        }


def _budget_workflow_id(
    tenant_id: UUID, project_id: UUID | None, command_id: str
) -> str:
    """Build a stable workflow id for the synthetic budget check.

    The Co-pilot conversation declares a synthetic workflow_budget row
    (Plan 1.x) — until then, this derived id gives ``check_budget`` a
    deterministic handle so the same call repeats produce the same
    result.
    """
    raw = f"{tenant_id}|{project_id or 'tenant'}|{command_id}"
    # Stable UUID5-style fold (no external uuid5 dependency, use hash).
    import hashlib

    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]
    return f"{digest[0:8]}-{digest[8:12]}-{digest[12:16]}-{digest[16:20]}-{digest[20:32]}"


def _side_effects_for(category: str) -> list[str]:
    """Return the canonical list of side-effects for a category."""
    base: dict[str, list[str]] = {
        "onboarding": ["creates_gsd_config", "writes_initial_telemetry"],
        "intel": ["reads_repo", "updates_knowledge_graph"],
        "ideate": ["writes_ideation_records"],
        "arch": ["writes_adr", "updates_knowledge_graph"],
        "dev": ["modifies_working_tree", "writes_artifacts"],
        "test": ["runs_test_suite"],
        "sec": ["runs_security_scanners", "may_open_incident"],
        "review": ["posts_review_comments"],
        "deploy": ["promotes_build", "may_modify_production_state"],
        "milestone": ["tags_release", "archives_artifacts"],
        "learn": ["writes_lesson_records"],
        "flow": ["executes_workflow", "may_spawn_agents"],
        "env": ["modifies_environment_state"],
        "seed": ["applies_seed", "modifies_database_schema"],
    }
    return list(base.get(category, []))


tool_registry.register(RunCommandTool())


__all__ = ["RunCommandTool"]
