---
name: forge-pi-draft-prd
description: Generate a typed PRD draft from an idea, customer cluster, or market signal.
package: "@forge-ai/forge-pi"
category: ideation
icon: FileText
estimated-duration: 120
allowed-tools: forge-pi.prd_generator.generate_prd
requires:
  - tenant_id
  - project_id
---

# forge-pi-draft-prd

Outputs a `PrdDraft` (Rule 4 — Typed Artifacts Only). Originating input is
preserved in `originated_from` so the human reviewer can trace the artifact
back to its evidence source.