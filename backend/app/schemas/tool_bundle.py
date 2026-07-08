"""F-505 — Per-Agent Tool Bundle schemas (plan 01-06).

The existing :mod:`app.schemas.tool_bundles` schema is stage-keyed
(``Stage = Literal["ideation","architecture",...]``) and powers the
pre-existing ``ToolBundleRegistry.enforce(...)`` path in
``app.services.tool_bundles``. That path is the runtime hook on the
``agent_runtime.invoke_tool`` boundary.

This module is the **per-agent** view: bundles are keyed by agent
name (``code_validator``, ``merge_gate``, ``refactor_agent``, ...)
and surfaced to the MCP router as the
``enforceToolBundle(agentName, toolName)`` gate. Same least-privilege
intent, different boundary — kept distinct so neither caller breaks.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class ToolBundle(BaseModel):
    """The allowed-tool set for a single agent.

    Rule 2 strictness: ``agent_name`` and ``allowed_tools`` are
    required (no ``= None`` defaults) so an under-specified bundle
    fails validation at construction time.
    """

    model_config = ConfigDict(extra="forbid")

    agent_name: str = Field(..., min_length=1, max_length=128)
    allowed_tools: list[str] = Field(..., min_length=0)
    description: str | None = None


class ToolBundlesRegistry(BaseModel):
    """Per-agent tool-bundle registry.

    ``default_allow`` is ``False`` so an agent not listed in
    ``bundles`` gets an empty allowed-set (least privilege). The MCP
    router consults :meth:`is_tool_allowed` before every dispatch and
    raises ``ToolBundleViolationError`` when the lookup denies.
    """

    model_config = ConfigDict(extra="forbid")

    bundles: dict[str, ToolBundle]
    default_allow: bool = False

    def is_tool_allowed(self, agent_name: str, tool_name: str) -> bool:
        """Return ``True`` iff ``tool_name ∈ bundle.allowed_tools``.

        Unknown agent → uses ``default_allow``. Unknown tool on a known
        agent → ``False``.
        """
        bundle = self.bundles.get(agent_name)
        if bundle is None:
            return self.default_allow
        return tool_name in set(bundle.allowed_tools)


__all__ = ["ToolBundle", "ToolBundlesRegistry"]
