"""Connector Marketplace (F-015).

Catalog of installable connectors. The catalog is a static seed that
ships with the backend; installation routes through ConnectorManager
so every install produces an audited Connector row.

The list of *available* MCP servers is sourced from the central
`mcp_registry`. The marketplace `seed` table provides persistence
(downloads, ratings) for the subset that has a backing
MarketplaceConnector row, while `list_available_from_registry()`
returns every MCP server defined in the registry — even those without
a marketplace row yet — so the UI can render the full catalog.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional
from uuid import UUID

from sqlalchemy import select

from app.core.logging import get_logger
from app.db.models.connector import ConnectorType
from app.db.models.marketplace import MarketplaceConnector
from app.db.session import get_session_factory
from app.services.connector_manager import ConnectorManager, connector_manager
from app.services.mcp_registry import (
    MCPCategory,
    MCPServerDefinition,
    get_server as registry_get_server,
    list_categories as registry_list_categories,
    list_servers as registry_list_servers,
    to_dict as registry_to_dict,
)

logger = get_logger(__name__)


_SEED: list[dict[str, Any]] = [
    {
        "slug": "forge-github",
        "name": "GitHub",
        "type": "github",
        "description": "Sync issues, PRs, and code from GitHub repositories.",
        "config_schema": {
            "type": "object",
            "required": ["token", "repos"],
            "properties": {
                "token": {"type": "string"},
                "repos": {"type": "array", "items": {"type": "string"}},
            },
        },
        "icon": "github",
        "version": "1.0.0",
        "author": "forge",
    },
    {
        "slug": "forge-jira",
        "name": "Jira",
        "type": "jira",
        "description": "Sync issues and sprints from Atlassian Jira.",
        "config_schema": {
            "type": "object",
            "required": ["base_url", "token"],
            "properties": {
                "base_url": {"type": "string"},
                "token": {"type": "string"},
            },
        },
        "icon": "jira",
        "version": "1.0.0",
        "author": "forge",
    },
    {
        "slug": "forge-slack",
        "name": "Slack",
        "type": "slack",
        "description": "Send notifications and approvals to Slack channels.",
        "config_schema": {
            "type": "object",
            "required": ["bot_token", "default_channel"],
            "properties": {
                "bot_token": {"type": "string"},
                "default_channel": {"type": "string"},
            },
        },
        "icon": "slack",
        "version": "1.0.0",
        "author": "forge",
    },
    {
        "slug": "forge-figma",
        "name": "Figma",
        "type": "figma",
        "description": "Pull design tokens from Figma files.",
        "config_schema": {
            "type": "object",
            "required": ["token", "file_keys"],
            "properties": {
                "token": {"type": "string"},
                "file_keys": {"type": "array", "items": {"type": "string"}},
            },
        },
        "icon": "figma",
        "version": "1.0.0",
        "author": "forge",
    },
    {
        "slug": "forge-sonarqube",
        "name": "SonarQube",
        "type": "sonarqube",
        "description": "Surface code quality findings from SonarQube.",
        "config_schema": {
            "type": "object",
            "required": ["base_url", "token"],
            "properties": {
                "base_url": {"type": "string"},
                "token": {"type": "string"},
            },
        },
        "icon": "sonarqube",
        "version": "1.0.0",
        "author": "forge",
    },
]


class MarketplaceService:
    """Catalog browser + installer."""

    def __init__(self, connector_mgr: ConnectorManager | None = None) -> None:
        self._connectors = connector_mgr or connector_manager

    async def seed_if_empty(self) -> int:
        """Insert the static catalog once per database.

        Returns the number of rows inserted. Idempotent on the slug unique key.
        """
        factory = get_session_factory()
        inserted = 0
        async with factory() as session:
            for entry in _SEED:
                stmt = select(MarketplaceConnector).where(
                    MarketplaceConnector.slug == entry["slug"]
                )
                exists = (await session.execute(stmt)).scalar_one_or_none()
                if exists is not None:
                    continue
                session.add(MarketplaceConnector(**entry))
                inserted += 1
            if inserted:
                await session.commit()
        if inserted:
            logger.info("marketplace.seeded", rows=inserted)
        return inserted

    async def list_available(self) -> list[MarketplaceConnector]:
        await self.seed_if_empty()
        factory = get_session_factory()
        async with factory() as session:
            stmt = select(MarketplaceConnector).order_by(MarketplaceConnector.downloads.desc())
            return list((await session.execute(stmt)).scalars().all())

    async def get_details(self, slug: str) -> MarketplaceConnector:
        await self.seed_if_empty()
        factory = get_session_factory()
        async with factory() as session:
            stmt = select(MarketplaceConnector).where(MarketplaceConnector.slug == slug)
            entry = (await session.execute(stmt)).scalar_one_or_none()
            if entry is None:
                raise LookupError(f"marketplace_connector {slug!r} not found")
            return entry

    async def install(
        self,
        slug: str,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str,
        name: str,
        config: dict[str, Any],
        actor_id: UUID | str,
    ) -> tuple[MarketplaceConnector, Any]:
        entry = await self.get_details(slug)
        try:
            connector_type = ConnectorType(entry.type)
        except ValueError as exc:
            raise ValueError(f"marketplace_type_not_supported:{entry.type}") from exc

        # Increment download counter.
        factory = get_session_factory()
        async with factory() as session:
            stmt = select(MarketplaceConnector).where(MarketplaceConnector.slug == slug)
            row = (await session.execute(stmt)).scalar_one_or_none()
            if row is not None:
                row.downloads = (row.downloads or 0) + 1
                await session.commit()

        connector = await self._connectors.create_connector(
            tenant_id=tenant_id,
            project_id=project_id,
            name=name,
            type=connector_type,
            config=config,
            actor_id=actor_id,
        )
        logger.info(
            "marketplace.installed",
            slug=slug,
            connector_id=str(connector.id),
            tenant_id=str(tenant_id),
        )
        return entry, connector


marketplace = MarketplaceService()


# ---------------------------------------------------------------------------
# Registry-backed helpers (pure functions, no DB required)
# ---------------------------------------------------------------------------


async def list_available_servers(
    category: Optional[MCPCategory] = None,
) -> list[dict]:
    """List all available MCP servers from the registry as dicts.

    Optional `category` filters the listing to a single MCPCategory.
    The result is suitable for direct serialization to JSON / API
    responses. No DB access — purely a view over the in-process
    `MCP_REGISTRY`.
    """
    servers: list[MCPServerDefinition] = registry_list_servers(category)
    return [registry_to_dict(s) for s in servers]


async def get_server_details(name: str) -> Optional[dict]:
    """Return registry metadata for a single server, or None if missing."""
    server = registry_get_server(name)
    if server is None:
        return None
    return registry_to_dict(server)


async def list_all_categories() -> list[dict]:
    """Return the closed set of MCP categories as plain dicts."""
    return [{"value": c.value, "name": c.name} for c in registry_list_categories()]


__all__ = [
    "MarketplaceService",
    "marketplace",
    "list_available_servers",
    "get_server_details",
    "list_all_categories",
]
