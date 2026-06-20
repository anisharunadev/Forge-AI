"""
Minimal JSON-RPC 2.0 server over stdio.

This is the wire protocol used by MCP (Model Context Protocol) servers.
We use the smallest possible implementation: a line-delimited JSON
protocol over stdin/stdout. A real MCP server would speak the same
shape, so swapping in the official SDK later is a no-op for callers.
"""

from __future__ import annotations

import json
import sys
import threading
import traceback
from typing import Any, Callable, Dict


class JsonRpcError(Exception):
    """Raised by tool implementations; mapped to a JSON-RPC error response."""

    def __init__(self, code: int, message: str, data: Any = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.data = data


# Standard JSON-RPC 2.0 error codes, plus a small set of MCP-flavored codes.
PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INVALID_PARAMS = -32602
INTERNAL_ERROR = -32603
# Application-defined codes (must be in -32000..-32099 per spec).
AUTH_MISSING = -32001
RATE_LIMITED = -32002
UPSTREAM_ERROR = -32003


class StdioJsonRpcServer:
    """Line-delimited JSON-RPC 2.0 server reading from stdin, writing to stdout.

    Each request is a single JSON object on its own line. The server replies
    with a single JSON object on its own line. Notifications (no `id`) receive
    no reply. This shape matches the MCP stdio transport.
    """

    def __init__(self, name: str, version: str) -> None:
        self.name = name
        self.version = version
        self._tools: Dict[str, Callable[[Dict[str, Any]], Any]] = {}

    def register(self, name: str, fn: Callable[[Dict[str, Any]], Any]) -> None:
        self._tools[name] = fn

    # -- lifecycle ----------------------------------------------------------

    def serve_forever(self) -> None:
        """Block reading stdin until EOF, dispatching each line as a request."""
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                request = json.loads(line)
            except json.JSONDecodeError as exc:
                self._write(self._error(None, PARSE_ERROR, f"parse error: {exc}"))
                continue
            response = self._handle(request)
            if response is not None:
                self._write(response)

    def handle_request_line(self, line: str) -> str | None:
        """Process a single request line; return the response line (or None for notifications)."""
        line = line.strip()
        if not line:
            return None
        try:
            request = json.loads(line)
        except json.JSONDecodeError as exc:
            return self._dump(self._error(None, PARSE_ERROR, f"parse error: {exc}"))
        return self._dump_or_none(self._handle(request))

    # -- internals ----------------------------------------------------------

    def _handle(self, request: Dict[str, Any]) -> Dict[str, Any] | None:
        if not isinstance(request, dict):
            return self._error(None, INVALID_REQUEST, "request must be an object")

        rpc_id = request.get("id")
        method = request.get("method")
        params = request.get("params") or {}

        if not isinstance(method, str):
            return self._error(rpc_id, INVALID_REQUEST, "method must be a string")
        if not isinstance(params, dict):
            return self._error(rpc_id, INVALID_PARAMS, "params must be an object")

        # A request with `id` present (including id=null) expects a response.
        # A request with `id` absent is a notification and gets no response.
        is_notification = "id" not in request

        if method == "initialize":
            return self._ok(rpc_id, {
                "protocolVersion": "2024-11-05",
                "serverInfo": {"name": self.name, "version": self.version},
                "capabilities": {"tools": {"listChanged": False}},
            })

        if method == "tools/list":
            tools = [
                {"name": name, "description": (fn.__doc__ or "").strip(),
                 "inputSchema": getattr(fn, "_input_schema", {"type": "object"})}
                for name, fn in sorted(self._tools.items())
            ]
            return self._ok(rpc_id, {"tools": tools})

        if method == "tools/call":
            return self._dispatch_tool(rpc_id, params)

        if is_notification:
            return None
        return self._error(rpc_id, METHOD_NOT_FOUND, f"unknown method: {method}")

    def _dispatch_tool(self, rpc_id: Any, params: Dict[str, Any]) -> Dict[str, Any]:
        name = params.get("name")
        arguments = params.get("arguments") or {}
        if not isinstance(name, str):
            return self._error(rpc_id, INVALID_PARAMS, "tool name must be a string")
        if name not in self._tools:
            return self._error(rpc_id, METHOD_NOT_FOUND, f"unknown tool: {name}")
        if not isinstance(arguments, dict):
            return self._error(rpc_id, INVALID_PARAMS, "arguments must be an object")
        try:
            result = self._tools[name](arguments)
        except JsonRpcError as exc:
            return self._error(rpc_id, exc.code, exc.message, exc.data)
        except Exception as exc:  # noqa: BLE001
            return self._error(
                rpc_id, INTERNAL_ERROR, f"tool '{name}' failed: {exc}",
                {"trace": traceback.format_exc().splitlines()[-3:]},
            )
        # MCP tools/call returns content blocks plus a structured payload.
        return self._ok(rpc_id, {
            "content": [{"type": "text", "text": json.dumps(result, indent=2, default=str)}],
            "structuredContent": result,
        })

    @staticmethod
    def _ok(rpc_id: Any, result: Any) -> Dict[str, Any]:
        return {"jsonrpc": "2.0", "id": rpc_id, "result": result}

    @staticmethod
    def _error(rpc_id: Any, code: int, message: str, data: Any = None) -> Dict[str, Any]:
        err: Dict[str, Any] = {"code": code, "message": message}
        if data is not None:
            err["data"] = data
        return {"jsonrpc": "2.0", "id": rpc_id, "error": err}

    def _write(self, response: Dict[str, Any]) -> None:
        sys.stdout.write(self._dump(response) + "\n")
        sys.stdout.flush()

    def _dump_or_none(self, response: Dict[str, Any] | None) -> str | None:
        if response is None:
            return None
        return self._dump(response)

    @staticmethod
    def _dump(response: Dict[str, Any]) -> str:
        return json.dumps(response, separators=(",", ":"))


def tool(name: str, description: str, input_schema: Dict[str, Any]):
    """Decorator that registers a tool and stamps its JSON Schema on the function."""

    def wrap(fn: Callable[[Dict[str, Any]], Any]) -> Callable[[Dict[str, Any]], Any]:
        fn.__name__ = name
        fn.__doc__ = description
        fn._input_schema = input_schema  # type: ignore[attr-defined]
        return fn

    return wrap
