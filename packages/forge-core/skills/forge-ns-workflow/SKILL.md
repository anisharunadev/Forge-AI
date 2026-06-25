---
name: forge-ns-workflow
description: "workflow | discuss plan execute verify phase progress"
allowed-tools:
  - Read
  - Skill
---


Route to the appropriate phase-pipeline skill based on the user's intent.
Sub-skill names below are post-#2790 consolidated targets — `forge-phase`
absorbs the former add/insert/remove/edit-phase commands and `forge-progress`
absorbs the former next/do commands.

| User wants | Invoke |
|---|---|
| Gather context before planning | forge-discuss-phase |
| Clarify what a phase delivers | forge-spec-phase |
| Create a PLAN.md | forge-plan-phase |
| Execute plans in a phase | forge-execute-phase |
| Verify built features through UAT | forge-verify-work |
| Add / insert / remove / edit a phase | forge-phase |
| Advance to the next logical step | forge-progress |
| Offload planning to the ultraplan cloud | forge-ultraplan-phase |
| Cross-AI plan review convergence loop | forge-plan-review-convergence |
| Generate tests for a completed phase | forge-add-tests |
| Design an AI-integration phase | forge-ai-integration-phase |
| Run all remaining phases autonomously | forge-autonomous |
| Execute a trivial task inline | forge-fast |
| Plan a phase as a vertical MVP slice | forge-mvp-phase |
| Execute a quick task with GSD guarantees | forge-quick |

Invoke the matched skill directly using the Skill tool.
