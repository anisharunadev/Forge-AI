"""v1 API router aggregation."""

from __future__ import annotations

from fastapi import APIRouter

from app.api.v1 import (
    admin,
    agent_assignments,
    agent_runtimes,
    agents,
    approvals,
    architecture,
    artifacts,
    audit,
    connectors,
    health,
    hooks,
    ideation,
    knowledge_graph,
    marketplace,
    mcp,
    model_providers,
    onboarding,
    policies,
    projects,
    qa,
    rbac,
    repos,
    runs,
    runtime_management,
    standards,
    steering_rules,
    templates,
    terminal_broadcast,
    terminal_commands,
    terminal_context,
    terminal_costs,
    terminal_export,
    tool_bundles,
    validation_reports,
    webhooks,
    workflows,
)

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(standards.router)
api_router.include_router(steering_rules.router)
api_router.include_router(templates.router)
api_router.include_router(policies.router)
api_router.include_router(rbac.router)
api_router.include_router(audit.router)
api_router.include_router(approvals.router)
api_router.include_router(artifacts.router)
api_router.include_router(connectors.router)
api_router.include_router(agents.router)
api_router.include_router(agent_assignments.router)
api_router.include_router(model_providers.router)
api_router.include_router(agent_runtimes.router)
api_router.include_router(marketplace.router)
api_router.include_router(mcp.router)
api_router.include_router(runtime_management.router)
api_router.include_router(hooks.router)
api_router.include_router(onboarding.router)
api_router.include_router(projects.router)
api_router.include_router(admin.router)
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

__all__ = ["api_router"]
