---
draft: false
title: Settings
description: Tenant configuration — RBAC, KMS, connectors, policies, integrations, and billing.
---

import { Icon } from '../../../components/Icon.astro';
import Callout from '../../../components/Callout.astro';
import FeatureCard from '../../../components/FeatureCard.astro';
import FeatureGrid from '../../../components/FeatureGrid.astro';

The **Settings** center is the admin surface for a Forge AI tenant. Every
configuration knob — RBAC, KMS keys, connectors, policies, integrations, billing —
lives here.

<Callout type="warning" title="Admin only">
  Settings access requires the `tenant.admin` role. Every change is recorded in the
  audit ledger.
</Callout>

## Settings categories

<FeatureGrid cols={3}>
  <FeatureCard icon="users" color="indigo" title="Members & RBAC"
    description="Invitations, roles, project-level overrides." />
  <FeatureCard icon="shieldcheck" color="cyan" title="Security"
    description="KMS keys, SSO (SAML / OIDC via Keycloak), session policies." />
  <FeatureCard icon="plug" color="violet" title="Connectors"
    description="Add / remove / rotate credentials for every external service." />
  <FeatureCard icon="cpu" color="amber" title="Model providers"
    description="LiteLLM configuration, virtual keys, budget envelopes." />
  <FeatureCard icon="filetext" color="rose" title="Policies"
    description="F-003 policies, scope (tenant / project / agent), test results." />
  <FeatureCard icon="activity" color="emerald" title="Billing"
    description="Plan, usage, invoices, payment method." />
</FeatureGrid>

## Common admin tasks

- **Invite a member** — Settings → Members → Invite.
- **Rotate KMS keys** — Settings → Security → Rotate CMK.
- **Add a connector** — Settings → Connectors → New.
- **Apply a policy** — Settings → Policies → Apply (or use the [Governance playground](/lifecycle/governance/)).
- **Set a spend cap** — Settings → Model providers → Budgets.

## Where to next

- [Concepts → Multi-tenancy](/concepts/multi-tenancy/) — tenant isolation model.
- [Concepts → Configurable Everything](/concepts/constitutional-rules/) — Rule 8.
- [Concepts → Append-only Audit](/concepts/auditability/) — every change is recorded.
