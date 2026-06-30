"""v1 API router aggregation."""

from __future__ import annotations

from fastapi import APIRouter

from app.api.v1 import (
    admin,
    admin_llm_gateway,
    agent_assignments,
    agent_config,
    agent_runtimes,
    agents,
    approvals,
    architecture,
    artifacts,
    audit,
    auth,
    commands,
    connector_credentials,
    connector_lifecycle,
    connectors,
    copilot,
    dashboard,
    env_vars,
    health,
    hooks,
    ideation,
    knowledge_graph,
    marketplace,
    mcp,
    members,
    model_providers,
    onboarding,
    policies,
    projects,
    qa,
    rbac,
    repos,
    roles,
    runs,
    runtime_management,
    seeds,
    standards,
    steering_rules,
    stories,
    system,
    templates,
    tenants,
    terminal_broadcast,
    terminal_commands,
    terminal_context,
    terminal_costs,
    terminal_export,
    tool_bundles,
    validation_reports,
    webhooks,
    webhooks_full,
    workflows,
)

api_router = APIRouter()
# step-53 Zone 2 — OIDC login + refresh + me. Public surface (no auth
# dependency on /oidc/callback and /refresh). Mounted first so the
# OpenAPI doc groups auth at the top of the v1 endpoint list.
api_router.include_router(auth.router)
api_router.include_router(health.router)
api_router.include_router(standards.router)
# F-821 — Seeds API (Plan C — Phase 0.7)
api_router.include_router(seeds.router)
api_router.include_router(steering_rules.router)
api_router.include_router(templates.router)
api_router.include_router(policies.router)
api_router.include_router(rbac.router)
api_router.include_router(audit.router)
api_router.include_router(approvals.router)
api_router.include_router(artifacts.router)
api_router.include_router(connectors.router)
api_router.include_router(connector_lifecycle.router)
api_router.include_router(connector_credentials.router)
api_router.include_router(agents.router)
api_router.include_router(agent_assignments.router)
api_router.include_router(model_providers.router)
api_router.include_router(agent_runtimes.router)
api_router.include_router(marketplace.router)
api_router.include_router(mcp.router)
api_router.include_router(runtime_management.router)
api_router.include_router(hooks.router)
api_router.include_router(onboarding.router)
api_router.include_router(tenants.router)
api_router.include_router(projects.router)
# step-62 — Settings: members, roles, env vars, agent config.
api_router.include_router(members.router)
api_router.include_router(roles.router)
api_router.include_router(env_vars.router)
api_router.include_router(agent_config.router)
api_router.include_router(admin.router)
# F-829 — LLM Gateway admin surface (Phase B)
api_router.include_router(admin_llm_gateway.router)
api_router.include_router(runs.router)
api_router.include_router(terminal_commands.router)
api_router.include_router(terminal_costs.router)
api_router.include_router(terminal_broadcast.router)
api_router.include_router(terminal_context.router)
api_router.include_router(terminal_export.router)
api_router.include_router(repos.router)
api_router.include_router(qa.router)
api_router.include_router(knowledge_graph.router)
# Quality / Validation Center (F-502)
api_router.include_router(validation_reports.router)
# Per-Stage Tool Bundle Guardrails (F-505)
api_router.include_router(tool_bundles.router)
# F-503 — Deterministic Security Gate webhooks
api_router.include_router(webhooks.router)
# F-007 — full webhook CRUD surface (Step-55 Zone 2).
api_router.include_router(webhooks_full.router)
# Ideation Center (F-201..F-213)
api_router.include_router(ideation.ideas.router)
api_router.include_router(ideation.impact.router)
api_router.include_router(ideation.scoring.router)
api_router.include_router(ideation.roadmaps.router)
api_router.include_router(ideation.prds.router)
api_router.include_router(ideation.arch_previews.router)
api_router.include_router(ideation.output_bundles.router)
api_router.include_router(ideation.approvals.router)
api_router.include_router(ideation.push.router)
api_router.include_router(ideation.kg_graph.router)
api_router.include_router(ideation.workflows.router)
# Architecture Center (F-301..F-310)
api_router.include_router(architecture.standards.router)
api_router.include_router(architecture.adrs.router)
api_router.include_router(architecture.contracts.router)
api_router.include_router(architecture.approvals.router)
api_router.include_router(architecture.acceptance.router)
api_router.include_router(architecture.risk_registers.router)
api_router.include_router(architecture.task_breakdowns.router)
api_router.include_router(architecture.traceability.router)
api_router.include_router(architecture.versions.router)
# NFR-044 Workflow Budget Guardrails
api_router.include_router(workflows.router)
# F-018 — Custom workflow command dispatch (closes the useForgeCommands "Backend unreachable" gap)
api_router.include_router(commands.router)
# F-800 — Forge Co-pilot (Plan 1)
api_router.include_router(copilot.router)
# F-021 / step-58 — Stories, Sprints, Epics (Phase 7 wiring).
api_router.include_router(stories.router)
api_router.include_router(stories.sprints_router)
api_router.include_router(stories.epics_router)
# F-800 — System features endpoint (Plan 6 — exposes the 5 copilot
# flags to the frontend for hotkey + nav gating).
api_router.include_router(system.router)
# F-014 — Dashboard aggregation endpoints (step-57)
api_router.include_router(dashboard.router)

__all__ = ["api_router"]
