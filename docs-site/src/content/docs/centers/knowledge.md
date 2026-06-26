---
draft: false
title: Knowledge
description: The Project Knowledge Graph — entities, edges, and the visualizer that lets you trace every relationship.
---

import { Icon } from '../../../components/Icon.astro';
import Callout from '../../../components/Callout.astro';
import FeatureCard from '../../../components/FeatureCard.astro';
import FeatureGrid from '../../../components/FeatureGrid.astro';
import Diagram from '../../../components/Diagram.astro';

The **Knowledge** center is the visualization layer for the Project Intelligence
graph. Every entity (repo, service, ticket, ADR, deploy, run) and every edge
(depends-on, blocks, supersedes, cites) is explorable as a node-edge diagram.

<Callout type="info" title="Per Rule 5">
  Project knowledge is isolated per project. You cannot read another project's graph
  without explicit cross-tenant approval.
</Callout>

## Entity types

<FeatureGrid cols={3}>
  <FeatureCard icon="gitbranch" color="indigo" title="Repos & services"
    description="Source repositories and the services they own." />
  <FeatureCard icon="filetext" color="cyan" title="Tickets & ADRs"
    description="Stories and architectural decisions, with full lineage." />
  <FeatureCard icon="database" color="violet" title="Data assets"
    description="Tables, queues, caches, blob stores." />
  <FeatureCard icon="rocket" color="emerald" title="Deploys"
    description="Environments, versions, approvals." />
  <FeatureCard icon="users" color="amber" title="People"
    description="Contributors, approvers, on-call." />
  <FeatureCard icon="shieldcheck" color="rose" title="Risks & incidents"
    description="Tracked risks and historical incidents with mitigations." />
</FeatureGrid>

## Visualizing the graph

The Knowledge center uses **React Flow** (the project's default visualization framework)
to render the graph. Pan, zoom, click any node to drill in.

<Diagram type="ascii" title="Sample knowledge subgraph">
{`   ┌──────────────┐    depends-on    ┌──────────────┐
   │   orders     │ ───────────────▶ │   payments   │
   │  service     │                  │   service    │
   └──────┬───────┘                  └──────┬───────┘
          │ cites                            │ cites
          ▼                                  ▼
   ┌──────────────┐                  ┌──────────────┐
   │  ADR-014     │                  │  ADR-027     │
   │  events      │                  │  idempotency │
   └──────────────┘                  └──────────────┘`}
</Diagram>

## Trace queries

The Knowledge center supports end-to-end trace queries:

- **Requirement → ADR** — show the chain from a requirement doc to the ADR that implements it.
- **ADR → Code** — show the chain from an ADR to the files and PRs that implement it.
- **Code → Test** — show coverage and tests linked to a service.
- **Test → Deployment** — show the deploy that includes the test.

## Where to next

- [Concepts → Knowledge Graph](/concepts/knowledge-graph/) — the data model.
- [Centers → Projects](/centers/projects/) — what owns the graph.
- [Centers → Artifacts](/centers/artifacts/) — the shared org-level layer above.
