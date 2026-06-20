---
name: adr-registry
version: 1.0
spec: Forge AI-117
owner: doc-agent
status: production
description: |
  The v1 knowledge-layer surface that mirrors `docs/adr/NNNN-*.md` as a
  queryable index. Storage contract for the Documentation Agent's ADR
  generator (Forge AI-121, sub-goal 7.1.5). Same shape as
  `agents/documentation/schemas.py:AdrRegistryEntry`.
---

# ADR Registry — Forge AI Project

This file is the **ADR registry** (storage contract for [Forge AI-117](/Forge AI/issues/Forge AI-117), sub-goal 7.1.6). The ADR generator refreshes one row per ADR on every run; the Memory Agent reads this file for `adr.list(...)` queries; the Audit Agent audits writes. The authoritative ADR text lives at `docs/adr/NNNN-*.md`; this file is a typed index, not a copy of the content.

The shape and conventions follow [memory/architecture.md §5](../memory/architecture.md#5-adrs-architecture-decision-records). The Doc Agent never edits an accepted ADR; if the decision changes, a new ADR supersedes it.

## Layout

Same as [docs.md](./docs.md): frontmatter + fenced JSON body. The JSON shape is the contract.

## Entry shape (`AdrRegistryEntry`)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `number` | int | yes | Zero-padded 4 digits, matches the file name |
| `title` | string | yes | Human-readable title |
| `path` | string | yes | `docs/adr/NNNN-slug.md` |
| `status` | enum | yes | `proposed` \| `accepted` \| `superseded` \| `deprecated` |
| `date` | ISO date | yes | The date the ADR was opened |
| `architecture_area` | string | yes | E.g., `iam`, `secrets`, `knowledge-layer` |
| `tags` | string[] | no | Free-form tags for search |
| `supersedes` | int | no | ADR number this one replaces |
| `superseded_by` | int | no | ADR number that replaced this one |
| `source_commit` | git SHA | no | Commit the ADR was committed at |
| `last_generated_at` | ISO 8601 UTC | no | Refreshed on every doc run that touches ADRs |

## Query surface

The Memory Agent calls into `agents/documentation/docs_query.py`:

```python
from agents.documentation.docs_query import DocsQuery

q = DocsQuery.load()
q.list_adrs(status="accepted")            # adr.list(status='accepted')  (acceptance criterion)
q.list_adrs(tag="iam")                    # by tag
q.list_adrs(area="iam")                   # by architecture area
q.list_adrs_in_range("2026-01-01", "2026-12-31")  # by date
```

All four query shapes are O(n) over the entries; sub-100ms on a 10k-entry surface.

## Status lifecycle

`proposed` → `accepted` (CTO signs) → `superseded` (a new ADR replaces it) or `deprecated` (no replacement; the decision is retired).

The CTO is the only agent that may flip `proposed` → `accepted`. The Doc Agent refreshes `last_generated_at` on every run that reads or writes an ADR.

## Current registry (live)

```json
{
  "version": "1.0",
  "generated_at": "2026-06-17T16:53:00Z",
  "adr_registry_sha": "v1-initial-seed",
  "entries": [
    {
      "number": 1,
      "title": "Audit System: one-way door decisions",
      "path": "docs/adr/0001-audit-system-one-way-doors.md",
      "status": "proposed",
      "date": "2026-06-17",
      "architecture_area": "audit",
      "tags": ["audit", "iam", "storage"],
      "supersedes": null,
      "superseded_by": null,
      "source_commit": "0000001",
      "last_generated_at": "2026-06-17T16:00:00Z"
    },
    {
      "number": 2,
      "title": "Knowledge layer storage contract for the Documentation Agent",
      "path": "docs/adr/0002-knowledge-layer-storage-contract.md",
      "status": "accepted",
      "date": "2026-06-17",
      "architecture_area": "knowledge-layer",
      "tags": ["knowledge-layer", "documentation", "storage-contract"],
      "supersedes": null,
      "superseded_by": null,
      "source_commit": "0000001",
      "last_generated_at": "2026-06-17T16:53:00Z"
    },
    {
      "number": 4,
      "title": "Test generator handoff (Forge AI-160)",
      "path": "docs/adr/0004-test-generator-handoff.md",
      "status": "proposed",
      "date": "2026-06-17",
      "architecture_area": "qa",
      "tags": ["qa", "test-generator", "handoff"],
      "supersedes": null,
      "superseded_by": null,
      "source_commit": "0000001",
      "last_generated_at": "2026-06-17T16:00:00Z"
    }
  ]
}
```

## Why this file lives in the knowledge layer, not just on disk

Two reasons:

1. **Queryability.** The Memory Agent needs `adr.list(status='accepted', area='iam')` for board views and run summaries. Walking the filesystem on every query is a 100ms+ tax that grows linearly with ADR count. The index is the query surface.
2. **Audit.** The Audit Agent logs every write to this file. A drift between the filesystem (`docs/adr/`) and the registry surfaces immediately as an audit finding.

The registry is **re-derived** from the filesystem on every doc run (idempotency contract — see [docs.md](./docs.md#idempotency)). The Memory Agent never trusts a registry entry that does not correspond to a real file on disk.

## What is NOT here

- **The ADR text.** It lives at `docs/adr/NNNN-*.md`. This file is a typed index, not a copy.
- **A "draft" status.** The doc agent only tracks `proposed | accepted | superseded | deprecated`. A working draft is a local artifact, not a registry entry.
- **Cross-tenant ADRs.** ADRs are per-tenant (and per-project). A customer cannot see another customer's ADRs.

## Related

- The doc index: [docs.md](./docs.md)
- The on-disk contract: [agents/documentation/schemas.py AdrRegistryEntry](../../agents/documentation/schemas.py)
- The query interface: [agents/documentation/docs_query.py](../../agents/documentation/docs_query.py)
- The ADR template: [memory/architecture.md §5](../memory/architecture.md#5-adrs-architecture-decision-records)
- The sample ADR: [docs/adr/0002-knowledge-layer-storage-contract.md](../../docs/adr/0002-knowledge-layer-storage-contract.md)
