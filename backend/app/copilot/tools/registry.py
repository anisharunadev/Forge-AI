"""Tool registry + dispatcher (F-800 Plan 0.3).

The registry is the single dispatch surface for Co-pilot tool calls.
It is the only module that:

1. Looks up a tool by name.
2. Runs the RBAC check against :attr:`Tool.permission`.
3. Wraps the tool's :meth:`Tool.execute` in try/except and translates
   exceptions into ``is_error=True`` :class:`ToolResult` rows (or, for
   permission failures, the registry raises — the runtime layer
   decides whether to surface that as 403 or as a tool error).

Tools register themselves at module import time via
``tool_registry.register(tool_instance)``. The registry is idempotent
on duplicate names; the last registration wins and a warning is
logged so accidental shadowing is visible.
"""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from app.copilot.tools.base import Tool
from app.copilot.tools.exceptions import (
    ToolArgumentInvalid,
    ToolDenied,
    ToolDownstreamFailed,
    ToolError,
)
from app.core.logging import get_logger
from app.core.security import AuthenticatedPrincipal
from app.services._litellm_tools import ToolResult

logger = get_logger(__name__)


# Default rate limit applied to any tool that does not override it.
DEFAULT_RATE_LIMIT_PER_MIN = 10


class ToolRegistry:
    """In-memory map of tool name → tool instance.

    The registry is intentionally tiny: tools are stateless singletons
    loaded at import time. Tenant/project scoping happens at dispatch
    time, never at registration.
    """

    def __init__(self) -> None:
        self._tools: dict[str, Tool] = {}

    # ------------------------------------------------------------------
    # Registration
    # ------------------------------------------------------------------

    def register(self, tool: Tool) -> None:
        """Add or replace a tool in the registry.

        Args:
            tool: Any object that satisfies the :class:`Tool` Protocol.

        Raises:
            ValueError: If ``tool.name`` is missing or not a string.
        """
        name = getattr(tool, "name", None)
        if not isinstance(name, str) or not name:
            raise ValueError("tool.name must be a non-empty string")
        if not isinstance(getattr(tool, "permission", None), str):
            raise ValueError(f"tool {name!r} missing permission string")
        if name in self._tools:
            logger.warning(
                "copilot.tool_registry.duplicate",
                tool=name,
                previous=type(self._tools[name]).__name__,
                replacement=type(tool).__name__,
            )
        self._tools[name] = tool
        logger.info(
            "copilot.tool_registry.registered",
            tool=name,
            permission=getattr(tool, "permission", None),
            rate_limit_per_min=getattr(tool, "rate_limit_per_min", None),
        )

    def unregister(self, name: str) -> None:
        """Remove a tool from the registry (used by tests)."""
        self._tools.pop(name, None)

    def reset(self) -> None:
        """Clear the registry (used by tests)."""
        self._tools.clear()

    # ------------------------------------------------------------------
    # Lookup
    # ------------------------------------------------------------------

    def get(self, name: str) -> Tool:
        """Return the tool registered under ``name``.

        Raises:
            KeyError: If no tool is registered under that name.
        """
        try:
            return self._tools[name]
        except KeyError as exc:
            raise KeyError(f"no tool registered under {name!r}") from exc

    def has(self, name: str) -> bool:
        """Return True if a tool is registered under ``name``."""
        return name in self._tools

    def list_tools(self) -> list[Tool]:
        """Return all registered tools in registration order."""
        return list(self._tools.values())

    def list_specs(self) -> list[dict[str, Any]]:
        """Return OpenAI-compatible :class:`ToolSpec` dicts for every tool.

        The shape matches :class:`app.services._litellm_tools.ToolSpec`
        so the LiteLLM client can hand it directly to the upstream
        provider.
        """
        out: list[dict[str, Any]] = []
        for tool in self.list_tools():
            out.append(
                {
                    "type": "function",
                    "function": {
                        "name": tool.name,
                        "description": tool.description,
                        "parameters": dict(tool.parameters_schema or {}),
                    },
                }
            )
        return out

    # ------------------------------------------------------------------
    # Dispatch
    # ------------------------------------------------------------------

    async def dispatch(
        self,
        name: str,
        args: dict[str, Any],
        *,
        principal: AuthenticatedPrincipal,
        tenant_id: UUID,
        project_id: UUID | None,
    ) -> dict[str, Any]:
        """Look up the tool, check permission, and run it.

        The dispatcher raises on permission failure (caller maps to 403)
        and returns a JSON-serializable dict on success. Tool-layer
        exceptions (``ToolError`` subclasses) are caught and wrapped
        in :class:`ToolDownstreamFailed`; non-tool exceptions are
        logged with full traceback and also wrapped so the model never
        sees a raw stack trace.

        Args:
            name: Tool name (matches ``ToolCall.name`` from the model).
            args: Already-parsed arguments dict.
            principal: Authenticated caller. The dispatcher will
                check :attr:`Tool.permission` against this principal's
                role bundle via :func:`rbac.has_permission`.
            tenant_id: Authoritative tenant for the call.
            project_id: Optional project scope.

        Returns:
            JSON-serializable dict — the value that becomes the
            :class:`ToolResult.content` sent back to the model.

        Raises:
            KeyError: Unknown tool name (caller maps to 400).
            ToolDenied: The principal lacks the tool's permission.
        """
        tool = self.get(name)
        self._enforce_permission(tool, principal)

        try:
            result = await tool.execute(
                args,
                principal=principal,
                tenant_id=tenant_id,
                project_id=project_id,
            )
        except ToolError:
            # Subclasses (``ToolArgumentInvalid``, ``ToolDownstreamFailed``)
            # propagate as-is — the dispatcher wraps *unexpected* errors
            # below.
            raise
        except Exception as exc:  # noqa: BLE001 — broad catch is the contract
            logger.exception(
                "copilot.tool.unexpected_error",
                tool=name,
                tenant_id=str(tenant_id),
                principal=getattr(principal, "user_id", None),
            )
            raise ToolDownstreamFailed(name, str(exc) or exc.__class__.__name__, cause=exc) from exc
        if not isinstance(result, dict):
            raise ToolDownstreamFailed(
                name,
                f"tool returned {type(result).__name__}, expected dict",
            )
        return result

    async def dispatch_as_tool_result(
        self,
        name: str,
        tool_call_id: str,
        args: dict[str, Any],
        *,
        principal: AuthenticatedPrincipal,
        tenant_id: UUID,
        project_id: UUID | None,
    ) -> ToolResult:
        """Async wrapper that returns a :class:`ToolResult`.

        Used by callers that need the LiteLLM-shaped response envelope
        rather than the raw dict. Exceptions are caught and translated
        into ``is_error=True`` rows so the model can recover.
        """
        try:
            data = await self.dispatch(
                name,
                args,
                principal=principal,
                tenant_id=tenant_id,
                project_id=project_id,
            )
            return ToolResult(
                tool_call_id=tool_call_id,
                name=name,
                content=json.dumps(data, default=str),
                is_error=False,
            )
        except ToolDenied as exc:
            return ToolResult(
                tool_call_id=tool_call_id,
                name=name,
                content=f"permission denied: {exc.required_permission}",
                is_error=True,
            )
        except ToolArgumentInvalid as exc:
            return ToolResult(
                tool_call_id=tool_call_id,
                name=name,
                content=f"invalid arguments: {exc}",
                is_error=True,
            )
        except ToolDownstreamFailed as exc:
            return ToolResult(
                tool_call_id=tool_call_id,
                name=name,
                content=f"tool failed: {exc}",
                is_error=True,
            )
        except KeyError as exc:
            return ToolResult(
                tool_call_id=tool_call_id,
                name=name,
                content=f"unknown tool: {exc}",
                is_error=True,
            )

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    @staticmethod
    def _enforce_permission(tool: Tool, principal: AuthenticatedPrincipal) -> None:
        """Run the per-tool RBAC check.

        Imported lazily so :mod:`app.copilot.tools.registry` stays
        importable in unit-test contexts that mock RBAC out entirely.
        """
        from app.services.rbac import rbac

        if rbac.has_permission(principal, tool.permission):
            return
        raise ToolDenied(tool.name, tool.permission)


# Module-level singleton — populated by side-effect imports in
# :mod:`app.copilot.tools`.
tool_registry = ToolRegistry()


__all__ = ["ToolRegistry", "tool_registry", "DEFAULT_RATE_LIMIT_PER_MIN"]
