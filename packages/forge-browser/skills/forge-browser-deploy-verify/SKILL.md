---
name: forge-browser-deploy-verify
description: Compare pre-deploy vs post-deploy screenshots and flag regressions.
package: "@forge-ai/forge-browser"
category: verification
icon: Rocket
estimated-duration: 60
allowed-tools: forge-browser.deploy_verify.verify_deploy
requires:
  - tenant_id
  - project_id
  - pre_deploy_url
  - post_deploy_url
---

# forge-browser-deploy-verify

Drives the post-deploy smoke test. Returns a `DeployVerifyResult` with
`passed: boolean` and the underlying `VisualDiff`. Used by the Deploy
workflow and the Analytics Center's "Canary Agent".