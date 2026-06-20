"""
In-process MCP client.

We speak JSON-RPC 2.0 line-delimited to a server subprocess over its
stdin/stdout. This matches the MCP stdio transport, so the same client
would work against a real MCP server launched via the official SDK.

The client is intentionally simple: open the subprocess, send one
JSON object per line, read one JSON object per line, dispatch by id.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


class McpError(RuntimeError):
    """Raised when the MCP server returns a JSON-RPC error or the call times out."""

    def __init__(self, code: int, message: str, data: Any = None) -> None:
        super().__init__(f"MCP error {code}: {message}")
        self.code = code
        self.message = message
        self.data = data


@dataclass
class McpCall:
    """One tool invocation the client has issued. Used for audit logs."""

    tool: str
    arguments: Dict[str, Any]
    result: Any = None
    error: Optional[str] = None
    duration_ms: float = 0.0
    started_at: float = field(default_factory=time.time)


class StdioMcpClient:
    """Owns a child MCP server process and dispatches tool calls to it."""

    def __init__(self, name: str, command: List[str], env: Optional[Dict[str, str]] = None,
                 cwd: Optional[str] = None, request_timeout: float = 30.0) -> None:
        self.name = name
        self._command = command
        self._request_timeout = request_timeout
        self._proc: Optional[subprocess.Popen] = None
        self._lock = threading.Lock()
        self._next_id = 1
        self._calls: List[McpCall] = []
        merged_env = os.environ.copy()
        if env:
            merged_env.update(env)
        self._env = merged_env
        self._cwd = cwd

    # -- lifecycle ----------------------------------------------------------

    def start(self) -> None:
        if self._proc is not None:
            return
        self._proc = subprocess.Popen(
            self._command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=self._env,
            cwd=self._cwd,
            text=True,
            bufsize=1,
        )
        # Send initialize so the server is fully booted before any tool call.
        self._request("initialize", {
            "protocolVersion": "2024-11-05",
            "clientInfo": {"name": "fora-ideation-agent", "version": "0.1.0"},
            "capabilities": {},
        })

    def stop(self) -> None:
        if self._proc is None:
            return
        try:
            self._proc.stdin.close()
        except Exception:  # noqa: BLE001
            pass
        try:
            self._proc.wait(timeout=5.0)
        except subprocess.TimeoutExpired:
            self._proc.kill()
        # Drain stderr so it doesn't fill the pipe buffer.
        try:
            err = self._proc.stderr.read() if self._proc.stderr else ""
        except Exception:  # noqa: BLE001
            err = ""
        if err:
            sys.stderr.write(f"[{self.name} stderr] {err}\n")
        self._proc = None

    def __enter__(self) -> "StdioMcpClient":
        self.start()
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.stop()

    # -- call surface -------------------------------------------------------

    def call(self, tool_name: str, arguments: Optional[Dict[str, Any]] = None) -> Any:
        """Invoke a tool and return the structuredContent payload."""
        arguments = arguments or {}
        call = McpCall(tool=tool_name, arguments=arguments)
        self._calls.append(call)
        t0 = time.time()
        try:
            payload = self._request("tools/call", {"name": tool_name, "arguments": arguments})
        except McpError as exc:
            call.error = str(exc)
            call.duration_ms = (time.time() - t0) * 1000
            raise
        call.result = payload.get("structuredContent", payload)
        call.duration_ms = (time.time() - t0) * 1000
        return call.result

    def list_tools(self) -> List[Dict[str, Any]]:
        return self._request("tools/list", {}).get("tools", [])

    @property
    def call_log(self) -> List[McpCall]:
        return list(self._calls)

    # -- transport ----------------------------------------------------------

    def _request(self, method: str, params: Dict[str, Any]) -> Dict[str, Any]:
        if self._proc is None or self._proc.stdin is None or self._proc.stdout is None:
            raise McpError(-32000, f"client '{self.name}' is not started")
        with self._lock:
            rpc_id = self._next_id
            self._next_id += 1
            request = {"jsonrpc": "2.0", "id": rpc_id, "method": method, "params": params}
            line = json.dumps(request, separators=(",", ":"))
            assert self._proc.stdin is not None
            self._proc.stdin.write(line + "\n")
            self._proc.stdin.flush()
            # Read response lines until we find one matching our id.
            deadline = time.time() + self._request_timeout
            while True:
                if time.time() > deadline:
                    raise McpError(-32000, f"timeout waiting for response to {method}")
                response_line = self._proc.stdout.readline()
                if not response_line:
                    raise McpError(-32000, f"server closed stdout while waiting for {method}")
                try:
                    response = json.loads(response_line)
                except json.JSONDecodeError:
                    continue
                if response.get("id") == rpc_id:
                    break
            if "error" in response:
                err = response["error"]
                raise McpError(err.get("code", -32000), err.get("message", "unknown error"),
                               err.get("data"))
            return response.get("result", {})


# A stable identifier for idempotency keys; cheap to read in logs.
def new_idempotency_key() -> str:
    return uuid.uuid4().hex
