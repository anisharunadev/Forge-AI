"""v1 API router aggregation."""

from __future__ import annotations

from fastapi import APIRouter

# step-80 — Phase 4 (cache, pass-through, identity, ops, realtime).
from app.api.v1 import (
    admin,
    admin_llm_gateway,
    agent_assignments,
    agent_config,
    agent_runtimes,
    agents,
    analytics_usage,
    approvals,
    architecture,
    artifacts,
    audit,
    auth,
    auth_sessions,
    auth_tokens,
    commands,
    connector_activity,
    connector_credentials,
    connector_lifecycle,
    connector_oauth,
    connectors,
    copilot,
    dashboard,
    env_vars,
    feature_flags,
    forge_async,
    forge_chat,
    forge_health,
    forge_keys,
    forge_models,
    forge_observability,
    forge_phase4,
    forge_prompts,
    forge_rag,
    forge_rbac,
    forge_spend,
    governance_core,
    governance_violations,
    guardrails,
    health,
    hooks,
    ideation,
    knowledge_graph,
    lessons,
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
    skills,
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
    terminal_sessions,
    tool_bundles,
    tools,
    users,
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
# step-73 — Settings: self-service tokens, sessions, profile PATCH, SSO.
api_router.include_router(auth_tokens.router)
api_router.include_router(auth_sessions.router)
api_router.include_router(users.router)
api_router.include_router(feature_flags.router)
api_router.include_router(health.router)
# step-75 Phase 1 — `/api/v1/forge/health` (spec line 88). Mounted next
# to the legacy `/api/v1/health` so OpenAPI groups stay alphabetical.
api_router.include_router(forge_health.router)
api_router.include_router(forge_models.router)
api_router.include_router(forge_spend.router)
api_router.include_router(forge_keys.router)
api_router.include_router(forge_chat.router)
# step-78 — Phase 3 F11 Prompts (`/api/forge/prompts/*`).
api_router.include_router(forge_prompts.router)
# step-78 — Phase 3 F14 Async (files/batches/fine-tuning/responses).
api_router.include_router(forge_async.router)
# step-78 — Phase 3 F13 RAG (embeddings/vector-stores/rag/ocr/search-tools).
api_router.include_router(forge_rag.router)
# step-78 — Phase 3 F15 Audit / Health / Compliance / Alerts / Drift / GDPR.
api_router.include_router(forge_observability.router)
# step-78 — Phase 3 F12 RBAC (`/api/forge/rbac/*`).
api_router.include_router(forge_rbac.router)
api_router.include_router(standards.router)
# F-821 — Seeds API (Plan C — Phase 0.7)
api_router.include_router(seeds.router)
api_router.include_router(steering_rules.router)
api_router.include_router(templates.router)
api_router.include_router(policies.router)
# step-78 Phase 2 — Skills (F-9).
api_router.include_router(skills.router)
api_router.include_router(rbac.router)
api_router.include_router(audit.router)
api_router.include_router(approvals.router)
# step-72 — Phase 11 Governance + Audit (governance_core.router supersedes the dev stub surface)
api_router.include_router(governance_core.router)
api_router.include_router(governance_violations.router)
# step-77 Phase 2 — Guardrails (F-6).
api_router.include_router(guardrails.router)
api_router.include_router(artifacts.router)
api_router.include_router(connectors.router)
api_router.include_router(connector_lifecycle.router)
api_router.include_router(connector_credentials.router)
api_router.include_router(connector_activity.router)
api_router.include_router(connector_oauth.router)
api_router.include_router(agents.router)
api_router.include_router(agent_assignments.router)
api_router.include_router(model_providers.router)
api_router.include_router(agent_runtimes.router)
api_router.include_router(marketplace.router)
api_router.include_router(mcp.router)
# step-77 Phase 2 — Tools registry (F-10).
api_router.include_router(tools.router)
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
# step-73 — Billing quota (Settings → Billing tab)
api_router.include_router(analytics_usage.router)
api_router.include_router(runs.router)
api_router.include_router(terminal_commands.router)
api_router.include_router(terminal_sessions.router)
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
api_router.include_router(ideation.enhance.router)
# step-81 — M4 Ideation Center surfaces (sources / market-signals /
# customer-voice / destinations) back the 4 fixture tabs that read
# from local fixtures prior to M4 (see M4 spec §3.1 G1..G4).
api_router.include_router(ideation.sources.router)
api_router.include_router(ideation.market_signals.router)
api_router.include_router(ideation.customer_voice.router)
api_router.include_router(ideation.destinations.router)
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
# M5 T-A3 — Security Report surface (5 endpoints under
# /architecture/security-reports; see security_reports.py).
api_router.include_router(architecture.security_reports.router)
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
# F-002-LESSON — Steward review queue for Lessons Learned (step-64 Sub-step B)
api_router.include_router(lessons.router)
# step-80 — Phase 4 stub router (each feature ships in a follow-up commit).
api_router.include_router(forge_phase4.router)

__all__ = ["api_router"]
