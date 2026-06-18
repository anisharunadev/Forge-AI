---
title: Developer
description: The Developer agent — the third stage. Writes code, tests, and PRs against the Architect's plan.
draft: false
last_generated_at: 2026-06-18T00:00:00Z
source_sha: forareal-final
source_path: workspace/memory/architecture.md
generator: readme
approval_required: false
---

The **Developer agent** is the third stage. It wakes when an ADR + plan are approved and produces a **feature branch**, a **code diff**, **unit tests**, and a **PR**.

## What it reads

- The ADR + plan from the Architect stage.
- The project's tech stack + coding conventions (`memory/coding.md`).
- The customer's conventions.
- The existing codebase in the monorepo.

## What it produces

| Artefact | Storage |
| --- | --- |
| Feature branch | GitHub (via the GitHub MCP server) |
| Code diff | GitHub (commits on the branch) |
| Unit + integration tests | Co-located with the code |
| PR description | GitHub |
| Cost report | Cost agent's table |

## The plan-then-act contract

The Developer agent's plan is constrained to:

```typescript
const plan = {
  tools: [
    'github.create_branch',
    'github.create_commit',
    'github.push',
    'github.create_pr',
    'github.request_review',
    'jira.update_issue',
    'jira.add_comment',
    'knowledge.read',
  ],
  budget: { tokens: 800_000, usd: 5, timeout_s: 900 },
};
```

The Developer agent cannot:

- Push to `main` directly.
- Bypass branch protection.
- Skip the PR template.
- Open a PR without unit tests.
- Open a PR without updating the Jira ticket.

## The test pyramid (per the [Memory → Coding → §5](https://github.com/fora-platform/fora/blob/main/workspace/memory/coding.md))

1. **Unit** — fast, in-process, ≤ 5 s total for the whole project.
2. **Integration** — service-to-service, requires docker compose.
3. **E2E** — Playwright, the user journey.
4. **Eval** — the capability + safety eval set.

A PR is not mergeable unless:

- ✅ Unit tests pass.
- ✅ Integration tests pass.
- ✅ Lint + typecheck pass.
- ✅ The PR template is filled in.
- ✅ The Jira ticket is linked.
- ✅ At least one reviewer is assigned.

## When it fails

| Failure | Behaviour |
| --- | --- |
| Plan violates the allow-list | Runtime refuses; agent re-plans |
| Tool not in allow-list | Runtime refuses; agent logs and re-plans |
| Code lints fails | Agent fixes in-line, re-commits |
| Typecheck fails | Agent fixes in-line, re-commits |
| Tests fail | Agent reads the error, fixes in-line, re-commits |
| Cost ceiling hit | Halt with "human-approval-required" |
| PR review requested changes | Agent reads the comments, fixes, re-commits |

## Where to next

- **[Architect →](/agents/architect/)** — the previous stage.
- **[QA →](/agents/qa/)** — the next stage.
- **[Architecture → Staged workflow →](/architecture/staged-workflow/)** — the full pipeline.

<div class="freshness-footer">
  <dl>
    <dt>Source SHA</dt><dd><code>forareal-final</code></dd>
    <dt>Source path</dt><dd><code>workspace/memory/architecture.md</code> + <code>workspace/memory/coding.md</code></dd>
    <dt>Last generated</dt><dd>2026-06-18T00:00:00Z</dd>
    <dt>Generator</dt><dd><code>readme</code> · DocAgent v1.0 ([FORA-298](/FORA/issues/FORA-298))</dd>
  </dl>
</div>
