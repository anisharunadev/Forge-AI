# Forge AI — Tech Stack

**Status:** v2.0 (production bar) — aligned with Master Development Charter
**Owner:** CTO
**Related:** [PRD.md](./PRD.md), [roadmap.md](./roadmap.md), [memory/architecture.md](../memory/architecture.md)

---

## 1. Stack principles

1. **Boring where boring is correct.** Postgres, Kubernetes, GitHub Actions, TypeScript. The novel parts of the platform — the agent runtime, the staged workflow, the Knowledge Layer — are the only places we tolerate novelty.
2. **Build vs. orchestrate.** If AWS, GitHub, SonarQube, Figma, or any other integrated tool already does it well, we orchestrate. The agent runtime is novel; the auth we use is OIDC.
3. **Open standards, not proprietary lock-in.** MCP for tool calls, OpenTelemetry for traces, JSON Schema for contracts, OpenAPI for the public surface.
4. **The customer can swap the model provider.** We are not Anthropic-only, not OpenAI-only. The customer picks per tenant.
5. **Two main languages.** TypeScript for the web frontend; Python for the backend API, agent runtime, evals, and ML.

## 2. Technology Stack

### Frontend
- **Framework:** Next.js 15
- **Library:** React 19
- **Language:** TypeScript
- **Component Library:** Shadcn UI
- **Styling:** Tailwind CSS
- **Data Fetching/State:** TanStack Query, Zustand
- **Visualization:** React Flow, Recharts

### Backend
- **Framework:** FastAPI
- **Language:** Python 3.13
- **Validation:** Pydantic v2
- **ORM:** SQLAlchemy
- **Migrations:** Alembic

### Agent Runtime
- **Framework:** LangGraph
- **LLM Routing:** LiteLLM
- **Observability:** OpenTelemetry

### Database
- **Primary Database:** PostgreSQL 17
- **Vector Extension:** pgvector
- **Cache/Queue:** Redis

### Realtime
- **Protocol:** WebSockets
- **Pub/Sub:** Redis PubSub

### Auth
- **Identity Provider:** Keycloak
- **Protocols:** OIDC, SAML
- **Authorization:** RBAC

### Infrastructure
- **Containerization:** Docker, Docker Compose
- **IaC:** Terraform
- **CI/CD:** GitHub Actions
- **Cloud Provider:** AWS

## 3. Integrations (MCP servers)

Each MCP server lives in a per-tenant namespace, behind a per-tenant egress proxy.

| Tool | MCP server | Auth flow | Read / Write | Notes |
| --- | --- | --- | --- | --- |
| **Jira** | In-house | OAuth 2.0 (3LO) | R/W | Track requirements and workflows |
| **GitHub** | In-house | GitHub App (per-tenant) | R/W | Repositories, PR creation, status sync |
| **Confluence** | In-house | OAuth 2.0 (3LO) | R/W | Documentation and knowledge |
| **SonarQube** | In-house | Token per tenant | R | Scan trigger, findings, gate |
| **Figma** | In-house | OAuth 2.0 | R | UI/UX design integration |
| **AWS** | In-house | Cross-account IAM role | R (scoped) | Cloud resources and deployments |
| **Slack / Teams** | In-house | OAuth 2.0 | R/W | Notification, approval, status |
| **Bitbucket/GitLab** | In-house | OAuth 2.0 / App | R/W | Alternative SCM integrations |

## 4. Anti-patterns

- A new dependency that is not on the list above without an ADR.
- Bypassing the Provider Abstraction Layer for LLM calls.
- Storing SDLC artifacts as unstructured text instead of typed artifacts.

## Related

- [Index](../README.md)
