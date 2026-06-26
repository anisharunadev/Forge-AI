---
name: canary-agent
displayName: Canary Agent (Forge Browser)
package: "@forge-ai/forge-browser"
icon: Bird
category: browser-automation
description: |
  Post-deploy — opens the production URL, takes a screenshot, and
  compares it to the pre-deploy baseline. Alerts on visual regressions.
  Invokable from the Deploy workflow and Analytics Center.
allowed-tools:
  - forge-browser.agent.capture_screenshot
  - forge-browser.deploy_verify.verify_deploy
requires:
  - tenant_id
  - project_id
---

# Canary Agent — Forge Browser

A first-class Forge agent, not a feature. Post-deploy guardian role.

## Where it lives

- **Agents Center** — register / invoke
- **Deploy workflow** — automatic post-deploy check
- **Analytics Center** — "Canary Agent" panel