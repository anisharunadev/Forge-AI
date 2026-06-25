"""Forge ↔ LiteLLM integration layer (F-829).

This package replaces the ad-hoc LiteLLM integration in
``app/services/litellm_client.py`` with a per-tenant Virtual Key +
per-tenant Budget flow, while keeping Forge authoritative for domain
concerns (artifacts, knowledge graph, governance, audit).

Phase A ships the **foundation** modules only. The functional split:

* :mod:`litellm_base_client` — shared httpx async client (admin +
  chat endpoints with separate auth).
* :mod:`secrets_manager_client` — AWS Secrets Manager wrapper for
  per-tenant Virtual Key storage.
* F-829a Tenant sync — *added by tenant_sync agent*
* F-829b Virtual Key Manager — *added by key_manager agent*
* F-829c Budget sync — *added by budget_sync agent*
* F-829d Guardrail sync (Phase B) — *added by guardrail_sync agent*
* F-829e MCP server registry (Phase B) — *added by mcp_server_registry agent*
* F-829f Skill sync (Phase D) — *added by skill_sync agent*
* F-829g Model assignment — *added by model_assignment agent*
* F-829h Usage analytics (Phase C) — *added by usage_query agent*
* F-829i Compliance feed (Phase C) — *added by compliance_feed agent*
* F-829j :class:`ForgeLLMClient` — *added by llm_client agent*
* F-829k Trace correlator — *added by trace_correlator agent*
* F-829l :class:`LiteLLMHealthMonitor` — *added by health_monitor agent*

Public API
----------
The names below are what other modules should import. Anything not
listed here is internal and may change without notice.
"""

from __future__ import annotations

from app.integrations.litellm.budget_sync import BudgetSync, budget_sync
from app.integrations.litellm.compliance_feed import (
    ComplianceFeed,
    ComplianceViolationView,
    ViolationIngestResult,
    compliance_feed,
)
from app.integrations.litellm.guardrail_sync import GuardrailSync, guardrail_sync
from app.integrations.litellm.key_manager import VirtualKeyManager, virtual_key_manager
from app.integrations.litellm.litellm_base_client import LiteLLMBaseClient
from app.integrations.litellm.mcp_server_registry import MCPServerRegistry, mcp_server_registry
from app.integrations.litellm.model_assignment import (
    ModelAssignmentResolver,
    model_assignment_resolver,
)
from app.integrations.litellm.secrets_manager_client import (
    Boto3ClientFactory,
    SecretRef,
    SecretsManagerClient,
    SecretsManagerUnavailable,
)
# F-829f SkillSync — added by skill_sync agent (Phase D)
from app.integrations.litellm.skill_sync import SkillSync, skill_sync
from app.integrations.litellm.tenant_sync import TenantSync, tenant_sync
from app.integrations.litellm.usage_query import (
    ModelUsageBucket,
    TenantUsageSnapshot,
    UsageQuery,
    UserUsageBucket,
    WorkflowUsageBucket,
    usage_query,
)

# Placeholder re-exports — populated by sibling agents as they land
# their modules. These are intentionally not imported yet (the files
# do not exist); they are listed here so the public surface is
# visible in one place and reviewers can see what is coming.

# F-829a TenantSync          — added by tenant_sync agent
# F-829b VirtualKeyManager   — added by key_manager agent
# F-829c BudgetSync          — added by budget_sync agent
# F-829d GuardrailSync       — added by guardrail_sync agent
# F-829e MCPServerRegistry   — added by mcp_server_registry agent
# F-829f SkillSync           — added by skill_sync agent
# F-829g ModelAssignment     — added by model_assignment agent
# F-829h UsageQuery          — added by usage_query agent
# F-829i ComplianceFeed      — added by compliance_feed agent
# F-829j ForgeLLMClient      — added by llm_client agent
from app.integrations.litellm.llm_client import (
    ForgeLLMClient,
    LLMUnavailableError,
    forge_llm_client,
)
# F-829k TraceCorrelator     — added by trace_correlator agent
from app.integrations.litellm.trace_correlator import (
    TraceCorrelator,
    trace_correlator,
)
# F-829l LiteLLMHealthMonitor — added by health_monitor agent
from app.integrations.litellm.health_monitor import (
    LiteLLMHealthMonitor,
    health_monitor,
)


__all__ = [
    # Foundation (shipped in this PR)
    "LiteLLMBaseClient",
    "SecretsManagerClient",
    "SecretsManagerUnavailable",
    "SecretRef",
    "Boto3ClientFactory",
    # F-829a TenantSync — added by tenant_sync agent
    "TenantSync",
    "tenant_sync",
    # F-829b VirtualKeyManager — added by key_manager agent
    "VirtualKeyManager",
    "virtual_key_manager",
    # F-829c BudgetSync — added by budget_sync agent
    "BudgetSync",
    "budget_sync",
    # F-829d GuardrailSync — added by guardrail_sync agent
    "GuardrailSync",
    "guardrail_sync",
    # F-829e MCPServerRegistry — added by mcp_server_registry agent
    "MCPServerRegistry",
    "mcp_server_registry",
    # F-829f SkillSync — added by skill_sync agent
    "SkillSync",
    "skill_sync",
    # F-829g ModelAssignmentResolver — added by model_assignment agent
    "ModelAssignmentResolver",
    "model_assignment_resolver",
    # F-829h UsageQuery — added by usage_query agent
    "UsageQuery",
    "usage_query",
    "TenantUsageSnapshot",
    "ModelUsageBucket",
    "UserUsageBucket",
    "WorkflowUsageBucket",
    # F-829i ComplianceFeed — added by compliance_feed agent
    "ComplianceFeed",
    "compliance_feed",
    "ViolationIngestResult",
    "ComplianceViolationView",
    # F-829j ForgeLLMClient — added by llm_client agent
    "ForgeLLMClient",
    "LLMUnavailableError",
    "forge_llm_client",
    # F-829k TraceCorrelator — added by trace_correlator agent
    "TraceCorrelator",
    "trace_correlator",
    # F-829l LiteLLMHealthMonitor — added by health_monitor agent
    "LiteLLMHealthMonitor",
    "health_monitor",
]