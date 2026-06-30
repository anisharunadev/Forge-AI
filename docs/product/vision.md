# Product: Vision

> **Status:** ✅ Canonical — every Forge contributor should internalize this
> **Doc owner:** Product team
> **Source of truth:** `~/forge-ai/CLAUDE.md` + `docs/ARCHITECTURE.md`
> **Last updated:** 2026-06-30

---

## The mission

> **Forge is NOT an AI agent.**
> **Forge is the operating system that orchestrates agents, knowledge, governance, and delivery workflows.**

Forge AI Agent OS is the **enterprise SDLC Agent Operating System**. It ingests a tenant's repositories, documentation, and ticketing systems into a project intelligence knowledge graph; provides delivery accelerators (Ideation, Architecture, Development, Security, Testing, Deployment) that produce typed artifacts; and governs every action through approval gates, audit, cost attribution, and observability.

---

## What Forge IS

- **A governed control plane** — multi-tenant, RBAC-enforced, audit-tracked
- **An orchestration layer** — LangGraph agents + workflows that combine human + AI work
- **A knowledge substrate** — Org Knowledge (curated) + Project Intelligence (ingested)
- **A delivery accelerator** — 12+ Centers (Agent, Connector, Knowledge, Ideation, Architecture, etc.)
- **A compliance surface** — every action logged, every artifact typed, every cost attributed

---

## What Forge is NOT

- ❌ **An AI agent itself** — Forge runs agents, doesn't replace them
- ❌ **A no-code platform** — Forge is for engineers; it removes toil, not craft
- ❌ **A vendor lock-in** — Forge is provider-agnostic via LiteLLM Proxy
- ❌ **A single-tenant tool** — every Forge deployment serves many orgs
- ❌ **An autonomous gun** — humans approve at Architecture, Security, Deployment boundaries
- ❌ **A black box** — every action audited, every prompt hashed, every result attributable

---

## The 8 (now 18) immutable rules

These rules govern every line of code, every feature, every AI agent action. **Violating a rule = rejected PR.**

### Core 8 (the original constitutional rules)

1. **R1 — Provider-agnostic LLM access via LiteLLM Proxy**
   - All LLM traffic through the LiteLLM Proxy; never direct SDK imports
   - Single integration point; cost governance; audit; vendor portability

2. **R2 — Multi-tenancy by default**
   - Every record carries `tenant_id` + `project_id`; RLS enforced at DB level
   - Cross-tenant reads = 404 (not 403 — no enumeration)

3. **R3 — Human approval gates at boundaries**
   - Architecture / Security / Deployment boundaries require human approval
   - AI proposes; humans approve

4. **R4 — Typed artifacts only**
   - LLM outputs are Pydantic models with `extra="forbid"`; never raw text
   - Typed artifacts are testable, auditable, diff-able

5. **R5 — Layer isolation**
   - Org Knowledge (shared across tenants) vs Project Intelligence (per-tenant)
   - Standards are universal; projects are private

6. **R6 — Mandatory auditability**
   - Every action logged to append-only audit trail with SHA-256 hash chain
   - DB-level immutability listener

7. **R7 — Mandatory observability**
   - OpenTelemetry tracing + metrics + logs from day one
   - Every service exports to the observability stack

8. **R8 — Configurable everything**
   - No hardcoded GitHub / Claude / OpenAI / AWS / Jira assumptions
   - Every external dependency is configurable per-tenant

### Extended 10 (R9-R18 — the elaborations)

9. **R9** — forge-core is canonical for skills/agents/commands (auto-discovered)
10. **R10** — forge-pi owns product intelligence (codebase scanning, KG construction)
11. **R11** — forge-browser owns visual automation (screenshots, a11y audits)
12. **R12** — Cross-cutting concerns are global chrome (Co-pilot FAB, ⌘K Command, WorkspaceSwitcher)
13. **R13** — Idempotency-Key on every mutation (network retry safety)
14. **R14** — Soft delete by default (hard delete only for GDPR)
15. **R15** — Approval events are typed (Literal["approve", "reject"])
16. **R16** — Secrets Fernet-encrypted at rest (per-tenant key derivation)
17. **R17** — UI never uses emoji as icons (lucide-react only)
18. **R18** — Accessibility mandatory (WCAG 2.1 AA, Lighthouse ≥ 90)

**Full elaboration:** `/docs/standards/architecture-rules.md`

---

## The 3-package architecture

Forge ships as 3 primary packages + the host application:

```
┌─────────────────────────────────────────────────────────────┐
│ apps/forge                       (Next.js + React frontend) │
│                                                              │
│  - 26 feature docs (Centers, Lifecycle, Tools, Admin)       │
│  - Workspace chrome (sidebar, ⌘K, ⌘J)                       │
│  - Persona-aware dashboards                                  │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ HTTP / WebSocket / SSE
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ backend (FastAPI)                                           │
│                                                              │
│  - ~280 REST routes (auto-discovered OpenAPI)               │
│  - 60+ SQLAlchemy models                                     │
│  - LangGraph sub-graphs (SDLC, Refactor, Validator, etc.)   │
│  - LiteLLM client wrapper                                   │
│  - Append-only audit trail + SHA-256 hash chain             │
└─────────────────────────────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
┌────────────────┐  ┌────────────────┐  ┌────────────────┐
│ packages/      │  │ packages/      │  │ packages/      │
│ forge-core     │  │ forge-pi       │  │ forge-browser  │
│                │  │                │  │                │
│ Skills +       │  │ Product        │  │ Visual         │
│ Agents +       │  │ Intelligence:  │  │ Automation:    │
│ Commands       │  │ KG + PRD       │  │ Screenshots +  │
│ (canonical)    │  │ + scoring      │  │ a11y audits    │
│                │  │                │  │                │
│ 69 forge-*     │  │ 6 commands     │  │ 6 commands     │
│ commands       │  │                │  │                │
└────────────────┘  └────────────────┘  └────────────────┘
```

### Why 3 packages?

| Package | Owns | Replaces |
|---|---|---|
| `forge-core` | All `forge-*` commands + skills + agents | Don't hardcode lists in `apps/forge` (R9) |
| `forge-pi` | Codebase scanning, KG construction, idea scoring, PRD generation | Don't reimplement in `apps/forge` (R10) |
| `forge-browser` | Screenshots, pixel diff, a11y audits, UAT automation | Don't reimplement in `apps/forge` (R11) |

**Rule:** If a UI feature claims to ingest a codebase, score an idea, or build a knowledge graph, it **MUST delegate to `forge-pi`**. If it claims to take screenshots or run a11y checks, it **MUST delegate to `forge-browser`**. Never reimplement in `apps/forge`.

---

## The SDLC supervisor (LangGraph)

Forge's core orchestration is the **SDLC supervisor** — a LangGraph state machine that walks an agent through the 7 SDLC phases:

```
Discovery → Plan → Architecture → Build → Test → Review → Deploy
                                                              │
                                                              └─ HITL gate
                                                              (R3)
```

Each phase:
1. **Reads** from `SDLCState` (Pydantic TypedDict)
2. **Persists** typed artifacts to the registry (R4)
3. **Emits** audit events (R6)
4. **Calls** LLM via LiteLLM Proxy (R1)
5. **Pauses** at HITL gates (R3)

**Sub-graphs** (Refactor Agent, Code Validator, Knowledge Ingest) are independent LangGraph graphs with their own state, prompt, and virtual key prefix. They run as sub-graphs of the parent supervisor.

---

## The 12 Centers (top-level navigation)

Forge organizes capabilities into **12 Centers** that an operator visits:

| Center | Doc | Purpose |
|---|---|---|
| Dashboard | [dashboard.md](../features/dashboard.md) | Main Bento + 4 KPIs + 8 widgets |
| Agent Center | [agent-center.md](../features/agent-center.md) | Agent registry + executions + metrics |
| Connector Center | [connector-center.md](../features/connector-center.md) | 12 ConnectorTypes + OAuth + Fernet |
| Knowledge Center | [knowledge-center.md](../features/knowledge-center.md) | KG explorer + 14 NodeKinds |
| Ideation Center | [ideation-center.md](../features/ideation-center.md) | Ideas → PRDs (12 sub-routers, 56 routes) |
| Architecture Center | [architecture-center.md](../features/architecture-center.md) | ADRs + contracts + risks (9 tabs, 42 routes) |
| Workflows | [workflows.md](../features/workflows.md) | Visual DAG + 4 node types |
| Runs | [runs.md](../features/runs.md) | Live + replay run center |
| Governance | [governance.md](../features/governance.md) | Policies + guardrails + LiteLLM bridge |
| Analytics | [analytics.md](../features/analytics.md) | LLM usage + cost + burn rate |
| Command Center | [command-center.md](../features/command-center.md) | ⌘K palette + 63 forge commands |
| Co-pilot | [copilot.md](../features/copilot.md) | Conversational AI + 11 V1 tools |

---

## The 4 personas

Forge serves 4 primary personas (RLS-scoped via cookies + X-Forge-Persona header):

| Persona | Job-to-be-done | Dashboard | Permissions |
|---|---|---|---|
| **PM** | Track project health, surface risks, drive alignment | PM dashboard | Read-mostly |
| **Eng Lead** | Sprint planning, capacity, quality gates | Eng Lead dashboard | `seeds:view` |
| **Steward** | Org knowledge, standards, compliance, governance | Steward dashboard | `seeds:manage`, governance |
| **CTO** | Org-wide portfolio, cost, strategic direction | CTO dashboard | All |

**Persona is context, not auth.** The proxy sets `X-Forge-Persona`; the backend is the source of truth for RBAC.

**Full persona matrix:** `/docs/product/personas.md`

---

## Why "operating system"

Forge isn't an agent — it's the substrate agents run on. Like an OS:
- **Kernel** — LangGraph orchestrator + LiteLLM Proxy + tenant-scoped DB
- **Drivers** — Connectors (Jira, GitHub, Confluence, Figma, Slack, SonarQube, AWS)
- **Filesystem** — Artifact Registry (typed artifacts, content-hashed, append-only)
- **Process scheduler** — Workflow executor + Approval gates
- **Permissions** — RBAC + RLS + tenant isolation
- **Audit log** — Immutable append-only with SHA-256 chain

When a customer says "we want our agents to do X", the answer is rarely "build a new agent" — it's "wire X into Forge's orchestrator + governance + audit". That's the platform leverage.

---

## The white-label boundary (DL-024)

Users of Forge AI must **NEVER see "GSD" anywhere** in the UI, logs, or API responses. Every internal engine command is exposed under a `forge-*` name.

```
Forge UI  -->  forge-* command  -->  GSDWrapper  -->  gsd-core (internal)
                                       \-->  gsd:phase:discovery (opaque)
```

The single source of truth is `backend/app/services/forge_commands.py` (`FORGE_COMMAND_MAP`, 63 entries across 13 categories). Internal command names use the opaque `gsd:<area>:<verb>` form so any leaked reference (log line, error message, audit record) still doesn't advertise the underlying engine.

**Why:** Forge can swap engines without users noticing. The brand is Forge, not the underlying SDLC framework.

---

## Success metrics

A successful Forge deployment is measured by:

| Metric | Target |
|---|---|
| **Time-to-first-deliverable** | < 1 day from tenant onboarding |
| **Adoption** | > 80% of engineers use Co-pilot weekly |
| **Cost per workflow** | < $5 (median across all workflows) |
| **Audit coverage** | 100% of mutations logged |
| **Approval latency** | < 4 hours median (Architecture) |
| **False-positive validator rate** | < 10% |
| **Knowledge graph size** | > 1,000 nodes per project after 1 month |
| **Lighthouse Accessibility** | ≥ 90 on every page |
| **Multi-tenant isolation incidents** | 0 |
| **Direct SDK import violations** | 0 (R1 grep passes) |

---

## What we're NOT building (out of scope)

To maintain focus, Forge explicitly does NOT include:

- ❌ **A general-purpose chatbot** — Co-pilot is scoped to SDLC work
- ❌ **A WYSIWYG page builder** — Forge is for engineers
- ❌ **A marketplace of AI models** — Forge uses LiteLLM's provider abstraction
- ❌ **A CRM / HR / ERP** — Forge is SDLC only
- ❌ **A no-code automation platform** — workflows are typed (R4); no arbitrary scripts
- ❌ **A social network / collaboration tool** — Forge has comments + audit, not Slack-clone
- ❌ **A learning management system** — Org Knowledge is for standards, not training

If a customer asks for one of these, the answer is: "Use the right tool for the job, and integrate with Forge via Connectors."

---

## Where to go next

- [Personas](./personas.md) — 4 personas with job-to-be-done + permissions
- [Glossary](./glossary.md) — Domain terms (artifact, run, approval gate, LiteLLM proxy, forge-core, etc.)
- [Architecture summary](./architecture-summary.md) — High-level diagram + 3-package split
- [Standards](../standards/architecture-rules.md) — The 18 rules in detail
- [Features](../features/README.md) — 26 feature docs
- [Reference](../reference/8-rules.md) — Quick-reference cards

---

**If you remember one thing:** Forge is the **governed control plane** for AI agents in the enterprise SDLC. It's not the agent — it's the OS.