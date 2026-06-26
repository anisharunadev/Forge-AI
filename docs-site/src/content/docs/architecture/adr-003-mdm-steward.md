---
draft: false
title: ADR-003 — Hybrid MDM with Steward priority
description: When two sources of truth disagree, the Steward decides.
---

## Status

Accepted — 2026-06-20

## What is this?

The binding decision that the conflict-resolution model for the project intelligence knowledge graph is **hybrid MDM with Steward priority**. The system surfaces conflicts; a human (the Steward) resolves them.

## Context

The project intelligence graph fuses many sources: code, Jira, Confluence, Figma, Slack, SonarQube, and human-edited documents. These sources disagree — sometimes routinely. The question is: when they disagree, who wins?

The forces at play:

- The platform needs an automated ingestion pipeline. A human-in-the-loop for every conflict doesn't scale.
- The platform also needs human authority over the truth. Pure "last writer wins" produces silent corruption.
- Some sources are authoritative for some classes of facts (e.g., Confluence is authoritative for "approved contract"; the codebase is authoritative for "what's actually deployed").
- A Steward role exists in the identity model; giving the Steward the conflict queue is natural.

## Decision drivers

- NFR-006, NFR-007: Multi-tenancy and data quality
- DL-004, DL-005: Layer isolation
- F-005: Audit ledger
- Pilot customer requirement for traceable decisions

## Considered options

- Hybrid MDM with Steward priority — **chosen**
- Pure automated (last-writer-wins or source-priority rules)
- Pure human (Steward reviews every conflict)
- Master-data hub with two-phase commit

## Decision outcome

Chosen option: **Hybrid MDM with Steward priority**.

The flow:

```text
Ingestion event
    |
    | system tries to merge into graph
    v
+-------------------+
| Merge attempt     |
+-------------------+
    |
    |--- no conflict --> node updated, audit row written
    |
    |--- conflict ----> node marked `conflicted`, audit row written,
                        surfaced in Steward queue
                        |
                        | Steward reviews
                        |
                        v
                    accept side A  --> resolve as A, audit row
                    accept side B  --> resolve as B, audit row
                    split           --> create separate nodes, audit row
                    defer           --> stays conflicted, re-queue
```

The conflict is **typed**: it carries both sides, the source of each, the timestamp, and the rule that triggered the conflict.

## Conflict types

| Type | Example | Default resolution |
|---|---|---|
| `value_mismatch` | Code says port 8080, Confluence says 9090 | Steward |
| `missing_in_source` | Code defines a service, but Confluence has no page for it | Steward |
| `extra_in_source` | Confluence has a page, but code has no service | Steward |
| `ownership_mismatch` | Two owners claim the same service | Steward |
| `stale_source` | Source data is older than the freshness threshold | Auto-refresh |

Most conflicts are `value_mismatch`, `missing_in_source`, or `extra_in_source`. All require Steward review.

## Steward queue

The Steward queue is a UI surface in the Knowledge Center. It shows:

- Conflicted nodes, sorted by severity and age.
- Both sides of each conflict with source citations.
- Suggested resolutions (if any) from the policy engine.
- Accept / reject / split actions.

The Steward's decision is audited. The audit row carries the Steward's identity, the decision, the rationale, and the chain hash.

## Source authority

Some sources are pre-authoritative for some classes. These are configured in the policy file, not hardcoded:

```yaml
source_authority:
  service.contracts: confluence        # Confluence wins for service contracts
  service.runtime:   code               # Code wins for runtime config
  service.ownership: jira               # Jira wins for ownership
```

When a conflict falls under an authority rule, the rule's source is pre-selected; the Steward can override with rationale.

## Consequences

**Positive:**

- Automated ingestion scales.
- Steward authority prevents silent corruption.
- Conflict types are typed and audit-logged.
- Source authority rules reduce the Steward queue's average size.

**Negative:**

- A backlog of conflicted nodes can grow if the Steward is unavailable.
- Source authority rules add policy complexity.

**Neutral:**

- The Steward role was already in the identity model; no new role is needed.

## Alternatives considered

### Pure automated

Pros: Scales, no human bottleneck.

Cons: Silent corruption when rules are wrong; no accountability; conflicts hidden from the audit trail.

### Pure human

Pros: Maximum authority.

Cons: Doesn't scale; bottleneck; the Steward becomes a single point of failure.

### Master-data hub

Pros: Standard MDM pattern.

Cons: Two-phase commit is hard with vector + graph; the data shapes are too varied.

## Related

- [ADR-002: PostgreSQL + AGE + pgvector](/architecture/adr-002-postgres-age/)
- [Knowledge graph](/concepts/knowledge-graph/)
- [Layer isolation](/architecture/layer-isolation/)
