---
name: forge-pi-score-idea
description: Run an idea through the forge-pi scorer (RAG + LLM + chain-of-thought) and surface the verdict.
package: "@forge-ai/forge-pi"
category: ideation
icon: Sparkles
estimated-duration: 60
allowed-tools: forge-pi.idea_scorer.score_idea
requires:
  - tenant_id
  - project_id
  - idea_id
---

# forge-pi-score-idea

Drives the "Why this score?" answer in the Ideation Center. Captures the
chain-of-thought trace into `IdeaScore.reasoning` so the human reviewer can
audit the model's path (Forge Rule 6).