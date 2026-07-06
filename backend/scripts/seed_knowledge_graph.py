#!/usr/bin/env python3
"""Seed knowledge-graph nodes + edges for the acme-corp tenant.

Writes into the canonical ``kg_nodes`` + ``kg_edges`` tables defined in
``app.services.knowledge_graph.KGNode / KGEdge`` — the SAME tables that
``knowledge_graph_service.list_nodes`` / ``list_edges`` (and therefore
``GET /api/v1/knowledge-graph/nodes``) read from.

The previous version targeted ``app.db.models.graph.GraphNode / GraphEdge``
which the FastAPI KG endpoints never read from, so the seed was
invisible to the UI. This rewrite targets the correct tables AND uses
the closed-set ``node_type`` / ``edge_type`` vocabularies that the
Knowledge Center UI palette accepts
(``apps/forge/lib/knowledge-graph/types.ts``):

    node_type ∈ {person, team, service, module, doc, adr,
                 policy, runbook, tool}
    edge_type ∈ {owns, member_of, contains, depends_on,
                 integrates_with, documents, decides, governs,
                 operates, contributes_to}

Run with::

    docker compose exec backend python -m scripts.seed_knowledge_graph

Verify with::

    docker compose exec postgres psql -U forge -d forge \
        -c "SELECT node_type, count(*) FROM kg_nodes GROUP BY 1;"
    docker compose exec postgres psql -U forge -d forge \
        -c "SELECT edge_type, count(*) FROM kg_edges GROUP BY 1;"
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select

from app.db.models.project import Project
from app.db.models.tenant import Tenant
from app.db.session import get_session_factory
from app.services.knowledge_graph import KGEdge, KGNode

logger = logging.getLogger("seed_knowledge_graph")
logging.basicConfig(level=logging.INFO, format="%(message)s")


# Stable IDs — mirror the convention from ``seed_connectors.py`` / ``seed_agents.py``
# so the acme-corp tenant row + project row + seed user UUID line up with the
# rest of the demo dataset (Rule 2 — multi-tenancy by default).
ACME_TENANT_SLUG = "acme-corp"
ACME_TENANT_ID = uuid.UUID("11111111-1111-1111-1111-111111111111")
ACME_PROJECT_ID = uuid.UUID("22222222-2222-2222-2222-222222222222")


# ---------------------------------------------------------------------------
# Seed nodes.
#
# Each tuple is:
#   (node_key, node_type, name, properties)
#
# ``node_key`` is a stable, human-readable identity within a tenant used by
# the second pass to resolve ``from``/``to`` references on edges. It is
# preserved as ``properties['source_key']`` so downstream reconcilers can
# find a seed row by its source identity.
#
# ``node_type`` values are drawn from the closed UI palette in
# ``apps/forge/lib/knowledge-graph/types.ts``.
# ---------------------------------------------------------------------------


SEED_NODES: list[dict[str, Any]] = [
    # ---------- people (6) ----------
    {
        "node_key": "person:arun-achalam",
        "node_type": "person",
        "name": "Arun Achalam",
        "properties": {
            "category": "person",
            "email": "arun@acme-corp.com",
            "owner": "Arun Achalam",
            "owner_role": "CTO",
            "summary": "CTO at Acme Corp",
            "tags": ["person", "leadership"],
            "source_key": "person:arun-achalam",
        },
    },
    {
        "node_key": "person:priya-iyer",
        "node_type": "person",
        "name": "Priya Iyer",
        "properties": {
            "category": "person",
            "email": "priya@acme-corp.com",
            "owner": "Priya Iyer",
            "owner_role": "Engineering Manager",
            "summary": "Engineering Manager",
            "tags": ["person", "management"],
            "source_key": "person:priya-iyer",
        },
    },
    {
        "node_key": "person:ravi-kumar",
        "node_type": "person",
        "name": "Ravi Kumar",
        "properties": {
            "category": "person",
            "email": "ravi@acme-corp.com",
            "owner": "Ravi Kumar",
            "owner_role": "Tech Lead",
            "summary": "Tech Lead, Forge Platform",
            "tags": ["person", "tech-lead"],
            "source_key": "person:ravi-kumar",
        },
    },
    {
        "node_key": "person:meera-patel",
        "node_type": "person",
        "name": "Meera Patel",
        "properties": {
            "category": "person",
            "email": "meera@acme-corp.com",
            "owner": "Meera Patel",
            "owner_role": "Senior Engineer",
            "summary": "Senior Engineer, Connectors",
            "tags": ["person", "engineer"],
            "source_key": "person:meera-patel",
        },
    },
    {
        "node_key": "person:vikram-shah",
        "node_type": "person",
        "name": "Vikram Shah",
        "properties": {
            "category": "person",
            "email": "vikram@acme-corp.com",
            "owner": "Vikram Shah",
            "owner_role": "Engineer",
            "summary": "Engineer, Workflows",
            "tags": ["person", "engineer"],
            "source_key": "person:vikram-shah",
        },
    },
    {
        "node_key": "person:anjali-rao",
        "node_type": "person",
        "name": "Anjali Rao",
        "properties": {
            "category": "person",
            "email": "anjali@acme-corp.com",
            "owner": "Anjali Rao",
            "owner_role": "PM",
            "summary": "PM, Knowledge Tools",
            "tags": ["person", "product"],
            "source_key": "person:anjali-rao",
        },
    },
    # ---------- teams (4) ----------
    {
        "node_key": "team:platform",
        "node_type": "team",
        "name": "Platform Team",
        "properties": {
            "category": "team",
            "summary": "Owns the agent runtime + workflow executor",
            "size": 8,
            "tags": ["team"],
            "source_key": "team:platform",
        },
    },
    {
        "node_key": "team:connectors",
        "node_type": "team",
        "name": "Connectors Team",
        "properties": {
            "category": "team",
            "summary": "Builds external system integrations",
            "size": 5,
            "tags": ["team"],
            "source_key": "team:connectors",
        },
    },
    {
        "node_key": "team:knowledge",
        "node_type": "team",
        "name": "Knowledge Team",
        "properties": {
            "category": "team",
            "summary": "Owns the KG + Org Knowledge surface",
            "size": 6,
            "tags": ["team"],
            "source_key": "team:knowledge",
        },
    },
    {
        "node_key": "team:workflows",
        "node_type": "team",
        "name": "Workflows Team",
        "properties": {
            "category": "team",
            "summary": "Builds the workflow editor + run executor",
            "size": 7,
            "tags": ["team"],
            "source_key": "team:workflows",
        },
    },
    # ---------- services (7) ----------
    {
        "node_key": "service:forge-api",
        "node_type": "service",
        "name": "forge-api",
        "properties": {
            "category": "service",
            "summary": "FastAPI gateway",
            "repo": "forge-ai/backend",
            "language": "python",
            "sloc": 28000,
            "tags": ["service", "python"],
            "source_key": "service:forge-api",
        },
    },
    {
        "node_key": "service:forge-ui",
        "node_type": "service",
        "name": "forge-ui",
        "properties": {
            "category": "service",
            "summary": "Next.js frontend",
            "repo": "forge-ai/apps/forge",
            "language": "typescript",
            "sloc": 45000,
            "tags": ["service", "typescript"],
            "source_key": "service:forge-ui",
        },
    },
    {
        "node_key": "service:forge-core",
        "node_type": "service",
        "name": "forge-core",
        "properties": {
            "category": "service",
            "summary": "Canonical skills + agents",
            "repo": "forge-ai/packages/forge-core",
            "language": "markdown",
            "sloc": 12000,
            "tags": ["service"],
            "source_key": "service:forge-core",
        },
    },
    {
        "node_key": "service:litellm-proxy",
        "node_type": "service",
        "name": "litellm-proxy",
        "properties": {
            "category": "service",
            "summary": "LLM gateway",
            "repo": "litellm",
            "language": "python",
            "sloc": 15000,
            "tags": ["service", "python"],
            "source_key": "service:litellm-proxy",
        },
    },
    {
        "node_key": "service:keycloak",
        "node_type": "service",
        "name": "keycloak",
        "properties": {
            "category": "service",
            "summary": "Identity provider",
            "repo": "keycloak",
            "language": "java",
            "sloc": 250000,
            "tags": ["service", "java"],
            "source_key": "service:keycloak",
        },
    },
    {
        "node_key": "service:postgres",
        "node_type": "service",
        "name": "postgres",
        "properties": {
            "category": "service",
            "summary": "Primary database",
            "repo": "postgres",
            "language": "c",
            "sloc": 800000,
            "tags": ["service", "database"],
            "source_key": "service:postgres",
        },
    },
    {
        "node_key": "service:mcp-server",
        "node_type": "service",
        "name": "mcp-server",
        "properties": {
            "category": "service",
            "summary": "Tool gateway",
            "repo": "forge-mcp",
            "language": "typescript",
            "sloc": 4500,
            "tags": ["service", "typescript"],
            "source_key": "service:mcp-server",
        },
    },
    # ---------- modules (5) ----------
    {
        "node_key": "module:workflow_executor",
        "node_type": "module",
        "name": "workflow_executor.py",
        "properties": {
            "category": "module",
            "summary": "DAG runner for user workflows",
            "path": "backend/app/services/workflow_executor.py",
            "language": "python",
            "tags": ["module", "python"],
            "source_key": "module:workflow_executor",
        },
    },
    {
        "node_key": "module:connector_manager",
        "node_type": "module",
        "name": "connector_manager.py",
        "properties": {
            "category": "module",
            "summary": "Connector CRUD + sync orchestration",
            "path": "backend/app/services/connector_manager.py",
            "language": "python",
            "tags": ["module", "python"],
            "source_key": "module:connector_manager",
        },
    },
    {
        "node_key": "module:agent_center",
        "node_type": "module",
        "name": "agent_center",
        "properties": {
            "category": "module",
            "summary": "Agent registry UI",
            "path": "apps/forge/app/agent-center",
            "language": "typescript",
            "tags": ["module", "typescript"],
            "source_key": "module:agent_center",
        },
    },
    {
        "node_key": "module:knowledge_graph_api",
        "node_type": "module",
        "name": "knowledge_graph.py",
        "properties": {
            "category": "module",
            "summary": "KG REST endpoints",
            "path": "backend/app/api/v1/knowledge_graph.py",
            "language": "python",
            "tags": ["module", "python"],
            "source_key": "module:knowledge_graph_api",
        },
    },
    {
        "node_key": "module:live_connector_data_provider",
        "node_type": "module",
        "name": "LiveConnectorDataProvider",
        "properties": {
            "category": "module",
            "summary": "Bridges TanStack hooks + mock fallback",
            "path": "apps/forge/components/connector-center/LiveConnectorDataProvider.tsx",
            "language": "typescript",
            "tags": ["module", "typescript"],
            "source_key": "module:live_connector_data_provider",
        },
    },
    # ---------- docs (4) ----------
    {
        "node_key": "doc:architecture-overview",
        "node_type": "doc",
        "name": "Forge Architecture Overview",
        "properties": {
            "category": "doc",
            "summary": "System-level architecture for Forge AI Agent OS",
            "format": "markdown",
            "url": "/docs/architecture",
            "tags": ["doc", "architecture"],
            "source_key": "doc:architecture-overview",
        },
    },
    {
        "node_key": "doc:multi-tenancy",
        "node_type": "doc",
        "name": "Multi-tenancy model",
        "properties": {
            "category": "doc",
            "summary": "How tenant isolation works",
            "format": "markdown",
            "url": "/docs/multi-tenancy",
            "tags": ["doc", "tenant"],
            "source_key": "doc:multi-tenancy",
        },
    },
    {
        "node_key": "doc:connector-author-guide",
        "node_type": "doc",
        "name": "Connector author guide",
        "properties": {
            "category": "doc",
            "summary": "How to write a new connector",
            "format": "markdown",
            "url": "/docs/connector-author",
            "tags": ["doc", "connector"],
            "source_key": "doc:connector-author-guide",
        },
    },
    {
        "node_key": "doc:workflow-yaml-reference",
        "node_type": "doc",
        "name": "Workflow YAML reference",
        "properties": {
            "category": "doc",
            "summary": "Complete spec for workflow definitions",
            "format": "markdown",
            "url": "/docs/workflow-yaml",
            "tags": ["doc", "workflow"],
            "source_key": "doc:workflow-yaml-reference",
        },
    },
    # ---------- ADRs (4) ----------
    {
        "node_key": "adr:001-langgraph",
        "node_type": "adr",
        "name": "ADR-001: Use LangGraph for SDLC",
        "properties": {
            "category": "adr",
            "summary": "Why we picked LangGraph as the orchestrator substrate",
            "date": "2025-01-15",
            "status": "accepted",
            "tags": ["adr"],
            "source_key": "adr:001-langgraph",
        },
    },
    {
        "node_key": "adr:002-litellm",
        "node_type": "adr",
        "name": "ADR-002: LiteLLM proxy for LLM traffic",
        "properties": {
            "category": "adr",
            "summary": "Provider-agnostic LLM routing",
            "date": "2025-02-03",
            "status": "accepted",
            "tags": ["adr"],
            "source_key": "adr:002-litellm",
        },
    },
    {
        "node_key": "adr:003-tanstack",
        "node_type": "adr",
        "name": "ADR-003: TanStack Query for client state",
        "properties": {
            "category": "adr",
            "summary": "Why we standardized on TanStack Query",
            "date": "2025-03-21",
            "status": "accepted",
            "tags": ["adr"],
            "source_key": "adr:003-tanstack",
        },
    },
    {
        "node_key": "adr:004-forge-core",
        "node_type": "adr",
        "name": "ADR-004: forge-core as canonical source",
        "properties": {
            "category": "adr",
            "summary": "Single source of truth for skills/agents",
            "date": "2025-04-10",
            "status": "accepted",
            "tags": ["adr"],
            "source_key": "adr:004-forge-core",
        },
    },
    # ---------- policies (4) ----------
    {
        "node_key": "policy:pii-handling",
        "node_type": "policy",
        "name": "PII handling policy",
        "properties": {
            "category": "policy",
            "summary": "No PII in logs, redaction at the edge",
            "enforced": True,
            "owner": "security",
            "tags": ["policy"],
            "source_key": "policy:pii-handling",
        },
    },
    {
        "node_key": "policy:approval-gates",
        "node_type": "policy",
        "name": "Approval gates policy",
        "properties": {
            "category": "policy",
            "summary": "Mandatory human approval at architecture/deployment",
            "enforced": True,
            "owner": "platform",
            "tags": ["policy"],
            "source_key": "policy:approval-gates",
        },
    },
    {
        "node_key": "policy:cost-ceiling",
        "node_type": "policy",
        "name": "Cost ceiling policy",
        "properties": {
            "category": "policy",
            "summary": "Workflows must declare a cost ceiling",
            "enforced": True,
            "owner": "platform",
            "tags": ["policy"],
            "source_key": "policy:cost-ceiling",
        },
    },
    {
        "node_key": "policy:tenant-isolation",
        "node_type": "policy",
        "name": "Tenant isolation policy",
        "properties": {
            "category": "policy",
            "summary": "Every query carries tenant_id + project_id",
            "enforced": True,
            "owner": "platform",
            "tags": ["policy"],
            "source_key": "policy:tenant-isolation",
        },
    },
    # ---------- runbooks (3) ----------
    {
        "node_key": "runbook:db-failover",
        "node_type": "runbook",
        "name": "DB failover runbook",
        "properties": {
            "category": "runbook",
            "summary": "Step-by-step postgres failover",
            "severity": "high",
            "last_tested": "2025-05-12",
            "tags": ["runbook"],
            "source_key": "runbook:db-failover",
        },
    },
    {
        "node_key": "runbook:keycloak-realm-recovery",
        "node_type": "runbook",
        "name": "Keycloak realm recovery",
        "properties": {
            "category": "runbook",
            "summary": "Rebuild a tenant realm from backup",
            "severity": "medium",
            "last_tested": "2025-04-20",
            "tags": ["runbook"],
            "source_key": "runbook:keycloak-realm-recovery",
        },
    },
    {
        "node_key": "runbook:litellm-outage",
        "node_type": "runbook",
        "name": "LiteLLM outage runbook",
        "properties": {
            "category": "runbook",
            "summary": "Detect + route around LiteLLM outage",
            "severity": "high",
            "last_tested": "2025-05-01",
            "tags": ["runbook"],
            "source_key": "runbook:litellm-outage",
        },
    },
    # ---------- tools (5) ----------
    {
        "node_key": "tool:github",
        "node_type": "tool",
        "name": "GitHub",
        "properties": {
            "category": "tool",
            "summary": "Source control + PRs",
            "category_external": "source-control",
            "tags": ["tool"],
            "source_key": "tool:github",
        },
    },
    {
        "node_key": "tool:jira",
        "node_type": "tool",
        "name": "Jira",
        "properties": {
            "category": "tool",
            "summary": "Project management",
            "category_external": "project-mgmt",
            "tags": ["tool"],
            "source_key": "tool:jira",
        },
    },
    {
        "node_key": "tool:slack",
        "node_type": "tool",
        "name": "Slack",
        "properties": {
            "category": "tool",
            "summary": "Team chat",
            "category_external": "comms",
            "tags": ["tool"],
            "source_key": "tool:slack",
        },
    },
    {
        "node_key": "tool:figma",
        "node_type": "tool",
        "name": "Figma",
        "properties": {
            "category": "tool",
            "summary": "Design files",
            "category_external": "design",
            "tags": ["tool"],
            "source_key": "tool:figma",
        },
    },
    {
        "node_key": "tool:aws",
        "node_type": "tool",
        "name": "AWS",
        "properties": {
            "category": "tool",
            "summary": "Cloud infra",
            "category_external": "cloud",
            "tags": ["tool"],
            "source_key": "tool:aws",
        },
    },
]


# Edges use ``node_key`` references so the seed is order-independent
# (we resolve to node UUIDs in a second pass).
#
# ``edge_type`` values are drawn directly from the closed UI palette
# (NOT encoded as ``properties['relationship']`` — see the bridge
# comment above for why that was a smell).
SEED_EDGES: list[dict[str, Any]] = [
    # People → Teams (membership / ownership)
    {
        "edge_key": "edge:arun-owns-platform",
        "edge_type": "owns",
        "from": "person:arun-achalam",
        "to": "team:platform",
        "properties": {},
    },
    {
        "edge_key": "edge:priya-owns-connectors",
        "edge_type": "owns",
        "from": "person:priya-iyer",
        "to": "team:connectors",
        "properties": {},
    },
    {
        "edge_key": "edge:ravi-owns-workflows",
        "edge_type": "owns",
        "from": "person:ravi-kumar",
        "to": "team:workflows",
        "properties": {},
    },
    {
        "edge_key": "edge:meera-member-connectors",
        "edge_type": "member_of",
        "from": "person:meera-patel",
        "to": "team:connectors",
        "properties": {},
    },
    {
        "edge_key": "edge:vikram-member-workflows",
        "edge_type": "member_of",
        "from": "person:vikram-shah",
        "to": "team:workflows",
        "properties": {},
    },
    {
        "edge_key": "edge:anjali-owns-knowledge",
        "edge_type": "owns",
        "from": "person:anjali-rao",
        "to": "team:knowledge",
        "properties": {},
    },
    # Teams → Services (ownership / contribution)
    {
        "edge_key": "edge:platform-owns-api",
        "edge_type": "owns",
        "from": "team:platform",
        "to": "service:forge-api",
        "properties": {},
    },
    {
        "edge_key": "edge:platform-owns-litellm",
        "edge_type": "owns",
        "from": "team:platform",
        "to": "service:litellm-proxy",
        "properties": {},
    },
    {
        "edge_key": "edge:platform-owns-keycloak",
        "edge_type": "owns",
        "from": "team:platform",
        "to": "service:keycloak",
        "properties": {},
    },
    {
        "edge_key": "edge:connectors-contrib-api",
        "edge_type": "contributes_to",
        "from": "team:connectors",
        "to": "service:forge-api",
        "properties": {"weight": 0.8},
    },
    {
        "edge_key": "edge:knowledge-owns-ui",
        "edge_type": "owns",
        "from": "team:knowledge",
        "to": "service:forge-ui",
        "properties": {},
    },
    {
        "edge_key": "edge:workflows-contrib-ui",
        "edge_type": "contributes_to",
        "from": "team:workflows",
        "to": "service:forge-ui",
        "properties": {"weight": 0.8},
    },
    # Services → Modules (contains)
    {
        "edge_key": "edge:api-has-workflow-exec",
        "edge_type": "contains",
        "from": "service:forge-api",
        "to": "module:workflow_executor",
        "properties": {},
    },
    {
        "edge_key": "edge:api-has-conn-mgr",
        "edge_type": "contains",
        "from": "service:forge-api",
        "to": "module:connector_manager",
        "properties": {},
    },
    {
        "edge_key": "edge:api-has-kg-api",
        "edge_type": "contains",
        "from": "service:forge-api",
        "to": "module:knowledge_graph_api",
        "properties": {},
    },
    {
        "edge_key": "edge:ui-has-agent-center",
        "edge_type": "contains",
        "from": "service:forge-ui",
        "to": "module:agent_center",
        "properties": {},
    },
    {
        "edge_key": "edge:ui-has-live-conn",
        "edge_type": "contains",
        "from": "service:forge-ui",
        "to": "module:live_connector_data_provider",
        "properties": {},
    },
    # Services → Services (dependencies)
    {
        "edge_key": "edge:api-deps-pg",
        "edge_type": "depends_on",
        "from": "service:forge-api",
        "to": "service:postgres",
        "properties": {},
    },
    {
        "edge_key": "edge:api-deps-litellm",
        "edge_type": "depends_on",
        "from": "service:forge-api",
        "to": "service:litellm-proxy",
        "properties": {},
    },
    {
        "edge_key": "edge:api-deps-keycloak",
        "edge_type": "depends_on",
        "from": "service:forge-api",
        "to": "service:keycloak",
        "properties": {},
    },
    {
        "edge_key": "edge:ui-deps-api",
        "edge_type": "depends_on",
        "from": "service:forge-ui",
        "to": "service:forge-api",
        "properties": {},
    },
    {
        "edge_key": "edge:ui-deps-keycloak",
        "edge_type": "depends_on",
        "from": "service:forge-ui",
        "to": "service:keycloak",
        "properties": {},
    },
    {
        "edge_key": "edge:litellm-deps-pg",
        "edge_type": "depends_on",
        "from": "service:litellm-proxy",
        "to": "service:postgres",
        "properties": {},
    },
    {
        "edge_key": "edge:mcp-deps-api",
        "edge_type": "depends_on",
        "from": "service:mcp-server",
        "to": "service:forge-api",
        "properties": {},
    },
    # Services → Tools (integration)
    {
        "edge_key": "edge:api-integ-github",
        "edge_type": "integrates_with",
        "from": "service:forge-api",
        "to": "tool:github",
        "properties": {},
    },
    {
        "edge_key": "edge:api-integ-jira",
        "edge_type": "integrates_with",
        "from": "service:forge-api",
        "to": "tool:jira",
        "properties": {},
    },
    {
        "edge_key": "edge:api-integ-slack",
        "edge_type": "integrates_with",
        "from": "service:forge-api",
        "to": "tool:slack",
        "properties": {},
    },
    # Docs → Services (documents)
    {
        "edge_key": "edge:arch-doc-api",
        "edge_type": "documents",
        "from": "doc:architecture-overview",
        "to": "service:forge-api",
        "properties": {},
    },
    {
        "edge_key": "edge:arch-doc-ui",
        "edge_type": "documents",
        "from": "doc:architecture-overview",
        "to": "service:forge-ui",
        "properties": {},
    },
    {
        "edge_key": "edge:mt-doc-pg",
        "edge_type": "documents",
        "from": "doc:multi-tenancy",
        "to": "service:postgres",
        "properties": {},
    },
    {
        "edge_key": "edge:cag-doc-conn-mgr",
        "edge_type": "documents",
        "from": "doc:connector-author-guide",
        "to": "module:connector_manager",
        "properties": {},
    },
    {
        "edge_key": "edge:wyr-doc-wf-exec",
        "edge_type": "documents",
        "from": "doc:workflow-yaml-reference",
        "to": "module:workflow_executor",
        "properties": {},
    },
    # ADRs → Services (decides)
    {
        "edge_key": "edge:adr1-api",
        "edge_type": "decides",
        "from": "adr:001-langgraph",
        "to": "service:forge-api",
        "properties": {},
    },
    {
        "edge_key": "edge:adr2-litellm",
        "edge_type": "decides",
        "from": "adr:002-litellm",
        "to": "service:litellm-proxy",
        "properties": {},
    },
    {
        "edge_key": "edge:adr3-ui",
        "edge_type": "decides",
        "from": "adr:003-tanstack",
        "to": "service:forge-ui",
        "properties": {},
    },
    {
        "edge_key": "edge:adr4-core",
        "edge_type": "decides",
        "from": "adr:004-forge-core",
        "to": "service:forge-core",
        "properties": {},
    },
    # Services → Policies (governs)
    {
        "edge_key": "edge:pii-api",
        "edge_type": "governs",
        "from": "service:forge-api",
        "to": "policy:pii-handling",
        "properties": {},
    },
    {
        "edge_key": "edge:ag-api",
        "edge_type": "governs",
        "from": "service:forge-api",
        "to": "policy:approval-gates",
        "properties": {},
    },
    {
        "edge_key": "edge:cc-api",
        "edge_type": "governs",
        "from": "service:forge-api",
        "to": "policy:cost-ceiling",
        "properties": {},
    },
    {
        "edge_key": "edge:ti-pg",
        "edge_type": "governs",
        "from": "service:postgres",
        "to": "policy:tenant-isolation",
        "properties": {},
    },
    # Runbooks → Services (operates)
    {
        "edge_key": "edge:rb-db-pg",
        "edge_type": "operates",
        "from": "runbook:db-failover",
        "to": "service:postgres",
        "properties": {},
    },
    {
        "edge_key": "edge:rb-kc-keycloak",
        "edge_type": "operates",
        "from": "runbook:keycloak-realm-recovery",
        "to": "service:keycloak",
        "properties": {},
    },
    {
        "edge_key": "edge:rb-ll-litellm",
        "edge_type": "operates",
        "from": "runbook:litellm-outage",
        "to": "service:litellm-proxy",
        "properties": {},
    },
]


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


async def seed() -> None:
    """Insert KG seed rows for the acme-corp tenant. Idempotent."""
    sf = get_session_factory()

    async with sf() as session:
        # Resolve tenant by slug (matches the lookup style used by the
        # other ``scripts/seed_*.py`` files; the original constant
        # ``ACME_TENANT_ID`` was stale and pointed at a UUID that no
        # tenant row carries).
        tenant = (
            await session.execute(select(Tenant).where(Tenant.slug == ACME_TENANT_SLUG))
        ).scalar_one_or_none()
        if tenant is None:
            raise RuntimeError(
                f"{ACME_TENANT_SLUG} tenant not found. Run the day_one_bootstrap service first."
            )
        logger.info("tenant: %s (%s)", tenant.slug, tenant.name)

        # Resolve the demo project. Every KGNode / KGEdge must carry a
        # project_id (Rule 2 — multi-tenancy by default).
        project = (
            await session.execute(
                select(Project).where(
                    Project.tenant_id == tenant.id,
                    Project.id == ACME_PROJECT_ID,
                )
            )
        ).scalar_one_or_none()
        if project is None:
            # Fall back to the first project for this tenant so the seed
            # still works on environments where the demo project UUID
            # differs (e.g. after a partial reset).
            project = (
                (await session.execute(select(Project).where(Project.tenant_id == tenant.id)))
                .scalars()
                .first()
            )
            if project is None:
                raise RuntimeError(
                    "No project found for acme-corp tenant. "
                    "Run the day_one_bootstrap service first."
                )
        logger.info("project: %s (%s)", project.id, project.name)

        # Idempotency: if any KGNode row exists for this tenant, skip.
        existing = (
            (await session.execute(select(KGNode.id).where(KGNode.tenant_id == tenant.id)))
            .scalars()
            .first()
        )
        if existing is not None:
            logger.info("  ↻ knowledge graph already seeded — skipping")
            logger.info("")
            logger.info("✅ Seed no-op (already seeded).")
            return

        # ----- nodes -----
        now = datetime.now(UTC)
        nodes_by_key: dict[str, uuid.UUID] = {}
        created_nodes = 0
        for row in SEED_NODES:
            node_id = uuid.uuid4()
            node = KGNode(
                id=node_id,
                tenant_id=tenant.id,
                project_id=project.id,
                node_type=row["node_type"],
                name=row["name"],
                properties=row["properties"],
                freshness_at=now,
                freshness_source="seed",
            )
            session.add(node)
            nodes_by_key[row["node_key"]] = node_id
            created_nodes += 1
            logger.info(
                "  ✓ node[%s] %s (%s)",
                row["node_type"],
                row["name"],
                node_id,
            )

        # Flush so the edges that follow have FK targets ready.
        await session.flush()

        # ----- edges -----
        created_edges = 0
        skipped_edges = 0
        for row in SEED_EDGES:
            from_id = nodes_by_key.get(row["from"])
            to_id = nodes_by_key.get(row["to"])
            if from_id is None or to_id is None:
                logger.warning(
                    "  ⚠ edge skipped (missing endpoint): %s -> %s",
                    row["from"],
                    row["to"],
                )
                skipped_edges += 1
                continue
            edge = KGEdge(
                id=uuid.uuid4(),
                tenant_id=tenant.id,
                project_id=project.id,
                from_node_id=from_id,
                to_node_id=to_id,
                edge_type=row["edge_type"],
                properties=row.get("properties") or {},
            )
            session.add(edge)
            created_edges += 1
            logger.info(
                "  ✓ edge[%s] %s -> %s",
                row["edge_type"],
                row["from"],
                row["to"],
            )

        await session.commit()

        # ----- summary by node_type (live SQL count, authoritative) -----
        from collections import Counter

        result = await session.execute(
            select(KGNode.node_type).where(KGNode.tenant_id == tenant.id)
        )
        counts: Counter[str] = Counter()
        for (nt,) in result.all():
            counts[nt] += 1

        logger.info("")
        logger.info("✅ Seed complete!")
        logger.info("   - 1 tenant (%s)", ACME_TENANT_SLUG)
        logger.info("   - 1 project (%s)", project.id)
        logger.info(
            "   - %d nodes created (%d total seeded)",
            created_nodes,
            len(SEED_NODES),
        )
        logger.info(
            "   - %d edges created (%d skipped, %d total)",
            created_edges,
            skipped_edges,
            len(SEED_EDGES),
        )
        logger.info("")
        logger.info("   Nodes by node_type:")
        for nt in sorted(counts):
            logger.info("     %-10s %d", nt, counts[nt])


if __name__ == "__main__":
    asyncio.run(seed())
