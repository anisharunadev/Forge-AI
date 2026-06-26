---
draft: false
title: Governance & Compliance
description: Policies as guardrails, LiteLLM control, standards library, policy testing playground, and a tamper-evident audit trail.
---

import { Icon } from '../../../components/Icon.astro';
import FeatureCard from '../../../components/FeatureCard.astro';
import FeatureGrid from '../../../components/FeatureGrid.astro';
import Callout from '../../../components/Callout.astro';
import CommandExample from '../../../components/CommandExample.astro';

The **Governance & Compliance** center is where policies live and are enforced. Every
guardrail — PII redaction, secret scanning, spend caps, rate limits, dependency
blacklists — is a first-class artifact with an owner, a review schedule, and a
test suite.

## Pillars

<FeatureGrid cols={3}>
  <FeatureCard icon="shieldcheck" color="rose" title="Policies as guardrails"
    description="Policies are enforced by the orchestrator at run time — never by convention." />
  <FeatureCard icon="cpu" color="cyan" title="LiteLLM control"
    description="All LLM traffic is governed: virtual keys, cost ledgers, budget envelopes." />
  <FeatureCard icon="bookopen" color="indigo" title="Standards library"
    description="ISO 27001, SOC2, GDPR, HIPAA, NIST 800-53 — pre-loaded and editable." />
  <FeatureCard icon="testtube" color="emerald" title="Policy testing playground"
    description="Run a policy against a sample artifact or PR before it ships." />
  <FeatureCard icon="history" color="amber" title="Audit trail"
    description="Every action, every override, every approval — append-only with daily hash anchors." />
  <FeatureCard icon="activity" color="violet" title="Compliance reports"
    description="One-click SOC2 / ISO evidence bundles. No more screenshot folders." />
</FeatureGrid>

## Policies as guardrails

Policies are written in Rego (OPA-compatible) and stored as F-003 artifacts:

```rego
package forge.policies.pii

deny[msg] {
  input.text contains "@"
  not input.redaction.enabled
  msg := "PII detected and redaction disabled"
}

deny[msg] {
  input.attachments[_].mime_type == "application/pdf"
  input.attachments[_].name matches "(?i)ssn|tax_id|passport"
  msg := sprintf("Sensitive document attached: %v", [input.attachments[_].name])
}
```

<Callout type="warning" title="Policy bypass requires approval">
  Policies can be overridden — but every override requires a documented business reason
  and a HITL approval. Overrides are surfaced in the audit ledger.
</Callout>

## Built-in policies

<CommandExample command="forge-policies-apply --policy F-003-pii-redaction --scope tenants/*" description="Apply PII redaction org-wide." />
<CommandExample command="forge-policies-apply --policy F-003-secret-scan --scope projects/*/pr" description="Block PRs that introduce secrets." />
<CommandExample command="forge-policies-apply --policy F-003-spend-cap --scope agents/* --max-usd 100/day" description="Cap per-agent daily spend." />
<CommandExample command="forge-policies-apply --policy F-003-deps-blocklist --blocklist lodash@<4.17.21" description="Block a known-vulnerable dependency." />
<CommandExample command="forge-policies-apply --policy F-003-rate-limit --rps 50 --burst 100" description="Rate-limit outbound calls." />
<CommandExample command="forge-policies-apply --policy F-003-region --allowed us-east-1,eu-west-1" description="Restrict LLM provider regions." />

## LiteLLM control

Every model call flows through the proxy. Governance gives you:

- **Virtual keys** — per agent, per user, per tenant.
- **Cost ledger** — every request attributed and tracked.
- **Budget envelopes** — soft warn at 80%, hard cap at 100%.
- **Provider failover** — automatic fallback when a provider degrades.
- **PII redaction** — strip before send, mask in logs.

<Callout type="info" title="See also">
  [ADR-005 — LiteLLM proxy](/architecture/adr-005-litellm/) for the architecture.
</Callout>

## Standards library

Pre-loaded frameworks, editable per tenant:

- **ISO 27001** — Information Security Management.
- **SOC2** — Trust Services Criteria (Security, Availability, Confidentiality).
- **GDPR** — EU data protection.
- **HIPAA** — US healthcare.
- **NIST 800-53** — US federal controls.
- **PCI-DSS** — Payment card industry.

Each standard is broken into controls. Each control is mapped to one or more
policies. Each policy has a test suite. The compliance dashboard shows coverage
across all standards.

## Policy testing playground

Before a policy ships, test it against sample artifacts:

<Steps>
  <li>
    <h3>Pick a policy</h3>
    <p>Select an existing F-003 policy or paste a new Rego rule.</p>
  </li>
  <li>
    <h3>Add sample inputs</h3>
    <p>Drag in a sample PR diff, a Jira ticket, a co-pilot prompt — whatever the policy will see in production.</p>
  </li>
  <li>
    <h3>Run the test</h3>
    <p>See allow / deny decisions with full reasoning. Edge cases are highlighted.</p>
  </li>
  <li>
    <h3>Promote to production</h3>
    <p>Once tests pass, click <strong>Apply</strong> to roll out org-wide.</p>
  </li>
</Steps>

## Audit trail

Every governance action — policy applied, override granted, compliance report
generated — lands in the append-only audit ledger with daily hash-chain anchors.
See [Audit](/lifecycle/audit/) for the full timeline.

## Where to next

- [Concepts → Append-only Audit](/concepts/auditability/) — how the ledger works.
- [Lifecycle → Audit](/lifecycle/audit/) — browse the timeline.
- [Guides → Setting up Guardrails](/guides/guardrails/) — a 15-minute walkthrough.
