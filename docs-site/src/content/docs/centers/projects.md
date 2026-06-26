---
draft: false
title: Projects
description: Project Intelligence — the isolated per-project knowledge graph that grounds every Forge AI decision.
---

import { Icon } from '../../../components/Icon.astro';
import Callout from '../../../components/Callout.astro';
import FeatureCard from '../../../components/FeatureCard.astro';
import FeatureGrid from '../../../components/FeatureGrid.astro';

A **Project** is the unit of isolation in Forge AI. Every project carries its own
knowledge graph, its own run history, and its own artifact set. Projects never
read from or write to other projects — they only inherit from the
[organization knowledge](/centers/artifacts/) layer.

<Callout type="info" title="Per Rule 5">
  Organization Knowledge is shared. Project Intelligence is isolated. This is one of
  Forge AI's core principles.
</Callout>

## What lives in a project

<FeatureGrid cols={3}>
  <FeatureCard icon="gitbranch" color="indigo" title="Repos"
    description="One or many source repositories. Ingested, indexed, and linked to tickets." />
  <FeatureCard icon="filetext" color="cyan" title="ADRs and contracts"
    description="Every architectural decision and every API contract, versioned and traceable." />
  <FeatureCard icon="database" color="violet" title="Knowledge graph"
    description="Entities (services, tickets, ADRs, deploys) and edges (depends-on, blocks, supersedes)." />
  <FeatureCard icon="shieldcheck" color="rose" title="Risk register"
    description="Per-project risk inventory with mitigations and owners." />
  <FeatureCard icon="history" color="amber" title="Run history"
    description="Every GSD run, workflow execution, and co-pilot session." />
  <FeatureCard icon="users" color="emerald" title="Members + roles"
    description="Per-project RBAC. Inherits tenant roles; can be more restrictive, never less." />
</FeatureGrid>

## Project lifecycle

1. **Create** — name, repos, owner.
2. **Ingest** — `forge-project-intelligence-ingest` scans repos, builds the graph.
3. **Plan** — first ADR drafted in the [Command Center](/lifecycle/command-center/).
4. **Build** — GSD runs scaffold the codebase.
5. **Operate** — continuous runs, audits, deploys.
6. **Archive** — read-only mode; knowledge preserved.

## Where to next

- [Concepts → Knowledge Graph](/concepts/knowledge-graph/) — the data model.
- [Concepts → Multi-tenancy](/concepts/multi-tenancy/) — isolation rules.
- [Guides → Local setup](/guides/local-setup/) — point Forge at a project.
