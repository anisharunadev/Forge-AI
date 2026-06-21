---
title: Constitutional Rules
description: The eight immutable rules that govern the Forge platform.
---

Forge is built on eight constitutional rules. Every feature, every ADR, and every workflow is anchored to one or more of them. They are immutable in the sense that **changing them requires a new ADR and a sign-off from the Architecture Working Group**.

## What is this?

The **eight constitutional rules** are the binding constraints on the platform. They are derived from the PRD's design levers (DL-*) and non-functional requirements (NFR-*) and are encoded in the ADRs.

| # | Rule | ADR / Source |
|---|---|---|
| **R1** | Model-provider agnostic — all LLM traffic through LiteLLM Proxy | [ADR-005](/architecture/adr-005-litellm/) (DL-025, NFR-029) |
| **R2** | Multi-tenancy by default — `tenant_id` + `project_id` + RLS on every record | [ADR-002](/architecture/adr-002-postgres-age/) (NFR-006, NFR-007, DL-026) |
| **R3** | Mandatory human approval gates at Architecture, Security, Deployment boundaries | [ADR-007](/architecture/adr-007-langgraph/) (NFR-032, DL-002) |
| **R4** | Typed artifacts only — ADR, API Contract, Task Breakdown, Risk Register, Security Report, Deployment Plan | F-010 |
| **R5** | Layer isolation — Organization Knowledge shared; Project Intelligence isolated | NFR-006, DL-004, DL-005 |
| **R6** | Mandatory auditability — agent, model, prompt, tool, cost, artifact, timestamp, result | [ADR-008](/architecture/adr-008-worm-audit/) (NFR-020, F-005, F-407) |
| **R7** | Mandatory observability — OpenTelemetry tracing, metrics, logs from day one | Rule 7, NFR-021..023 |
| **R8** | Configurable everything — no hardcoded GitHub/Claude/AWS/Jira assumptions | NFR-029, F-014, F-016 |

## Why does it exist?

Without binding constraints, an AI platform accumulates technical debt at the rate of model releases. The constitutional rules exist to:

- **Anchor trade-offs.** When a feature request would violate a rule, the answer is the rule, not a debate.
- **Constrain drift.** A migration that quietly bypasses R6 (audit) is detected at code review.
- **Document intent.** A new engineer can read the rules and understand *why* the platform looks the way it does.

## Rule details

### R1 — Model-provider agnostic

All LLM traffic flows through the LiteLLM Proxy. The proxy holds virtual keys per tenant, emits its own audit log, enforces budget guardrails, and emits Prometheus metrics.

You cannot import `anthropic`, `openai`, or `boto3` for model calls in the application layer. Direct imports fail code review.

See [ADR-005](/architecture/adr-005-litellm/).

### R2 — Multi-tenancy by default

Every record carries `tenant_id` and (where applicable) `project_id`. Every table has RLS. There is no opt-out.

The application sets `app.tenant_id` at the start of every transaction. The connection pool resets the setting between tenants. There is no path that bypasses the policy.

See [ADR-002](/architecture/adr-002-postgres-age/) and [Multi-tenancy](/concepts/multi-tenancy/).

### R3 — Mandatory approval gates

Three gates are mandatory: Architecture, Security, Deployment. Additional gates can be added per workflow or per tenant policy. Removing the three mandatory gates is not permitted.

The gate is enforced by the orchestrator — not the CLI. The CLI returns the command descriptor; only the orchestrator can execute a `requires_approval=True` command without a valid approval record.

See [ADR-007](/architecture/adr-007-langgraph/) and [Approval gates](/concepts/approval-gates/).

### R4 — Typed artifacts only

The six typed artifacts — ADR, API Contract, Task Breakdown, Risk Register, Security Report, Deployment Plan — are the only outputs of `forge-*` workflows. Free-form prose is not a Forge output.

Adding a new typed artifact requires an ADR. Removing a typed artifact requires an ADR.

See [Typed artifacts](/concepts/typed-artifacts/).

### R5 — Layer isolation

Two layers per tenant:

- **Organization Knowledge** — shared across all projects in a tenant. Owned by the Steward role. Standards, templates, policies, org glossary.
- **Project Intelligence** — isolated per project within a tenant. Ingested from GitHub, Jira, Confluence, etc. Services, APIs, DBs, dependencies, ADRs, tasks.

The two layers are physically co-located in the same database but isolated by RLS policies that use both `tenant_id` and a layer discriminator.

### R6 — Mandatory auditability

Every action lands in the append-only ledger with: agent, model, prompt hash, tool, cost, artifact, timestamp, result, chain hash. The ledger is mirrored to a separate AWS account with daily S3 Object Lock anchors.

You cannot `UPDATE` or `DELETE` from the `audit_log` table as the application role. The grants are revoked.

See [ADR-008](/architecture/adr-008-worm-audit/) and [Auditability](/concepts/auditability/).

### R7 — Mandatory observability

OpenTelemetry traces, metrics, and logs from day one. LiteLLM metrics + cost ledger provide budget visibility. Every log line includes `trace.id`, `tenant.id`, `project.id`, and `user.id` when available.

You cannot add a new LLM call without it going through the LiteLLM Proxy (which emits metrics). You cannot add a new endpoint without FastAPI's OpenTelemetry middleware.

See [Observability](/concepts/observability/).

### R8 — Configurable everything

No hardcoded GitHub, Claude, AWS, or Jira assumptions. Connectors, model providers, auth providers, and storage backends are all configurable per tenant.

You cannot import a vendor-specific SDK in the application layer. You go through a connector.

See [ADR-001](/architecture/adr-001-aws/) (single-cloud V1 commitment) and [Adding connectors](/guides/adding-connectors/).

## How are rules changed?

A rule change requires:

1. A new ADR superseding the original.
2. A migration plan covering existing data and integrations.
3. Sign-off from the Architecture Working Group.
4. A pilot phase exit gate (P0 → P4) confirming no regression.

In practice, rules have not changed. The architecture was deliberate.

## Related

- [What is Forge?](/start-here/what-is-forge/)
- [Architecture overview](/architecture/overview/)
- [All ADRs](/architecture/adr-001-aws/)
- [Project context](/start-here/what-is-forge/) (charter)
