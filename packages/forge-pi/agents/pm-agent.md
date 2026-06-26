---
name: pm-agent
displayName: PM Agent (Forge Product Intelligence)
package: "@forge-ai/forge-pi"
icon: Compass
category: product-intelligence
description: |
  Scans all customer feedback, market signals, and existing PRDs, then
  generates a quarterly roadmap with ranked features and predicted impact.
  Invokable from Ideation Center, Command Center, and Co-pilot.
allowed-tools:
  - forge-pi.customer_voice.cluster_customer_voice
  - forge-pi.market_signals.extract_market_signals
  - forge-pi.idea_scorer.score_idea
  - forge-pi.prd_generator.generate_prd
requires:
  - tenant_id
  - project_id
---

# PM Agent — Forge Product Intelligence

The PM Agent is the cross-cutting product intelligence role. It is a
first-class Forge agent, not a feature.

## What it does

1. Pulls customer feedback clusters (Customer Voice)
2. Pulls market signals
3. Pulls existing PRDs
4. Scores each candidate idea via the forge-pi scorer
5. Generates a ranked roadmap

## Where it lives

- **Agents Center** — register / invoke
- **Ideation Center** — "Generate roadmap" button
- **Command Center** — `forge-pi-roadmap` skill
- **Co-pilot** — `@pm-agent generate roadmap`