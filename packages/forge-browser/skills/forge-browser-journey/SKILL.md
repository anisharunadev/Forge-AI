---
name: forge-browser-journey
description: Execute a multi-step customer journey and capture screenshots for review.
package: "@forge-ai/forge-browser"
category: verification
icon: Route
estimated-duration: 180
allowed-tools: forge-browser.journey.run_journey
requires:
  - tenant_id
  - project_id
---

# forge-browser-journey

Drives the visual UAT mode of `forge-audit-uat`. Each step captures a
screenshot so the AI agent can review what happened.