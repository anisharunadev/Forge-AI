---
title: Glossary
description: Every Forge AI-specific term, SDLC vocabulary, and acronym.
draft: false
last_generated_at: 2026-06-18T00:00:00Z
source_sha: forareal-final
source_path: workspace/customer/glossary.md
generator: readme
approval_required: false
---

The full Forge AI glossary. The source of truth is [`workspace/customer/glossary.md`](https://github.com/fora-platform/fora/blob/main/workspace/customer/glossary.md). The glossary is **injected at every sub-agent boot** — no exceptions.

## Product names

| Term | Definition |
| --- | --- |
| **Forge AI** | The company. The Enterprise AI SDLC Operating System. |
| **Forge** | The customer-facing console. Where product managers, engineering leads, and CTOs interact with the platform. |
| **The Orchestrator** | The Master Orchestrator — the top of the agent-of-agents tree. |
| **The Runtime** | The agent execution layer. |
| **The Workspace** | The Knowledge Layer. |
| **A Run** | One end-to-end execution of the staged workflow for a single work item. Identified by `run_id`. |
| **A Stage** | One phase of the workflow — Ideation, Architect, Dev, QA, Security, DevOps, Docs. |
| **A Sub-agent** | A specialist under a stage (e.g., BA, Architect, Developer, QA, Security, DevOps, Documentation, Refactor, Cost, Audit, Evaluation, Memory). |

## Workflow and lifecycle

| Term | Definition |
| --- | --- |
| **Heartbeat** | A short execution window for an agent. Wake up, check work, do something useful, exit. |
| **Wake** | The event that triggers a heartbeat. Reasons: issue assigned, comment added, approval resolved, dependency resolved, child completed. |
| **Issue / Task** | The unit of work in the platform. |
| **Parent / Child** | A child issue is a subtask of a parent. |
| **Blocker** | A first-class dependency. Set via `blockedByIssueIds`, not in free text. |
| **Gate** | A stage boundary. The next stage does not start until the gate's owner approves. |
| **Handoff Contract** | The versioned JSON Schema + worked example that defines what flows between two stages. |
| **SLA** | Service Level Agreement — p50/p99 latency and error budget for a service or stage. |
| **SLO** | Service Level Objective — the internal target. Stricter than SLA. |
| **ADR** | Architecture Decision Record. One decision per doc, in `docs/adr/`. |

## Agent runtime and tooling

| Term | Definition |
| --- | --- |
| **MCP** | Model Context Protocol. The standard our agents use to call external tools. |
| **MCP Server** | A server that exposes a tool surface to the agent runtime over MCP. |
| **Tool** | One callable function exposed by an MCP server. |
| **Allow-list** | The set of tools a given agent (or run) is permitted to call. The default is empty. |
| **Plan-then-act** | The agent emits a plan; the runtime validates against the allow-list; only then are tools called. |
| **StageEngine** | The typed runtime port that loads a handoff contract, enforces the gate, and invokes the stage handler. |
| **Tool Output Sanitisation** | Wrapping tool results in `<tool_output source="...">` and passing them back to the model as data, not instructions. |
| **Eval Case** | A golden input/output pair used to regression-test a prompt, tool schema, or agent contract. |
| **Golden Trace** | A recorded run used to regression-test the staged workflow end-to-end. |
| **Safety Eval** | An eval case that exercises a safety property (prompt-injection, exfiltration, scope-escalation, PII leakage). |
| **Token Budget** | The hard cap on tokens consumed by a run. |
| **Cost Budget** | The hard cap on dollars spent by a run. |
| **Idempotency Key** | A client-supplied token that makes a mutating call safe to retry. |
| **Egress Proxy** | The only path the agent runtime uses to fetch external URLs. Denies private CIDRs. |

## Tenant, identity, and security

| Term | Definition |
| --- | --- |
| **Tenant** | A customer. The unit of data isolation. Every row, every log line, every metric carries a `tenant_id`. |
| **Tenant ID** | A kebab-case stable identifier, e.g., `acme-corp`. |
| **MCP Namespace** | A per-tenant boundary for MCP server configuration, e.g., `mcp-acme-corp`. |
| **Run Identity** | A short-lived JWT scoped to a tenant, a run, and an allow-list. ≤ 15 min, rotated on stage transition. |
| **DPA** | Data Processing Addendum. |
| **DPIA** | Data Protection Impact Assessment. Required for any feature that processes special-category data. |
| **SoA** | Statement of Applicability. The ISO 27001 artefact. |
| **PII** | Personally Identifiable Information. Marked with `pii: true` in the DB schema. |
| **PHI** | Protected Health Information. Out of scope for v1. |
| **SSO** | Single Sign-On. |
| **MFA** | Multi-Factor Authentication. Required for every Forge AI staff account. |

## Engineering and SDLC

| Term | Definition |
| --- | --- |
| **SDLC** | Software Development Lifecycle. The sequence we are automating. |
| **PRD** | Product Requirements Document. The output of the Ideation stage. |
| **ADR** | Architecture Decision Record. |
| **PR** | Pull Request. The unit of code review. |
| **RC** | Release Candidate. |
| **One-way Door** | A decision that is expensive or impossible to reverse. Requires an ADR and CTO sign-off. |
| **Two-way Door** | A decision that is easy to reverse. Ships fast. |
| **Bake** | The post-deploy window (default 10 min) during which the new revision must stay healthy or auto-rollback fires. |
| **Ephemeral Environment** | A per-PR environment. |
| **Test Pyramid** | Unit → Integration → E2E → Eval. |
| **Coverage** | The percentage of code branches exercised by the test suite. Tracked per PR. |
| **Error Budget** | The allowed amount of unreliability in a service. |
| **FinOps** | The practice of attributing, monitoring, and optimising cloud spend. |

## Anti-glossary (terms we avoid)

| Term | Why we avoid it |
| --- | --- |
| **"AI magic"** | Hand-waving. We describe what the agent did, how, and at what cost. |
| **"Just works"** | Marketing copy. We describe the contract, the test, and the failure mode. |
| **"Eventually consistent"** | Lazy thinking. We say "read-after-write" or "max staleness X seconds." |
| **"Temporary"** | A lie. We say "ticket Forge AI-NNN, owner X, retire by date Y." |
| **"Best effort"** | A non-SLA. We say "p99 X ms, error budget Y." |
| **"Just a small change"** | The most expensive sentence in engineering. We measure, then we call it. |
| **"We'll fix it later"** | A promise we will not keep. We file a ticket the same day. |
| **"It depends"** | Forbidden in production docs. |

## Where to next

- **[ADRs →](/reference/adr/)** — every architecture decision.
- **[Architecture overview →](/architecture/)** — how the pieces fit.

<div class="freshness-footer">
  <dl>
    <dt>Source SHA</dt><dd><code>forareal-final</code></dd>
    <dt>Source path</dt><dd><code>workspace/customer/glossary.md</code></dd>
    <dt>Last generated</dt><dd>2026-06-18T00:00:00Z</dd>
    <dt>Generator</dt><dd><code>readme</code> · DocAgent v1.0 ([Forge AI-298](/Forge AI/issues/Forge AI-298))</dd>
  </dl>
</div>
