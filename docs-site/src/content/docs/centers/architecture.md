---
draft: false
title: Architecture
description: ADRs, API contracts, and the approval model that gates every architectural decision.
---

import { Icon } from '../../../components/Icon.astro';
import Callout from '../../../components/Callout.astro';
import FeatureCard from '../../../components/FeatureCard.astro';
import FeatureGrid from '../../../components/FeatureGrid.astro';

The **Architecture** center is where every architectural decision lives. ADRs are
written in MADR format; API contracts are written in OpenAPI; both are versioned,
linked, and gated by the [Approval Model](/architecture/approval-model/).

<Callout type="warning" title="Architecture HITL gate">
  Per [Rule 3](/concepts/constitutional-rules/), the Architecture boundary is one of
  three mandatory HITL gates. The orchestrator pauses any GSD run that crosses it
  until a designated approver signs off.
</Callout>

## Architecture artifacts

<FeatureGrid cols={3}>
  <FeatureCard icon="filetext" color="indigo" title="ADRs"
    description="Architecture Decision Records in MADR format. Numbered, dated, signed." />
  <FeatureCard icon="network" color="cyan" title="API contracts"
    description="OpenAPI 3.1 specs with versioned schemas and example payloads." />
  <FeatureCard icon="cog" color="violet" title="Component diagrams"
    description="React Flow renderings of services, queues, and data stores." />
  <FeatureCard icon="database" color="amber" title="Data flow"
    description="How data moves through the system, including PII touchpoints." />
  <FeatureCard icon="shieldcheck" color="rose" title="Threat models"
    description="STRIDE-based assessments per service." />
  <FeatureCard icon="bookmarked" color="emerald" title="Standards library"
    description="F-001 standards the architecture must comply with." />
</FeatureGrid>

## Reading the existing ADRs

The eight constitutional ADRs live in this section:

| ADR | Decision | Status |
|-----|----------|--------|
| [ADR-001](/architecture/adr-001-aws/) | AWS as primary cloud | LOCKED |
| [ADR-002](/architecture/adr-002-postgres-age/) | Postgres + Apache AGE for the knowledge graph | LOCKED |
| [ADR-003](/architecture/adr-003-mdm-steward/) | Hybrid MDM with Steward-priority conflict resolution | LOCKED |
| [ADR-004](/architecture/adr-004-white-label/) | White-label command surface | LOCKED |
| [ADR-005](/architecture/adr-005-litellm/) | LiteLLM as the provider-agnostic proxy | LOCKED |
| [ADR-006](/architecture/adr-006-terminal-pty/) | Browser-native PTY for terminal access | LOCKED |
| [ADR-007](/architecture/adr-007-langgraph/) | LangGraph as the agent orchestration layer | LOCKED |
| [ADR-008](/architecture/adr-008-worm-audit/) | WORM (write-once-read-many) audit ledger | LOCKED |

## Where to next

- [Architecture overview](/architecture/overview/) — full topology.
- [Concepts → Approval Gates](/concepts/approval-gates/) — the HITL model.
- [Concepts → Constitutional Rules](/concepts/constitutional-rules/) — the 8 rules.
