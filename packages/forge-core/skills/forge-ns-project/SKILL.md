---
name: forge-ns-project
description: "project lifecycle | milestones audits summary"
allowed-tools:
  - Read
  - Skill
---


Route to the appropriate project / milestone skill based on the user's intent.
`forge-plan-milestone-gaps` was deleted by #2790 — gap planning now happens
inline as part of `forge-audit-milestone`'s output.

| User wants | Invoke |
|---|---|
| Start a new project | forge-new-project |
| Create a new milestone | forge-new-milestone |
| Complete the current milestone | forge-complete-milestone |
| Audit a milestone for issues | forge-audit-milestone |
| Summarize milestone status | forge-milestone-summary |
| Import an external plan | forge-import |
| Bootstrap planning from existing docs | forge-ingest-docs |
| Generate a developer profile | forge-profile-user |
| Review and promote backlog items | forge-review-backlog |

Invoke the matched skill directly using the Skill tool.
