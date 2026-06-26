---
draft: false
title: Command Center (GSD)
description: The GSD methodology — Spike → Plan → Execute → Verify → Validate → Audit → Deploy. Ticket-driven entry, spec mode, phase pipeline.
---

import { Icon } from '../../../components/Icon.astro';
import FeatureCard from '../../../components/FeatureCard.astro';
import FeatureGrid from '../../../components/FeatureGrid.astro';
import Callout from '../../../components/Callout.astro';
import Diagram from '../../../components/Diagram.astro';
import Steps from '../../../components/Steps.astro';

The **Command Center** is where the GSD (Get Shit Done) methodology lives. GSD is the
operating procedure that turns tickets, ideas, and specs into deployed software with
full audit trails and HITL gates. It's the entry point for ticket-driven development.

## The GSD phase pipeline

<Diagram type="ascii" title="The seven GSD phases">
{`+---------+   +------+   +---------+   +--------+   +---------+   +-------+   +---------+
|  Spike  |-->| Plan |-->| Execute |-->| Verify |-->| Validate |-->| Audit |-->| Deploy  |
+---------+   +------+   +---------+   +--------+   +---------+   +-------+   +---------+
   research    draft      generate      test        compliance    sign-off   promote
   the area    artifacts  code+tests    the change  evidence      + ship    to env
                                \\________ HITL gates at Plan / Audit / Deploy ________/`}
</Diagram>

<FeatureGrid cols={3}>
  <FeatureCard icon="lightbulb" color="amber" title="Spike"
    description="Time-boxed research. Read code, write notes, identify unknowns. Outputs: brief, links, open questions." />
  <FeatureCard icon="filetext" color="indigo" title="Plan"
    description="Draft typed artifacts: ADR, API Contract, Task Breakdown, Risk Register. HITL gate at the end." />
  <FeatureCard icon="hammer" color="cyan" title="Execute"
    description="Generate code, tests, migrations. Forge-* commands run in parallel where independent." />
  <FeatureCard icon="testtube" color="emerald" title="Verify"
    description="Run unit, integration, security, perf tests. Surface coverage and risk signals." />
  <FeatureCard icon="shieldcheck" color="violet" title="Validate"
    description="Compliance checks: policies, standards, F-001 enforcement. Evidence bundle prepared." />
  <FeatureCard icon="history" color="rose" title="Audit"
    description="Append-only ledger entry. Sign-off captured. HITL gate required before Deploy." />
  <FeatureCard icon="rocket" color="amber" title="Deploy"
    description="Promote through environments. Final HITL gate for production. Rollback plan attached." />
</FeatureGrid>

## Ticket-driven entry

Every GSD run starts from a ticket:

- **Jira** — `@jira/JIRA-1284 /gsd`
- **GitHub** — comment `/gsd` on an issue
- **Co-pilot** — `Plan a GSD run for this ticket`
- **Command line** — `pnpm gsd --ticket JIRA-1284`

The ticket becomes the **north star** — every artifact references it back. The PR
description references it. The deploy audit row references it. End-to-end traceability.

<Callout type="tip" title="Tickets as immutable anchors">
  Tickets never edit. If the work changes mid-flight, the GSD run gets a new
  revision pointer — the original ticket stays the anchor.
</Callout>

## Spec mode

For greenfield work without an existing ticket, **Spec mode** lets you draft a brief
in the co-pilot and treat it as the anchor:

```text
> /spec
  Building a /billing endpoint that accepts a Stripe webhook,
  validates the signature, and writes an Invoice row to Postgres.
  Tenant-scoped. Idempotent. Audit-logged.
```

The spec becomes a synthetic ticket. From there, the same seven phases apply.

## Cross-module orchestration

The Command Center wires every other module together:

- **Co-pilot** — opens for context and refinement.
- **Workflows** — phases are themselves workflows; you can edit them.
- **Projects** — phases update the project plan live.
- **Audit** — every transition is logged with timestamps and approvers.
- **Governance** — Validate phase runs all F-003 policies.

## What a GSD run produces

When a run completes, you have:

1. **Typed artifacts** — ADR, contract, task breakdown, risk register, security report, deployment plan.
2. **Pull request(s)** — code + tests + migration.
3. **Compliance bundle** — Zipped evidence for SOC2/ISO/GDPR.
4. **Audit entries** — Signed, hash-chained, immutable.
5. **Deploy record** — Environment, version, approver, rollback plan.

<Callout type="info" title="Where to start">
  New to GSD? Run the guided tutorial: `pnpm gsd --tutorial`. It walks you through a
  one-hour end-to-end run on a sandbox repo.
</Callout>

## Where to next

- [Guides → Ticket-Driven Development](/guides/ticket-driven/) — a worked example.
- [Guides → Spec → Execute → Deploy](/guides/spec-execute-deploy/) — greenfield walkthrough.
- [Lifecycle → Runs](/lifecycle/runs/) — what an active run looks like.
