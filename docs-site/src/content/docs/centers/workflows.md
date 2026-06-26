---
draft: false
title: Workflows
description: The visual workflow builder — drag-and-drop SDLC orchestration with nine node types, version control, and one-click execution.
---

import { Icon } from '../../../components/Icon.astro';
import FeatureCard from '../../../components/FeatureCard.astro';
import FeatureGrid from '../../../components/FeatureGrid.astro';
import Callout from '../../../components/Callout.astro';
import Diagram from '../../../components/Diagram.astro';
import Steps from '../../../components/Steps.astro';

The **Workflows** center is a visual builder (n8n-style) for orchestrating the SDLC.
Drag nodes onto the canvas, wire them together, set guardrails, and run the workflow
end-to-end — every execution becomes an auditable run.

<ImagePlaceholder caption="The visual workflow builder with a 5-node SDLC chain." alt="Workflow builder placeholder">
  <Icon name="workflow" size={48} color="#71717A" />
</ImagePlaceholder>

## Node types

Nine first-class node types, all implemented as pluggable adapters.

<FeatureGrid cols={3}>
  <FeatureCard icon="hammer" color="indigo" title="Forge command"
    description="Runs any forge-* command. Outputs stream into the next node." />
  <FeatureCard icon="plug" color="cyan" title="Connector"
    description="Calls a connected service (GitHub, Jira, Slack, AWS, Figma…)." />
  <FeatureCard icon="cpu" color="violet" title="LLM"
    description="Invokes a model via the LiteLLM proxy. Supports any provider." />
  <FeatureCard icon="filetext" color="amber" title="Artifact"
    description="Promotes a node's output to a typed artifact (ADR, contract, plan)." />
  <FeatureCard icon="shieldcheck" color="rose" title="Approval"
    description="Pauses for human review. Required at Architecture, Security, Deployment boundaries." />
  <FeatureCard icon="gitbranch" color="emerald" title="Branch"
    description="Conditional routing on a JSON-path expression against the prior node's output." />
  <FeatureCard icon="history" color="cyan" title="Loop"
    description="Iterates over an array. Each iteration is logged as a sub-run." />
  <FeatureCard icon="zap" color="amber" title="Webhook"
    description="Receives inbound HTTP from GitHub, Jira, or any external service." />
  <FeatureCard icon="bookmarked" color="violet" title="Knowledge"
    description="Reads from or writes to the project knowledge graph." />
</FeatureGrid>

## Anatomy of a workflow

<Diagram type="ascii" title="A 5-node workflow">
{`                ┌────────────────┐
                │   Webhook      │
                │   trigger      │
                └───────┬────────┘
                        │ payload
                        ▼
                ┌────────────────┐
                │   Forge        │
                │  architecture- │
                │     plan       │
                └───────┬────────┘
                        │ ADR draft
                        ▼
                ┌────────────────┐
                │   Approval     │ ─── human ──▶ continue
                │  (HITL gate)   │
                └───────┬────────┘
                        │ approved ADR
                        ▼
                ┌────────────────┐
                │   Artifact     │
                │   write        │
                └────────────────┘`}
</Diagram>

## Building your first workflow

<Steps>
  <li>
    <h3>Open the visual builder</h3>
    <p>Navigate to <strong>Centers → Workflows → New</strong>. Pick a template or start blank.</p>
  </li>
  <li>
    <h3>Drag a trigger</h3>
    <p>Every workflow starts with a <strong>Webhook</strong>, <strong>Forge</strong>, or <strong>Connector</strong> node.</p>
  </li>
  <li>
    <h3>Wire nodes</h3>
    <p>Click the output handle of one node and drag to the input handle of the next. The canvas validates the connection type automatically.</p>
  </li>
  <li>
    <h3>Add HITL gates</h3>
    <p>Drop an <strong>Approval</strong> node at any boundary that requires human review. The orchestrator will pause execution.</p>
  </li>
  <li>
    <h3>Save and run</h3>
    <p>Click <strong>Save</strong> to commit a version. Click <strong>Run</strong> to execute. Every run is auditable and replayable.</p>
  </li>
</Steps>

<Callout type="warning" title="Approval gates are mandatory">
  Architecture, Security, and Deployment boundary nodes cannot be bypassed by workflow
  authors. The orchestrator enforces the gate at runtime. See [Approval Gates (HITL)](/concepts/approval-gates/).
</Callout>

## Versioning

Every save creates an immutable version:

- `v1` — initial draft
- `v2` — first revision
- `vN` — current

Each version records: who edited it, what changed, and which runs executed against it.
Roll back by clicking a previous version and selecting **Restore as draft**.

## Templates

The Workflows center ships with seven production-tested templates:

| Template | Purpose | HITL gates |
|----------|---------|------------|
| `pr-review` | PR opened → review → comment | 1 (Security if findings) |
| `ticket-to-adr` | New story → ADR draft → approval → commit | 1 (Architecture) |
| `nightly-scan` | Cron → security scan → findings report | 0 |
| `deploy-promote` | Build → deploy → smoke tests | 2 (Security, Deployment) |
| `incident-triage` | PagerDuty → triage → runbook → notify | 1 (Deployment rollback) |
| `release-notes` | Commits since last tag → categorized notes | 0 |
| `cost-rollup` | Daily LiteLLM spend → digest to Slack | 0 |

## Cross-module orchestration

Workflows can call into any module:

- Trigger from **Connector** events (Jira ticket, GitHub PR, Slack command).
- Promote artifacts via **Artifact** nodes — the artifact lands in the relevant center.
- Surface runs in **Audit** with full timeline.
- Hand off to **Co-pilot** for human-in-the-loop refinement.

## Where to next

- [Guides → Building a Workflow](/guides/building-workflow/) — a complete walkthrough.
- [Lifecycle → Runs](/lifecycle/runs/) — what happens when a workflow executes.
- [Concepts → Approval Gates](/concepts/approval-gates/) — how HITL nodes work.
