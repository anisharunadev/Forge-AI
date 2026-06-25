"""Exceptions raised by the Co-pilot tool layer.

These are caught by :class:`app.copilot.tools.registry.ToolRegistry.dispatch`
and translated into ``is_error=True`` :class:`ToolResult` rows so the
model can recover (the LiteLLM tool-calling loop surfaces the error
content back to the model and lets it retry or surface the failure to
the user).
"""

from __future__ import annotations


class ToolError(Exception):
    """Base class for all tool-layer failures.

    Subclasses are mapped to error messages the model can read; they
    are NEVER silently swallowed by the registry.
    """


class ToolDenied(ToolError):
    """The principal lacks the permission required to invoke this tool.

    Carries the missing permission so callers can render a 403-style
    message without exposing the full RBAC catalog.
    """

    def __init__(self, tool_name: str, required_permission: str) -> None:
        super().__init__(
            f"permission denied for tool {tool_name!r}: missing {required_permission!r}"
        )
        self.tool_name = tool_name
        self.required_permission = required_permission


class ToolArgumentInvalid(ToolError):
    """The arguments supplied by the model failed validation.

    Carries the offending field path so the model can self-correct on
    the next turn.
    """

    def __init__(self, tool_name: str, message: str, *, field: str | None = None) -> None:
        prefix = f"{tool_name}: {message}"
        if field:
            prefix = f"{tool_name}.{field}: {message}"
        super().__init__(prefix)
        self.tool_name = tool_name
        self.field = field


class ToolDownstreamFailed(ToolError):
    """A downstream service raised an unexpected exception.

    The registry wraps service-layer exceptions so the model gets a
    clean error message and the underlying stack trace is preserved in
    the server log (the ``logger.exception`` call in dispatch).
    """

    def __init__(self, tool_name: str, message: str, *, cause: Exception | None = None) -> None:
        super().__init__(f"{tool_name}: {message}")
        self.tool_name = tool_name
        self.__cause__ = cause


__all__ = [
    "ToolError",
    "ToolDenied",
    "ToolArgumentInvalid",
    "ToolDownstreamFailed",
]
