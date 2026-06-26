---
draft: false
title: Multi-tenant Setup
description: Stand up a multi-tenant Forge AI deployment — isolation, KMS, RLS, audit topology.
---

import { Icon } from '../../../components/Icon.astro';
import Callout from '../../../components/Callout.astro';
import CommandExample from '../../../components/CommandExample.astro';
import Steps from '../../../components/Steps.astro';

This guide walks through provisioning a multi-tenant Forge AI deployment. Each
tenant is isolated by row-level security on every table, by per-tenant KMS keys,
and by an isolated audit log topology.

## What "multi-tenant" means in Forge AI

<Callout type="info" title="Per Rule 2">
  Every query, artifact, workflow, knowledge graph node, and audit record must
  contain tenant_id and project_id. Never optional. See
  [Multi-tenancy](/concepts/multi-tenancy/).
</Callout>

## Provisioning a tenant

<Steps>
  <li>
    <h3>Create the tenant record</h3>
    <p><code>forge-tenants-create --name acme --region us-east-1</code></p>
    <p>Issues a per-tenant KMS CMK and writes the row-level policy bindings.</p>
  </li>
  <li>
    <h3>Verify RLS is enforced</h3>
    <p><code>forge-tenants-verify-rls --tenant acme</code></p>
    <p>Runs a smoke test confirming cross-tenant queries return empty sets.</p>
  </li>
  <li>
    <h3>Wire connectors</h3>
    <p>From the [Connector Center](/centers/connectors/), set per-tenant credentials for GitHub, Jira, Slack, etc.</p>
  </li>
  <li>
    <h3>Ingest the first project</h3>
    <p><code>forge-project-intelligence-ingest --tenant acme --repo acme/platform-mono</code></p>
  </li>
  <li>
    <h3>Apply baseline policies</h3>
    <p>From the [Governance playground](/lifecycle/governance/), apply the 14 built-in F-003 policies scoped to the tenant.</p>
  </li>
</Steps>

## Verifying isolation

Run the isolation smoke test weekly:

<CommandExample command="forge-tenants-isolation-test --all" description="Cross-tenant smoke test. Fails the build if any isolation check regresses." />
<CommandExample command="forge-tenants-verify-rls --tenant acme" description="Verify RLS policies on every table for one tenant." />
<CommandExample command="forge-tenants-audit-topology --tenant acme" description="Confirm audit logs land in the tenant-scoped bucket." />

## Per-tenant KMS

Every tenant has its own KMS CMK. Used for:

- Encrypting the tenant's connector credentials.
- Signing audit ledger entries.
- Encrypting tenant-scoped S3 objects (artifacts, attachments).

Keys rotate every 90 days. Rotation is non-disruptive.

## Where to next

- [Concepts → Multi-tenancy](/concepts/multi-tenancy/) — the isolation model.
- [Guides → Self-hosting](/guides/self-hosting/) — run Forge AI in your own cloud.
- [Lifecycle → Audit](/lifecycle/audit/) — per-tenant audit topology.
