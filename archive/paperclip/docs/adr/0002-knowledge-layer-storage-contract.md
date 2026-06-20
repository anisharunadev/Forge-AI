# 0002 — Knowledge layer storage contract for the Documentation Agent

- **Status:** accepted
- **Date:** 2026-06-17
- **Accepted at:** 2026-06-17T16:53:00Z
- **Deciders:** CTO (interim) → doc-agent (target hire)
- **Issue:** [Forge AI-117](/Forge AI/issues/Forge AI-117)
- **Design doc:** [Forge AI-81](/Forge AI/issues/Forge AI-81#document-doc-generation-spec) (system prompt), [memory/architecture.md §5](../workspace/memory/architecture.md#5-adrs-architecture-decision-records) (ADR template)
- **Supersedes:** —
- **Superseded by:** —

## Context

The Documentation Agent (Stage 7 of the Forge AI SDLC pipeline) generates five kinds of artifacts: README, API docs, CHANGELOG, Release Notes, and ADRs. The artifact text lives at `README.md`, `CHANGELOG.md`, `docs/`, and `docs/adr/`. The artifact *index* — the typed, queryable handle the Memory Agent and Audit Agent read from — does not exist yet.

Without an index, the Memory Agent cannot answer `docs.list(kind='adr', status='accepted')` without walking the filesystem on every query. The Audit Agent cannot guarantee that every doc write produced a corresponding index entry (so a half-written index surfaces as silent drift, not a finding). And the generators (7.1.2 — 7.1.5) have no stable v1 surface to write to.

[Forge AI-81 §"Agent contract"](/Forge AI/issues/Forge AI-81#document-doc-generation-spec) already names the two knowledge-layer files: `workspace/project/docs.md` (the doc index) and `workspace/project/adr-registry.md` (the ADR registry). This ADR codifies the contract that those two files implement — the contract that 7.1.2 — 7.1.5 will consume.

## Decision

The v1 knowledge-layer surface is **two files** with **two schemas**, mirrored in `agents/documentation/schemas.py`:

### D1. Doc index — `workspace/project/docs.md`

Frontmatter (YAML handle) + a fenced JSON body of `DocIndexEntry` rows. The on-disk shape is the same as the in-code shape; round-trip must be lossless.

The index is **re-derived** from the artifacts on disk on every doc-generation run. The file is the query surface, not the source of truth. A re-run with the same `input_sha` is a no-op.

### D2. ADR registry — `workspace/project/adr-registry.md`

Frontmatter + a fenced JSON body of `AdrRegistryEntry` rows. Same round-trip property.

The registry supports four query shapes: by tag, by date range, by status, by architecture area. The Memory Agent's `adr.list(status='accepted')` is the canonical example.

### D3. Per-kind freshness SLA

| Kind | Cadence | Max age | Blocks release? |
| --- | --- | --- | --- |
| `readme` | every release | 7 d | warn-only |
| `changelog` | every release | 7 d | warn-only |
| `release_notes` | every release | 30 d | warn-only |
| `api_docs` | every merge | 24 h | **blocks** |
| `adr` | once (per decision) | 365 d | warn-only |

SLAs are the default; a customer may override in `engagements/<customer-slug>/conventions.md`. `api_docs` is the only kind that blocks the release stage; the rest are warn-only.

### D4. Query surface — `agents/documentation/docs_query.py`

A small in-memory module: `DocsQuery.load()`, `list_docs(...)`, `list_adrs(...)`, `freshness_check()`. All queries are O(n) over the entries; sub-100ms on a 10k-entry surface. No external DB.

### D5. Idempotency contract

Same `input_sha` + `source_commit` + `content_sha` → byte-identical `DocIndexEntry`. Re-running is a no-op. The Memory Agent re-derives the index from disk; the file is a query cache.

## Consequences

**Easier:**
- A board view that says "show me every accepted ADR in the IAM area" is a one-liner.
- Drift between the filesystem and the index is a typed audit finding, not a silent bug.
- The next agent hire (the doc-agent) has a stable v1 surface to land on.

**Harder:**
- Every doc run now does ~2 extra writes (one to `docs.md`, one to `adr-registry.md`). Both are sub-millisecond JSON writes; the cost is rounding error.
- The contract becomes a one-way door: changing the `DocIndexEntry` shape after 7.1.2 — 7.1.5 ship is a breaking change for the generators and the Memory Agent. Future changes are additive, not breaking.

**Accepted:**
- A customer who wants to override freshness SLAs does so in their engagement conventions, not in this file. The Knowledge Layer is global; per-tenant overrides are per-tenant.
- The query surface is in-memory, not backed by Postgres. A 10k-entry index is < 1 MB; re-deriving on every load is the right trade for v1. A persistent index is a v1.1 conversation.

## Alternatives considered

- **Postgres-backed index with per-tenant tables.** Stronger query model and concurrent access. The trade is operational overhead (one more table family, one more migration path, one more cross-tenant boundary to enforce). For a 10k-entry surface that is read in < 100 ms from JSON, the operational cost is not justified. Revisit at 100k entries.
- **Embed the index in the artifacts' YAML frontmatter.** No separate file. The trade is that every doc write becomes a re-parse of every other doc, and `docs.list` becomes a walk-every-file operation. The savings on disk I/O are not worth the read-time cost.
- **Defer the index to v1.1.** The generators (7.1.2 — 7.1.5) cannot land without it; deferring creates a hard upstream-downstream block. Per [Forge AI-142 §Recommended Action step 3](/Forge AI/issues/Forge AI-142), 7.1.6 ships first.
