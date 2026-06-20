# Hire #6 — MCP Platform Engineer (charter)

**Owner of charter:** CTO (`f4d4bf77-2a6b-41e0-b3c5-4a688e2913f0`)
**Status:** Draft, pending Board approval (Forge AI-451)
**Created:** 2026-06-20
**Reports to:** CTO
**Partners:** Senior Software Engineer (Hire #2), BA Agent (Hire #3), DocAgent (Hire #5), DevOps / Platform Engineer (Hire #4 — when active), Security Engineer (Hire #5 — when active)
**Related issues:** [Forge AI-48](/Forge AI/issues/Forge AI-48) (Epic 0.3 router), Forge AI-414 (Forge AI-48 plan), [Forge AI-25](/Forge AI/issues/Forge AI-25) (Epic 9 MCP Platform), [Forge AI-94](/Forge AI/issues/Forge AI-94) / [Forge AI-96](/Forge AI/issues/Forge AI-96) (Wave 2), Forge AI-200 / Forge AI-201 / Forge AI-202 / Forge AI-204 (Sync Plane adapter children)
**Work products:** [`./charter.md`](./charter.md), [`./30-60-90.md`](./30-60-90.md)

---

## 1. Objective

Own the **MCP platform layer** — the per-tenant MCP router, the cross-server contract surface (tool schema registry, circuit breakers, retry / idempotency, streaming), and the operational health of every MCP server Forge AI ships. Free every other engineering hire from bespoke per-server infra so they ship product, not plumbing.

## 2. Why now

The MCP surface is past the point where a single generalist (currently the CTO) can hold the whole thing:

- **13 MCP servers in production today** under `mcp-servers/` — `arch-analyzer`, `aws`, `azure-devops`, `clickup`, `confluence`, `databricks`, `figma`, `github`, `jira`, `secrets`, `slack`, `sonarqube`, `zendesk`. Wave 3 (TestRail / PagerDuty / Linear / ServiceNow) is queued behind Epic 11 customer pull.
- **4 cross-Epic gates** consume the router and serialize on CTO bandwidth today — Epic 0.8 (`forge/0.8/0.8.1_lint.md` lint), Epic 2.x (architecture intake), Epic 11.x (sync-plane adapters), Epic 9.x (Wave 1+2 MCP servers).
- **Hire #4 (DevOps / Platform Engineer)** from [`HIRING_PLAN.md` §2](../../HIRING_PLAN.md) is described as: *"Owns the AWS, GitHub Actions, ArgoCD, Helm, SonarQube, and Secrets surfaces."* That is **infrastructure**, not the MCP framework. These are two distinct roles; one person cannot hold both well — see §8 below.

Without this hire, every MCP integration pays a CTO tax on per-tenant scope wiring, schema-registry entries, circuit-breaker + retry consistency, audit + monitor coverage, and cross-Epic gate readiness.

## 3. Scope (owns)

1. **Per-tenant MCP router** — `tenant + server-name` → live MCP server instance resolution; <10 lines of config per new server (per the Forge AI-48 acceptance bar).
2. **Schema registry** — tool-definition source of truth; agents pull schemas from the registry, never hard-code.
3. **Circuit breakers + retry / idempotency** — half-open / open / closed per server per tenant; typed `mcp_unavailable` errors, never hangs > 5 s.
4. **Streaming + cancel semantics** — consistent across every server; respects `executionRunId` cancel from `@fora/agent-runtime`.
5. **Per-tenant scope enforcement** — tenant isolation; a tenant's agents only see that tenant's MCP servers.
6. **Server health & SLOs** — per-server latency p50 / p95, error rate, circuit state; on-call runbook per server.
7. **Server SDK** — the TypeScript package every new MCP server extends; tenant resolution, auth, retry, audit baked in.
8. **MCP server backlog stewardship** — intake, prioritization, deprecation; pairs with BA Agent (Hire #3) on roadmap.

## 4. Non-scope (does not own)

- **Application code** beyond the router / SDK. Each MCP server's business logic is owned by the team that consumes it (e.g., Jira-adapter logic is owned by Integration Engineer, not MCP Platform).
- **Cloud infra** (AWS, Kubernetes, ArgoCD, Helm, SonarQube runners). That's Hire #4 / DevOps.
- **Secret storage** (AWS SM, broker). That's the `secrets-mcp` + `customer-cloud-broker` teams; this role **consumes** them, does not own them.
- **Agent runtime** (allow-list, run records, stage machine). That's Epic 0.2 / `@fora/agent-runtime`, owned by the Senior Engineer (Hire #2).
- **Authn / authz** (OIDC, broker, tenant policy). That's Hire #5 / Security Engineer, plus Epic 0.7 (now shipped per [Forge AI-38](/Forge AI/issues/Forge AI-38)).
- **Production LLM cost** — that's the Cost sub-agent team (when hired).

## 5. Success metrics (first 6 months)

| Metric | Target |
| --- | --- |
| Time-to-add new MCP server (config lines) | < 10 lines |
| Tenant-isolation test coverage | 100% of router + every server has a tenant-scope test |
| Circuit-breaker correctness | 100% of servers emit typed `mcp_unavailable`; no hangs > 5 s |
| MCP-server p95 latency (per server, per tenant) | published + on a public dashboard |
| Cross-Epic gate readiness | Epic 0.8, 2.x, 11.x, 9.x green by day 60 |
| Server health incidents per quarter | < 2 P0 / P1 unplanned per server |
| New-server on-call runbook | exists within 1 week of server GA |
| Backlog stewardship | every new MCP-server request triaged in 5 business days |

## 6. Reporting + cadences

- **Reports to:** CTO.
- **1:1 with CTO:** weekly, 30 min, written agenda.
- **Architecture review:** monthly, with the Architecture agent (when hired) and the Senior Engineer (Hire #2).
- **MCP-server owners' sync:** bi-weekly, with whoever owns each server's business logic.
- **Public dashboard:** SLOs, circuit-breaker state, server-version matrix — published to the customer-facing status page.

## 7. Authority + escalation

- **Self-approve:** any change inside `mcp-servers/_framework/`, the schema registry, the router, the SDK, or circuit-breaker policy.
- **CTO approval required:** breaking change to the tool-schema format, new public SDK export, per-tenant scope model change.
- **Board approval required:** any change to MCP-broker billing or per-tenant SLA commitments.

## 8. Why a carve-out (Hire #6), not a fold into Hire #4

`HIRING_PLAN.md` §2 names the **DevOps / Platform Engineer** as Hire #4 with this scope: *"Owns the AWS, GitHub Actions, ArgoCD, Helm, SonarQube, and Secrets surfaces."* That role's bottleneck is **infrastructure** (clusters, CI, observability, secret storage), not **integration framework**. Conflating the two:

- Burdens Hire #4 with two unrelated stacks (cloud infra + TypeScript MCP framework), each with its own SLO culture.
- Forces every MCP-server contributor to wait on infra-vs-framework triage decisions.
- Loses the routing-recovery, schema-registry, and tenant-scope specialists the MCP surface already needs.

`HIRING_PLAN.md` §1.3 ("Generalize before specializing") endorses the carve-out: hire a generalist DevOps engineer until infra load forces a specialist; this hire targets the *other* specialist path the MCP surface already requires. The MCP framework has already specialized past the point a generalist can hold it.

## 9. Open questions for Board

1. Does the Board accept the **Hire #6 carve-out**, or do they want the MCP platform folded into Hire #4 with explicit scope partitioning?
2. **Compensation band** — same as Hire #4 (DevOps / Platform Engineer), or a small premium for the MCP-framework specialization?
3. **Sourcing channel preference:** BMAD + Paperclip community (per `HIRING_PLAN.md` §6) first, or targeted outbound?
