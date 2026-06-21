# Forge AI — Enterprise SDLC Agent Operating System

> **Forge is NOT an AI agent. Forge is the operating system that orchestrates agents, knowledge, governance, and delivery workflows.**

Forge AI is the operating system for enterprise software delivery. It takes a product idea from a one-line prompt to a deployed, documented, audited change across a customer's repositories, ticketing systems, documentation, and design tools — without replacing them.

Forge runs on top of the **GSD** runtime and the **BMAD** staged workflow, and orchestrates the tools the customer's engineering org already uses — Jira, GitHub, Confluence, SonarQube, Figma, AWS, Slack — without forcing a rip-and-replace.

The customer does not get a new tool to log into. The customer gets a team of sub-agents that work the way a founding engineering team would: **one PRD, one ADR, one PR, one deploy, one Confluence page, one audit row per action.**

## Quick Links

| Surface | Path | Audience |
| --- | --- | --- |
| **Dashboard** | `/dashboard` | All personas — landing page |
| **Command Center** | `/forge-command-center` | Operators — run workflows and forge-* commands |
| **Terminal Center** | `/forge-terminal` | Developers — xterm.js + native PTY |
| **Ideation Center** | `/project-intelligence` | PMs — ideas, roadmaps, PRDs, scoring |
| **Architecture Center** | `/architecture` | Tech leads — ADRs, contracts, risk, task breakdowns |
| **Knowledge Center** | `/knowledge-center` | Stewards — org knowledge, KG, search |
| **Agent Center** | `/agent-center` | Operators — agent catalog and assignments |
| **Connector Center** | `/connector-center` | Operators — Jira/GitHub/Slack/Confluence/... |
| **Persona Picker** | `/personas/{pm,eng-lead,cto}` | Demo / first-run persona dashboards |

Backend API spec: [`docs/openapi.json`](docs/openapi.json) (204 operations across 167 paths).

## Tech Stack

| Layer | Technology | ADR |
| --- | --- | --- |
| Frontend | Next.js 15, React 19, TypeScript 5.x, Shadcn/UI, Tailwind CSS 4 | — |
| State / Data | TanStack Query, Zustand | — |
| Visualization | React Flow, Recharts | — |
| Terminal Emulator | xterm.js + xterm-addon-fit | [ADR-006](docs/architecture/decisions/0006-terminal-center-xterm-native-pty.md) |
| Realtime | WebSocket + Redis Pub/Sub | — |
| Backend | FastAPI, Python 3.13, Pydantic v2, SQLAlchemy 2.0 async | — |
| Agent Runtime | LangGraph, LangChain, LiteLLM, OpenTelemetry | [ADR-007](docs/architecture/decisions/0007-langgraph-sdlc-agent-orchestrator.md) |
| Database | PostgreSQL 17 + pgvector + Apache AGE | [ADR-002](docs/architecture/decisions/0002-postgresql-17-apache-age-pgvector.md) |
| Cache / Queue | Redis | — |
| Auth | Keycloak, OIDC, SAML, RBAC | — |
| Provider Abstraction | LiteLLM Proxy | [ADR-005](docs/architecture/decisions/0005-litellm-proxy-provider-abstraction.md) |
| Dev Execution | GSD Core + GSD Pi (white-labeled as `forge-*`) | [ADR-004](docs/architecture/decisions/0004-gsd-white-labeling.md) |
| Infra | AWS ECS Fargate, RDS PostgreSQL 17, ElastiCache Redis, S3, KMS | [ADR-001](docs/architecture/decisions/0001-cloud-only-aws-deployment.md) |
| Audit | Append-only PostgreSQL table with daily hash chain | [ADR-008](docs/architecture/decisions/0008-append-only-worm-audit-trail.md) |
| Local Dev | Docker, Docker Compose | — |

## Architecture (top-level)

```text
+--------------------------------------------------------------------+
|                              Browser                                |
|    Next.js 15 + React 19 + xterm.js + React Flow + Shadcn UI       |
+--------------------------------------------+-----------------------+
                                             |
                                  HTTPS / WebSocket
                                             |
                                             v
+--------------------------------------------------------------------+
|                          Forge Backend (FastAPI)                    |
|   +------------------+  +-------------------+  +----------------+  |
|   |  LangGraph SDLC  |  |  Terminal Manager |  | Knowledge Graph|  |
|   |  Orchestrator    |  |  (PTY, xterm.js)  |  |   (KG, Cypher) |  |
|   +------------------+  +-------------------+  +----------------+  |
|   +------------------+  +-------------------+  +----------------+  |
|   |  Forge Commands  |  |  Connector Center |  |  Approval Gate |  |
|   |  (FORGE_COMMAND_ |  |  (MCP per-tenant) |  |  (HITL)        |  |
|   |   MAP, 60+ cmds) |  |                   |  |                |  |
|   +------------------+  +-------------------+  +----------------+  |
+--------------------------------------------+-----------------------+
                                             |
                                             v
+--------------------------------------------------------------------+
|          PostgreSQL 17  +  pgvector  +  Apache AGE  +  Redis       |
|     (org knowledge + project intelligence + RLS + audit hash)      |
+--------------------------------------------------------------------+
                                             |
                                  LiteLLM Proxy (DL-025)
                                             v
+--------------------------------------------------------------------+
|   LLM Providers (model-provider agnostic — Anthropic, OpenAI,       |
|   Bedrock, Vertex AI, Azure OpenAI, OpenRouter, ...)               |
+--------------------------------------------------------------------+
```

For the full architecture summary see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Quickstart (assumes backend and frontend already running)

```bash
# 1. Open the dashboard in your browser
open http://localhost:3000/dashboard

# 2. From the Command Center, run a forge-* command:
pnpm forge:list                       # show all 60+ commands
pnpm forge:exec forge-intel-scan-repo --args '{"repo_id":"acme-api"}'

# 3. Or hit the backend API directly:
curl http://localhost:8000/api/v1/health
```

If the backend is not yet running, follow [`docs/GETTING_STARTED.md`](docs/GETTING_STARTED.md).

## Project Structure (top-level)

```text
forge-ai/
├── apps/
│   └── forge/                  # Next.js 15 console (persona dashboards, terminal, KG)
├── backend/                    # FastAPI backend (LangGraph orchestrator, KG, REST + WS)
├── mcp-servers/                # Per-tool MCP servers (Jira, GitHub, Confluence, Slack, ...)
├── packages/                   # Shared libraries (mcp-router, mcp-schemas, contracts, ...)
├── docs/                       # Charter, ADRs, architecture, operations, planning, status
│   ├── architecture/           # ADRs (locked) and overview
│   ├── operations/             # Oncall, incident response, pilots, success metrics
│   ├── planning-artifacts/     # PRDs, briefs
│   ├── status/                 # Mid-execution status snapshots
│   ├── testing/                # Test strategy, naming, integration, e2e, pen test
│   └── openapi.json            # Generated OpenAPI spec for the backend
├── infra/                      # Terraform for AWS
├── scripts/                    # dev-up.sh, smoke.sh, localstack-init.sh
├── tenants/                    # Tenant seed data
├── tests/                      # Cross-package integration tests
├── tools/                      # Dev tools
├── docker-compose.yml          # Local infra (postgres, redis, localstack)
├── package.json                # Root scripts (forge:list, forge:exec, ...)
└── pnpm-workspace.yaml         # Monorepo workspace
```

Per-package detail lives in:
- [`backend/README.md`](backend/README.md)
- [`apps/forge/README.md`](apps/forge/README.md)
- [`mcp-servers/README.md`](mcp-servers/README.md)
- [`docs/README.md`](docs/README.md)

## Constitutional Rules (8 Immutable)

| # | Rule | ADR |
| --- | --- | --- |
| **R1** | Model-provider agnostic — all LLM traffic through LiteLLM Proxy | [ADR-005](docs/architecture/decisions/0005-litellm-proxy-provider-abstraction.md) |
| **R2** | Multi-tenancy by default — `tenant_id` + `project_id` + RLS on every record | [ADR-002](docs/architecture/decisions/0002-postgresql-17-apache-age-pgvector.md) |
| **R3** | Mandatory human approval gates at Architecture, Security, Deployment boundaries | [ADR-007](docs/architecture/decisions/0007-langgraph-sdlc-agent-orchestrator.md) |
| **R4** | Typed artifacts only — ADR, API Contract, Task Breakdown, Risk Register, Security Report, Deployment Plan | — |
| **R5** | Layer isolation — Organization Knowledge shared; Project Intelligence isolated | [ADR-003](docs/architecture/decisions/0003-hybrid-mdm-steward-priority.md) |
| **R6** | Mandatory auditability — agent, model, prompt, tool, cost, artifact, timestamp, result | [ADR-008](docs/architecture/decisions/0008-append-only-worm-audit-trail.md) |
| **R7** | Mandatory observability — OpenTelemetry tracing, metrics, logs from day one | — |
| **R8** | Configurable everything — no hardcoded GitHub / Claude / OpenAI / AWS / Jira assumptions | — |

## ADRs (Architecture Decision Records)

All locked ADRs live under [`docs/architecture/decisions/`](docs/architecture/decisions/README.md):

- **ADR-001** — Cloud-only AWS deployment
- **ADR-002** — PostgreSQL 17 + Apache AGE + pgvector
- **ADR-003** — Hybrid MDM + Steward priority conflict resolution
- **ADR-004** — GSD white-labeling (DL-024) — `forge-*` command map
- **ADR-005** — LiteLLM Proxy as Provider Abstraction Layer (DL-025)
- **ADR-006** — Terminal Center via xterm.js + native PTY
- **ADR-007** — LangGraph as SDLC agent orchestrator
- **ADR-008** — Append-only WORM audit trail

The research that grounds these ADRs lives at [`docs/research-forge-architecture-decisions-2026-06-20.md`](docs/research-forge-architecture-decisions-2026-06-20.md).

## Pilot Program

We run a structured pilot before any customer goes live. The pilot playbook is in [`docs/operations/`](docs/operations/):

- `pilot-p0-pre-pilot.md` — pre-pilot readiness gate
- `pilot-p1-kickoff.md` — kickoff workshop
- `pilot-p2-execution.md` — execution phase
- `pilot-p3-evaluation.md` — evaluation gate
- `pilot-p4-expansion.md` — expansion path
- `pilot-p15-validation.md` — production validation

Day-to-day operations are covered by:
- `incident-response.md` — P0/P1/P2 process
- `oncall-runbook.md` — oncall rotation and runbooks
- `rollback-procedures.md` — environment rollback playbook
- `success-metrics.md` — pilot KPIs

## Contributing

1. Read [`docs/GETTING_STARTED.md`](docs/GETTING_STARTED.md) to bring up the stack locally.
2. Read the constitutional rules above and the ADRs in [`docs/architecture/decisions/`](docs/architecture/decisions/).
3. Read the contributing + test strategy docs:
   - [`docs/testing/test-strategy.md`](docs/testing/test-strategy.md)
   - [`docs/testing/test-naming.md`](docs/testing/test-naming.md)
4. Open a draft PR; the staged workflow runs the bar automatically.
5. Sign the CLA on first PR.

Every PR is gated by the staged workflow. The Documentation Agent (`tools/`) regenerates the OpenAPI spec and Markdown indexes on every doc run; this README and its sibling files are produced from that pipeline.

## License

Released under **Proprietary**. See [`LICENSE`](LICENSE) (TBD) for full terms.

## Source of Truth

The Knowledge Layer (`docs/CHARTER.md`, `docs/architecture/`, `docs/operations/`) owns the facts. This README is derived from it on every doc run. ADRs do not repeat research detail; they reference the specific research questions (Q1..Q7) that ground their decisions.
