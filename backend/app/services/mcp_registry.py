"""Registry of all available MCP servers in Forge AI.

This module is the single source of truth for what MCP servers exist
in the platform. It is consumed by:

* The marketplace service (seed catalog + listing)
* The MCP API endpoints (`/api/v1/mcp/*`)
* The agent runtime / LangGraph MCP client (capability discovery)
* The UI (icon mapping, marketplace rendering)

Each server is a Node.js or Python package living under
`mcp-servers/<name>/`. The registry only describes the contract
(auth methods, capabilities, config schema) — it does not execute
the servers itself.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class MCPCategory(str, Enum):
    VERSION_CONTROL = "version_control"
    PROJECT_MANAGEMENT = "project_management"
    DOCUMENTATION = "documentation"
    DESIGN = "design"
    COMMUNICATION = "communication"
    CLOUD = "cloud"
    SECURITY = "security"
    ANALYTICS = "analytics"
    SUPPORT = "support"


class MCPHealth(str, Enum):
    HEALTHY = "healthy"
    DEGRADED = "degraded"
    UNKNOWN = "unknown"


@dataclass(frozen=True)
class MCPServerDefinition:
    """Static metadata for an MCP server shipped with Forge AI."""

    name: str
    display_name: str
    description: str
    category: MCPCategory
    version: str
    auth_methods: list[str]
    config_schema: dict
    capabilities: list[str]
    rate_limits: Optional[dict] = None
    icon: Optional[str] = None
    docs_url: Optional[str] = None
    installable: bool = True
    tags: list[str] = field(default_factory=list)


def _schema(properties: dict, required: list[str] | None = None) -> dict:
    """Small helper to build a JSON schema fragment consistently."""
    schema: dict = {"type": "object", "properties": properties}
    if required:
        schema["required"] = required
    return schema


# The full registry of 13 MCP servers shipped in v2.0.
MCP_REGISTRY: dict[str, MCPServerDefinition] = {
    "github": MCPServerDefinition(
        name="github",
        display_name="GitHub",
        description="Source control, pull requests, issues, Actions",
        category=MCPCategory.VERSION_CONTROL,
        version="1.0.0",
        auth_methods=["pat", "github_app"],
        config_schema=_schema(
            {
                "token": {"type": "string", "description": "Personal Access Token"},
                "org": {"type": "string", "description": "GitHub org name"},
                "base_url": {
                    "type": "string",
                    "default": "https://api.github.com",
                },
            },
            required=["token", "org"],
        ),
        capabilities=["read_repos", "create_pr", "read_issues", "create_issue", "trigger_workflow"],
        rate_limits={"requests_per_hour": 5000},
        icon="Github",
        docs_url="https://docs.github.com/en/rest",
        tags=["vcs", "code", "ci"],
    ),
    "jira": MCPServerDefinition(
        name="jira",
        display_name="Jira",
        description="Issue tracking, sprints, agile boards",
        category=MCPCategory.PROJECT_MANAGEMENT,
        version="1.0.0",
        auth_methods=["api_token", "oauth"],
        config_schema=_schema(
            {
                "url": {"type": "string", "description": "Atlassian URL"},
                "email": {"type": "string"},
                "api_token": {"type": "string"},
                "project_key": {"type": "string"},
            },
            required=["url", "email", "api_token", "project_key"],
        ),
        capabilities=["create_issue", "update_issue", "read_boards", "create_epic"],
        icon="Trello",
        docs_url="https://developer.atlassian.com/cloud/jira/platform/rest/v3/",
        tags=["atlassian", "issues"],
    ),
    "confluence": MCPServerDefinition(
        name="confluence",
        display_name="Confluence",
        description="Wiki pages, knowledge base, document collaboration",
        category=MCPCategory.DOCUMENTATION,
        version="1.0.0",
        auth_methods=["api_token", "oauth"],
        config_schema=_schema(
            {
                "url": {"type": "string"},
                "email": {"type": "string"},
                "api_token": {"type": "string"},
                "space_key": {"type": "string"},
            },
            required=["url", "email", "api_token", "space_key"],
        ),
        capabilities=["read_pages", "create_page", "update_page", "search"],
        icon="BookOpen",
        docs_url="https://developer.atlassian.com/cloud/confluence/rest/v1/",
        tags=["atlassian", "wiki", "docs"],
    ),
    "figma": MCPServerDefinition(
        name="figma",
        display_name="Figma",
        description="Design files, components, design tokens",
        category=MCPCategory.DESIGN,
        version="1.0.0",
        auth_methods=["pat"],
        config_schema=_schema(
            {
                "token": {"type": "string"},
                "team_id": {"type": "string"},
            },
            required=["token"],
        ),
        capabilities=["read_file", "read_components", "export_assets"],
        icon="Figma",
        docs_url="https://www.figma.com/developers/api",
        tags=["design", "tokens"],
    ),
    "slack": MCPServerDefinition(
        name="slack",
        display_name="Slack",
        description="Team communication, channels, threads",
        category=MCPCategory.COMMUNICATION,
        version="1.0.0",
        auth_methods=["oauth", "webhook"],
        config_schema=_schema(
            {
                "bot_token": {"type": "string"},
                "channel_id": {"type": "string"},
            },
            required=["bot_token"],
        ),
        capabilities=["send_message", "read_messages", "create_channel"],
        icon="Slack",
        docs_url="https://api.slack.com/methods",
        tags=["chat", "notifications"],
    ),
    "aws": MCPServerDefinition(
        name="aws",
        display_name="AWS",
        description="Cloud infrastructure, S3, ECS, RDS, IAM",
        category=MCPCategory.CLOUD,
        version="1.0.0",
        auth_methods=["iam_role", "access_key"],
        config_schema=_schema(
            {
                "region": {"type": "string", "default": "us-east-1"},
                "role_arn": {"type": "string"},
                "external_id": {"type": "string"},
            },
            required=["region"],
        ),
        capabilities=["read_s3", "list_ecs", "describe_rds", "read_secrets"],
        icon="Cloud",
        docs_url="https://docs.aws.amazon.com/",
        tags=["cloud", "infra"],
    ),
    "azure_devops": MCPServerDefinition(
        name="azure_devops",
        display_name="Azure DevOps",
        description="Repos, pipelines, work items",
        category=MCPCategory.VERSION_CONTROL,
        version="1.0.0",
        auth_methods=["pat"],
        config_schema=_schema(
            {
                "org": {"type": "string"},
                "project": {"type": "string"},
                "pat": {"type": "string"},
            },
            required=["org", "project", "pat"],
        ),
        capabilities=["read_repos", "create_pr", "trigger_pipeline"],
        icon="GitBranch",
        docs_url="https://learn.microsoft.com/azure/devops/",
        tags=["vcs", "ci", "azure"],
    ),
    "sonarqube": MCPServerDefinition(
        name="sonarqube",
        display_name="SonarQube",
        description="Code quality, security scanning, technical debt",
        category=MCPCategory.SECURITY,
        version="1.0.0",
        auth_methods=["token"],
        config_schema=_schema(
            {
                "url": {"type": "string"},
                "token": {"type": "string"},
                "project_key": {"type": "string"},
            },
            required=["url", "token"],
        ),
        capabilities=["scan", "read_issues", "read_quality_gate"],
        icon="Shield",
        docs_url="https://docs.sonarsource.com/sonarqube-server/latest/",
        tags=["quality", "security"],
    ),
    "secrets": MCPServerDefinition(
        name="secrets",
        display_name="Secrets Manager",
        description="AWS Secrets Manager, HashiCorp Vault",
        category=MCPCategory.SECURITY,
        version="1.0.0",
        auth_methods=["iam_role"],
        config_schema=_schema(
            {
                "backend": {
                    "type": "string",
                    "enum": ["aws_secrets", "vault"],
                },
                "region": {"type": "string"},
            },
            required=["backend"],
        ),
        capabilities=["read_secret", "rotate_secret"],
        icon="Key",
        tags=["secrets", "vault"],
    ),
    "clickup": MCPServerDefinition(
        name="clickup",
        display_name="ClickUp",
        description="Tasks, docs, goals, time tracking",
        category=MCPCategory.PROJECT_MANAGEMENT,
        version="1.0.0",
        auth_methods=["api_token"],
        config_schema=_schema(
            {
                "api_token": {"type": "string"},
                "workspace_id": {"type": "string"},
            },
            required=["api_token"],
        ),
        capabilities=["read_tasks", "create_task", "update_task"],
        icon="CheckSquare",
        docs_url="https://clickup.com/api/",
        tags=["pm", "tasks"],
    ),
    "zendesk": MCPServerDefinition(
        name="zendesk",
        display_name="Zendesk",
        description="Customer support tickets, knowledge base",
        category=MCPCategory.SUPPORT,
        version="1.0.0",
        auth_methods=["api_token", "oauth"],
        config_schema=_schema(
            {
                "subdomain": {"type": "string"},
                "email": {"type": "string"},
                "api_token": {"type": "string"},
            },
            required=["subdomain", "email", "api_token"],
        ),
        capabilities=["read_tickets", "create_ticket", "update_ticket"],
        icon="Headphones",
        docs_url="https://developer.zendesk.com/api-reference/",
        tags=["support", "tickets"],
    ),
    "databricks": MCPServerDefinition(
        name="databricks",
        display_name="Databricks",
        description="Data engineering, ML, analytics",
        category=MCPCategory.ANALYTICS,
        version="1.0.0",
        auth_methods=["pat"],
        config_schema=_schema(
            {
                "host": {"type": "string"},
                "token": {"type": "string"},
            },
            required=["host", "token"],
        ),
        capabilities=["read_jobs", "trigger_job", "read_tables"],
        icon="Database",
        docs_url="https://docs.databricks.com/dev-tools/api-reference.html",
        tags=["data", "ml"],
    ),
    "arch_analyzer": MCPServerDefinition(
        name="arch_analyzer",
        display_name="Architecture Analyzer",
        description="Detect architecture patterns, anti-patterns, code structure",
        category=MCPCategory.ANALYTICS,
        version="1.0.0",
        auth_methods=["none"],
        config_schema={"type": "object", "properties": {}},
        capabilities=["analyze_repo", "detect_patterns"],
        icon="Network",
        tags=["internal", "analysis"],
    ),
}


def get_server(name: str) -> Optional[MCPServerDefinition]:
    """Look up a server definition by name; returns None if missing."""
    return MCP_REGISTRY.get(name)


def list_servers(category: Optional[MCPCategory] = None) -> list[MCPServerDefinition]:
    """Return all registered servers, optionally filtered by category."""
    if category is None:
        return list(MCP_REGISTRY.values())
    return [s for s in MCP_REGISTRY.values() if s.category == category]


def list_categories() -> list[MCPCategory]:
    """Return the closed set of MCP categories."""
    return list(MCPCategory)


def to_dict(server: MCPServerDefinition) -> dict:
    """Serialize a server definition to a JSON-safe dict."""
    return {
        "name": server.name,
        "display_name": server.display_name,
        "description": server.description,
        "category": server.category.value,
        "version": server.version,
        "auth_methods": list(server.auth_methods),
        "config_schema": server.config_schema,
        "capabilities": list(server.capabilities),
        "rate_limits": server.rate_limits,
        "icon": server.icon,
        "docs_url": server.docs_url,
        "installable": server.installable,
        "tags": list(server.tags),
    }


__all__ = [
    "MCPCategory",
    "MCPHealth",
    "MCPServerDefinition",
    "MCP_REGISTRY",
    "get_server",
    "list_servers",
    "list_categories",
    "to_dict",
]
