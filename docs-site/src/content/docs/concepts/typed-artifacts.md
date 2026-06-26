---
draft: false
title: Typed Artifacts
description: The six typed outputs of Forge workflows — what each one is, when it's produced, and how it's reviewed.
---

Forge workflows don't produce free-form text. Every workflow produces one of **six typed artifacts**, each with a fixed schema, a review rubric, and a place in the audit ledger.

## What is this?

A **typed artifact** is a structured output of a `forge-*` workflow. It has:

- A fixed schema (Pydantic v2 in the backend, OpenAPI 3 in the API).
- A review rubric (composite score 0–100, with per-section weights).
- A status lifecycle (`draft`, `in_review`, `accepted`, `accepted_after_minor_edits`, `rejected`).
- An audit row on every status transition.

The six typed artifacts are:

| # | Artifact | Produced by | Reviewer |
|---|---|---|---|
| 1 | **ADR** (Architecture Decision Record) | `forge-arch-adr` | Architect, Tech Lead |
| 2 | **API Contract** | `forge-arch-contract-spec` | Service owner, Architect |
| 3 | **Task Breakdown** | `forge-dev-implement` | Eng Lead, Dev |
| 4 | **Risk Register** | `forge-review-risk` | Steward, Eng Lead |
| 5 | **Security Report** | `forge-sec-scan`, `forge-sec-policy-check` | Security Reviewer, Steward |
| 6 | **Deployment Plan** | `forge-deploy-plan` | Release Manager, Eng Lead |

## Why does it exist?

Free-form outputs are unreviewable. If an agent produces "we should use Postgres because it scales well", the reviewer has nothing to score against. They either accept the prose or reject it on taste.

Typed artifacts are reviewable:

- Each section has a name and a target length.
- Each section has a weight in the composite score.
- Each section has a "ready for review" threshold.
- The composite score drives the approval decision.

This makes the artifact **legible to humans and machines**. The rubric, the schema, and the audit row are all machine-parseable.

## What problem does it solve?

| Problem | Without typed artifacts | With typed artifacts |
|---|---|---|
| "Is this ADR ready?" | Subjective | Composite score + per-section rubric |
| "What changed between drafts?" | Diff the prose | Diff the typed sections |
| "Did the agent skip a section?" | Hard to tell | Schema validation fails at submission |
| "Which artifacts were accepted this week?" | Read chat history | Query `artifacts WHERE status='accepted'` |

## How does it work?

Each artifact type has:

```text
Pydantic schema
  - required fields
  - optional fields with defaults
  - validators (e.g., status transitions)

Rubric
  - per-section weights (sum to 1.0)
  - per-section thresholds
  - composite formula

State machine
  - draft → in_review → (accepted | accepted_after_minor_edits | rejected)
  - each transition audited
```

Example — an ADR's schema (excerpt):

```python
class ADR(BaseModel):
    id: UUID
    tenant_id: UUID
    project_id: UUID
    title: str
    status: Literal["draft", "in_review", "accepted",
                    "accepted_after_minor_edits", "rejected"]
    context: Section          # required, min 100 words
    decision: Section         # required, min 50 words
    consequences: Section     # required, min 100 words
    alternatives: list[Section]
    created_by: str           # user_id or "system:agent:<name>"
    created_at: datetime
    submitted_at: datetime | None
    decided_at: datetime | None
    composite_score: float | None  # 0..100, set at review
```

The composite score is computed by the rubric and is the basis for the approval decision. The default threshold is 70 for `accept` and 50 for `accept_after_minor_edits`.

## How do I use it?

As a developer, you mostly read typed artifacts:

- Browse them in the Knowledge Center.
- Filter by status, type, project, or reviewer.
- Comment on sections (comments are also typed and audited).

As an architect or security reviewer, you score them:

- Open the artifact in the review panel.
- Score each section (0–10).
- The composite score drives the decision.

As a contributor, if you want to extend the artifact system (add a new typed artifact), see [Custom agents](/guides/custom-agents/).

## When should I use it?

**Always**. Free-form prose is not a Forge output. The only time you produce prose is in comments on a typed artifact.

## Related

- [Approval gates](/concepts/approval-gates/)
- [Auditability](/concepts/auditability/)
- [Forge architecture commands](/commands/architecture/)
- [ADR-007: LangGraph SDLC orchestrator](/architecture/adr-007-langgraph/)
