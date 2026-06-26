---
draft: false
title: Dashboard
description: The Forge AI command center — pinned projects, active runs, recent artifacts, and the live cost ledger.
---

import { Icon } from '../../../components/Icon.astro';
import Callout from '../../../components/Callout.astro';
import FeatureCard from '../../../components/FeatureCard.astro';
import FeatureGrid from '../../../components/FeatureGrid.astro';

The **Dashboard** is the first screen you see when you sign in. It surfaces the work
that's moving — pinned projects, active GSD runs, recently promoted artifacts, and a
live cost ledger for your LiteLLM spend.

<Callout type="tip" title="Customize per role">
  Dashboard widgets are role-aware. An Engineering Lead sees burndown and ADR queue;
  a Security reviewer sees the audit timeline and F-003 policy violations.
</Callout>

## Widgets

<FeatureGrid cols={3}>
  <FeatureCard icon="rocket" color="indigo" title="Active runs"
    description="Live status of every GSD phase, workflow execution, and co-pilot background task." />
  <FeatureCard icon="filetext" color="cyan" title="Recent artifacts"
    description="ADRs, contracts, risk registers, and security reports promoted in the last 7 days." />
  <FeatureCard icon="activity" color="emerald" title="Cost ledger"
    description="Today's LiteLLM spend, broken down by tenant, agent, and model." />
  <FeatureCard icon="shieldcheck" color="rose" title="Audit feed"
    description="Last 50 audit events with quick-look severity and approver." />
  <FeatureCard icon="bookmarked" color="violet" title="Pinned projects"
    description="Your top 5 projects with health, last deploy, and open PR count." />
  <FeatureCard icon="history" color="amber" title="Drift signals"
    description="Projects diverging from F-001 standards, F-003 policies, or F-005 best practices." />
</FeatureGrid>

## Layout

The Dashboard is a 12-column grid. Drag any widget to rearrange. Layout is saved per
user and per tenant.

## Where to next

- [Co-pilot](/workspace/co-pilot/) — context-aware assistant.
- [Lifecycle → Runs](/lifecycle/runs/) — drill into a run.
- [Lifecycle → Analytics](/lifecycle/analytics/) — deeper cost and adoption metrics.
