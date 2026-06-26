---
draft: false
title: Agents
description: The Agent Center — register, configure, and monitor every agent that runs in your tenant.
---

import { Icon } from '../../../components/Icon.astro';
import Callout from '../../../components/Callout.astro';
import FeatureCard from '../../../components/FeatureCard.astro';
import FeatureGrid from '../../../components/FeatureGrid.astro';

The **Agent Center** is the registry of every agent that runs in your tenant. Every
agent has a name, a model provider (via the LiteLLM proxy), a tool allowlist, a
spend cap, and an audit trail.

<Callout type="info" title="Per Rule 1 — Provider agnostic">
  No agent is bound to a specific model provider. All LLM traffic flows through the
  Forge Provider Abstraction Layer (LiteLLM proxy). See [ADR-005](/architecture/adr-005-litellm/).
</Callout>

## Agent types

<FeatureGrid cols={3}>
  <FeatureCard icon="hammer" color="indigo" title="Build agents"
    description="Write code, open PRs, run tests. Subject to Execute and Security HITL gates." />
  <FeatureCard icon="filetext" color="cyan" title="Plan agents"
    description="Draft ADRs, contracts, risk registers. Subject to Architecture HITL gate." />
  <FeatureCard icon="shieldcheck" color="rose" title="Audit agents"
    description="Read-only reviewers. Surface risks, suggest changes. No write access." />
  <FeatureCard icon="lightbulb" color="amber" title="Ideation agents"
    description="Brainstorm, scope, frame. Used in early-stage projects." />
  <FeatureCard icon="bookmarked" color="violet" title="Knowledge agents"
    description="Query and update the project knowledge graph. Tenant-scoped." />
  <FeatureCard icon="users" color="emerald" title="Co-pilot"
    description="The always-on assistant. Mode-aware (Ask / Plan / Build / Review)." />
</FeatureGrid>

## Agent record

Each agent is a typed record:

```yaml
id: agents/copilot
name: Co-pilot
type: copilot
provider: litellm
model: claude-sonnet-4-6
tools:
  - forge-architecture-plan
  - forge-development-scaffold
  - forge-knowledge-search
spend_cap_usd_per_day: 5
audit:
  log_prompts: true
  log_responses: true
  retain_days: 365
```

## Where to next

- [Concepts → Agent Operating System](/concepts/agent-operating-system/) — what agents are.
- [Lifecycle → Runs](/lifecycle/runs/) — how agents execute.
- [Guides → Custom agents](/guides/custom-agents/) — building your own.
