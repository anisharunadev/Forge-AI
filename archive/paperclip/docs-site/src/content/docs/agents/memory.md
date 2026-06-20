---
title: Memory
description: The Memory agent — the cross-cutting read/write layer for the Knowledge Layer.
draft: false
last_generated_at: 2026-06-18T00:00:00Z
source_sha: forareal-final
source_path: workspace/project/docs.md
generator: readme
approval_required: false
---

The **Memory agent** is the cross-cutting agent that owns the **Knowledge Layer** — the customer-owned folder of memory, customer, and project files. It serves reads to every other agent and (in v1) accepts writes only from humans.

## What it owns

| Folder | Owner | Read by | Written by |
| --- | --- | --- | --- |
| `workspace/memory/` | Engineering | All agents | CTO + leads |
| `workspace/customer/` | Customer-facing | All agents | DocAgent + CTO |
| `workspace/project/` | Product | All agents | CTO + DocAgent |
| `engagements/<slug>/` | Per-tenant | Tenant-scoped agents | Customer (humans) |
| `docs/` | DocAgent | All agents | DocAgent |
| `docs/adr/` | Architect | All agents | Architect + CTO |

## What it reads

The doc index in [`workspace/project/docs.md`](https://github.com/fora-platform/fora/blob/main/workspace/project/docs.md) is the query surface. The Memory agent calls into `agents/documentation/docs_query.py`:

```python
from agents.documentation.docs_query import DocsQuery

q = DocsQuery.load()
q.list_docs(kind="readme")
q.list_accepted_adrs()
q.freshness_check()
```

All queries are **O(n) over the entries** and run in **< 100 ms** on a 10k-entry surface.

## The freshness check

The Memory agent runs `freshness_check()` before the release stage. A stale artefact (older than the SLA in [`workspace/project/docs.md` §"Freshness SLA"](#)) blocks the release.

| Kind | Max age | Blocks release? |
| --- | --- | --- |
| `api_docs` | 24 h | **yes** |
| `readme` | 7 d | warn-only |
| `changelog` | 7 d | warn-only |
| `release_notes` | 30 d | warn-only |
| `adr` | 365 d | warn-only |

## The injection model

When an agent wakes cold, the Memory agent injects the relevant files into its context (per [README §2 — the injection model](https://github.com/fora-platform/fora/blob/main/README.md)):

- The customer's conventions + glossary (always).
- The project's PRD + roadmap + tech stack (always).
- The architecture memory file (for Architect, Dev, Refactor).
- The coding memory file (for Dev, DevOps).
- The QA memory file (for QA).
- The security memory file (for Security, Architect).
- The DevOps memory file (for DevOps).

An agent without its memory files is not ready to work.

## The Knowledge Layer bar (the acceptance bar)

> **A future sub-agent, woken cold with only the relevant files in context, must be able to do its job. Anything tribal stays in `workspace/`; nothing tribal stays in prompts.**

This is the acceptance bar for every PR. A PR that adds tribal knowledge to a prompt (rather than to the Knowledge Layer) is rejected at review.

## Where to next

- **[Architecture → Knowledge Layer →](/architecture/knowledge-layer/)** — the storage contract.
- **[Documentation agent →](/agents/documentation/)** — the doc generators.

<div class="freshness-footer">
  <dl>
    <dt>Source SHA</dt><dd><code>forareal-final</code></dd>
    <dt>Source path</dt><dd><code>workspace/project/docs.md</code></dd>
    <dt>Last generated</dt><dd>2026-06-18T00:00:00Z</dd>
    <dt>Generator</dt><dd><code>readme</code> · DocAgent v1.0 ([Forge AI-298](/Forge AI/issues/Forge AI-298))</dd>
  </dl>
</div>
