---
title: "Product Brief: Forge Delivery Accelerator"
status: ready
created: 2026-06-18
updated: 2026-06-19
---

# Product Brief: Forge Delivery Accelerator

> Working product name: **Forge Delivery Accelerator** (formerly "Forge SDLC Platform").
> Status: **ready** — populated through coaching conversation, ready for PRD.

## Executive Summary

`forge-ai` (working product name: **Forge Delivery Accelerator**) is KnackForge's strategic investment in making delivery knowledge explicit, reusable, and enforceable across engagements — reducing dependence on individual experience while preserving human oversight.

The primary problem is the loss of delivery knowledge between requirements, architecture, implementation, and review stages — resulting in rework, inconsistent execution, and increasing dependence on individual contributors. As KnackForge scales, this dependency becomes a structural constraint: quality varies by who's assigned, senior engineers become bottlenecks, and lessons learned between projects evaporate. As AI coding tools become commoditized (Cursor, Claude Code, GitHub Copilot, Kiro have all reached production maturity), competitive advantage in software delivery is shifting from code generation to delivery systems, governance, and institutional knowledge. Forge Delivery Accelerator is KnackForge's response to both forces.

The platform replaces manual handoffs with a connected delivery system — requirements → architecture → development → security → deployment — with explicit gates and typed artifacts that flow forward. The platform's primary differentiation is the codification and application of KnackForge delivery practices, engineering standards, governance controls, and accumulated project knowledge, encoded into the platform and applied consistently to every project. Forge Delivery Accelerator is not intended to replace engineers, architects, or delivery processes.

The initial focus is internal delivery acceleration. V1 targets the KnackForge Technical Lead — the role that sits between PM, Architect, and Developer and feels the delivery pain most acutely. [ASSUMPTION] Phase 1 workflows begin with an approved requirement, with Jira as the primary entry point. [ASSUMPTION] Approval gates will be required for architecture, security, and deployment stages in Phase 1. Future commercialization will be evaluated based on adoption, measured outcomes, and customer demand.

Success is measured where leadership can verify it: a [TARGET - TO BE VALIDATED DURING PILOT] reduction in lead time from approved requirement to merged pull request, a measurable drop in engineering rework caused by late requirement or architecture changes, and a visible lift in delivery predictability across customer engagements.

---

## 2. The Problem

As organizations scale, delivery knowledge naturally becomes distributed across tools, documents, and individuals. What works for a small team becomes increasingly difficult to manage consistently across multiple projects, teams, and customers — not because the process is broken, but because the system that propagates knowledge between stages of delivery was never built to keep up with the organization.

Requirements become disconnected from implementation. A Jira story, a Confluence page, an email thread, and a Slack conversation each capture a piece of the requirement. By the time the requirement reaches development, the original intent has been filtered through multiple translations.

Because architecture decisions are not systematically captured, the reasoning behind key technical choices is often lost after initial design discussions. Teams inherit decisions without inheriting the context that produced them.

Without that context, development teams reinterpret requirements and architectural intent differently. The resulting inconsistencies often surface during code review, integration, or testing, when the cost of correction is significantly higher.

Because architecture, requirements, and implementation decisions are not connected through a shared delivery context, security and quality teams engage primarily at review time rather than design time. They inherit work that was already committed rather than work they could help shape.

Because decisions are not retained as reusable artifacts, knowledge must be recreated on each engagement. The same architectural debate happens on every project, the same security review uncovers the same issues, the same operational lessons are relearned.

As the organization scales further, delivery quality becomes increasingly dependent on individual contributors rather than repeatable systems. Senior engineers become bottlenecks. Delivery outcomes become increasingly dependent on who is assigned to the work.

New team members require significant time to become effective because critical context must be reconstructed from conversations, documents, and individual contributors rather than discovered through a consistent system.

The result, in business terms, is avoidable rework, longer delivery timelines, increased dependency on senior engineers, and reduced delivery capacity across the organization. In customer terms, the symptoms are rarely visible as process failures — they are experienced as missed expectations, inconsistent delivery quality, changing estimates, and increased project risk.

**The root problem is not any single symptom. The root problem is that delivery knowledge is not captured and propagated through the SDLC** — it is generated at every stage, partially stored in disconnected tools, and mostly lost between engagements. The symptoms above are not failures of execution; they are the predictable consequences of a system that was never designed to retain what it learned.

This is the problem Forge Delivery Accelerator is built to address.

## 3. The Solution

Forge Delivery Accelerator introduces a **delivery knowledge system** — a connected workflow that captures and propagates the reasoning, decisions, and context produced at every stage of delivery, so that the next stage inherits what the previous stage learned.

The system is built from five primitives. **Typed artifacts** are the contract between delivery stages: an initiative, a requirement, an architecture decision record, an API contract, a task breakdown, a test report, a security report, a deployment plan. Each has a defined schema, version history, and explicit ownership. A stage of delivery is complete only when it produces the artifacts that satisfy the requirements of the next stage — making hand-offs enforceable rather than merely documented. **A shared delivery context** provides a unified project view across Jira, Confluence, Slack, email, and other delivery systems, so every artifact a project has produced is queryable, linkable, and retrievable from one place. **Human approval gates** mark the transitions where a person — an architect, a security reviewer, a deployment owner — must sign off before the work proceeds, ensuring the system never bypasses human judgment. **Knowledge propagation** is the rule that every artifact produced at one stage must be consumable by the next: the architecture package is consumable by the planner, the task breakdown by the developer, the test report by security, with no re-derivation required between stages. **Auditability** ensures every artifact transition, approval, modification, and decision is recorded and traceable — who decided, why, when, and based on what. This is what makes the system governance infrastructure rather than a workflow tool.

The first mechanism the platform introduces is a **typed artifact store with propagation rules, approval gates, and an audit trail**. This is the foundation that addresses the root problem directly: delivery knowledge is captured as a typed artifact, retained in a shared context, propagated forward, and governed by approvals and audit. The initial set of artifact types — requirements, architecture decisions, API contracts, task breakdowns, code patches, test reports, security reports, deployment plans — is not exhaustive; the platform is designed so new artifact types can be added without breaking existing workflows. [ASSUMPTION] The initial set will cover the eight types listed above.

The artifact store is **initialized through a knowledge acquisition layer** that ingests existing project context — codebases, repositories, documentation, integration history, infrastructure — into typed artifacts. This is what makes the platform work for brownfield projects, where most of the delivery knowledge already exists but is scattered across systems of record. Without acquisition, the artifact store is empty; with it, the platform inherits the project's accumulated knowledge as the substrate every subsequent accelerator operates on.

The platform is organized as a **three-layer architecture**. The **Organization Knowledge Layer** is global, shared across every project — it encodes the KnackForge delivery methodology as reusable standards, templates, patterns, and governance. The **Project Intelligence Layer** is per-tenant, isolated to a single customer engagement — it ingests the project's specific context into its own knowledge graph. The **Agent Layer** is where producers and consumers of artifacts operate: each agent receives (Organization Knowledge + Project Context + Current Work Item) and produces typed artifacts. This is what enables KnackForge to deliver consistently across many independent customer engagements — the methodology is shared, the context is isolated, and the agents apply both.

People, automation, and AI systems act as producers and consumers of artifacts on top of this foundation. The foundation can be exercised with manual hand-offs before any automation is added; the value is real even when every transition is performed by a person, and AI later layers on top as acceleration rather than as the source of value.

This is the platform's answer to the root problem stated in §2: capture delivery knowledge, retain it as typed artifacts, propagate it forward, and govern every transition with approvals and audit.

## 4. Phased Product Strategy

The platform is built on a shared Foundation and three product lines that operate on top of it:

- **Foundation — Organization Knowledge Layer** — the global layer that encodes the KnackForge delivery methodology as reusable standards, templates, patterns, and governance. Every project and every agent inherits the Foundation.
- **Project Intelligence** — acquire the project's existing delivery context from its systems of record and produce a knowledge graph that becomes the substrate for everything else.
- **SDLC Accelerator** — accelerate new-feature delivery from approved requirement through architecture, development, and security + QA.
- **Refactor Accelerator** — apply the same delivery knowledge system to legacy modernization and technical-debt reduction.

Project Intelligence is the foundation of the three product lines. Most KnackForge projects are brownfield — ten or more repositories, years of history, scattered documentation, integration with multiple systems. The first challenge is not to generate architecture for a new story; it is to understand the architecture that already exists. Without Project Intelligence, the SDLC and Refactor Accelerators operate in a vacuum.

The platform is built in seven capability phases: the Foundation, plus Phases 0 through 5. Each phase introduces one accelerator or layer that extends the delivery knowledge system with a new set of typed artifacts, propagation rules, and approval gates. Agents enter the picture only as producers and consumers of artifacts; the phases themselves are defined by the capability they deliver, not by the agents that automate them.

### Foundation — Organization Knowledge Layer

**Capability:** Encode the KnackForge delivery methodology as a shared, governed asset that every project and every agent inherits. The Foundation is the global layer; it is what makes delivery consistent across many independent customer engagements.

**Primary artifacts:** Coding standards, security policies, architecture patterns, ADR templates, review checklists, deployment standards, testing standards, coding guidelines, governance rules.

**Primary users:** Admins, Engineering Excellence team, Architects (curation).

The Organization Knowledge Layer is the global asset. It is populated and curated by KnackForge Admins, Engineering Excellence, and Architects; it is consumed by every project and every agent in the platform. The same security standards, architecture patterns, review checklists, and coding guidelines are applied everywhere — the methodology is shared, the context is isolated.

### Phase 0 — Project Intelligence Accelerator

**Capability:** Acquire delivery knowledge from existing systems before any new work begins. The accelerator connects to the systems of record (code repositories, issue trackers, documentation stores, infrastructure, integration history), ingests the project's accumulated context, and produces a project knowledge graph that becomes the substrate for every subsequent accelerator.

**Primary artifacts:** Codebase analysis, service map, dependency graph, architecture map, API catalog, database map, infrastructure map, integration map, knowledge graph.

**Primary users:** Technical Leads, Architects, Engineering Managers.

**Why it is the first phase:** Most KnackForge projects are brownfield — ten or more repositories, years of history, scattered documentation, integration with multiple systems. The first challenge is not to generate architecture for a new story; it is to understand the architecture that already exists. Without Phase 0, the Architecture Accelerator and the Development Accelerator operate in a vacuum; with it, every downstream accelerator inherits the project's accumulated knowledge as its starting point. Phase 0 is also the most concrete first demo for brownfield KnackForge projects: connect the systems, watch the knowledge graph appear, and ask project-level delivery questions that previously required senior-engineer tribal knowledge.

### Phase 1 — Architecture Accelerator

**Capability:** Capture architectural knowledge as the contract between requirements and implementation. Given an approved requirement, the accelerator produces a complete architecture package that the next stage can consume without re-derivation.

**Primary artifacts:** Architecture Decision Record (ADR), API contract, task breakdown, risk register, dependency map.

**Primary users:** Architects, Tech Leads.

### Phase 2 — Development Accelerator

**Capability:** Propagate architecture into implementation. Given an approved architecture package, the accelerator produces code changes, test scaffolds, and review packages that are consistent with the architecture, the standards, and the security baseline.

**Primary artifacts:** Code patches, unit test scaffolds, review packages, standards-compliance attestations.

**Primary users:** Developers, Tech Leads.

### Phase 3 — Security + QA Accelerator

**Capability:** Embed security and quality into the delivery loop from design time, not review time. Given an architecture package and a code patch, the accelerator produces security and quality reports that the deployment gate consumes.

**Primary artifacts:** Security reports, dependency scan results, OWASP validation, IaC validation, integration test reports, E2E test reports, release readiness report.

**Primary users:** Security engineers, QA engineers, Architects.

### Phase 4 — Modernization Accelerator

**Capability:** Apply the same delivery knowledge system to legacy modernization. Given an existing codebase and a modernization target, the accelerator produces a migration plan, a target architecture, and a phased rollout that respects the running system.

**Primary artifacts:** Codebase analysis, modernization plan, target architecture, phased migration plan, risk register, deployment plan.

**Primary users:** Solution Architects, Tech Leads.

### Phase 5 — Delivery Orchestration Accelerator

**Capability:** Orchestrate the full chain as a single connected delivery system. An approved requirement flows through architecture → development → security + QA → deployment, with the full audit trail, the full propagation chain, and the full set of human approval gates.

**Primary artifacts:** End-to-end workflow definitions, deployment approval package, environment promotion record, end-to-end audit trail. Links every artifact across all four preceding accelerators.

**Primary users:** All delivery roles inside KnackForge and, eventually, customer delivery teams.

### Strategic Rollout

The five capability phases are decoupled from the strategic rollout of the platform. The capability phases describe **what the platform can do**; the strategic rollout describes **who uses and pays for it**.

- **Strategic Phase A — Internal Accelerator.** Funded from the Innovation or Engineering Excellence budget. Only KnackForge teams use it. Pricing posture: not applicable.
- **Strategic Phase B — Customer-Facing Accelerator.** The platform is delivered as part of KnackForge engagements and acts as a delivery accelerator and governance layer. Customers benefit from the platform's capabilities without requiring direct ownership of the platform. Pricing posture: included in engagement; not separately licensed.
- **Strategic Phase C — Commercial Product.** Offered as a standalone product. Pricing posture: undecided — to be evaluated after Strategic Phase B has demonstrated adoption, measured outcomes, and customer demand.

The Foundation (Organization Knowledge Layer) and Capability Phase 0 (Project Intelligence Accelerator) are delivered first regardless of strategic posture, with Capability Phase 1 (Architecture Accelerator) following as soon as a brownfield project is onboarded. The strategic rollout phases run on independent timelines: a customer-facing pilot could begin after Capability Phase 2 or 3, without waiting for the Modernization Accelerator or the Delivery Orchestration Accelerator to be complete.

The audit trail and artifact graph created across the capability phases establish the foundation for future delivery intelligence — surfacing where rework happens, which standards are violated most, where delivery time concentrates, and where the platform can intervene to improve. This is a future capability, not a Phase 1 commitment.

## 5. Personas & Entry Points

The platform serves several distinct delivery roles, each with different goals, pain points, and entry points into the platform. V1 is targeted at a single primary persona; secondary and future personas become active as capability phases ship.

### Primary Persona — KnackForge Technical Lead

**Who:** A senior engineer who sits between the PM, the Architect, developers, and the customer. Owns delivery outcomes for one or more engagements. Feels the delivery pain most acutely because they translate requirements into actionable plans, mediate architectural disagreements, and absorb the cost of rework when context is lost.

**Goals:**
- Reduce planning effort so delivery starts faster
- Improve delivery consistency across engagements
- Reduce rework caused by late requirement or architecture changes
- Make architecture decisions reusable across projects
- Increase confidence that work entering development is sufficiently defined, reviewed, and traceable

**Pain points:**
- Repeated architecture discussions that should be decided once
- Story ambiguity that surfaces only at implementation time
- Rework caused by missed architectural context
- Knowledge concentrated in senior engineers
- Lack of visibility into why previous decisions were made

**Entry point:** Architecture Accelerator.

### Secondary Persona — KnackForge Architect

**Who:** Owns architectural decisions across multiple engagements. Reviews and approves ADRs. Sets engineering standards. Currently spends significant time on repeated architectural debates and on reviewing work that should already align with established standards.

**Goals:**
- Capture architectural decisions as reusable artifacts, not as knowledge concentrated in individuals
- Reduce time spent on repeated architectural debates
- Catch architecture-level issues earlier in the delivery loop
- Make the KnackForge delivery methodology explicit and enforceable

**Pain points:**
- Architectural reasoning lost after initial design discussions
- Decisions revisited on every project because context was not retained
- Late architectural changes that require expensive rework
- Inconsistent application of standards across teams

**Entry point:** Architecture Accelerator (review and approval); later, Modernization Accelerator. In the Architecture Accelerator, the Technical Lead owns the flow and the Architect owns the approval — a clean separation of responsibility that the platform enforces.

### Future Personas

As the platform extends beyond V1, additional delivery roles become active users:

- **Developer** (Capability Phase 2, Development Accelerator) — consumes approved architecture, owns implementation.
- **Security Engineer** (Capability Phase 3, Security + QA Accelerator) — reviews security reports, owns the security approval gate.
- **QA Engineer** (Capability Phase 3, Security + QA Accelerator) — reviews test reports, owns the quality approval gate.
- **Solution Architect** (Capability Phase 4, Modernization Accelerator) — owns modernization engagements.
- **Customer Delivery Team** (Strategic Phase B) — Technical Leads, Architects, and Developers in customer organizations who experience the platform as part of a KnackForge engagement.
- **Commercial Buyer** (Strategic Phase C) — the VP Engineering or Director who purchases a standalone commercial deployment. The buyer is distinct from the user; the user is still the Technical Lead or Architect.
- **Engineering / Delivery Manager** (Capability Phase 5, Delivery Orchestration Accelerator) — the role that consumes delivery intelligence: lead time, rework rate, standards compliance, where delivery time concentrates. Not a V1 persona, but the eventual user of the audit trail and artifact graph.
- **Admin / Engineering Excellence** (Foundation — Organization Knowledge Layer) — curates the global standards, templates, patterns, and governance that every project inherits. V1-active because the Foundation must be populated before Phase 0 (Project Intelligence) can operate; without an Admin persona, the Organization Knowledge Layer is empty and downstream accelerators have nothing to inherit.

### User Journey — Technical Lead through the Project Intelligence Accelerator

The V1 user journey begins with the Technical Lead bringing a brownfield project into the platform:

1. **Connect the systems of record.** The Technical Lead connects the project's repositories (GitHub, Bitbucket, or GitLab), Jira, Confluence, SonarQube, and AWS accounts to the platform. Each connection begins streaming artifacts into the platform's intake.
2. **Trigger project intelligence.** The Project Intelligence Accelerator ingests the project: codebases, repositories, documentation, issue history, infrastructure, integration topology. The ingestion is incremental and resumable; the Technical Lead can monitor progress.
3. **Review the knowledge graph.** The Technical Lead reviews the produced project knowledge graph: architecture map, service catalog, dependency graph, API catalog, database map, repository graph. The Technical Lead validates the graph against their own understanding of the project.
4. **Ask delivery questions.** The Technical Lead can now ask project-level delivery questions that previously required senior-engineer tribal knowledge: "Which repositories are affected if we change authentication?" "Which services handle payment processing?" "What's the dependency between auth-service and the mobile app?" The platform answers from the knowledge graph, not from re-reading files.
5. **Hand off to the SDLC Accelerator.** With the project intelligence in place, the SDLC Accelerator can produce architecture packages that respect the existing system. The Technical Lead's first aha is not "the accelerator generated an architecture" — it is "the platform understood our project in minutes."

### User Journey — Technical Lead through the Architecture Accelerator

The follow-on journey, available once the project has been onboarded, is the Technical Lead moving an approved requirement through the Architecture Accelerator:

1. **Import the requirement.** The Technical Lead imports an approved requirement from Jira into the platform. The requirement becomes a typed artifact in the project's shared delivery context, and the Project Intelligence layer connects it to the affected services, repositories, and APIs identified in the knowledge graph.
2. **Review the architecture package.** The Architecture Accelerator produces a complete architecture package — ADR, API contract, task breakdown, risk register, dependency map — grounded in the existing system's knowledge graph. The Technical Lead reviews each artifact against the requirement and against established standards.
3. **Review and approve.** The Technical Lead signs the approval gate, accepting the architecture package as the authoritative input to the next stage. Approval is a typed event recorded in the audit trail.
4. **Request changes (if required).** If the architecture package is not acceptable, the Technical Lead requests changes, which the accelerator incorporates and re-presents. The change loop is a first-class concept — every iteration is recorded and traceable.
5. **Hand off to development.** The approved architecture package becomes the authoritative input to the next stage. The Technical Lead hands off with the full set of artifacts and the full audit trail.
6. **Trace downstream work.** The Technical Lead can trace every downstream artifact — code patch, test report, security report — back to the original requirement and the architecture package that justified it.

The first journey is the brownfield entry point. The second journey is what becomes possible once the platform has understood the project. Together they form the V1 demonstration: ingest an existing project, then accelerate new work against it.

### Entry Points

The platform's customer entry points are outcomes, not modules. Each entry point serves a distinct persona and addresses a specific stage of the delivery loop.

- **Entry Point 0 — Project Intelligence Accelerator.** For Technical Leads, Architects, and Engineering Managers. The brownfield entry point. The first aha: a brownfield project's existing systems become a queryable knowledge graph in hours, and a Technical Lead can answer project-level delivery questions ("which repos are affected if we change authentication?") the same morning.
- **Entry Point 1 — Architecture Accelerator.** For Technical Leads and Architects. Once a project is onboarded, the Architecture Accelerator turns an approved requirement into a complete architecture package (ADR, API contract, task breakdown) in minutes, grounded in the existing system.
- **Entry Point 2 — Development Accelerator.** For Developers. Propagates approved architecture into code, tests, and review packages. The second SDLC capability.
- **Entry Point 3 — Modernization Accelerator.** For Solution Architects. Applies the delivery knowledge system to legacy modernization. The Refactor Accelerator's customer entry point.

The Security + QA Accelerator is not a separate customer entry point — it extends the delivery chain after the Architecture and Development Accelerators ship.

### Non-Goals

The platform explicitly does not aim to:

- **Replace software engineers, architects, or delivery processes.** The platform makes delivery knowledge explicit and reusable; it does not substitute for human judgment.
- **Deliver software fully autonomously.** Every approval gate requires a human sign-off; no transition is automatic.
- **Replace Jira, GitHub, Confluence, or any other system of record.** The platform integrates with them; it does not displace them.
- **Generate production code without review.** Code produced by the platform is reviewed by a human before merge.
- **Make delivery decisions on behalf of delivery teams.** The platform captures and propagates decisions; it does not make them.
- **Achieve 100% automation of the delivery loop.** The platform is a knowledge system; automation layers on incrementally and is not a precondition for value.
- **Fully automate software delivery.** The platform accelerates delivery; it does not remove humans from the loop.

These non-goals are stated explicitly because they are the fears every leadership reader is bringing to the document. Saying them out loud turns the fears into commitments.

V1 success is measured by adoption of the **Project Intelligence Accelerator and the Architecture Accelerator** as the authoritative source of delivery context for pilot projects. The platform succeeds when delivery teams choose to use it as the authoritative source of delivery context — not when automated workflows execute.

## 6. What Makes This Different

The platform's primary differentiation is the **codification and application of KnackForge delivery methodology**.

> **The platform competes on the delivery system, not on the developer's terminal.**

### The Three Core Properties

The platform combines three core properties, applied consistently to every project:

- **Delivery Knowledge** — captured as typed artifacts, retained in a shared context, propagated forward through explicit rules.
- **Governance** — explicit approval gates with audit, ensuring no transition bypasses human judgment.
- **KnackForge Methodology** — the codified practices, engineering standards, governance controls, and accumulated project experience that today exist only as knowledge concentrated in individuals.

### The Four Outcomes

These three properties produce four outcomes that the traditional delivery process cannot deliver:

- **Traceability** — every artifact, decision, and modification is recorded, queryable, and linked to the requirement that justified it. Emerges from Knowledge + Governance.
- **Consistency** — the same practices, standards, and governance are applied to every engagement, regardless of who's assigned. Emerges from Methodology + Governance.
- **Predictability** — delivery follows a consistent, governed process with measurable checkpoints, reducing variance between teams and projects. Emerges from all three.
- **Reuse** — decisions, patterns, and lessons become reusable organizational assets rather than being re-derived on every project. Emerges from Knowledge + Methodology.

### Why KnackForge

The platform is built around delivery patterns observed across KnackForge engagements. Its value comes from encoding proven practices, governance controls, architectural standards, and implementation experience into a reusable system rather than relying on individual contributors to apply them manually. This is the bridge between product and company advantage: the platform inherits KnackForge's accumulated delivery capability and makes it explicit, enforceable, and reusable.

### The Contrast Is With Traditional Delivery, Not With Other AI Tools

Cursor, Claude Code, GitHub Copilot, and similar products accelerate individual developer productivity. They do not address the systemic problem of knowledge loss across the delivery chain. The platform competes on the system, not on the developer's terminal.

The platform does not compete on foundation model quality or coding-assistant capability. Those capabilities are expected to evolve rapidly and can be incorporated as interchangeable components of the platform. As long as delivery knowledge remains the binding constraint on KnackForge's growth, the platform's value persists — independent of which model provider is leading the market.

### Traditional Delivery vs Forge Delivery

| Dimension | Traditional Delivery | Forge Delivery |
|---|---|---|
| **Knowledge** | Concentrated in senior engineers; not systematically captured. | Captured as typed artifacts (ADR, API contract, task breakdown); retained in a shared delivery context. |
| **Reasoning** | Architectural reasoning lost after initial design discussions. | ADRs capture the *why* of every decision; the reasoning is queryable and traceable. |
| **Propagation** | Requirements reinterpreted at each stage; context rebuilt from scratch. | Artifacts flow forward through explicit propagation rules; no re-derivation required. |
| **Security + QA** | Engage at review time; remediation is expensive. | Engage from design time; security and quality reports are first-class artifacts consumed by the deployment gate. |
| **Approval** | Implicit, undocumented, in email and chat threads. | Explicit gates with audit; sign-off is a typed event in the chain. |
| **Standards** | Inconsistent application across teams. | Standards-compliance attestations are part of the artifact chain. |
| **Onboarding** | Significant time to reconstruct context from people and documents. | New team members query the artifact graph; the context is discoverable. |
| **Auditability** | Decisions are not systematically recorded. | Every artifact transition, approval, modification, and decision is recorded and traceable. |
| **Reuse** | Same debates and same mistakes recur on every project. | Decisions and patterns retained as reusable artifacts across projects. |
| **Cross-Project Learning** | Lessons remain within projects or individuals. | Patterns, decisions, and lessons become reusable organizational assets. |
| **Predictability** | Delivery outcomes vary by team and project. | Delivery follows a consistent, governed process with measurable checkpoints. |

### The Differentiator, Stated Plainly

The platform's primary differentiation is the codification and application of KnackForge delivery practices, engineering standards, governance controls, and accumulated project knowledge — encoded into the platform and applied consistently to every project. This is what an open-source orchestration framework cannot replicate, what a model provider cannot replicate, and what a coding-assistant vendor cannot replicate: the KnackForge delivery methodology, applied to every engagement, with audit and governance that no individual tool can provide.

## 7. Success Criteria

V1 success is measured by adoption; long-term success is measured by business outcomes. This section defines both: the leading indicators that show the platform is being used, the pilot metrics that show the platform is working, and the lagging indicators that show the platform is delivering business value.

The **North Star Metric** is **delivery predictability** — the variance in delivery outcomes across teams, projects, and time periods. Delivery predictability is the single most comprehensive measure of whether the root problem is being addressed: when knowledge is captured, governed, and propagated consistently, delivery outcomes converge; when it isn't, they scatter. Every other success metric in this section traces back to delivery predictability, either as a leading or lagging indicator.

### North Star Metric

**Delivery Predictability** — the consistency of delivery outcomes across teams, projects, and time. Measured as the variance in lead time, scope, and quality across comparable engagements.

- **Leading indicator of:** whether delivery knowledge is actually being captured and propagated through the SDLC.
- **Connection to root problem (§2):** when knowledge is lost, delivery outcomes vary by who's assigned; when knowledge is captured, outcomes converge.
- **Target:** *to be established after baseline measurement across pilot projects.* [TARGET - TO BE VALIDATED DURING PILOT]

### Supporting Metrics

The supporting metrics are the three business outcomes stated in §1, plus onboarding time:

- **Lead Time (Approved Requirement → Merged Pull Request)** — the time between a requirement being approved and the resulting code being merged. Reduced lead time means the delivery chain is operating efficiently. [TARGET - TO BE VALIDATED DURING PILOT]
- **Engineering Rework Rate** — the percentage of stories that reopen, the percentage of ADRs that change after approval, the percentage of sprint commitments that spill over, the rate of production defects caused by misunderstood requirements. Reduced rework means delivery knowledge is propagating forward, not requiring re-derivation.
- **Onboarding Time** — the time for a new team member to become effective on a project. Reduced onboarding time means knowledge is discoverable through the artifact graph, not concentrated in individuals. [TARGET - TO BE VALIDATED DURING PILOT]
- **Architecture Review Effort** — the time spent on architecture review and approval per requirement. Reduced review effort means the architecture package is consuming existing decisions, not re-deriving them. [TARGET - TO BE VALIDATED DURING PILOT]

### Project Intelligence Metrics

The Project Intelligence product line has its own success metrics. These measure the platform's value at the brownfield entry point, before any new work begins.

- **Time to Project Understanding** — the elapsed time between project onboarding (systems connected) and the project being queryable end-to-end. Baseline (without the platform): days to weeks of senior-engineer time. Target: hours. The platform succeeds when a KnackForge Technical Lead can answer a project-level delivery question in the same morning they connect the systems, not the following week.
- **Architecture Discovery Coverage** — the percentage of the project's repositories, services, APIs, databases, and infrastructure that the knowledge graph represents. Measured as (entities discovered) / (entities a senior engineer would name). The platform succeeds when the knowledge graph matches what a senior engineer would draw on a whiteboard.
- **Question Resolution Accuracy** — for a sample of project-level delivery questions ("which repositories are affected if we change authentication?", "which services handle payment processing?", "what's the dependency between auth-service and the mobile app?"), the percentage the platform answers correctly, validated by senior engineers. The platform succeeds when a Technical Lead can replace a senior-engineer conversation with a platform query.
- **Knowledge Acquisition Time** — the time from "project added" to "usable delivery context available." Distinct from Time to Project Understanding, this measures the full ingestion pipeline including incremental indexing, validation, and the moment a Technical Lead can confidently query the project. Target: a typical brownfield project (10–20 repositories) is queryable end-to-end within 24 hours of onboarding.

These four metrics are the entry-point measures of value. They are the leading indicators of the broader business outcomes (delivery predictability, rework rate, lead time) that the SDLC and Refactor Accelerators deliver downstream.

### Pilot Metrics

The pilot measures the platform's value in a controlled setting before scaling. Pilot metrics are baseline-anchored: each metric is measured before the platform is introduced, then re-measured at the end of the pilot. The pilot's success is whether the metrics move, not whether they hit a specific number.

The V1 pilot targets **one reference brownfield project** (a KnackForge customer engagement with 10+ repositories, established standards, and an active delivery team). The pilot validates two capabilities together: the Project Intelligence Accelerator (Foundation + Phase 0) and the Architecture Accelerator (Phase 1), exercised end-to-end as a single demonstration. The pilot's specific project, repositories, and timeline are defined in a separate Pilot Plan; the brief does not name the project so the brief survives a project change.

- **Baseline Knowledge Acquisition Time** — the time a senior engineer would need today to produce the equivalent of the knowledge graph (architecture map, service catalog, dependency graph, API catalog) for the pilot project, working without the platform. Estimated by the pilot team.
- **Baseline Question Resolution Time** — the time a Technical Lead would need today to answer a sample of project-level delivery questions for the pilot project, working without the platform. Estimated by the pilot team.
- **Baseline Lead Time** — measured across the pilot project's active work in the 90 days before pilot start.
- **Baseline Reopen Rate** — measured across the same work.
- **Baseline ADR Change Rate** — measured across the same work.
- **Pilot Knowledge Acquisition Time** — re-measured at the end of the pilot, with the platform.
- **Pilot Question Resolution Time** — re-measured.
- **Pilot Lead Time** — re-measured.
- **Pilot Reopen Rate** — re-measured.
- **Pilot ADR Change Rate** — re-measured.

The pilot's success criterion is **directional improvement** on each metric, with statistical significance to be established by the pilot's design. A specific percentage target is not committed at this stage; the pilot's purpose is to make the metrics visible and trusted, not to defend a number.

### Leading Indicators (Adoption)

Leading indicators measure whether the platform is being used. They are not business outcomes; they are the inputs to business outcomes.

- **Technical Lead Active Users** — the number of KnackForge Technical Leads who import a requirement, review an architecture package, or sign an approval gate per month. [TARGET - TO BE VALIDATED DURING PILOT]
- **Architect Active Users** — the number of KnackForge Architects who review or approve architecture packages per month. [TARGET - TO BE VALIDATED DURING PILOT]
- **Architecture Packages Approved per Month** — the throughput of the platform. Sustained growth in approved packages is a leading indicator of platform adoption.
- **Time-to-First-Architecture-Package** — the time between importing a requirement and approving the first architecture package. The platform succeeds when this falls from days to minutes; the metric measures how close the platform is to that bar.
- **Architecture Package Revision Rate** — the number of revision cycles per package before approval. A high revision rate may indicate either tight standards (good) or insufficient accelerator quality (bad); the metric requires context to interpret.

### Lagging Indicators (Business Outcomes)

Lagging indicators measure whether the platform is delivering business value. They are the outcomes the leading indicators predict.

- **Delivery Predictability** (North Star) — the variance in delivery outcomes.
- **Lead Time** — average and P90, measured per quarter.
- **Engineering Rework Rate** — quarterly aggregate.
- **Onboarding Time** — quarterly aggregate.
- **Customer-Facing Engagement NPS** — the customer's perception of delivery quality. Added in Strategic Phase B when the platform is bundled into customer engagements.
- **Standards Compliance Rate** — the percentage of completed work that meets established standards. Available in Capability Phase 3 (Security + QA Accelerator) when standards-compliance attestations become part of the artifact chain.

### What Success Does Not Mean

The platform's success is not measured by:

- **Number of agent executions.** The platform is a knowledge system; AI is an acceleration layer.
- **Number of tokens consumed.** A knowledge system is valuable because of what it captures and propagates, not because of how much compute it uses.
- **Number of artifacts produced.** A high artifact count with low reuse is not progress; it is overhead.
- **Percentage of workflows automated.** Some workflows should remain manual; full automation is not a goal.

These are the metrics that would drift the platform back into technology-led thinking. The success criteria above are anchored to business outcomes and adoption, not to platform throughput.

## 8. Guiding Principles

These principles guide every product, architecture, and implementation decision in the platform. When a trade-off arises — speed vs. governance, automation vs. control, model quality vs. platform durability — these principles resolve it.

1. **AI is an accelerator, not the source of value.** The platform's value is structural: the delivery knowledge system it implements. AI layers on top to accelerate the production and consumption of artifacts, but the value persists independent of which model is leading the market.

2. **Human approval is mandatory at governance boundaries.** Architecture, security, and deployment decisions require a human sign-off. The platform never bypasses human judgment at a governance boundary; it makes human judgment faster and more informed, not absent.

3. **Knowledge is captured once and reused everywhere.** A decision, a pattern, a standard, a lesson — once captured as a typed artifact, it is queryable and consumable by every project, every agent, every team. Re-derivation is a failure mode, not a feature.

4. **Methodology is shared globally; project context is isolated.** The Organization Knowledge Layer (KnackForge delivery methodology) is the global asset, shared across every project. The Project Intelligence Layer (per-customer knowledge graph) is per-tenant, isolated to a single engagement. The two together enable consistency without leakage.

5. **The platform augments delivery teams, not replaces them.** Engineers, architects, and delivery processes remain the source of judgment. The platform makes their work faster, more consistent, and more traceable; it does not substitute for them.

6. **Every artifact must be traceable to its originating requirement.** A code patch traces to a task, a task traces to a story, a story traces to a requirement, a requirement traces to the engagement. The audit trail is the system; the artifacts are the data it carries.

7. **Automation is optional; governance is not.** The platform can run with manual hand-offs at every transition, and the value is real. The platform can also automate transitions, but automation is never a precondition for value, and it never bypasses an explicit approval gate.
