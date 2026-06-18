---
name: doc-index
version: 1.0
spec: FORA-117
owner: doc-agent
status: production
description: |
  The v1 knowledge-layer surface the Documentation Agent writes to and that
  the Memory Agent and Audit Agent read from. The DocIndex entries below are
  the storage contract for sub-goals 7.1.2 — 7.1.5 (README, API, ADR, CHANGELOG,
  Release Notes generators). Same shape as `agents/documentation/schemas.py:DocIndexEntry`.
---

# Doc Index — FORA Project

This file is the **doc index** (storage contract for [FORA-117](/FORA/issues/FORA-117), sub-goal 7.1.6). Every doc-generation run appends or refreshes one entry per artifact. The Memory Agent reads this file; the Audit Agent audits writes to it; the Master Orchestrator consults `docs.freshness_check` before the release stage.

The agents that *write* to this file are: `readme`, `api_docs`, `changelog`, `release_notes`, `adr` (matches `GeneratorType` 1:1). The agents that *read* it are: Memory Agent, Audit Agent, and the Documentation Agent itself on the next run.

## Layout

The file is frontmatter + a fenced JSON block. The JSON shape is the contract; the frontmatter is a human handle.

```text
┌──────────────────────────────────────────────┐
│ --- (YAML frontmatter: name/version/spec)    │  ← handle
├──────────────────────────────────────────────┤
│ # Doc Index — FORA Project                   │  ← human prose
│ <this section>                               │
├──────────────────────────────────────────────┤
│ ```json                                      │
│ {                                           │
│   "version": "1.0",                          │
│   "generated_at": "ISO 8601 UTC",            │
│   "docs_index_sha": "set by memory layer",   │
│   "entries": [DocIndexEntry, ...]            │  ← contract
│ }                                           │
│ ```                                          │
└──────────────────────────────────────────────┘
```

## Entry shape (`DocIndexEntry`)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `path` | string | yes | Repo-relative path of the artifact, e.g., `README.md`, `docs/adr/0042-use-postgres.md` |
| `kind` | enum | yes | `readme` \| `api_docs` \| `changelog` \| `release_notes` \| `adr` (mirrors `GeneratorType`) |
| `title` | string | yes | Human-readable title |
| `last_generated_at` | ISO 8601 UTC | yes | Stamped by the doc agent on every write |
| `source_commit` | git SHA | yes | The commit the artifact was derived from (determinism + source attribution) |
| `generator` | string | yes | The generator that produced it (matches `GeneratorType.value`) |
| `version` | string | yes | Storage schema version, currently `"1.0"` |
| `content_sha` | sha256 | no | Cached hash from `DocArtifact.content_sha`; useful for `docs.diff` |
| `approval_required` | bool | no | True for new ADR, README rewrite, breaking-change notes |
| `tags` | string[] | no | Free-form tags for search |
| `architecture_area` | string | no | E.g., `knowledge-layer`, `iam`, `secrets` |

`approval_required` is set per-kind by default: README rewrite, new ADR, breaking-change notes → `true`; routine CHANGELOG and API-doc diffs → `false`. The CTO gates the merge on the human-approval step when `approval_required` is true.

## Freshness SLA per kind

| Kind | Cadence | Max age | Blocks release? | Why |
| --- | --- | --- | --- | --- |
| `readme` | every release | 7 d | warn-only | "Where do I start?" must stay current at each release. |
| `changelog` | every release | 7 d | warn-only | Auditors grep CHANGELOG. Missing entries are a P2 bug. |
| `release_notes` | every release | 30 d | warn-only | One per release; the next release overwrites the last. |
| `api_docs` | every merge | 24 h | **blocks** | API contracts are load-bearing; a stale doc is a P1 customer trust issue. |
| `adr` | once (per decision) | 365 d | warn-only | ADRs are immutable once accepted; staleness is "needs review", not "ship blocker". |

SLAs are the default; a customer can override in `engagements/<customer-slug>/conventions.md` (per [customer/conventions.md §1](./../customer/conventions.md#1-the-convention-hierarchy)).

## Query surface

The Memory Agent and Audit Agent call into `agents/documentation/docs_query.py`. The interface is:

```python
from agents.documentation.docs_query import DocsQuery

q = DocsQuery.load()                    # reads workspace/project/docs.md
q.list_docs(kind="readme")              # all README entries
q.list_accepted_adrs()                  # adr.list(status='accepted')
q.freshness_check()                     # returns List[FreshnessWarning]
```

All queries are O(n) over the entries and run in **< 100 ms** on a 10k-entry surface (verified by `python -m agents.documentation.smoke_test`). No external DB; the index is a small JSON document, re-derived from the artifacts on disk on every run.

## Idempotency

Same `input_sha` + `source_commit` + `content_sha` → byte-identical `DocIndexEntry`. The Memory Agent re-derives the index from the artifacts on disk; the file is the query surface, not the source of truth. A re-run is a no-op unless one of the three inputs changed.

## What is NOT here

- **The artifacts themselves.** They live at `README.md`, `CHANGELOG.md`, `docs/`, `docs/adr/`. This file is a typed index, not a copy of the content.
- **Cross-tenant data.** A doc index is per-tenant. The Memory Agent refuses to merge indexes across tenants.
- **A vector index.** Out of scope for v1. The Memory Agent uses this file for keyword + structured queries; embeddings are a v1.1 conversation.

## Sample run (FORA-117 acceptance)

`python -m agents.documentation.smoke_test` produces four entries in this file from a stub run: one README, one CHANGELOG, one API doc, and one ADR. The smoke-test evidence is written to `agents/documentation/evidence/smoke_<timestamp>.json` and the index entries match the artifacts the stub generator produced.

## Current index (live)

```json
{
  "version": "1.0",
  "generated_at": "2026-06-17T17:06:38.978100+00:00",
  "docs_index_sha": "v1-initial-seed",
  "entries": [
    {
      "path": "README.md",
      "kind": "readme",
      "title": "FORA",
      "last_generated_at": "2026-06-17T17:06:38.977536+00:00",
      "source_commit": "forareal-final",
      "generator": "readme",
      "version": "1.0",
      "content_sha": "1342571d631a488bfb44018bfc3a3bef440cb2695de8345ad37f1d3a90450848",
      "approval_required": true,
      "tags": [
        "entry-point",
        "v1"
      ],
      "architecture_area": null
    },
    {
      "path": "CHANGELOG.md",
      "kind": "changelog",
      "title": "FORA Changelog",
      "last_generated_at": "2026-06-17T16:00:00Z",
      "source_commit": "0000001",
      "generator": "changelog",
      "version": "1.0",
      "content_sha": "0000000000000000000000000000000000000000000000000000000000000000",
      "approval_required": false,
      "tags": [
        "audit",
        "audit-evidence"
      ],
      "architecture_area": null
    },
    {
      "path": "docs/api/openapi.yaml",
      "kind": "api_docs",
      "title": "FORA Public API (OpenAPI 3.1)",
      "last_generated_at": "2026-06-17T16:00:00Z",
      "source_commit": "0000001",
      "generator": "api_docs",
      "version": "1.0",
      "content_sha": "0000000000000000000000000000000000000000000000000000000000000000",
      "approval_required": false,
      "tags": [
        "api",
        "openapi"
      ],
      "architecture_area": "runtime"
    },
    {
      "path": "docs/adr/0002-knowledge-layer-storage-contract.md",
      "kind": "adr",
      "title": "Knowledge layer storage contract for the Documentation Agent",
      "last_generated_at": "2026-06-17T16:53:00Z",
      "source_commit": "0000001",
      "generator": "adr",
      "version": "1.0",
      "content_sha": "0000000000000000000000000000000000000000000000000000000000000000",
      "approval_required": true,
      "tags": [
        "knowledge-layer",
        "documentation",
        "storage-contract"
      ],
      "architecture_area": "knowledge-layer"
    }
  ]
}
```

## Related

- The ADR registry: [adr-registry.md](./adr-registry.md)
- The on-disk contract: [agents/documentation/schemas.py DocIndexEntry](../../agents/documentation/schemas.py)
- The query interface: [agents/documentation/docs_query.py](../../agents/documentation/docs_query.py)
- The smoke test: `python -m agents.documentation.smoke_test`
- The doc-generation spec: [FORA-81](/FORA/issues/FORA-81#document-doc-generation-spec)
- The Knowledge Layer bar: [README §3](../README.md#3-the-acceptance-bar)
