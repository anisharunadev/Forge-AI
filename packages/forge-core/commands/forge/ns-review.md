---
name: forge-quality
description: "quality gates | code review debug audit security eval ui"
argument-hint: ""
allowed-tools:
  - Read
  - Skill
requires: [code-review, audit-uat, secure-phase, eval-review, ui-review, validate-phase, debug, forensics, audit-fix, review, ui-phase]
---

Route to the appropriate quality / review skill based on the user's intent.
`forge-code-review-fix` was absorbed by `forge-code-review --fix` in #2790.

| User wants | Invoke |
|---|---|
| Review code for quality and correctness | forge-code-review |
| Auto-fix code review findings | forge-code-review --fix |
| Audit UAT / acceptance testing | forge-audit-uat |
| Security review of a phase | forge-secure-phase |
| Evaluate AI response quality | forge-eval-review |
| Review UI for design and accessibility | forge-ui-review |
| Validate phase outputs | forge-validate-phase |
| Debug a failing feature or error | forge-debug |
| Forensic investigation of a broken system | forge-forensics |
| Autonomous audit-to-fix pipeline | forge-audit-fix |
| Cross-AI peer review of plans | forge-review |
| Generate a UI design contract | forge-ui-phase |

Invoke the matched skill directly using the Skill tool.
