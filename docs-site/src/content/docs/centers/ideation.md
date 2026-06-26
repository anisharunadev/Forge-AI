---
draft: false
title: Ideation
description: Capture problems, frame opportunities, and scope work before a single line of code is written.
---

import { Icon } from '../../../components/Icon.astro';
import Callout from '../../../components/Callout.astro';
import FeatureCard from '../../../components/FeatureCard.astro';
import FeatureGrid from '../../../components/FeatureGrid.astro';

The **Ideation** center is where work begins. Capture the problem, frame the
opportunity, scope the work, and link to evidence (tickets, customer quotes,
metrics). Once an idea is shaped, it can be promoted into a story and a GSD run.

<Callout type="tip" title="Don't skip ideation">
  Ideation is the cheapest place to fail. Forge AI surfaces ideation documents
  whenever an ADR is being drafted, so the lineage stays intact.
</Callout>

## Ideation artifacts

<FeatureGrid cols={3}>
  <FeatureCard icon="lightbulb" color="amber" title="Problem brief"
    description="What's broken, who it affects, what success looks like." />
  <FeatureCard icon="activity" color="cyan" title="Opportunity canvas"
    description="Why now, what's possible, what's at risk." />
  <FeatureCard icon="filetext" color="indigo" title="Scope doc"
    description="In-scope, out-of-scope, unknowns, owners." />
  <FeatureCard icon="users" color="violet" title="Stakeholder map"
    description="Who decides, who implements, who is impacted." />
  <FeatureCard icon="database" color="emerald" title="Evidence"
    description="Linked tickets, customer quotes, dashboards, prior incidents." />
  <FeatureCard icon="rocket" color="rose" title="Promotion"
    description="Convert the ideation doc into a story + GSD run when ready." />
</FeatureGrid>

## Promoting to a run

When ideation is ready, the Ideation center offers a one-click promotion:

1. Pick the project.
2. Pick the ticket type (Story / Epic / Spike).
3. Confirm the linked evidence moves with it.
4. The story opens in [Lifecycle → Command Center](/lifecycle/command-center/).

## Where to next

- [Lifecycle → Command Center](/lifecycle/command-center/) — promote into a GSD run.
- [Concepts → Knowledge Graph](/concepts/knowledge-graph/) — how evidence is linked.
- [Centers → Stories](/centers/stories/) — the artifact a run is anchored to.
