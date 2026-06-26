---
draft: false
title: Spec → Execute → Deploy
description: A greenfield walkthrough — from a one-paragraph idea to a deployed service.
---

import { Icon } from '../../../components/Icon.astro';
import Callout from '../../../components/Callout.astro';
import CommandExample from '../../../components/CommandExample.astro';
import Steps from '../../../components/Steps.astro';

This guide is for greenfield work: you have an idea but no ticket, no spec, no repo.
We'll go from a one-paragraph brief to a deployed service in under an hour.

## Step 0 — Open the co-pilot

```text
> /spec
  I want a small FastAPI service that takes a person's email and tells
  them whether their company has an open security advisory from CISA.
  No auth required. Cache results for 24h. Tenant-scoped on our side.
  Deploy target: staging.
```

The co-pilot treats this as the synthetic ticket anchor.

## Step 1 — Spike (5 minutes)

The co-pilot researches:
- The CISA advisory feed (KEV catalog + JSON endpoint).
- Your tenant schema (already has `tenants` and `projects`).
- Existing services that could be a template.

Output: a one-page brief with an architecture sketch and an open-question list.

## Step 2 — Plan (10 minutes)

```text
> /plan
```

The co-pilot drafts:

- **ADR** — why FastAPI, why Redis for cache, why tenant-scoped.
- **API Contract** — `GET /v1/advisories?email=...` with OpenAPI.
- **Task Breakdown** — 6 tasks.
- **Risk Register** — 2 risks (CISA feed downtime, email enumeration).

<Callout type="warning" title="Architecture HITL gate">
  The orchestrator pauses for the Architecture approver. Wait for approval before continuing.
</Callout>

## Step 3 — Execute (15 minutes)

The Command Center runs:

- `forge-development-scaffold` — FastAPI skeleton, Dockerfile, terraform module.
- `forge-development-tests` — pytest, integration tests against a CISA mock.
- `forge-development-migration` — Alembic migration for `cisa_cache` table.

A pull request is opened against `acme/platform-mono`. CI goes green.

## Step 4 — Verify (3 minutes)

```text
> /verify
```

Tests pass. Coverage 94%. Security scan: clean.

## Step 5 — Validate (2 minutes)

Policies run:
- PII redaction — email field is treated as PII; logs are masked.
- Spend cap — under budget.
- Dependency blocklist — fastapi, redis, httpx all allowed.

## Step 6 — Audit (1 minute)

Compliance bundle auto-assembled. Security approver signs off.

<Callout type="info" title="Security HITL gate">
  Required before deploy.
</Callout>

## Step 7 — Deploy (5 minutes)

PR merged. Auto-deploy to staging. Smoke tests pass.

Production deploy requires the third HITL gate (Deployment). Schedule it via the
Command Center, or use `forge-deployment-promote --env production`.

## What you built — in 41 minutes

- 1 FastAPI service in `acme/platform-mono/services/cisa-advisory/`
- 14 source files, 1 Alembic migration, 1 Dockerfile, 1 terraform module
- 1 ADR, 1 OpenAPI spec, 1 risk register
- 1 PR, 1 audit row, 1 deploy to staging

## Customizing this flow

You can:

- **Pre-approve phases** — for low-risk work, allow Execute + Verify to run unattended.
- **Add a Design review** — between Plan and Execute, force a Figma link.
- **Skip Validate** — for non-customer-facing internal tools.

See [Guides → Building a Workflow](/guides/building-workflow/) for the editor.

## Where to next

- [Lifecycle → Command Center](/lifecycle/command-center/) — full GSD reference.
- [Guides → Ticket-Driven Development](/guides/ticket-driven/) — ticket-anchored version.
- [Lifecycle → Runs](/lifecycle/runs/) — live run monitoring.
