# acme-corp — Demo Tenant Seed

The `acme-corp` package is Acme Corp's e-commerce platform demo — a 12-service microservices stack (B2C, $50M ARR, 2M monthly users, US + EU markets). This seed populates a fresh tenant with realistic identity, ingestion, architecture, risk, agent, artifact, hook, and roadmap data so the Forge UI demos walk through populated centers rather than empty states.

## Layout

```
acme-corp/
  manifest.json           # JSON Schema 2020-12 manifest (Plan E1 manifest)
  data/
    001_tenant.json       # Acme tenant
    002_users.json        # 8 demo users
    003_roles.json        # 6 named roles
    004_rbac_assignments.json # 24 role assignments
    005_projects.json     # Acme Platform project
    006_repos.json        # 14 repos (12 services + 2 libs)
    007_connectors.json   # 5 connectors (GitHub, Jira, Slack, PagerDuty, AWS)
    008_architecture_adrs.json # 18 ADRs
    009_api_contracts.json # 12 API contracts
    010_risk_registers.json # 8 risk registers
    011_agents.json       # 15 agents across 6 centers
    012_artifacts.json    # 150 typed artifacts
    013_hooks.json        # 10 webhook hooks
    014_roadmaps.json     # 4 roadmaps (Q3 2026 — Q2 2027)
```

## Stable IDs

| Entity | Range |
|---|---|
| Tenant | `11111111-1111-1111-1111-111111111111` |
| Project | `22222222-2222-2222-2222-222222222222` |
| User | `33333333-3333-3333-3333-33333333NNNN` |
| Role | `44444444-4444-4444-4444-44444444NNNN` |

## Production safety

`production_safety.allow_in_prod = false` — demo data must NEVER apply to a production tenant without `--allow-in-prod`.