"""Co-pilot tool: ``navigate_to``.

Generates a deep-link URL the Forge UI can use to navigate the user
to a known entity (service, adr, repo, command, or arbitrary page).
The tool does NOT actually navigate (it cannot — server-side) — it
returns a structured URL the client interprets.

Deep links are intentionally simple path-based URLs; the Forge Next.js
app router resolves them. No external redirects; no privilege changes.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from app.core.logging import get_logger
from app.core.security import AuthenticatedPrincipal
from app.copilot.tools.base import Tool
from app.copilot.tools.exceptions import ToolArgumentInvalid
from app.copilot.tools.registry import tool_registry
from app.services.rbac import COPILOT_PERMISSION_TOOL_NAVIGATE_TO

logger = get_logger(__name__)


_TARGET_TYPE_TO_PATH: dict[str, str] = {
    "service": "/architecture/services",
    "adr": "/architecture/adrs",
    "repo": "/project-intelligence/repos",
    "command": "/forge-command-center/commands",
    "page": "",
}


class NavigateToTool:
    """Build a deep-link URL for the Forge UI to follow."""

    name = "navigate_to"
    description = (
        "Build a deep-link URL pointing at a known entity in the Forge "
        "UI. The client renders the URL as a clickable suggestion so the "
        "user can navigate to the referenced service / ADR / repo / "
        "command / page. This tool does not perform the navigation "
        "itself — it only returns the URL."
    )
    permission = COPILOT_PERMISSION_TOOL_NAVIGATE_TO
    rate_limit_per_min = 30
    parameters_schema: dict[str, Any] = {
        "type": "object",
        "properties": {
            "target_type": {
                "type": "string",
                "enum": sorted(_TARGET_TYPE_TO_PATH.keys()),
            },
            "target_id": {"type": "string"},
            "path": {"type": "string", "description": "Explicit path for target_type=page."},
        },
        "required": ["target_type"],
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
        target_type = args.get("target_type")
        if target_type not in _TARGET_TYPE_TO_PATH:
            raise ToolArgumentInvalid(
                self.name,
                f"target_type must be one of {sorted(_TARGET_TYPE_TO_PATH)}",
                field="target_type",
            )
        if target_type == "page":
            path = args.get("path")
            if not isinstance(path, str) or not path.startswith("/"):
                raise ToolArgumentInvalid(
                    self.name,
                    "path is required (leading slash) for target_type=page",
                    field="path",
                )
            url = path
        else:
            target_id = args.get("target_id")
            if not isinstance(target_id, str) or not target_id.strip():
                raise ToolArgumentInvalid(
                    self.name,
                    f"target_id is required for target_type={target_type}",
                    field="target_id",
                )
            url = f"{_TARGET_TYPE_TO_PATH[target_type]}/{target_id.strip()}"
        logger.info(
            "copilot.tool.navigate_to",
            tenant_id=str(tenant_id),
            principal=principal.user_id,
            target_type=target_type,
            target_id=args.get("target_id"),
        )
        return {"url": url, "deep_link": True}


tool_registry.register(NavigateToTool())


__all__ = ["NavigateToTool"]
