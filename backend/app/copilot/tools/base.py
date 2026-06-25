"""Base class for Co-pilot tools (F-800 Plan 0.3).

Every tool exposes:

- :attr:`name` — the canonical tool name the model calls (``search_knowledge``).
- :attr:`description` — surfaced in the function-calling schema.
- :attr:`permission` — the ``copilot:tool:<name>`` RBAC permission.
- :attr:`rate_limit_per_min` — soft cap used by the runtime layer.
- :attr:`parameters_schema` — JSON Schema for the args (passed through
  to :class:`app.services._litellm_tools.ToolSpec`).

Subclasses implement :meth:`execute` which returns a JSON-serializable
dict. The dict becomes the ``content`` of the :class:`ToolResult` row
the model reads.

The registry (:mod:`app.copilot.tools.registry`) is responsible for
permission checks and tenant scoping; :meth:`Tool.execute` may assume
its caller has already been authorised and that ``tenant_id`` is
authoritative.
"""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable
from uuid import UUID

from app.core.security import AuthenticatedPrincipal


@runtime_checkable
class Tool(Protocol):
    """A typed contract every Co-pilot tool implements.

    Tools are intentionally Protocol-shaped (rather than ABC) so the
    registry can accept either hand-rolled classes *or* the lightweight
    dataclass-based implementations used in tests.
    """

    name: str
    description: str
    permission: str
    rate_limit_per_min: int
    parameters_schema: dict[str, Any]

    async def execute(
        self,
        args: dict[str, Any],
        *,
        principal: AuthenticatedPrincipal,
        tenant_id: UUID,
        project_id: UUID | None,
    ) -> dict[str, Any]:
        """Run the tool and return a JSON-serializable result.

        Args:
            args: The arguments supplied by the model. Already parsed
                from JSON; the tool may assume basic JSON-Schema shape
                was checked upstream by :meth:`ToolRegistry.dispatch`.
            principal: The authenticated caller. Use ``principal.user_id``
                for audit attribution; ``principal.roles`` for additional
                in-tool gating when needed.
            tenant_id: The authoritative tenant (Rule 2). All DB
                operations **must** be scoped by this id.
            project_id: The optional project scope. ``None`` for
                tenant-wide threads (org standards, policy Q&A).

        Returns:
            A JSON-serializable dict that the model can read. Keep the
            shape stable — downstream prompt engineering depends on it.

        Raises:
            app.copilot.tools.exceptions.ToolDenied: When the caller
                lacks an additional in-tool permission the registry
                could not check (rare — most per-tool checks live in
                ``permission``).
            app.copilot.tools.exceptions.ToolArgumentInvalid: When a
                required argument is missing or malformed.
            app.copilot.tools.exceptions.ToolDownstreamFailed: When a
                downstream service raised unexpectedly. The registry
                wraps unexpected exceptions itself; raise this only
                for *intentional* failure-mapping.
        """
        ...


__all__ = ["Tool"]
