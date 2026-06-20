# Forge AI — Product Requirements Document (PRD) / Master Development Charter

**Status:** v2.0 (production bar) — meets the Knowledge Layer bar in [README §3](../README.md#3-the-acceptance-bar)
**Owner:** CEO / CTO
**Related:** [roadmap.md](./roadmap.md), [tech-stack.md](./tech-stack.md), [memory/architecture.md](../memory/architecture.md)

---

## Mission

Build Forge AI, an enterprise-grade multi-tenant AI Delivery Operating System that transforms software delivery from fragmented human processes into a connected, governed, auditable, AI-assisted delivery platform.

Forge is NOT another coding agent.

Forge is the operating system that orchestrates:

* Organizational Knowledge
* Project Intelligence
* Agent Runtimes
* Governance
* Delivery Workflows
* Knowledge Graphs
* SDLC Accelerators
* Refactor Accelerators

Across all customer engagements.

---

## Core Vision

Current AI tools optimize individual developers.

Forge optimizes the entire delivery organization.

Traditional AI tools answer:
`How do we generate code faster?`

Forge answers:
`How do we deliver software faster, more predictably, more consistently, with governance, across hundreds of repositories and dozens of delivery teams?`

---

## Product Positioning

Forge is:
`Delivery Operating System`

Forge is NOT:
`Coding Assistant`, `IDE Plugin`, `Agent Wrapper`, `Chat Interface`

---

## Strategic Objective

Codify KnackForge delivery methodology into a reusable platform.
Convert `Tribal Knowledge` into `Reusable Organizational Intelligence`.

---

## Product Lines

Forge consists of three major product lines.

### 1. Project Intelligence
Understand existing systems.
Purpose: `Understand before generating.`
Inputs: GitHub, Bitbucket, GitLab, Jira, Confluence, SonarQube, AWS, Terraform, Databases, Documentation.
Outputs: Repository Graph, Dependency Graph, Service Catalog, Architecture Map, API Catalog, Knowledge Graph.

### 2. SDLC Accelerator
Accelerate software delivery.
Lifecycle: Requirement → Architecture → Development → Testing → Security → Deployment.

### 3. Refactor Accelerator
Modernize legacy systems.
Inputs: Monolith, Legacy APIs, Old databases.
Outputs: Modernization Plan, Migration Roadmap, Risk Analysis, Target Architecture.

---

## Architecture Principles

### Principle 1
Project Intelligence before automation. Never generate architecture or code without understanding the system.

### Principle 2
Human approval gates are mandatory. No autonomous: Architecture approval, Security approval, Production deployment.

### Principle 3
Everything is a typed artifact. Never store critical SDLC data as free text.
Artifacts include: Requirement, ADR, API Contract, Task Breakdown, Code Patch, Test Report, Security Report, Deployment Plan.

### Principle 4
Every action is auditable. Capture: Who, What, Why, When, Model, Cost, Prompt, Response, Artifacts.

### Principle 5
Everything is visualized. No feature is complete unless it can be viewed through the Forge UI.

---

## Three Layer Architecture

### Layer 1: Organization Knowledge Layer
Global. Shared across all tenants.
Contains: Coding standards, Security standards, Architecture patterns, Review guidelines, ADR templates, Governance policies, DevOps standards.
Managed by: Engineering Excellence Team.

### Layer 2: Project Intelligence Layer
Tenant-specific.
Contains: Repositories, Documentation, Tickets, Cloud Resources, Dependencies.
Creates: Knowledge Graph, Architecture Graph, Dependency Graph.

### Layer 3: Agent Layer
Executes delivery workflows.
Consumes: Organization Knowledge + Project Intelligence + Current Work Item.
Produces: Typed Artifacts.

---

## Multi-Tenant Model

Forge must support organizations like KnackForge, CMC, GAPI, Honeywell, with their own repositories, Jira, Confluence, AWS.
Rules: Every record must include `tenant_id` and `project_id`. Mandatory.

---

## GSD Integration Strategy

Forge will adopt Open GSD. DO NOT rebuild GSD. Use GSD as the Development Execution Engine.

### Components to Reuse
* **gsd-core**: Development execution framework (Plan, Execute, Verify, Ship).
* **gsd-pi**: Project execution runtime (Milestones, State, Context, Execution).
* **gsd-workbench**: Conceptual foundation (Forge UI becomes Enterprise GSD Workbench).
* **gsd-cloud**: Conceptual inspiration (Forge Cloud eventually extends this model).

---

## Agent Runtime Framework & Provider Abstraction

Forge must support any runtime: Claude Code, Codex, Gemini CLI, OpenCode, Aider, Hermes, GSD Core, Future Runtimes.
Never bind directly to one provider. Support: OpenAI, Anthropic, Gemini, OpenRouter, Bedrock, Azure OpenAI, Vertex AI. All traffic flows through the `Provider Abstraction Layer`.

---

## Core UI Modules & Visualization Requirements

**Modules:** Dashboard, Connector Center, Knowledge Center, Project Intelligence, Organization Knowledge, Agent Center, Development Center, Security Center, Testing Center, Deployment Center, Governance Center, Audit Center, Analytics Center.

**Visualization:** Must use `React Flow` to visualize Requirements, ADRs, Tasks, Code, Tests, Deployments, Repositories, Services, Databases, APIs. Graph relationships must be explorable.

---

## Success Criteria

North Star: `Time To Trusted Delivery (TTTD)`
Definition: `Approved Requirement → Deployment Ready Release Package With All Required Approvals`.

---

## Non Goals

Forge must NOT:
* Replace Engineers, Architects, Jira, GitHub, Confluence.
* Autonomously Deploy To Production.
* Bypass Human Approvals.

---

## Final Directive

Build Forge as an `Enterprise Delivery Operating System`, not an `AI Coding Assistant`.
The primary differentiator is: `KnackForge Delivery Methodology + Project Intelligence + Governance + Knowledge Graph + GSD Execution Engine`.
The platform must support any repository, agent, model, connector, and customer, while maintaining Auditability, Governance, Traceability, Predictability, and Consistency across the entire software delivery lifecycle.

## Related

- [Index](../README.md)
