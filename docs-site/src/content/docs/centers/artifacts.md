---
draft: false
title: Artifacts
description: Organization-level knowledge — standards, templates, policies, runbooks, and best practices that every project inherits.
---

import { Icon } from '../../../components/Icon.astro';
import FeatureCard from '../../../components/FeatureCard.astro';
import FeatureGrid from '../../../components/FeatureGrid.astro';
import Callout from '../../../components/Callout.astro';
import Diagram from '../../../components/Diagram.astro';

The **Artifacts** center holds organization-level knowledge: the standards every project
must follow, the templates every ADR must use, the policies every PR must pass. Unlike
[Project Intelligence](/centers/projects/) (which is isolated per project), Artifacts are
**shared across the organization**.

<Callout type="info" title="Shared, not isolated">
  Per [Rule 5](/concepts/multi-tenancy/) — Organization Knowledge is shared; Project
  Intelligence is isolated. Artifacts is the shared layer. Projects read from it but
  never write into it without an org-level approval gate.
</Callout>

## Five artifact kinds

<FeatureGrid cols={3}>
  <FeatureCard icon="bookopen" color="indigo" title="Standards (F-001)"
    description="Normative rules. Examples: 'all services must publish OpenAPI specs', 'all ADRs use MADR format'." />
  <FeatureCard icon="filetext" color="cyan" title="Templates (F-002)"
    description="Reusable scaffolds for typed artifacts. Drop into a new project to enforce shape." />
  <FeatureCard icon="shieldcheck" color="rose" title="Policies (F-003)"
    description="Enforced guardrails. Examples: PII redaction, spend caps, prohibited dependencies." />
  <FeatureCard icon="workflow" color="amber" title="Runbooks (F-004)"
    description="Step-by-step response procedures. Bound to alerts and incidents." />
  <FeatureCard icon="lightbulb" color="violet" title="Best Practices (F-005)"
    description="Soft guidance. Surfaced as suggestions during reviews and planning." />
</FeatureGrid>

## How it integrates

<Diagram type="ascii" title="Artifacts flow from org-level into project-level">
{`+----------------------------------------------------+
|           Organization Knowledge (shared)          |
|                                                    |
|  Standards  |  Templates  |  Policies  |  Runbooks |
+----------------------------------------------------+
                       | inherits (read-only)
                       v
+----------------------------------------------------+
|            Project Intelligence (isolated)         |
|                                                    |
|  ADRs  |  Contracts  |  Risk Register  |  Plans    |
+----------------------------------------------------+
                       |
                       v
                 (project runs)`}
</Diagram>

## Obsidian-style backlinks

Every artifact has automatic backlinks — see where it's referenced across:

- **Projects** — which projects adopt this template?
- **ADRs** — which decisions cite this standard?
- **Runbooks** — which incidents were resolved with this runbook?
- **Co-pilot** — which sessions promoted a rule into this artifact?

## Compliance + adoption metrics

For each artifact, the Artifacts center shows:

- **Adoption rate** — % of projects using it.
- **Compliance rate** — % of in-scope artifacts meeting it.
- **Drift events** — projects that diverged and when.
- **Last review** — when the artifact was last updated.

<Callout type="warning" title="Stale artifacts surface in Audit">
  Artifacts older than the org's review window appear in the [Audit](/lifecycle/audit/) timeline with a `STALE_ARTIFACT` code.
</Callout>

## AI suggestions

The Co-pilot watches for patterns across projects and proposes new artifacts:

- "8 projects have independently added a 'PII redaction' policy. Promote to org-level?"
- "12 PRs referenced a new dependency pattern. Codify as Standard F-027?"
- "This runbook was used 47 times last quarter. Mark as F-005 best practice?"

Each suggestion links to the evidence. Approve, reject, or defer.

## Where to next

- [Concepts → Typed Artifacts](/concepts/typed-artifacts/) — the six types Forge produces.
- [Concepts → Multi-tenancy](/concepts/multi-tenancy/) — why org knowledge is shared.
- [Lifecycle → Governance](/lifecycle/governance/) — policy testing and audit.
