"""MCP client tool — wraps an MCP server connection.

Used by Architecture, Implementation, and Review nodes to read project
context (code map, doc graph, recent activity) from MCP servers such
as ``mcp_code_search`` and ``mcp_knowledge``.

The implementation here is a minimal in-process shim that mirrors the
public surface of the ``packages/mcp-router`` package. Once that
package is published, swap the import in :meth:`__init__` and behavior
will be identical.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any


@dataclass(slots=True)
class MCPTool:
    """A single tool exposed by an MCP server."""

    name: str
    description: str
    input_schema: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class MCPResult:
    """Outcome of an MCP server call."""

    server: str
    method: str
    ok: bool
    output: Any = None
    error: str | None = None


# Handler signature: (server, method, params) -> MCPResult
ServerHandler = Callable[[str, str, dict[str, Any]], Awaitable[MCPResult]]


class MCPClient:
    """Minimal MCP server router used by SDLC phase nodes.

    Methods
    -------
    call_server(server_name, method, params)
        Dispatch a call. In production this is bridged to the real
        ``packages/mcp-router`` client; tests can supply a custom
        ``server_handlers`` mapping to stub specific servers.
    list_tools(server_name)
        Return the tool catalog for a server (used at node startup).
    register(server_name, handler)
        Test/extension hook to add a server without touching the global
        registry.
    """

    def __init__(
        self,
        *,
        server_handlers: dict[str, ServerHandler] | None = None,
        timeout_seconds: float = 30.0,
    ) -> None:
        self._server_handlers: dict[str, ServerHandler] = dict(server_handlers or {})
        self._timeout = timeout_seconds

    # ---- Public API ----------------------------------------------------

    def register(self, server_name: str, handler: ServerHandler) -> None:
        """Register (or replace) the handler for a server name."""

        self._server_handlers[server_name] = handler

    async def call_server(
        self,
        server_name: str,
        method: str,
        params: dict[str, Any] | None = None,
    ) -> MCPResult:
        """Dispatch ``method`` on ``server_name`` with ``params``."""

        handler = self._server_handlers.get(server_name)
        if handler is None:
            return MCPResult(
                server=server_name,
                method=method,
                ok=False,
                error=f"no_handler:{server_name}",
            )
        try:
            return await asyncio.wait_for(
                handler(server_name, method, dict(params or {})),
                timeout=self._timeout,
            )
        except TimeoutError:
            return MCPResult(
                server=server_name,
                method=method,
                ok=False,
                error="timeout",
            )
        except Exception as exc:  # noqa: BLE001 — surfaced as MCPResult
            return MCPResult(
                server=server_name,
                method=method,
                ok=False,
                error=f"{type(exc).__name__}: {exc}",
            )

    async def list_tools(self, server_name: str) -> list[MCPTool]:
        """Return the static tool catalog for ``server_name``.

        Real clients would call ``tools/list``; we keep this static for
        the in-process shim. Tests can extend the catalog.
        """

        handler = self._server_handlers.get(server_name)
        if handler is None:
            return []
        # Convention: a ``__catalog__`` method returns ``list[MCPTool]``.
        result = await handler(server_name, "__catalog__", {})
        if result.ok and isinstance(result.output, list):
            return [t for t in result.output if isinstance(t, MCPTool)]
        return []


# ---- Sensible defaults so node code can call without setup -------------

DEFAULT_CATALOG: dict[str, list[MCPTool]] = {
    "mcp_code_search": [
        MCPTool(
            name="search_code",
            description="Search the project source by query and language.",
            input_schema={
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "language": {"type": "string"},
                    "limit": {"type": "integer", "default": 25},
                },
                "required": ["query"],
            },
        ),
        MCPTool(
            name="get_symbol",
            description="Resolve a symbol by name path.",
            input_schema={
                "type": "object",
                "properties": {
                    "name_path": {"type": "string"},
                },
                "required": ["name_path"],
            },
        ),
    ],
    "mcp_knowledge": [
        MCPTool(
            name="query_graph",
            description="Run a Cypher query against the knowledge graph.",
            input_schema={
                "type": "object",
                "properties": {"cypher": {"type": "string"}},
                "required": ["cypher"],
            },
        ),
    ],
    "mcp_aws": [
        MCPTool(
            name="list_stacks",
            description="List CloudFormation stacks.",
            input_schema={"type": "object", "properties": {}},
        ),
    ],
    "mcp_argocd": [
        MCPTool(
            name="list_applications",
            description="List Argo CD applications.",
            input_schema={"type": "object", "properties": {}},
        ),
    ],
    "mcp_kubernetes": [
        MCPTool(
            name="list_pods",
            description="List pods in a namespace.",
            input_schema={
                "type": "object",
                "properties": {"namespace": {"type": "string"}},
            },
        ),
    ],
}


async def _default_server_handler(server: str, method: str, params: dict[str, Any]) -> MCPResult:
    """Echo-catalog handler — returns the static catalog for ``__catalog__``."""

    if method == "__catalog__":
        return MCPResult(
            server=server, method=method, ok=True, output=DEFAULT_CATALOG.get(server, [])
        )
    return MCPResult(
        server=server,
        method=method,
        ok=True,
        output={
            "stub": True,
            "server": server,
            "method": method,
            "params": params,
        },
    )


def build_default_mcp_client() -> MCPClient:
    """Construct an MCPClient with the default catalog wired in."""

    client = MCPClient()
    for server in DEFAULT_CATALOG:
        client.register(server, _default_server_handler)
    return client


def result_to_json(result: MCPResult) -> str:
    """Convenience serializer for tool output."""

    payload = {
        "server": result.server,
        "method": result.method,
        "ok": result.ok,
        "output": result.output,
        "error": result.error,
    }
    return json.dumps(payload, default=str)


__all__ = [
    "MCPClient",
    "MCPTool",
    "MCPResult",
    "ServerHandler",
    "build_default_mcp_client",
    "result_to_json",
]
