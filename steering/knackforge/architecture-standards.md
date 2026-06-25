---
rule_id: knackforge-architecture-standards
scope: project
applies_to_stages: [pre_plan, pre_code, pre_review]
sources: [ADR-003, ADR-006]
---

# KnackForge — Architecture Standards

## Typed Artifacts (ADR-003)

- Agents do **not** produce free-form data. Every LLM output is
  coerced into a Pydantic-typed shape (e.g. ``IdeaAnalysis``,
  ``PRD.content`` JSON dict with a fixed key set).
- Typed shapes flow through ``core/schemas`` and are mirrored by
  SQLAlchemy JSONB columns. Validate at the boundary; trust the
  shape internally.
- Forbidden: large blobs of unstructured Markdown emitted by the
  LLM and stored as-is. Prefer a structured section dict
  (``problem``, ``goals``, ``success_metrics`` …).

## Org Knowledge ≠ Project Intelligence (ADR-006)

- Organization Knowledge lives in the tenant scope. Examples:
  persona memory (``tenants/<slug>/workspace/memory/personas/...``),
  Org-wide standards, common NFRs.
- Project Intelligence lives in the ``projects`` scope: epics,
  stories, code, tests, deployment plans, arch previews.
- The two layers must never collapse:
  - Connector signals (Confluence / Zendesk / Slack) land in
    ``ideation_source_signals`` (Org Knowledge) before
    synthesis into ``ideas`` (Project Intelligence).
  - Persona memory is tenant-only (no ``project_id``); ideation
    is tenant + project.

## Layered Architecture

- Each layer has a typed service:
  ``services/ideation/idea_intake.py`` (intake),
  ``services/ideation/idea_analysis.py`` (analysis),
  ``services/ideation/idea_enhance.py`` (PM feedback),
  ``services/ideation/push_to_delivery.py`` (handoff).
- No cross-layer imports — composition lives in the API router
  and the bus subscribers.

## Idempotency

- Every state-changing operation must be safe to retry. Patterns:
  - UNIQUE constraint + ``INSERT ... ON CONFLICT DO NOTHING``
    (``ideation_source_signals``).
  - External natural key (``Idea.external_key`` = Jira issue key).
  - Bus subscribers check before write
    (``JiraIngestionService._upsert_idea``).