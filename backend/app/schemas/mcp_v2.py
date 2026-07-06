"""step-77 Slice 4 — Typed artifacts for the MCP dispatch surface.

Mirror of :mod:`app.schemas.guardrails` and
:mod:`app.schemas.policies` for the Phase 2 Feature 8 contract.

Rules respected:
* Rule 4 — typed artifacts only; routers never return free-form dicts.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import Field

from app.schemas.common import ForgeBaseModel
from app.schemas.litellm_common import ToolKind

# ---------------------------------------------------------------------
# Server registration
# ---------------------------------------------------------------------


MCPAuthKind = Literal["none", "oauth", "api_key", "jwt"]
MCPTransport = Literal["stdio", "sse", "websocket"]


class MCPServerRegistration(ForgeBaseModel):
    """Body of ``POST /api/v1/mcp/servers`` (admin)."""

    name: str = Field(min_length=1, max_length=128)
    transport: MCPTransport = "stdio"
    url: str | None = None
    command: str | None = None
    auth_kind: MCPAuthKind = "none"
    auth_config: dict[str, Any] = Field(default_factory=dict)
    tools_allowlist: list[str] | None = None
    tools_denylist: list[str] | None = None
    healthcheck_url: str | None = None


class MCPServerRead(ForgeBaseModel):
    """One server's read shape — never includes secrets.

    spec AC: ``MCPAuthExpired`` envelopes never carry tokens; only
    ``connected | expired | needs_reauth | not_connected`` is returned
    from any auth surface.
    """

    id: str
    name: str
    display_name: str | None = None
    transport: MCPTransport = "stdio"
    url: str | None = None
    auth_kind: MCPAuthKind = "none"
    auth_status: Literal["connected", "expired", "needs_reauth", "not_connected"] = "not_connected"
    tools_allowlist: list[str] | None = None
    tools_denylist: list[str] | None = None
    reachable: bool | None = None
    tool_count: int = 0
    last_checked_at: datetime | None = None


class MCPServerTestResult(ForgeBaseModel):
    """Body of ``POST /api/v1/mcp/servers/{id}/test``."""

    server_id: str
    reachable: bool
    latency_ms: int = 0
    tool_count: int = 0
    sample_tools: list[str] = Field(default_factory=list)
    error: str | None = None


class MCPServerAuthStatus(ForgeBaseModel):
    """``GET /api/v1/mcp/servers/{id}/auth/status`` — token-free surface."""

    server_id: str
    auth_kind: MCPAuthKind
    status: Literal["connected", "expired", "needs_reauth", "not_connected"] = "not_connected"
    reauth_url: str | None = None


# ---------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------


class MCPToolRead(ForgeBaseModel):
    """One tool enumeration row."""

    name: str
    kind: ToolKind = "mcp"
    server_id: str
    description: str | None = None
    parameters: dict[str, Any] = Field(default_factory=dict)
    requires_approval: bool = False
    version: str | None = None


class MCPToolCallRequest(ForgeBaseModel):
    """Body of the internal dispatch ``POST /api/v1/mcp/call``.

    Used by the chat loop in :class:`forge_chat` (spec §"Tool loop").
    """

    server_id: str
    tool_name: str
    arguments: dict[str, Any] = Field(default_factory=dict)
    request_id: str | None = None
    timeout_seconds: float | None = None


class MCPToolCallResult(ForgeBaseModel):
    """Result envelope."""

    result: Any | None = None
    is_error: bool = False
    duration_ms: int = 0
    error: str | None = None


# ---------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------


class MCPAuthExpiredError(ForgeBaseModel):
    """spec §"Error envelope" — 401 with reauth_url, no token."""

    code: str = "mcp_auth_expired"
    server_id: str
    reauth_url: str | None = None
    occurred_at: datetime


class MCPToolTimeoutError(ForgeBaseModel):
    """spec §"Error envelope" — 504."""

    code: str = "mcp_tool_timeout"
    server_id: str
    tool_name: str
    duration_ms: int
    occurred_at: datetime


__all__ = [
    "MCPAuthExpiredError",
    "MCPServerAuthStatus",
    "MCPServerRead",
    "MCPServerRegistration",
    "MCPServerTestResult",
    "MCPToolCallRequest",
    "MCPToolCallResult",
    "MCPToolRead",
    "MCPToolTimeoutError",
]
