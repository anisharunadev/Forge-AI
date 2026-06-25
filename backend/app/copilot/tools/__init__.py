"""F-800 — Co-pilot tool registry (Plan 0.3).

The 11 V1 tools from spec §3.3 live in this package. Each tool is a
concrete :class:`app.copilot.tools.base.Tool` implementation; the
:class:`app.copilot.tools.registry.ToolRegistry` is the single
dispatcher.

Importing :mod:`app.copilot.tools` populates :data:`tool_registry` —
caller code should always import the singleton, never ``register``
by hand at request time.

Modules:

- :mod:`app.copilot.tools.base` — :class:`Tool` Protocol
- :mod:`app.copilot.tools.registry` — :class:`ToolRegistry` + dispatch
- :mod:`app.copilot.tools.exceptions` — error types
- :mod:`app.copilot.tools.<tool_name>` — one module per tool

Exporting the populated registry::

    from app.copilot.tools import tool_registry
"""

from __future__ import annotations

from app.copilot.tools.base import Tool
from app.copilot.tools.registry import ToolRegistry, tool_registry

# Importing the tool modules triggers their ``register()`` call on
# ``tool_registry``. The order does not matter; the registry is
# idempotent on duplicate names.
from app.copilot.tools import (  # noqa: F401  (side-effect import)
    audit_event,
    check_budget,
    draft_artifact,
    get_adr,
    get_service,
    get_standards,
    get_template,
    list_recent_adrs,
    navigate_to,
    run_command,
    search_knowledge,
)


__all__ = ["Tool", "ToolRegistry", "tool_registry"]
