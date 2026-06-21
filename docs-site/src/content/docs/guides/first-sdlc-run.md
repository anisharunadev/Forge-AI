---
title: Your First SDLC Run
description: Walk a sample feature from ideation through deployment using forge-* commands.
---

This guide walks a sample feature ("add idempotency keys to the orders events table") through the full SDLC loop using `forge-*` commands. Estimated time: 30 minutes of reading plus an afternoon of execution.

## What is this?

A concrete, end-to-end example that touches every category of commands. After this guide, you'll know what each command produces, where it pauses, and what the next step is.

## Scenario

The team's order service is producing duplicate events under retry. The fix: add an idempotency key column and de-duplicate at write time. The work spans ideation → architecture → development → testing → security → deployment.

## Phase 1 — Ideation

```bash
# Brainstorm approaches
pnpm forge:exec forge-ideate-brainstorm \
  --args '{"problem":"orders events produce duplicates under retry","count":4}' \
  --tenant-id acme-corp --project-id acme-api --user-id pm@acme.com

# Compare
pnpm forge:exec forge-ideate-compare \
  --args '{"idea_ids":["idea-001","idea-002"],"axes":["cost","risk","time","blast_radius"]}' \
  --tenant-id acme-corp --project-id acme-api --user-id pm@acme.com

# Crystallize (admin, approval)
pnpm forge:exec forge-ideate-crystallize \
  --args '{"idea_id":"idea-001","seed_adr":true}' \
  --tenant-id acme-corp --project-id acme-api --user-id architect@acme.com
```

Output: an `Idea` typed artifact, crystallized, with a draft ADR seeded.

## Phase 2 — Architecture

```bash
# ADR (admin, approval)
pnpm forge:exec forge-arch-adr \
  --args '{"title":"Add idempotency key to orders.events","decision_ref":"idea-001"}' \
  --tenant-id acme-corp --project-id acme-api --user-id architect@acme.com

# Contract spec (admin, approval)
pnpm forge:exec forge-arch-contract-spec \
  --args '{"service_a":"orders","service_b":"billing","version":"v2"}' \
  --tenant-id acme-corp --project-id acme-api --user-id architect@acme.com

# Data model (admin, approval)
pnpm forge:exec forge-arch-data-model \
  --args '{"service":"orders","operation":"add_idempotency_key","target":"orders.events"}' \
  --tenant-id acme-corp --project-id acme-api --user-id architect@acme.com

# Update diagram
pnpm forge:exec forge-arch-diagram --args '{"scope":"project"}' \
  --tenant-id acme-corp --project-id acme-api --user-id architect@acme.com
```

Output: an `ADR` typed artifact, an `API Contract`, a `Data Model Change` (with migration preview), and an updated system diagram.

The Architecture approval gate pauses here. The architect (or delegate) reviews and approves.

## Phase 3 — Development

```bash
# Scaffold the change
pnpm forge:exec forge-dev-scaffold \
  --args '{"contract_id":"contract-001","feature":"idempotency"}' \
  --tenant-id acme-corp --project-id acme-api --user-id dev@acme.com

# Implement
pnpm forge:exec forge-dev-implement \
  --args '{"task_breakdown_id":"tb-001","branch":"feat/orders-idempotency"}' \
  --tenant-id acme-corp --project-id acme-api --user-id dev@acme.com
```

`forge-dev-implement` opens a feature branch, generates code in the Terminal Center, and pushes commits. The agent's every action is audited.

## Phase 4 — Testing

```bash
# Plan
pnpm forge:exec forge-test-plan \
  --args '{"diff_ref":"pr-123","risk_profile":"high"}' \
  --tenant-id acme-corp --project-id acme-api --user-id dev@acme.com

# Unit
pnpm forge:exec forge-test-unit --args '{"paths":["acme/orders/"]}' \
  --tenant-id acme-corp --project-id acme-api --user-id dev@acme.com

# Integration
pnpm forge:exec forge-test-integration \
  --args '{"services":["orders","billing"],"env":"staging"}' \
  --tenant-id acme-corp --project-id acme-api --user-id dev@acme.com

# Coverage
pnpm forge:exec forge-test-coverage \
  --args '{"diff_ref":"pr-123","baseline":"main"}' \
  --tenant-id acme-corp --project-id acme-api --user-id dev@acme.com
```

## Phase 5 — Review

```bash
pnpm forge:exec forge-review-diff \
  --args '{"pr_id":"pr-123","audience":"eng"}' \
  --tenant-id acme-corp --project-id acme-api --user-id reviewer@acme.com

pnpm forge:exec forge-review-risk \
  --args '{"pr_id":"pr-123"}' \
  --tenant-id acme-corp --project-id acme-api --user-id reviewer@acme.com

# Approve (admin, approval)
pnpm forge:exec forge-review-approve \
  --args '{"pr_id":"pr-123","merge_strategy":"squash"}' \
  --tenant-id acme-corp --project-id acme-api --user-id reviewer@acme.com
```

## Phase 6 — Security

```bash
# Scan (admin, approval)
pnpm forge:exec forge-sec-scan \
  --args '{"repo_id":"acme-api","scanners":["sast","sca"]}' \
  --tenant-id acme-corp --project-id acme-api --user-id security@acme.com

# Policy check (admin, approval)
pnpm forge:exec forge-sec-policy-check \
  --args '{"repo_id":"acme-api","policy_set":"soc2-v1"}' \
  --tenant-id acme-corp --project-id acme-api --user-id security@acme.com
```

The Security approval gate pauses here. The security reviewer marks the Security Report `final`.

## Phase 7 — Deploy

```bash
# Plan (admin, approval)
pnpm forge:exec forge-deploy-plan \
  --args '{"build_id":"abc123","target_env":"prod","strategy":"canary"}' \
  --tenant-id acme-corp --project-id acme-api --user-id releaser@acme.com

# Stage (admin, approval)
pnpm forge:exec forge-deploy-stage \
  --args '{"build_id":"abc123","environment":"staging"}' \
  --tenant-id acme-corp --project-id acme-api --user-id releaser@acme.com

# Prod (admin, approval)
pnpm forge:exec forge-deploy-prod \
  --args '{"build_id":"abc123","environment":"prod","canary_pct":5,"canary_window":"15m"}' \
  --tenant-id acme-corp --project-id acme-api --user-id releaser@acme.com
```

The Deployment approval gate pauses here. The release manager approves and the canary runs.

## Phase 8 — Milestone

```bash
pnpm forge:exec forge-milestone-cut \
  --args '{"version":"2026.06.21","bump_strategy":"minor"}' \
  --tenant-id acme-corp --project-id acme-api --user-id releaser@acme.com

pnpm forge:exec forge-milestone-tag \
  --args '{"version":"2026.06.21","sign":true}' \
  --tenant-id acme-corp --project-id acme-api --user-id releaser@acme.com

pnpm forge:exec forge-milestone-changelog \
  --args '{"version":"2026.06.21"}' \
  --tenant-id acme-corp --project-id acme-api --user-id releaser@acme.com

pnpm forge:exec forge-milestone-archive \
  --args '{"version":"2026.06.21"}' \
  --tenant-id acme-corp --project-id acme-api --user-id releaser@acme.com
```

## Phase 9 — Learning

```bash
pnpm forge:exec forge-learn-capture \
  --args '{"title":"Idempotency key de-duped 100% of duplicate events","tags":["orders","idempotency"]}' \
  --tenant-id acme-corp --project-id acme-api --user-id dev@acme.com
```

## What you've just done

You've touched 18 of the 63 `forge-*` commands and produced 6 typed artifacts (Idea, ADR, API Contract, Data Model Change, Security Report, Deployment Plan) plus a milestone archive and a captured lesson. Every action is in the audit ledger. Every approval is typed and attributable.

## Related

- [Quickstart](/start-here/quickstart/)
- [forge-* commands reference](/reference/forge-commands/)
- [Architecture tour](/start-here/architecture-tour/)
