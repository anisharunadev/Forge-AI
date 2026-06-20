---
title: Knowledge Layer
description: The customer-owned folder of memory, customer, and project files. The source of truth.
draft: false
last_generated_at: 2026-06-18T00:00:00Z
source_sha: forareal-final
source_path: workspace/memory/architecture.md
generator: readme
approval_required: false
---

The **Knowledge Layer** is the customer-owned folder of memory, customer, and project files. It is the source of truth. The acceptance bar is:

> A future sub-agent, woken cold with only the relevant files in context, can do its job. Anything tribal stays in `workspace/`; nothing tribal stays in prompts.

## The layout

```
workspace/
├── memory/                          # engineering defaults
│   ├── architecture.md
│   ├── coding.md
│   ├── devops.md
│   ├── qa.md
│   └── security.md
├── customer/                        # customer-facing baseline
│   ├── conventions.md
│   ├── glossary.md
│   └── standards.md
├── project/                         # product facts
│   ├── PRD.md
│   ├── roadmap.md
│   ├── tech-stack.md
│   ├── docs.md                       # the doc index (storage contract)
│   └── adr-registry.md
└── engagements/                     # per-tenant overrides
    └── <customer-slug>/
        ├── README.md
        ├── conventions.md           # customer-specific overrides
        ├── integrations/            # MCP server configs
        ├── runbooks/                 # customer-specific runbooks
        └── contracts/                # MSAs, DPAs (links, not docs)
```

## The injection model

When an agent wakes cold, the Memory agent injects the relevant files into its context. Per [README §2](https://github.com/fora-platform/fora/blob/main/README.md):

| Agent | Files injected |
| --- | --- |
| **All agents** | `customer/conventions.md`, `customer/glossary.md`, `customer/standards.md`, `project/PRD.md`, `project/tech-stack.md` |
| **Architect** | + `memory/architecture.md` |
| **Developer** | + `memory/architecture.md`, `memory/coding.md` |
| **QA** | + `memory/qa.md` |
| **Security** | + `memory/security.md` |
| **DevOps** | + `memory/devops.md` |
| **Documentation** | + `project/docs.md`, `project/adr-registry.md` |

An agent without its memory files is not ready to work.

## The version contract

Every file in the Knowledge Layer has a `version:` line in its frontmatter. The version is bumped on every change:

- **Major** — breaking change to the contract; a one-way door (per [`memory/architecture.md` §5](https://github.com/fora-platform/fora/blob/main/workspace/memory/architecture.md))
- **Minor** — additive, non-breaking
- **Patch** — corrections

The Memory agent refuses to inject a file with a missing or malformed `version:` line.

## The freshness contract

The doc index in [`workspace/project/docs.md`](https://github.com/fora-platform/fora/blob/main/workspace/project/docs.md) is the query surface. Every doc run appends or refreshes one `DocIndexEntry` per artefact. The Memory agent runs `freshness_check()` before the release stage; a stale artefact blocks the release.

| Kind | Max age | Blocks release? |
| --- | --- | --- |
| `api_docs` | 24 h | **yes** |
| `readme` | 7 d | warn-only |
| `changelog` | 7 d | warn-only |
| `release_notes` | 30 d | warn-only |
| `adr` | 365 d | warn-only |

## The idempotency contract

Same `input_sha` + `source_commit` + `content_sha` → byte-identical `DocIndexEntry`. A re-run is a no-op unless one of the three inputs changed.

## The v1 read/write model

| Layer | Read by | Written by (v1) |
| --- | --- | --- |
| `workspace/memory/` | All agents | CTO + leads (humans) |
| `workspace/customer/` | All agents | DocAgent + CTO |
| `workspace/project/` | All agents | CTO + DocAgent |
| `engagements/<slug>/` | Tenant-scoped agents | Customer (humans) |
| `docs/` | All agents | DocAgent (only) |
| `docs/adr/` | All agents | Architect + CTO |

**v1: humans write, agents read.** Writes from agents are a separate ticket and out of scope for v1 (per [PRD §5.3](https://github.com/fora-platform/fora/blob/main/workspace/project/PRD.md)).

## The Knowledge Layer bar (the acceptance bar)

Every PR that lands in `workspace/` must meet the bar:

1. ✅ A future cold-started agent can do its job from these files alone.
2. ✅ Every term used is in `customer/glossary.md`.
3. ✅ Every cross-reference resolves.
4. ✅ Every commit carries a `version:` bump.
5. ✅ The doc index entry is appended/refreshed in `workspace/project/docs.md`.

A PR that violates the bar is rejected at review.

## Where to next

- **[Memory agent →](/agents/memory/)** — the cross-cutting read/write layer.
- **[Documentation agent →](/agents/documentation/)** — the doc generators.

<div class="freshness-footer">
  <dl>
    <dt>Source SHA</dt><dd><code>forareal-final</code></dd>
    <dt>Source path</dt><dd><code>workspace/memory/architecture.md</code> + <code>workspace/README.md</code></dd>
    <dt>Last generated</dt><dd>2026-06-18T00:00:00Z</dd>
    <dt>Generator</dt><dd><code>readme</code> · DocAgent v1.0 ([Forge AI-298](/Forge AI/issues/Forge AI-298))</dd>
  </dl>
</div>
