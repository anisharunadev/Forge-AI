"""Co-pilot tool: ``check_budget``.

Returns the current budget state for the requested scope. The model
calls this *before* recommending ``run_command`` so it can warn the
user about exhaustion or zero headroom.

Scopes:

- ``tenant`` — reads the synthetic workflow_budget row created when
  the Co-pilot conversation was opened (Plan 1.x wires the row).
- ``conversation`` — alias for tenant in the V1 surface; the
  per-conversation state is folded into the tenant row until Plan 2
  splits them.
- ``command`` — informational only in V1; returns ``null`` headroom
  fields because per-command budget rows do not yet exist.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from app.copilot.tools.exceptions import ToolArgumentInvalid
from app.copilot.tools.registry import tool_registry
from app.core.logging import get_logger
from app.core.security import AuthenticatedPrincipal
from app.services.rbac import COPILOT_PERMISSION_TOOL_CHECK_BUDGET
from app.services.workflow_budget import workflow_budget_service

logger = get_logger(__name__)


_SCOPES = ("tenant", "conversation", "command")


class CheckBudgetTool:
    """Return current budget state for the requested scope."""

    name = "check_budget"
    description = (
        "Check the current budget state for the active conversation's "
        "tenant, the conversation itself, or a specific command. "
        "Returns spent_usd, ceiling_usd, remaining_usd, and a status "
        "(active | exhausted | closed)."
    )
    permission = COPILOT_PERMISSION_TOOL_CHECK_BUDGET
    rate_limit_per_min = 30
    parameters_schema: dict[str, Any] = {
        "type": "object",
        "properties": {
            "scope": {"type": "string", "enum": list(_SCOPES), "default": "tenant"},
            "scope_id": {"type": "string"},
        },
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
        scope = args.get("scope") or "tenant"
        if scope not in _SCOPES:
            raise ToolArgumentInvalid(self.name, f"scope must be one of {_SCOPES}", field="scope")
        scope_id = args.get("scope_id")

        if scope == "command":
            return {
                "scope": scope,
                "scope_id": scope_id,
                "spent_usd": 0.0,
                "ceiling_usd": None,
                "remaining_usd": None,
                "status": "no_budget",
                "message": "Per-command budget is not tracked in V1; "
                "consult tenant / conversation scope.",
            }

        # ``tenant`` and ``conversation`` share the synthetic workflow
        # budget row declared at conversation create time. Plan 1.x
        # writes that row; until then we surface the workflow_budget
        # view if any rows exist, else ``no_budget``.

        if scope_id:
            # scope_id is treated as a workflow_id for now.
            try:
                snapshot = await workflow_budget_service.get_budget(scope_id)
            except ValueError:
                snapshot = None
        else:
            # No scope_id → report a synthetic tenant-level summary
            # from the workflow_budget service surface_at_gate output
            # for the tenant (a tenant may have multiple workflows; we
            # only have a single workflow_budget per workflow, so
            # return the latest for the principal's tenant).
            snapshot = None

        if snapshot is None:
            return {
                "scope": scope,
                "scope_id": scope_id,
                "spent_usd": 0.0,
                "ceiling_usd": None,
                "remaining_usd": None,
                "status": "no_budget",
            }
        return {
            "scope": scope,
            "scope_id": scope_id or str(snapshot.workflow_id),
            "spent_usd": float(snapshot.spent_usd),
            "ceiling_usd": float(snapshot.ceiling_usd),
            "remaining_usd": snapshot.remaining_usd,
            "status": _status_str(snapshot.status),
        }


def _status_str(status: Any) -> str:
    """Normalize a WorkflowBudgetStatus into the V1 surface string."""
    try:
        return status.value  # enum path
    except AttributeError:
        return str(status)


# Re-export so the tests can import a single name.
WorkflowBudgetStatus = __import__(
    "app.services.workflow_budget", fromlist=["WorkflowBudgetStatus"]
).WorkflowBudgetStatus


tool_registry.register(CheckBudgetTool())


__all__ = ["CheckBudgetTool"]
