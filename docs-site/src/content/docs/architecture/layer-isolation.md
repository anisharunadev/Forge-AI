---
draft: false
title: Layer Isolation
description: How Forge separates Organization Knowledge from Project Intelligence — RLS, scopes, conflict resolution.
---

Forge's knowledge layer is split into two scopes: **Organization Knowledge** (tenant-wide) and **Project Intelligence** (project-scoped). They live in the same database but are isolated by RLS policies and have different ownership.

## What is this?

A two-layer model that answers:

- "What does every project in this tenant need to know?" → Organization Knowledge
- "What does only this project know?" → Project Intelligence

## Why does it exist?

Without layer isolation, two failure modes recur:

1. **Sprawl.** A standard or template ends up duplicated in every project, and the copies drift.
2. **Leakage.** A project's secrets or contracts leak into the org-wide namespace because there's no policy boundary.

Layer isolation makes both failure modes structurally hard.

## The two layers

```text
+--------------------------------------------------------------------+
|                  Organization Knowledge Layer                       |
|                                                                     |
|  Scope:   tenant-wide (shared across all projects)                 |
|  Owner:   Steward role                                              |
|  Examples: standards, templates, policies, org glossary, archetypes |
|  Stored:  relational tables in PostgreSQL 17 (no AGE required)     |
|  RLS:     tenant_id only (no project_id discriminator)             |
+--------------------------------------------------------------------+
                                |
                                | tenant_id boundary (RLS)
                                v
+--------------------------------------------------------------------+
|                  Project Intelligence Layer                         |
|                                                                     |
|  Scope:   per project within a tenant                              |
|  Owner:   Architect / Eng Lead per project                          |
|  Examples: services, APIs, DBs, dependencies, ADRs, tasks           |
|  Stored:  Apache AGE graph nodes + pgvector embeddings              |
|  RLS:     tenant_id + project_id                                    |
+--------------------------------------------------------------------+
```

## RLS in practice

```sql
-- Organization Knowledge
ALTER TABLE org_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_only ON org_policies
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- Project Intelligence
ALTER TABLE project_services ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_and_project ON project_services
  USING (
    tenant_id = current_setting('app.tenant_id')::uuid
    AND project_id = current_setting('app.project_id')::uuid
  );
```

Application code sets both GUCs (`app.tenant_id` and `app.project_id`) at the start of every transaction. The connection pool resets them between tenants.

## Layer discriminator

Some tables need to participate in both layers (e.g., a `Lesson` can be org-wide or project-scoped). For these, a `layer` discriminator column plus a CHECK constraint:

```sql
CREATE TABLE lessons (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL,
  project_id   uuid,                 -- nullable; NULL for org-wide
  layer        text NOT NULL CHECK (layer IN ('org', 'project')),
  title        text NOT NULL,
  body         text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
```

RLS predicates:

```sql
CREATE POLICY tenant_only ON lessons
  USING (
    tenant_id = current_setting('app.tenant_id')::uuid
    AND (
      layer = 'org'
      OR (layer = 'project' AND project_id = current_setting('app.project_id')::uuid)
    )
  );
```

## Conflict resolution (ADR-003)

When the two layers disagree — for example, the Organization Knowledge says a contract must include an idempotency key, but a project's services don't — the conflict enters a `conflicted` state and surfaces in the Steward queue.

The Steward decides:

- Accept the org rule → propagate to all projects.
- Accept the project exception → record the deviation with rationale.
- Split → define a new layer (e.g., a per-team layer).

See [ADR-003: Hybrid MDM with Steward priority](/architecture/adr-003-mdm-steward/) for the full decision protocol.

## Promotion flow

A lesson or template that proves valuable can be promoted from Project Intelligence to Organization Knowledge. The flow:

```text
Project Intelligence lesson
    |
    | forge-learn-promote (admin, approval)
    v
Draft Organization Knowledge entry
    |
    | Steward approval
    v
Organization Knowledge entry (applies to all projects)
```

The promotion is audited and the originating project's lesson is marked as `promoted`.

## When to use

| If you want to… | Use |
|---|---|
| Define an org-wide standard | Organization Knowledge (Steward) |
| Track a project's services | Project Intelligence (Architect) |
| Promote a useful lesson to all projects | `forge-learn-promote` (admin) |
| Resolve a conflict between layers | Steward queue |

## Anti-patterns

- **Don't put per-project data in Organization Knowledge.** It leaks across projects.
- **Don't put org-wide standards in Project Intelligence.** Each project gets a divergent copy.
- **Don't bypass the layer discriminator.** Use the `layer` column.
- **Don't promote without Steward approval.** The promotion gate is mandatory.

## Related

- [Knowledge graph](/concepts/knowledge-graph/)
- [Multi-tenancy](/concepts/multi-tenancy/)
- [ADR-002: PostgreSQL + AGE + pgvector](/architecture/adr-002-postgres-age/)
- [ADR-003: Hybrid MDM with Steward priority](/architecture/adr-003-mdm-steward/)
