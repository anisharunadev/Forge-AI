# Technology Stack & Versions

> Canonical pin list. Don't version-bump without updating this file first.

## Frontend

```text
Next.js 16.2.x
React 19
TypeScript 5.x
Shadcn/UI (Radix UI primitives)
Tailwind CSS 3.4.14          # v4 deferred post-pilot
TanStack Query
Zustand
@xyflow/react                # formerly react-flow
Recharts
@tanstack/react-virtual
@tanstack/react-table
@dnd-kit/core + @dnd-kit/sortable
@uiw/react-md-editor
sonner                       # toasts
xterm.js + WebLinksAddon + FitAddon
```

> `react-force-graph-2d` and `react-joyride` are documented defaults for knowledge graphs and onboarding tours respectively; they are **NOT** in `apps/forge/package.json` yet. Install before use, or fall back to SVG/D3 (graphs) and the existing custom tour implementation (onboarding).

## Backend

```text
FastAPI
Python 3.13
Pydantic v2
SQLAlchemy 2.x (async)
asyncpg
Alembic
Redis
httpx                       # talks to LiteLLM Proxy — never direct LLM SDKs
python-jose (JWT)
passlib[bcrypt] (passwords)
structlog
```

## Agent runtime

```text
LangGraph
LangChain
LiteLLM (Proxy only — backend uses httpx to call it)
OpenTelemetry
LangChain Community Tools
```

## Database

```text
PostgreSQL 17 + Apache AGE (graph) + pgvector (vector search)
Redis (cache + pub/sub)
```

## Realtime

```text
WebSocket
Redis Pub/Sub
Server-Sent Events (for streaming responses)
```

## Authentication

```text
Keycloak 26+
OIDC + PKCE
SAML
RBAC
```

## Infrastructure

```text
Docker
Docker Compose
Terraform (AWS — production)
GitHub Actions
AWS
floci (S3 emulator — local dev, ADR-001)
```

## The package stack

```text
packages/forge-core/            # Workflow methodology + skills + agents + commands
packages/forge-pi/              # Product intelligence (codebase scan, KG, ideation)
packages/forge-browser/         # AI browser automation (visual testing, UI review, a11y)
packages/forge-terminal-server/ # xterm.js PTY sidecar (WebSocket host for Terminal)
packages/connector-events/      # Connector event bus (shared by connectors + audit)
packages/mcp-router/            # MCP server multiplexer
packages/gsd-core-stub/         # Internal stub — do not import
packages/gsd-pi-stub/           # Internal stub — do not import
```

`forge-core` / `forge-pi` / `forge-browser` are the canonical source of truth for skills, agents, and commands. All UI surfaces (Command Center, Skills picker, Agents registry) read from these packages — never hardcode skill/agent/command lists. The other packages are infrastructure/transport — do not import from them when a UI surface needs skill/agent/command metadata.
