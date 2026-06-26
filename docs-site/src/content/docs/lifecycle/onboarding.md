---
draft: false
title: Onboarding
description: Bring a new team or tenant onto Forge AI — setup, pilot phase, success metrics.
---

import { Icon } from '../../../components/Icon.astro';
import Callout from '../../../components/Callout.astro';
import FeatureCard from '../../../components/FeatureCard.astro';
import FeatureGrid from '../../../components/FeatureGrid.astro';
import Steps from '../../../components/Steps.astro';

The **Onboarding** center walks a new team or tenant through the pilot program. From
zero to first GSD run in under a week.

<Callout type="tip" title="Pilot program">
  Forge AI ships with a structured pilot program: P0 → P1 → P2 → P3 → P4 → P15.
  See the [Pilot program overview](/operations/pilot-overview/) for the full timeline.
</Callout>

## Onboarding phases

<FeatureGrid cols={3}>
  <FeatureCard icon="rocket" color="indigo" title="P0 — Provision"
    description="Tenant created, KMS keys issued, connectors wired." />
  <FeatureCard icon="gitbranch" color="cyan" title="P1 — Connect"
    description="Repos ingested, knowledge graph seeded, tickets mirrored." />
  <FeatureCard icon="lightbulb" color="amber" title="P2 — Ideate"
    description="First ideation doc → first ADR → first story." />
  <FeatureCard icon="hammer" color="violet" title="P3 — Build"
    description="First GSD run → first PR → first deploy to staging." />
  <FeatureCard icon="shieldcheck" color="rose" title="P4 — Govern"
    description="First policies applied, first compliance report, first audit." />
  <FeatureCard icon="activity" color="emerald" title="P15 — Adopt"
    description="10+ active projects, 100+ runs/week, full org-wide rollout." />
</FeatureGrid>

## Day-1 checklist

<Steps>
  <li>
    <h3>Provision the tenant</h3>
    <p>Run <code>forge-tenants-create --name acme --region us-east-1</code>. KMS keys are issued automatically.</p>
  </li>
  <li>
    <h3>Wire the connectors</h3>
    <p>GitHub, Jira, Slack — set credentials via the [Connector Center](/centers/connectors/).</p>
  </li>
  <li>
    <h3>Ingest the first repo</h3>
    <p>Point <code>forge-project-intelligence-ingest</code> at one repo. Verify the knowledge graph builds.</p>
  </li>
  <li>
    <h3>Run the GSD tutorial</h3>
    <p><code>pnpm gsd --tutorial</code> walks the team through a one-hour end-to-end run on a sandbox repo.</p>
  </li>
  <li>
    <h3>Apply baseline policies</h3>
    <p>From the [Governance playground](/lifecycle/governance/), apply the 14 built-in F-003 policies.</p>
  </li>
</Steps>

## Where to next

- [Pilot program overview](/operations/pilot-overview/) — full timeline + KPIs.
- [Local setup](/guides/local-setup/) — try it on your laptop first.
- [Guides → Multi-tenant Setup](/guides/multi-tenant-setup/) — multi-tenant specifics.
