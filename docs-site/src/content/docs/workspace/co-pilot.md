---
draft: false
title: Co-pilot
description: The Forge AI assistant — slash commands, context injection, multi-modal capture, and a floating panel that follows you everywhere.
---

import { Icon } from '../../../components/Icon.astro';
import FeatureCard from '../../../components/FeatureCard.astro';
import FeatureGrid from '../../../components/FeatureGrid.astro';
import Callout from '../../../components/Callout.astro';
import CommandExample from '../../../components/CommandExample.astro';
import ImagePlaceholder from '../../../components/ImagePlaceholder.astro';
import Steps from '../../../components/Steps.astro';

The Forge AI **Co-pilot** is a context-aware assistant available from every screen. It
opens as a side panel or a floating FAB, retains conversation across navigations, and
inherits the current page's project, tenant, and selected entity as implicit context.

<ImagePlaceholder caption="The Co-pilot panel docked on the right with project context automatically attached." alt="Co-pilot panel screenshot placeholder">
  <Icon name="sparkles" size={48} color="#71717A" />
</ImagePlaceholder>

## What it can do

<FeatureGrid cols={3}>
  <FeatureCard icon="filetext" color="cyan" title="Multi-modal capture"
    description="Paste text, drop a screenshot, attach a file, or pull in a Jira ticket — the panel handles all four." />
  <FeatureCard icon="gitbranch" color="indigo" title="Context injection"
    description="The current page, selected entity, and tenant scope are attached as implicit context." />
  <FeatureCard icon="terminal" color="amber" title="Slash commands"
    description="Run forge-* commands inline. The co-pilot asks for missing args and shows live output." />
  <FeatureCard icon="bookmarked" color="violet" title="Project memory"
    description="Capture lessons learned; promote durable rules into the organization knowledge graph." />
  <FeatureCard icon="shieldcheck" color="rose" title="Approval preview"
    description="When a HITL gate is required, the co-pilot previews the gate before submission." />
  <FeatureCard icon="zap" color="emerald" title="Background tasks"
    description="Long-running jobs stream progress into the panel without blocking the UI." />
</FeatureGrid>

## Modes

The co-pilot runs in four modes — switchable from the panel header:

| Mode | Use it for | Model budget |
|------|------------|--------------|
| **Ask** | Read-only Q&A against project knowledge graph | Low |
| **Plan** | Multi-step reasoning, draft artifacts | Medium |
| **Build** | Generate code, modify files, run forge-* commands | High |
| **Review** | Audit a diff, propose changes, surface risks | Medium |

<Callout type="info" title="Mode persistence">
  Mode and model selection are remembered per user and per project. Override at any time
  with `/mode build` or by clicking the mode chip.
</Callout>

## Slash commands

<CommandExample command="/ask What does this service do?" description="Read-only question. Cheapest model, no tools invoked." />
<CommandExample command="/plan Migrate the orders service to event-sourcing" description="Multi-step planning. Drafts an ADR with options and trade-offs." />
<CommandExample command="/build Add a webhook for invoice.paid" description="Generates code, runs forge-development-* commands, opens a PR." />
<CommandExample command="/review @pr/4821" description="Audits the diff, surfaces risks, suggests tests." />
<CommandExample command="/forge forge-security-scan --path ./src" description="Runs any forge-* command inline." />
<CommandExample command="/memorize Always set X-Request-Id on outbound HTTP calls" description="Promote a durable rule into org knowledge." />

## @ mentions

Anchor context explicitly with @ mentions:

- `@repo/orders-service` — pulls a repo's README, recent commits, and top contributors.
- `@ticket/JIRA-1284` — attaches the Jira ticket (title, description, comments, linked PRs).
- `@adr/adr-007-langgraph` — attaches an existing ADR.
- `@artifact/risk-register-q3` — attaches a typed artifact.
- `@run/2026-06-26T14:32:11Z` — attaches a previous run for replay analysis.

<Callout type="tip" title="Combine mentions">
  Mentions compose. `@repo/orders @ticket/JIRA-1284 /plan` asks the planner to draft an
  ADR scoped to that repo and ticket.
</Callout>

## Configuration

The co-pilot is configured per-tenant in `forge.config.yaml`:

```yaml
copilot:
  default_mode: ask
  allowed_models: [claude-sonnet-4-6, gpt-4o, gemini-2-5-pro]
  spend_cap_per_user_per_day: 5.00  # USD
  pii_redaction: strict
  audit:
    log_prompts: true
    log_responses: true
    retain_days: 365
```

## Building your first co-pilot session

<Steps>
  <li>
    <h3>Open the panel</h3>
    <p>Click the floating FAB or press <code>Cmd/Ctrl + K</code> from anywhere in the app.</p>
  </li>
  <li>
    <h3>Pick a mode</h3>
    <p>Default is <strong>Ask</strong> — switch to <strong>Plan</strong> or <strong>Build</strong> as the task grows.</p>
  </li>
  <li>
    <h3>Anchor your context</h3>
    <p>Use <code>@</code> to attach a repo, ticket, ADR, or artifact. The current page is implicit.</p>
  </li>
  <li>
    <h3>Iterate or promote</h3>
    <p>If the co-pilot produces something durable, click <strong>Promote</strong> to save it as an artifact, rule, or ticket comment.</p>
  </li>
</Steps>

## Cross-module integration

The co-pilot is reachable from every module:

- **Dashboard** — pinned to the right rail.
- **Centers** — opens when you select an entity (story, ADR, run).
- **Terminal** — runs forge-* commands inline.
- **Audit timeline** — explains an audit event in plain language.
- **Settings** — runs admin workflows with full approval preview.

## Where to next

- [Concepts → Typed Artifacts](/concepts/typed-artifacts/) — what the co-pilot can produce.
- [Lifecycle → Command Center](/lifecycle/command-center/) — promote co-pilot plans into GSD phases.
- [Guides → Setting up Guardrails](/guides/guardrails/) — PII redaction and spend caps.
