---
draft: false
title: Analytics
description: Cost, adoption, and health metrics across tenants, projects, agents, and models.
---

import { Icon } from '../../../components/Icon.astro';
import Callout from '../../../components/Callout.astro';
import FeatureCard from '../../../components/FeatureCard.astro';
import FeatureGrid from '../../../components/FeatureGrid.astro';

The **Analytics** center is the metric layer of Forge AI. Dashboards for cost,
adoption, run health, and policy compliance — with role-aware views per tenant.

## Dashboards

<FeatureGrid cols={3}>
  <FeatureCard icon="activity" color="emerald" title="Cost ledger"
    description="LiteLLM spend by tenant / agent / model / day. Drill into the call log." />
  <FeatureCard icon="users" color="indigo" title="Adoption"
    description="Active users, active projects, weekly GSD runs, co-pilot sessions." />
  <FeatureCard icon="rocket" color="cyan" title="Run health"
    description="GSD phase timings, failure rates, HITL-gate dwell time, success rate." />
  <FeatureCard icon="shieldcheck" color="rose" title="Policy compliance"
    description="F-001 / F-003 coverage, violation trends, override rate." />
  <FeatureCard icon="bookmarked" color="violet" title="Artifact adoption"
    description="Templates in use, standards coverage, drift events." />
  <FeatureCard icon="history" color="amber" title="Audit volume"
    description="Audit events per day, by severity and code." />
</FeatureGrid>

## Dashboards for each role

- **Founder / exec** — adoption, cost, time-to-deploy.
- **Eng lead** — run health, drift, HITL dwell time.
- **Security** — policy compliance, audit volume, overrides.
- **Finance** — cost ledger, model breakdown, projections.

<Callout type="tip" title="Exportable">
  Every dashboard exports to CSV, JSON, or a signed PDF report. Schedule daily / weekly
  digests to Slack or email.
</Callout>

## Where to next

- [Lifecycle → Governance](/lifecycle/governance/) — policy metrics.
- [Operations → Success metrics](/operations/success-metrics/) — KPI definitions.
- [Concepts → Append-only Audit](/concepts/auditability/) — audit volume feeds analytics.
