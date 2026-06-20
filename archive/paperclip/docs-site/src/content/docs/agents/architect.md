---
title: Architect
description: The Architect agent — the second stage. Produces ADRs, plans, and (when required) threat models.
draft: false
last_generated_at: 2026-06-18T00:00:00Z
source_sha: forareal-final
source_path: workspace/memory/architecture.md
generator: readme
approval_required: false
---

The **Architect agent** is the second stage of the staged workflow. It wakes when a PRD is approved and produces an **ADR** + a **plan** (in Jira) and, when required, a **threat model**.

## What it reads

- The PRD from the BA stage.
- The customer's conventions + glossary.
- The project's tech stack.
- The Knowledge Layer's `memory/architecture.md` — the design bar.
- All existing ADRs in `docs/adr/`.

## What it produces

| Artefact | Format | Storage |
| --- | --- | --- |
| **ADR** | Markdown | `docs/adr/<NNNN>-<slug>.md` |
| **Plan** | Atlassian Document Format | Jira (linked to the Epic) |
| **Threat model** *(if required)* | Markdown | `docs/threat-models/<service>.md` |
| **OpenAPI 3.1** *(if API changes)* | YAML | `docs/api/openapi.yaml` |

The ADR follows the template in [`memory/architecture.md` §5](https://github.com/fora-platform/fora/blob/main/workspace/memory/architecture.md):

```markdown
# NNNN — <Title>

- **Status:** proposed | accepted | superseded | deprecated
- **Date:** YYYY-MM-DD
- **Deciders:** <names or agent-ids>

## Context
<the situation, the forces in play, the constraint>

## Decision
<the choice we are making, in one sentence>

## Consequences
<what becomes easier, what becomes harder, what we accept>

## Alternatives considered
<the other options we rejected and why>
```

## The one-way door

A change that touches:

- The data model
- The auth or tenancy model
- The audit log schema
- The agent handoff contract
- The staged workflow (add/remove/reorder a stage)

…is a **one-way door**. The architect agent opens an ADR; the CTO signs it; the doc is immutable once accepted.

A change that doesn't touch any of the above is a **two-way door** — ships fast, no ADR required.

## When the threat model is required

The architect agent produces a threat model when the change:

- Touches the public API surface.
- Touches the auth or session model.
- Touches the data model (new tables, new columns, new PII markers).
- Touches a customer-facing surface (Forge, audit-log viewer, agent observability).

The threat model is one paragraph + a STRIDE table per the [Security → Threat model →](/security/threat-model/) format.

## Where to next

- **[BA →](/agents/ba/)** — the previous stage.
- **[Developer →](/agents/developer/)** — the next stage.
- **[Architecture → Staged workflow →](/architecture/staged-workflow/)** — the full pipeline.

<div class="freshness-footer">
  <dl>
    <dt>Source SHA</dt><dd><code>forareal-final</code></dd>
    <dt>Source path</dt><dd><code>workspace/memory/architecture.md</code></dd>
    <dt>Last generated</dt><dd>2026-06-18T00:00:00Z</dd>
    <dt>Generator</dt><dd><code>readme</code> · DocAgent v1.0 ([Forge AI-298](/Forge AI/issues/Forge AI-298))</dd>
  </dl>
</div>
