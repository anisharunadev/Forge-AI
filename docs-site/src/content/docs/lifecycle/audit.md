---
draft: false
title: Audit
description: The append-only audit timeline — every action, every approver, every hash-chain anchor.
---

import { Icon } from '../../../components/Icon.astro';
import Callout from '../../../components/Callout.astro';
import FeatureCard from '../../../components/FeatureCard.astro';
import FeatureGrid from '../../../components/FeatureGrid.astro';

The **Audit** center is the timeline view of the append-only audit ledger. Every
action — agent, model, prompt, tool, cost, artifact, timestamp, result — is recorded
with a cryptographic hash. The ledger is WORM (write-once-read-many).

<Callout type="info" title="Per Rule 6">
  All agent activity must be auditable. Capture: agent, model, prompt, tool, cost,
  artifact, timestamp, result. See [Append-only Audit](/concepts/auditability/).
</Callout>

## What gets audited

<FeatureGrid cols={3}>
  <FeatureCard icon="hammer" color="indigo" title="Every forge-* command"
    description="Inputs, outputs, model used, prompt, response, cost, latency, approver." />
  <FeatureCard icon="filetext" color="cyan" title="Every artifact"
    description="Created, updated, signed, deprecated — with full lineage." />
  <FeatureCard icon="shieldcheck" color="rose" title="Every approval"
    description="Who approved, when, what gates were passed." />
  <FeatureCard icon="plug" color="violet" title="Every connector call"
    description="Source, target, payload (redacted), response, rate-limit hits." />
  <FeatureCard icon="cpu" color="amber" title="Every LLM call"
    description="Provider, model, tokens, cost, latency, PII redaction events." />
  <FeatureCard icon="history" color="emerald" title="Every override"
    description="When a policy was bypassed, by whom, with what justification." />
</FeatureGrid>

## Timeline view

The Audit center renders a virtualized timeline (handles millions of rows).
Filter by:

- Tenant / project / agent
- Severity (info, warn, critical)
- Audit code (see [Audit Codes](/reference/audit-codes/))
- Date range
- Approver / actor

Click any row to drill into the full event payload, the linked artifact, and the
run that produced it.

## Hash-chain anchors

Daily, the audit ledger rolls up into a hash-chain anchor:

```
day-N hash = SHA256(day-N-1 hash || day-N events || day-N timestamp)
```

Any tampering with a past day invalidates every subsequent anchor. The anchor is
written to S3 Object Lock with a 7-year retention.

## Compliance bundles

From the Audit center, generate a one-click compliance bundle:

- SOC2 — Trust Services Criteria evidence.
- ISO 27001 — Annex A control evidence.
- GDPR — Data subject access request evidence.

<Callout type="tip" title="No more screenshot folders">
  Compliance bundles are auto-generated from the audit ledger. No manual evidence
  collection. No more screenshot folders.
</Callout>

## Where to next

- [Concepts → Append-only Audit](/concepts/auditability/) — the design rationale.
- [Lifecycle → Governance](/lifecycle/governance/) — policy decisions are auditable too.
- [Reference → Audit Codes](/reference/audit-codes/) — full code list.
