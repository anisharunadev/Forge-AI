---
draft: false
title: Stories
description: Tickets — the immutable anchor for every Forge AI run.
---

import { Icon } from '../../../components/Icon.astro';
import Callout from '../../../components/Callout.astro';
import FeatureCard from '../../../components/FeatureCard.astro';
import FeatureGrid from '../../../components/FeatureGrid.astro';

A **Story** is the smallest unit of work in Forge AI — usually a Jira ticket, GitHub
issue, or ClickUp task. Stories are the immutable anchor for every GSD run: the ADR
references the story, the PR references the story, the deploy references the story.

<Callout type="info" title="Tickets are read-only inside Forge">
  Forge never edits the source ticket. It mirrors a copy into the project knowledge
  graph and tracks the link. The original ticket stays in its native system.
</Callout>

## Story attributes

<FeatureGrid cols={3}>
  <FeatureCard icon="filetext" color="indigo" title="Description"
    description="Markdown body. Optional acceptance criteria in YAML frontmatter." />
  <FeatureCard icon="users" color="cyan" title="Assignees"
    description="Human owner + agent owner (forge-* command). Both required." />
  <FeatureCard icon="rocket" color="violet" title="Status"
    description="Backlog → Spike → Plan → Execute → Verify → Validate → Audit → Deploy → Done." />
  <FeatureCard icon="shieldcheck" color="rose" title="Required approvals"
    description="HITL gates derived from the story's phase and labels (security, deployment)." />
  <FeatureCard icon="history" color="amber" title="Linked runs"
    description="Every GSD run that touched the story, with timestamps and approvers." />
  <FeatureCard icon="bookmarked" color="emerald" title="Linked artifacts"
    description="ADRs, contracts, risk registers, security reports, deploy plans." />
</FeatureGrid>

## Story-to-run mapping

```
JIRA-1284 ──────► Run 2026-06-26T14:32:11Z ──► ADR-027
       │                                      ├─► Contract-114
       │                                      ├─► Risk-Register-Q2
       │                                      └─► Deploy-Plan-031
       │
       ├──────► PR feat/billing-idempotency
       └──────► Audit row #14211
```

## Where to next

- [Lifecycle → Command Center](/lifecycle/command-center/) — runs start from stories.
- [Guides → Ticket-Driven Development](/guides/ticket-driven/) — worked example.
- [Centers → Projects](/centers/projects/) — the project a story belongs to.
