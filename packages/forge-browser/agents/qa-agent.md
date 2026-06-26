---
name: qa-agent
displayName: QA Agent (Forge Browser)
package: "@forge-ai/forge-browser"
icon: ScanEye
category: browser-automation
description: |
  Invoked on a PR — opens the preview, navigates the changed screens,
  takes screenshots, and produces a visual diff report + accessibility
  check. Invokable from Stories (PR linked), Code Review, Deploy phase.
allowed-tools:
  - forge-browser.agent.capture_screenshot
  - forge-browser.visual_test.run_visual_test
  - forge-browser.a11y.audit_accessibility
requires:
  - tenant_id
  - project_id
  - pr_url
---

# QA Agent — Forge Browser

A first-class Forge agent, not a feature. Reviewer-facing role.

## Where it lives

- **Agents Center** — register / invoke
- **Stories** — PR linked → "Visual QA" button
- **Code Review** — "Run visual review" action
- **Deploy phase** — pre-deploy baseline capture