
Backend wiring plan (for frontend to backend integration)

Phase 1: OIDC Auth (Step 53) — Keycloak login, JWT tokens, auth guard
Phase 2: Agents + Providers — Wire Agents Center to /api/v1/agents/*
Phase 3: Connectors — Wire Connectors Center to /api/v1/connectors/*
Phase 4: Workflows + Runs — Wire Workflows + Runs to /api/v1/workflows/*
Phase 5: Dashboard — Now with real data
Phase 6: Knowledge Graph — Wire to /api/v1/knowledge/*
Phase 7: Projects + Stories — Wire to /api/v1/projects/* + /api/v1/stories/*
Phase 8: Ideation — Wire to /api/v1/ideation/* (uses forge-pi)
Phase 9: Co-pilot — Wire to /api/v1/copilot/* (chat + streaming)
Phase 10: Terminal — Wire to PTY sidecar WebSocket
Phase 11: Governance + Audit — Wire to /api/v1/governance/* + /api/v1/audit/*
Phase 12: Settings — Wire to /api/v1/settings/*
Phase 13: Onboarding — Wire to /api/v1/onboarding/*