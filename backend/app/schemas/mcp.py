"""step-78 Phase 2 — Typed artifacts for the MCP surface.

Spec §Feature 8 contract. ``MCPServerRegistration`` and
``MCPServerRead`` are distinct from the existing
:mod:`app.schemas.marketplace` types — these are the per-tenant
registry (admin-owned), not the public marketplace catalog.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import Field

from app.schemas.common import ForgeBaseModel

MCPTransport = Literal["stdio", "sse", "websocket"]
MCPAuthKind = Literal["none", "oauth", "api_key", "jwt"]
MCPAuthStatus = Literal["connected", "expired", "needs_reauth", "not_connected"]


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
    extra: dict[str, Any] = Field(default_factory=dict)


class MCPServerRead(ForgeBaseModel):
    id: str
    name: str
    transport: MCPTransport = "stdio"
    url: str | None = None
    command: str | None = None
    auth_kind: MCPAuthKind = "none"
    auth_status: MCPAuthStatus = "not_connected"
    tools_allowlist: list[str] = Field(default_factory=list)
    tools_denylist: list[str] = Field(default_factory=list)
    healthcheck_url: str | None = None
    # The Forge secret store never returns raw tokens (AC #5, anti-pattern).
    extra: dict[str, Any] = Field(default_factory=dict)


class MCPServerTest(ForgeBaseModel):
    """Result of ``POST /api/v1/mcp/servers/{id}/test``. AC #7."""

    server_id: str
    reachable: bool
    latency_ms: int = 0
    tool_count: int = 0
    sample_tools: list[str] = Field(default_factory=list)
    error: str | None = None


class MCPToolCallRequest(ForgeBaseModel):
    """Body of the internal ``POST /api/v1/mcp/call`` (chat loop)."""

    server_id: str
    tool_name: str
    arguments: dict[str, Any] = Field(default_factory=dict)
    request_id: str | None = None


class MCPToolCallResult(ForgeBaseModel):
    server_id: str
    tool_name: str
    result: Any = None
    is_error: bool = False
    duration_ms: int = 0
    status: str = "ok"


class MCPAuthStatusRead(ForgeBaseModel):
    """``GET /api/v1/mcp/servers/{id}/auth/status`` (no tokens)."""

    server_id: str
    auth_status: MCPAuthStatus
    reauth_url: str | None = None


class MCPToolDispatch(ForgeBaseModel):
    """One enumerated MCP tool (for tool palette composition)."""

    name: str
    server_id: str
    description: str = ""
    parameters: dict[str, Any] = Field(default_factory=dict)
    requires_approval: bool = False


class MCPChatLoopConfig(ForgeBaseModel):
    """Configuration block for the per-agent MCP chat loop."""

    max_iterations: int = Field(default=10, ge=1, le=64)
    timeout_seconds: float = Field(default=60.0, gt=0.0)


class MCPAuthExpiredError(ForgeBaseModel):
    """Typed error envelope for AC #5."""

    code: str = "mcp_auth_expired"
    server_id: str
    reauth_url: str | None = None


class MCPToolTimeoutError(ForgeBaseModel):
    """Typed error envelope for AC #10 / general timeouts."""

    code: str = "mcp_tool_timeout"
    server_id: str
    tool_name: str
    duration_ms: int


class MCPHubEntry(ForgeBaseModel):
    """Public MCP hub entry. AC #10 — read within 500ms."""

    id: str
    name: str
    description: str = ""
    category: str | None = None
    transport: MCPTransport = "stdio"
    auth_kind: MCPAuthKind = "none"


__all__ = [
    "MCPAuthExpiredError",
    "MCPAuthKind",
    "MCPAuthStatus",
    "MCPAuthStatusRead",
    "MCPChatLoopConfig",
    "MCPHubEntry",
    "MCPServerRead",
    "MCPServerRegistration",
    "MCPServerTest",
    "MCPToolCallRequest",
    "MCPToolCallResult",
    "MCPToolDispatch",
    "MCPToolTimeoutError",
    "MCPTransport",
]
