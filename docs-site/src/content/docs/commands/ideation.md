---
draft: false
title: Ideation Commands
description: The 5 ideation commands — brainstorm, refine, compare, prune, crystallize.
---

The ideation category has 5 commands that take a fuzzy problem statement and produce a concrete, reviewable approach.

## Commands

| Command | Tier | Approval | Description |
|---|---|---|---|
| `forge-ideate-brainstorm` | user | no | Generate candidate approaches for a problem |
| `forge-ideate-refine` | user | no | Refine a chosen idea into concrete shape |
| `forge-ideate-compare` | user | no | Trade-off table for 2+ approaches |
| `forge-ideate-prune` | user | no | Discard rejected approaches with rationale |
| `forge-ideate-crystallize` | admin | yes | Freeze an approach into a recordable decision |

## What is this category for?

Ideation is the front door of an SDLC workflow. Before any architecture, before any development, the team needs to agree on **what** they're solving and **which approach** to take. The ideation commands turn fuzzy prompts into typed artifacts.

## How to use

### Brainstorm

```bash
pnpm forge:exec forge-ideate-brainstorm \
  --args '{"problem":"reduce p99 latency on checkout","count":4}' \
  --tenant-id acme-corp --project-id acme-api --user-id pm@acme.com
```

Returns N candidate approaches, each with a one-paragraph summary and a list of risks. The output is a draft artifact — it can be refined or pruned.

### Refine

```bash
pnpm forge:exec forge-ideate-refine \
  --args '{"idea_id":"idea-001","depth":"detailed"}' \
  --tenant-id acme-corp --project-id acme-api --user-id pm@acme.com
```

Takes an idea and produces a refined version with: scope, non-goals, affected services, dependencies, success metrics.

### Compare

```bash
pnpm forge:exec forge-ideate-compare \
  --args '{"idea_ids":["idea-001","idea-002","idea-003"],"axes":["cost","risk","time","blast_radius"]}' \
  --tenant-id acme-corp --project-id acme-api --user-id pm@acme.com
```

Produces a trade-off table across the requested axes.

### Prune

```bash
pnpm forge:exec forge-ideate-prune \
  --args '{"idea_ids":["idea-002"],"rationale":"blocked by data residency constraint"}' \
  --tenant-id acme-corp --project-id acme-api --user-id pm@acme.com
```

Marks ideas as rejected with a typed rationale. Pruned ideas remain in the audit ledger — they are not deleted.

### Crystallize (admin, requires approval)

```bash
pnpm forge:exec forge-ideate-crystallize \
  --args '{"idea_id":"idea-001","outcome":"selected","seed_adr":true}' \
  --tenant-id acme-corp --project-id acme-api --user-id architect@acme.com
```

Freezes a chosen approach into a recordable decision. With `seed_adr=true`, it produces a draft ADR with the context, decision, and consequences pre-filled. The output is a typed artifact that goes through the Architecture approval gate.

## When to use

| Scenario | Command |
|---|---|
| Starting a new feature | `forge-ideate-brainstorm` |
| Picking between two approaches | `forge-ideate-compare` |
| Recording why we didn't pick X | `forge-ideate-prune` |
| Handing off to architecture | `forge-ideate-crystallize` (admin) |

## Output

All ideation commands produce `Idea` typed artifacts with the following schema (excerpt):

```python
class Idea(BaseModel):
    id: UUID
    problem: str
    summary: str
    scope: list[str]
    non_goals: list[str]
    risks: list[Risk]
    status: Literal["draft", "refined", "compared",
                    "pruned", "crystallized"]
    parent_id: UUID | None   # for refined/pruned/crystallized
```

## Related

- [Architecture commands](/commands/architecture/) — `forge-arch-adr` consumes a crystallized idea
- [Typed artifacts](/concepts/typed-artifacts/)
- [Constitutional rules](/concepts/constitutional-rules/) — R4 (typed artifacts only)
