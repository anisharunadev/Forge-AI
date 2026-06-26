---
draft: false
title: Setting up Guardrails
description: PII detection, secret scanning, rate limits, spend caps, and policy testing — a 15-minute walkthrough.
---

import { Icon } from '../../../components/Icon.astro';
import Callout from '../../../components/Callout.astro';
import CommandExample from '../../../components/CommandExample.astro';
import Steps from '../../../components/Steps.astro';
import PropertyRow from '../../../components/PropertyRow.astro';

Guardrails are the policies that keep Forge AI safe and within budget. This guide
shows the five most common ones — and how to test them before they ship.

## The five guards

<PropertyRow key="PII detection" value="Detect emails, SSNs, credit cards, phone numbers in prompts + outputs" type="policy" />
<PropertyRow key="Secret scanning" value="Block PRs that introduce AWS keys, GitHub tokens, database URLs" type="policy" />
<PropertyRow key="Rate limits" value="Cap requests per tenant per second; protect upstream providers" type="policy" />
<PropertyRow key="Spend caps" value="Daily USD envelope per tenant; soft warn at 80%, hard at 100%" type="policy" />
<PropertyRow key="Dependency blocklist" value="Block known-vulnerable or unlicensed packages" type="policy" />

## Setting them up

<Steps>
  <li>
    <h3>Open the Governance playground</h3>
    <p>Navigate to <strong>Lifecycle → Governance & Compliance → Playground</strong>.</p>
  </li>
  <li>
    <h3>Pick a built-in policy</h3>
    <p>The Playground ships with 14 pre-built policies. Pick one to edit.</p>
  </li>
  <li>
    <h3>Test against sample inputs</h3>
    <p>Drag in a sample PR diff, co-pilot prompt, or Jira ticket. The policy evaluates in real time.</p>
  </li>
  <li>
    <h3>Tune the rule</h3>
    <p>Edit Rego in the inline editor. Hit <strong>Re-test</strong> to see updated decisions.</p>
  </li>
  <li>
    <h3>Promote to production</h3>
    <p>When satisfied, click <strong>Apply</strong>. Pick the scope (tenant, project, agent) and confirm.</p>
  </li>
</Steps>

<Callout type="warning" title="Policy bypass requires approval">
  Every policy can be overridden — but every override is recorded in the audit
  ledger with the bypass reason and the approver.
</Callout>

## PII detection — sample rule

```rego
package forge.policies.pii

deny[msg] {
  some i
  regex.find(`\b\d{3}-\d{2}-\d{4}\b`, input.text, i)
  msg := "PII: SSN detected"
}

deny[msg] {
  some i
  regex.find(`\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b`, input.text, i)
  msg := "PII: IBAN detected"
}

deny[msg] {
  some i
  regex.find(`\b(?:\d[ -]*?){13,16}\b`, input.text, i)
  msg := "PII: credit-card number detected"
}
```

## Secret scanning — sample rule

```rego
package forge.policies.secret_scan

deny[msg] {
  some i
  regex.find(`AKIA[0-9A-Z]{16}`, input.diff, i)
  msg := sprintf("AWS access key ID leaked at line %v", [i])
}

deny[msg] {
  some i
  regex.find(`ghp_[A-Za-z0-9]{36}`, input.diff, i)
  msg := sprintf("GitHub PAT leaked at line %v", [i])
}
```

## Spend caps

```yaml
# forge.config.yaml
policies:
  spend_caps:
    - scope: tenants/*
      max_usd_per_day: 500
      action_at_80pct: warn
      action_at_100pct: block
    - scope: agents/copilot
      max_usd_per_day: 5
      action_at_80pct: warn
      action_at_100pct: block
```

<CommandExample command="forge-policies-spend-cap --tenant acme --max-usd 1000/day" description="Set a per-tenant spend cap." />
<CommandExample command="forge-policies-spend-cap --agent copilot --max-usd 5/day" description="Set a per-agent spend cap." />

## Rate limits

<CommandExample command="forge-policies-rate-limit --tenant acme --rps 50 --burst 100" description="Per-tenant rate limit." />
<CommandExample command="forge-policies-rate-limit --provider litellm --rps 200" description="Per-provider rate limit." />

## Testing your policies

Before applying a policy to production:

1. Drag a sample input into the Playground.
2. Run the policy.
3. Verify it allows expected cases and denies dangerous ones.
4. Promote when confident.

<Callout type="tip" title="Continuous policy testing">
  Forge AI runs policy test suites on every commit to the policy repo. Failed tests
  block the policy from being promoted.
</Callout>

## Where to next

- [Lifecycle → Governance](/lifecycle/governance/) — full policy reference.
- [Concepts → Append-only Audit](/concepts/auditability/) — every policy decision is logged.
- [Concepts → Multi-tenancy](/concepts/multi-tenancy/) — policy scoping per tenant.
