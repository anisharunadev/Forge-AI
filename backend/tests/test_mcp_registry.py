"""Tests for the MCP registry, marketplace wiring, and API surface."""

from __future__ import annotations

import pytest

from app.services.marketplace import (
    get_server_details,
    list_all_categories,
    list_available_servers,
)
from app.services.mcp_registry import (
    MCPCategory,
    MCPServerDefinition,
    MCP_REGISTRY,
    get_server,
    list_categories,
    list_servers,
    to_dict,
)


# ---------------------------------------------------------------------------
# Registry shape and contents
# ---------------------------------------------------------------------------


EXPECTED_SERVER_NAMES = {
    "github",
    "jira",
    "confluence",
    "figma",
    "slack",
    "aws",
    "azure_devops",
    "sonarqube",
    "secrets",
    "clickup",
    "zendesk",
    "databricks",
    "arch_analyzer",
}


def test_registry_has_13_servers():
    """The registry must contain the full set of 13 v2.0 MCP servers."""
    assert len(MCP_REGISTRY) == 13
    assert set(MCP_REGISTRY.keys()) == EXPECTED_SERVER_NAMES


def test_registry_servers_have_required_fields():
    """Every server exposes the contract fields the UI/API depend on."""
    for name, server in MCP_REGISTRY.items():
        assert isinstance(server, MCPServerDefinition)
        assert server.name == name
        assert server.display_name
        assert server.description
        assert isinstance(server.category, MCPCategory)
        assert server.version
        assert isinstance(server.auth_methods, list) and server.auth_methods
        assert isinstance(server.config_schema, dict)
        assert "type" in server.config_schema
        assert isinstance(server.capabilities, list) and server.capabilities


def test_get_server_returns_definition():
    s = get_server("github")
    assert s is not None
    assert s.name == "github"
    assert s.display_name == "GitHub"
    assert "read_repos" in s.capabilities
    assert s.icon == "Github"


def test_get_server_returns_none_for_missing():
    assert get_server("does_not_exist") is None


def test_list_servers_by_category():
    all_servers = list_servers()
    assert len(all_servers) == 13

    pm_servers = list_servers(category=MCPCategory.PROJECT_MANAGEMENT)
    pm_names = {s.name for s in pm_servers}
    assert "jira" in pm_names
    assert "clickup" in pm_names
    # Servers from other categories must not leak in.
    assert "github" not in pm_names
    assert "sonarqube" not in pm_names

    security_servers = list_servers(category=MCPCategory.SECURITY)
    sec_names = {s.name for s in security_servers}
    assert "sonarqube" in sec_names
    assert "secrets" in sec_names


def test_list_categories_returns_enum():
    cats = list_categories()
    assert len(cats) == 9
    assert MCPCategory.VERSION_CONTROL in cats
    assert MCPCategory.ANALYTICS in cats


def test_to_dict_serializes_enum_and_lists():
    s = get_server("jira")
    assert s is not None
    d = to_dict(s)
    assert d["name"] == "jira"
    assert d["category"] == "project_management"
    assert isinstance(d["auth_methods"], list)
    assert isinstance(d["capabilities"], list)
    assert isinstance(d["config_schema"], dict)


# ---------------------------------------------------------------------------
# Marketplace wiring — registry-backed helpers
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_marketplace_list_uses_registry():
    items = await list_available_servers()
    assert len(items) == 13
    names = {i["name"] for i in items}
    assert names == EXPECTED_SERVER_NAMES


@pytest.mark.asyncio
async def test_marketplace_list_filters_by_category():
    items = await list_available_servers(category=MCPCategory.ANALYTICS)
    assert {i["name"] for i in items} == {"databricks", "arch_analyzer"}


@pytest.mark.asyncio
async def test_marketplace_get_server_details():
    d = await get_server_details("github")
    assert d is not None
    assert d["display_name"] == "GitHub"
    assert d["category"] == "version_control"

    missing = await get_server_details("nope")
    assert missing is None


@pytest.mark.asyncio
async def test_marketplace_list_categories():
    cats = await list_all_categories()
    assert len(cats) == 9
    values = {c["value"] for c in cats}
    assert "version_control" in values
    assert "security" in values


# ---------------------------------------------------------------------------
# Config schema validation
# ---------------------------------------------------------------------------


def test_config_schema_validity():
    """Each config_schema must be a well-formed JSON Schema object."""
    for server in MCP_REGISTRY.values():
        schema = server.config_schema
        assert schema.get("type") == "object", server.name
        properties = schema.get("properties", {})
        required = schema.get("required", [])
        for key in required:
            assert key in properties, f"{server.name}: required {key!r} missing in properties"
        for key, prop in properties.items():
            assert isinstance(prop, dict), f"{server.name}: property {key!r} not a dict"
            assert "type" in prop or "enum" in prop, (
                f"{server.name}: property {key!r} missing type or enum"
            )


def test_github_config_schema():
    s = get_server("github")
    assert s is not None
    schema = s.config_schema
    assert set(schema["required"]) == {"token", "org"}
    assert schema["properties"]["token"]["type"] == "string"
    assert schema["properties"]["org"]["type"] == "string"


def test_aws_config_schema_defaults_to_us_east_1():
    s = get_server("aws")
    assert s is not None
    region_prop = s.config_schema["properties"]["region"]
    assert region_prop.get("default") == "us-east-1"


def test_secrets_config_schema_has_enum():
    s = get_server("secrets")
    assert s is not None
    backend_prop = s.config_schema["properties"]["backend"]
    assert set(backend_prop["enum"]) == {"aws_secrets", "vault"}


# ---------------------------------------------------------------------------
# API endpoint wiring
# ---------------------------------------------------------------------------


def test_mcp_api_router_is_importable():
    from app.api.v1.mcp import router

    paths = {route.path for route in router.routes}
    assert "/mcp/servers" in paths
    assert "/mcp/servers/{name}" in paths
    assert "/mcp/categories" in paths


def test_mcp_api_router_prefix():
    from app.api.v1.mcp import router

    assert router.prefix == "/mcp"
