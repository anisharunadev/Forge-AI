"""Schemas for F-015 — Connector Marketplace."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from pydantic import Field

from app.schemas.common import ForgeBaseModel


class MarketplaceConnectorRead(ForgeBaseModel):
    slug: str
    name: str
    type: str
    description: str
    config_schema: dict[str, Any]
    icon: str | None = None
    version: str
    author: str
    downloads: int
    rating: float


class MarketplaceInstallRequest(ForgeBaseModel):
    project_id: UUID
    name: str = Field(..., min_length=1, max_length=200)
    config: dict[str, Any] = Field(default_factory=dict)


class MarketplaceInstallResult(ForgeBaseModel):
    slug: str
    connector_id: UUID
    installed_at: str


# ---------------------------------------------------------------------------
# MCP registry schemas (M2 / Forge AI v2.0)
# ---------------------------------------------------------------------------


class MCPServerRead(ForgeBaseModel):
    """Read model for a registered MCP server."""

    name: str
    display_name: str
    description: str
    category: str
    version: str
    auth_methods: list[str]
    config_schema: dict[str, Any]
    capabilities: list[str]
    rate_limits: dict[str, Any] | None = None
    icon: str | None = None
    docs_url: str | None = None
    installable: bool = True
    tags: list[str] = Field(default_factory=list)


class MCPServerList(ForgeBaseModel):
    """Envelope for `GET /api/v1/mcp/servers`."""

    total: int
    items: list[MCPServerRead]


class MCPCategoryRead(ForgeBaseModel):
    """Read model for a single MCP category."""

    value: str
    name: str
