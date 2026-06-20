# Customer Glossary

**Scope:** Forge AI-specific terms, SDLC vocabulary, and the agent-platform jargon that appears in customer-facing material and in the Knowledge Layer.
**Audience:** Every engineer, sub-agent, and customer-facing role. This is the dictionary that lets a cold-started agent (or a new customer) read the rest of the workspace and the product.
**Stage injection:** Inject into **every** sub-agent at boot. If an agent does not have a glossary and a sub-agent-specific memory file, it is not ready to work (per [README §2](../README.md#2-the-injection-model)).

---

## 0. Quick start

- **Read [README §9](../README.md#9-quick-start-for-a-new-sub-agent) first.** That is your first ten minutes. This file is the dictionary; the README is how you walk in.
- **Glossary is injected at every sub-agent boot, no exceptions.** If a term you want to use is not in §1–§6, file a glossary PR before you use it in a prompt, doc, comment, or customer-facing surface.
- **"It depends" is banned in production docs.** §7 lists the terms we never use. The anti-glossary is the only place "it depends" can appear in the workspace — it is meta. If you find yourself writing "it depends" anywhere else, replace it with a concrete contract, a measurement, or a ticket.
- **When the same word means different things in different files, this file wins** for customer-facing vocabulary, and [memory/architecture.md](../memory/architecture.md) wins for engineering vocabulary. When both apply, cite the glossary in the doc and the memory file in the ADR.

---

## 1. Product names

| Term | Definition |
| --- | --- |
| **Forge AI** | The company. The Enterprise AI SDLC Operating System. |
| **Forge** | The customer-facing console. Where product managers, engineering leads, and CTOs interact with the platform. |
| **The Orchestrator** | The Master Orchestrator — the top of the agent-of-agents tree. Owns run lifecycle, tenant context, and budget enforcement. |
| **The Runtime** | The agent execution layer. Runs the staged workflow, holds the audit log, brokers MCP calls. |
| **The Workspace** | The Knowledge Layer. Where the customer stores their memory, customer, and project knowledge. |
| **A Run** | One end-to-end execution of the staged workflow for a single work item (PRD, story, bug, refactor). Identified by `run_id`. |
| **A Stage** | One phase of the workflow — Ideation, Architect, Dev, QA, Security, DevOps, Docs. |
| **A Sub-agent** | A specialist under a stage (e.g., BA, Architect, Developer, QA, Security, DevOps, Documentation, Refactor, Cost, Audit, Evaluation, Memory). |

## 2. Workflow and lifecycle

| Term | Definition |
| --- | --- |
| **Heartbeat** | A short execution window for an agent. Wake up, check work, do something useful, exit. |
| **Wake** | The event that triggers a heartbeat. Reasons: issue assigned, comment added, approval resolved, dependency resolved, child completed. |
| **Issue / Task** | The unit of work in the platform. The UI may say "task"; APIs and older docs may say "issue." Same thing. |
| **Parent / Child** | A child issue is a subtask of a parent. Children inherit execution workspace from the parent. |
| **Blocker** | A first-class dependency. The dependent issue cannot progress until the blocker is `done`. Set via `blockedByIssueIds`, not in free text. |
| **Gate** | A stage boundary. The next stage does not start until the gate's owner approves. The seven gates are defined in [memory/architecture.md §3](../memory/architecture.md#3-the-staged-workflow-the-spine). |
| **Handoff Contract** | The versioned JSON Schema + worked example that defines what flows between two stages. The schema lives in `packages/contracts/`. |
| **SLA** | Service Level Agreement — p50/p99 latency and error budget for a service or stage. |
| **SLO** | Service Level Objective — the internal target. Stricter than SLA. |
| **ADR** | Architecture Decision Record. One decision per doc, in `docs/adr/`. Format per [memory/architecture.md §5](../memory/architecture.md#5-adrs-architecture-decision-records). |

## 3. Agent runtime and tooling

| Term | Definition |
| --- | --- |
| **MCP** | Model Context Protocol. The standard our agents use to call external tools. |
| **MCP Server** | A server that exposes a tool surface to the agent runtime over MCP. |
| **Tool** | One callable function exposed by an MCP server. The agent's allow-list is the list of tools it can call. |
| **Allow-list** | The set of tools a given agent (or run) is permitted to call. The default is empty. |
| **Plan-then-act** | The pattern where the agent emits a structured plan, the runtime validates the plan against the allow-list, and only then are tool calls executed. |
| **StageEngine** | The typed runtime port that loads a [Handoff Contract](#handoff-contract), enforces the gate between stages, and invokes the stage handler. Two implementations ship: an in-process `InMemoryStageEngine` (tests, local dev) and a gRPC adapter (production target). Wired in [Forge AI-173](/Forge AI/issues/Forge AI-173). |
| **Tool Output Sanitisation** | Wrapping tool results in `<tool_output source="...">` and passing them back to the model as data, not instructions. |
| **Eval Case** | A golden input/output pair used to regression-test a prompt, tool schema, or agent contract. |
| **Golden Trace** | A recorded run used to regression-test the staged workflow end-to-end. |
| **Safety Eval** | An eval case that exercises a safety property (prompt-injection, exfiltration, scope-escalation, PII leakage). The set lives in `packages/evals/cases/safety/`. |
| **Token Budget** | The hard cap on tokens consumed by a run. Hitting the cap halts the run. |
| **Cost Budget** | The hard cap on dollars spent by a run. Same. |
| **Idempotency Key** | A client-supplied token that makes a mutating call safe to retry. |
| **Egress Proxy** | The only path the agent runtime uses to fetch external URLs. Denies private CIDRs and resolves DNS itself. (Control in [memory/security.md §6](../memory/security.md#6-owasp-application-security-baseline).) |

## 4. Tenant, identity, and security

| Term | Definition |
| --- | --- |
| **Tenant** | A customer. The unit of data isolation. Every row, every log line, every metric carries a `tenant_id`. |
| **Tenant ID** | A kebab-case stable identifier, e.g., `acme-corp`. Used in URLs, metric labels, log keys, and DB rows. |
| **MCP Namespace** | A per-tenant boundary for MCP server configuration, e.g., `mcp-acme-corp`. |
| **Run Identity** | A short-lived JWT scoped to a tenant, a run, and an allow-list. ≤ 15 min, rotated on stage transition. |
| **DPA** | Data Processing Addendum. The contract that governs customer data processing. |
| **DPIA** | Data Protection Impact Assessment. Required for any feature that processes special-category data. |
| **SoA** | Statement of Applicability. The ISO 27001 artefact that maps every Annex A control to its implementation. |
| **PII** | Personally Identifiable Information. Marked with `pii: true` in the DB schema. |
| **PHI** | Protected Health Information. Out of scope for v1. Requires a separate, isolated deployment. |
| **SSO** | Single Sign-On. We integrate via OIDC or SAML; we do not store customer passwords. |
| **MFA** | Multi-Factor Authentication. Required for every Forge AI staff account. |

## 5. Engineering and SDLC

| Term | Definition |
| --- | --- |
| **SDLC** | Software Development Lifecycle. The sequence we are automating: Ideation → Architect → Dev → QA → Security → DevOps → Docs. |
| **PRD** | Product Requirements Document. The output of the Ideation stage. The input to the Architect stage. |
| **ADR** | Architecture Decision Record. See §2. |
| **PR** | Pull Request. The unit of code review. |
| **RC** | Release Candidate. A tag pre-release, deployed to staging. |
| **One-way Door** | A decision that is expensive or impossible to reverse (data model, auth, secrets, agent handoff contract). Requires an ADR and CTO sign-off. |
| **Two-way Door** | A decision that is easy to reverse (refactor, internal rename, library swap). Ships fast. |
| **Bake** | The post-deploy window (default 10 min) during which the new revision must stay healthy or auto-rollback fires. |
| **Ephemeral Environment** | A per-PR environment, spun up for the PR's branch and torn down on close. |
| **Test Pyramid** | Unit → Integration → E2E → Eval. The law, not a suggestion. The four layers are defined in [memory/coding.md §5](../memory/coding.md#5-testing-discipline). |
| **Coverage** | The percentage of code branches exercised by the test suite. Tracked per PR, not as a global vanity metric. |
| **Error Budget** | The allowed amount of unreliability in a service (e.g., 99.9 % = 43 min/month of error budget). |
| **FinOps** | The practice of attributing, monitoring, and optimising cloud spend. We do this monthly. |

## 6. Acronym soup (the quick reference)

| Acronym | Meaning |
| --- | --- |
| ADR | Architecture Decision Record |
| API | Application Programming Interface |
| ASVS | Application Security Verification Standard (OWASP) |
| BA | Business Analyst (the Ideation-stage sub-agent role) |
| CDE | Common Development Environment (the platform monorepo) |
| CEO | Chief Executive Officer (also: the agent in this workspace) |
| CI | Continuous Integration (the `lint → typecheck → unit → integration → e2e → build` pipeline in [memory/devops.md §2](../memory/devops.md#2-cicd-pipeline)) |
| CTO | Chief Technology Officer (also: the agent in this workspace) |
| CVE | Common Vulnerabilities and Exposures |
| DPA | Data Processing Addendum |
| DPIA | Data Protection Impact Assessment |
| DR | Disaster Recovery |
| E2E | End-to-End (test) |
| FinOps | Financial Operations (cloud cost discipline) |
| GDPR | General Data Protection Regulation (EU) |
| HIPAA | Health Insurance Portability and Accountability Act (US) |
| IAM | Identity and Access Management |
| ISO | International Organization for Standardization |
| ISMS | Information Security Management System |
| LLM | Large Language Model |
| MCP | Model Context Protocol |
| MFA | Multi-Factor Authentication |
| MSA | Master Service Agreement |
| MVP | Minimum Viable Product |
| NDA | Non-Disclosure Agreement |
| NIST | National Institute of Standards and Technology (US) |
| OIDC | OpenID Connect |
| OWASP | Open Web Application Security Project |
| p50 | Median (50th-percentile) latency |
| p99 | 99th-percentile latency |
| PCI-DSS | Payment Card Industry Data Security Standard |
| PHI | Protected Health Information |
| PII | Personally Identifiable Information |
| PRD | Product Requirements Document |
| PR | Pull Request |
| RBAC | Role-Based Access Control |
| RC | Release Candidate |
| RPO | Recovery Point Objective |
| RTO | Recovery Time Objective |
| SAML | Security Assertion Markup Language |
| SBOM | Software Bill of Materials |
| SDLC | Software Development Lifecycle |
| SHA | Secure Hash Algorithm (used for `args_hash` in [memory/security.md §7.1](../memory/security.md#71-sample-audit-log-entry) and commit SHAs) |
| SLA | Service Level Agreement |
| SLO | Service Level Objective |
| SoA | Statement of Applicability (ISO 27001) |
| SOC 2 | Service Organization Control 2 (the audit framework) |
| SOW | Statement of Work |
| SSDF | Secure Software Development Framework (NIST SP 800-218) |
| SSO | Single Sign-On |
| UI | User Interface |
| UTC | Coordinated Universal Time |
| WCAG | Web Content Accessibility Guidelines |
| WAF | Web Application Firewall |

## 7. Anti-glossary (terms we avoid)

| Term | Why we avoid it |
| --- | --- |
| **"AI magic"** | Hand-waving. We describe what the agent did, how, and at what cost. |
| **"Just works"** | Marketing copy. We describe the contract, the test, and the failure mode. |
| **"Eventually consistent"** | Lazy thinking. We say "read-after-write" or "max staleness X seconds." |
| **"Temporary"** | A lie. We say "ticket Forge AI-NNN, owner X, retire by date Y." |
| **"Best effort"** | A non-SLA. We say "p99 X ms, error budget Y." |
| **"Just a small change"** | The most expensive sentence in engineering. We measure, then we call it. |
| **"We'll fix it later"** | A promise we will not keep. We file a ticket the same day. |
| **"It depends"** | Forbidden in production docs. The only place this phrase can appear in the workspace is this row. Replace it with a concrete contract, a measurement, or a ticket. |

## 8. Related

- Where these terms appear in the engineering defaults: [memory/coding.md](../memory/coding.md), [memory/architecture.md](../memory/architecture.md), [memory/security.md](../memory/security.md), [memory/devops.md](../memory/devops.md)
- Where these terms appear in the customer surface: [customer/standards.md](./standards.md) and [customer/conventions.md](./conventions.md)
- The product these terms describe: [project/PRD.md](../project/PRD.md)
- How the workspace is organised: [README.md](../README.md)

---

**Versioning:** this file ships through the normal release train (see [README §5](../README.md#5-versioning)). A change is a major version bump if it removes a term in active use, retires an acronym still referenced in the workspace, or changes the anti-glossary (the terms we avoid). Additions and clarifications are minor; corrections are patch. The CTO owns merges to this file; any agent that needs a new term files a glossary PR.
