# `mcp-servers/` — Forge AI MCP Servers

This directory hosts the per-tool Model Context Protocol (MCP) servers that Forge AI orchestrates. Each server is a small Node.js or Python package that exposes one external system (Jira, GitHub, Confluence, Slack, ...) over MCP/stdio. The backend routes requests through `packages/mcp-router` to enforce per-tenant egress, audit, and rate limits.

## Inventory

Each server is its own package with a uniform layout (`bin/`, `src/`, `test/`, `docs/`, `package.json` / `pyproject.toml`, `tsconfig.json`).

### Priority 1 — Shipped in v1

| Server | Package | Language | External system | Notes |
| --- | --- | --- | --- | --- |
| `jira` | `forge-ai/mcp-jira` | TypeScript | Atlassian Jira | Pinned to a single Jira project at startup; OAuth 2.0 (3LO) |
| `github` | `forge-ai/mcp-github` | TypeScript | GitHub | GitHub App per tenant; enforces `GITHUB_ORG` |
| `confluence` | `forge-ai/mcp-confluence` | TypeScript | Atlassian Confluence | OAuth 2.0 (3LO) |
| `slack` | `forge-ai/mcp-slack` | TypeScript | Slack | OAuth 2.0; notifications + approvals |
| `figma` | `forge-ai/mcp-figma` | TypeScript | Figma | Read-only; design link + tokens extract |
| `sonarqube` | `forge-ai/mcp-sonarqube` | TypeScript | SonarQube | Token per tenant; we do not write to SonarQube |
| `aws` | `forge-ai/mcp-aws` | Python | AWS | Cross-account IAM role; deploy, IAM, secrets read |
| `secrets` | `forge-ai/mcp-secrets` | TypeScript | Vault / Secrets Manager | Internal — read + audit |

### Priority 2 — Pilot partners

| Server | Package | Language | External system |
| --- | --- | --- | --- |
| `arch-analyzer` | `forge-ai/mcp-arch-analyzer` | TypeScript | Internal arch artifact analyzer |
| `clickup` | `forge-ai/mcp-clickup` | TypeScript | ClickUp |
| `zendesk` | `forge-ai/mcp-zendesk` | TypeScript | Zendesk |
| `azure-devops` | `forge-ai/mcp-azure-devops` | TypeScript | Azure DevOps |
| `databricks` | `forge-ai/mcp-databricks` | TypeScript | Databricks |
| `databricks` | `forge-ai/mcp-databricks` | TypeScript | Databricks |

## Uniform Layout

Every server follows the same shape so they can be swapped or removed without touching the orchestrator:

```text
mcp-servers/<name>/
├── bin/
│   └── fora-mcp-<name>.mjs    # launcher (resolves dist/index.js)
├── src/
│   └── index.ts                # MCP server entry, tool registrations
├── test/                       # vitest / jest tests
├── docs/                       # server-specific README
├── package.json
├── tsconfig.json
└── README.md                   # tool catalog + install instructions
```

Python servers (`aws`) substitute `src/` for the package root, `pyproject.toml` for `package.json`, and the launcher at `bin/`.

## Reference: `forge-ai/mcp-jira` — the priority-1 template

Six tools over MCP/stdio:

- `list_issues`
- `search_jql`
- `get_issue`
- `create_issue`
- `add_comment`
- `transition_issue`

The server is **pinned to a single Jira project** at startup. The model can pass an `issueIdOrKey`, but the underlying project is asserted against the pin before any call lands. This is the same safety posture as `forge-ai/mcp-github`'s `GITHUB_ORG` enforcement, scoped one level deeper to a single project.

## Install

### From the monorepo (dev)

```bash
cd mcp-servers/jira
npm install
npm run build
```

The compiled entry point is `dist/index.js`. The launcher at `bin/fora-mcp-jira.mjs` resolves it for you.

### Pack and install (CI / design-partner handoff)

```bash
cd mcp-servers/jira
npm pack          # produces fora-mcp-jira-0.1.0.tgz
npm install -g ./fora-mcp-jira-0.1.0.tgz
```

## Adding a new MCP server

1. **Pick the language.** Use TypeScript unless the upstream tool only has a Python SDK (AWS, Databricks).
2. **Copy the layout from `jira/`** — `bin/`, `src/`, `test/`, `docs/`, `package.json`, `tsconfig.json`, `README.md`.
3. **Choose the auth posture.** Three options, in increasing restrictiveness:
   - **OAuth 2.0 (3LO)** for user-facing tools (Jira, Confluence, Slack, Figma).
   - **GitHub App per tenant** for code-hosting tools (GitHub pattern).
   - **Cross-account IAM role** for cloud providers (AWS pattern).
   - **Per-tenant token** for tools that ship with one (SonarQube).
4. **Implement the safety pin.** Every server must pin the upstream scope (project, org, bucket, account) at startup and reject any tool call that would escape the pin. The Jira project pin and GitHub org pin are the two reference patterns.
5. **Register tools.** One function per tool in `src/index.ts`; each tool declares its JSON-Schema input/output and a one-line description that the orchestrator can show to the LLM.
6. **Wire it into the orchestrator.** Add a connector entry in `backend/app/services/connector_manager.py` and surface it in `Connector Center` (`/connector-center`).
7. **Add to the marketplace** if the server should be installable by tenant admins (`/api/v1/marketplace/connectors`).
8. **Test.** Use the bundled test harness (`test/`); every tool must reject an unscoped call.

## Tool-call audit

Every MCP tool call is wrapped by the orchestrator and audited:

- `audit.actor` — the agent that made the call
- `audit.tool` — the MCP tool name (e.g. `jira.create_issue`)
- `audit.target` — the upstream identifier (e.g. `PROJ-1234`)
- `audit.cost_usd` — for paid APIs (per-call price, looked up from the marketplace manifest)

Audit rows live in the append-only WORM table; see [`docs/architecture/decisions/0008-append-only-worm-audit-trail.md`](../docs/architecture/decisions/0008-append-only-worm-audit-trail.md).

## Cross-references

- Architecture: [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md)
- Backend connector manager: [`../backend/app/services/connector_manager.py`](../backend/app/services/connector_manager.py)
- MCP router: [`../packages/mcp-router/`](../packages/mcp-router/)
- MCP schemas: [`../packages/mcp-schemas/`](../packages/mcp-schemas/)
- MCP transport: [`../packages/mcp-transport/`](../packages/mcp-transport/)
- Connector events: [`../packages/connector-events/`](../packages/connector-events/)
