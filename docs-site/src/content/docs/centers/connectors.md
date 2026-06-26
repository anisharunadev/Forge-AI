---
draft: false
title: Connectors
description: First-party connectors that wire Forge AI into the rest of your stack — with a credentials vault, webhooks, and LiteLLM integration.
---

import { Icon } from '../../../components/Icon.astro';
import FeatureCard from '../../../components/FeatureCard.astro';
import FeatureGrid from '../../../components/FeatureGrid.astro';
import Callout from '../../../components/Callout.astro';
import CommandExample from '../../../components/CommandExample.astro';
import PropertyRow from '../../../components/PropertyRow.astro';

The **Connector Center** is the registry of every external service Forge AI talks to.
Connectors are scoped per tenant, credentials live in a vault, and every call is
audited. Per [Rule 8](/concepts/constitutional-rules/), no service can hard-code a
specific vendor — anything outside the platform must be reachable through a connector.

## First-party connectors

<FeatureGrid cols={3}>
  <FeatureCard icon="gitbranch" color="indigo" title="GitHub" description="Repos, PRs, issues, webhooks, Actions." />
  <FeatureCard icon="filetext" color="cyan" title="Jira" description="Tickets, epics, sprints, custom fields." />
  <FeatureCard icon="bookopen" color="violet" title="Confluence" description="Spaces, pages, comments, search." />
  <FeatureCard icon="users" color="amber" title="Slack" description="Channels, threads, DMs, slash commands." />
  <FeatureCard icon="plug" color="emerald" title="Figma" description="Files, frames, comments, exports." />
  <FeatureCard icon="database" color="rose" title="AWS" description="S3, KMS, ECS, RDS, IAM." />
  <FeatureCard icon="shieldcheck" color="indigo" title="SonarQube" description="Quality gates, security hotspots, coverage." />
  <FeatureCard icon="zap" color="cyan" title="Zendesk" description="Tickets, macros, triggers." />
  <FeatureCard icon="workflow" color="violet" title="ClickUp" description="Tasks, lists, spaces, goals." />
  <FeatureCard icon="gitbranch" color="amber" title="Azure DevOps" description="Repos, pipelines, boards." />
  <FeatureCard icon="database" color="emerald" title="Databricks" description="Jobs, notebooks, SQL warehouses." />
  <FeatureCard icon="plug" color="rose" title="PagerDuty" description="Incidents, on-call, escalation." />
  <FeatureCard icon="zap" color="cyan" title="Webhooks" description="Generic inbound + outbound." />
</FeatureGrid>

<Callout type="tip" title="13 first-party connectors and counting">
  New connectors are added on a quarterly cadence. See the [roadmap](https://github.com/forge-ai/forge-ai/discussions/categories/roadmap).
</Callout>

## Marketplace

Bring-your-own connector with the SDK:

```typescript
import { defineConnector } from '@forge-ai/connectors';

export default defineConnector({
  name: 'my-saas',
  version: '1.0.0',
  auth: { type: 'oauth2', scopes: ['read', 'write'] },
  actions: {
    createIssue: { /* ... */ },
    listIssues:  { /* ... */ },
  },
  events: {
    'issue.created': { /* webhook payload schema */ },
  },
});
```

Publish to your tenant's marketplace with `forge-connectors publish ./my-saas`.

## Credentials vault

Per-tenant credentials are stored encrypted with per-tenant KMS keys:

<PropertyRow key="vault.path" value="Encrypted at rest in S3 with KMS CMK" type="object" />
<PropertyRow key="vault.kms_key_rotation" value="90 days" type="duration" />
<PropertyRow key="vault.access_logging" value="All reads logged to audit ledger" type="object" />
<PropertyRow key="vault.sharing" value="Never cross-tenant; never exported" type="policy" />

<CommandExample command="forge-connectors-credentials-set github --token $GH_TOKEN" description="Set a per-tenant credential." />
<CommandExample command="forge-connectors-credentials-rotate aws --key-id $KEY_ID" description="Rotate a credential with zero downtime." />
<CommandExample command="forge-connectors-credentials-audit github --since 7d" description="Audit who accessed a credential in the last week." />

## Webhooks

Inbound webhooks are typed, versioned, and replayable:

- **GitHub** — `push`, `pull_request`, `issues`, `check_run`.
- **Jira** — `jira:issue_created`, `jira:issue_updated`.
- **Slack** — `slash_command`, `event_subscription`.

Every inbound webhook:

1. Validates signature.
2. Logs the payload to the audit ledger.
3. Maps to a typed event in the knowledge graph.
4. Triggers any workflows subscribed to that event.

## Cross-app usage

Connectors are invoked from:

- **Workflows** — drop a Connector node onto the canvas.
- **Co-pilot** — `@jira/JIRA-1284` to attach context, or `/forge forge-connectors-github-issue-create`.
- **Ideation** — pull tickets from Jira into a planning session.
- **Architecture** — fetch ADRs from Confluence, validate against Standards.

## LiteLLM integration

Every LLM call flows through the LiteLLM proxy, which is itself a connector:

- **Virtual keys** — per-tenant, per-agent, per-user.
- **Cost ledger** — every request is attributed and logged.
- **Budget guardrails** — soft and hard caps per tenant.
- **Provider failover** — Anthropic → OpenAI → Bedrock, in that order.

See [ADR-005 — LiteLLM proxy](/architecture/adr-005-litellm/) for the design rationale.

## Where to next

- [Guides → Adding connectors](/guides/adding-connectors/) — build and publish your own.
- [Concepts → Configurable Everything](/concepts/constitutional-rules/) — Rule 8.
- [Lifecycle → Governance](/lifecycle/governance/) — connector compliance audits.
