---
name: forge-ns-context
description: "codebase intel | map graphify docs learnings mempalace"
allowed-tools:
  - Read
  - Skill
---


Route to the appropriate codebase-intelligence skill based on the user's intent.
`forge-scan` and `forge-intel` were folded into `forge-map-codebase` flags by #2790.

| User wants | Invoke |
|---|---|
| Map the full codebase structure | forge-map-codebase |
| Quick lightweight codebase scan | forge-map-codebase --fast |
| Query mapped intelligence files | forge-map-codebase --query |
| Generate a knowledge graph | forge-graphify |
| Update project documentation | forge-docs-update |
| Extract learnings from a completed phase | forge-extract-learnings |
| Recall prior decisions and patterns before planning | forge-mempalace-recall |
| File a phase artifact into MemPalace | forge-mempalace-capture |

Invoke the matched skill directly using the Skill tool.
