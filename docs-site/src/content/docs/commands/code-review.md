---
title: Code Review Commands
description: The 4 code review commands — diff, risk, approve, request-changes.
---

The code review category has 4 commands that turn a PR into a typed Risk Register entry and route it through the Architecture / Security approval gate.

## Commands

| Command | Tier | Approval | Description |
|---|---|---|---|
| `forge-review-diff` | user | no | Summarize a diff for reviewers |
| `forge-review-risk` | user | no | Score change risk across axes |
| `forge-review-approve` | admin | yes | Approve a change set |
| `forge-review-request-changes` | admin | yes | Block a change set with reviewer notes |

## What is this category for?

Code review is the gate between development and merge. The review commands produce a Risk Register entry and enforce the approval posture of the change.

## How to use

### Diff summary

```bash
pnpm forge:exec forge-review-diff \
  --args '{"pr_id":"pr-123","audience":"eng"}' \
  --tenant-id acme-corp --project-id acme-api --user-id reviewer@acme.com
```

Produces a reviewer-friendly diff summary: what changed, why, what's risky, what to look at. Audience `eng` for technical reviewers, `exec` for stakeholder updates.

### Risk score

```bash
pnpm forge:exec forge-review-risk \
  --args '{"pr_id":"pr-123","axes":["blast_radius","data_integrity","security","perf","compliance"]}' \
  --tenant-id acme-corp --project-id acme-api --user-id reviewer@acme.com
```

Scores the PR on each axis (0–10) and produces a composite Risk Register entry. Output is a typed artifact.

### Approve (admin, requires approval)

```bash
pnpm forge:exec forge-review-approve \
  --args '{"pr_id":"pr-123","conditions":[],"merge_strategy":"squash"}' \
  --tenant-id acme-corp --project-id acme-api --user-id reviewer@acme.com
```

Approves the PR and triggers the merge. Admin + approval because the approval itself is a privileged event.

### Request changes (admin, requires approval)

```bash
pnpm forge:exec forge-review-request-changes \
  --args '{"pr_id":"pr-123","sections":[{"path":"acme/orders/idempotency.py","note":"add a unit test for the retry loop"}]}' \
  --tenant-id acme-corp --project-id acme-api --user-id reviewer@acme.com
```

Blocks the PR with typed section-level notes. The PR author sees the notes inline; the audit ledger records the blocking decision.

## Output

- `forge-review-diff` → Diff Summary
- `forge-review-risk` → Risk Register entry (typed artifact)
- `forge-review-approve` → Approval event + merge
- `forge-review-request-changes` → Change request event

## When to use

| Scenario | Command |
|---|---|
| PR open notification | `forge-review-diff` |
| Self-review before requesting review | `forge-review-risk` |
| Ready to merge | `forge-review-approve` (admin) |
| Needs work | `forge-review-request-changes` (admin) |

## CI integration

The review commands are wired to GitHub webhooks:

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  review-prep:
    steps:
      - forge-review-diff
      - forge-review-risk
```

The approval and request-changes commands update the GitHub PR status and post comments.

## Related

- [Development commands](/commands/development/)
- [Testing commands](/commands/testing/)
- [Approval gates](/concepts/approval-gates/)
