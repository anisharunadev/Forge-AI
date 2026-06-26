---
draft: false
title: Building a Workflow
description: Drag-and-drop the visual builder — node reference, templates, testing, and execution.
---

import { Icon } from '../../../components/Icon.astro';
import FeatureCard from '../../../components/FeatureCard.astro';
import FeatureGrid from '../../../components/FeatureGrid.astro';
import Callout from '../../../components/Callout.astro';
import Steps from '../../../components/Steps.astro';
import Diagram from '../../../components/Diagram.astro';

The visual workflow builder lets you compose the SDLC out of nine first-class node
types. This guide shows the editor in depth.

## The canvas

The builder is split into four panes:

1. **Node palette** (left) — searchable list of all node types.
2. **Canvas** (center) — drag-and-drop authoring area.
3. **Inspector** (right) — properties of the selected node.
4. **Run log** (bottom) — live output during execution.

<Diagram type="ascii" title="Workflow builder layout">
{`+----------+------------------------------------+----------------+
|          |                                    |                |
|  Node    |            Canvas                  |   Inspector    |
|  palette |       (drag-drop authoring)         |                |
|          |                                    |                |
+----------+------------------------------------+----------------+
|                    Run log (live output)                          |
+-------------------------------------------------------------------+`}
</Diagram>

## All node types

<FeatureGrid cols={3}>
  <FeatureCard icon="zap" color="indigo" title="Trigger nodes"
    description="Webhook, Cron, Forge command, Connector event. Every workflow needs exactly one trigger." />
  <FeatureCard icon="hammer" color="cyan" title="Action nodes"
    description="Forge, Connector, LLM, Artifact. The work-doing nodes." />
  <FeatureCard icon="shieldcheck" color="rose" title="Approval nodes"
    description="Pauses for human review. Mandatory at Architecture, Security, Deployment boundaries." />
  <FeatureCard icon="gitbranch" color="emerald" title="Control flow"
    description="Branch (conditional), Loop (iterate), Parallel (fan-out), Merge (join)." />
  <FeatureCard icon="database" color="violet" title="Data nodes"
    description="Knowledge (read/write graph), Variable (set/transform), Webhook (emit)." />
  <FeatureCard icon="filetext" color="amber" title="Output nodes"
    description="Artifact (promote), Notification (Slack/email), Return (HTTP response)." />
</FeatureGrid>

## Wiring 101

Click a node's output handle (right edge) and drag to the input handle (left edge) of
another node. The canvas validates the connection type:

- **Data ports** — pass the prior node's JSON output.
- **Control ports** — pass success/failure.
- **Error ports** — pass error context.

<Callout type="warning" title="Mismatched ports snap back">
  If you connect a data port to a control port, the connection snaps back. Hover
  for the valid port types.
</Callout>

## Using templates

Open the template gallery from the canvas toolbar. Seven production-tested templates:

| Template | Use it for |
|----------|------------|
| `pr-review` | Auto-review every PR opened in a repo |
| `ticket-to-adr` | New story → ADR draft → approval → commit |
| `nightly-scan` | Cron → security scan → findings report |
| `deploy-promote` | Build → deploy → smoke tests |
| `incident-triage` | PagerDuty → triage → runbook → notify |
| `release-notes` | Commits since last tag → categorized notes |
| `cost-rollup` | Daily LiteLLM spend → digest to Slack |

Click **Use template** to copy it into your drafts. Edit freely.

## Testing a workflow

Before a workflow runs in production, test it:

<Steps>
  <li>
    <h3>Open the test runner</h3>
    <p>Click <strong>Test</strong> in the canvas toolbar.</p>
  </li>
  <li>
    <h3>Pick a sample payload</h3>
    <p>Use a real payload from a prior run, or upload a JSON file. The payload becomes the trigger's input.</p>
  </li>
  <li>
    <h3>Step through or run to completion</h3>
    <p>Step mode runs one node at a time so you can inspect intermediate outputs. Run mode executes end-to-end.</p>
  </li>
  <li>
    <h3>Inspect outputs</h3>
    <p>Every node's output is captured. Click any node to see its inputs, outputs, and timing.</p>
  </li>
</Steps>

## Versioning

Every save commits an immutable version. Use the version selector in the toolbar to:

- **Compare** — diff two versions side-by-side.
- **Restore** — copy an old version back into the editor as a new draft.
- **Pin** — set the version that runs when a webhook fires.

## Where to next

- [Centers → Workflows](/centers/workflows/) — full node reference.
- [Lifecycle → Runs](/lifecycle/runs/) — live execution monitoring.
- [Concepts → Approval Gates](/concepts/approval-gates/) — HITL node semantics.
