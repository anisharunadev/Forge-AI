---
draft: false
title: Ticket-Driven Development
description: A complete walkthrough — from a Jira ticket to a merged PR with full audit trail.
---

import { Icon } from '../../../components/Icon.astro';
import FeatureCard from '../../../components/FeatureCard.astro';
import FeatureGrid from '../../../components/FeatureGrid.astro';
import Callout from '../../../components/Callout.astro';
import CommandExample from '../../../components/CommandExample.astro';
import Steps from '../../../components/Steps.astro';
import ImagePlaceholder from '../../../components/ImagePlaceholder.astro';

This guide walks through a real ticket — **JIRA-1284: "Add idempotency keys to /billing/charge"** —
from issue to merged PR with full GSD audit trail. Each step includes a screenshot of the
relevant Forge AI screen.

## The ticket

<ImagePlaceholder caption="JIRA-1284 in the Forge AI ticket pane." alt="Jira ticket placeholder">
  <Icon name="filetext" size={48} color="#71717A" />
</ImagePlaceholder>

```yaml
ticket:
  id: JIRA-1284
  title: Add idempotency keys to /billing/charge
  reporter: acme-eng-lead
  priority: High
  acceptance:
    - Endpoint accepts Idempotency-Key header.
    - Replay with same key returns original response within 24h.
    - Rows in billing.charges have idempotency_key UNIQUE constraint.
    - Audit log captures key + outcome.
```

## Run the seven phases

<Steps>
  <li>
    <h3>Spike — research the codebase</h3>
    <p>Co-pilot: <code>@repo/billing @ticket/JIRA-1284 /spike</code></p>
    <p>Output: brief on current <code>/billing/charge</code> handler, idempotency libraries already in use, and a list of open questions.</p>
  </li>
  <li>
    <h3>Plan — draft typed artifacts</h3>
    <p>Co-pilot: <code>/plan</code>. Drafts an ADR (MADR format), an API Contract (OpenAPI), a Task Breakdown, and a Risk Register.</p>
    <Callout type="warning" title="HITL gate">
      The Plan phase ends with an Architecture approval. The orchestrator pauses until a designated approver signs off.
    </Callout>
  </li>
  <li>
    <h3>Execute — generate code + tests</h3>
    <p>Forge runs in parallel:
      <code>forge-development-scaffold</code>,
      <code>forge-development-tests</code>,
      <code>forge-development-migration</code>.</p>
  </li>
  <li>
    <h3>Verify — run the test suite</h3>
    <p>Forge runs unit, integration, and security tests. Coverage report attached to the run.</p>
  </li>
  <li>
    <h3>Validate — compliance check</h3>
    <p>Policies evaluate: PII redaction on Stripe payloads, secret scan (no API keys leaked), dependency blocklist.</p>
  </li>
  <li>
    <h3>Audit — sign-off</h3>
    <p>Compliance bundle assembled: ADR, contract, test report, coverage report, policy evaluations.</p>
    <Callout type="info" title="Second HITL gate">
      Audit phase ends with a Security approval. Required before Deploy.
    </Callout>
  </li>
  <li>
    <h3>Deploy — promote to staging</h3>
    <p>PR merged. Auto-deploy to staging. Production deploy requires a third HITL gate (Deployment).</p>
  </li>
</Steps>

## What you get at the end

- **1 ADR** — `adr-2026-06-26-idempotency-keys.md`
- **1 API Contract** — `openapi/billing.charge.yaml` (diff attached)
- **1 Task Breakdown** — 8 tasks, all closed
- **1 Risk Register** — 3 risks identified, all mitigated
- **1 PR** — `feat/billing-idempotency` with 14 commits, 47 files
- **1 Audit Row** — signed, hash-chained, immutable
- **1 Deploy** — staging, then production with rollback plan

## Customizing the workflow

You can edit the GSD workflow:

- Add or remove phases (e.g. add a "Design review" between Plan and Execute).
- Reorder (e.g. require Validate before Execute for compliance-heavy projects).
- Inject custom nodes (e.g. a connector call to a design system).

See [Workflows → Building a Workflow](/guides/building-workflow/) for the editor.

## Where to next

- [Lifecycle → Command Center](/lifecycle/command-center/) — the full GSD reference.
- [Guides → Spec → Execute → Deploy](/guides/spec-execute-deploy/) — greenfield version.
- [Lifecycle → Runs](/lifecycle/runs/) — how to monitor active runs.
