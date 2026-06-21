---
title: Learning Commands
description: The 4 learning commands — capture, summarize, promote, search.
---

The learning category has 4 commands that close the loop on a release: capture lessons, summarize across sessions, promote durable rules, and search the org-wide lesson corpus.

## Commands

| Command | Tier | Approval | Description |
|---|---|---|---|
| `forge-learn-capture` | user | no | Capture a lesson from a session |
| `forge-learn-summarize` | user | no | Summarize captured lessons for review |
| `forge-learn-promote` | admin | yes | Promote a lesson to a durable rule |
| `forge-learn-search` | user | no | Search the org-wide lesson corpus |

## What is this category for?

Learning is the **organizational memory** of Forge. Without it, every cycle repeats the same mistakes. With it, the system gets smarter over time — lessons from one team propagate to others via the Organization Knowledge layer.

## How to use

### Capture

```bash
pnpm forge:exec forge-learn-capture \
  --args '{"title":"Canary 5% for 15m caught a sev3 we missed in staging","tags":["deploy","canary"],"session_ref":"sess-001"}' \
  --tenant-id acme-corp --project-id acme-api --user-id dev@acme.com
```

Captures a lesson. The lesson is a typed artifact with: title, body, tags, session reference, author. It enters the org-wide corpus under the tenant.

### Summarize

```bash
pnpm forge:exec forge-learn-summarize \
  --args '{"tags":["deploy","canary"],"window":"90d"}' \
  --tenant-id acme-corp --project-id acme-api --user-id dev@acme.com
```

Summarizes captured lessons in the window. Output is a digest of themes, top contributors, and recommended promotions.

### Promote (admin, requires approval)

```bash
pnpm forge:exec forge-learn-promote \
  --args '{"lesson_ids":["l-001","l-002","l-003"],"target":"org_policy","title":"Default canary schedule"}' \
  --tenant-id acme-corp --project-id acme-api --user-id steward@acme.com
```

Promotes one or more lessons to a durable rule. Targets: `org_policy` (tenant-wide policy), `template` (re-usable template), `standard` (project-wide standard). The HITL gate enforces Steward approval.

### Search

```bash
pnpm forge:exec forge-learn-search \
  --args '{"query":"canary schedule for high-risk deploys","top_k":5}' \
  --tenant-id acme-corp --project-id acme-api --user-id dev@acme.com
```

Searches the org-wide lesson corpus using semantic similarity (pgvector) over the lesson body. Returns the top-k matches with similarity scores.

## Output

- `forge-learn-capture` → Lesson typed artifact
- `forge-learn-summarize` → Digest
- `forge-learn-promote` → Policy / template / standard update
- `forge-learn-search` → Ranked lesson list

## Knowledge reuse as a KPI

Knowledge reuse is one of the seven pilot KPIs — see [Success metrics](/operations/success-metrics/). The pilot target is ≥10% of artifacts being derived from a prior lesson or template; the steady-state target is ≥25%.

## When to use

| Scenario | Command |
|---|---|
| End of a cycle | `forge-learn-capture` |
| Quarterly retrospective | `forge-learn-summarize` |
| Promote a recurring lesson | `forge-learn-promote` (admin) |
| Looking for prior art | `forge-learn-search` |

## Related

- [Layer isolation](/architecture/overview/) — Organization Knowledge layer
- [Knowledge graph](/concepts/knowledge-graph/)
- [ADR-003: Hybrid MDM with Steward priority](/architecture/adr-003-mdm-steward/)
